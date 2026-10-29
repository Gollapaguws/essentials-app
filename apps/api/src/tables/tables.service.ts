import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from "@nestjs/common";
import { prisma, TableBookingStatus } from "@essentials/db";
import type { JwtUser } from "../common/roles.guard";

@Injectable()
export class TablesService {
  /** Venue inventory available for an event. */
  async inventory(eventId: string) {
    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new NotFoundException("Event not found");
    const tables = await prisma.venueTable.findMany({ where: { venueId: event.venueId } });
    const booked = await prisma.tableBooking.findMany({
      where: { eventId, status: { in: [TableBookingStatus.pending, TableBookingStatus.confirmed, TableBookingStatus.seated] } },
      select: { venueTableId: true },
    });
    const taken = new Set(booked.map((b) => b.venueTableId));
    return tables.map((t) => ({ ...t, available: !taken.has(t.id) }));
  }

  /** Guests reserve a VIP table; tracked per promoter for attribution & splits. */
  async book(user: JwtUser, data: { eventId: string; venueTableId: string; bottleServiceNotes?: string; sourceCampaignId?: string }) {
    const event = await prisma.event.findUnique({ where: { id: data.eventId } });
    if (!event) throw new NotFoundException("Event not found");
    const table = await prisma.venueTable.findUnique({ where: { id: data.venueTableId } });
    if (!table || table.venueId !== event.venueId) throw new NotFoundException("Table not found");

    const clash = await prisma.tableBooking.findFirst({
      where: {
        venueTableId: data.venueTableId,
        eventId: data.eventId,
        status: { in: [TableBookingStatus.pending, TableBookingStatus.confirmed, TableBookingStatus.seated] },
      },
    });
    if (clash) throw new BadRequestException("Table already reserved for this event");

    return prisma.tableBooking.create({
      data: {
        eventId: data.eventId,
        userId: user.sub,
        promoterId: event.promoterId,
        venueTableId: table.id,
        tableNumber: table.tableNumber,
        bottleServiceNotes: data.bottleServiceNotes,
        value: table.minSpend,
        venueRevenuePct: 100 - event.revenueSplitPromoterPct,
        sourceCampaignId: data.sourceCampaignId,
      },
    });
  }

  /** Promoter: bookings for their events. */
  async listForPromoter(user: JwtUser, eventId?: string) {
    if (user.role !== "promoter" && user.role !== "admin") throw new ForbiddenException();
    return prisma.tableBooking.findMany({
      where: { ...(eventId ? { eventId } : {}), ...(user.role === "admin" ? {} : { promoterId: user.sub }) },
      include: { user: { select: { name: true, email: true } }, event: { select: { title: true } } },
      orderBy: { createdAt: "desc" },
    });
  }

  async updateStatus(user: JwtUser, id: string, status: TableBookingStatus) {
    const booking = await prisma.tableBooking.findUnique({ where: { id } });
    if (!booking) throw new NotFoundException("Booking not found");
    if (user.role !== "admin" && booking.promoterId !== user.sub) throw new ForbiddenException();
    return prisma.tableBooking.update({ where: { id }, data: { status } });
  }
}
