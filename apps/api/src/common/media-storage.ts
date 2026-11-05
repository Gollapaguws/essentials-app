import { BadRequestException } from "@nestjs/common";
import { randomBytes } from "crypto";
import { mkdirSync, writeFileSync } from "fs";
import { extname, join } from "path";

/** Upload limits for account/profile photos, shared by every avatar endpoint. */
export const MAX_PROFILE_IMAGE_BYTES = 5 * 1024 * 1024;
export const PROFILE_IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".avif"] as const;

export interface ImageStorageOptions {
  /** Directory the API writes uploads to (MEDIA_DIR). */
  mediaDir: string;
  /** Public base the directory is served from: an absolute URL or a path such as /media. */
  publicBase: string;
  /** Origin of the current request, used when publicBase is a path. */
  origin: string;
}

/**
 * Validate an uploaded image, store it under mediaDir and return the absolute
 * URL to persist. Callers own any old file they are replacing.
 */
export function storeImage(file: Express.Multer.File, { mediaDir, publicBase, origin }: ImageStorageOptions) {
  const ext = extname(file.originalname).toLowerCase();
  if (!(PROFILE_IMAGE_EXTENSIONS as readonly string[]).includes(ext) || !file.mimetype.startsWith("image/")) {
    throw new BadRequestException("Only jpg/png/webp/avif images are supported");
  }
  if (file.size > MAX_PROFILE_IMAGE_BYTES) {
    throw new BadRequestException("Photos must be 5 MB or smaller");
  }

  mkdirSync(mediaDir, { recursive: true });
  const name = `${Date.now()}-${randomBytes(4).toString("hex")}${ext}`;
  writeFileSync(join(mediaDir, name), file.buffer);

  // A relative media base is resolved against the API host so the URL works off-site (mobile, email).
  const base = publicBase.startsWith("http")
    ? publicBase
    : `${origin}${publicBase.startsWith("/") ? "" : "/"}${publicBase}`;
  return { name, url: `${base}/${name}` };
}
