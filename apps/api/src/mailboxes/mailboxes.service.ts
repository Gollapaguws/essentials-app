import { Injectable, BadRequestException, Logger } from "@nestjs/common";
import { execFile } from "child_process";
import { prisma } from "@essentials/db";

const DOMAIN = "essentialsedm.com";
const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{1,31}$/;
const RESERVED = new Set(["root", "admin", "postmaster", "abuse", "webmaster", "hostmaster", "www", "ftp", "mail", "supabase", "postgres", "essentials", "nobody", "daemon", "bin", "sys"]);

export interface Mailbox {
  username: string;
  email: string;
  home: string;
  created: string;
}

/** Mailbox management: system users whose mail lands in ~/Maildir (Dovecot IMAP + webmail). */
@Injectable()
export class MailboxesService {
  private readonly logger = new Logger(MailboxesService.name);

  private run(cmd: string, args: string[], input?: string): Promise<{ code: number; out: string }> {
    return new Promise((resolve) => {
      const p = execFile(cmd, args, { timeout: 15_000 }, (err, stdout, stderr) => {
        resolve({ code: err ? (err as NodeJS.ErrnoException & { code?: number }).code ?? 1 : 0, out: `${stdout}${stderr}` });
      });
      if (input !== undefined && p.stdin) {
        p.stdin.write(input);
        p.stdin.end();
      }
    });
  }

  async list(): Promise<Mailbox[]> {
    const { out } = await this.run("getent", ["passwd"]);
    return out
      .split("\n")
      .filter((l) => l.includes("/home/"))
      .map((l) => {
        const [name, , , , , home] = l.split(":");
        return { username: name, email: `${name}@${DOMAIN}`, home, created: "" };
      })
      .filter((m) => m.username.length <= 32 && RESERVED.has(m.username) === false && !["ubuntu", "refrakt"].includes(m.username));
  }

  async create(username: string, password: string): Promise<Mailbox> {
    username = username.toLowerCase().trim();
    if (!USERNAME_RE.test(username)) {
      throw new BadRequestException("Username must be 2-32 chars: lowercase letters, digits, dot, dash, underscore");
    }
    if (RESERVED.has(username)) throw new BadRequestException("That address is reserved");
    if (password.length < 10) throw new BadRequestException("Password must be at least 10 characters");

    const exists = await this.run("getent", ["passwd", username]);
    if (exists.out.trim()) throw new BadRequestException("Mailbox already exists");

    const add = await this.run("useradd", ["-m", "-s", "/usr/sbin/nologin", username]);
    if (add.code !== 0) throw new BadRequestException(`Could not create mailbox: ${add.out.trim()}`);
    const pw = await this.run("chpasswd", [], `${username}:${password}`);
    if (pw.code !== 0) throw new BadRequestException(`Mailbox created but password failed: ${pw.out.trim()}`);
    this.logger.log(`mailbox created: ${username}@${DOMAIN}`);
    return { username, email: `${username}@${DOMAIN}`, home: `/home/${username}`, created: new Date().toISOString() };
  }

  async setPassword(username: string, password: string) {
    username = username.toLowerCase().trim();
    if (!USERNAME_RE.test(username)) throw new BadRequestException("Invalid mailbox name");
    if (password.length < 10) throw new BadRequestException("Password must be at least 10 characters");
    const res = await this.run("chpasswd", [], `${username}:${password}`);
    if (res.code !== 0) throw new BadRequestException("Could not set password");
    return { ok: true };
  }

  async remove(username: string) {
    username = username.toLowerCase().trim();
    if (!USERNAME_RE.test(username)) throw new BadRequestException("Invalid mailbox name");
    const res = await this.run("userdel", ["-r", username]);
    if (res.code !== 0) throw new BadRequestException(`Could not remove mailbox: ${res.out.trim()}`);
    this.logger.log(`mailbox removed: ${username}@${DOMAIN}`);
    return { ok: true };
  }
}
