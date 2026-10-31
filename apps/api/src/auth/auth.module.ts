import { Global, Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { AuthUserService } from "./auth-user.service";
import { AuthEventsService } from "./auth-events.service";
import { SupabaseTokenService } from "./supabase-token.service";
import { SupabaseAuthGuard } from "./supabase-auth.guard";
import { JwtStrategy } from "./jwt.strategy";
import { MailModule } from "../mail/mail.module";

/** Global so @UseGuards(SupabaseAuthGuard) resolves from every feature module. */
@Global()
@Module({
  imports: [PassportModule, JwtModule.register({}), MailModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthUserService,
    AuthEventsService,
    SupabaseTokenService,
    SupabaseAuthGuard,
    JwtStrategy,
  ],
  exports: [AuthService, AuthUserService, AuthEventsService, SupabaseTokenService, SupabaseAuthGuard],
})
export class AuthModule {}
