import { DynamicModule, Module, Logger } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { EmailEngineController } from "./email-engine.controller";
import { EmailEngineService } from "./email-engine.service";
import { EmailSenderService } from "./email-sender.service";
import { EmailProcessor } from "./email.processor";
import { RemindersService } from "./reminders.service";
import { SiteModule } from "../site/site.module";

/**
 * Email engine module. With REDIS_URL set, sends go through BullMQ (worker +
 * retries + backoff). Without Redis (dev), jobs execute inline after enqueue.
 */
@Module({})
export class EmailEngineModule {
  static register(): DynamicModule {
    const useRedis = !!process.env.REDIS_URL;
    const logger = new Logger("EmailEngine");
    logger.log(`queue mode: ${useRedis ? "BullMQ (Redis)" : "inline (no REDIS_URL)"}`);

    return {
      module: EmailEngineModule,
      imports: [
        ...(useRedis
          ? [BullModule.forRoot({ connection: { url: process.env.REDIS_URL } }), BullModule.registerQueue({ name: "email" })]
          : []),
        SiteModule,
      ],
      controllers: [EmailEngineController],
      providers: [EmailEngineService, EmailSenderService, RemindersService, ...(useRedis ? [EmailProcessor] : [])],
    };
  }
}
