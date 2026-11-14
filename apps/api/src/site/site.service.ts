import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { prisma, ConsentStatus } from "@essentials/db";
import { MailService } from "../mail/mail.service";
import { emailTemplates } from "../mail/templates";
import { PRIVACY_POLICY_VERSION } from "../common/privacy";

/** Public marketing-site endpoints (essentialsedm.com front page). */
@Injectable()
export class SiteService {
  private readonly logger = new Logger(SiteService.name);

  constructor(private mail: MailService) {}

  /**
   * Newsletter signup from the front page footer. Marketing consent must be the
   * person's own affirmative choice, so a missing/false consent flag is refused
   * rather than inferred from the email address.
   */
  async subscribe(email: string, consent: boolean) {
    if (!consent) throw new BadRequestException("Marketing consent is required");
    email = email.toLowerCase().trim();
    const existing = await prisma.consent.findUnique({ where: { email_channel: { email, channel: "email" } } });
    if (existing?.status === ConsentStatus.granted) return { ok: true, already: true };

    let userId: string | undefined = undefined;
    const user = await prisma.user.findUnique({ where: { email } });
    if (user) userId = user.id;

    await prisma.consent.upsert({
      where: { email_channel: { email, channel: "email" } },
      update: {
        status: "granted",
        source: "site_footer",
        policyVersion: PRIVACY_POLICY_VERSION,
        revokedAt: null,
      },
      create: {
        email,
        userId,
        status: "granted",
        source: "site_footer",
        policyVersion: PRIVACY_POLICY_VERSION,
      },
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
