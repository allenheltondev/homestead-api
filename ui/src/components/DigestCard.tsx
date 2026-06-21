import type { ReactElement } from 'react';
import type { DigestStats } from '../api/types';
import { formatMoney } from './format';

interface Props {
  digest: DigestStats;
}

// "This week" rollup card: headline numbers plus the server-rendered summary
// lines. Lives on the dashboard.
export default function DigestCard({ digest }: Props): ReactElement {
  const lossPct = Math.round(digest.mortality.lossRate * 1000) / 10;

  return (
    <div className="card">
      <div className="card-header flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-foreground">This week</h2>
        <span className="text-xs text-muted-foreground">{digest.period}</span>
      </div>
      <div className="card-body space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Headline label="Eggs" value={digest.eggs.toLocaleString()} />
          <Headline label="Feed spend" value={formatMoney(digest.feedSpend)} />
          <Headline label="Births" value={String(digest.births)} />
          <Headline
            label="Deaths"
            value={String(digest.deaths)}
            accent={digest.deaths > 0 ? 'warning' : undefined}
          />
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 border-t border-border pt-3">
          <Headline
            label="Feed on hand"
            value={`${Math.round(digest.feedOnHandLbs).toLocaleString()} lb`}
          />
          <Headline
            label="Days remaining"
            value={digest.daysRemaining == null ? '—' : String(digest.daysRemaining)}
            accent={
              digest.daysRemaining != null && digest.daysRemaining <= 7 ? 'warning' : undefined
            }
          />
          <Headline
            label="Loss rate"
            value={`${lossPct}%`}
            accent={digest.mortality.totalDeaths > 0 ? 'warning' : undefined}
          />
        </div>

        {digest.lines.length > 0 && (
          <ul className="space-y-1.5 border-t border-border pt-3">
            {digest.lines.map((line, i) => (
              <li key={i} className="text-sm text-muted-foreground flex gap-2">
                <span aria-hidden className="text-primary-600">
                  •
                </span>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Headline({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: 'warning';
}): ReactElement {
  const valueColor = accent === 'warning' ? 'text-warning-700' : 'text-foreground';
  return (
    <div>
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className={`block text-xl font-semibold mt-0.5 ${valueColor}`}>{value}</span>
    </div>
  );
}
