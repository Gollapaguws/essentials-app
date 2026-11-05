import { Global, Module } from "@nestjs/common";
import { MailHealthService } from "./mail-health.service";
import { MailStatusController } from "./mail-status.controller";
import { MailService } from "./mail.service";

@Global()
@Module({
  controllers: [MailStatusController],
  providers: [MailService, MailHealthService],
  exports: [MailService],
})
export class MailModule {}
