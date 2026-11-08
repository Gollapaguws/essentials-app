import { Injectable } from "@nestjs/common";
import { prisma } from "@essentials/db";

export interface AgentContext {
  role: string;
  /** A one-line picture of the account, safe to send to the widget. */
  summary: string;
  facts: Record<string, number>;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * What the support agent is told about the signed-in account.
 *
 * It is deliberately small: a role, a line of counts and nothing that identifies
 * another person. The widget cannot query the database, so this is the only
 * live state the agent has — anything deeper has to come from the customer.
 */
@Injectable()
export class AgentContextService {
  async for(userId: string): Promise<AgentContext> {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    const role = user?.role ?? "guest";
    const facts = await this.facts(role, userId);
    return { role, facts, summary: this.summary(role, facts) };
  }

  private async facts(role: string, userId: string): Promise<Record<string, number>> {
    const now = new Date();

    if (role === "artist") {
      const profile = await prisma.artistProfile.findUnique({
        where: { userId },
        select: { id: true },
      });
      if (!profile) return {};
      const [gigs, applications, unpaid] = await Promise.all([
        prisma.artistBooking.count({
          where: { artistId: profile.id, status: "confirmed", startAt: { gte: now } },
        }),
        prisma.artistBooking.count({ where: { artistId: profile.id, status: "pending" } }),
        prisma.invoice.count({
          where: { artistId: profile.id, status: { in: ["sent", "overdue"] } },
        }),
      ]);
      return { upcoming_gigs: gigs, pending_applications: applications, unpaid_invoices: unpaid };
    }

    if (role === "promoter") {
      const [events, applications] = await Promise.all([
        prisma.event.count({
          where: {
            promoterId: userId,
            date: { gte: now },
            status: { in: ["approved", "live", "pending_venue_approval"] },
          },
        }),
        prisma.artistBooking.count({
          where: { status: "pending", event: { promoterId: userId } },
        }),
      ]);
      return { upcoming_events: events, applications_to_decide: applications };
    }

    if (role === "venue_manager") {
      const [venues, approvals] = await Promise.all([
        prisma.venue.count({ where: { managerId: userId } }),
        prisma.event.count({
          where: { status: "pending_venue_approval", venue: { managerId: userId } },
        }),
      ]);
      return { venues_managed: venues, events_awaiting_approval: approvals };
    }

    return {};
  }

  private summary(role: string, facts: Record<string, number>): string {
    switch (role) {
      case "artist":
        if (facts.upcoming_gigs === undefined) {
          return "DJ account with no artist profile yet.";
        }
        return [
          "DJ.",
          `${plural(facts.upcoming_gigs, "upcoming confirmed gig")}.`,
          `${plural(facts.pending_applications, "application")} awaiting a decision.`,
          `${plural(facts.unpaid_invoices, "invoice")} unpaid.`,
        ].join(" ");
      case "promoter":
        return [
          "Promoter.",
          `${plural(facts.upcoming_events, "upcoming event")}.`,
          `${plural(facts.applications_to_decide, "DJ application")} to decide.`,
        ].join(" ");
      case "venue_manager":
        return [
          "Venue manager.",
          `${plural(facts.venues_managed, "venue")} managed.`,
          `${plural(facts.events_awaiting_approval, "event")} awaiting approval.`,
        ].join(" ");
      case "admin":
        return "Platform administrator.";
      default:
        return "Visitor without a platform role.";
    }
  }
}
