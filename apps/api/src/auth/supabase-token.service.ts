import { Inject, Injectable, Optional, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTVerifyGetKey,
} from "jose";
import type { Role } from "@prisma/client";

export const SUPABASE_JWKS = Symbol("SUPABASE_JWKS");

const ROLES: Role[] = ["guest", "artist", "promoter", "venue_manager", "admin"];

export interface VerifiedSession {
  sub: string;
  email: string;
  /** Canonical app role from app_metadata; null when the claim is absent. */
  role: Role | null;
  aal: "aal1" | "aal2";
}

/**
 * Verifies Supabase access tokens.
 * Keys come from the project JWKS (cached by `jose`, refreshed on unknown kid with a
 * 5-minute cooldown), so the hot path never fetches a key.
 */
@Injectable()
export class SupabaseTokenService {
  private readonly issuer: string;
  private readonly keySet: JWTVerifyGetKey;

  constructor(
    config: ConfigService,
    @Optional() @Inject(SUPABASE_JWKS) keySet?: JWTVerifyGetKey,
  ) {
    this.issuer = `${config.getOrThrow<string>("SUPABASE_URL")}/auth/v1`;
    this.keySet =
      keySet ??
      createRemoteJWKSet(new URL(`${this.issuer}/.well-known/jwks.json`), {
        cooldownDuration: 300_000,
        cacheMaxAge: 600_000,
      });
  }

  async verify(token: string): Promise<VerifiedSession> {
    try {
      const { payload } = await jwtVerify(token, this.keySet, {
        issuer: this.issuer,
        audience: "authenticated",
      });
      if (!payload.sub || typeof payload.email !== "string") {
        throw new Error("missing sub/email");
      }
      const claimed = (payload.app_metadata as { role?: unknown } | undefined)?.role;
      return {
        sub: payload.sub,
        email: payload.email,
        // Supabase puts "authenticated" in the top-level `role` claim — only app_metadata.role counts.
        role: typeof claimed === "string" && ROLES.includes(claimed as Role) ? (claimed as Role) : null,
        aal: payload.aal === "aal2" ? "aal2" : "aal1",
      };
    } catch {
      throw new UnauthorizedException("Invalid or expired token");
    }
  }
}
