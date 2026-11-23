import { cn } from "@/lib/utils";

/**
 * The SONUS wordmark: engraved Roman capitals filled with the liquid gold
 * texture, drifting slowly so the metal catches the light.
 */
export default function GoldWordmark({ text = "SONUS", className = "" }) {
  return <span className={cn("cinema-wm", className)}>{text}</span>;
}