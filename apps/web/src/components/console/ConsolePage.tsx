import type { ReactNode } from "react";
import { TopNav } from "@/components/TopNav";

const widths = {
  md: "max-w-4xl",
  lg: "max-w-5xl",
  xl: "max-w-6xl",
  full: "max-w-7xl",
} as const;

/** One frame for every dashboard screen: rail, content width and vertical rhythm. */
export function ConsolePage({
  children,
  size = "xl",
  className = "",
}: {
  children: ReactNode;
  size?: keyof typeof widths;
  className?: string;
}) {
  return (
    <>
      <TopNav />
      <main className={`console-page ${widths[size]} ${className}`}>{children}</main>
    </>
  );
}
