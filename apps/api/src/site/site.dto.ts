import { IsString, MaxLength } from "class-validator";

export class SiteVisitDto {
  @IsString() @MaxLength(100) path!: string;
}
