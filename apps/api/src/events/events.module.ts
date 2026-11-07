import { Module } from "@nestjs/common";
import { EventsController } from "./events.controller";
import { EventsService } from "./events.service";
import { EventToolsService } from "./event-tools.service";
import { LoyaltyModule } from "../loyalty/loyalty.module";
import { VenuesModule } from "../venues/venues.module";

@Module({
  controllers: [EventsController],
  imports: [LoyaltyModule, VenuesModule],
  providers: [EventsService, EventToolsService],
  exports: [EventToolsService],
})
export class EventsModule {}
