import type { ReactElement } from 'react';
import { useMemo } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { SummaryHerdSpecies } from '../api/types';

interface Props {
  bySpecies: SummaryHerdSpecies[];
}

// A stacked-by-status bar chart of herd composition per species. Mirrors the
// charting approach in the content-tracking RevenueChart (recharts, themed
// via CSS custom properties) but for animal counts.
export default function HerdChart({ bySpecies }: Props): ReactElement {
  const data = useMemo(
    () =>
      bySpecies.map((s) => ({
        species: s.species,
        active: s.active,
        other: Math.max(0, s.total - s.active),
      })),
    [bySpecies],
  );

  const hasAnyData = data.some((d) => d.active > 0 || d.other > 0);
  if (!hasAnyData) {
    return (
      <p className="rounded-md bg-muted text-muted-foreground text-sm text-center py-6">
        No animals recorded yet.
      </p>
    );
  }

  return (
    <div className="card card-body">
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={data} margin={{ top: 16, right: 16, bottom: 8, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--border))" />
          <XAxis dataKey="species" tick={{ fontSize: 12, fill: 'rgb(var(--muted-foreground))' }} />
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
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="active" stackId="herd" name="Active" fill="rgb(var(--primary-600))" />
          <Bar
            dataKey="other"
            stackId="herd"
            name="Sold / deceased"
            fill="rgb(var(--secondary-400))"
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
