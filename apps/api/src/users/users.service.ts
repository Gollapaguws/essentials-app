import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { prisma, type Role } from "@essentials/db";
import { AuthUserService } from "../auth/auth-user.service";
import { ArtistsService } from "../artists/artists.service";
import { NotificationsService } from "../notifications/notifications.service";
import { TelegramService } from "../telegram/telegram.service";
import type { SetRoleDto, UpdateProfileDto } from "./users.dto";

/** Roles an admin may assign from the dashboard. */
export const ASSIGNABLE_ROLES: readonly Role[] = [
  "guest",
  "artist",
  "promoter",
  "venue_manager",
  "admin",
];

const USER_SELECT = {
  id: true,
  email: true,
  name: true,
  avatar: true,
  role: true,
  authUid: true,
  verifiedBadge: true,
  telegramChatId: true,
  createdAt: true,
  artistProfile: { select: { stageName: true } },
  managedVenues: {
    select: { id: true, name: true, capacity: true },
    orderBy: { createdAt: "desc" },
    take: 1,
  },
} as const;

interface UserRow {
  id: string;
  email: string;
  name: string | null;
  avatar: string | null;
  role: Role;
  authUid: string | null;
  verifiedBadge: boolean;
  telegramChatId: string | null;
  createdAt: Date;
  artistProfile: { stageName: string } | null;
  managedVenues: { id: string; name: string; capacity: number }[];
}

function shape(row: UserRow) {
  const { authUid, artistProfile, managedVenues, telegramChatId, ...rest } = row;
  return {
    ...rest,
    // `linked` = the person has signed in at least once (has a Supabase identity).
    linked: Boolean(authUid),
    telegram: Boolean(telegramChatId),
    stageName: artistProfile?.stageName ?? null,
    venue: managedVenues[0] ?? null,
  };
}

@Injectable()
export class UsersService {
  constructor(
    private readonly authUsers: AuthUserService,
    private readonly artists: ArtistsService,
    private readonly notifications: NotificationsService,
    private readonly telegram: TelegramService,
  ) {}

  /** Every registered account, newest first, optionally filtered by email/name. */
  async list(q?: string) {
    const search = q?.trim();
    const users = await prisma.user.findMany({
      where: search
        ? {
            OR: [
              { email: { contains: search, mode: "insensitive" } },
              { name: { contains: search, mode: "insensitive" } },
            ],
          }
        : undefined,
      orderBy: [{ createdAt: "desc" }],
      take: 500,
      select: USER_SELECT,
    });
    return users.map(shape);
  }

  /**
   * Promote/demote a user and, in the same call, create the profile the role
   * needs: a stage name for a DJ (`artist`), a venue for a `venue_manager`.
   */
  async setRole(id: string, dto: SetRoleDto) {
    const role = dto.role;
    if (!ASSIGNABLE_ROLES.includes(role)) {
      throw new BadRequestException(`Unknown role: ${role}`);
    }

    const existing = await prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, role: true, authUid: true },
    });
    if (!existing) throw new NotFoundException("User not found");

    // Validate and normalise everything before writing, so a rejected request
    // cannot leave a half-applied profile behind.
    const stageName = dto.stageName?.trim();
    let venuePlan: VenuePlan | null = null;
    if (role === "venue_manager" && dto.venueName?.trim()) {
      venuePlan = this.planVenue({
        name: dto.venueName,
        capacity: dto.venueCapacity,
        address: dto.venueAddress,
        lat: dto.venueLat,
        lng: dto.venueLng,
        requiringCapacity: true,
      });
    }

    if (role === "artist" && stageName) await this.saveStageName(id, stageName);
    if (venuePlan) await this.saveVenue(id, venuePlan);

    if (existing.role !== role) {
      await prisma.user.update({ where: { id }, data: { role } });

      // Drop the guard's cached role so the new role applies on the next request.
      this.authUsers.invalidate(existing.authUid);

      await prisma.authEvent
        .create({
          data: {
            kind: "role_change",
            userId: existing.id,
            email: existing.email,
            meta: { from: existing.role, to: role },
          },
        })
        .catch(() => undefined);

      // A new DJ is invited to the bot right away: gig calls and confirmations
      // then arrive as Telegram messages instead of sitting in the bell feed.
      if (role === "artist") {
        await this.inviteDjToTelegram(existing.id, stageName ?? null).catch(() => null);
      }
    }

    return shape(await prisma.user.findUniqueOrThrow({ where: { id }, select: USER_SELECT }));
  }

  /**
   * Edit or clear the profile behind an assigned role. `clearStageName` deletes
   * the artist profile; `clearVenue` detaches the venue (events and tables stay).
   */
  async updateProfile(id: string, dto: UpdateProfileDto) {
    const existing = await prisma.user.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw new NotFoundException("User not found");

    const stageName = dto.stageName?.trim();
    let venuePlan: VenuePlan | null = null;
    if (!dto.clearVenue && dto.venueName?.trim()) {
      venuePlan = this.planVenue({
        name: dto.venueName,
        capacity: dto.venueCapacity,
        address: dto.venueAddress,
        lat: dto.venueLat,
        lng: dto.venueLng,
        requiringCapacity: false,
      });
    }

    if (dto.clearStageName) {
      await prisma.artistProfile.deleteMany({ where: { userId: id } });
    } else if (stageName) {
      await this.saveStageName(id, stageName);
    }

    if (dto.clearVenue) {
      // Detach rather than delete: the venue keeps its events, tables and history.
      await prisma.venue.updateMany({ where: { managerId: id }, data: { managerId: null } });
    } else if (venuePlan) {
      await this.saveVenue(id, venuePlan);
    }

    return shape(await prisma.user.findUniqueOrThrow({ where: { id }, select: USER_SELECT }));
  }

  /** One-tap Telegram onboarding: a deep link that binds the DJ's chat. */
  private async inviteDjToTelegram(userId: string, stageName: string | null) {
    const label = stageName ?? "Your act";
    const { url } = await this.telegram.linkFor(userId).catch(() => ({ url: null as string | null }));

    if (!url) {
      await this.notifications.notify(
        userId,
        "telegram_onboarding",
        "Gig alerts go to your inbox",
        "The ESSENTIALS bot is not configured yet, so DJ calls and confirmations arrive by email. An admin can enable Telegram later.",
      );
      return;
    }

    await this.notifications.deliver([userId], {
      kind: "telegram_onboarding",
      title: "Bring DJ calls to Telegram",
      body: `${label} is on the ESSENTIALS roster. Connect Telegram once and DJ calls, gig confirmations and invoices arrive as messages. Open the link, then press Start.`,
      link: url,
      channels: ["inapp", "email", "telegram"],
    });
  }

  private planVenue(input: {
    name: string;
    capacity?: number;
    address?: string;
    lat?: number;
    lng?: number;
    requiringCapacity: boolean;
  }): VenuePlan {
    const name = input.name.trim();
    if (!name) throw new BadRequestException("Venue name cannot be empty.");
    if (input.requiringCapacity && input.capacity === undefined) {
      throw new BadRequestException("Venue capacity is required when creating a venue.");
    }
    return {
      name,
      capacity: input.capacity,
      address: input.address?.trim() || null,
      lat: input.lat,
      lng: input.lng,
    };
  }

  private async saveStageName(userId: string, stageName: string) {
    await prisma.artistProfile.upsert({
      where: { userId },
      update: { stageName },
      create: { userId, stageName },
    });
  }

  private async saveVenue(managerId: string, plan: VenuePlan) {
    const owned = await prisma.venue.findFirst({
      where: { managerId },
      orderBy: { createdAt: "desc" },
    });

    if (owned) {
      const moved =
        (plan.lat !== undefined && plan.lat !== owned.lat) ||
        (plan.lng !== undefined && plan.lng !== owned.lng);
      const updated = await prisma.venue.update({
        where: { id: owned.id },
        data: {
          name: plan.name,
          capacity: plan.capacity ?? owned.capacity,
          address: plan.address ?? owned.address,
          lat: plan.lat ?? owned.lat,
          lng: plan.lng ?? owned.lng,
        },
      });
      if (moved) await this.recomputeRoutes(updated.id);
      return;
    }

    if (plan.capacity === undefined) {
      throw new BadRequestException("Venue capacity is required when creating a venue.");
    }
    const created = await prisma.venue.create({
      data: {
        name: plan.name,
        capacity: plan.capacity,
        address: plan.address,
        lat: plan.lat ?? 0,
        lng: plan.lng ?? 0,
        managerId,
      },
    });
    await this.recomputeRoutes(created.id);
  }

  /** Venue coordinates drive DJ routing; a move invalidates the saved legs. */
  private async recomputeRoutes(venueId: string) {
    await this.artists.recomputeForVenue(venueId).catch(() => null);
  }
}

interface VenuePlan {
  name: string;
  capacity?: number;
  address: string | null;
  lat?: number;
  lng?: number;
}
