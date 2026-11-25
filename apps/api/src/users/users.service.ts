import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { randomBytes } from "crypto";
import { prisma, type Role } from "@essentials/db";
import { AuthUserService } from "../auth/auth-user.service";
import { SupabaseAdminService } from "../auth/supabase-admin.service";
import { DashboardSessionService } from "../auth/dashboard-session.service";
import { ArtistsService } from "../artists/artists.service";
import { NotificationsService } from "../notifications/notifications.service";
import { AccountMailService } from "../account-mail/account-mail.service";
import { PlatformService } from "../platform/platform.service";
import { pageArgs, parsePaging, type Paging } from "../common/paging";
import { TelegramService } from "../telegram/telegram.service";
import type { CreateUserDto, SetRoleDto, UpdateProfileDto } from "./users.dto";

/** Roles an admin may assign from the dashboard. */
export const ASSIGNABLE_ROLES: readonly Role[] = [
  "guest",
  "artist",
  "promoter",
  "venue_manager",
  "door",
  "admin",
];

const USER_SELECT = {
  id: true,
  email: true,
  name: true,
  avatar: true,
  role: true,
  authUid: true,
  mfaDisabled: true,
  verifiedBadge: true,
  telegramChatId: true,
  createdAt: true,
  artistProfile: { select: { stageName: true } },
  mailbox: { select: { address: true, status: true } },
  managedVenues: {
    select: { id: true, name: true, capacity: true },
    orderBy: { createdAt: "desc" },
    take: 1,
  },
  memberships: {
    select: { role: true, organisation: { select: { id: true, name: true, slug: true } } },
    orderBy: { createdAt: "asc" },
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
  mfaDisabled: boolean;
  verifiedBadge: boolean;
  telegramChatId: string | null;
  createdAt: Date;
  artistProfile: { stageName: string } | null;
  mailbox: { address: string; status: string } | null;
  managedVenues: { id: string; name: string; capacity: number }[];
  memberships: {
    role: Role;
    organisation: { id: string; name: string; slug: string };
  }[];
}

/** A temporary password that satisfies the platform's upper/lower/digit rule. */
function temporaryPassword(): string {
  return `Aa1${randomBytes(9).toString("base64url")}`;
}

function shape(row: UserRow) {
  const { authUid, artistProfile, managedVenues, memberships, telegramChatId, ...rest } = row;
  return {
    ...rest,
    // `linked` = the person has signed in at least once (has a Supabase identity).
    linked: Boolean(authUid),
    telegram: Boolean(telegramChatId),
    stageName: artistProfile?.stageName ?? null,
    venue: managedVenues[0] ?? null,
    organisation: memberships[0]?.organisation ?? null,
    organisationRole: memberships[0]?.role ?? null,
  };
}

/** Who performed an admin action; recorded on the account's security trail. */
export interface AdminActor {
  id?: string | null;
  email: string;
}

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly authUsers: AuthUserService,
    private readonly artists: ArtistsService,
    private readonly notifications: NotificationsService,
    private readonly telegram: TelegramService,
    private readonly admin: SupabaseAdminService,
    private readonly sessions: DashboardSessionService,
    private readonly accountMail: AccountMailService,
    private readonly platform: PlatformService,
  ) {}

  /**
   * Provision an account on someone's behalf: a Supabase identity with a
   * temporary password, the Prisma row that carries the role, and the reset flag
   * that forces the owner to pick their own password on first sign-in.
   */
  async create(dto: CreateUserDto) {
    const email = dto.email.trim().toLowerCase();
    const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) throw new ConflictException(`${email} already has an account.`);

    const role = dto.role ?? "guest";
    if (!ASSIGNABLE_ROLES.includes(role)) {
      throw new BadRequestException(`Unknown role: ${role}`);
    }

    // Validate the profile payload before creating the identity, so a bad venue
    // cannot leave an orphaned Supabase user behind.
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

    const initialPassword = dto.password?.trim() || temporaryPassword();
    const authUid = await this.admin.createUser(email, initialPassword);

    let userId: string;
    try {
      const created = await prisma.user.create({
        data: { email, authUid, role, mustResetPassword: true },
      });
      userId = created.id;
    } catch (err) {
      // No half-provisioned identity: the Supabase user goes back if the row fails.
      await this.admin.deleteUser(authUid).catch(() => null);
      throw err;
    }

    if (role === "artist" && stageName) await this.saveStageName(userId, stageName);
    if (venuePlan) await this.saveVenue(userId, venuePlan);

    await prisma.authEvent
      .create({
        data: {
          kind: "account_created",
          userId,
          email,
          meta: { role, provisioned: true },
        },
      })
      .catch(() => undefined);

    // The workspace is part of onboarding, but a hiccup there must not leave a
    // signed-in account stranded: first use creates a default one if needed.
    await this.platform
      .attachNewUser(userId, email, role, dto.organisationName)
      .catch((err: unknown) =>
        this.logger.warn(`organisation not created for ${email}: ${(err as Error).message}`),
      );

    // Best-effort: the account exists even if the relay does not take the notice.
    void this.accountMail.send(email, { kind: "account-created", role });

    return {
      user: shape(await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: USER_SELECT })),
      // Shown once, in the admin UI, so the admin can pass it on.
      temporaryPassword: initialPassword,
    };
  }

  /**
   * Unlock an account that lost its authenticator or password: clear every
   * second factor, set a temporary password, and sign the account out everywhere.
   * The owner picks their own password and enrolls a new authenticator next time.
   */
  async resetSignIn(id: string, actor?: AdminActor) {
    const existing = await prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, authUid: true },
    });
    if (!existing) throw new NotFoundException("User not found");
    if (!existing.authUid) {
      throw new BadRequestException(
        `${existing.email} has never signed in, so it has no credentials to reset.`,
      );
    }

    const initialPassword = temporaryPassword();
    const factors = await this.admin.listFactors(existing.authUid);

    // Password first: if a factor cannot be removed, the admin can retry and the
    // account is still no worse off than before. A partial reset never strands
    // someone with a lost authenticator and no way back in.
    await this.admin.setPassword(existing.authUid, initialPassword);
    for (const factor of factors) await this.admin.deleteFactor(existing.authUid, factor.id);

    // Recovery codes are second-factor credentials too: leaving them behind would
    // let a code issued before the reset still satisfy MFA afterwards.
    const recoveryCodesRemoved = await prisma.mfaRecoveryCode.count({ where: { userId: id } });
    await prisma.$transaction([
      prisma.user.update({ where: { id }, data: { mustResetPassword: true } }),
      prisma.mfaRecoveryCode.deleteMany({ where: { userId: id } }),
    ]);
    const sessionsRevoked = await this.sessions.revokeAllForUser(id);
    this.authUsers.invalidate(existing.authUid);

    await prisma.authEvent
      .create({
        data: {
          kind: "mfa_reset",
          userId: existing.id,
          email: existing.email,
          meta: {
            reason: "admin sign-in reset",
            factors: factors.map((f) => f.factor_type ?? "unknown"),
            recoveryCodesRemoved,
            sessionsRevoked,
            temporaryPassword: true,
            actor: actor?.email ?? "unknown admin",
            actorId: actor?.id ?? null,
          },
        },
      })
      .catch((err: unknown) =>
        this.logger.warn(`mfa_reset audit event was not stored: ${(err as Error).message}`),
      );

    void this.accountMail.send(existing.email, { kind: "sign-in-reset" });

    return {
      user: shape(await prisma.user.findUniqueOrThrow({ where: { id }, select: USER_SELECT })),
      // Shown once, in the admin UI, so it can be passed on out of band.
      temporaryPassword: initialPassword,
      factorsRemoved: factors.length,
      sessionsRevoked,
    };
  }

  /**
   * Grant or withdraw a per-account exemption from mandatory two-step.
   * Turning it off also deletes enrolled factors and recovery codes, so no stale
   * credential can still challenge the account.
   */
  async setMfaDisabled(id: string, disabled: boolean, actor?: AdminActor) {
    const existing = await prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, role: true, authUid: true, mfaDisabled: true },
    });
    if (!existing) throw new NotFoundException("User not found");

    // Admin access is the highest privilege on the platform, so its second factor
    // is never optional — not even for the admin performing the exemption.
    if (disabled && existing.role === "admin") {
      throw new BadRequestException(
        "Admins must keep two-step verification. Use RESET SIGN-IN instead.",
      );
    }

    if (existing.mfaDisabled === disabled) {
      return shape(await prisma.user.findUniqueOrThrow({ where: { id }, select: USER_SELECT }));
    }

    // Write the exemption first: if deleting upstream factors fails afterwards,
    // the account is already usable at aal1 instead of losing its only factor and
    // staying locked out — the failure mode this feature exists to fix.
    await prisma.$transaction([
      prisma.user.update({ where: { id }, data: { mfaDisabled: disabled } }),
      ...(disabled ? [prisma.mfaRecoveryCode.deleteMany({ where: { userId: id } })] : []),
    ]);
    this.authUsers.invalidate(existing.authUid);

    let factorsRemoved = 0;
    let factorRemovalFailed = false;
    if (disabled && existing.authUid) {
      try {
        const factors = await this.admin.listFactors(existing.authUid);
        for (const factor of factors) {
          await this.admin.deleteFactor(existing.authUid, factor.id);
          factorsRemoved++;
        }
      } catch (err) {
        factorRemovalFailed = true;
        this.logger.warn(
          `exemption set for ${existing.email}, but a factor could not be removed: ${(err as Error).message}`,
        );
      }
    }

    await prisma.authEvent
      .create({
        data: {
          kind: disabled ? "mfa_disabled" : "mfa_reenabled",
          userId: id,
          email: existing.email,
          meta: {
            factorsRemoved,
            factorRemovalFailed,
            actor: actor?.email ?? "unknown admin",
            actorId: actor?.id ?? null,
          },
        },
      })
      .catch((err: unknown) =>
        this.logger.warn(`MFA exemption audit event was not stored: ${(err as Error).message}`),
      );

    void this.accountMail.send(existing.email, { kind: "mfa-changed", enabled: !disabled });

    return shape(await prisma.user.findUniqueOrThrow({ where: { id }, select: USER_SELECT }));
  }

  /** Every registered account, newest first, optionally filtered by email/name. */
  async list(q?: string, paging: Paging = parsePaging()) {
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
      ...pageArgs(paging),
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

    // Losing the last admin locks everyone out of account administration.
    if (existing.role === "admin" && role !== "admin") {
      const admins = await prisma.user.count({ where: { role: "admin" } });
      if (admins <= 1) {
        throw new BadRequestException("The last admin cannot be demoted — promote another admin first.");
      }
    }

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

      void this.accountMail.send(existing.email, {
        kind: "role-changed",
        from: existing.role,
        to: role,
      });

      // A new DJ is invited to the bot right away: gig calls and confirmations
      // then arrive as Telegram messages instead of sitting in the bell feed.
      if (role === "artist") {
        await this.inviteDjToTelegram(existing.id, stageName ?? null).catch(() => null);
      }
    }

    // A promoted promoter needs a workspace before signing in; `attachNewUser`
    // is a no-op when one already exists. Staff join the platform workspace.
    if (role === "promoter" || role === "admin" || role === "venue_manager" || role === "door") {
      await this.platform
        .attachNewUser(id, existing.email, role, dto.organisationName)
        .catch((err: unknown) =>
          this.logger.warn(
            `organisation not attached for ${existing.email}: ${(err as Error).message}`,
          ),
        );
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
        "The SONUS bot is not configured yet, so DJ calls and confirmations arrive as in-app notifications. An admin can enable Telegram later.",
      );
      return;
    }

    await this.notifications.deliver([userId], {
      kind: "telegram_onboarding",
      title: "Bring DJ calls to Telegram",
      body: `${label} is on the SONUS roster. Connect Telegram once and DJ calls, gig confirmations and invoices arrive as messages. Open the link, then press Start.`,
      link: url,
      channels: ["inapp", "telegram"],
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
