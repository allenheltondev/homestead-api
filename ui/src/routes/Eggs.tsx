import type { ReactElement } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApiFetch, ApiError } from '../auth/useApiFetch';
import {
  createEggCollection,
  deleteEggCollection,
  listEggCollections,
} from '../api/eggs';
import { getEggCost, getEggCostByFlock } from '../api/stats';
import type {
  CreateEggCollectionRequest,
  EggCollection,
  EggCostByFlockRow,
  EggCostStats,
} from '../api/types';
import Modal from '../components/Modal';
import RegisterEggCollectionForm from '../components/RegisterEggCollectionForm';
import EggsChart from '../components/EggsChart';
import EggCostCard from '../components/EggCostCard';
import EggCostByFlockTable from '../components/EggCostByFlockTable';
import PageHeader from '../components/PageHeader';
import { formatShortDate } from '../components/format';

const DEFAULT_STORE_PRICE = 4;

export default function Eggs(): ReactElement {
  const apiFetch = useApiFetch();
  const [collections, setCollections] = useState<EggCollection[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [eggCost, setEggCost] = useState<EggCostStats | null>(null);
  const [byFlock, setByFlock] = useState<EggCostByFlockRow[] | null>(null);

  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const [createOpen, setCreateOpen] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [deletingId, setDeletingId] = useState<string | null>(null);

  const reload = useCallback((): (() => void) => {
    let cancelled = false;
    setError(null);
    setCollections(null);
    listEggCollections(apiFetch, {
      from: from || undefined,
      to: to || undefined,
    })
      .then((res) => {
        if (!cancelled) setCollections(res.egg_collections);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });

    // Best-effort: the cost-per-dozen card is independent of the history list.
    getEggCost(apiFetch, undefined, DEFAULT_STORE_PRICE)
      .then((res) => {
        if (!cancelled) setEggCost(res);
      })
      .catch(() => {
        if (!cancelled) setEggCost(null);
      });

    // Best-effort: per-flock cost-per-dozen breakdown.
    getEggCostByFlock(apiFetch)
      .then((res) => {
        if (!cancelled) setByFlock(res);
      })
      .catch(() => {
        if (!cancelled) setByFlock(null);
      });

    return () => {
      cancelled = true;
    };
  }, [apiFetch, from, to]);

  useEffect(() => reload(), [reload]);

  const totals = useMemo(() => {
    if (!collections) return { eggs: 0, dozens: 0, count: 0 };
    const eggs = collections.reduce((sum, c) => sum + c.count, 0);
    return { eggs, dozens: Math.round((eggs / 12) * 10) / 10, count: collections.length };
  }, [collections]);

  // Per-bird-type breakdown derived from the (filtered) collections so it
  // tracks the date range without needing a separate stats call.
  const byBirdType = useMemo(() => {
    if (!collections) return null;
    const map = new Map<string, number>();
    for (const c of collections) {
      const key = c.birdType ?? 'Unspecified';
      map.set(key, (map.get(key) ?? 0) + c.count);
    }
    return [...map.entries()]
      .map(([birdType, eggs]) => ({
        birdType,
        eggs,
        dozens: Math.round((eggs / 12) * 10) / 10,
      }))
      .sort((a, b) => b.eggs - a.eggs);
  }, [collections]);

  const handleCreate = async (payload: CreateEggCollectionRequest): Promise<void> => {
    setCreateBusy(true);
    setCreateError(null);
    try {
      await createEggCollection(apiFetch, payload);
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
      await deleteEggCollection(apiFetch, id);
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
        title="Eggs"
        subtitle="Log collections and track your cost per dozen."
        actions={
          <button
            type="button"
            className="btn-primary"
            onClick={() => {
              setCreateError(null);
              setCreateOpen(true);
            }}
          >
            Log eggs
          </button>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">Cost analytics</h2>
          {eggCost ? (
            <EggCostCard stats={eggCost} />
          ) : (
            <p className="rounded-md bg-muted text-muted-foreground text-sm text-center py-6">
              Cost analytics are unavailable right now.
            </p>
          )}
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">Eggs over time</h2>
          {collections === null ? (
            <p className="text-muted-foreground">Loading...</p>
          ) : (
            <EggsChart collections={collections} />
          )}
        </section>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-foreground">Production by bird type</h2>
        {byBirdType === null ? (
          <p className="text-muted-foreground">Loading...</p>
        ) : byBirdType.length === 0 ? (
          <p className="rounded-md bg-muted text-muted-foreground text-sm text-center py-6">
            No egg collections in this period.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Bird type</th>
                  <th>Eggs</th>
                  <th>Dozens</th>
                </tr>
              </thead>
              <tbody>
                {byBirdType.map((r) => (
                  <tr key={r.birdType}>
                    <td className="font-medium text-foreground">{r.birdType}</td>
                    <td>{r.eggs.toLocaleString()}</td>
                    <td className="text-muted-foreground">{r.dozens.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-foreground">Cost per dozen by flock</h2>
        {byFlock === null ? (
          <p className="rounded-md bg-muted text-muted-foreground text-sm text-center py-6">
            Per-flock cost analytics are unavailable right now.
          </p>
        ) : (
          <EggCostByFlockTable rows={byFlock} />
        )}
      </section>

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

      {collections && collections.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <Tile label="Total eggs" value={String(totals.eggs)} />
          <Tile label="Dozens" value={String(totals.dozens)} />
          <Tile label="Collections" value={String(totals.count)} />
        </div>
      )}

      {error && <p className="form-error">{error}</p>}
      {collections === null && !error && (
        <p className="text-muted-foreground">Loading...</p>
      )}
      {collections && collections.length === 0 && (
        <p className="text-muted-foreground text-sm">
          No egg collections match these filters.
        </p>
      )}
      {collections && collections.length > 0 && (
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Collected</th>
                <th>Count</th>
                <th>Bird type</th>
                <th>Coop</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {collections.map((c) => (
                <tr key={c.id}>
                  <td className="text-muted-foreground">{formatShortDate(c.date)}</td>
                  <td>{c.count}</td>
                  <td className="text-muted-foreground">{c.birdType ?? '—'}</td>
                  <td className="text-muted-foreground">{c.coop ?? '—'}</td>
                  <td className="text-right">
                    <button
                      type="button"
                      className="btn-link text-error-600 hover:text-error-700"
                      onClick={() => void handleDelete(c.id)}
                      disabled={deletingId === c.id}
                    >
                      {deletingId === c.id ? 'Removing...' : 'Delete'}
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
        title="Log egg collection"
        onClose={() => (!createBusy ? setCreateOpen(false) : undefined)}
      >
        <RegisterEggCollectionForm
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
