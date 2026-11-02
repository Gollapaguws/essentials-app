import { Module } from "@nestjs/common";
import { PaymentsController, PaymentsWebhookController } from "./payments.controller";
import { PaymentsService } from "./payments.service";

@Module({ controllers: [PaymentsController, PaymentsWebhookController], providers: [PaymentsService] })
export class PaymentsModule {}
