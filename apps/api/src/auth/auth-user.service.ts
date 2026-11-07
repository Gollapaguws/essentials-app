import { Injectable } from "@nestjs/common";
import { prisma, type Role, type User } from "@essentials/db";

export interface ResolvedIdentity {
  id: string;
  role: Role;
  mustResetPassword: boolean;
}

interface CacheEntry extends ResolvedIdentity {
  exp: number;
}

/**
 * Links a Supabase identity to its Prisma User row and resolves the canonical
 * role. The role lives on `User.role`; an admin changes it there and every app
 * follows, because the guard asks this service instead of the token claim.
 */
@Injectable()
export class AuthUserService {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly TTL_MS = 60_000;

  /** Admin audit trail: sign-ins, lazy links, role changes and MFA events. */
  async audit(limit = 100) {
    return prisma.authEvent.findMany({
      orderBy: { createdAt: "desc" },
      take: Math.min(Math.max(Number(limit) || 100, 1), 200),
    });
  }

  /** Find the local account for a Supabase identity, creating it on first sign-in. */
  async ensureUser(sub: string, email: string): Promise<User> {
    const byUid = await prisma.user.findUnique({ where: { authUid: sub } });
    if (byUid) return byUid;

    const normalized = email.toLowerCase();
    const byEmail = await prisma.user.findUnique({ where: { email: normalized } });
    if (byEmail) {
      // Existing seeded/pre-overhaul row: bind it once, keep its role and data.
      const linked = byEmail.authUid
        ? byEmail
        : await prisma.user.update({ where: { id: byEmail.id }, data: { authUid: sub } });
      this.remember(sub, linked);
      return linked;
    }

    // Self sign-ups choose their own password, so they are not sent through the
    // reset gate. Only admin-provisioned accounts (UsersService.create) are.
    const created = await prisma.user.create({
      data: { authUid: sub, email: normalized, role: "guest" },
    });
    this.remember(sub, created);
    return created;
  }

  /** Prisma id + canonical role for a session; null when the account cannot be resolved. */
  async resolveUser(sub: string, email: string): Promise<ResolvedIdentity | null> {
    const hit = this.cache.get(sub);
    if (hit && hit.exp > Date.now()) {
      return { id: hit.id, role: hit.role, mustResetPassword: hit.mustResetPassword };
    }
    try {
      const user = await this.ensureUser(sub, email);
      return { id: user.id, role: user.role, mustResetPassword: user.mustResetPassword };
    } catch {
      return null;
    }
  }

  /** Store the account's profile photo; avatars appear in chat and guest lists. */
  async setAvatar(userId: string, avatar: string): Promise<void> {
    await prisma.user.update({ where: { id: userId }, data: { avatar } });
  }

  /** The owner has chosen their own password: drop the first-login gate. */
  async clearPasswordReset(userId: string): Promise<void> {
    await prisma.user.update({
      where: { id: userId },
      data: { mustResetPassword: false },
    });
    this.invalidateById(userId);
  }

  /** Canonical role for a session, or null when no account exists and cannot be created. */
  async resolveRole(sub: string, email: string): Promise<Role | null> {
    return (await this.resolveUser(sub, email))?.role ?? null;
  }

  /** Called after an admin changes a role so the change is visible immediately. */
  invalidate(sub?: string | null): void {
    if (!sub) return;
    this.cache.delete(sub);
  }

  invalidateById(userId: string): void {
    for (const [sub, entry] of this.cache) {
      if (entry.id === userId) this.cache.delete(sub);
    }
  }

  private remember(sub: string, user: Pick<User, "id" | "role" | "mustResetPassword">): void {
    this.cache.set(sub, {
      id: user.id,
      role: user.role,
      mustResetPassword: user.mustResetPassword,
      exp: Date.now() + this.TTL_MS,
    });
  }
}
