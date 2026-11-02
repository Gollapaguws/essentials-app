import { Injectable } from "@nestjs/common";
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
  async deliver(userIds: string[], input: NotificationInput) {
    const ids = [...new Set(userIds.filter(Boolean))];
    if (!ids.length) return { delivered: 0 };

    const channels = new Set<NotificationChannel>(input.channels ?? ["inapp"]);
    if (channels.has("inapp")) {
      await this.notifyMany(ids, input.kind, input.title, input.body, input.link);
    }

    const wantsEmail = channels.has("email");
    const wantsTelegram = channels.has("telegram");
    if (!wantsEmail && !wantsTelegram) return { delivered: 0 };

    const users = await prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, email: true, name: true, telegramChatId: true },
    });

    let delivered = 0;
    for (const user of users) {
      if (wantsTelegram && user.telegramChatId) {
        if (await this.telegram.sendMessage(user.telegramChatId, this.telegramText(input))) {
          delivered++;
        }
      }
      if (wantsEmail && user.email) {
        try {
          await this.mail.send({
            to: user.email,
            subject: input.title,
            html: wrapTemplate(this.emailHtml(input, user.name)),
          });
          delivered++;
        } catch {
          // Mail provider down: the in-app row is already written.
        }
      }
    }
    return { delivered };
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
