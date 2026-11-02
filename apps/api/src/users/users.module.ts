import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ArtistsModule } from "../artists/artists.module";
import { UsersController } from "./users.controller";
import { UsersService } from "./users.service";

@Module({
  imports: [AuthModule, ArtistsModule],
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
