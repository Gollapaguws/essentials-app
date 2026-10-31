import { Injectable } from "@nestjs/common";
import { randomBytes } from "crypto";
import { prisma, type Role, type User } from "@essentials/db";
import { AuthEventsService } from "./auth-events.service";
import type { VerifiedSession } from "./supabase-token.service";

const ROLE_TTL_MS = 60_000;
const ROLES: Role[] = ["guest", "artist", "promoter", "venue_manager", "admin"];

/**
 * Maps a Supabase identity onto the Prisma User table (lazy link, no bulk import)
 * and resolves the canonical role with a short in-process cache.
 *
 * Link order: authUid -> email (bind authUid) -> create when the token carries a role.
 * None of those matches means "no account yet" and the client is sent through invite
 * onboarding. Null roles are deliberately never cached.
 */
@Injectable()
export class AuthUserService {
  private readonly cache = new Map<string, { role: Role; exp: number }>();

  constructor(private readonly events: AuthEventsService) {}

  async resolveRole(sub: string, email: string): Promise<Role | null> {
    const hit = this.cache.get(sub);
    if (hit && hit.exp > Date.now()) return hit.role;

    const user = await this.findByUidOrEmail(sub, email);
    if (!user) return null;

    this.remember(sub, user.role);
    return user.role;
  }

  /** Creates the account on first sign-in (open sign-up; no invite gating). */
  async ensureUser(session: VerifiedSession): Promise<{ user: User; created: boolean }> {
    const email = session.email.toLowerCase();

    const byUid = await prisma.user.findUnique({ where: { authUid: session.sub } });
    if (byUid) {
      this.remember(session.sub, byUid.role);
      return { user: byUid, created: false };
    }

    const byEmail =
      (await prisma.user.findUnique({ where: { email } })) ??
      (await prisma.user.findFirst({ where: { email: { equals: email, mode: "insensitive" } } }));
    if (byEmail) {
      const linked = await prisma.user.update({
        where: { id: byEmail.id },
        data: { authUid: session.sub },
      });
      this.remember(session.sub, linked.role);
      await this.events.record("lazy_link", {
        userId: linked.id,
        email: linked.email,
        meta: { bound: "email" },
      });
      return { user: linked, created: false };
    }

    // Open sign-up: first sign-in creates the account. Privileged roles can only
    // come from an admin-set claim — everything else lands as guest.
    const safeRole: Role = ROLES.includes(session.role as Role) ? (session.role as Role) : "guest";
    const created = await prisma.user.create({
      data: {
        email,
        role: safeRole,
        authUid: session.sub,
        referralCode: `E-${randomBytes(4).toString("hex").toUpperCase()}`,
      },
    });
    this.remember(session.sub, created.role);
    await this.events.record("lazy_link", {
      userId: created.id,
      email: created.email,
      meta: { bound: "created", role: created.role },
    });
    return { user: created, created: true };
  }

  /** Drop a cached role after a role change or invite redemption. */
  invalidate(sub: string): void {
    this.cache.delete(sub);
  }

  private async findByUidOrEmail(sub: string, email: string): Promise<User | null> {
    const byUid = await prisma.user.findUnique({ where: { authUid: sub } });
    if (byUid) return byUid;
    return prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  }

  private remember(sub: string, role: Role): void {
    this.cache.set(sub, { role, exp: Date.now() + ROLE_TTL_MS });
  }
}
