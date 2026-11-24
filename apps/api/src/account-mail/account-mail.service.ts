import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createTransport, type Transporter } from "nodemailer";
import { escapeHtml } from "../common/html";

/**
 * Transactional account notices. These are service messages about the account
 * itself — never campaigns, never a subscriber list, and never an unsubscribe
 * link. Marketing mail lives in phpList at newsletters.essentialsedm.com.
 */
export type AccountNotice =
  | { kind: "account-created"; role: string }
  | { kind: "role-changed"; from: string; to: string }
  | { kind: "sign-in-reset" }
  | { kind: "mfa-changed"; enabled: boolean }
  | { kind: "mailbox-created"; address: string }
  | {
      kind: "statement";
      month: string;
      dj: string;
      gigs: Array<{
        date: string;
        night: string;
        venue: string;
        slot: string | null;
        fee: number;
        travel: number;
        invoiced: number;
        paid: number;
        invoice: string | null;
        status: string;
      }>;
      totals: { agreed: number; invoiced: number; paid: number; outstanding: number };
    };

const ROLE_LABELS: Record<string, string> = {
  admin: "administrator",
  artist: "DJ",
  promoter: "promoter",
  venue_manager: "venue manager",
  door: "door staff",
  guest: "guest",
};

function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role.replace(/_/g, " ");
}

export interface RenderedNotice {
  subject: string;
  text: string;
  html: string;
}

/** Pure renderer so the copy can be tested without an SMTP server. */
export function renderAccountNotice(
  notice: AccountNotice,
  { appUrl }: { appUrl: string },
): RenderedNotice {
  let subject: string;
  let paragraphs: string[];

  switch (notice.kind) {
    case "account-created":
      subject = "Your ESSENTIALS account is ready";
      paragraphs = [
        `An ESSENTIALS account has been created for this address as a ${roleLabel(notice.role)}.`,
        `Sign in at ${appUrl} with the details your administrator gives you. On first sign-in you will be asked to choose your own password.`,
        "If you were not expecting this account, contact the ESSENTIALS team.",
      ];
      break;
    case "role-changed":
      subject = "Your ESSENTIALS account access changed";
      paragraphs = [
        `Your ESSENTIALS access changed from ${roleLabel(notice.from)} to ${roleLabel(notice.to)}.`,
        `Sign in at ${appUrl} to see what is now available to you.`,
        "If you did not expect this change, contact the ESSENTIALS team.",
      ];
      break;
    case "sign-in-reset":
      subject = "Your ESSENTIALS sign-in was reset";
      paragraphs = [
        "An administrator reset the sign-in for this account. Your password and two-step verification were cleared, and every signed-in device was signed out.",
        `Sign in at ${appUrl} with the temporary password your administrator gives you, then choose a new password and set up two-step verification again.`,
        "If you did not ask for this reset, contact the ESSENTIALS team.",
      ];
      break;
    case "mfa-changed":
      subject = "Two-step verification changed on your ESSENTIALS account";
      paragraphs = [
        notice.enabled
          ? "Two-step verification was turned back on for this account by an administrator."
          : "Two-step verification was turned off for this account by an administrator, and any enrolled authenticator was removed.",
        `Sign in at ${appUrl} to review your security settings.`,
        "If you did not expect this change, contact the ESSENTIALS team.",
      ];
      break;
    case "statement": {
      const money = (value: number) => `R${value.toLocaleString()}`;
      subject = `Your ${notice.month} ESSENTIALS statement`;
      paragraphs = [
        `Here is your statement for ${notice.month} as ${notice.dj}.`,
        ...notice.gigs.map(
          (gig) =>
            `${gig.date} · ${gig.night} at ${gig.venue}${gig.slot ? ` (${gig.slot})` : ""} — fee ${money(gig.fee)}, travel ${money(gig.travel)}, ${gig.invoice ? `invoice ${gig.invoice} (${gig.status})` : "not invoiced"}, paid ${money(gig.paid)}`,
        ),
        `Agreed ${money(notice.totals.agreed)} · invoiced ${money(notice.totals.invoiced)} · paid ${money(notice.totals.paid)} · outstanding ${money(notice.totals.outstanding)}.`,
        `You can download the CSV any time from ${appUrl} → Statements.`,
      ];
      break;
    }
    case "mailbox-created": {
      const mailHost = `mail.${notice.address.split("@")[1]}`;
      subject = "Your ESSENTIALS mailbox is ready";
      paragraphs = [
        `A mailbox has been created for this account: ${notice.address}.`,
        `Incoming mail: IMAP ${mailHost}, port 993, SSL. Outgoing mail: SMTP ${mailHost}, port 587, STARTTLS with your mailbox password.`,
        "The password is not included in this email — an administrator gives it to you separately. If it is lost, it can be reset from the dashboard.",
        "The mailbox is separate from your sign-in email address.",
      ];
      break;
    }
  }

  const footer =
    "This is a service message about your ESSENTIALS account. It is not a newsletter and no subscription is involved.";

  const text = [...paragraphs, footer].join("\n\n");
  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#0b0b0c;font-family:Helvetica,Arial,sans-serif;color:#e9e2d0">
    <div style="max-width:520px;margin:0 auto">
      <p style="margin:0 0 24px;font-size:12px;letter-spacing:.32em;text-transform:uppercase;color:#c99533">ESSENTIALS</p>
      ${paragraphs
        .map((paragraph) => `<p style="margin:0 0 16px;line-height:1.6">${escapeHtml(paragraph)}</p>`)
        .join("\n      ")}
      <p style="margin:24px 0 0;font-size:12px;line-height:1.6;color:#8d8677">${escapeHtml(footer)}</p>
    </div>
  </body>
</html>`;

  return { subject, text, html };
}

/**
 * Sends the notices over the host's SMTP relay, using a sender separate from the
 * newsletter (`newsletters@`). Disabled when `SMTP_HOST` or `ACCOUNT_MAIL_FROM`
 * is blank, and every failure is logged instead of thrown: an admin action must
 * not fail because the relay is down.
 */
@Injectable()
export class AccountMailService {
  private readonly logger = new Logger(AccountMailService.name);
  private readonly transport: Transporter | null;
  private readonly from: string;
  private readonly replyTo?: string;
  private readonly appUrl: string;

  constructor(private readonly config: ConfigService) {
    const host = this.config.get<string>("SMTP_HOST")?.trim();
    this.from = this.config.get<string>("ACCOUNT_MAIL_FROM")?.trim() ?? "";
    this.replyTo = this.config.get<string>("ACCOUNT_MAIL_REPLY_TO")?.trim() || undefined;
    this.appUrl = (this.config.get<string>("APP_URL")?.trim() || "https://sonus.essentialsedm.com").replace(
      /\/+$/,
      "",
    );

    if (!host || !this.from) {
      this.transport = null;
      return;
    }

    const user = this.config.get<string>("SMTP_USER")?.trim();
    const pass = this.config.get<string>("SMTP_PASS") ?? "";
    const port = Number(this.config.get<string>("SMTP_PORT") || 25);
    const secure = /^(1|true)$/i.test(this.config.get<string>("SMTP_SECURE") ?? "");
    // The local Postfix advertises STARTTLS with the mail.essentialsedm.com
    // certificate, which cannot match 127.0.0.1. Loopback needs no verification
    // (same rule as scripts/uptime-watch.mjs); remote relays still must match.
    const local = ["127.0.0.1", "localhost", "::1"].includes(host);
    this.transport = createTransport({
      host,
      port,
      secure,
      auth: user ? { user, pass } : undefined,
      requireTLS: !secure && !local,
      tls: { rejectUnauthorized: !local },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
  }

  /** False when the relay or sender is not configured; callers can stay silent. */
  get enabled(): boolean {
    return this.transport !== null;
  }

  async send(to: string, notice: AccountNotice): Promise<boolean> {
    const recipient = to?.trim();
    if (!this.transport || !recipient) return false;

    const rendered = renderAccountNotice(notice, { appUrl: this.appUrl });
    try {
      await this.transport.sendMail({
        from: this.from,
        to: recipient,
        replyTo: this.replyTo,
        subject: rendered.subject,
        text: rendered.text,
        html: rendered.html,
      });
      return true;
    } catch (err) {
      this.logger.warn(
        `account notice "${notice.kind}" to ${recipient} was not sent: ${(err as Error).message}`,
      );
      return false;
    }
  }
}
