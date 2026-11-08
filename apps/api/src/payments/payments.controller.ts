import { Controller, Post, Body, Param, Headers, HttpCode, RawBodyRequest, Req, UseGuards, BadRequestException } from "@nestjs/common";
import type { Request } from "express";
import { SupabaseAuthGuard } from "../auth/supabase-auth.guard";
import { PaymentsService } from "./payments.service";
import { Auth, CurrentUser } from "../common/auth.decorator";
import type { JwtUser } from "../common/roles.guard";

@Controller("payments")
@UseGuards(SupabaseAuthGuard)
export class PaymentsController {
  constructor(private payments: PaymentsService) {}

  @Post("checkout/:invoiceId")
  @Auth("artist", "admin")
  checkout(@CurrentUser() user: JwtUser, @Param("invoiceId") invoiceId: string) {
    return this.payments.checkout(user, invoiceId);
  }

  /**
   * Sandbox confirm page target (dev provider only). Admin-only: it marks an
   * invoice paid, so a guest must never be able to call it for their own invoice.
   */
  @Post("sandbox/confirm")
  @Auth("admin")
  sandboxConfirm(@Body("reference") reference: string) {
    return this.payments.sandboxConfirm(reference);
  }
}

@Controller("payments/webhook")
export class PaymentsWebhookController {
  constructor(private payments: PaymentsService) {}

  /** Stripe sends JSON + signature header. Raw body required for HMAC. */
  @Post("stripe")
  @HttpCode(200)
  async stripe(@Req() req: RawBodyRequest<Request>, @Headers("stripe-signature") signature: string) {
    const raw = req.rawBody?.toString() ?? "";
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw || "{}");
    } catch {
      throw new BadRequestException("Malformed webhook payload");
    }
    return this.payments.handleWebhook("stripe", raw, signature, parsed);
  }

  /** PayFast ITN posts form-encoded data. */
  @Post("payfast")
  @HttpCode(200)
  async payfast(@Req() req: RawBodyRequest<Request>) {
    const raw = req.rawBody?.toString() ?? "";
    const parsed = Object.fromEntries(new URLSearchParams(raw));
    return this.payments.handleWebhook("payfast", raw, undefined, parsed);
  }
}
