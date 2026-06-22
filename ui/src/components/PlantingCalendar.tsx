import type { ReactElement } from 'react';
import { useMemo } from 'react';
import type { Planting } from '../api/types';
import StatusBadge from './StatusBadge';
import { plantingTone } from './statusTone';

interface Props {
  plantings: Planting[];
  year: number;
}

const MONTHS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];

// Returns the 0-based month index for an ISO date within the given year, or
// null when the date is missing or falls outside the year.
function monthIn(year: number, iso: string | null): number | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})/.exec(iso);
  if (!m) return null;
  if (Number(m[1]) !== year) return null;
  return Number(m[2]) - 1;
}

// A compact 12-month timeline. Each planting renders a bar spanning sow (or
// transplant) through harvest (or expected harvest), so the whole season reads
// at a glance without a heavyweight calendar widget.
export default function PlantingCalendar({ plantings, year }: Props): ReactElement {
  const rows = useMemo(() => {
    return plantings
      .map((p) => {
        const start =
          monthIn(year, p.sowDate) ??
          monthIn(year, p.transplantDate) ??
          monthIn(year, p.expectedHarvestDate);
        const end =
          monthIn(year, p.harvestDate) ??
          monthIn(year, p.expectedHarvestDate) ??
          monthIn(year, p.transplantDate) ??
          start;
        if (start === null) return null;
        const lo = Math.min(start, end ?? start);
        const hi = Math.max(start, end ?? start);
        return { planting: p, lo, hi };
      })
      .filter((r): r is { planting: Planting; lo: number; hi: number } => r !== null)
      .sort((a, b) => a.lo - b.lo || b.hi - a.hi);
  }, [plantings, year]);

  if (rows.length === 0) {
    return (
      <p className="rounded-md bg-muted text-muted-foreground text-sm text-center py-6">
        No plantings with dates in {year}. Add sow or harvest dates to see them here.
      </p>
    );
  }

  return (
    <div className="card card-body overflow-x-auto">
      <div className="min-w-[640px] space-y-1">
        <div className="grid grid-cols-[10rem_repeat(12,1fr)] gap-1 text-xs text-muted-foreground">
          <span />
          {MONTHS.map((m, i) => (
            <span key={i} className="text-center">
              {m}
            </span>
          ))}
        </div>
        {rows.map(({ planting, lo, hi }) => (
          <div
            key={planting.id}
            className="grid grid-cols-[10rem_repeat(12,1fr)] gap-1 items-center"
          >
            <span className="truncate text-sm text-foreground" title={planting.crop}>
              {planting.crop}
              {planting.variety ? (
                <span className="text-muted-foreground"> · {planting.variety}</span>
              ) : null}
            </span>
            {MONTHS.map((_, i) => {
              const active = i >= lo && i <= hi;
              return (
                <span
                  key={i}
                  className={`h-4 rounded-sm ${active ? 'bg-primary-500' : 'bg-muted'}`}
                  aria-hidden
                />
              );
            })}
          </div>
        ))}
      </div>
      <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-1">
        {rows.slice(0, 12).map(({ planting }) => (
          <li key={planting.id} className="text-xs text-muted-foreground flex items-center gap-1">
            <span className="text-foreground">{planting.crop}</span>
            <StatusBadge label={planting.status} tone={plantingTone(planting.status)} />
          </li>
        ))}
      </ul>
    </div>
  );
}
