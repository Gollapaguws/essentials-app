import { Injectable, Logger } from "@nestjs/common";
import { prisma, ConsentStatus } from "@essentials/db";
import { MailService } from "../mail/mail.service";
import { emailTemplates } from "../mail/templates";

/** Public marketing-site endpoints (essentialsedm.com front page). */
@Injectable()
export class SiteService {
  private readonly logger = new Logger(SiteService.name);

  constructor(private mail: MailService) {}

  /** Newsletter signup from the front page footer. */
  async subscribe(email: string) {
    email = email.toLowerCase().trim();
    const existing = await prisma.consent.findUnique({ where: { email_channel: { email, channel: "email" } } });
    if (existing?.status === ConsentStatus.granted) return { ok: true, already: true };

    let userId: string | undefined = undefined;
    const user = await prisma.user.findUnique({ where: { email } });
    if (user) userId = user.id;

    await prisma.consent.upsert({
      where: { email_channel: { email, channel: "email" } },
      update: { status: "granted", source: "signup" },
      create: { email, userId, status: "granted", source: "signup" },
    });
    await prisma.emailEvent.create({ data: { email, userId, type: "delivered", meta: { source: "site_subscribe" } } });

    try {
      await this.mail.send({
        to: email,
        subject: "Welcome to ESSENTIALS",
        html: emailTemplates.welcomeSeries("you", `${process.env.APP_URL ?? "https://essentialsedm.com"}/profile`),
      });
    } catch (e) {
      this.logger.warn(`welcome mail failed for ${email}: ${(e as Error).message}`);
    }
    return { ok: true };
  }
}
