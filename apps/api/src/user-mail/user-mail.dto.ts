import { IsIn, IsOptional, IsString, MaxLength, MinLength } from "class-validator";

export class CreateMailboxDto {
  /** Optional local part; defaults to the sign-in address's local part. */
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  localpart?: string;
}

export class SetMailboxStatusDto {
  @IsIn(["active", "disabled"])
  status!: "active" | "disabled";
}
