import { Injectable, NotFoundException } from "@nestjs/common";
import { prisma, EventStatus } from "@essentials/db";

/**
 * The one event surface a guest can read without a session. Email CTAs and the
 * public site link here, so a guest never lands on the promoter login.
 */
@Injectable()
export class PublicEventsService {
  private readonly live = [EventStatus.approved, EventStatus.live];

  async list() {
    const events = await prisma.event.findMany({
      where: { status: { in: this.live }, date: { gte: new Date() } },
      include: {
        venue: { select: { name: true, address: true } },
        _count: { select: { guestLists: { where: { status: { not: "waitlisted" } } } } },
      },
      orderBy: { date: "asc" },
      take: 50,
    });
    return events.map((e) => this.shape(e));
  }

  async detail(id: string) {
    const event = await prisma.event.findFirst({
      where: { id, status: { in: this.live } },
      include: {
        venue: { select: { name: true, address: true } },
        _count: { select: { guestLists: { where: { status: { not: "waitlisted" } } } } },
      },
    });
    if (!event) throw new NotFoundException("Event not found");
    return this.shape(event);
  }

  /** Only what a guest may see: no promoter, no guest list, no fees. */
  private shape(e: {
    id: string;
    title: string;
    description: string | null;
    date: Date;
    lineup: unknown;
    capacity: number;
    dressCode: string | null;
    ticketUrl: string | null;
    status: string;
    venue: { name: string; address: string | null };
    _count: { guestLists: number };
  }) {
    return {
      id: e.id,
      title: e.title,
      description: e.description,
      date: e.date,
      lineup: Array.isArray(e.lineup) ? e.lineup : [],
      capacity: e.capacity,
      dressCode: e.dressCode,
      ticketUrl: e.ticketUrl,
      status: e.status,
      venue: e.venue,
      going: e._count.guestLists,
    };
  }
}
