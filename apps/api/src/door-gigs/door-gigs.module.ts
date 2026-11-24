import { Module } from "@nestjs/common";
import { DoorGigsController } from "./door-gigs.controller";
import { DoorGigsService } from "./door-gigs.service";
import { NotificationsModule } from "../notifications/notifications.module";
import { ArtistsModule } from "../artists/artists.module";

@Module({
  imports: [NotificationsModule, ArtistsModule],
  controllers: [DoorGigsController],
  providers: [DoorGigsService],
  exports: [DoorGigsService],
})
export class DoorGigsModule {}
