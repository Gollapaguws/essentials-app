import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomBytes } from "crypto";
import { prisma } from "@essentials/db";

export interface TelegramStatus {
  configured: boolean;
  bot: string | null;
  linked: boolean;
}

/**
 * Per-person Telegram messages through a bot.
 *
 * A bot cannot start a conversation, so each account is bound once: the person
 * taps a `/start <code>` deep link, the webhook records their chat id, and every
 * later notification is a DM on that chat.
 */
@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);

  constructor(private readonly config: ConfigService) {}

  private token(): string | undefined {
    return this.config.get<string>("TELEGRAM_BOT_TOKEN");
  }

  /** Bot handle without the leading `@`. */
  botUsername(): string | null {
    const raw = this.config.get<string>("TELEGRAM_BOT_USERNAME");
    return raw ? raw.replace(/^@/, "") : null;
  }

  configured(): boolean {
    return Boolean(this.token() && this.botUsername());
  }

  /** Send one HTML message. Never throws: a dead bot must not fail a request. */
  async sendMessage(chatId: string, text: string): Promise<boolean> {
    const token = this.token();
    if (!token || !chatId) return false;
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: "HTML",
          disable_web_page_preview: true,
        }),
      });
      if (!res.ok) {
        this.logger.warn(`telegram send failed: HTTP ${res.status} for chat ${chatId}`);
        return false;
      }
      return true;
    } catch (err) {
      this.logger.warn(`telegram send failed: ${(err as Error).message}`);
      return false;
    }
  }

  /** Message every one of these accounts that has bound Telegram. */
  async sendToUsers(userIds: string[], text: string): Promise<number> {
    if (!userIds.length || !this.token()) return 0;
    const users = await prisma.user.findMany({
      where: { id: { in: userIds }, telegramChatId: { not: null } },
      select: { telegramChatId: true },
    });
    let sent = 0;
    for (const u of users) {
      if (u.telegramChatId && (await this.sendMessage(u.telegramChatId, text))) sent++;
    }
    return sent;
  }

  async status(userId: string): Promise<TelegramStatus> {
    const row = await prisma.user.findUnique({
      where: { id: userId },
      select: { telegramChatId: true },
    });
    return {
      configured: this.configured(),
      bot: this.botUsername(),
      linked: Boolean(row?.telegramChatId),
    };
  }

  /**
   * Mint a fresh single-use code and the deep link that redeems it. The link is
   * safe to re-issue: the previous code is replaced, so an old one stops working.
   */
  async linkFor(userId: string): Promise<{ url: string | null; bot: string | null }> {
    const bot = this.botUsername();
    if (!bot || !this.token()) return { url: null, bot: null };
    const code = randomBytes(9).toString("base64url");
    await prisma.user.update({ where: { id: userId }, data: { telegramLinkCode: code } });
    return { url: `https://t.me/${bot}?start=${code}`, bot };
  }

  /** Webhook: a `/start <code>` message claims the code for that chat. */
  async bind(code: string, chatId: string): Promise<{ email: string; name: string | null } | null> {
    const user = await prisma.user.findUnique({
      where: { telegramLinkCode: code },
      select: { id: true, email: true, name: true },
    });
    if (!user) return null;
    await prisma.user.update({
      where: { id: user.id },
      data: {
        telegramChatId: chatId,
        telegramLinkedAt: new Date(),
        telegramLinkCode: null,
      },
    });
    return { email: user.email, name: user.name };
  }

  async unlinkByChat(chatId: string): Promise<boolean> {
    const done = await prisma.user.updateMany({
      where: { telegramChatId: chatId },
      data: { telegramChatId: null, telegramLinkedAt: null },
    });
    return done.count > 0;
  }

  async unlink(userId: string): Promise<void> {
    await prisma.user.update({
      where: { id: userId },
      data: { telegramChatId: null, telegramLinkedAt: null, telegramLinkCode: null },
    });
  }
}
