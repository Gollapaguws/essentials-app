import { Injectable } from "@nestjs/common";
import { prisma, type Role, type User } from "@essentials/db";

export interface ResolvedIdentity {
  id: string;
  role: Role;
  mustResetPassword: boolean;
  /** Admin exemption from the role's two-step requirement. */
  mfaDisabled: boolean;
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
      // Never map a different auth identity onto an existing account just because
      // it claims the same email. Supabase normally keeps emails unique, but an
      // email-change or provider mix-up must fail closed, not inherit the row.
      if (byEmail.authUid && byEmail.authUid !== sub) {
        throw new Error("This email is already linked to another sign-in");
      }
      // Lazy-link only unprivileged rows. A privileged row with no authUid must
      // be provisioned deliberately; otherwise anyone who registers that email
      // (while confirmations are off) inherits the role.
      if (!byEmail.authUid && byEmail.role !== "guest") {
        throw new Error("This account needs an invite before it can be linked");
      }
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
      return {
        id: hit.id,
        role: hit.role,
        mustResetPassword: hit.mustResetPassword,
        mfaDisabled: hit.mfaDisabled,
      };
    }
    try {
      const user = await this.ensureUser(sub, email);
      return {
        id: user.id,
        role: user.role,
        mustResetPassword: user.mustResetPassword,
        mfaDisabled: user.mfaDisabled,
      };
    } catch {
      return null;
    }
  }

  /** Store the account's profile photo; avatars appear in chat and guest lists. */
  async setAvatar(userId: string, avatar: string): Promise<void> {
    await prisma.user.update({ where: { id: userId }, data: { avatar } });
  }

  /**
   * The signed-in account's own profile card. An empty name clears it rather
   * than storing whitespace, and an absent field is left exactly as it was.
   */
  async updateMe(
    userId: string,
    data: { name?: string; musicTastes?: string[]; vibeTag?: "Chill" | "Party" | "Networking" },
  ) {
    return prisma.user.update({
      where: { id: userId },
      data: {
        ...(data.name !== undefined ? { name: data.name.trim() || null } : {}),
        ...(data.musicTastes !== undefined ? { musicTastes: data.musicTastes } : {}),
        ...(data.vibeTag !== undefined ? { vibeTag: data.vibeTag } : {}),
      },
      select: { id: true, name: true, avatar: true, musicTastes: true, vibeTag: true },
    });
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

  private remember(
    sub: string,
    user: Pick<User, "id" | "role" | "mustResetPassword" | "mfaDisabled">,
  ): void {
    this.cache.set(sub, {
      id: user.id,
      role: user.role,
      mustResetPassword: user.mustResetPassword,
      mfaDisabled: user.mfaDisabled,
      exp: Date.now() + this.TTL_MS,
    });
  }
}
