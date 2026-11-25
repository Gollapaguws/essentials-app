import { Global, Module } from "@nestjs/common";
import { AuthController } from "./auth.controller";
import { SessionController } from "./session.controller";
import { DashboardSessionService } from "./dashboard-session.service";
import { DashboardSessionCleanup } from "./dashboard-session.cron";
import { AgentIdentityService } from "./agent-identity.service";
import { AgentContextService } from "./agent-context.service";
import { SupabaseTokenService } from "./supabase-token.service";
import { SupabaseAuthGuard } from "./supabase-auth.guard";
import { AuthUserService } from "./auth-user.service";
import { SupabaseAdminService } from "./supabase-admin.service";
import { PlatformModule } from "../platform/platform.module";

/** Global so @UseGuards(SupabaseAuthGuard) resolves from every feature module. */
@Global()
@Module({
  imports: [PlatformModule],
  controllers: [AuthController, SessionController],
  providers: [
    SupabaseTokenService,
    SupabaseAuthGuard,
    AuthUserService,
    SupabaseAdminService,
    DashboardSessionService,
    DashboardSessionCleanup,
    AgentIdentityService,
    AgentContextService,
  ],
  exports: [
    SupabaseTokenService,
    SupabaseAuthGuard,
    AuthUserService,
    SupabaseAdminService,
    DashboardSessionService,
    // SupabaseAuthGuard injects PlatformService, and feature modules across the
    // app use the guard by class. Because this module is @Global, re-exporting
    // PlatformModule makes the service resolvable in those modules' injectors
    // too; without it every module that guards a route fails at bootstrap.
    PlatformModule,
  ],
})
export class AuthModule {}
