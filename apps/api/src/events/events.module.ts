import { Module } from "@nestjs/common";
import { EventsController } from "./events.controller";
import { EventsService } from "./events.service";
import { EventToolsService } from "./event-tools.service";
import { GroupChatService } from "./group-chat.service";
import { LoyaltyModule } from "../loyalty/loyalty.module";
import { VenuesModule } from "../venues/venues.module";
import { ArtistsModule } from "../artists/artists.module";

@Module({
  controllers: [EventsController],
  imports: [LoyaltyModule, VenuesModule, ArtistsModule],
  providers: [EventsService, EventToolsService, GroupChatService],
  exports: [EventToolsService],
})
export class EventsModule {}
