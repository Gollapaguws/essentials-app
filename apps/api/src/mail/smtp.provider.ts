import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import type { MailProvider, SendEmailInput } from "./mail-provider.interface";

/**
 * SMTP provider: sends via a local MTA (Postfix on the VPS, 127.0.0.1:25).
 * Deliverability depends on DNS: SPF + DMARC for the sender domain
 * (see docs/email-deliverability.md). DKIM recommended (opendkim).
 */
export class SmtpProvider implements MailProvider {
  private transport: Transporter;
  private from: string;

  constructor(from: string, host = "127.0.0.1", port = 25) {
    this.from = from;
    this.transport = nodemailer.createTransport({ host, port, secure: false, tls: { rejectUnauthorized: false } });
  }

  async send(input: SendEmailInput) {
    const info = await this.transport.sendMail({
      from: this.from,
      to: input.to,
      subject: input.subject,
      html: input.html,
      headers: input.unsubscribeUrl
        ? {
            "List-Unsubscribe": `<${input.unsubscribeUrl}>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          }
        : undefined,
    });
    return { id: info.messageId ?? `smtp-${Date.now()}` };
  }
}
