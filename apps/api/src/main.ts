import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AppModule } from "./app.module";
import { LiveGateway } from "./live/live.gateway";
import helmet from "helmet";

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });
  app.setGlobalPrefix("api");
  // nginx terminates TLS and forwards X-Forwarded-Proto; without this req.protocol
  // stays "http" and stored upload URLs become mixed content on the https dashboard.
  app.set("trust proxy", 1);
  app.use(helmet());
  // Hardening: lock CORS to configured origins in production
  const config = app.get(ConfigService);
  // Fail fast rather than booting an instance that cannot verify sessions.
  if (process.env.NODE_ENV === "production") {
    const required = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "DATABASE_URL"];
    const missing = required.filter((k) => !config.get(k));
    if (missing.length) throw new Error(`Missing required env: ${missing.join(", ")}`);
  }
  const origins = (config.get<string>("CORS_ORIGINS") ?? "")
    .split(",")
    .map((s: string) => s.trim())
    .filter(Boolean);
  // A wildcard cannot be combined with credentials safely: browsers either
  // reject it or, with `origin: true`, every site gets credentialed access.
  if (process.env.NODE_ENV === "production" && (origins.length === 0 || origins.includes("*"))) {
    throw new Error("CORS_ORIGINS must list explicit origins in production (wildcards are not allowed)");
  }
  app.enableCors({
    // Dev default: reflect the caller. Production is pinned to the allowlist above.
    origin: origins.length === 0 || origins.includes("*") ? true : origins,
    credentials: true,
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  const port = config.get("PORT") ?? 4000;
  await app.listen(port);
  app.get(LiveGateway).attach(app.getHttpServer());
  console.log(`ESSENTIALS API on :${port}`);
}
bootstrap();
