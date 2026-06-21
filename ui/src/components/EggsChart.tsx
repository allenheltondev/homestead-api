import type { ReactElement } from 'react';
import { useMemo } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { EggCollection } from '../api/types';
import { formatShortDate } from './format';

interface Props {
  collections: EggCollection[];
}

// Eggs collected over time. Aggregates collections by day and renders a themed
// recharts area, mirroring the CSS-custom-property styling used by the herd and
// feed-spend charts.
export default function EggsChart({ collections }: Props): ReactElement {
  const data = useMemo(() => {
    const byDay = new Map<string, number>();
    for (const c of collections) {
      const day = c.date.slice(0, 10);
      byDay.set(day, (byDay.get(day) ?? 0) + c.count);
    }
    return [...byDay.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, count]) => ({ date, count }));
  }, [collections]);

  if (data.length === 0) {
    return (
      <p className="rounded-md bg-muted text-muted-foreground text-sm text-center py-6">
        No egg collections in this period.
      </p>
    );
  }

  return (
    <div className="card card-body">
      <ResponsiveContainer width="100%" height={260}>
        <AreaChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <defs>
            <linearGradient id="eggsGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgb(var(--primary-600))" stopOpacity={0.35} />
              <stop offset="100%" stopColor="rgb(var(--primary-600))" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--border))" />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 12, fill: 'rgb(var(--muted-foreground))' }}
            tickFormatter={(v: string) => formatShortDate(v)}
          />
          <YAxis
            allowDecimals={false}
            tick={{ fontSize: 12, fill: 'rgb(var(--muted-foreground))' }}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: 'rgb(var(--surface))',
              border: '1px solid rgb(var(--border))',
              borderRadius: 8,
              fontSize: 12,
            }}
            labelFormatter={(label) => formatShortDate(String(label))}
            formatter={(value) => [
              typeof value === 'number' ? value : Number(value) || 0,
              'Eggs',
            ]}
          />
          <Area
            type="monotone"
            dataKey="count"
            stroke="rgb(var(--primary-600))"
            strokeWidth={2}
            fill="url(#eggsGradient)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
