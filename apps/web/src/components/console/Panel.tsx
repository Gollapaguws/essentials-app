import type { ReactNode } from "react";

export function Panel({
  title,
  description,
  actions,
  children,
  flush = false,
  className = "",
}: {
  title?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  flush?: boolean;
  className?: string;
}) {
  return (
    <section className={`console-panel ${className}`}>
      {(title || actions) && (
        <div className="console-panel-head">
          <div className="min-w-0 space-y-1">
            {title && <h2 className="console-section-title">{title}</h2>}
            {description && <p className="text-xs leading-5 text-neutral-500">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={flush ? "" : "console-panel-body"}>{children}</div>
    </section>
  );
}
