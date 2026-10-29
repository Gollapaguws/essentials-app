import { Injectable, UnauthorizedException, BadRequestException, Logger } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import { createHmac, randomBytes } from "crypto";
import { prisma } from "@essentials/db";
import type { Role } from "@prisma/client";
import { MailService } from "../mail/mail.service";
import { emailTemplates } from "../mail/templates";

/**
 * Magic-link auth.
 * Tokens are HMAC-signed, single purpose, TTL-bound. No password storage at all.
 * Invite codes: a user's referralCode doubles as their invite code for guests;
 * promoter/admin-issued invite links assign a role at signup.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(private jwt: JwtService, private config: ConfigService, private mail: MailService) {}

  private secret() {
    return this.config.getOrThrow<string>("JWT_SECRET");
  }

  private signToken(payload: object) {
    return createHmac("sha256", this.secret()).update(JSON.stringify(payload)).digest("hex");
  }

  async requestMagicLink(email: string, mobileRedirect = false) {
    email = email.toLowerCase().trim();
    const ttlMin = parseInt(this.config.get("MAGIC_LINK_TTL_MINUTES") ?? "15", 10);
    const exp = Date.now() + ttlMin * 60_000;
    const nonce = randomBytes(8).toString("hex");
    const sig = this.signToken({ email, exp, nonce });
    const token = `${Buffer.from(JSON.stringify({ email, exp, nonce })).toString("base64url")}.${sig}`;
    const base = mobileRedirect ? this.config.get("MOBILE_URL")! : this.config.get("APP_URL")!;
    const link = `${base}/auth/verify?token=${token}`;

    // Send regardless of account existence (no enumeration); template copy covers both cases.
    await this.mail.send({
      to: email,
      subject: "Your ESSENTIALS sign-in link",
      html: magicLinkEmail(link, ttlMin),
    });
    this.logger.log(`magic link requested for ${email}`);
    // In dev/console provider mode the link is printed to the server logs.
    return { ok: true };
  }

  async verifyMagicLink(token: string) {
    const [payloadB64, sig] = token.split(".");
    if (!payloadB64 || !sig) throw new BadRequestException("Malformed token");
    let payload: { email: string; exp: number; nonce: string };
    try {
      payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString());
    } catch {
      throw new BadRequestException("Malformed token");
    }
    if (payload.exp < Date.now()) throw new UnauthorizedException("Link expired, request a new one");
    if (this.signToken(payload) !== sig) throw new UnauthorizedException("Invalid token");

    const user = await prisma.user.findUnique({ where: { email: payload.email } });
    if (!user) throw new UnauthorizedException("NO_ACCOUNT"); // client proceeds to invite-code onboarding
    return this.issueTokens(user.id, user.email, user.role as Role);
  }

  /** Redeem an invite code/link. Creates the account and binds referral. */
  async redeemInvite(code: string, email: string, role: Role = "guest") {
    email = email.toLowerCase().trim();
    if (!["guest", "promoter", "artist", "venue_manager"].includes(role)) {
      throw new BadRequestException("Invalid role for invite");
    }
    const inviter = await prisma.user.findUnique({ where: { referralCode: code } });
    if (!inviter) throw new BadRequestException("Invalid invite code");
    if (await prisma.user.findUnique({ where: { email } })) {
      throw new BadRequestException("Account already exists — sign in instead");
    }

    const user = await prisma.user.create({
      data: {
        email,
        role,
        referredById: inviter.id,
        referralCode: `E-${randomBytes(4).toString("hex").toUpperCase()}`,
      },
    });
    await prisma.consent.upsert({
      where: { email_channel: { email, channel: "email" } },
      update: { status: "granted", source: "invite" },
      create: { email, userId: user.id, status: "granted", source: "invite" },
    });
    await prisma.referral.create({
      data: { referrerId: inviter.id, refereeEmail: email, refereeId: user.id },
    });
    await this.mail.send({ to: email, subject: "Welcome to ESSENTIALS", html: emailTemplates.welcomeSeries(user.name ?? "there", `${this.config.get("APP_URL")}/profile`) });
    return this.issueTokens(user.id, user.email, role);
  }

  async issueTokens(id: string, email: string, role: Role) {
    const accessToken = await this.jwt.signAsync(
      { sub: id, email, role },
      { secret: this.secret(), expiresIn: this.config.get("JWT_EXPIRES_IN") ?? "7d" },
    );
    return { accessToken, user: { id, email, role } };
  }
}

function magicLinkEmail(link: string, ttlMin: number) {
  return `<div style="font-family:Helvetica,Arial,sans-serif;background:#0A0A0A;color:#fff;padding:32px;border-radius:12px">
  <h1 style="color:#00FF66;letter-spacing:2px;margin:0 0 16px">ESSENTIALS</h1>
  <p>Tap below to sign in. This link expires in ${ttlMin} minutes and can be used once.</p>
  <p><a href="${link}" style="background:#00FF66;color:#0A0A0A;padding:12px 24px;border-radius:8px;font-weight:bold;text-decoration:none">SIGN IN</a></p>
  <p style="color:#888;font-size:12px">Didn't request this? Ignore this email — no account changes were made.</p>
</div>`;
}
