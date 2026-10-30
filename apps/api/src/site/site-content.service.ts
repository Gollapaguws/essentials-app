import { Injectable, BadRequestException } from "@nestjs/common";
import { prisma } from "@essentials/db";
import { IsArray, IsIn, IsOptional, IsString, MaxLength, MinLength, validateSync } from "class-validator";

/** Editable front-page content schema (validated on save). */
export class FrontPageContent {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(300) tagline?: string;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(60) ctaLabel?: string;
  @IsOptional() @IsString() @MinLength(4) @MaxLength(40) city?: string;
  @IsOptional() @IsString() @MinLength(4) @MaxLength(120) quote?: string;
  @IsOptional() @IsString() @MaxLength(1200) manifestoP1?: string;
  @IsOptional() @IsString() @MaxLength(1200) manifestoP2?: string;
  @IsOptional() @IsArray() @MaxLength(50) events?: FrontPageEvent[];
  @IsOptional() @IsString() @MaxLength(120) footerLeft?: string;
  @IsOptional() @IsString() @MaxLength(120) footerRight?: string;
}

class FrontPageEvent {
  @IsString() @MinLength(2) @MaxLength(120) title!: string;
  @IsString() @MinLength(2) @MaxLength(60) displayDate!: string;
  @IsString() @MinLength(2) @MaxLength(60) city!: string;
  @IsString() @MinLength(2) @MaxLength(80) venue!: string;
  @IsString() @MinLength(2) @MaxLength(20) doors!: string;
  @IsString() @MinLength(2) @MaxLength(30) price!: string;
  @IsOptional() @IsIn(["ANNOUNCED", "SELLING FAST", "SOLD OUT", "FREE"]) status?: string;
}

const KEY = "front_page";

@Injectable()
export class SiteContentService {
  async get() {
    const row = await prisma.siteContent.findUnique({ where: { key: KEY } });
    return { ...(row ? (row.value as object) : {}), updatedAt: row?.updatedAt ?? null };
  }

  async save(input: FrontPageContent) {
    const errors = validateSync(input);
    if (errors.length) {
      throw new BadRequestException(errors.map((e) => Object.values(e.constraints ?? {})).flat());
    }
    const existing = await prisma.siteContent.findUnique({ where: { key: KEY } });
    const merged = { ...((existing?.value as object) ?? {}), ...input };
    const row = await prisma.siteContent.upsert({
      where: { key: KEY },
      update: { value: merged as object },
      create: { key: KEY, value: merged as object },
    });
    return { ok: true, value: row.value, updatedAt: row.updatedAt };
  }

  reset() {
    return prisma.siteContent.deleteMany({ where: { key: KEY } });
  }
}
