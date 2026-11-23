import { Module } from "@nestjs/common";
import { AliasMapService } from "./alias-map.service";
import { MailboxAdminController } from "./mailbox-admin.controller";
import { MailboxProvisioner } from "./mailbox.provisioner";
import { UserMailController } from "./user-mail.controller";
import { UserMailService } from "./user-mail.service";

@Module({
  controllers: [UserMailController, MailboxAdminController],
  providers: [MailboxProvisioner, AliasMapService, UserMailService],
})
export class UserMailModule {}
