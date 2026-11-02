import { BadRequestException, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

/**
 * Server-only Supabase admin calls (GoTrue admin API). The service-role key must
 * never reach a client bundle, so every write that creates an identity lives here.
 */
@Injectable()
export class SupabaseAdminService {
  constructor(private readonly config: ConfigService) {}

  private baseUrl(): string | undefined {
    return this.config.get<string>("SUPABASE_URL");
  }

  private key(): string | undefined {
    return this.config.get<string>("SUPABASE_SERVICE_ROLE_KEY");
  }

  configured(): boolean {
    return Boolean(this.baseUrl() && this.key());
  }

  private headers(): Record<string, string> {
    const key = this.key()!;
    return {
      "Content-Type": "application/json",
      apikey: key,
      Authorization: `Bearer ${key}`,
    };
  }

  /**
   * Create a confirmed identity with a temporary password. Returns its uid, which
   * becomes `User.authUid` so the person's first sign-in links straight to it.
   */
  async createUser(email: string, password: string): Promise<string> {
    if (!this.configured()) {
      throw new ServiceUnavailableException(
        "SUPABASE_SERVICE_ROLE_KEY and SUPABASE_URL must be set to create accounts.",
      );
    }

    const res = await fetch(`${this.baseUrl()}/auth/v1/admin/users`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ email, password, email_confirm: true }),
    });

    const body = (await res.json().catch(() => null)) as
      | { id?: string; msg?: string; message?: string; error_description?: string }
      | null;

    if (!res.ok) {
      const detail = body?.msg ?? body?.message ?? body?.error_description ?? `HTTP ${res.status}`;
      throw new BadRequestException(`Supabase rejected the new account: ${detail}`);
    }
    if (!body?.id) throw new BadRequestException("Supabase did not return the new account id.");
    return body.id;
  }

  /** Best-effort rollback when the local row cannot be written. */
  async deleteUser(uid: string): Promise<void> {
    if (!this.configured()) return;
    await fetch(`${this.baseUrl()}/auth/v1/admin/users/${uid}`, {
      method: "DELETE",
      headers: this.headers(),
    });
  }
}
