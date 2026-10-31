import { Module } from "@nestjs/common";
import { LiveGateway } from "./live.gateway";
import { LiveController } from "./live.controller";
import { LiveService } from "./live.service";

@Module({ controllers: [LiveController], providers: [LiveGateway, LiveService] })
export class LiveModule {}
