import { Injectable } from "@nestjs/common";
import type { Role } from "@prisma/client";

/**
 * Resolves the canonical role for a Supabase identity.
 * Task 3 replaces this stub with the Prisma-backed lazy-link implementation.
 */
@Injectable()
export class AuthUserService {
  async resolveRole(_sub: string, _email: string): Promise<Role | null> {
    return null;
  }
}
