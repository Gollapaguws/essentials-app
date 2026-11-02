import { Injectable } from "@nestjs/common";

export interface PublicUser {
  id: string;
  email: string;
  role: string;
}

/**
 * Account onboarding ends on first sign-in: Supabase owns the identity;
 * the API only resolves and mirrors the role.
 */
@Injectable()
export class AuthService {
  constructor() {}
}
