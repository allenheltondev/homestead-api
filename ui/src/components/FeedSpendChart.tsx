import type { ReactElement } from 'react';
import { useMemo } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { FeedStats } from '../api/types';
import { formatMoney } from './format';

interface Props {
  byType: FeedStats['byType'];
}

// Feed spend broken down by feed type. Mirrors ClicksChart's themed-recharts
// approach but renders cost-per-type bars.
export default function FeedSpendChart({ byType }: Props): ReactElement {
  const data = useMemo(
    () =>
      Object.entries(byType)
        .map(([type, b]) => ({ type, cost: b.cost }))
        .sort((a, b) => b.cost - a.cost),
    [byType],
  );

  if (data.length === 0) {
    return (
      <p className="rounded-md bg-muted text-muted-foreground text-sm text-center py-6">
        No feed purchases in this period.
      </p>
    );
  }

  return (
    <div className="card card-body">
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--border))" />
          <XAxis dataKey="type" tick={{ fontSize: 12, fill: 'rgb(var(--muted-foreground))' }} />
          <YAxis
            tick={{ fontSize: 12, fill: 'rgb(var(--muted-foreground))' }}
            tickFormatter={(v: number) => abbreviate(v)}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: 'rgb(var(--surface))',
              border: '1px solid rgb(var(--border))',
              borderRadius: 8,
              fontSize: 12,
            }}
            formatter={(value) => [
              formatMoney(typeof value === 'number' ? value : Number(value) || 0),
              'Spend',
            ]}
          />
          <Bar dataKey="cost" fill="rgb(var(--primary-600))" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function abbreviate(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)}k`;
  return String(v);
}
