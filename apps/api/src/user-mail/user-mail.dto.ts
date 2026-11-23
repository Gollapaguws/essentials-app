import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from "class-validator";

export class CreateMailboxDto {
  /** Optional local part; defaults to the sign-in address's local part. */
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  localpart?: string;
}

export class SetOwnMailboxPasswordDto {
  /** Chosen by the mailbox owner; no confirmation field is sent to the server. */
  @IsString()
  @MinLength(10)
  @MaxLength(72)
  password!: string;
}

export class SetMailboxStatusDto {
  @IsIn(["active", "disabled"])
  status!: "active" | "disabled";
}

export class SetAliasesDto {
  @IsArray()
  @ArrayMaxSize(5)
  @IsString({ each: true })
  @MaxLength(30, { each: true })
  aliases!: string[];
}

export class SetCatchAllDto {
  /** Bare mailbox address, or null/omitted to turn the catch-all off. */
  @IsOptional()
  @IsString()
  @MaxLength(254)
  address?: string | null;
}
