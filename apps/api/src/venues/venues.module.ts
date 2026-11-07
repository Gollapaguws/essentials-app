import { Module } from "@nestjs/common";
import { VenuesController } from "./venues.controller";
import { VenuesService } from "./venues.service";
import { NotificationsModule } from "../notifications/notifications.module";
import { ArtistsModule } from "../artists/artists.module";

@Module({
  imports: [NotificationsModule, ArtistsModule],
  controllers: [VenuesController],
  providers: [VenuesService],
  // Events reuse the venue's approval effects when a promoter creates an event in
  // a venue they manage: there, creation is the approval.
  exports: [VenuesService],
})
export class VenuesModule {}
