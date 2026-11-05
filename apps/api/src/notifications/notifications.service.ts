import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { prisma } from "@essentials/db";
import { MailService } from "../mail/mail.service";
import { wrapTemplate } from "../mail/templates";
import { TelegramService } from "../telegram/telegram.service";

export type NotificationChannel = "inapp" | "email" | "telegram";

export interface NotificationInput {
  kind: string;
  title: string;
  body: string;
  link?: string;
  /** Defaults to `["inapp"]`; add `email` / `telegram` to reach people outside the app. */
  channels?: NotificationChannel[];
}

export interface DeliveryResult {
  /** Email + Telegram messages that actually went out. */
  delivered: number;
  /** How many people each channel reached, so callers can report it honestly. */
  channels: Record<NotificationChannel, number>;
}

/** One DJ the admin can fire a test notification at. */
export interface DjTarget {
  id: string;
  email: string;
  name: string | null;
  stageName: string | null;
  telegram: boolean;
}

/**
 * The one place a notification is created. In-app rows always land in the bell
 * feed; email and Telegram are best-effort so a dead provider never fails the
 * request that triggered the notification.
 */
@Injectable()
export class NotificationsService {
  constructor(
    private readonly mail: MailService,
    private readonly telegram: TelegramService,
    private readonly config: ConfigService,
  ) {}

  async notify(userId: string, kind: string, title: string, body: string, link?: string) {
    await prisma.notification
      .create({ data: { userId, kind, title, body, link } })
      .catch(() => null);
  }

  async notifyMany(userIds: string[], kind: string, title: string, body: string, link?: string) {
    if (!userIds.length) return;
    await prisma.notification
      .createMany({ data: userIds.map((userId) => ({ userId, kind, title, body, link })) })
      .catch(() => null);
  }

  /**
   * Notify a set of accounts on the requested channels. Telegram only reaches
   * people who have linked their chat; everyone else still gets email.
   */
  async deliver(userIds: string[], input: NotificationInput): Promise<DeliveryResult> {
    const ids = [...new Set(userIds.filter(Boolean))];
    const counts: Record<NotificationChannel, number> = { inapp: 0, email: 0, telegram: 0 };
    if (!ids.length) return { delivered: 0, channels: counts };

    const channels = new Set<NotificationChannel>(input.channels ?? ["inapp"]);
    if (channels.has("inapp")) {
      await this.notifyMany(ids, input.kind, input.title, input.body, input.link);
      counts.inapp = ids.length;
    }

    const wantsEmail = channels.has("email");
    const wantsTelegram = channels.has("telegram");
    if (!wantsEmail && !wantsTelegram) return { delivered: 0, channels: counts };

    const users = await prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, email: true, name: true, telegramChatId: true },
    });

    for (const user of users) {
      if (wantsTelegram && user.telegramChatId) {
        if (await this.telegram.sendMessage(user.telegramChatId, this.telegramText(input))) {
          counts.telegram++;
        }
      }
      if (wantsEmail && user.email) {
        try {
          await this.mail.send({
            to: user.email,
            subject: input.title,
            html: wrapTemplate(this.emailHtml(input, user.name)),
          });
          counts.email++;
        } catch {
          // Mail provider down: the in-app row is already written.
        }
      }
    }
    return { delivered: counts.email + counts.telegram, channels: counts };
  }

  /** Every DJ account, for the admin test-notification picker. */
  async djTargets(): Promise<DjTarget[]> {
    const users = await prisma.user.findMany({
      where: { role: "artist" },
      orderBy: [{ email: "asc" }],
      select: {
        id: true,
        email: true,
        name: true,
        telegramChatId: true,
        artistProfile: { select: { stageName: true } },
      },
    });
    return users.map((user) => ({
      id: user.id,
      email: user.email,
      name: user.name,
      stageName: user.artistProfile?.stageName ?? null,
      telegram: Boolean(user.telegramChatId),
    }));
  }

  /**
   * Admin-only: fire one notice at a DJ on every channel a real DJ call uses, so
   * a dead mail or Telegram path surfaces now instead of during a live booking.
   */
  async sendTest(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        telegramChatId: true,
        artistProfile: { select: { stageName: true } },
      },
    });
    if (!user) throw new NotFoundException("Account not found");
    if (user.role !== "artist") {
      throw new BadRequestException("Test notifications only go to DJ accounts.");
    }

    const result = await this.deliver([user.id], {
      kind: "generic",
      title: "TEST NOTIFICATION",
      body: "This is a test notification from ESSENTIALS — DJ calls, gig confirmations and invoices will land here. Nothing to do.",
      link: `${this.appUrl()}/dashboard/notifications`,
      channels: ["inapp", "email", "telegram"],
    });

    return {
      recipient: {
        id: user.id,
        email: user.email,
        name: user.name,
        stageName: user.artistProfile?.stageName ?? null,
        telegram: Boolean(user.telegramChatId),
      },
      ...result,
    };
  }

  listFor(userId: string) {
    return prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
  }

  async unreadCount(userId: string): Promise<number> {
    return prisma.notification.count({ where: { userId, read: false } });
  }

  async markRead(userId: string, id?: string) {
    await prisma.notification.updateMany({
      where: { userId, ...(id ? { id } : {}) },
      data: { read: true },
    });
    return { ok: true };
  }

  /** Absolute links: the same URL is used in the bell feed, email and Telegram. */
  private appUrl() {
    return (this.config.get<string>("APP_URL") ?? "https://essentialsedm.com").replace(/\/$/, "");
  }

  private telegramText(input: NotificationInput) {
    const lines = [`<b>${escapeHtml(input.title)}</b>`, escapeHtml(input.body)];
    if (input.link) lines.push(`<a href="${input.link}">Open ESSENTIALS</a>`);
    return lines.join("\n");
  }

  private emailHtml(input: NotificationInput, name: string | null) {
    return `<h1 style="color:#00FF66;letter-spacing:2px;font-size:22px">${escapeHtml(input.title)}</h1>
  <p>${name ? `Hi ${escapeHtml(name)},` : "Hello,"}</p>
  <p>${escapeHtml(input.body)}</p>
  ${
    input.link
      ? `<p><a href="${input.link}" style="background:#00FF66;color:#0A0A0A;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:bold">OPEN ESSENTIALS</a></p>`
      : ""
  }`;
  }
}

/** Titles and bodies are server-generated, but names and event titles are not. */
function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
