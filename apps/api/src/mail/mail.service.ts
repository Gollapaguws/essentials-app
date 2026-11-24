import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { simpleParser, type ParsedMail } from "mailparser";
import { createTransport } from "nodemailer";
import { prisma } from "@essentials/db";

const run = promisify(execFile);

/** `streamTransport` hands back a buffer, but the typings allow a stream too. */
async function toBuffer(message: unknown): Promise<Buffer> {
  if (Buffer.isBuffer(message)) return message;
  if (typeof message === "string") return Buffer.from(message);
  const chunks: Buffer[] = [];
  for await (const chunk of message as AsyncIterable<Buffer | string>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/** Folders a fresh mailbox gets on first use, in the order the UI shows them. */
const STANDARD_FOLDERS = ["INBOX", "Drafts", "Sent", "Archive", "Junk", "Trash"] as const;

const MAX_LIST = 50;
const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;
const MAX_TOTAL_ATTACHMENT_BYTES = 20 * 1024 * 1024;

export interface MailFolder {
  name: string;
  messages: number;
  unseen: number;
}

export interface MailSummary {
  enabled: boolean;
  address: string | null;
  domain: string | null;
  folders: MailFolder[];
}

export interface MailListItem {
  uid: number;
  subject: string;
  from: { name: string; address: string };
  date: string | null;
  seen: boolean;
  flagged: boolean;
  answered: boolean;
}

export interface MailAttachmentMeta {
  index: number;
  filename: string;
  contentType: string;
  size: number;
}

export interface MailMessage extends MailListItem {
  to: string[];
  cc: string[];
  text: string;
  html: string | null;
  messageId: string | null;
  references: string | null;
  attachments: MailAttachmentMeta[];
  folder: string;
}

export interface SendMailInput {
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  text: string;
  inReplyTo?: string;
  references?: string;
  attachments?: Array<{ filename: string; contentType: string; contentBase64: string }>;
}

/** A mailbox address for a signed-in account, resolved from the platform's own record. */
interface OwnMailbox {
  address: string;
  localpart: string;
}

/**
 * The mailbox section of the console.
 *
 * Mail lives in Dovecot on this host, one Unix account and Maildir per mailbox,
 * so nothing here goes through a third-party mail API: reads are `doveadm`
 * fetches, changes are `doveadm` flag/move calls, and sending is the same local
 * Postfix relay the rest of the platform already uses. That keeps the signed-in
 * account's mailbox password out of the database entirely — the API never needs
 * it, because it administers the mail store rather than logging in to it.
 *
 * Every command is run with an argument array (never a shell) and the mailbox
 * name is checked against the real folder list, so a folder or search string
 * from a request cannot turn into a different command.
 */
@Injectable()
export class MailService {
  constructor(private readonly config: ConfigService) {}

  private get domain() {
    return this.config.get<string>("MAILBOX_DOMAIN")?.trim() || "essentialsedm.com";
  }

  async summary(userId: string): Promise<MailSummary> {
    const box = await this.ownMailbox(userId).catch(() => null);
    if (!box) {
      return {
        enabled: this.config.get<string>("MAILBOX_PROVISIONING") === "1",
        address: null,
        domain: this.domain,
        folders: [],
      };
    }
    const folders = await this.folders(box.localpart);
    return { enabled: true, address: box.address, domain: this.domain, folders };
  }

  async folders(localpart: string): Promise<MailFolder[]> {
    const names = await this.mailboxNames(localpart);
    const folders: MailFolder[] = [];
    for (const name of names) {
      const status = await this.status(localpart, name);
      folders.push({ name, messages: status.messages, unseen: status.unseen });
    }
    // INBOX first, then the standard folders in their familiar order, then the rest.
    const rank = (name: string) => {
      const i = (STANDARD_FOLDERS as readonly string[]).indexOf(name);
      return i === -1 ? STANDARD_FOLDERS.length : i;
    };
    return folders.sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name));
  }

  async list(
    userId: string,
    folderInput: string | undefined,
    options: { offset?: number; limit?: number; query?: string } = {},
  ): Promise<{ folder: string; total: number; offset: number; limit: number; messages: MailListItem[] }> {
    const box = await this.requireMailbox(userId);
    const folder = await this.requireFolder(box.localpart, folderInput ?? "INBOX");
    const limit = Math.min(Math.max(Number(options.limit) || 25, 1), MAX_LIST);
    const offset = Math.max(Number(options.offset) || 0, 0);

    const search = this.searchQuery(options.query);
    const { stdout } = await this.doveadm([
      "search",
      "-u",
      box.localpart,
      "mailbox",
      folder,
      ...search,
    ]);
    // One line per hit: "guid uid". Ascending, so the newest are at the end.
    const uids = stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => Number(line.split(/\s+/).pop()))
      .filter((uid) => Number.isInteger(uid) && uid > 0);

    const newestFirst = uids.reverse();
    const page = newestFirst.slice(offset, offset + limit);
    const messages = page.length ? await this.fetchHeaders(box.localpart, folder, page) : [];
    // fetch returns them in the order asked for; keep the newest-first order.
    messages.sort((a, b) => page.indexOf(a.uid) - page.indexOf(b.uid));
    return { folder, total: newestFirst.length, offset, limit, messages };
  }

  async message(userId: string, folderInput: string | undefined, uidInput: string): Promise<MailMessage> {
    const box = await this.requireMailbox(userId);
    const folder = await this.requireFolder(box.localpart, folderInput ?? "INBOX");
    const uid = this.uid(uidInput);
    const fetched = await this.fetchMessage(box.localpart, folder, uid);
    const parsed = await simpleParser(fetched.raw);

    // Opening a message is reading it; the list badge should agree next time.
    if (!fetched.flags.includes("\\Seen")) {
      await this.addFlags(box.localpart, folder, uid, ["\\Seen"]).catch(() => undefined);
    }

    return {
      ...this.headerOf(uid, parsed, fetched.flags),
      to: this.addresses(parsed.to),
      cc: this.addresses(parsed.cc),
      text: parsed.text ?? "",
      html: typeof parsed.html === "string" ? parsed.html : null,
      messageId: parsed.messageId ?? null,
      references: parsed.references
        ? Array.isArray(parsed.references)
          ? parsed.references.join(" ")
          : parsed.references
        : null,
      attachments: parsed.attachments.map((file, index) => ({
        index,
        filename: file.filename || `attachment-${index + 1}`,
        contentType: file.contentType || "application/octet-stream",
        size: file.size,
      })),
      folder,
    };
  }

  async attachment(
    userId: string,
    folderInput: string | undefined,
    uidInput: string,
    indexInput: string,
  ): Promise<{ filename: string; contentType: string; content: Buffer }> {
    const box = await this.requireMailbox(userId);
    const folder = await this.requireFolder(box.localpart, folderInput ?? "INBOX");
    const uid = this.uid(uidInput);
    const index = Number(indexInput);
    const fetched = await this.fetchMessage(box.localpart, folder, uid);
    const parsed = await simpleParser(fetched.raw);
    const file = Number.isInteger(index) ? parsed.attachments[index] : undefined;
    if (!file) throw new NotFoundException("That attachment is not on this message.");
    return {
      filename: file.filename || `attachment-${index + 1}`,
      contentType: file.contentType || "application/octet-stream",
      content: file.content,
    };
  }

  async setFlags(
    userId: string,
    folderInput: string | undefined,
    uidInput: string,
    flags: { seen?: boolean; flagged?: boolean },
  ) {
    const box = await this.requireMailbox(userId);
    const folder = await this.requireFolder(box.localpart, folderInput ?? "INBOX");
    const uid = this.uid(uidInput);
    const add: string[] = [];
    const remove: string[] = [];
    if (flags.seen === true) add.push("\\Seen");
    if (flags.seen === false) remove.push("\\Seen");
    if (flags.flagged === true) add.push("\\Flagged");
    if (flags.flagged === false) remove.push("\\Flagged");
    if (!add.length && !remove.length) throw new BadRequestException("Nothing to change.");
    if (add.length) await this.addFlags(box.localpart, folder, uid, add);
    if (remove.length) await this.removeFlags(box.localpart, folder, uid, remove);
    return { ok: true };
  }

  async move(userId: string, folderInput: string | undefined, uidInput: string, targetInput: string) {
    const box = await this.requireMailbox(userId);
    const from = await this.requireFolder(box.localpart, folderInput ?? "INBOX");
    const uid = this.uid(uidInput);
    const to = (targetInput ?? "").trim();
    if (!to) throw new BadRequestException("Choose a folder to move the message to.");
    if (to === from) return { ok: true };
    await this.ensureFolder(box.localpart, to);
    await this.doveadm(["move", "-u", box.localpart, to, "mailbox", from, "uid", String(uid)]);
    return { ok: true };
  }

  /** Delete means "to Trash"; deleting inside Trash is permanent. */
  async remove(userId: string, folderInput: string | undefined, uidInput: string) {
    const box = await this.requireMailbox(userId);
    const folder = await this.requireFolder(box.localpart, folderInput ?? "INBOX");
    const uid = this.uid(uidInput);
    if (folder !== "Trash") {
      await this.ensureFolder(box.localpart, "Trash");
      await this.doveadm(["move", "-u", box.localpart, "Trash", "mailbox", folder, "uid", String(uid)]);
      return { ok: true, movedTo: "Trash" };
    }
    await this.doveadm(["expunge", "-u", box.localpart, "mailbox", "Trash", "uid", String(uid)]);
    return { ok: true, movedTo: null };
  }

  async send(userId: string, input: SendMailInput) {
    const box = await this.requireMailbox(userId);
    const to = this.recipients(input.to, "To");
    if (!to.length) throw new BadRequestException("Add at least one recipient.");
    const cc = this.recipients(input.cc, "Cc");
    const bcc = this.recipients(input.bcc, "Bcc");
    const subject = (input.subject ?? "").trim();
    if (!subject) throw new BadRequestException("Give the message a subject.");
    const text = input.text ?? "";
    if (!text.trim() && !input.attachments?.length) {
      throw new BadRequestException("Write something before sending.");
    }

    const attachments = (input.attachments ?? []).map((file) => {
      const content = Buffer.from(file.contentBase64 ?? "", "base64");
      if (content.length > MAX_ATTACHMENT_BYTES) {
        throw new BadRequestException(`${file.filename || "An attachment"} is larger than 15 MB.`);
      }
      return {
        filename: (file.filename || "attachment").replace(/[\r\n]/g, " "),
        contentType: file.contentType || "application/octet-stream",
        content,
      };
    });
    const totalBytes = attachments.reduce((sum, file) => sum + file.content.length, 0);
    if (totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
      throw new BadRequestException("Attachments add up to more than 20 MB. Send them in two messages.");
    }

    // One composed message, used twice: once for the relay, once for the Sent copy.
    const composer = createTransport({ streamTransport: true, buffer: true });
    const built = await composer.sendMail({
      from: box.address,
      to,
      cc: cc.length ? cc : undefined,
      bcc: bcc.length ? bcc : undefined,
      subject,
      text,
      attachments,
      inReplyTo: input.inReplyTo || undefined,
      references: input.references || undefined,
      headers: { "X-Mailer": "SONUS console" },
    });
    const raw = await toBuffer(built.message);

    await this.relay(raw, { from: box.address, to: [...to, ...cc, ...bcc] });
    const saved = await this.saveToSent(box.localpart, raw).catch(() => false);
    return { ok: true, saved };
  }

  // ---- mail store plumbing -------------------------------------------------

  private async ownMailbox(userId: string): Promise<OwnMailbox | null> {
    const row = await prisma.userMailbox.findUnique({
      where: { userId },
      select: { address: true, localpart: true, status: true },
    });
    if (!row || row.status !== "active") return null;
    return { address: row.address, localpart: row.localpart };
  }

  private async requireMailbox(userId: string): Promise<OwnMailbox> {
    const box = await this.ownMailbox(userId);
    if (!box) {
      throw new NotFoundException({
        message: "This account does not have a SONUS mailbox yet.",
        code: "NO_MAILBOX",
      });
    }
    return box;
  }

  private async mailboxNames(localpart: string): Promise<string[]> {
    const { stdout } = await this.doveadm(["mailbox", "list", "-u", localpart]);
    return stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  }

  private async status(localpart: string, folder: string) {
    const { stdout } = await this.doveadm([
      "mailbox",
      "status",
      "-u",
      localpart,
      "messages",
      "unseen",
      folder,
    ]);
    const messages = Number(/messages=(\d+)/.exec(stdout)?.[1] ?? 0);
    const unseen = Number(/unseen=(\d+)/.exec(stdout)?.[1] ?? 0);
    return { messages, unseen };
  }

  private async requireFolder(localpart: string, folder: string) {
    const names = await this.mailboxNames(localpart);
    if (!names.includes(folder)) {
      throw new BadRequestException(`There is no "${folder}" folder in this mailbox.`);
    }
    return folder;
  }

  private async ensureFolder(localpart: string, folder: string) {
    const names = await this.mailboxNames(localpart);
    if (names.includes(folder)) return;
    await this.doveadm(["mailbox", "create", "-u", localpart, folder]).catch((err) => {
      // A concurrent request may have created it; anything else is a real failure.
      if (!/already exists/i.test(String(err?.stderr ?? err?.message ?? ""))) throw err;
    });
  }

  /** Search terms come from the UI; keep them to one literal doveadm argument. */
  private searchQuery(query?: string): string[] {
    const text = (query ?? "").replace(/[\r\n\0]/g, " ").trim();
    if (!text) return ["ALL"];
    return ["TEXT", text.slice(0, 200)];
  }

  private uid(input: string): number {
    const uid = Number(input);
    if (!Number.isInteger(uid) || uid <= 0) throw new BadRequestException("Unknown message.");
    return uid;
  }

  /**
   * One message, rebuilt from the two fields this Dovecot serves (it has no
   * `body[]`): headers and body, with the blank separator line put back.
   */
  private async fetchMessage(
    localpart: string,
    folder: string,
    uid: number,
  ): Promise<{ raw: string; flags: string[] }> {
    const { stdout } = await this.doveadm([
      "fetch",
      "-u",
      localpart,
      "uid flags hdr body",
      "mailbox",
      folder,
      "uid",
      String(uid),
    ]);
    if (!stdout.trim()) throw new NotFoundException("That message is no longer in this folder.");
    const flags = (/^flags: (.*)$/m.exec(stdout)?.[1] ?? "").split(/\s+/).filter(Boolean);
    const headerAt = stdout.indexOf("\nhdr:\n");
    if (headerAt === -1) return { raw: stdout, flags };
    const rest = stdout.slice(headerAt + "\nhdr:\n".length);
    const bodyAt = rest.indexOf("\nbody:\n");
    const headers = (bodyAt === -1 ? rest : rest.slice(0, bodyAt)).replace(/\s+$/, "");
    const body = bodyAt === -1 ? "" : rest.slice(bodyAt + "\nbody:\n".length);
    return { raw: `${headers}\n\n${body}`, flags };
  }

  private async fetchHeaders(localpart: string, folder: string, uids: number[]): Promise<MailListItem[]> {
    const { stdout } = await this.doveadm([
      "fetch",
      "-u",
      localpart,
      "uid flags hdr",
      "mailbox",
      folder,
      "uid",
      uids.join(","),
    ]);
    // Dovecot separates records with a form feed on its own line.
    const records = stdout
      .split(/\n?\u000c\n/)
      .filter((chunk) => /^uid: /m.test(chunk.trimStart()));
    const items: MailListItem[] = [];
    for (const record of records) {
      const text = record.trimStart();
      const uid = Number(/^uid: (\d+)/.exec(text)?.[1]);
      const flags = (/^flags: (.*)$/m.exec(text)?.[1] ?? "").split(/\s+/).filter(Boolean);
      const at = text.indexOf("\nhdr:\n");
      const headerText = at === -1 ? "" : text.slice(at + "\nhdr:\n".length);
      const parsed = await simpleParser(headerText);
      items.push(this.headerOf(uid, parsed, flags));
    }
    return items;
  }

  private headerOf(uid: number, parsed: ParsedMail, flags: string[]): MailListItem {
    const from = Array.isArray(parsed.from) ? parsed.from[0] : parsed.from;
    const address = from?.value?.[0];
    return {
      uid,
      subject: parsed.subject?.trim() || "(no subject)",
      from: {
        name: address?.name || address?.address || "Unknown sender",
        address: address?.address || "",
      },
      date: parsed.date ? parsed.date.toISOString() : null,
      seen: flags.includes("\\Seen"),
      flagged: flags.includes("\\Flagged"),
      answered: flags.includes("\\Answered"),
    };
  }

  private addresses(field: ParsedMail["to"]): string[] {
    if (!field) return [];
    const list = Array.isArray(field) ? field : [field];
    return list.flatMap((entry) => entry.value.map((item) => item.address ?? "")).filter(Boolean);
  }

  private async addFlags(localpart: string, folder: string, uid: number, flags: string[]) {
    await this.doveadm(["flags", "add", "-u", localpart, flags.join(" "), "mailbox", folder, "uid", String(uid)]);
  }

  private async removeFlags(localpart: string, folder: string, uid: number, flags: string[]) {
    await this.doveadm(["flags", "remove", "-u", localpart, flags.join(" "), "mailbox", folder, "uid", String(uid)]);
  }

  private recipients(value: string | undefined, field: string): string[] {
    const list = (value ?? "")
      .split(/[,;]/)
      .map((entry) => entry.trim())
      .filter(Boolean);
    if (list.length > 20) throw new BadRequestException(`Too many ${field} recipients.`);
    for (const address of list) {
      if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(address)) {
        throw new BadRequestException(`"${address}" is not an email address.`);
      }
      if (/[\r\n]/.test(address)) throw new BadRequestException("Invalid recipient.");
    }
    return list;
  }

  /** Postfix on this host is the relay; no third-party SMTP credentials are involved. */
  private async relay(raw: Buffer, envelope: { from: string; to: string[] }) {
    const host = this.config.get<string>("SMTP_HOST")?.trim();
    if (!host) throw new ServiceUnavailableException("Mail sending is not configured on this server.");
    const port = Number(this.config.get<string>("SMTP_PORT") || (this.config.get<string>("SMTP_USER") ? 465 : 25));
    const secure = this.config.get<string>("SMTP_SECURE")
      ? ["1", "true", "yes"].includes(String(this.config.get("SMTP_SECURE")).toLowerCase())
      : port === 465;
    const user = this.config.get<string>("SMTP_USER")?.trim();
    const transport = createTransport({
      host,
      port,
      secure,
      requireTLS: !secure && !["127.0.0.1", "localhost", "::1"].includes(host),
      auth: user ? { user, pass: this.config.get<string>("SMTP_PASS") ?? "" } : undefined,
      tls: { rejectUnauthorized: !["127.0.0.1", "localhost", "::1"].includes(host) },
    });
    try {
      await transport.sendMail({ envelope, raw });
    } catch (err) {
      // A refused recipient is the sender's problem to fix, not an outage: say
      // which address the relay rejected instead of "something went wrong".
      const code = (err as { responseCode?: number }).responseCode ?? 0;
      const message = String((err as Error).message ?? "").replace(/^Can't send mail - /, "");
      if (code >= 500 && code < 600) {
        throw new BadRequestException(`The mail server refused the message: ${message.slice(0, 240)}`);
      }
      throw new ServiceUnavailableException(`The mail server could not be reached: ${message.slice(0, 160)}`);
    } finally {
      transport.close();
    }
  }

  /** Keep a copy in Sent, the way every mail client does. */
  private async saveToSent(localpart: string, raw: Buffer): Promise<boolean> {
    await this.ensureFolder(localpart, "Sent");
    await new Promise<void>((resolve, reject) => {
      const child = spawn("doveadm", ["save", "-u", localpart, "-m", "Sent"], {
        stdio: ["pipe", "ignore", "pipe"],
        timeout: 20_000,
      });
      let stderr = "";
      child.stderr.on("data", (chunk) => {
        stderr += String(chunk);
      });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(stderr.trim() || `doveadm save exited ${code}`));
      });
      child.stdin.end(raw);
    });
    return true;
  }

  private async doveadm(args: string[]) {
    try {
      return await run("doveadm", args, { maxBuffer: 32 * 1024 * 1024, timeout: 20_000 });
    } catch (err) {
      const message = String((err as { stderr?: string }).stderr ?? (err as Error).message ?? "");
      if (/no such|not found|doesn't exist/i.test(message)) {
        throw new NotFoundException("That mailbox or message no longer exists.");
      }
      if (/unknown user|user lookup failed/i.test(message)) {
        throw new NotFoundException({
          message: "This mailbox is not active on the mail server.",
          code: "NO_MAILBOX",
        });
      }
      throw new ServiceUnavailableException(`Mail server error: ${message.slice(0, 200) || "unknown"}`);
    }
  }
}
