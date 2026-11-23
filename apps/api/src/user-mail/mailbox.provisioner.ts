import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Names that must never become a login mailbox, even if no Unix account exists
 * yet. Everything already in passwd is refused separately by `userExists`.
 */
const RESERVED_LOCALPARTS = new Set([
  "abuse",
  "bin",
  "daemon",
  "games",
  "irc",
  "list",
  "lp",
  "mail",
  "mailer-daemon",
  "mailerdaemon",
  "man",
  "news",
  "nobody",
  "no-reply",
  "noreply",
  "postfix",
  "postmaster",
  "proxy",
  "root",
  "sshd",
  "sync",
  "sys",
  "systemd-network",
  "systemd-resolve",
  "uucp",
  "www-data",
]);

const LOCALPART_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{0,28}[a-z0-9])?$/;

/** Lower-case, trim and collapse anything that cannot appear in a local part. */
export function normaliseLocalpart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, 30);
}

export function isReservedLocalpart(value: string): boolean {
  return RESERVED_LOCALPARTS.has(value);
}

export function isValidLocalpart(value: string): boolean {
  return LOCALPART_PATTERN.test(value) && !value.includes("..");
}

/**
 * Creates the actual Unix + Dovecot mail account. The API runs as root on the
 * mail host, so every argument is validated by the caller and passed as an
 * argv entry — never through a shell.
 */
@Injectable()
export class MailboxProvisioner {
  private readonly logger = new Logger(MailboxProvisioner.name);
  readonly domain: string;

  constructor(private readonly config: ConfigService) {
    this.domain = (this.config.get<string>("MAILBOX_DOMAIN")?.trim() || "essentialsedm.com").toLowerCase();
  }

  /** Off by default so a developer machine never shells out to useradd. */
  get enabled(): boolean {
    return /^(1|true|yes)$/i.test(this.config.get<string>("MAILBOX_PROVISIONING") ?? "");
  }

  addressFor(localpart: string): string {
    return `${localpart}@${this.domain}`;
  }

  async userExists(localpart: string): Promise<boolean> {
    try {
      await execFileAsync("getent", ["passwd", localpart], { timeout: 10_000 });
      return true;
    } catch {
      return false;
    }
  }

  async create(localpart: string, password: string): Promise<void> {
    await execFileAsync(
      "useradd",
      ["-m", "-U", "-s", "/usr/sbin/nologin", "-c", "ESSENTIALS mailbox", localpart],
      { timeout: 30_000 },
    );

    try {
      await this.setPassword(localpart, password);
      for (const dir of ["Maildir", "Maildir/cur", "Maildir/new", "Maildir/tmp"]) {
        await execFileAsync(
          "install",
          ["-d", "-o", localpart, "-g", localpart, "-m", "700", `/home/${localpart}/${dir}`],
          { timeout: 10_000 },
        );
      }
    } catch (err) {
      // Never leave a half-created Unix account behind.
      await this.remove(localpart).catch(() => null);
      throw err;
    }
  }

  async setPassword(localpart: string, password: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const child = spawn("chpasswd", [], { stdio: ["pipe", "ignore", "pipe"], timeout: 30_000 });
      let stderr = "";
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`chpasswd failed (${code}): ${stderr.trim()}`));
      });
      child.stdin.end(`${localpart}:${password}\n`);
    });
  }

  /** Locking the password blocks IMAP/POP and SMTP AUTH; mail still queues. */
  async setLocked(localpart: string, locked: boolean): Promise<void> {
    await execFileAsync("usermod", [locked ? "-L" : "-U", localpart], { timeout: 10_000 });
  }

  async remove(localpart: string): Promise<void> {
    await execFileAsync("userdel", ["-r", localpart], { timeout: 60_000 });
  }

  /** Maildir size for the admin view; null when the account is gone. */
  async usageBytes(localpart: string): Promise<number | null> {
    try {
      const { stdout } = await execFileAsync("du", ["-sb", `/home/${localpart}`], { timeout: 10_000 });
      const bytes = Number(stdout.split(/\s+/)[0]);
      return Number.isFinite(bytes) ? bytes : null;
    } catch (err) {
      this.logger.debug(`usage read failed for ${localpart}: ${(err as Error).message}`);
      return null;
    }
  }
}
