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
import type { MortalityCauseBreakdown } from '../api/types';

interface Props {
  byCause: MortalityCauseBreakdown[];
}

// Deaths-by-cause bar chart. Mirrors the themed-recharts approach used by the
// herd and feed-spend charts.
export default function MortalityChart({ byCause }: Props): ReactElement {
  const data = useMemo(
    () =>
      byCause
        .map((c) => ({ cause: c.cause || 'Unknown', count: c.count }))
        .sort((a, b) => b.count - a.count),
    [byCause],
  );

  if (data.length === 0) {
    return (
      <p className="rounded-md bg-muted text-muted-foreground text-sm text-center py-6">
        No deaths recorded in this period.
      </p>
    );
  }

  return (
    <div className="card card-body">
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--border))" />
          <XAxis dataKey="cause" tick={{ fontSize: 12, fill: 'rgb(var(--muted-foreground))' }} />
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
            formatter={(value) => [
              typeof value === 'number' ? value : Number(value) || 0,
              'Deaths',
            ]}
          />
          <Bar dataKey="count" fill="rgb(var(--secondary-400))" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
