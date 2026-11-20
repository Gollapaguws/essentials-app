import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { MailProvider, SendEmailInput } from "./mail-provider.interface";
import { ConsoleMailProvider } from "./console.provider";
import { ListmonkProvider } from "./listmonk.provider";
import { SmtpProvider } from "./smtp.provider";
import { htmlToText, wrapTemplate } from "./templates";
import { unsubscribeHeaders } from "./unsubscribe";
import { Resend } from "resend";
import { MailQuotaError, isQuotaError } from "./mail-quota.error";

@Injectable()
export class MailService implements MailProvider {
  private readonly logger = new Logger(MailService.name);
  private provider: MailProvider;
  private from: string;

  constructor(private config: ConfigService) {
    const name = this.config.get("MAIL_PROVIDER") ?? "console";
    this.from = this.config.get("MAIL_FROM") ?? "ESSENTIALS <hello@essentials.example>";
    this.provider =
      name === "resend" && this.config.get("RESEND_API_KEY")
        ? new ResendProvider(this.config.get("RESEND_API_KEY")!)
        : name === "listmonk"
          ? new ListmonkProvider()
          : name === "smtp"
            ? new SmtpProvider(this.from, this.config.get("SMTP_HOST") ?? "127.0.0.1", parseInt(this.config.get("SMTP_PORT") ?? "25", 10))
            : new ConsoleMailProvider();
    this.logger.log(`mail provider: ${this.provider.constructor.name}`);
  }

  async send(input: SendEmailInput) {
    try {
      const html = input.unsubscribeUrl ? wrapTemplate(input.html, input.unsubscribeUrl) : input.html;
      const text = input.text ?? htmlToText(html);
      return await this.provider.send({ ...input, html, text });
    } catch (err) {
      this.logger.error(`mail send failed to ${input.to}: ${(err as Error).message}`);
      throw err;
    }
  }

  getFrom() {
    return this.from;
  }
}

class ResendProvider implements MailProvider {
  private client: Resend;
  constructor(apiKey: string) {
    this.client = new Resend(apiKey);
  }
  async send(input: SendEmailInput) {
    // The SDK reports API failures in `error` instead of throwing. Ignoring it
    // marked every rejected send as delivered, which hid an entire newsletter
    // going nowhere.
    const { data, error } = await this.client.emails.send({
      from: input.from ?? process.env.MAIL_FROM ?? "ESSENTIALS <hello@essentials.example>",
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
      headers: unsubscribeHeaders(input.unsubscribeUrl),
    });
    if (error) {
      const message = `Resend rejected ${input.to}: ${error.message}`;
      throw isQuotaError(error.name, error.message) ? new MailQuotaError(message) : new Error(message);
    }
    if (!data?.id) throw new Error(`Resend returned no id for ${input.to}`);
    return { id: data.id };
  }
}
