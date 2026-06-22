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
import type { HarvestByCropRow } from '../api/types';

interface Props {
  byCrop: HarvestByCropRow[];
}

// Yield by crop. Quantities can be in mixed units across crops, so each bar is
// labelled with its own unit in the tooltip. Mirrors the themed recharts
// styling used by the feed-spend and P&L charts.
export default function HarvestYieldChart({ byCrop }: Props): ReactElement {
  const data = useMemo(
    () =>
      [...byCrop]
        .sort((a, b) => b.quantity - a.quantity)
        .slice(0, 12)
        .map((r) => ({ crop: r.crop, quantity: r.quantity, unit: r.unit })),
    [byCrop],
  );

  if (data.length === 0) {
    return (
      <p className="rounded-md bg-muted text-muted-foreground text-sm text-center py-6">
        No harvests logged in this period.
      </p>
    );
  }

  return (
    <div className="card card-body">
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--border))" />
          <XAxis
            dataKey="crop"
            tick={{ fontSize: 12, fill: 'rgb(var(--muted-foreground))' }}
            interval={0}
            angle={-20}
            textAnchor="end"
            height={50}
          />
          <YAxis tick={{ fontSize: 12, fill: 'rgb(var(--muted-foreground))' }} />
          <Tooltip
            contentStyle={{
              backgroundColor: 'rgb(var(--surface))',
              border: '1px solid rgb(var(--border))',
              borderRadius: 8,
              fontSize: 12,
            }}
            formatter={(value, _name, item) => {
              const unit = (item?.payload as { unit?: string } | undefined)?.unit ?? '';
              const qty = typeof value === 'number' ? value : Number(value) || 0;
              return [`${qty.toLocaleString()} ${unit}`.trim(), 'Yield'];
            }}
          />
          <Bar
            dataKey="quantity"
            name="Yield"
            fill="rgb(var(--primary-600))"
            radius={[4, 4, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
