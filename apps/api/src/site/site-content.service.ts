import { Injectable, BadRequestException, Logger } from "@nestjs/common";
import { ArtistBookingStatus, EventStatus, prisma } from "@essentials/db";
import { IsArray, IsIn, IsOptional, IsString, MaxLength, MinLength, validateSync } from "class-validator";

/** Editable front-page content schema (validated on save). */
export class FrontPageContent {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(300) tagline?: string;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(60) ctaLabel?: string;
  @IsOptional() @IsString() @MinLength(4) @MaxLength(40) city?: string;
  @IsOptional() @IsString() @MinLength(4) @MaxLength(120) quote?: string;
  @IsOptional() @IsString() @MaxLength(1200) manifestoP1?: string;
  @IsOptional() @IsString() @MaxLength(1200) manifestoP2?: string;
  @IsOptional() @IsArray() @MaxLength(50) events?: FrontPageEvent[];
  @IsOptional() @IsString() @MaxLength(120) footerLeft?: string;
  @IsOptional() @IsString() @MaxLength(120) footerRight?: string;
  @IsOptional() @IsArray() @MaxLength(20) heroSlides?: string[];
  @IsOptional() @IsArray() @MaxLength(20) visuals?: { src: string; label: string }[];
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

@Injectable()
export class SiteContentService {
  private readonly logger = new Logger(SiteContentService.name);

  async get(): Promise<FrontPageContent & { updatedAt: Date | null }> {
    const row = await prisma.siteContent.findUnique({ where: { key: KEY } });
    const value = (row?.value ?? {}) as Record<string, unknown>;
    const publishAt = value["lineupPublishAt"] as string | undefined;
    if (publishAt && new Date(publishAt) > new Date() && Array.isArray(value["events"])) {
      value["events"] = []; // scheduled drop — hidden until publish time
    }
    if (Array.isArray(value["events"])) {
      const lineup = await this.pruneLineup(value["events"] as Record<string, unknown>[]);
      value["events"] = await this.withArtists(lineup);
    }
    return { ...value, updatedAt: row?.updatedAt ?? null } as FrontPageContent & {
      updatedAt: Date | null;
    };
  }

  /**
   * The lineup is curated copy, but an entry that points at an event is only
   * shown while that event still exists, is announced and has not passed.
   * Without this, a deleted or cancelled night — or a QA event saved into the
   * array — stays on the front page forever, and duplicate ids show twice.
   * Entries with no eventId are hand-written announcements and always kept.
   */
  private async pruneLineup(events: Record<string, unknown>[]) {
    const ids = [
      ...new Set(
        events.map((e) => e["eventId"]).filter((id): id is string => typeof id === "string"),
      ),
    ];
    const live = ids.length
      ? await prisma.event.findMany({
          where: {
            id: { in: ids },
            status: { in: [EventStatus.approved, EventStatus.live] },
            date: { gte: new Date() },
          },
          select: { id: true },
        })
      : [];
    const liveIds = new Set(live.map((e) => e.id));
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
        artist: { select: { stageName: true } },
      },
      orderBy: { startAt: "asc" },
    });

    const byEvent = new Map<string, { name: string; time: string | null }[]>();
    for (const booking of bookings) {
      const list = byEvent.get(booking.eventId) ?? [];
      list.push({
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
