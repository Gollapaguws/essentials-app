import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomBytes } from "crypto";
import { prisma, type Role, type User } from "@essentials/db";
import { MailService } from "../mail/mail.service";
import { emailTemplates } from "../mail/templates";
import { SupabaseAdminService } from "./supabase-admin.service";
import { AuthEventsService } from "./auth-events.service";
import { AuthUserService } from "./auth-user.service";
import type { VerifiedSession } from "./supabase-token.service";

export interface PublicUser {
  id: string;
  email: string;
  role: Role;
}

const publicUser = (u: User): PublicUser => ({ id: u.id, email: u.email, role: u.role });

/**
 * Account onboarding. Sign-in itself belongs to Supabase; this service only turns
 * an invite code plus a verified session into a Prisma user.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private config: ConfigService,
    private mail: MailService,
    private admin: SupabaseAdminService,
    private events: AuthEventsService,
    private authUsers: AuthUserService,
  ) {}

  /**
   * Redeem an invite (or referral) code for the signed-in Supabase identity.
   * The email and authUid come from the verified token, never from the request body.
   */
  async redeemInvite(
    session: VerifiedSession,
    code: string,
    ip?: string,
  ): Promise<{ user: PublicUser }> {
    const email = session.email.toLowerCase().trim();

    const alreadyLinked = await prisma.user.findUnique({ where: { authUid: session.sub } });
    if (alreadyLinked) return { user: publicUser(alreadyLinked) };

    const byEmail = await prisma.user.findUnique({ where: { email } });
    if (byEmail) {
      const bound = await prisma.user.update({
        where: { id: byEmail.id },
        data: { authUid: session.sub },
      });
      this.authUsers.invalidate(session.sub);
      await this.events.record("lazy_link", {
        userId: bound.id,
        email,
        ip,
        meta: { bound: "invite_redeem" },
      });
      return { user: publicUser(bound) };
    }

    const invite = await prisma.invite.findUnique({ where: { code } });
    let grantedRole: Role;
    let inviterId: string | null = null;
    let inviteId: string | null = null;

    if (invite) {
      if (invite.revoked) throw new BadRequestException("This invite has been revoked");
      if (invite.expiresAt && invite.expiresAt < new Date()) {
        throw new BadRequestException("This invite has expired");
      }

      // Atomic claim: the WHERE clause is the guard, so concurrent redemptions can
      // never push `uses` past `maxUses`.
      const claimed = await prisma.invite.updateMany({
        where: {
          id: invite.id,
          revoked: false,
          uses: { lt: invite.maxUses },
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
        data: { uses: { increment: 1 } },
      });
      if (claimed.count === 0) throw new BadRequestException("This invite has been fully used");

      grantedRole = invite.role;
      inviteId = invite.id;
    } else {
      const inviter = await prisma.user.findUnique({ where: { referralCode: code } });
      if (!inviter) throw new BadRequestException("Invalid invite code");
      grantedRole = "guest";
      inviterId = inviter.id;
    }

    const user = await prisma.user.create({
      data: {
        email,
        role: grantedRole,
        authUid: session.sub,
        referredById: inviterId,
        referralCode: `E-${randomBytes(4).toString("hex").toUpperCase()}`,
      },
    });

    await prisma.consent.upsert({
      where: { email_channel: { email, channel: "email" } },
      update: { status: "granted", source: "invite" },
      create: { email, userId: user.id, status: "granted", source: "invite" },
    });
    await prisma.referral.create({
      data: { referrerId: inviterId ?? user.id, refereeEmail: email, refereeId: user.id },
    });

    try {
      await this.admin.updateRole(session.sub, grantedRole);
    } catch (e) {
      // best-effort: the guard falls back to the DB when the claim is absent
      this.logger.warn(`role mirror failed for ${email}: ${(e as Error).message}`);
    }

    this.authUsers.invalidate(session.sub);

    try {
      await this.mail.send({
        to: email,
        subject: "Welcome to ESSENTIALS",
        html: emailTemplates.welcomeSeries(
          user.name ?? "there",
          `${this.config.get("APP_URL") ?? "http://localhost:3001"}/profile`,
        ),
      });
    } catch (e) {
      // non-fatal: welcome mail must not block account creation
      this.logger.warn(`welcome mail failed for ${email}: ${(e as Error).message}`);
    }

    await this.events.record("invite_redeemed", {
      userId: user.id,
      email,
      ip,
      meta: { role: grantedRole, inviteId },
    });

    return { user: publicUser(user) };
  }
}
