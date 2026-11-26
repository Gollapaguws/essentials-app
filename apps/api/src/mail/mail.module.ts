import { Module } from "@nestjs/common";
import { MailController } from "./mail.controller";
import { MailRulesService } from "./mail-rules.service";
import { MailService } from "./mail.service";

@Module({
  controllers: [MailController],
  providers: [MailService, MailRulesService],
})
export class MailModule {}
