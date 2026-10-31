import { IsIn, IsOptional } from "class-validator";

export type AuthSurface = "web" | "site" | "mobile";

export class SessionEstablishedDto {
  @IsOptional()
  @IsIn(["web", "site", "mobile"])
  surface?: AuthSurface;
}
