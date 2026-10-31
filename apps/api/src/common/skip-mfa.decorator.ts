import { SetMetadata } from "@nestjs/common";

export const SKIP_MFA_KEY = "skip_mfa";

/**
 * Opt a route out of the aal1 -> MFA_REQUIRED gate.
 * Reserved for identity/audit bootstrap routes (/auth/me, /auth/session-established,
 * /auth/invite/redeem) that must work before a privileged user can enroll.
 */
export const SkipMfa = () => SetMetadata(SKIP_MFA_KEY, true);
