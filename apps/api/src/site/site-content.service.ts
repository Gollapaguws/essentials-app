import { Injectable, BadRequestException, Logger } from "@nestjs/common";
import { ArtistBookingStatus, EventStatus, prisma } from "@essentials/db";
import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, MaxLength, MinLength, validateSync } from "class-validator";

/** Editable front-page content schema (validated on save). */
export class FrontPageContent {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(300) tagline?: string;
  /** Longer hero paragraph; when set it replaces the tagline on the front page. */
  @IsOptional() @IsString() @MinLength(2) @MaxLength(900) heroPitch?: string;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(60) ctaLabel?: string;
  @IsOptional() @IsString() @MinLength(4) @MaxLength(40) city?: string;
  @IsOptional() @IsString() @MinLength(4) @MaxLength(120) quote?: string;
  @IsOptional() @IsString() @MaxLength(1200) manifestoP1?: string;
  @IsOptional() @IsString() @MaxLength(1200) manifestoP2?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(50) events?: FrontPageEvent[];
  @IsOptional() @IsString() @MaxLength(120) footerLeft?: string;
  @IsOptional() @IsString() @MaxLength(120) footerRight?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(20) heroSlides?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(20) visuals?: { src: string; label: string }[];
  /** Video reel looped in the front-page room box while no stream is live. */
  @IsOptional() @IsString() @MaxLength(500) idleLoop?: string;
  @IsOptional() @IsString() @MaxLength(30) lineupPublishAt?: string;
}

class FrontPageEvent {
  @IsString() @MinLength(2) @MaxLength(120) title!: string;
  @IsString() @MinLength(2) @MaxLength(60) displayDate!: string;
  @IsString() @MinLength(2) @MaxLength(60) city!: string;
  @IsString() @MinLength(2) @MaxLength(80) venue!: string;
  @IsString() @MinLength(2) @MaxLength(20) doors!: string;
  @IsString() @MinLength(2) @MaxLength(30) price!: string;
  @IsOptional() @IsIn(["ANNOUNCED", "SELLING FAST", "SOLD OUT", "FREE"]) status?: string;
}

const KEY = "front_page";
// Doors and dates on the front page are club-local time, never server UTC.
const TZ = "Africa/Johannesburg";

@Injectable()
export class SiteContentService {
  private readonly logger = new Logger(SiteContentService.name);

  async get(): Promise<FrontPageContent & { updatedAt: Date | null }> {
    const row = await prisma.siteContent.findUnique({ where: { key: KEY } });
    const value = { ...((row?.value ?? {}) as Record<string, unknown>) };
    const publishAt = value["lineupPublishAt"] as string | undefined;
    if (publishAt && new Date(publishAt) > new Date()) {
      value["events"] = []; // scheduled drop — hidden until publish time
      return { ...value, updatedAt: row?.updatedAt ?? null } as FrontPageContent & {
        updatedAt: Date | null;
      };
    }

    // Curated copy first (it carries the promoter's wording and order), then
    // every announced night that nobody has written up yet, so confirming an
    // event in the dashboard is enough to put it on the front page.
    const curated = Array.isArray(value["events"])
      ? (value["events"] as Record<string, unknown>[])
      : [];
    const announced = await this.announcedEvents();
    const pruned = this.pruneLineup(
      curated,
      new Set(announced.map((e) => e.id)),
    );
    const listed = new Set(
      pruned.map((e) => e["eventId"]).filter((id): id is string => typeof id === "string"),
    );
    const auto = announced
      .filter((e) => !listed.has(e.id))
      .map((e) => this.autoEntry(e));

    value["events"] = await this.withArtists([...pruned, ...auto]);
    return { ...value, updatedAt: row?.updatedAt ?? null } as FrontPageContent & {
      updatedAt: Date | null;
    };
  }

  /** Every confirmed night still ahead of us, soonest first. */
  private announcedEvents() {
    return prisma.event.findMany({
      where: { status: { in: [EventStatus.approved, EventStatus.live] }, date: { gte: new Date() } },
      select: {
        id: true,
        title: true,
        date: true,
        status: true,
        venue: { select: { name: true, address: true } },
      },
      orderBy: { date: "asc" },
      take: 50,
    });
  }

  /** The card fields the front page reads, built from the event itself. */
  private autoEntry(e: {
    id: string;
    title: string;
    date: Date;
    status: string;
    venue: { name: string; address: string | null };
  }) {
    const day = new Intl.DateTimeFormat("en-ZA", {
      weekday: "short",
      day: "numeric",
      month: "short",
      timeZone: TZ,
    })
      .format(e.date)
      .replace(/[,\u00a0]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toUpperCase();
    const doors = new Intl.DateTimeFormat("en-ZA", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: TZ,
    }).format(e.date);
    // `12 Albert Rd, Woodstock, Cape Town, 8001` → "Cape Town"; the venue has no
    // separate city column, so the address tail is the best a card can show,
    // minus a trailing postal code.
    const city =
      (e.venue.address ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s && !/^\d[\d\s-]*$/.test(s))
        .pop() ?? "";
    return {
      eventId: e.id,
      title: e.title,
      displayDate: day,
      city,
      venue: e.venue.name,
      doors,
      status: e.status === EventStatus.live ? "LIVE" : "ANNOUNCED",
    };
  }

  /**
   * The lineup is curated copy, but an entry that points at an event is only
   * shown while that event still exists, is announced and has not passed.
   * Without this, a deleted or cancelled night — or a QA event saved into the
   * array — stays on the front page forever, and duplicate ids show twice.
   * Entries with no eventId are hand-written announcements and always kept.
   */
  private pruneLineup(events: Record<string, unknown>[], liveIds: Set<string>) {
    const seen = new Set<string>();
    return events.filter((entry) => {
      const id = entry["eventId"];
      if (typeof id !== "string") return true;
      if (!liveIds.has(id) || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }

  /**
   * A confirmed DJ is public: the night's lineup and the time they play.
   * Attached at read time so a confirmation (or a cancellation) shows up
   * without anyone re-saving the curated front page.
   */
  private async withArtists(events: Record<string, unknown>[]) {
    const ids = events
      .map((e) => e["eventId"])
      .filter((id): id is string => typeof id === "string");
    if (!ids.length) return events;

    const bookings = await prisma.artistBooking.findMany({
      where: { eventId: { in: ids }, status: ArtistBookingStatus.confirmed },
      select: {
        eventId: true,
        slot: true,
        slotRef: { select: { label: true } },
        artist: { select: { id: true, stageName: true } },
      },
      orderBy: { startAt: "asc" },
    });

    const byEvent = new Map<string, { id: string; name: string; time: string | null }[]>();
    for (const booking of bookings) {
      const list = byEvent.get(booking.eventId) ?? [];
      list.push({
        id: booking.artist.id,
        name: booking.artist.stageName,
        time: booking.slotRef?.label ?? booking.slot ?? null,
      });
      byEvent.set(booking.eventId, list);
    }

    return events.map((entry) => {
      const id = entry["eventId"];
      const artists = typeof id === "string" ? byEvent.get(id) : undefined;
      return artists?.length ? { ...entry, artists } : entry;
    });
  }

  async save(input: FrontPageContent) {
    const errors = validateSync(input);
    if (errors.length) {
      throw new BadRequestException(errors.map((e) => Object.values(e.constraints ?? {})).flat());
    }
    const existing = await prisma.siteContent.findUnique({ where: { key: KEY } });
    const merged = { ...((existing?.value as object) ?? {}), ...input };
    const row = await prisma.siteContent.upsert({
      where: { key: KEY },
      update: { value: merged as object },
      create: { key: KEY, value: merged as object },
    });
    return { ok: true, value: row.value, updatedAt: row.updatedAt };
  }

  reset() {
    return prisma.siteContent.deleteMany({ where: { key: KEY } });
  }
}
