import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Post,
  UseGuards,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { ConfigService } from "@nestjs/config";
import { timingSafeEqual } from "crypto";
import { SupabaseAuthGuard } from "../auth/supabase-auth.guard";
import { Auth, CurrentUser } from "../common/auth.decorator";
import type { JwtUser } from "../common/roles.guard";
import { TelegramService } from "./telegram.service";

interface TelegramUpdate {
  message?: {
    text?: string;
    chat?: { id?: number };
    from?: { username?: string; first_name?: string };
  };
}

/** Constant-time comparison, so a wrong secret cannot be guessed byte by byte. */
function sameSecret(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

const HELP = [
  "ESSENTIALS bot 🎧",
  "",
  "Tap Connect Telegram in your dashboard to link this chat, then DJ calls,",
  "gig confirmations and invoices arrive here.",
  "",
  "/stop — stop receiving messages.",
].join("\n");

@Controller("telegram")
export class TelegramController {
  constructor(
    private readonly telegram: TelegramService,
    private readonly config: ConfigService,
  ) {}

  /** Is this account linked, and is the bot even configured on this server? */
  @Get("status")
  @UseGuards(SupabaseAuthGuard)
  @Auth("artist", "promoter", "venue_manager", "admin")
  status(@CurrentUser() user: JwtUser) {
    return this.telegram.status(user.sub);
  }

  /** Mint a deep link the person taps once to bind their Telegram account. */
  @Post("link")
  @HttpCode(200)
  @UseGuards(SupabaseAuthGuard)
  @Auth("artist", "promoter", "venue_manager", "admin")
  link(@CurrentUser() user: JwtUser) {
    return this.telegram.linkFor(user.sub);
  }

  @Post("unlink")
  @HttpCode(200)
  @UseGuards(SupabaseAuthGuard)
  @Auth("artist", "promoter", "venue_manager", "admin")
  async unlink(@CurrentUser() user: JwtUser) {
    await this.telegram.unlink(user.sub);
    return { linked: false };
  }

  /**
   * Bot webhook (`setWebhook` with TELEGRAM_WEBHOOK_SECRET). Telegram sends the
   * secret back in a header, which is the only thing that makes this public
   * route safe to trust.
   */
  @Post("webhook")
  @HttpCode(200)
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  async webhook(
    @Headers("x-telegram-bot-api-secret-token") secret: string | undefined,
    @Body() update: TelegramUpdate,
  ) {
    const expected = this.config.get<string>("TELEGRAM_WEBHOOK_SECRET");
    // Fail closed: this route is public, so an unset secret would let anyone
    // POST forged updates (and bind chats to arbitrary accounts).
    if (!expected) throw new ForbiddenException("Telegram webhook is not configured");
    if (!secret || !sameSecret(secret, expected)) throw new ForbiddenException("Bad webhook secret");

    const chatId = update.message?.chat?.id;
    const text = update.message?.text?.trim() ?? "";
    if (!chatId || !text.startsWith("/")) return { ok: true };

    const chat = String(chatId);

    if (text.startsWith("/start")) {
      const code = text.split(/\s+/)[1];
      if (!code) {
        await this.telegram.sendMessage(
          chat,
          "Open your ESSENTIALS dashboard and tap <b>Connect Telegram</b> to get a link.",
        );
        return { ok: true };
      }
      const bound = await this.telegram.bind(code, chat);
      await this.telegram.sendMessage(
        chat,
        bound
          ? `Linked to ${bound.email}. You'll get DJ calls and gig confirmations here. Send /stop to opt out.`
          : "That link has expired. Tap <b>Connect Telegram</b> in your dashboard for a new one.",
      );
      return { ok: true };
    }

    if (text.startsWith("/stop")) {
      const removed = await this.telegram.unlinkByChat(chat);
      await this.telegram.sendMessage(
        chat,
        removed ? "Stopped. You can relink from your dashboard at any time." : "This chat was not linked.",
      );
      return { ok: true };
    }

    await this.telegram.sendMessage(chat, HELP);
    return { ok: true };
  }
}
