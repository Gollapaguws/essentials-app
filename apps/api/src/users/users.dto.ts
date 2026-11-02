import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";
import type { Role } from "@essentials/db";
import { ASSIGNABLE_ROLES } from "./users.service";

/**
 * Role change plus the profile that role needs. `stageName` applies to a DJ
 * (`artist`), `venue*` to a venue manager — both optional, so a plain role
 * change still works.
 */
export class SetRoleDto {
  @IsIn(ASSIGNABLE_ROLES as unknown as string[])
  role!: Role;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  stageName?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  venueName?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  venueCapacity?: number;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  venueAddress?: string;

  @IsOptional()
  @IsNumber()
  venueLat?: number;

  @IsOptional()
  @IsNumber()
  venueLng?: number;
}

/**
 * Post-assignment edits: rename or clear a DJ stage name / venue without
 * touching the role. `clear*` flags are explicit so an empty string can never
 * delete data by accident.
 */
export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  stageName?: string;

  @IsOptional()
  @IsBoolean()
  clearStageName?: boolean;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  venueName?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  venueCapacity?: number;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  venueAddress?: string;

  @IsOptional()
  @IsNumber()
  venueLat?: number;

  @IsOptional()
  @IsNumber()
  venueLng?: number;

  @IsOptional()
  @IsBoolean()
  clearVenue?: boolean;
}
