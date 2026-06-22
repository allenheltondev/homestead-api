import type { ReactElement, ReactNode } from 'react';

interface Props {
  title: string;
  // Optional supporting line under the title.
  subtitle?: ReactNode;
  // Optional trailing controls (buttons, links) aligned to the right of the title.
  actions?: ReactNode;
}

// Shared page header so every route renders its title (and optional subtitle /
// actions) with the same markup and spacing. Mirrors the pattern the pages
// already hand-rolled: a flex row with the heading block on the left and any
// action controls on the right.
export default function PageHeader({ title, subtitle, actions }: Props): ReactElement {
  return (
    <header className="flex items-start justify-between gap-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold text-foreground">{title}</h1>
        {subtitle && <p className="text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </header>
  );
}
