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
  const origins = (config.get("CORS_ORIGINS") ?? "*").split(",").map((s: string) => s.trim());
  app.enableCors({ origin: origins, credentials: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  const port = config.get("PORT") ?? 4000;
  await app.listen(port);
  console.log(`ESSENTIALS API on :${port}`);
}
bootstrap();
