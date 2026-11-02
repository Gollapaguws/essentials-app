import { Controller, Post, Body, Param, Headers, HttpCode, RawBodyRequest, Req, UseGuards, Res } from "@nestjs/common";
import type { Request, Response } from "express";
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

  /** Sandbox confirm page target (dev provider only). */
  @Post("sandbox/confirm")
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
    return this.payments.handleWebhook("stripe", raw, signature, JSON.parse(raw || "{}"));
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
