import type { ReactElement } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { useApiFetch, ApiError } from '../auth/useApiFetch';
import { getPnl } from '../api/stats';
import { createSale, deleteSale, listSales } from '../api/sales';
import type { CreateSaleRequest, PnlStats, Sale } from '../api/types';
import Modal from '../components/Modal';
import { formatMoney, formatShortDate } from '../components/format';

export default function Pnl(): ReactElement {
  const apiFetch = useApiFetch();
  const [pnl, setPnl] = useState<PnlStats | null>(null);
  const [pnlError, setPnlError] = useState<string | null>(null);

  const [sales, setSales] = useState<Sale[] | null>(null);
  const [salesError, setSalesError] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const reload = useCallback((): (() => void) => {
    let cancelled = false;
    setPnlError(null);
    setPnl(null);
    getPnl(apiFetch)
      .then((res) => {
        if (!cancelled) setPnl(res);
      })
      .catch((err: Error) => {
        if (!cancelled) setPnlError(err.message);
      });

    setSalesError(null);
    setSales(null);
    listSales(apiFetch)
      .then((res) => {
        if (!cancelled) setSales(res.sales);
      })
      .catch((err: Error) => {
        if (!cancelled) setSalesError(err.message);
      });

    return () => {
      cancelled = true;
    };
  }, [apiFetch]);

  useEffect(() => reload(), [reload]);

  const handleCreate = async (payload: CreateSaleRequest): Promise<void> => {
    setCreateBusy(true);
    setCreateError(null);
    try {
      await createSale(apiFetch, payload);
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
      await deleteSale(apiFetch, id);
      reload();
    } catch (err) {
      setSalesError(err instanceof ApiError ? err.message : (err as Error).message);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <section className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold text-foreground">Profit &amp; loss</h1>
          <p className="text-muted-foreground">
            Costs vs. outputs across your homestead, with a running net.
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
          Add sale
        </button>
      </header>

      {pnlError && <p className="form-error">Could not load P&amp;L: {pnlError}</p>}
      {pnl === null && !pnlError && <p className="text-muted-foreground">Loading...</p>}
      {pnl && <PnlSummary pnl={pnl} />}

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-lg font-semibold text-foreground">Sales</h2>
        </div>
        {salesError && <p className="form-error">{salesError}</p>}
        {sales === null && !salesError && <p className="text-muted-foreground">Loading...</p>}
        {sales && sales.length === 0 && (
          <p className="text-muted-foreground text-sm">
            No sales recorded yet. Add one to start building your revenue side.
          </p>
        )}
        {sales && sales.length > 0 && (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Category</th>
                  <th>Amount</th>
                  <th>Buyer</th>
                  <th>Note</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {sales.map((s) => (
                  <tr key={s.id}>
                    <td className="text-muted-foreground">{formatShortDate(s.date)}</td>
                    <td>{s.category}</td>
                    <td>{formatMoney(s.amount)}</td>
                    <td className="text-muted-foreground">{s.buyer ?? '—'}</td>
                    <td className="text-muted-foreground">{s.note ?? '—'}</td>
                    <td className="text-right">
                      <button
                        type="button"
                        className="btn-link text-error-600 hover:text-error-700"
                        onClick={() => void handleDelete(s.id)}
                        disabled={deletingId === s.id}
                      >
                        {deletingId === s.id ? 'Removing...' : 'Delete'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Modal
        open={createOpen}
        title="Add sale"
        onClose={() => (!createBusy ? setCreateOpen(false) : undefined)}
      >
        <SaleForm
          busy={createBusy}
          serverError={createError}
          onSubmit={(p) => void handleCreate(p)}
          onCancel={() => setCreateOpen(false)}
        />
      </Modal>
    </section>
  );
}

function PnlSummary({ pnl }: { pnl: PnlStats }): ReactElement {
  const chartData = useMemo(
    () => [
      { label: 'Costs', costs: pnl.totalCosts, revenue: 0 },
      { label: 'Revenue', costs: 0, revenue: pnl.totalRevenue },
    ],
    [pnl.totalCosts, pnl.totalRevenue],
  );
  const profitable = pnl.net >= 0;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Tile label="Total revenue" value={formatMoney(pnl.totalRevenue)} accent="success" />
        <Tile label="Total costs" value={formatMoney(pnl.totalCosts)} accent="warning" />
        <Tile
          label="Net"
          value={formatMoney(pnl.net)}
          accent={profitable ? 'success' : 'warning'}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">Costs vs. revenue</h2>
          <div className="card card-body">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={chartData} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--border))" />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 12, fill: 'rgb(var(--muted-foreground))' }}
                />
                <YAxis
                  tick={{ fontSize: 12, fill: 'rgb(var(--muted-foreground))' }}
                  tickFormatter={(v: number) => formatMoney(v)}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'rgb(var(--surface))',
                    border: '1px solid rgb(var(--border))',
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  formatter={(value) => formatMoney(Number(value) || 0)}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar
                  dataKey="revenue"
                  name="Revenue"
                  fill="rgb(var(--success-600))"
                  radius={[4, 4, 0, 0]}
                />
                <Bar
                  dataKey="costs"
                  name="Costs"
                  fill="rgb(var(--warning-600))"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">Breakdown</h2>
          <div className="grid grid-cols-1 gap-4">
            <BreakdownCard title="Revenue" rows={pnl.revenue} empty="No revenue logged." />
            <BreakdownCard title="Costs" rows={pnl.costs} empty="No costs logged." />
          </div>
        </section>
      </div>
    </div>
  );
}

function BreakdownCard({
  title,
  rows,
  empty,
}: {
  title: string;
  rows: PnlStats['costs'];
  empty: string;
}): ReactElement {
  return (
    <div className="card">
      <div className="card-header">
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
      </div>
      <div className="card-body">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{empty}</p>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((r) => (
              <li
                key={r.label}
                className="py-2 first:pt-0 last:pb-0 flex items-center justify-between gap-3"
              >
                <span className="text-sm text-foreground">{r.label}</span>
                <span className="text-sm font-medium text-foreground">
                  {formatMoney(r.amount)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Tile({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: 'success' | 'warning';
}): ReactElement {
  const valueColor =
    accent === 'warning'
      ? 'text-warning-700'
      : accent === 'success'
        ? 'text-success-700'
        : 'text-foreground';
  return (
    <div className="card card-body !py-4">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className={`text-2xl font-semibold mt-1 block ${valueColor}`}>{value}</span>
    </div>
  );
}

interface FormProps {
  busy: boolean;
  serverError: string | null;
  onSubmit: (payload: CreateSaleRequest) => void;
  onCancel: () => void;
}

function SaleForm({ busy, serverError, onSubmit, onCancel }: FormProps): ReactElement {
  const [category, setCategory] = useState('');
  const [amount, setAmount] = useState('');
  const [buyer, setBuyer] = useState('');
  const [date, setDate] = useState('');
  const [note, setNote] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);

  const submit = (): void => {
    setValidationError(null);
    const cat = category.trim();
    if (cat.length === 0) {
      setValidationError('Category is required.');
      return;
    }
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      setValidationError('Amount must be a positive number.');
      return;
    }
    const payload: CreateSaleRequest = { category: cat, amount: value };
    const buyerText = buyer.trim();
    if (buyerText.length > 0) payload.buyer = buyerText;
    if (date) payload.date = date;
    const noteText = note.trim();
    if (noteText.length > 0) payload.note = noteText;
    onSubmit(payload);
  };

  return (
    <div className="card card-body space-y-3 max-w-2xl">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="field-label">Category</span>
          <input
            type="text"
            className="input"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="e.g. eggs, meat, livestock"
            disabled={busy}
            autoFocus
          />
        </label>
        <label className="block">
          <span className="field-label">Amount (USD)</span>
          <input
            type="number"
            min="0"
            step="0.01"
            className="input"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={busy}
          />
        </label>
      </div>

      <label className="block">
        <span className="field-label">Buyer</span>
        <input
          type="text"
          className="input"
          value={buyer}
          onChange={(e) => setBuyer(e.target.value)}
          placeholder="Optional"
          disabled={busy}
        />
      </label>

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
        <span className="field-label">Sold on</span>
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
          {busy ? 'Saving...' : 'Add sale'}
        </button>
      </div>
    </div>
  );
}
