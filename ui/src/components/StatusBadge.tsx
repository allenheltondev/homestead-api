import type { ReactElement } from 'react';
import type { StatusTone } from './statusTone';

interface Props {
  label: string;
  tone?: StatusTone;
}

const toneClass: Record<StatusTone, string> = {
  success: 'bg-success-100 text-success-700',
  warning: 'bg-warning-100 text-warning-700',
  error: 'bg-error-100 text-error-700',
  muted: 'bg-muted text-muted-foreground',
  primary: 'bg-primary-100 text-primary-700',
};

// A small pill for status labels (listing active/claimed/expired, claim
// pending/confirmed, planting status). No badge utility exists in the shared
// CSS, so the pill styling lives here for reuse across the garden screens.
export default function StatusBadge({ label, tone = 'muted' }: Props): ReactElement {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${toneClass[tone]}`}
    >
      {label}
    </span>
  );
}
