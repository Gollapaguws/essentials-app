import { Module } from "@nestjs/common";
import { BillingController } from "./billing.controller";
import { BillingService } from "./billing.service";
import { EntitlementsGuard } from "./entitlements.guard";
import { EntitlementsService } from "./entitlements.service";

/**
 * The commercial skeleton: plans, subscriptions and usage counters. It exports
 * the service so feature modules can meter a choke point with `record()`.
 */
@Module({
  controllers: [BillingController],
  providers: [BillingService, EntitlementsService, EntitlementsGuard],
  exports: [BillingService, EntitlementsService, EntitlementsGuard],
})
export class BillingModule {}
