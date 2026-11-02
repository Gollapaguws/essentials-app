import { Global, Module } from "@nestjs/common";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { AuthUserService } from "./auth-user.service";
import { AuthEventsService } from "./auth-events.service";
import { SupabaseAdminService } from "./supabase-admin.service";
import { SupabaseTokenService } from "./supabase-token.service";
import { SupabaseAuthGuard } from "./supabase-auth.guard";
import { MailModule } from "../mail/mail.module";

/** Global so @UseGuards(SupabaseAuthGuard) resolves from every feature module. */
@Global()
@Module({
  imports: [MailModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthUserService,
    AuthEventsService,
    SupabaseAdminService,
    SupabaseTokenService,
    SupabaseAuthGuard,
  ],
  exports: [
    AuthService,
    AuthUserService,
    AuthEventsService,
    SupabaseAdminService,
    SupabaseTokenService,
    SupabaseAuthGuard,
  ],
})
export class AuthModule {}
