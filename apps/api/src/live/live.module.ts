import { Module } from "@nestjs/common";
import { LiveGateway } from "./live.gateway";
import { LiveController } from "./live.controller";
import { LiveService } from "./live.service";
import { SimulcastService } from "./simulcast.service";

@Module({ controllers: [LiveController], providers: [LiveGateway, LiveService, SimulcastService] })
export class LiveModule {}
