import { Injectable, NotFoundException, BadRequestException } from "@nestjs/common";
import { randomBytes } from "crypto";
import { prisma, Role } from "@essentials/db";
import type { JwtUser } from "../common/roles.guard";

export const INVITABLE_ROLES: Role[] = ["guest", "promoter", "artist", "venue_manager"];

@Injectable()
export class InvitesService {
  /** Create a per-role invite code with usage cap and optional expiry. */
  async create(user: JwtUser, data: { role: Role; maxUses?: number; expiresInDays?: number }) {
    if (!INVITABLE_ROLES.includes(data.role)) {
      throw new BadRequestException(`Role must be one of: ${INVITABLE_ROLES.join(", ")}`);
    }
    const prefix = { guest: "G", promoter: "P", artist: "A", venue_manager: "V", admin: "X" }[data.role];
    const code = `${prefix}-${randomBytes(4).toString("hex").toUpperCase()}`;
    return prisma.invite.create({
      data: {
        code,
        role: data.role,
        maxUses: data.maxUses ?? 1,
        expiresAt: data.expiresInDays ? new Date(Date.now() + data.expiresInDays * 86_400_000) : null,
        createdBy: user.sub,
      },
    });
  }

  async list() {
    return prisma.invite.findMany({ orderBy: { createdAt: "desc" }, take: 100 });
  }

  async revoke(id: string) {
    const invite = await prisma.invite.findUnique({ where: { id } });
    if (!invite) throw new NotFoundException("Invite not found");
    return prisma.invite.update({ where: { id }, data: { revoked: true } });
  }

  /** Consume an invite if valid; returns the role it grants (or null if code isn't an invite). */
  async consumeIfInvite(code: string): Promise<Role | null> {
    const invite = await prisma.invite.findUnique({ where: { code } });
    if (!invite) return null;
    if (invite.revoked) throw new BadRequestException("This invite has been revoked");
    if (invite.expiresAt && invite.expiresAt < new Date()) throw new BadRequestException("This invite has expired");
    if (invite.uses >= invite.maxUses) throw new BadRequestException("This invite has been fully used");
    await prisma.invite.update({ where: { id: invite.id }, data: { uses: { increment: 1 } } });
    return invite.role;
  }

  linkFor(code: string, siteUrl: string) {
    return `${siteUrl}/login?invite=${code}`;
  }
}
