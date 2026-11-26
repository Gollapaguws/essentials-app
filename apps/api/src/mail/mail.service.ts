import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { execFile, spawn } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
/**
 * A folder up to this many messages is read whole so replies can be grouped into
 * conversations; past it the list falls back to plain message rows, because
 * reading thousands of headers on every page would cost more than it explains.
 */
const THREAD_SCAN = 300;
/** Most messages one conversation reader will open, and the all-folders search cap. */
const MAX_THREAD_MESSAGES = 25;
const EVERYWHERE_SCAN = 200;
/** Most messages one rules pass will file before the next minute's pass continues. */
const RULE_MOVES_PER_SWEEP = 100;
/** Folders a rule may file into even when the mailbox has not used them yet. */
const FILING_FOLDERS = ["Archive", "Junk", "Trash"] as const;

export interface MailFolder {
  name: string;
  messages: number;
  unseen: number;
}

export interface DraftInput {
  mode?: string;
  to?: string;
  cc?: string;
  bcc?: string;
  subject?: string;
  body?: string;
  inReplyTo?: string;
  references?: string;
  attachments?: Array<{ filename?: string; contentType?: string; contentBase64?: string }>;
  /** The draft being replaced, so typing does not pile up copies. */
  uid?: number | null;
}

export interface MailDraft {
  uid: number;
  mode: "new" | "reply" | "forward";
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  body: string;
  inReplyTo: string;
  references: string;
  attachments: MailAttachmentMeta[];
  updatedAt: string | null;
}

const MAX_DRAFT_BYTES = 512 * 1024;

const MAX_SIGNATURE_CHARS = 2000;

export interface MailSummary {
  enabled: boolean;
  address: string | null;
  domain: string | null;
  folders: MailFolder[];
  signature: string;
}

export interface MailListItem {
  uid: number;
  subject: string;
  from: { name: string; address: string };
  date: string | null;
  seen: boolean;
  flagged: boolean;
  answered: boolean;
  messageId: string | null;
  inReplyTo: string | null;
  references: string | null;
  /** Which folder the row came from; only the all-folders search sets it. */
  folder?: string;
}

/** One conversation: messages that share a root Message-ID. */
export interface MailThread {
  key: string;
  folder: string;
  count: number;
  unseen: number;
  latest: MailListItem;
  uids: number[];
}

export interface MailListPage {
  folder: string;
  total: number;
  offset: number;
  limit: number;
  threaded: boolean;
  threads: MailThread[];
  messages: MailListItem[];
}

export interface MailRule {
  id: string;
  field: "from" | "to" | "subject";
  contains: string;
  folder: string;
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
        signature: "",
      };
    }
    const folders = await this.folders(box.localpart);
    return {
      enabled: true,
      address: box.address,
      domain: this.domain,
      folders,
      signature: (await this.readSignature(userId)) ?? "",
    };
  }

  /** Per-account signature, appended to mail started in the console. */
  async signature(userId: string) {
    await this.requireMailbox(userId);
    return { signature: (await this.readSignature(userId)) ?? "" };
  }

  async setSignature(userId: string, text: string) {
    await this.requireMailbox(userId);
    const value = (text ?? "").replace(/\r\n/g, "\n").trim();
    if (value.length > MAX_SIGNATURE_CHARS) {
      throw new BadRequestException(
        `Keep the signature under ${MAX_SIGNATURE_CHARS} characters.`,
      );
    }
    const key = this.signatureKey(userId);
    if (!value) {
      await prisma.platformSetting.deleteMany({ where: { key } });
      return { signature: "" };
    }
    await prisma.platformSetting.upsert({
      where: { key },
      create: { key, value },
      update: { value },
    });
    return { signature: value };
  }

  private signatureKey(userId: string) {
    return `mail_signature:${userId}`;
  }

  private async readSignature(userId: string): Promise<string | null> {
    const row = await prisma.platformSetting
      .findUnique({ where: { key: this.signatureKey(userId) }, select: { value: true } })
      .catch(() => null);
    return row?.value ?? null;
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
    options: { offset?: number; limit?: number; query?: string; everywhere?: boolean } = {},
  ): Promise<MailListPage> {
    const box = await this.requireMailbox(userId);
    const folder = await this.requireFolder(box.localpart, folderInput ?? "INBOX");
    const limit = Math.min(Math.max(Number(options.limit) || 25, 1), MAX_LIST);
    const offset = Math.max(Number(options.offset) || 0, 0);
    const keys = this.searchKeys(options.query);

    // "Search all mail" only makes sense with something to search for.
    if (options.everywhere && (options.query ?? "").trim()) {
      return this.listEverywhere(box.localpart, keys, offset, limit);
    }

    const uids = (await this.searchUids(box.localpart, folder, keys)).reverse();

    if (uids.length <= THREAD_SCAN) {
      const rows = await this.fetchHeaders(box.localpart, folder, uids);
      const threads = this.threadRows(rows, folder);
      const page = threads.slice(offset, offset + limit);
      return {
        folder,
        total: threads.length,
        offset,
        limit,
        threaded: true,
        threads: page,
        messages: page.map((thread) => thread.latest),
      };
    }

    const page = uids.slice(offset, offset + limit);
    const messages = page.length ? await this.fetchHeaders(box.localpart, folder, page) : [];
    // fetch returns them in the order asked for; keep the newest-first order.
    messages.sort((a, b) => page.indexOf(a.uid) - page.indexOf(b.uid));
    return {
      folder,
      total: uids.length,
      offset,
      limit,
      threaded: false,
      threads: [],
      messages,
    };
  }

  /**
   * The search box's field operators, answered by Dovecot's own index: unused
   * words go to TEXT (headers and body), the rest become narrow search keys.
   */
  private searchKeys(query?: string): string[] {
    // Dovecot takes each key and value as separate arguments, never one string.
    const text = (query ?? "").replace(/[\r\n\0]/g, " ").trim();
    if (!text) return ["ALL"];

    const keys: string[] = [];
    const words: string[] = [];
    for (const token of text.split(/\s+/).slice(0, 12)) {
      const field = /^(from|to|cc|subject|since|before|on):(.+)$/i.exec(token);
      if (field) {
        const name = field[1].toUpperCase();
        const value = field[2];
        if (name === "SINCE" || name === "BEFORE" || name === "ON") {
          const date = this.searchDate(value);
          if (!date) {
            words.push(value);
            continue;
          }
          keys.push(name, date);
        } else {
          keys.push(name, value.slice(0, 200));
        }
        continue;
      }
      if (/^is:unread$/i.test(token)) keys.push("UNSEEN");
      else if (/^is:read$/i.test(token)) keys.push("SEEN");
      else if (/^is:flagged$/i.test(token)) keys.push("FLAGGED");
      else if (/^is:answered$/i.test(token)) keys.push("ANSWERED");
      else if (/^has:attachment$/i.test(token)) keys.push("HEADER", "Content-Type", "multipart/mixed");
      else words.push(token);
    }
    if (words.length) keys.push("TEXT", words.join(" ").slice(0, 200));
    return keys.length ? keys : ["ALL"];
  }

  /** Dovecot wants dates as `dd-Mon-yyyy`; accept either that or ISO input. */
  private searchDate(value: string): string | null {
    const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (iso) {
      const date = new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));
      if (Number.isNaN(date.getTime())) return null;
      return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).replace(/ /g, "-");
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed
      .toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" })
      .replace(/ /g, "-");
  }

  private async searchUids(localpart: string, folder: string, keys: string[]): Promise<number[]> {
    const { stdout } = await this.doveadm(["search", "-u", localpart, "mailbox", folder, ...keys]);
    // One line per hit: "guid uid". Ascending, so the newest are at the end.
    return stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => Number(line.split(/\s+/).pop()))
      .filter((uid) => Number.isInteger(uid) && uid > 0);
  }

  /** Search every folder but Trash, newest first, with the folder shown on each row. */
  private async listEverywhere(
    localpart: string,
    keys: string[],
    offset: number,
    limit: number,
  ): Promise<MailListPage> {
    const names = (await this.mailboxNames(localpart)).filter((name) => name !== "Trash");
    const rows: MailListItem[] = [];
    for (const name of names) {
      const uids = (await this.searchUids(localpart, name, keys))
        .slice(-EVERYWHERE_SCAN)
        .reverse();
      if (!uids.length) continue;
      const found = await this.fetchHeaders(localpart, name, uids);
      rows.push(...found.map((row) => ({ ...row, folder: name })));
      if (rows.length >= EVERYWHERE_SCAN) break;
    }
    rows.sort((a, b) => this.time(b) - this.time(a) || b.uid - a.uid);
    const capped = rows.slice(0, EVERYWHERE_SCAN);
    return {
      folder: "",
      total: capped.length,
      offset,
      limit,
      threaded: false,
      threads: [],
      messages: capped.slice(offset, offset + limit),
    };
  }

  /**
   * One conversation, oldest first, so it reads like the thread it is. Opening a
   * thread marks it read exactly as opening a single message does.
   */
  async thread(userId: string, folderInput: string | undefined, uidsInput: string) {
    const box = await this.requireMailbox(userId);
    const folder = await this.requireFolder(box.localpart, folderInput ?? "INBOX");
    const uids = String(uidsInput ?? "")
      .split(",")
      .map((part) => Number(part.trim()))
      .filter((uid) => Number.isInteger(uid) && uid > 0)
      .slice(0, MAX_THREAD_MESSAGES);
    if (!uids.length) throw new BadRequestException("There is no conversation to open.");

    const messages: MailMessage[] = [];
    for (const uid of uids) {
      const found = await this.message(userId, folder, String(uid)).catch((err) => {
        if (err instanceof NotFoundException) return null;
        throw err;
      });
      if (found) messages.push(found);
    }
    if (!messages.length) throw new NotFoundException("That conversation is no longer in this folder.");
    messages.sort((a, b) => this.time(a) - this.time(b) || a.uid - b.uid);
    return { folder, messages };
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
      references: this.referencesOf(parsed),
      attachments: this.attachmentMeta(parsed),
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

    const attachments = this.buildAttachments(input.attachments);

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

    // Bcc stays in the Sent copy, where the sender can see whom they blind-copied,
    // but it must never travel to the recipients.
    await this.relay(this.withoutBcc(raw), { from: box.address, to: [...to, ...cc, ...bcc] });
    const saved = await this.saveToSent(box.localpart, raw).catch(() => false);
    return { ok: true, saved };
  }

  /**
   * The INBOX unread count alone, for the console nav. Unlike the summary this
   * never fails for a missing mailbox: an account without one simply has none.
   */
  async unread(userId: string) {
    const box = await this.ownMailbox(userId);
    if (!box) return { unseen: 0 };
    const { unseen } = await this.status(box.localpart, "INBOX");
    return { unseen };
  }

  /**
   * The composer's saved state, kept in the mailbox's own Drafts folder so it is
   * the same on every device and readable from any mail client. Only the newest
   * one is the active draft; older ones stay as ordinary messages.
   */
  async draft(userId: string, uidInput?: string): Promise<{ draft: MailDraft | null }> {
    const box = await this.requireMailbox(userId);
    const names = await this.mailboxNames(box.localpart);
    if (!names.includes("Drafts")) return { draft: null };

    let uid = uidInput ? this.uid(uidInput) : null;
    if (!uid) {
      const { stdout } = await this.doveadm([
        "search",
        "-u",
        box.localpart,
        "mailbox",
        "Drafts",
        "HEADER",
        "X-SONUS-Draft",
        "1",
      ]);
      const uids = stdout
        .split("\n")
        .map((line) => Number(line.trim().split(/\s+/).pop()))
        .filter((value) => Number.isInteger(value) && value > 0);
      if (!uids.length) return { draft: null };
      uid = Math.max(...uids);
    }

    const { raw } = await this.fetchMessage(box.localpart, "Drafts", uid);
    const parsed = await simpleParser(raw);
    const header = (name: string) => String(parsed.headers.get(name) ?? "").trim();
    const mode = header("x-sonus-mode");
    return {
      draft: {
        uid,
        mode: mode === "reply" || mode === "forward" ? mode : "new",
        to: this.addresses(parsed.to).join(", "),
        cc: this.addresses(parsed.cc).join(", "),
        // Bcc lives in a private header: the draft is stored with it, but a
        // client reading the Drafts folder never shows the recipients as Cc.
        bcc: header("x-sonus-bcc"),
        subject: parsed.subject ?? "",
        // The MIME parser hands back the trailing newline the writer added;
        // keeping it would grow the body by a line on every autosave.
        body: (parsed.text ?? "").replace(/\r\n/g, "\n").replace(/[\r\n]+$/, ""),
        inReplyTo: header("in-reply-to"),
        references: header("references"),
        attachments: this.attachmentMeta(parsed),
        updatedAt: parsed.date?.toISOString() ?? null,
      },
    };
  }

  /** Write the composer state into Drafts, replacing the draft it came from. */
  async saveDraft(userId: string, input: DraftInput): Promise<{ uid: number }> {
    const box = await this.requireMailbox(userId);
    const body = (input.body ?? "").replace(/[\r\n]+$/, "");
    if (Buffer.byteLength(body, "utf8") > MAX_DRAFT_BYTES) {
      throw new BadRequestException("This draft is too large to save. Send it, or trim it down.");
    }
    let attachments = this.buildAttachments(input.attachments);
    await this.ensureFolder(box.localpart, "Drafts");

    if (input.uid) {
      const replacing = this.uid(String(input.uid));
      // An autosave that changed no file sends no attachments; the ones already
      // stored with this draft are carried over rather than dropped.
      if (!input.attachments) {
        const existing = await this.fetchMessage(box.localpart, "Drafts", replacing).catch(() => null);
        if (existing) {
          const parsed = await simpleParser(existing.raw);
          attachments = parsed.attachments.map((file) => ({
            filename: file.filename || "attachment",
            contentType: file.contentType || "application/octet-stream",
            content: file.content,
          }));
        }
      }
      await this.doveadm([
        "expunge",
        "-u",
        box.localpart,
        "mailbox",
        "Drafts",
        "uid",
        String(replacing),
      ]).catch(() => null);
    }

    const oneLine = (value: string | undefined) => (value ?? "").replace(/[\r\n]+/g, " ").trim();
    const to = oneLine(input.to);
    const cc = oneLine(input.cc);
    const bcc = oneLine(input.bcc);
    const subject = oneLine(input.subject).slice(0, 300);
    const mode = input.mode === "reply" || input.mode === "forward" ? input.mode : "new";

    // A draft is built the way a sent message is, so an attachment attached here
    // is still attached when the draft is reopened on another device.
    const composer = createTransport({ streamTransport: true, buffer: true });
    const built = await composer.sendMail({
      from: box.address,
      to: to || undefined,
      cc: cc || undefined,
      subject,
      text: body,
      attachments,
      inReplyTo: oneLine(input.inReplyTo) || undefined,
      references: oneLine(input.references) || undefined,
      headers: {
        "X-SONUS-Draft": "1",
        "X-SONUS-Mode": mode,
        ...(bcc ? { "X-SONUS-Bcc": bcc } : {}),
      },
    });
    const raw = await toBuffer(built.message);

    await this.saveRaw(box.localpart, "Drafts", raw);

    const { stdout } = await this.doveadm([
      "search",
      "-u",
      box.localpart,
      "mailbox",
      "Drafts",
      "HEADER",
      "X-SONUS-Draft",
      "1",
    ]);
    const uids = stdout
      .split("\n")
      .map((line) => Number(line.trim().split(/\s+/).pop()))
      .filter((value) => Number.isInteger(value) && value > 0);
    if (!uids.length) throw new ServiceUnavailableException("The draft was written but could not be found again.");
    const uid = Math.max(...uids);
    await this.addFlags(box.localpart, "Drafts", uid, ["\\Draft", "\\Seen"]).catch(() => undefined);
    return { uid };
  }

  async deleteDraft(userId: string, uidInput: string) {
    const box = await this.requireMailbox(userId);
    const uid = this.uid(uidInput);
    await this.doveadm([
      "expunge",
      "-u",
      box.localpart,
      "mailbox",
      "Drafts",
      "uid",
      String(uid),
    ]).catch(() => null);
    return { ok: true };
  }

  /**
   * Filing rules, kept beside the mailbox as JSON so the sweep that applies them
   * (every minute, over the mail store) needs no database of its own.
   */
  async rules(userId: string): Promise<{ rules: MailRule[] }> {
    const box = await this.requireMailbox(userId);
    const raw = await readFile(this.rulesPath(box.localpart), "utf8").catch(() => null);
    return { rules: this.parseRules(raw) };
  }

  async setRules(userId: string, input: unknown): Promise<{ rules: MailRule[] }> {
    const box = await this.requireMailbox(userId);
    const names = await this.mailboxNames(box.localpart);
    const list = Array.isArray(input) ? input.slice(0, 50) : [];
    const rules: MailRule[] = await Promise.all(list.map(async (entry: Partial<MailRule>, index) => {
      const field = entry?.field === "from" || entry?.field === "to" || entry?.field === "subject" ? entry.field : null;
      const contains = String(entry?.contains ?? "").replace(/[\r\n\0]/g, " ").trim().slice(0, 200);
      const folder = String(entry?.folder ?? "").trim();
      if (!field || !contains) {
        throw new BadRequestException("Every rule needs a field and something to match on.");
      }
      const canFileInto = (FILING_FOLDERS as readonly string[]).includes(folder) || names.includes(folder);
      if (folder === "INBOX" || folder === "Drafts" || !canFileInto) {
        throw new BadRequestException(`"${folder}" is not a folder mail can be filed into.`);
      }
      // The standard folders are made on demand, so the first rule to name one
      // has somewhere to file into before the sweep runs.
      await this.ensureFolder(box.localpart, folder);
      return { id: String(entry?.id ?? index).slice(0, 40), field, contains, folder };
    }));

    const path = this.rulesPath(box.localpart);
    await writeFile(path, `${JSON.stringify({ rules }, null, 2)}\n`, { mode: 0o600 });
    // The sweep reads this file as the mailbox's own user, never as root.
    await run("chown", [`${box.localpart}:`, path]).catch(() => undefined);
    await chmod(path, 0o600).catch(() => undefined);
    return { rules };
  }

  private rulesPath(localpart: string) {
    return `/home/${localpart}/.sonus-rules.json`;
  }

  private parseRules(raw: string | null): MailRule[] {
    if (!raw) return [];
    try {
      const body = JSON.parse(raw) as { rules?: Partial<MailRule>[] };
      return (Array.isArray(body?.rules) ? body.rules : [])
        .filter((rule) => rule && rule.contains && rule.folder)
        .map((rule, index) => ({
          id: String(rule.id ?? index),
          field: rule.field === "to" || rule.field === "subject" ? rule.field : "from",
          contains: String(rule.contains),
          folder: String(rule.folder),
        }));
    } catch {
      return [];
    }
  }

  /**
   * Apply one mailbox's filing rules to its INBOX. The sweep runs on a timer, so
   * a new rule also files what is already waiting; the per-pass cap keeps a broad
   * rule from moving a whole mailbox in one go.
   */
  async fileByRules(localpart: string): Promise<{ moved: number }> {
    const rules = this.parseRules(await readFile(this.rulesPath(localpart), "utf8").catch(() => null));
    if (!rules.length) return { moved: 0 };

    const names = await this.mailboxNames(localpart);
    let moved = 0;
    for (const rule of rules) {
      if (moved >= RULE_MOVES_PER_SWEEP) break;
      if (rule.folder === "INBOX" || !names.includes(rule.folder)) continue;
      const uids = await this.searchUids(localpart, "INBOX", [rule.field.toUpperCase(), rule.contains]).catch(
        () => [],
      );
      // Oldest first: the messages that have waited longest are filed first.
      const batch = uids.slice(0, RULE_MOVES_PER_SWEEP - moved);
      if (!batch.length) continue;
      await this.doveadm([
        "move",
        "-u",
        localpart,
        rule.folder,
        "mailbox",
        "INBOX",
        "uid",
        batch.join(","),
      ]);
      moved += batch.length;
    }
    return { moved };
  }

  /**
   * "Junk" and "Not junk": file the message, and teach rspamd while it is at it.
   * Learning is best-effort — the move is the part the reader asked for.
   */
  async spam(userId: string, folderInput: string | undefined, uidInput: string, action?: string) {
    const box = await this.requireMailbox(userId);
    const folder = await this.requireFolder(box.localpart, folderInput ?? "INBOX");
    const uid = this.uid(uidInput);
    const ham = action === "ham";
    const target = ham ? "INBOX" : "Junk";

    // Read the message before filing it: the destination folder gives it a new
    // UID, so the learning step must not go looking for the old one there.
    const raw = await this.fetchMessage(box.localpart, folder, uid)
      .then((found) => found.raw)
      .catch(() => null);
    if (folder !== target) {
      await this.ensureFolder(box.localpart, target);
      await this.doveadm(["move", "-u", box.localpart, target, "mailbox", folder, "uid", String(uid)]);
    }
    const learned = raw ? await this.learnSpam(raw, ham).catch(() => false) : false;
    return { ok: true, folder: target, learned };
  }

  private async learnSpam(raw: string, ham: boolean): Promise<boolean> {
    // rspamc reads the message from a file, and /tmp is the one place both the
    // API user and root can meet; the copy goes as soon as it has been read.
    const dir = await mkdtemp(join(tmpdir(), "sonus-spam-"));
    const file = join(dir, "message.eml");
    try {
      await writeFile(file, raw, { mode: 0o600 });
      await run("rspamc", [ham ? "learn_ham" : "learn_spam", file], { timeout: 15_000 });
      return true;
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
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
    // Dovecot takes the field list as one argument; split into two and it
    // silently reports only the first, so unread counts come back as zero.
    const { stdout } = await this.doveadm([
      "mailbox",
      "status",
      "-u",
      localpart,
      "messages unseen",
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
      messageId: parsed.messageId ?? null,
      inReplyTo: parsed.inReplyTo ?? null,
      references: this.referencesOf(parsed),
    };
  }

  private referencesOf(parsed: ParsedMail): string | null {
    const value = parsed.references;
    if (!value) return null;
    return Array.isArray(value) ? value.join(" ") : String(value);
  }

  private attachmentMeta(parsed: ParsedMail): MailAttachmentMeta[] {
    return parsed.attachments.map((file, index) => ({
      index,
      filename: file.filename || `attachment-${index + 1}`,
      contentType: file.contentType || "application/octet-stream",
      size: file.size,
    }));
  }

  /**
   * Group rows by the root of their References chain: a reply carries its
   * conversation's first Message-ID, and a conversation's first message carries
   * its own. Subject matching only covers mail with no Message-ID at all.
   */
  private threadRows(rows: MailListItem[], folder: string): MailThread[] {
    const groups = new Map<string, MailListItem[]>();
    for (const row of rows) {
      const key = this.threadKey(row);
      const group = groups.get(key);
      if (group) group.push(row);
      else groups.set(key, [row]);
    }
    const threads: MailThread[] = [];
    for (const [key, group] of groups) {
      group.sort((a, b) => this.time(a) - this.time(b) || a.uid - b.uid);
      threads.push({
        key,
        folder,
        count: group.length,
        unseen: group.filter((row) => !row.seen).length,
        latest: group[group.length - 1],
        uids: group.map((row) => row.uid),
      });
    }
    threads.sort((a, b) => this.time(b.latest) - this.time(a.latest) || b.latest.uid - a.latest.uid);
    return threads;
  }

  private threadKey(row: MailListItem): string {
    const root = this.messageIds(row.references)[0] ?? row.messageId;
    if (root) return root.replace(/[<>]/g, "").toLowerCase();
    const subject = row.subject.replace(/^(re|fw|fwd):\s*/gi, "").trim().toLowerCase();
    return subject ? `subject:${subject}` : `uid:${row.uid}`;
  }

  private messageIds(value: string | null): string[] {
    return (value ?? "").match(/<[^<>\s]+>/g) ?? [];
  }

  private time(row: { date: string | null }): number {
    return row.date ? Date.parse(row.date) || 0 : 0;
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

  /** Shared by sending and draft-saving: same limits, same header-safe names. */
  private buildAttachments(
    input?: Array<{ filename?: string; contentType?: string; contentBase64?: string }>,
  ): Array<{ filename: string; contentType: string; content: Buffer }> {
    const attachments = (input ?? []).map((file) => {
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
    return attachments;
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
  /**
   * The message as it goes out: the Bcc header (and any folded continuations)
   * removed, so blind recipients are not disclosed to everyone else.
   */
  private withoutBcc(raw: Buffer): Buffer {
    const split = raw.indexOf("\r\n\r\n");
    const separator = split === -1 ? "\n\n" : "\r\n\r\n";
    const at = split === -1 ? raw.indexOf("\n\n") : split;
    if (at === -1) return raw;
    const kept: string[] = [];
    let dropping = false;
    for (const line of raw.subarray(0, at).toString("utf8").split(/\r?\n/)) {
      if (/^[ \t]/.test(line)) {
        if (!dropping) kept.push(line);
        continue;
      }
      dropping = /^bcc:/i.test(line);
      if (!dropping) kept.push(line);
    }
    return Buffer.concat([
      Buffer.from(`${kept.join("\r\n")}${separator}`, "utf8"),
      raw.subarray(at + separator.length),
    ]);
  }

  /**
   * The relay user mail leaves by. Resend's verified domain signs what the local
   * Postfix cannot: this host's DKIM record is stale and its IP is outside the
   * domain's SPF, so mail accepted locally would be rejected by Gmail. Without a
   * Resend key the local relay is still used, for a development machine.
   */
  private async relay(raw: Buffer, envelope: { from: string; to: string[] }) {
    const resend = this.config.get<string>("RESEND_API_KEY")?.trim();
    const host = resend ? "smtp.resend.com" : this.config.get<string>("SMTP_HOST")?.trim();
    if (!host) throw new ServiceUnavailableException("Mail sending is not configured on this server.");
    const local = ["127.0.0.1", "localhost", "::1"].includes(host);
    const port = resend
      ? 465
      : Number(this.config.get<string>("SMTP_PORT") || (this.config.get<string>("SMTP_USER") ? 465 : 25));
    const secure = resend
      ? true
      : this.config.get<string>("SMTP_SECURE")
        ? ["1", "true", "yes"].includes(String(this.config.get("SMTP_SECURE")).toLowerCase())
        : port === 465;
    const user = resend ? "resend" : this.config.get<string>("SMTP_USER")?.trim();
    const transport = createTransport({
      host,
      port,
      secure,
      requireTLS: !secure && !local,
      auth: user ? { user, pass: (resend ?? this.config.get<string>("SMTP_PASS")) ?? "" } : undefined,
      tls: { rejectUnauthorized: !local },
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
  private async saveRaw(localpart: string, folder: string, raw: Buffer): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const child = spawn("doveadm", ["save", "-u", localpart, "-m", folder], {
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
        else reject(new ServiceUnavailableException(`Could not write the draft: ${stderr.trim() || `doveadm exited ${code}`}`));
      });
      child.stdin.end(raw);
    });
  }

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
