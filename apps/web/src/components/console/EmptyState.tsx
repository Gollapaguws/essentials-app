import type { ReactNode } from "react";

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="console-empty">
      <p className="text-sm font-bold text-fg">{title}</p>
      {description && <p className="mx-auto mt-1 max-w-md text-xs leading-5 text-muted">{description}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}
