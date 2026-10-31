import { Controller, Get, Post, Body, Param, Res, UseGuards } from "@nestjs/common";
import { SupabaseAuthGuard } from "../auth/supabase-auth.guard";
import type { Response } from "express";
import { InvoicesService } from "./invoices.service";
import { Auth, CurrentUser } from "../common/auth.decorator";
import type { JwtUser } from "../common/roles.guard";

@Controller("invoices")
@UseGuards(SupabaseAuthGuard)
export class InvoicesController {
  constructor(private invoices: InvoicesService) {}

  @Get()
  @Auth("artist", "admin")
  list(@CurrentUser() user: JwtUser) {
    return this.invoices.list(user);
  }

  @Post("generate")
  @Auth("artist", "admin")
  generate(@CurrentUser() user: JwtUser, @Body("bookingIds") bookingIds?: string[]) {
    return this.invoices.generate(user, bookingIds);
  }

  /** Branded HTML invoice — print-to-PDF ready. */
  @Get(":id/print")
  @Auth("artist", "admin")
  async print(@CurrentUser() user: JwtUser, @Param("id") id: string, @Res() res: Response) {
    const html = await this.invoices.renderHtml(user, id);
    res.type("html").send(html);
  }

  @Post(":id/payment-link")
  @Auth("artist", "admin")
  paymentLink(@CurrentUser() user: JwtUser, @Param("id") id: string, @Body("provider") provider: "payfast" | "stripe") {
    return this.invoices.createPaymentLink(user, id, provider ?? "payfast");
  }
}
