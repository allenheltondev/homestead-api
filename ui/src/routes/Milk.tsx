import type { ReactElement } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useApiFetch, ApiError } from '../auth/useApiFetch';
import { createMilkLog, deleteMilkLog, listMilkLogs } from '../api/milk';
import { getMilkCost } from '../api/stats';
import type { CreateMilkLogRequest, MilkCostStats, MilkLog } from '../api/types';
import Modal from '../components/Modal';
import { formatShortDate } from '../components/format';

function gallons(n: number): string {
  return `${n.toLocaleString(undefined, { maximumFractionDigits: 2 })} gal`;
}

function money(amount: number): string {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(
      amount,
    );
  } catch {
    return `$${amount.toFixed(2)}`;
  }
}

export default function Milk(): ReactElement {
  const apiFetch = useApiFetch();
  const [logs, setLogs] = useState<MilkLog[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cost, setCost] = useState<MilkCostStats | null>(null);

  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const [createOpen, setCreateOpen] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [deletingId, setDeletingId] = useState<string | null>(null);

  const reload = useCallback((): (() => void) => {
    let cancelled = false;
    setError(null);
    setLogs(null);
    listMilkLogs(apiFetch, { from: from || undefined, to: to || undefined })
      .then((res) => {
        if (!cancelled) setLogs(res.milk_logs);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });

    // Best-effort: the cost-per-gallon card is independent of the history list.
    getMilkCost(apiFetch)
      .then((res) => {
        if (!cancelled) setCost(res);
      })
      .catch(() => {
        if (!cancelled) setCost(null);
      });

    return () => {
      cancelled = true;
    };
  }, [apiFetch, from, to]);

  useEffect(() => reload(), [reload]);

  const chartData = useMemo(() => {
    if (!logs) return [];
    const byDay = new Map<string, number>();
    for (const l of logs) {
      const day = l.date.slice(0, 10);
      byDay.set(day, (byDay.get(day) ?? 0) + l.gallons);
    }
    return [...byDay.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, value]) => ({ date, gallons: Math.round(value * 100) / 100 }));
  }, [logs]);

  const totals = useMemo(() => {
    if (!logs) return { total: 0, count: 0 };
    const total = logs.reduce((sum, l) => sum + l.gallons, 0);
    return { total: Math.round(total * 100) / 100, count: logs.length };
  }, [logs]);

  const handleCreate = async (payload: CreateMilkLogRequest): Promise<void> => {
    setCreateBusy(true);
    setCreateError(null);
    try {
      await createMilkLog(apiFetch, payload);
      setCreateOpen(false);
      reload();
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : (err as Error).message);
    } finally {
      setCreateBusy(false);
    }
  };

  const handleDelete = async (id: string): Promise<void> => {
    setDeletingId(id);
    try {
      await deleteMilkLog(apiFetch, id);
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <section className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold text-foreground">Milk</h1>
          <p className="text-muted-foreground">
            Log milkings and track your cost per gallon.
          </p>
        </div>
        <button
          type="button"
          className="btn-primary"
          onClick={() => {
            setCreateError(null);
            setCreateOpen(true);
          }}
        >
          Log milking
        </button>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">Cost per gallon</h2>
          {cost ? (
            <div className="card card-body space-y-4">
              <div className="flex items-baseline justify-between gap-3">
                <div>
                  <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Cost per gallon
                  </span>
                  <span className="block text-3xl font-semibold text-foreground mt-1">
                    {money(cost.costPerGallon)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {gallons(cost.gallons)} from {money(cost.feedSpend)} dairy feed
                  </span>
                </div>
                <span
                  className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${
                    cost.cheaperThanStore
                      ? 'bg-success-100 text-success-700'
                      : 'bg-warning-100 text-warning-700'
                  }`}
                >
                  {cost.cheaperThanStore ? 'Cheaper than store' : 'Pricier than store'}
                </span>
              </div>
              <p className="text-sm text-muted-foreground">
                {cost.cheaperThanStore ? 'You save' : 'You pay'}{' '}
                <span
                  className={`font-medium ${
                    cost.cheaperThanStore ? 'text-success-700' : 'text-warning-700'
                  }`}
                >
                  {money(Math.abs(cost.savingsPerGallon))}
                </span>{' '}
                per gallon vs. a store price of {money(cost.storePricePerGallon)}.
              </p>
            </div>
          ) : (
            <p className="rounded-md bg-muted text-muted-foreground text-sm text-center py-6">
              Cost analytics are unavailable right now.
            </p>
          )}
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">Gallons per day</h2>
          {logs === null ? (
            <p className="text-muted-foreground">Loading...</p>
          ) : chartData.length === 0 ? (
            <p className="rounded-md bg-muted text-muted-foreground text-sm text-center py-6">
              No milkings in this period.
            </p>
          ) : (
            <div className="card card-body">
              <ResponsiveContainer width="100%" height={260}>
                <AreaChart data={chartData} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                  <defs>
                    <linearGradient id="milkGradient" x1="0" y1="0" x2="0" y2="1">
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
                  <YAxis tick={{ fontSize: 12, fill: 'rgb(var(--muted-foreground))' }} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'rgb(var(--surface))',
                      border: '1px solid rgb(var(--border))',
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                    labelFormatter={(label) => formatShortDate(String(label))}
                    formatter={(value) => [gallons(Number(value) || 0), 'Milk']}
                  />
                  <Area
                    type="monotone"
                    dataKey="gallons"
                    stroke="rgb(var(--primary-600))"
                    strokeWidth={2}
                    fill="url(#milkGradient)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">From</span>
          <input
            type="date"
            className="input w-auto py-1.5"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">To</span>
          <input
            type="date"
            className="input w-auto py-1.5"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        {(from || to) && (
          <button
            type="button"
            className="btn-ghost btn-sm"
            onClick={() => {
              setFrom('');
              setTo('');
            }}
          >
            Clear
          </button>
        )}
      </div>

      {logs && logs.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          <Tile label="Total milk" value={gallons(totals.total)} />
          <Tile label="Milkings" value={String(totals.count)} />
        </div>
      )}

      {error && <p className="form-error">{error}</p>}
      {logs === null && !error && <p className="text-muted-foreground">Loading...</p>}
      {logs && logs.length === 0 && (
        <p className="text-muted-foreground text-sm">No milkings match these filters.</p>
      )}
      {logs && logs.length > 0 && (
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Gallons</th>
                <th>Animal</th>
                <th>Note</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id}>
                  <td className="text-muted-foreground">{formatShortDate(l.date)}</td>
                  <td>{gallons(l.gallons)}</td>
                  <td className="text-muted-foreground">{l.animalRef ?? '—'}</td>
                  <td className="text-muted-foreground">{l.note ?? '—'}</td>
                  <td className="text-right">
                    <button
                      type="button"
                      className="btn-link text-error-600 hover:text-error-700"
                      onClick={() => void handleDelete(l.id)}
                      disabled={deletingId === l.id}
                    >
                      {deletingId === l.id ? 'Removing...' : 'Delete'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={createOpen}
        title="Log milking"
        onClose={() => (!createBusy ? setCreateOpen(false) : undefined)}
      >
        <MilkLogForm
          busy={createBusy}
          serverError={createError}
          onSubmit={(p) => void handleCreate(p)}
          onCancel={() => setCreateOpen(false)}
        />
      </Modal>
    </section>
  );
}

function Tile({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div className="card card-body !py-3">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="text-2xl font-semibold text-foreground mt-1 block">{value}</span>
    </div>
  );
}

interface FormProps {
  busy: boolean;
  serverError: string | null;
  onSubmit: (payload: CreateMilkLogRequest) => void;
  onCancel: () => void;
}

function MilkLogForm({ busy, serverError, onSubmit, onCancel }: FormProps): ReactElement {
  const [gallonsField, setGallonsField] = useState('');
  const [animalRef, setAnimalRef] = useState('');
  const [date, setDate] = useState('');
  const [note, setNote] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);

  const submit = (): void => {
    setValidationError(null);
    const value = Number(gallonsField);
    if (!Number.isFinite(value) || value <= 0) {
      setValidationError('Gallons must be a positive number.');
      return;
    }
    const payload: CreateMilkLogRequest = { gallons: value };
    if (date) payload.date = date;
    const ref = animalRef.trim();
    if (ref.length > 0) payload.animalRef = ref;
    const noteText = note.trim();
    if (noteText.length > 0) payload.note = noteText;
    onSubmit(payload);
  };

  return (
    <div className="card card-body space-y-3 max-w-2xl">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="field-label">Gallons</span>
          <input
            type="number"
            min="0"
            step="0.1"
            className="input"
            value={gallonsField}
            onChange={(e) => setGallonsField(e.target.value)}
            disabled={busy}
            autoFocus
          />
        </label>
        <label className="block">
          <span className="field-label">Animal</span>
          <input
            type="text"
            className="input"
            value={animalRef}
            onChange={(e) => setAnimalRef(e.target.value)}
            placeholder="Optional — name or tag"
            disabled={busy}
          />
        </label>
      </div>

      <label className="block">
        <span className="field-label">Note</span>
        <input
          type="text"
          className="input"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Optional"
          disabled={busy}
        />
      </label>

      <label className="block">
        <span className="field-label">Milked on</span>
        <input
          type="date"
          className="input"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          disabled={busy}
        />
        <span className="field-hint mt-1 block">Defaults to today if left blank.</span>
      </label>

      {validationError && <p className="form-error">{validationError}</p>}
      {serverError && <p className="form-error">{serverError}</p>}

      <div className="flex justify-end gap-2 pt-2">
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="button" className="btn-primary" onClick={submit} disabled={busy}>
          {busy ? 'Saving...' : 'Log milking'}
        </button>
      </div>
    </div>
  );
}
