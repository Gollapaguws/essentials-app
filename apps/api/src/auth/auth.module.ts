import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller";
import { SupabaseTokenService } from "./supabase-token.service";
import { SupabaseAuthGuard } from "./supabase-auth.guard";
import { AuthUserService } from "./auth-user.service";

/** Global so @UseGuards(SupabaseAuthGuard) resolves from every feature module. */
@Module({
  controllers: [AuthController],
  providers: [SupabaseTokenService, SupabaseAuthGuard, AuthUserService],
  exports: [SupabaseTokenService, SupabaseAuthGuard, AuthUserService],
})
export class AuthModule {}
