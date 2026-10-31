import { IsIn, IsOptional, IsString, MinLength } from "class-validator";

export type AuthSurface = "web" | "site" | "mobile";

export class SessionEstablishedDto {
  @IsOptional()
  @IsIn(["web", "site", "mobile"])
  surface?: AuthSurface;
}

/** The email is taken from the verified session; only the code is client input. */
export class RedeemInviteDto {
  @IsString()
  @MinLength(4)
  code!: string;
}
