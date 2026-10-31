import { Injectable, Logger } from "@nestjs/common";
import { prisma, ConsentStatus } from "@essentials/db";
import { MailService } from "../mail/mail.service";
import { emailTemplates, wrapTemplate } from "../mail/templates";

/**
 * Retention automations (Phase 4.5):
 * - taste_match: personalized "events like you" emails (guest musicTastes vs event genres/lineup)
 * - post_event: "see you at the next one" to checked-in guests within 48h after an event
 * - loyalty reward email when a free-entry cycle completes
 */
@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);

  constructor(private mail: MailService) {}

  /** Taste-matched weekly drop: personalized per guest. Called by the daily sweep. */
  async sendTasteMatches() {
    const events = await prisma.event.findMany({
      where: { status: { in: ["approved", "live"] }, date: { gte: new Date() } },
      include: { venue: true },
      orderBy: { date: "asc" },
    });
    if (!events.length) return { sent: 0 };

    const guests = await prisma.user.findMany({
      where: { role: "guest", musicTastes: { isEmpty: false } },
      include: { consentRecords: true },
    });

    const appUrl = process.env.APP_URL ?? "https://essentialsedm.com";
    let sent = 0;
    for (const guest of guests) {
      const consent = guest.consentRecords.find((c) => c.channel === "email");
      if (!consent || consent.status !== ConsentStatus.granted) continue;

      const matches = events.filter((e) => {
        const haystack = `${e.title} ${JSON.stringify(e.lineup)}`.toLowerCase();
        return guest.musicTastes.some((t) => haystack.includes(t.toLowerCase()));
      });
      if (!matches.length) continue;

      const unsub = `${appUrl}/api/email/unsubscribe?email=${encodeURIComponent(guest.email)}`;
      const html = `<h1 style="color:#00FF66;letter-spacing:2px;font-size:22px">FOR YOUR TASTE</h1>
        <p>${guest.name ?? "there"}, these upcoming rooms match what you actually listen to (${guest.musicTastes.join(", ")}):</p>
        ${matches.map((e) => `<p style="font-size:16px"><strong>${e.title}</strong><br/>${e.venue.name} · ${e.date.toDateString()} · <a href="${appUrl}/events/${e.id}" style="color:#00FF66">RSVP →</a></p>`).join("")}`;
      try {
        await this.mail.send({ to: guest.email, subject: "Events picked for your taste", html: wrapTemplate(html, unsub), unsubscribeUrl: unsub });
        sent++;
      } catch (e) {
        this.logger.warn(`taste match mail failed for ${guest.email}: ${(e as Error).message}`);
      }
    }
    return { sent };
  }

  /** Post-event "see you at the next one" — sweep events completed in the last 48h. */
  async sendPostEventEmails() {
    const now = new Date();
    const cutoff = new Date(now.getTime() - 48 * 3600_000);
    const events = await prisma.event.findMany({
      where: { date: { gte: cutoff, lte: now } },
      include: {
        guestLists: { where: { status: "checked_in" }, include: { user: { include: { consentRecords: true } } } },
      },
    });
    const nextEvent = await prisma.event.findFirst({
      where: { status: { in: ["approved", "live"] }, date: { gt: now } },
      orderBy: { date: "asc" },
    });
    const appUrl = process.env.APP_URL ?? "https://essentialsedm.com";
    let sent = 0;

    for (const event of events) {
      const dedupe = `post_event_${event.id}`;
      if (await prisma.campaign.findFirst({ where: { name: dedupe } })) continue;
      await prisma.campaign.create({ data: { name: dedupe, flow: "post_event", subject: `Thanks for coming — ${event.title}`, eventId: event.id, status: "sent" } });

      for (const gl of event.guestLists) {
        const consent = gl.user.consentRecords.find((c) => c.channel === "email");
        if (!consent || consent.status !== ConsentStatus.granted) continue;
        const unsub = `${appUrl}/api/email/unsubscribe?email=${encodeURIComponent(gl.user.email)}`;
        const next = nextEvent
          ? `<p>Next up: <strong>${nextEvent.title}</strong> — ${nextEvent.date.toDateString()} @ <a href="${appUrl}/events/${nextEvent.id}" style="color:#00FF66">RSVP →</a></p>`
          : `<p>Next dates drop soon — watch this space.</p>`;
        const html = `<h1 style="color:#00FF66;letter-spacing:2px;font-size:22px">SEE YOU IN THE ROOM</h1>
          <p>${gl.user.name ?? "there"}, thanks for being on the floor at <strong>${event.title}</strong>.</p>${next}`;
        try {
          await this.mail.send({ to: gl.user.email, subject: `See you at the next one — ${event.title}`, html: wrapTemplate(html, unsub), unsubscribeUrl: unsub });
          sent++;
        } catch (e) {
          this.logger.warn(`post-event mail failed for ${gl.user.email}: ${(e as Error).message}`);
        }
      }
    }
    return { sent };
  }
}
