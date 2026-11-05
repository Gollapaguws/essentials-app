import { BadRequestException, Controller, Get, HttpCode, Post, Req, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { FileInterceptor } from "@nestjs/platform-express";
import { Throttle } from "@nestjs/throttler";
import type { Request } from "express";
import { MFA_REQUIRED_ROLES, SupabaseAuthGuard } from "./supabase-auth.guard";
import { AuthUserService } from "./auth-user.service";
import { CurrentUser } from "../common/auth.decorator";
import { MAX_PROFILE_IMAGE_BYTES, storeImage } from "../common/media-storage";
import type { VerifiedSession } from "./supabase-token.service";
import { SkipMfa } from "../common/skip-mfa.decorator";

interface RequestIdentity extends VerifiedSession {
  id?: string | null;
  mustResetPassword?: boolean;
}

@Controller("auth")
export class AuthController {
  constructor(private readonly authUsers: AuthUserService, private readonly config: ConfigService) {}

  /**
   * Canonical identity for a Supabase session. The guard has already created or
   * linked the Prisma account, so the role here is the one every endpoint uses.
   */
  @Get("me")
  @UseGuards(SupabaseAuthGuard)
  @SkipMfa()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  me(@CurrentUser() session: RequestIdentity) {
    const role = session.role ?? null;
    const mustResetPassword = Boolean(session.mustResetPassword);
    return {
      user: {
        sub: session.sub,
        id: session.id ?? session.sub,
        email: session.email,
        role,
        aal: session.aal,
        mustResetPassword,
      },
      // This route skips the aal1 gate so a privileged account can still discover
      // its role; report the gate it is about to hit instead of a blanket false.
      mfaRequired: Boolean(role && MFA_REQUIRED_ROLES.has(role) && session.aal !== "aal2"),
      mustResetPassword,
    };
  }

  /** Profile photo for any signed-in account (jpg/png/webp/avif, max 5 MB). */
  @Post("me/avatar")
  @HttpCode(200)
  @UseGuards(SupabaseAuthGuard)
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_PROFILE_IMAGE_BYTES } }))
  async uploadAvatar(
    @CurrentUser() session: RequestIdentity,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() req: Request,
  ) {
    if (!file) throw new BadRequestException("No file");
    const mediaDir = this.config.get<string>("MEDIA_DIR") ?? "/var/www/essentialsedm/media";
    const publicBase = this.config.get<string>("PUBLIC_MEDIA_URL") ?? "/media";
    const { url } = storeImage(file, {
      mediaDir,
      publicBase,
      origin: `${req.protocol}://${req.get("host")}`,
    });
    await this.authUsers.setAvatar(session.id ?? session.sub, url);
    return { ok: true, url };
  }

  /**
   * Called after the client sets its own Supabase password, so the first-login
   * gate cannot be re-entered on the next sign-in.
   */
  @Post("password/complete")
  @UseGuards(SupabaseAuthGuard)
  @SkipMfa()
  @HttpCode(200)
  async completePasswordReset(@CurrentUser() session: RequestIdentity) {
    await this.authUsers.clearPasswordReset(session.id ?? session.sub);
    return { mustResetPassword: false };
  }
}
