import { IsEmail, IsIn, IsString, MaxLength, MinLength } from "class-validator";
import type { Role } from "@essentials/db";

/** The roles an organisation member may hold. Mirrors the platform role set. */
export const MEMBER_ROLES: readonly Role[] = [
  "admin",
  "promoter",
  "venue_manager",
  "door",
  "artist",
  "guest",
];

export class CreateOrganisationDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;
}

export class AddOrganisationMemberDto {
  @IsEmail()
  email!: string;

  @IsIn(MEMBER_ROLES as unknown as string[])
  role!: Role;
}
