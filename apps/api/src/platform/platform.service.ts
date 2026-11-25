import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { ArtistBookingStatus, EventStatus, prisma, type Role } from "@essentials/db";
import type { JwtUser } from "../common/roles.guard";

export interface OrganisationSummary {
  id: string;
  name: string;
  slug: string;
  kind: string;
}

export interface MemberOrganisation extends OrganisationSummary {
  role: Role;
}

/** First-run checklist for a new customer workspace. */
export interface PromoterOnboarding {
  organisation: Pick<OrganisationSummary, "id" | "name" | "slug"> | null;
  steps: {
    venue: boolean;
    event: boolean;
    slots: boolean;
    lineup: boolean;
  };
  complete: boolean;
}

interface CacheEntry {
  organisations: MemberOrganisation[];
  expires: number;
}

/** A platform-wide workspace for administrators and rows with no customer owner. */
const PLATFORM_ORG_SLUG = "sonus";
const CACHE_TTL_MS = 60_000;

/**
 * Tenancy for promoters using the platform as a service.
 *
 * A membership is the source of truth for which workspace a signed-in person may
 * act in. The guard asks this service once per request (memoised per process for
 * a minute) and puts `orgId` on the request; feature services scope their writes
 * and reads to it. Administrators fall back to the platform workspace, so the
 * existing single-operator console keeps working.
 */
@Injectable()
export class PlatformService {
  private readonly cache = new Map<string, CacheEntry>();

  /** Workspaces this account belongs to. Cached briefly because every request asks. */
  async organisationsFor(userId: string): Promise<MemberOrganisation[]> {
    const hit = this.cache.get(userId);
    if (hit && hit.expires > Date.now()) return hit.organisations;

    const rows = await prisma.membership.findMany({
      where: { userId },
      include: { organisation: true },
      orderBy: { createdAt: "asc" },
    });
    const organisations = rows.map((row) => ({
      id: row.organisation.id,
      name: row.organisation.name,
      slug: row.organisation.slug,
      kind: row.organisation.kind,
      role: row.role,
    }));
    this.cache.set(userId, { organisations, expires: Date.now() + CACHE_TTL_MS });
    return organisations;
  }

  /**
   * The workspace this request acts in. A client may pick one with `x-org-id`;
   * an id the person is not a member of is ignored rather than trusted.
   */
  async activeOrgId(
    userId: string,
    role: Role,
    email: string,
    requested?: string,
  ): Promise<string | null> {
    const organisations = await this.organisationsFor(userId);
    if (requested) {
      if (organisations.some((org) => org.id === requested)) return requested;
      // Admins administer every workspace, so they may inspect one they are not
      // a member of. A bogus id simply scopes reads to nothing.
      if (role === "admin") return requested;
    }

    // A promoter may also hold staff access to the platform workspace. Their
    // customer workspace is the meaningful default, not whichever membership
    // happened to be created first.
    if (role === "promoter") {
      const customer = organisations.find((org) => org.kind === "promoter");
      if (customer) return customer.id;
      return (await this.personalOrganisation(userId, email)).id;
    }

    if (role === "admin") {
      const platform = organisations.find((org) => org.kind === "platform");
      return platform?.id ?? (await this.platformOrganisation()).id;
    }

    return organisations[0]?.id ?? null;
  }

  /** What the console needs to render a workspace switcher, if it ever has one. */
  async context(userId: string, role: Role, email: string, requested?: string) {
    const memberships = await this.organisationsFor(userId);
    const activeId = await this.activeOrgId(userId, role, email, requested);
    const organisations: MemberOrganisation[] =
      role === "admin"
        ? (await this.listAll()).map((org) => ({
            id: org.id,
            name: org.name,
            slug: org.slug,
            kind: org.kind,
            role: "admin" as Role,
          }))
        : memberships;
    const active =
      organisations.find((org) => org.id === activeId) ??
      memberships.find((org) => org.id === activeId) ??
      null;
    return { active, organisations };
  }

  /**
   * What a new promoter has set up so far. Counts use the same workspace-or-owner
   * union as the feature services, so legacy rows count for their creator and a
   * checklist tick can never disagree with the page it links to.
   */
  async onboarding(user: JwtUser): Promise<PromoterOnboarding> {
    if (user.role !== "promoter") {
      throw new ForbiddenException("Onboarding is for promoter workspaces.");
    }

    const orgId = user.orgId ?? null;
    const eventScope = orgId
      ? { OR: [{ orgId }, { promoterId: user.sub }] }
      : { promoterId: user.sub };
    const venueScope = orgId
      ? { OR: [{ orgId }, { managerId: user.sub }] }
      : { managerId: user.sub };

    const [organisation, venues, events, eventsWithSlots, confirmedBookings] = await Promise.all([
      orgId
        ? prisma.organisation.findUnique({
            where: { id: orgId },
            select: { id: true, name: true, slug: true },
          })
        : null,
      prisma.venue.count({ where: venueScope }),
      prisma.event.count({ where: eventScope }),
      prisma.event.count({
        where: {
          AND: [
            eventScope,
            { slots: { some: {} }, status: { not: EventStatus.cancelled } },
          ],
        },
      }),
      prisma.artistBooking.count({
        where: {
          status: { in: [ArtistBookingStatus.confirmed, ArtistBookingStatus.completed] },
          event: eventScope,
        },
      }),
    ]);

    const steps = {
      // Creating a night also counts: the event form picks an existing room when
      // the promoter does not run their own.
      venue: venues > 0 || events > 0,
      event: events > 0,
      slots: eventsWithSlots > 0,
      lineup: confirmedBookings > 0,
    };

    return {
      organisation,
      steps,
      complete: Object.values(steps).every(Boolean),
    };
  }

  /** Admin: every customer workspace, with enough detail to see who is on it. */
  async listAll() {
    return prisma.organisation.findMany({
      orderBy: [{ kind: "asc" }, { createdAt: "asc" }],
      include: { _count: { select: { members: true, events: true } } },
    });
  }

  /** Admin: create a workspace before (or after) its promoter account exists. */
  async createOrganisation(name: string): Promise<OrganisationSummary> {
    const clean = name.trim();
    if (!clean) throw new BadRequestException("An organisation needs a name.");

    const base =
      clean
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 50) || "org";

    for (let attempt = 1; attempt <= 50; attempt++) {
      const slug = attempt === 1 ? base : `${base}-${attempt}`;
      try {
        return await prisma.organisation.create({
          data: { name: clean, slug, kind: "promoter" },
        });
      } catch (err) {
        if (isUniqueViolation(err)) continue;
        throw err;
      }
    }
    throw new BadRequestException("Could not allocate a unique organisation slug.");
  }

  /**
   * Put an existing account into a workspace. The membership role mirrors the
   * account's platform role for now; changing one without the other would let a
   * guest inherit a promoter's workspace access, so it is refused.
   */
  async addMember(orgId: string, email: string, role: Role) {
    const [org, user] = await Promise.all([
      prisma.organisation.findUnique({ where: { id: orgId } }),
      prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } }),
    ]);
    if (!org) throw new NotFoundException("Organisation not found");
    if (!user) throw new NotFoundException("Account not found");
    if (user.role !== role) {
      throw new BadRequestException(
        `Set the account's platform role to ${role} before adding it to this organisation.`,
      );
    }

    const membership = await prisma.membership.upsert({
      where: { orgId_userId: { orgId, userId: user.id } },
      update: { role },
      create: { orgId, userId: user.id, role },
    });
    this.invalidate(user.id);
    return { membership, organisation: org, user: { id: user.id, email: user.email } };
  }

  async removeMember(orgId: string, userId: string) {
    const org = await prisma.organisation.findUnique({ where: { id: orgId } });
    if (!org) throw new NotFoundException("Organisation not found");
    const { count } = await prisma.membership.deleteMany({ where: { orgId, userId } });
    this.invalidate(userId);
    return { ok: true, removed: count };
  }

  async members(orgId: string) {
    const org = await prisma.organisation.findUnique({ where: { id: orgId } });
    if (!org) throw new NotFoundException("Organisation not found");
    const rows = await prisma.membership.findMany({
      where: { orgId },
      orderBy: { createdAt: "asc" },
      include: { user: { select: { id: true, email: true, name: true, role: true } } },
    });
    return {
      organisation: org,
      members: rows.map((row) => ({
        userId: row.user.id,
        email: row.user.email,
        name: row.user.name,
        role: row.role,
        platformRole: row.user.role,
        joinedAt: row.createdAt,
      })),
    };
  }

  /**
   * Called when an admin provisions an account. An organisation is optional for
   * a promoter (one is made from their email); admins and staff join the SONUS
   * workspace. Guests and DJs need no workspace of their own.
   */
  async attachNewUser(
    userId: string,
    email: string,
    role: Role,
    organisationName?: string,
  ): Promise<OrganisationSummary | null> {
    const existing = await this.organisationsFor(userId);

    // Re-running provisioning must not make a second customer workspace. A
    // person promoted from staff may already have the platform workspace, which
    // does not count as their promoter workspace.
    if (role === "promoter") {
      const current = existing.find((org) => org.kind === "promoter");
      if (current) return current;

      const name =
        organisationName?.trim() ||
        `${email.split("@")[0]?.replace(/[._-]+/g, " ") || "Promoter"} Presents`;
      const org = await this.createOrganisation(name);
      await this.addMembership(org.id, userId, role);
      return org;
    }

    if (role === "admin" || role === "venue_manager" || role === "door") {
      const org = await this.platformOrganisation();
      await this.addMembership(org.id, userId, role);
      return org;
    }

    return null;
  }

  /** Drop the cached membership list after a change, in this process. */
  invalidate(userId?: string): void {
    if (userId) this.cache.delete(userId);
    else this.cache.clear();
  }

  private async addMembership(orgId: string, userId: string, role: Role) {
    await prisma.membership.upsert({
      where: { orgId_userId: { orgId, userId } },
      update: { role },
      create: { orgId, userId, role },
    });
    this.invalidate(userId);
  }

  /** A promoter's own workspace, created on first authenticated request if needed. */
  private async personalOrganisation(userId: string, email: string) {
    const slug = `promoter-${userId}`;
    const existing = await prisma.organisation.findUnique({ where: { slug } });
    if (existing) {
      await this.addMembership(existing.id, userId, "promoter");
      return existing;
    }

    const localpart = email.split("@")[0]?.replace(/[._-]+/g, " ") || "Promoter";
    try {
      const created = await prisma.organisation.create({
        data: { name: `${localpart} Presents`, slug, kind: "promoter" },
      });
      await this.addMembership(created.id, userId, "promoter");
      return created;
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      const raced = await prisma.organisation.findUnique({ where: { slug } });
      if (!raced) throw err;
      await this.addMembership(raced.id, userId, "promoter");
      return raced;
    }
  }

  /** The platform's own workspace, used by admins and unowned rows. */
  async platformOrganisation(): Promise<OrganisationSummary> {
    const existing = await prisma.organisation.findUnique({ where: { slug: PLATFORM_ORG_SLUG } });
    if (existing) return existing;

    try {
      return await prisma.organisation.create({
        data: { id: "org-sonus", name: "SONUS", slug: PLATFORM_ORG_SLUG, kind: "platform" },
      });
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      const raced = await prisma.organisation.findUnique({ where: { slug: PLATFORM_ORG_SLUG } });
      if (!raced) throw err;
      return raced;
    }
  }
}

function isUniqueViolation(err: unknown): boolean {
  return Boolean(err && typeof err === "object" && (err as { code?: string }).code === "P2002");
}
