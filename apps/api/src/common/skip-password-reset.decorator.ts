import { SetMetadata } from "@nestjs/common";

/**
 * The first-login password gate is enforced by SupabaseAuthGuard. A handful of
 * routes have to stay reachable so the account can discover the gate and set
 * the new password: /auth/me and the password-change endpoints.
 */
export const SKIP_PASSWORD_RESET_KEY = "skipPasswordReset";

export const SkipPasswordReset = () => SetMetadata(SKIP_PASSWORD_RESET_KEY, true);
