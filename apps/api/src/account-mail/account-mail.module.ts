import { Global, Module } from "@nestjs/common";
import { AccountMailService } from "./account-mail.service";

@Global()
@Module({ providers: [AccountMailService], exports: [AccountMailService] })
export class AccountMailModule {}
