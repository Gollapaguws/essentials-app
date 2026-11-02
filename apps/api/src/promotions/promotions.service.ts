import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from "@nestjs/common";
import { prisma } from "@essentials/db";
import type { JwtUser } from "../common/roles.guard";

@Injectable()
export class PromotionsService {
  async create(user: JwtUser, data: {
    eventId: string; code: string; kind?: string; discountPct?: number; maxUses?: number; expiresAt?: string;
  }) {
    const event = await prisma.event.findUnique({ where: { id: data.eventId } });
    if (!event) throw new NotFoundException("Event not found");
    if (user.role !== "admin" && event.promoterId !== user.sub) throw new ForbiddenException("Not your event");
    return prisma.promotion.create({
      data: {
        eventId: data.eventId,
        code: data.code.toUpperCase(),
        kind: data.kind ?? "discount",
        discountPct: data.discountPct ?? 0,
        maxUses: data.maxUses ?? 100,
        expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
      },
    });
  }

  async listForEvent(user: JwtUser, eventId: string) {
    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new NotFoundException("Event not found");
    if (user.role !== "admin" && event.promoterId !== user.sub) throw new ForbiddenException();
    return prisma.promotion.findMany({
      where: { eventId },
      include: { _count: { select: { redemptions: true } } },
    });
  }

  /** Guests redeem at RSVP: applies discount + counts usage. */
  async redeem(user: JwtUser, code: string) {
    const promo = await prisma.promotion.findUnique({ where: { code: code.toUpperCase() } });
    if (!promo || !promo.active) throw new BadRequestException("Invalid promo code");
    if (promo.expiresAt && promo.expiresAt < new Date()) throw new BadRequestException("Promo expired");
    if (promo.uses >= promo.maxUses) throw new BadRequestException("Promo fully redeemed");

    const entry = await prisma.guestList.findFirst({ where: { eventId: promo.eventId, userId: user.sub } });
    if (!entry) throw new BadRequestException("RSVP first, then redeem");

    const already = await prisma.promotionRedemption.findUnique({
      where: { promotionId_userId: { promotionId: promo.id, userId: user.sub } },
    });
    if (already) throw new BadRequestException("Already redeemed");

    const [redemption] = await prisma.$transaction([
      prisma.promotionRedemption.create({ data: { promotionId: promo.id, userId: user.sub, guestListId: entry.id } }),
      prisma.promotion.update({ where: { id: promo.id }, data: { uses: { increment: 1 } } }),
    ]);
    return { redeemed: true, kind: promo.kind, discountPct: promo.discountPct };
  }
}
