import { CanActivate, ExecutionContext, HttpException, HttpStatus, Inject, Injectable } from "@nestjs/common";
import { REDIS, type RedisCommands } from "./redis.provider";

const LIMIT = 5;
const WINDOW_SECONDS = 3_600;

/**
 * 5 attempts per hour per IP + verified email.
 * Runs after SupabaseAuthGuard so `req.user.email` is the verified address,
 * never a client-supplied one.
 */
@Injectable()
export class AuthRateGuard implements CanActivate {
  constructor(@Inject(REDIS) private readonly redis: RedisCommands) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const email = String(req.user?.email ?? "").toLowerCase();
    const ip = req.ip ?? req.socket?.remoteAddress ?? "unknown";
    const key = `auth:redeem:${ip}:${email}`;

    const hits = await this.redis.incr(key);
    if (hits === 1) await this.redis.expire(key, WINDOW_SECONDS);
    if (hits > LIMIT) {
      const ttl = await this.redis.ttl(key);
      throw new HttpException(
        {
          code: "RATE_LIMITED",
          message: "Too many attempts. Try again later.",
          retryAfter: Math.max(ttl, 0),
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}
