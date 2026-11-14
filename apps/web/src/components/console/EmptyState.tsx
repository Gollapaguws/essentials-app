import type { ReactNode } from "react";

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="console-empty">
      <p className="text-sm font-bold text-neutral-300">{title}</p>
      {description && <p className="mx-auto mt-1 max-w-md text-xs leading-5 text-neutral-500">{description}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}
