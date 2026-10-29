import { Module } from "@nestjs/common";
import { ArtistsController } from "./artists.controller";
import { ArtistsService } from "./artists.service";
import { InvoicesController } from "./invoices.controller";
import { InvoicesService } from "./invoices.service";

@Module({ controllers: [ArtistsController, InvoicesController], providers: [ArtistsService, InvoicesService] })
export class ArtistsModule {}
