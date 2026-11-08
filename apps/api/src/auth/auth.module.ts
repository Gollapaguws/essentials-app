import { Global, Module } from "@nestjs/common";
import { AuthController } from "./auth.controller";
import { SessionController } from "./session.controller";
import { DashboardSessionService } from "./dashboard-session.service";
import { DashboardSessionCleanup } from "./dashboard-session.cron";
import { AgentIdentityService } from "./agent-identity.service";
import { SupabaseTokenService } from "./supabase-token.service";
import { SupabaseAuthGuard } from "./supabase-auth.guard";
import { AuthUserService } from "./auth-user.service";
import { SupabaseAdminService } from "./supabase-admin.service";

/** Global so @UseGuards(SupabaseAuthGuard) resolves from every feature module. */
@Global()
@Module({
  controllers: [AuthController, SessionController],
  providers: [
    SupabaseTokenService,
    SupabaseAuthGuard,
    AuthUserService,
    SupabaseAdminService,
    DashboardSessionService,
    DashboardSessionCleanup,
    AgentIdentityService,
  ],
  exports: [
    SupabaseTokenService,
    SupabaseAuthGuard,
    AuthUserService,
    SupabaseAdminService,
    DashboardSessionService,
  ],
})
export class AuthModule {}
