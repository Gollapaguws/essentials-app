import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AppModule } from "./app.module";
import helmet from "helmet";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.setGlobalPrefix("api");
  app.use(helmet());
  // Hardening: lock CORS to configured origins in production
  const config = app.get(ConfigService);
  // Fail fast rather than booting an instance that cannot verify sessions.
  if (process.env.NODE_ENV === "production") {
    const required = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "DATABASE_URL"];
    const missing = required.filter((k) => !config.get(k));
    if (missing.length) throw new Error(`Missing required env: ${missing.join(", ")}`);
  }
  const origins = (config.get("CORS_ORIGINS") ?? "*").split(",").map((s: string) => s.trim());
  app.enableCors({ origin: origins, credentials: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  const port = config.get("PORT") ?? 4000;
  await app.listen(port);
  console.log(`ESSENTIALS API on :${port}`);
}
bootstrap();
