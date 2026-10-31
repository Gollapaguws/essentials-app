import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Role } from "@prisma/client";

/**
 * Server-only Supabase admin access (service-role key).
 * Used to mirror the canonical Prisma role into `app_metadata.role` so the guard
 * can read it from the token instead of the database.
 */
@Injectable()
export class SupabaseAdminService {
  private readonly logger = new Logger(SupabaseAdminService.name);
  private readonly client: SupabaseClient | null;

  constructor(config: ConfigService) {
    const url = config.get<string>("SUPABASE_URL");
    const key = config.get<string>("SUPABASE_SERVICE_ROLE_KEY");
    this.client =
      url && key
        ? createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
        : null;
  }

  async updateRole(userAuthUid: string, role: Role): Promise<void> {
    if (!this.client) {
      this.logger.warn("Supabase admin client unavailable — skipping role mirror");
      return;
    }
    const { error } = await this.client.auth.admin.updateUserById(userAuthUid, {
      app_metadata: { role },
    });
    if (error) throw new Error(error.message);
  }
}
