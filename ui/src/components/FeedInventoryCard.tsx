import type { ReactElement } from 'react';
import type { FeedInventoryRow } from '../api/types';
import { formatMoney, formatShortDate } from './format';

interface Props {
  row: FeedInventoryRow;
}

// Days-remaining threshold below which a feed type is flagged as running low.
const LOW_DAYS = 14;

function lbs(value: number): string {
  return `${Math.round(value).toLocaleString()} lb`;
}

// Per-feed-type inventory card: on-hand quantity and value, burn rate, days
// remaining, and projected run-out date. Highlights types running low/out soon.
export default function FeedInventoryCard({ row }: Props): ReactElement {
  const low =
    row.onHandLbs <= 0 || (row.daysRemaining !== null && row.daysRemaining <= LOW_DAYS);
  const out = row.onHandLbs <= 0;

  return (
    <div
      className={`card card-body space-y-3 ${
        low ? 'border-warning-300 ring-1 ring-warning-200' : ''
      }`}
    >
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {row.feedType}
          </span>
          <span className="block text-3xl font-semibold text-foreground mt-1">
            {lbs(row.onHandLbs)}
          </span>
          <span className="text-xs text-muted-foreground">on hand</span>
        </div>
        {low && (
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${
              out ? 'bg-error-100 text-error-700' : 'bg-warning-100 text-warning-700'
            }`}
          >
            {out ? 'Out of stock' : 'Running low'}
          </span>
        )}
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm border-t border-border pt-3">
        <div>
          <dt className="text-muted-foreground">On-hand value</dt>
          <dd className="font-medium text-foreground">{formatMoney(row.onHandValue)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Burn rate</dt>
          <dd className="font-medium text-foreground">
            {row.burnRateLbsPerDay > 0
              ? `${row.burnRateLbsPerDay.toLocaleString(undefined, {
                  maximumFractionDigits: 1,
                })} lb/day`
              : '—'}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Days remaining</dt>
          <dd
            className={`font-medium ${
              low ? 'text-warning-700' : 'text-foreground'
            }`}
          >
            {row.daysRemaining === null ? '—' : `${Math.round(row.daysRemaining)} days`}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Runs out</dt>
          <dd
            className={`font-medium ${
              low ? 'text-warning-700' : 'text-foreground'
            }`}
          >
            {formatShortDate(row.projectedRunOutDate)}
          </dd>
        </div>
      </dl>
    </div>
  );
}
