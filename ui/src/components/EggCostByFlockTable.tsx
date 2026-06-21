import type { ReactElement } from 'react';

import type { EggCostByFlockRow } from '../api/types';

interface Props {
  rows: EggCostByFlockRow[];
}

// Formats a USD amount with cents — cost-per-dozen figures are small, so the
// whole-dollar formatMoney helper isn't precise enough here.
function money(amount: number): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: 'USD',
    }).format(amount);
  } catch {
    return `$${amount.toFixed(2)}`;
  }
}

// Per-flock cost-per-dozen breakdown: dozens produced, poultry feed spend, and
// the resulting cost per dozen (with the refined consumption basis when known).
export default function EggCostByFlockTable({ rows }: Props): ReactElement {
  if (rows.length === 0) {
    return (
      <p className="rounded-md bg-muted text-muted-foreground text-sm text-center py-6">
        No per-flock data yet. Tag egg collections and poultry feed with a flock to compare cost
        per dozen.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="data-table">
        <thead>
          <tr>
            <th>Flock</th>
            <th>Dozens</th>
            <th>Feed spend</th>
            <th>Cost / dozen</th>
            <th>Consumption basis</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.flock}>
              <td className="font-medium text-foreground">{r.flock}</td>
              <td className="text-muted-foreground">{r.dozens.toLocaleString()}</td>
              <td className="text-muted-foreground">{money(r.poultryFeedSpend)}</td>
              <td>{money(r.costPerDozen)}</td>
              <td className="text-muted-foreground">
                {r.consumptionBasis == null ? '—' : money(r.consumptionBasis)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
