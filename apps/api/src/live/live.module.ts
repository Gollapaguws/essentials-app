import { Module } from "@nestjs/common";
import { LiveGateway } from "./live.gateway";
import { LiveController } from "./live.controller";
import { LiveService } from "./live.service";
import { LiveBookingService } from "./live-booking.service";
import { SimulcastService } from "./simulcast.service";

@Module({
  controllers: [LiveController],
  providers: [LiveGateway, LiveService, LiveBookingService, SimulcastService],
})
export class LiveModule {}
