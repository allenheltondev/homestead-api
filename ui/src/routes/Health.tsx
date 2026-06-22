import type { ReactElement } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApiFetch, ApiError } from '../auth/useApiFetch';
import {
  createHealthExpense,
  deleteHealthExpense,
  listHealthExpenses,
} from '../api/health';
import { getHealth, getMortality } from '../api/stats';
import type {
  CreateHealthExpenseRequest,
  HealthExpense,
  HealthStats,
  MortalityStats,
} from '../api/types';
import Modal from '../components/Modal';
import RegisterHealthExpenseForm from '../components/RegisterHealthExpenseForm';
import MortalityChart from '../components/MortalityChart';
import PageHeader from '../components/PageHeader';
import { formatMoney, formatShortDate } from '../components/format';

export default function Health(): ReactElement {
  const apiFetch = useApiFetch();
  const [expenses, setExpenses] = useState<HealthExpense[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [health, setHealth] = useState<HealthStats | null>(null);
  const [mortality, setMortality] = useState<MortalityStats | null>(null);

  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [category, setCategory] = useState('');

  const [createOpen, setCreateOpen] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [deletingId, setDeletingId] = useState<string | null>(null);

  const reload = useCallback((): (() => void) => {
    let cancelled = false;
    setError(null);
    setExpenses(null);
    listHealthExpenses(apiFetch, {
      from: from || undefined,
      to: to || undefined,
      category: category.trim() || undefined,
    })
      .then((res) => {
        if (!cancelled) setExpenses(res.health_expenses);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });

    // Best-effort analytics — independent of the history list and filters.
    getHealth(apiFetch)
      .then((res) => {
        if (!cancelled) setHealth(res);
      })
      .catch(() => {
        if (!cancelled) setHealth(null);
      });

    getMortality(apiFetch)
      .then((res) => {
        if (!cancelled) setMortality(res);
      })
      .catch(() => {
        if (!cancelled) setMortality(null);
      });

    return () => {
      cancelled = true;
    };
  }, [apiFetch, from, to, category]);

  useEffect(() => reload(), [reload]);

  const totals = useMemo(() => {
    if (!expenses) return { spend: 0, count: 0 };
    return {
      spend: expenses.reduce((sum, e) => sum + e.cost, 0),
      count: expenses.length,
    };
  }, [expenses]);

  const lossPct =
    mortality == null ? null : Math.round(mortality.lossRate * 1000) / 10;

  const handleCreate = async (payload: CreateHealthExpenseRequest): Promise<void> => {
    setCreateBusy(true);
    setCreateError(null);
    try {
      await createHealthExpense(apiFetch, payload);
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
      await deleteHealthExpense(apiFetch, id);
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <section className="space-y-6">
      <PageHeader
        title="Health"
        subtitle="Track vet and medication spend, and keep an eye on mortality."
        actions={
          <button
            type="button"
            className="btn-primary"
            onClick={() => {
              setCreateError(null);
              setCreateOpen(true);
            }}
          >
            Log expense
          </button>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard
          label="Health spend"
          value={health == null ? '—' : formatMoney(health.totalSpend)}
          sub={health == null ? 'Unavailable' : health.period}
        />
        <StatCard
          label="Loss rate"
          value={lossPct == null ? '—' : `${lossPct}%`}
          accent={mortality != null && mortality.totalDeaths > 0 ? 'warning' : undefined}
          sub={
            mortality == null
              ? 'Unavailable'
              : `${mortality.totalDeaths} death${mortality.totalDeaths === 1 ? '' : 's'}`
          }
        />
        <StatCard
          label="Top category"
          value={
            health == null || health.byCategory.length === 0
              ? '—'
              : health.byCategory[0].category
          }
          sub={
            health == null || health.byCategory.length === 0
              ? 'No expenses yet'
              : formatMoney(health.byCategory[0].cost)
          }
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">Deaths by cause</h2>
          {mortality == null ? (
            <p className="rounded-md bg-muted text-muted-foreground text-sm text-center py-6">
              Mortality analytics are unavailable right now.
            </p>
          ) : (
            <MortalityChart byCause={mortality.byCause} />
          )}
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">Spend by category</h2>
          {health == null || health.byCategory.length === 0 ? (
            <p className="rounded-md bg-muted text-muted-foreground text-sm text-center py-6">
              Log a health expense to see your spend breakdown.
            </p>
          ) : (
            <div className="card card-body">
              <ul className="divide-y divide-border">
                {health.byCategory.map((c) => (
                  <li
                    key={c.category}
                    className="py-2.5 first:pt-0 last:pb-0 flex items-center justify-between gap-3"
                  >
                    <span className="text-sm font-medium text-foreground truncate">
                      {c.category}
                    </span>
                    <span className="text-sm text-muted-foreground shrink-0">
                      {formatMoney(c.cost)} · {c.count} entr{c.count === 1 ? 'y' : 'ies'}
                    </span>
                  </li>
                ))}
              </ul>
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
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">Category</span>
          <input
            type="text"
            className="input w-auto py-1.5"
            value={category}
            placeholder="vet, medication, ..."
            onChange={(e) => setCategory(e.target.value)}
          />
        </label>
        {(from || to || category) && (
          <button
            type="button"
            className="btn-ghost btn-sm"
            onClick={() => {
              setFrom('');
              setTo('');
              setCategory('');
            }}
          >
            Clear
          </button>
        )}
      </div>

      {expenses && expenses.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <Tile label="Total spend" value={formatMoney(totals.spend)} />
          <Tile label="Entries" value={String(totals.count)} />
        </div>
      )}

      {error && <p className="form-error">{error}</p>}
      {expenses === null && !error && <p className="text-muted-foreground">Loading...</p>}
      {expenses && expenses.length === 0 && (
        <p className="text-muted-foreground text-sm">No health expenses match these filters.</p>
      )}
      {expenses && expenses.length > 0 && (
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Category</th>
                <th>Animal</th>
                <th>Note</th>
                <th>Cost</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {expenses.map((e) => (
                <tr key={e.id}>
                  <td className="text-muted-foreground">{formatShortDate(e.date)}</td>
                  <td>{e.category}</td>
                  <td className="text-muted-foreground">{e.animalRef ?? '—'}</td>
                  <td className="text-muted-foreground">{e.note ?? '—'}</td>
                  <td>{formatMoney(e.cost)}</td>
                  <td className="text-right">
                    <button
                      type="button"
                      className="btn-link text-error-600 hover:text-error-700"
                      onClick={() => void handleDelete(e.id)}
                      disabled={deletingId === e.id}
                    >
                      {deletingId === e.id ? 'Removing...' : 'Delete'}
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
        title="Log health expense"
        onClose={() => (!createBusy ? setCreateOpen(false) : undefined)}
      >
        <RegisterHealthExpenseForm
          busy={createBusy}
          serverError={createError}
          onSubmit={(p) => void handleCreate(p)}
          onCancel={() => setCreateOpen(false)}
        />
      </Modal>
    </section>
  );
}

function StatCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: 'warning';
}): ReactElement {
  const valueColor = accent === 'warning' ? 'text-warning-700' : 'text-foreground';
  return (
    <div className="card card-body !py-4">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className={`text-2xl font-semibold mt-1 block ${valueColor}`}>{value}</span>
      {sub && <span className="text-xs mt-1 block text-muted-foreground">{sub}</span>}
    </div>
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
