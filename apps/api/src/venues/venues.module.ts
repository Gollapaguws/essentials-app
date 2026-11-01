import { Module } from "@nestjs/common";
import { VenuesController } from "./venues.controller";
import { VenuesService } from "./venues.service";
import { NotificationsModule } from "../notifications/notifications.module";
import { ArtistsModule } from "../artists/artists.module";

@Module({
  imports: [NotificationsModule, ArtistsModule],
  controllers: [VenuesController],
  providers: [VenuesService],
})
export class VenuesModule {}
