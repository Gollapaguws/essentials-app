import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { MailProvider, SendEmailInput } from "./mail-provider.interface";
import { ConsoleMailProvider } from "./console.provider";
import { wrapTemplate } from "./templates";
import { Resend } from "resend";

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
        : new ConsoleMailProvider();
    this.logger.log(`mail provider: ${this.provider.constructor.name}`);
  }

  async send(input: SendEmailInput) {
    try {
      return await this.provider.send({ ...input });
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
    const { data } = await this.client.emails.send({
      from: process.env.MAIL_FROM ?? "ESSENTIALS <hello@essentials.example>",
      to: input.to,
      subject: input.subject,
      html: wrapTemplate(input.html, input.unsubscribeUrl),
    });
    return { id: data?.id ?? "" };
  }
}
