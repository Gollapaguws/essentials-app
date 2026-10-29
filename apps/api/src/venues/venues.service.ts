import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from "@nestjs/common";
import { prisma, EventStatus } from "@essentials/db";
import type { JwtUser } from "../common/roles.guard";

/** Phase 2 venue portal backend. All queries scoped: managers see only their venues; admin all. */
@Injectable()
export class VenuesService {
  private async assertManager(venueId: string, user: JwtUser) {
    const venue = await prisma.venue.findUnique({ where: { id: venueId } });
    if (!venue) throw new NotFoundException("Venue not found");
    if (user.role !== "admin" && venue.managerId !== user.sub) throw new ForbiddenException("Not your venue");
    return venue;
  }

  async myVenues(user: JwtUser) {
    return prisma.venue.findMany({
      where: user.role === "admin" ? {} : { managerId: user.sub },
      include: { _count: { select: { events: true, tables: true } } },
    });
  }

  /** Event approval workflow: pending_venue_approval -> approved | draft(rejected). */
  async pendingEvents(user: JwtUser, venueId?: string) {
    return prisma.event.findMany({
      where: {
        status: EventStatus.pending_venue_approval,
        ...(user.role === "admin" ? {} : { venue: { managerId: user.sub } }),
        ...(venueId ? { venueId } : {}),
      },
      include: { venue: { select: { name: true } }, promoter: { select: { name: true } } },
      orderBy: { date: "asc" },
    });
  }

  async decideEvent(user: JwtUser, eventId: string, approve: boolean) {
    const event = await prisma.event.findUnique({ where: { id: eventId }, include: { venue: true } });
    if (!event) throw new NotFoundException("Event not found");
    if (user.role !== "admin" && event.venue.managerId !== user.sub) throw new ForbiddenException();
    if (event.status !== EventStatus.pending_venue_approval) throw new BadRequestException("Event is not pending approval");
    return prisma.event.update({
      where: { id: eventId },
      data: { status: approve ? EventStatus.approved : EventStatus.draft },
    });
  }

  /** Table inventory management. */
  async listTables(user: JwtUser, venueId: string) {
    await this.assertManager(venueId, user);
    return prisma.venueTable.findMany({ where: { venueId }, orderBy: { tableNumber: "asc" } });
  }

  async upsertTable(user: JwtUser, venueId: string, data: { tableNumber: string; capacity: number; minSpend: number }) {
    await this.assertManager(venueId, user);
    return prisma.venueTable.upsert({
      where: { venueId_tableNumber: { venueId, tableNumber: data.tableNumber } },
      update: { capacity: data.capacity, minSpend: data.minSpend },
      create: { venueId, ...data },
    });
  }

  async deleteTable(user: JwtUser, venueId: string, tableNumber: string) {
    await this.assertManager(venueId, user);
    const table = await prisma.venueTable.findUnique({ where: { venueId_tableNumber: { venueId, tableNumber } } });
    if (!table) throw new NotFoundException("Table not found");
    const booked = await prisma.tableBooking.findFirst({
      where: { venueTableId: table.id, status: { in: ["pending", "confirmed", "seated"] } },
    });
    if (booked) throw new BadRequestException("Table has active bookings");
    await prisma.venueTable.delete({ where: { id: table.id } });
    return { ok: true };
  }

  /** Staff/door ops monitor: recent scans for the venue's events. */
  async doorLogs(user: JwtUser, venueId: string) {
    await this.assertManager(venueId, user);
    return prisma.doorLog.findMany({
      where: { venueId },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  }

  /** Venue analytics incl. revenue splits (venue vs promoter on tables). */
  async analytics(user: JwtUser, venueId: string) {
    await this.assertManager(venueId, user);
    const events = await prisma.event.findMany({
      where: { venueId },
      include: { guestLists: true, tableBookings: true },
      orderBy: { date: "desc" },
    });

    const perEvent = events.map((e) => {
      const tableRevenue = e.tableBookings.reduce((s, b) => s + b.value, 0);
      const venueTake = e.tableBookings.reduce((s, b) => s + Math.round((b.value * b.venueRevenuePct) / 100), 0);
      return {
        name: e.title,
        date: e.date,
        status: e.status,
        rsvps: e.guestLists.length,
        checkedIn: e.guestLists.filter((g) => g.status === "checked_in").length,
        tableRevenue,
        venueRevenue: venueTake,
        promoterRevenue: tableRevenue - venueTake,
      };
    });

    return {
      totals: {
        events: events.length,
        rsvps: perEvent.reduce((s, e) => s + e.rsvps, 0),
        checkedIn: perEvent.reduce((s, e) => s + e.checkedIn, 0),
        tableRevenue: perEvent.reduce((s, e) => s + e.tableRevenue, 0),
        venueRevenue: perEvent.reduce((s, e) => s + e.venueRevenue, 0),
      },
      perEvent,
    };
  }
}
