import { Module } from "@nestjs/common";
import { ArtistsController } from "./artists.controller";
import { ArtistsService } from "./artists.service";
import { InvoicesController } from "./invoices.controller";
import { InvoicesService } from "./invoices.service";
import { DjBookingService } from "./dj-booking.service";
import { NotificationsModule } from "../notifications/notifications.module";

@Module({
  imports: [NotificationsModule],
  controllers: [ArtistsController, InvoicesController],
  providers: [ArtistsService, InvoicesService, DjBookingService],
  exports: [DjBookingService],
})
export class ArtistsModule {}
