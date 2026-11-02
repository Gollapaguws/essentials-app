import { Global, Module } from "@nestjs/common";
import { AuthController } from "./auth.controller";
import { SupabaseTokenService } from "./supabase-token.service";
import { SupabaseAuthGuard } from "./supabase-auth.guard";
import { AuthUserService } from "./auth-user.service";
import { SupabaseAdminService } from "./supabase-admin.service";

/** Global so @UseGuards(SupabaseAuthGuard) resolves from every feature module. */
@Global()
@Module({
  controllers: [AuthController],
  providers: [SupabaseTokenService, SupabaseAuthGuard, AuthUserService, SupabaseAdminService],
  exports: [SupabaseTokenService, SupabaseAuthGuard, AuthUserService, SupabaseAdminService],
})
export class AuthModule {}
