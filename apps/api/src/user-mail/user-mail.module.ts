import { Module } from "@nestjs/common";
import { MailboxProvisioner } from "./mailbox.provisioner";
import { UserMailController } from "./user-mail.controller";
import { UserMailService } from "./user-mail.service";

@Module({
  controllers: [UserMailController],
  providers: [MailboxProvisioner, UserMailService],
})
export class UserMailModule {}
