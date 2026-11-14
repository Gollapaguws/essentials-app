import { Injectable, NotFoundException, ForbiddenException, BadRequestException, Optional, Inject, Logger, forwardRef } from "@nestjs/common";
import { getQueueToken } from "@nestjs/bullmq";
import type { Queue } from "bullmq";
import { prisma, ConsentStatus, EventStatus } from "@essentials/db";
import type { JwtUser } from "../common/roles.guard";
import { EmailSenderService } from "./email-sender.service";
import type { Prisma } from "@prisma/client";
import { parseMailingList } from "./mailing-list";
import { PRIVACY_POLICY_VERSION } from "../common/privacy";

function csvField(value: string) {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Imported lists keep their addresses in `filter.emails`; other segments are dynamic. */
function readListEmails(filter: unknown): string[] | null {
  if (!filter || typeof filter !== "object" || Array.isArray(filter)) return null;
  const emails = (filter as { emails?: unknown }).emails;
  if (!Array.isArray(emails) || !emails.every((email) => typeof email === "string")) return null;
  return [...new Set(emails.map((email) => email.toLowerCase()))];
}

export interface ContactSelection {
  emails?: string[];
  /** Select every contact matching `q` (or the whole list when `q` is empty). */
  allMatching?: boolean;
  q?: string;
  /** Addresses removed from an all-matching selection. */
  excluded?: string[];
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

/** Resolve a manager selection against the addresses actually stored on the list. */
function selectListContacts(emails: string[], selection: ContactSelection): string[] {
  if (selection.allMatching) {
    const term = (selection.q ?? "").trim().toLowerCase();
    const excluded = new Set((selection.excluded ?? []).map(normalizeEmail).filter(Boolean));
    return emails.filter((email) => (!term || email.includes(term)) && !excluded.has(email));
  }
  const chosen = new Set((selection.emails ?? []).map(normalizeEmail).filter(Boolean));
  return emails.filter((email) => chosen.has(email));
}

/**
 * Email engine v1. Flows: welcome_series, weekly_drop, reminder_24h, reminder_1h, winback.
 * Sends are queued via BullMQ; provider is behind MailService (Resend now, listmonk+Postal later).
 * Consent is enforced at enqueue time and at send time (double-checked in the processor).
 */
@Injectable()
export class EmailEngineService {
  private readonly logger = new Logger(EmailEngineService.name);
  constructor(
    @Optional() @Inject(getQueueToken("email")) private emailQueue?: Queue,
    @Optional() @Inject(forwardRef(() => EmailSenderService)) private sender?: EmailSenderService,
  ) {}

  private async dispatch(campaignId: string, userId: string) {
    await prisma.emailJob.create({ data: { campaignId, userId } });
    if (this.emailQueue) {
      await this.emailQueue.add("send", { campaignId, userId }, { attempts: 3, backoff: { type: "exponential", delay: 30_000 } });
    }
  }

  /** Resolve a segment filter into a recipient set. Guests with granted consent only. */
  async resolveRecipients(segmentId?: string): Promise<{ id: string; email: string; name: string | null }[]> {
    let where: Prisma.UserWhereInput = { role: "guest" };
    if (segmentId) {
      const segment = await prisma.emailSegment.findUnique({ where: { id: segmentId } });
      if (!segment) throw new NotFoundException("Segment not found");
      const f = segment.filter as { emails?: string[]; musicTastes?: string[]; minAttendedEvents?: number; vibeTag?: string };
      where = {
        ...where,
        ...(f.emails?.length ? { email: { in: f.emails } } : {}),
        ...(f.musicTastes?.length ? { musicTastes: { hasSome: f.musicTastes } } : {}),
        ...(f.vibeTag ? { vibeTag: f.vibeTag as never } : {}),
      };
      if (f.minAttendedEvents) {
        // attended = checked_in guest list entries
        where = {
          ...where,
          guestLists: { some: { status: "checked_in" } },
        };
        // exact count filtering done in memory for v1
        const candidates = await prisma.user.findMany({
          where,
          include: { _count: { select: { guestLists: { where: { status: "checked_in" } } } } },
        });
        return candidates.filter((u) => u._count.guestLists >= f.minAttendedEvents!);
      }
    }
    return prisma.user.findMany({ where, select: { id: true, email: true, name: true } });
  }

  async createSegment(user: JwtUser, name: string, filter: object) {
    if (user.role !== "promoter" && user.role !== "admin") throw new ForbiddenException();
    return prisma.emailSegment.create({ data: { name, filter: filter as object } });
  }

  async listSegments() {
    const rows = await prisma.emailSegment.findMany({
      select: {
        id: true,
        name: true,
        filter: true,
        createdAt: true,
        _count: { select: { campaigns: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      createdAt: row.createdAt,
      contactCount: readListEmails(row.filter)?.length ?? null,
      campaignCount: row._count.campaigns,
    }));
  }

  /** A page of an imported list's contacts, with each address's email consent. */
  async listSegmentContacts(user: JwtUser, segmentId: string, page = 1, pageSize = 50, query = "") {
    if (user.role !== "promoter" && user.role !== "admin") throw new ForbiddenException();
    const segment = await prisma.emailSegment.findUnique({ where: { id: segmentId } });
    if (!segment) throw new NotFoundException("Segment not found");
    const emails = readListEmails(segment.filter);
    if (!emails) throw new BadRequestException("This segment is not a mailing list");

    const term = query.trim().toLowerCase();
    const matched = (term ? emails.filter((email) => email.includes(term)) : emails).sort();
    const safePage = Math.max(1, Math.floor(page) || 1);
    const safeSize = Math.min(100, Math.max(1, Math.floor(pageSize) || 50));
    const pageEmails = matched.slice((safePage - 1) * safeSize, safePage * safeSize);

    const [users, consents] = await Promise.all([
      prisma.user.findMany({ where: { email: { in: pageEmails } }, select: { id: true, email: true, name: true } }),
      prisma.consent.findMany({
        where: { email: { in: pageEmails }, channel: "email" },
        select: { email: true, status: true },
      }),
    ]);
    const byEmail = new Map(users.map((row) => [row.email, row]));
    const consentByEmail = new Map(consents.map((row) => [row.email, row.status]));

    return {
      id: segment.id,
      name: segment.name,
      total: matched.length,
      page: safePage,
      pageSize: safeSize,
      contacts: pageEmails.map((email) => ({
        email,
        name: byEmail.get(email)?.name ?? null,
        consent: consentByEmail.get(email) ?? "none",
      })),
    };
  }

  /** Remove one address from a list. The guest and their consent record are kept. */
  async removeSegmentContact(user: JwtUser, segmentId: string, email: string) {
    if (user.role !== "promoter" && user.role !== "admin") throw new ForbiddenException();
    const segment = await prisma.emailSegment.findUnique({ where: { id: segmentId } });
    if (!segment) throw new NotFoundException("Segment not found");
    const emails = readListEmails(segment.filter);
    if (!emails) throw new BadRequestException("This segment is not a mailing list");

    const target = email.trim().toLowerCase();
    const next = emails.filter((row) => row !== target);
    if (next.length === emails.length) throw new NotFoundException("Contact not found in this list");
    await prisma.emailSegment.update({
      where: { id: segmentId },
      data: { filter: { ...(segment.filter as Record<string, unknown>), emails: next } },
    });
    return { ok: true, contactCount: next.length };
  }

  /** Remove several addresses from a list in one update. Consent and guests are kept. */
  async removeSegmentContacts(user: JwtUser, segmentId: string, selection: ContactSelection) {
    if (user.role !== "promoter" && user.role !== "admin") throw new ForbiddenException();
    const segment = await prisma.emailSegment.findUnique({ where: { id: segmentId } });
    if (!segment) throw new NotFoundException("Segment not found");
    const emails = readListEmails(segment.filter);
    if (!emails) throw new BadRequestException("This segment is not a mailing list");

    const targets = new Set(selectListContacts(emails, selection));
    if (!targets.size) throw new NotFoundException("None of those contacts are in this list");
    const next = emails.filter((email) => !targets.has(email));
    await prisma.emailSegment.update({
      where: { id: segmentId },
      data: { filter: { ...(segment.filter as Record<string, unknown>), emails: next } },
    });
    return { ok: true, removed: emails.length - next.length, contactCount: next.length };
  }

  /** Revoke consent for many list contacts at once. They stay on the list. */
  async unsubscribeContacts(user: JwtUser, segmentId: string, selection: ContactSelection) {
    if (user.role !== "promoter" && user.role !== "admin") throw new ForbiddenException();
    const segment = await prisma.emailSegment.findUnique({ where: { id: segmentId } });
    if (!segment) throw new NotFoundException("Segment not found");
    const emails = readListEmails(segment.filter);
    if (!emails) throw new BadRequestException("This segment is not a mailing list");

    const targets = selectListContacts(emails, selection);
    if (!targets.length) throw new NotFoundException("None of those contacts are in this list");
    await this.revokeEmailConsent(targets);
    return { ok: true, unsubscribed: targets.length, status: "revoked" };
  }

  /** Revoke a contact's email consent from the manager. They stay on the list. */
  async unsubscribeContact(user: JwtUser, email: string) {
    if (user.role !== "promoter" && user.role !== "admin") throw new ForbiddenException();
    const normalized = normalizeEmail(email);
    if (!normalized) throw new BadRequestException("Email is required");
    await this.revokeEmailConsent([normalized]);
    return { ok: true, email: normalized, status: "revoked" };
  }

  /**
   * Batch consent revocation: update existing rows, create missing revoked rows,
   * and record one unsubscribe event per address. Consents stay with the guest.
   */
  private async revokeEmailConsent(emails: string[]) {
    for (let i = 0; i < emails.length; i += 1000) {
      const batch = emails.slice(i, i + 1000);
      const existing = await prisma.consent.findMany({
        where: { email: { in: batch }, channel: "email" },
        select: { email: true },
      });
      const known = new Set(existing.map((row) => row.email));
      await prisma.consent.updateMany({
        where: { email: { in: batch }, channel: "email" },
        data: {
          status: ConsentStatus.revoked,
          source: "mailing_list_manager",
          policyVersion: PRIVACY_POLICY_VERSION,
          revokedAt: new Date(),
        },
      });
      const missing = batch.filter((email) => !known.has(email));
      if (missing.length) {
        await prisma.consent.createMany({
          data: missing.map((email) => ({
            email,
            status: ConsentStatus.revoked,
            source: "mailing_list_manager",
            policyVersion: PRIVACY_POLICY_VERSION,
            revokedAt: new Date(),
          })),
          skipDuplicates: true,
        });
      }
      await prisma.emailEvent.createMany({
        data: batch.map((email) => ({ email, type: "unsubscribe" })),
      });
    }
  }

  /** CSV export of a saved list, including each contact's current consent status. */
  async exportSegmentCsv(user: JwtUser, segmentId: string, selection?: ContactSelection) {
    if (user.role !== "promoter" && user.role !== "admin") throw new ForbiddenException();
    const segment = await prisma.emailSegment.findUnique({ where: { id: segmentId } });
    if (!segment) throw new NotFoundException("Segment not found");
    const emails = readListEmails(segment.filter);
    if (!emails) throw new BadRequestException("This segment is not a mailing list");
    const exported = selection ? selectListContacts(emails, selection) : emails;
    if (!exported.length) throw new BadRequestException("Select at least one contact to export");

    const users = new Map<string, string | null>();
    const consents = new Map<string, string>();
    for (let i = 0; i < exported.length; i += 2000) {
      const batch = exported.slice(i, i + 2000);
      const [people, rows] = await Promise.all([
        prisma.user.findMany({ where: { email: { in: batch } }, select: { email: true, name: true } }),
        prisma.consent.findMany({
          where: { email: { in: batch }, channel: "email" },
          select: { email: true, status: true },
        }),
      ]);
      for (const person of people) users.set(person.email, person.name);
      for (const row of rows) consents.set(row.email, row.status);
    }

    const lines = ["email,name,consent"];
    for (const email of [...exported].sort()) {
      lines.push([csvField(email), csvField(users.get(email) ?? ""), csvField(consents.get(email) ?? "none")].join(","));
    }
    const base = segment.name.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "mailing-list";
    return {
      filename: `${base}${selection ? "-selected" : ""}.csv`,
      csv: `\uFEFF${lines.join("\r\n")}\r\n`,
    };
  }

  /** Delete a list only. Contacts and campaign history are kept. */
  async deleteSegment(user: JwtUser, segmentId: string) {
    if (user.role !== "promoter" && user.role !== "admin") throw new ForbiddenException();
    const segment = await prisma.emailSegment.findUnique({ where: { id: segmentId } });
    if (!segment) throw new NotFoundException("Segment not found");
    await prisma.emailSegment.delete({ where: { id: segmentId } });
    return { ok: true };
  }

  /**
   * Import an uploaded CSV/TSV mailing list. The uploader must attest that every
   * address opted in; the attestation is stored with the segment and each consent
   * row. Addresses that already revoked consent stay revoked.
   */
  async importMailingList(user: JwtUser, file: Express.Multer.File, attested: boolean) {
    if (user.role !== "promoter" && user.role !== "admin") throw new ForbiddenException();
    if (!attested) {
      throw new BadRequestException("Confirm that every contact opted in before importing");
    }
    const { contacts, invalid } = parseMailingList(file.buffer.toString("utf8"));
    if (!contacts.length) throw new BadRequestException("No valid email addresses found in the file");

    for (let i = 0; i < contacts.length; i += 500) {
      const chunk = contacts.slice(i, i + 500);
      const emails = chunk.map((contact) => contact.email);
      const existing = await prisma.user.findMany({ where: { email: { in: emails } }, select: { email: true } });
      const known = new Set(existing.map((row) => row.email));
      const missing = chunk.filter((contact) => !known.has(contact.email));
      if (missing.length) {
        await prisma.user.createMany({
          data: missing.map((contact) => ({ email: contact.email, name: contact.name })),
          skipDuplicates: true,
        });
      }

      const stored = await prisma.user.findMany({ where: { email: { in: emails } }, select: { id: true, email: true } });
      const ids = new Map(stored.map((row) => [row.email, row.id]));
      // Only create missing consent. An address that already unsubscribed stays
      // unsubscribed; importing a list must never silently re-opt someone in.
      await prisma.consent.createMany({
        data: chunk.map((contact) => ({
          email: contact.email,
          userId: ids.get(contact.email),
          status: ConsentStatus.granted,
          source: "import_attested",
          policyVersion: PRIVACY_POLICY_VERSION,
        })),
        skipDuplicates: true,
      });
    }

    const baseName = file.originalname.replace(/\.[^.]+$/, "").trim().slice(0, 80) || "Imported list";
    const name = `${baseName} · ${new Date().toISOString().slice(0, 10)}`;
    const segment = await prisma.emailSegment.create({
      data: {
        name,
        filter: {
          emails: contacts.map((contact) => contact.email),
          consentAttested: true,
          consentAttestedAt: new Date().toISOString(),
          consentPolicyVersion: PRIVACY_POLICY_VERSION,
        },
      },
    });
    return {
      segmentId: segment.id,
      name: segment.name,
      imported: contacts.length,
      invalid,
    };
  }

  /** Queue a campaign send to a segment (or all consenting guests). */
  async enqueueCampaign(user: JwtUser, data: { name: string; flow: string; subject: string; segmentId?: string; eventId?: string; html?: string }) {
    if (user.role !== "promoter" && user.role !== "admin") throw new ForbiddenException();
    const campaign = await prisma.campaign.create({
      data: {
        name: data.name,
        flow: data.flow,
        subject: data.subject,
        contentHtml: data.html?.trim() || null,
        segmentId: data.segmentId,
        eventId: data.eventId,
        status: "sending",
      },
    });
    const recipients = await this.resolveRecipients(data.segmentId);
    const emails = new Set<string>();
    for (const r of recipients) {
      if (emails.has(r.email)) continue;
      emails.add(r.email);
      const consent = await prisma.consent.findUnique({ where: { email_channel: { email: r.email, channel: "email" } } });
      if (!consent || consent.status !== ConsentStatus.granted) continue;
      await prisma.emailJob.create({ data: { campaignId: campaign.id, userId: r.id } });
      if (this.emailQueue) {
        await this.emailQueue.add("send", { campaignId: campaign.id, userId: r.id }, { attempts: 3, backoff: { type: "exponential", delay: 30_000 } });
      } else {
        try {
          await this.sender?.sendCampaignEmail(campaign.id, r.id);
        } catch (e) {
          this.logger.warn(`inline send failed for ${r.email}: ${(e as Error).message}`);
        }
      }
    }
    return { campaignId: campaign.id, queued: emails.size };
  }

  /** One-click unsubscribe + preference center backing. */
  async unsubscribe(email: string) {
    await prisma.consent.upsert({
      where: { email_channel: { email, channel: "email" } },
      update: {
        status: "revoked",
        source: "preference_center",
        policyVersion: PRIVACY_POLICY_VERSION,
        revokedAt: new Date(),
      },
      create: {
        email,
        status: "revoked",
        source: "preference_center",
        policyVersion: PRIVACY_POLICY_VERSION,
        revokedAt: new Date(),
      },
    });
    await prisma.emailEvent.create({ data: { email, type: "unsubscribe" } });
    return { ok: true };
  }

  async getConsent(email: string) {
    const consent = await prisma.consent.findUnique({ where: { email_channel: { email, channel: "email" } } });
    return { email, status: consent?.status ?? "never_subscribed" };
  }

  async grantConsent(email: string, userId?: string) {
    return prisma.consent.upsert({
      where: { email_channel: { email, channel: "email" } },
      update: {
        status: "granted",
        source: "preference_center",
        policyVersion: PRIVACY_POLICY_VERSION,
        revokedAt: null,
      },
      create: {
        email,
        userId,
        status: "granted",
        source: "preference_center",
        policyVersion: PRIVACY_POLICY_VERSION,
      },
    });
  }

  /** Campaign attribution: guest-list joins it generated. */
  async attribution(user: JwtUser, campaignId: string) {
    const campaign = await prisma.campaign.findUniqueOrThrow({ where: { id: campaignId }, include: { event: true, segment: true } });
    if (!campaign) throw new NotFoundException("Campaign not found");
    if (user.role !== "admin" && campaign.event && campaign.event.promoterId !== user.sub) throw new ForbiddenException();
    const joins = await prisma.guestList.count({ where: { sourceCampaignId: campaignId } });
    return {
      campaign: { id: campaign.id, name: campaign.name, flow: campaign.flow, status: campaign.status, sentCount: campaign.sentCount },
      guestListJoins: joins,
    };
  }

  async listCampaigns(user: JwtUser) {
    if (user.role !== "promoter" && user.role !== "admin") throw new ForbiddenException();
    return prisma.campaign.findMany({
      include: { segment: { select: { name: true } }, _count: { select: { emailJobs: true } } },
      orderBy: { createdAt: "desc" },
    });
  }

  /** Weekly drop targets: approved/live upcoming events. */
  async upcomingEventsForDrop() {
    return prisma.event.findMany({
      where: { status: { in: [EventStatus.approved, EventStatus.live] }, date: { gte: new Date() } },
      orderBy: { date: "asc" },
      take: 5,
      include: { venue: { select: { name: true } } },
    });
  }
}
