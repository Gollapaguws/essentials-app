import { prisma } from "@essentials/db";
import { AgentContextService } from "./agent-context.service";

jest.mock("@essentials/db", () => ({
  prisma: {
    user: { findUnique: jest.fn() },
    artistBooking: { count: jest.fn() },
    invoice: { count: jest.fn() },
    event: { count: jest.fn() },
    venue: { count: jest.fn() },
  },
}));

const db = prisma as unknown as {
  user: { findUnique: jest.Mock };
  artistBooking: { count: jest.Mock };
  invoice: { count: jest.Mock };
  event: { count: jest.Mock };
  venue: { count: jest.Mock };
};

const service = () => new AgentContextService();

/** A user row as the select in the service returns it. */
const user = (over: Record<string, unknown> = {}) => ({
  role: "guest",
  mustResetPassword: false,
  artistProfile: null,
  ...over,
});

beforeEach(() => {
  jest.resetAllMocks();
  db.user.findUnique.mockResolvedValue(user());
});

describe("AgentContextService", () => {
  it("gives a DJ their own gig, application and invoice counts", async () => {
    db.user.findUnique.mockResolvedValue(user({ role: "artist", artistProfile: { id: "artist-1" } }));
    db.artistBooking.count
      .mockResolvedValueOnce(2) // upcoming confirmed gigs
      .mockResolvedValueOnce(1); // pending applications
    db.invoice.count.mockResolvedValueOnce(3);

    const context = await service().for("user-1");

    expect(context.role).toBe("artist");
    expect(context.facts).toEqual({ upcoming_gigs: 2, pending_applications: 1, unpaid_invoices: 3 });
    expect(context.summary).toContain("2 upcoming confirmed gigs");
    expect(context.summary).toContain("3 invoices unpaid");
    expect(db.artistBooking.count).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ artistId: "artist-1", status: "confirmed" }) }),
    );
  });

  it("does not invent facts for a DJ who has not made a profile yet", async () => {
    db.user.findUnique.mockResolvedValue(user({ role: "artist" }));

    const context = await service().for("user-1");

    expect(context.facts).toEqual({});
    expect(context.summary).toBe("DJ account with no artist profile yet.");
    expect(context.states.has_artist_profile).toBe("no");
    expect(db.artistBooking.count).not.toHaveBeenCalled();
  });

  it("counts a promoter's upcoming nights and applications to decide", async () => {
    db.user.findUnique.mockResolvedValue(user({ role: "promoter" }));
    db.event.count.mockResolvedValueOnce(4);
    db.artistBooking.count.mockResolvedValueOnce(7);

    const context = await service().for("promoter-1");

    expect(context.facts).toEqual({ upcoming_events: 4, applications_to_decide: 7 });
    expect(context.summary).toBe(
      "Promoter. 4 upcoming events. 7 DJ applications to decide.",
    );
    expect(db.event.count).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ promoterId: "promoter-1" }) }),
    );
  });

  it("counts a venue manager's rooms and events waiting on them", async () => {
    db.user.findUnique.mockResolvedValue(user({ role: "venue_manager" }));
    db.venue.count.mockResolvedValueOnce(2);
    db.event.count.mockResolvedValueOnce(1);

    const context = await service().for("manager-1");

    expect(context.facts).toEqual({ venues_managed: 2, events_awaiting_approval: 1 });
    expect(context.summary).toBe("Venue manager. 2 venues managed. 1 event awaiting approval.");
    expect(db.event.count).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: "pending_venue_approval" }) }),
    );
  });

  it("keeps admins and visitors free of numbers", async () => {
    db.user.findUnique.mockResolvedValue(user({ role: "admin" }));
    expect((await service().for("admin-1")).facts).toEqual({});

    db.user.findUnique.mockResolvedValue(null);
    const guest = await service().for("gone");
    expect(guest).toMatchObject({
      role: "guest",
      facts: {},
      summary: "Visitor without a platform role.",
    });
    // A missing row must not be reported as a real "no".
    expect(guest.states.must_reset_password).toBe("no");
  });

  it("reports the states that explain a dashboard dead end", async () => {
    db.user.findUnique.mockResolvedValue(
      user({ role: "promoter", mustResetPassword: true }),
    );
    db.event.count.mockResolvedValueOnce(0);
    db.artistBooking.count.mockResolvedValueOnce(0);

    const context = await service().for("promoter-1", { mfaEnrolled: true });

    expect(context.states).toEqual({
      must_reset_password: "yes",
      has_artist_profile: "not_applicable",
      mfa_enrolled: "yes",
    });
  });

  it("says it does not know when the provider could not be asked about MFA", async () => {
    const context = await service().for("user-1");

    expect(context.states.mfa_enrolled).toBe("unknown");
  });
});
