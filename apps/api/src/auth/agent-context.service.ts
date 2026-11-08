import { Injectable } from "@nestjs/common";
import { prisma } from "@essentials/db";

/** Yes/no states, written out because the agent reads them as words, not flags. */
export type AgentState = "yes" | "no" | "unknown" | "not_applicable";

export interface AgentContext {
  role: string;
  /** A one-line picture of the account, safe to send to the widget. */
  summary: string;
  facts: Record<string, number>;
  /** Why the account is behaving as it is — the answers to most sign-in tickets. */
  states: Record<string, AgentState>;
}

/** Set by the caller, which is the only place holding the session's access token. */
export interface AgentContextOptions {
  /** `undefined` when the identity provider could not be asked. */
  mfaEnrolled?: boolean;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * What the support agent is told about the signed-in account.
 *
 * It is deliberately small: a role, a line of counts, and a handful of yes/no
 * states that explain the common dead ends (a password that was never chosen, a
 * DJ role with no profile yet). It never carries anything about another person.
 * The widget cannot query the database, so this is the only live state the agent
 * has — anything deeper has to come from the customer.
 */
@Injectable()
export class AgentContextService {
  async for(userId: string, options: AgentContextOptions = {}): Promise<AgentContext> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        role: true,
        mustResetPassword: true,
        artistProfile: { select: { id: true } },
      },
    });
    const role = user?.role ?? "guest";
    const profileId = user?.artistProfile?.id ?? null;
    const facts = await this.facts(role, userId, profileId);

    return {
      role,
      facts,
      summary: this.summary(role, facts),
      states: {
        must_reset_password: user?.mustResetPassword ? "yes" : "no",
        // Only meaningful for a DJ: the other roles have no artist profile by design.
        has_artist_profile: role === "artist" ? (profileId ? "yes" : "no") : "not_applicable",
        mfa_enrolled:
          options.mfaEnrolled === undefined ? "unknown" : options.mfaEnrolled ? "yes" : "no",
      },
    };
  }

  private async facts(
    role: string,
    userId: string,
    profileId: string | null,
  ): Promise<Record<string, number>> {
    const now = new Date();

    if (role === "artist") {
      if (!profileId) return {};
      const [gigs, applications, unpaid] = await Promise.all([
        prisma.artistBooking.count({
          where: { artistId: profileId, status: "confirmed", startAt: { gte: now } },
        }),
        prisma.artistBooking.count({ where: { artistId: profileId, status: "pending" } }),
        prisma.invoice.count({
          where: { artistId: profileId, status: { in: ["sent", "overdue"] } },
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
