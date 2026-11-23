import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { execFile } from "node:child_process";
import { renameSync, writeFileSync } from "node:fs";
import { promisify } from "node:util";
import { prisma } from "@essentials/db";

const execFileAsync = promisify(execFile);

export const ALIAS_MAP_PATH = "/etc/postfix/virtual-mailboxes";
export const CATCH_ALL_KEY = "mailbox_catch_all";

export interface AliasMapMailbox {
  address: string;
  aliases: string[];
}

/**
 * The Postfix map is generated from the database, never edited by hand:
 * one line per alias and, when enabled, one catch-all for the domain.
 */
export function renderAliasMap(
  mailboxes: AliasMapMailbox[],
  catchAll: string | null,
  domain: string,
): string {
  const lines = [
    "# Managed by ESSENTIALS user-mail provisioning — do not edit by hand.",
    `# Regenerate from Dashboard → Users → Mailbox. Domain: ${domain}`,
  ];
  for (const mailbox of mailboxes) {
    for (const alias of [...mailbox.aliases].sort()) {
      lines.push(`${alias}@${domain}\t${mailbox.address}`);
    }
  }
  if (catchAll) lines.push(`@${domain}\t${catchAll}`);
  return `${lines.join("\n")}\n`;
}

@Injectable()
export class AliasMapService {
  private readonly logger = new Logger(AliasMapService.name);
  private readonly domain: string;

  constructor(private readonly config: ConfigService) {
    this.domain = (this.config.get<string>("MAILBOX_DOMAIN")?.trim() || "essentialsedm.com").toLowerCase();
  }

  get enabled(): boolean {
    return /^(1|true|yes)$/i.test(this.config.get<string>("MAILBOX_PROVISIONING") ?? "");
  }

  /** Rewrite the map, rebuild its hash and reload Postfix. */
  async sync(): Promise<boolean> {
    if (!this.enabled) return false;

    const mailboxes = await prisma.userMailbox.findMany({
      where: { status: "active" },
      select: { address: true, aliases: true },
      orderBy: { address: "asc" },
    });
    const setting = await prisma.platformSetting.findUnique({ where: { key: CATCH_ALL_KEY } });
    const body = renderAliasMap(mailboxes, setting?.value || null, this.domain);

    const tmp = `${ALIAS_MAP_PATH}.tmp`;
    writeFileSync(tmp, body, { mode: 0o644 });
    renameSync(tmp, ALIAS_MAP_PATH);
    await execFileAsync("postmap", [ALIAS_MAP_PATH]);
    await execFileAsync("systemctl", ["reload", "postfix"]);
    this.logger.log(`alias map synced (${mailboxes.length} mailboxes, catch-all ${setting?.value ?? "off"})`);
    return true;
  }
}
