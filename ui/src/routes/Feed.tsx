import type { ReactElement } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApiFetch, ApiError } from '../auth/useApiFetch';
import { createFeedPurchase, deleteFeedPurchase, listFeedPurchases } from '../api/feed';
import {
  createFeedConsumption,
  deleteFeedConsumption,
  listFeedConsumption,
} from '../api/feedConsumption';
import { getFeedInventory } from '../api/stats';
import type {
  CreateFeedConsumptionRequest,
  CreateFeedPurchaseRequest,
  FeedConsumption,
  FeedInventoryStats,
  FeedPurchase,
} from '../api/types';
import Modal from '../components/Modal';
import RegisterFeedPurchaseForm from '../components/RegisterFeedPurchaseForm';
import RegisterFeedUsageForm from '../components/RegisterFeedUsageForm';
import FeedInventoryCard from '../components/FeedInventoryCard';
import { formatMoney, formatShortDate } from '../components/format';

export default function Feed(): ReactElement {
  const apiFetch = useApiFetch();
  const [purchases, setPurchases] = useState<FeedPurchase[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [type, setType] = useState('');

  const [createOpen, setCreateOpen] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Inventory + consumption state.
  const [inventory, setInventory] = useState<FeedInventoryStats | null>(null);
  const [inventoryError, setInventoryError] = useState<string | null>(null);

  const [consumption, setConsumption] = useState<FeedConsumption[] | null>(null);
  const [consumptionError, setConsumptionError] = useState<string | null>(null);

  const [usageOpen, setUsageOpen] = useState(false);
  const [usageBusy, setUsageBusy] = useState(false);
  const [usageError, setUsageError] = useState<string | null>(null);

  const [deletingUsageId, setDeletingUsageId] = useState<string | null>(null);

  const reload = useCallback((): (() => void) => {
    let cancelled = false;
    setError(null);
    setPurchases(null);
    listFeedPurchases(apiFetch, {
      from: from || undefined,
      to: to || undefined,
      type: type.trim() || undefined,
    })
      .then((res) => {
        if (!cancelled) setPurchases(res.feed_purchases);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });

    setConsumptionError(null);
    setConsumption(null);
    listFeedConsumption(
      apiFetch,
      from || undefined,
      to || undefined,
      type.trim() || undefined,
    )
      .then((res) => {
        if (!cancelled) setConsumption(res.feed_consumption);
      })
      .catch((err: Error) => {
        if (!cancelled) setConsumptionError(err.message);
      });

    return () => {
      cancelled = true;
    };
  }, [apiFetch, from, to, type]);

  // Inventory is a point-in-time forecast independent of the date filters.
  const reloadInventory = useCallback((): (() => void) => {
    let cancelled = false;
    setInventoryError(null);
    setInventory(null);
    getFeedInventory(apiFetch)
      .then((res) => {
        if (!cancelled) setInventory(res);
      })
      .catch((err: Error) => {
        if (!cancelled) setInventoryError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [apiFetch]);

  useEffect(() => reload(), [reload]);
  useEffect(() => reloadInventory(), [reloadInventory]);

  const totals = useMemo(() => {
    if (!purchases) return { cost: 0, count: 0 };
    return {
      cost: purchases.reduce((sum, p) => sum + p.cost, 0),
      count: purchases.length,
    };
  }, [purchases]);

  const handleCreate = async (payload: CreateFeedPurchaseRequest): Promise<void> => {
    setCreateBusy(true);
    setCreateError(null);
    try {
      await createFeedPurchase(apiFetch, payload);
      setCreateOpen(false);
      reload();
      reloadInventory();
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : (err as Error).message);
    } finally {
      setCreateBusy(false);
    }
  };

  const handleDelete = async (id: string): Promise<void> => {
    setDeletingId(id);
    try {
      await deleteFeedPurchase(apiFetch, id);
      reload();
      reloadInventory();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message);
    } finally {
      setDeletingId(null);
    }
  };

  const handleCreateUsage = async (
    payload: CreateFeedConsumptionRequest,
  ): Promise<void> => {
    setUsageBusy(true);
    setUsageError(null);
    try {
      await createFeedConsumption(apiFetch, payload);
      setUsageOpen(false);
      reload();
      reloadInventory();
    } catch (err) {
      setUsageError(err instanceof ApiError ? err.message : (err as Error).message);
    } finally {
      setUsageBusy(false);
    }
  };

  const handleDeleteUsage = async (id: string): Promise<void> => {
    setDeletingUsageId(id);
    try {
      await deleteFeedConsumption(apiFetch, id);
      reload();
      reloadInventory();
    } catch (err) {
      setConsumptionError(err instanceof ApiError ? err.message : (err as Error).message);
    } finally {
      setDeletingUsageId(null);
    }
  };

  return (
    <section className="space-y-4">
      <header className="flex items-start justify-between gap-4">
        <h1 className="text-2xl font-semibold text-foreground">Feed</h1>
        <div className="flex gap-2">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              setUsageError(null);
              setUsageOpen(true);
            }}
          >
            Record usage
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => {
              setCreateError(null);
              setCreateOpen(true);
            }}
          >
            Record purchase
          </button>
        </div>
      </header>

      <section className="space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-lg font-semibold text-foreground">Inventory</h2>
          {inventory && inventory.byType.length > 0 && (
            <span className="text-sm text-muted-foreground">
              {Math.round(inventory.totals.onHandLbs).toLocaleString()} lb on hand ·{' '}
              {formatMoney(inventory.totals.onHandValue)}
            </span>
          )}
        </div>
        {inventoryError && <p className="form-error">{inventoryError}</p>}
        {inventory === null && !inventoryError && (
          <p className="text-muted-foreground">Loading...</p>
        )}
        {inventory && inventory.byType.length === 0 && (
          <p className="text-muted-foreground text-sm">
            No feed inventory yet. Record a purchase to start tracking on-hand stock.
          </p>
        )}
        {inventory && inventory.byType.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {inventory.byType.map((row) => (
              <FeedInventoryCard key={row.feedType} row={row} />
            ))}
          </div>
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
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">Type</span>
          <input
            type="text"
            className="input w-auto py-1.5"
            value={type}
            placeholder="hay, grain, ..."
            onChange={(e) => setType(e.target.value)}
          />
        </label>
        {(from || to || type) && (
          <button
            type="button"
            className="btn-ghost btn-sm"
            onClick={() => {
              setFrom('');
              setTo('');
              setType('');
            }}
          >
            Clear
          </button>
        )}
      </div>

      {purchases && purchases.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <Tile label="Total spend" value={formatMoney(totals.cost)} />
          <Tile label="Purchases" value={String(totals.count)} />
        </div>
      )}

      {error && <p className="form-error">{error}</p>}
      {purchases === null && !error && <p className="text-muted-foreground">Loading...</p>}
      {purchases && purchases.length === 0 && (
        <p className="text-muted-foreground text-sm">No feed purchases match these filters.</p>
      )}
      {purchases && purchases.length > 0 && (
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Purchased</th>
                <th>Type</th>
                <th>Bags</th>
                <th>Total</th>
                <th>Cost</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {purchases.map((p) => (
                <tr key={p.id}>
                  <td className="text-muted-foreground">{formatShortDate(p.purchasedAt)}</td>
                  <td>{p.type}</td>
                  <td className="text-muted-foreground">
                    {p.bags != null && p.bagWeightLbs != null
                      ? `${p.bags} × ${p.bagWeightLbs} lb`
                      : '—'}
                  </td>
                  <td className="text-muted-foreground">{formatFeedTotal(p)}</td>
                  <td>{formatMoney(p.cost)}</td>
                  <td className="text-right">
                    <button
                      type="button"
                      className="btn-link text-error-600 hover:text-error-700"
                      onClick={() => void handleDelete(p.id)}
                      disabled={deletingId === p.id}
                    >
                      {deletingId === p.id ? 'Removing...' : 'Delete'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <section className="space-y-3 pt-2">
        <h2 className="text-lg font-semibold text-foreground">Consumption log</h2>
        {consumptionError && <p className="form-error">{consumptionError}</p>}
        {consumption === null && !consumptionError && (
          <p className="text-muted-foreground">Loading...</p>
        )}
        {consumption && consumption.length === 0 && (
          <p className="text-muted-foreground text-sm">
            No feed usage logged for these filters.
          </p>
        )}
        {consumption && consumption.length > 0 && (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Used</th>
                  <th>Type</th>
                  <th>Amount</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {consumption.map((c) => (
                  <tr key={c.id}>
                    <td className="text-muted-foreground">{formatShortDate(c.date)}</td>
                    <td>{c.feedType}</td>
                    <td className="text-muted-foreground">{formatUsage(c)}</td>
                    <td className="text-right">
                      <button
                        type="button"
                        className="btn-link text-error-600 hover:text-error-700"
                        onClick={() => void handleDeleteUsage(c.id)}
                        disabled={deletingUsageId === c.id}
                      >
                        {deletingUsageId === c.id ? 'Removing...' : 'Delete'}
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
        title="Record feed purchase"
        onClose={() => (!createBusy ? setCreateOpen(false) : undefined)}
      >
        <RegisterFeedPurchaseForm
          busy={createBusy}
          serverError={createError}
          onSubmit={(p) => void handleCreate(p)}
          onCancel={() => setCreateOpen(false)}
        />
      </Modal>

      <Modal
        open={usageOpen}
        title="Record feed usage"
        onClose={() => (!usageBusy ? setUsageOpen(false) : undefined)}
      >
        <RegisterFeedUsageForm
          busy={usageBusy}
          serverError={usageError}
          onSubmit={(p) => void handleCreateUsage(p)}
          onCancel={() => setUsageOpen(false)}
        />
      </Modal>
    </section>
  );
}

// Renders a consumption entry's amount, preferring bag detail when present.
function formatUsage(c: FeedConsumption): string {
  if (c.bags != null && c.bagWeightLbs != null) {
    return `${c.lbs.toLocaleString()} lb (${c.bags} × ${c.bagWeightLbs} lb)`;
  }
  return `${c.lbs.toLocaleString()} lb`;
}

// Prefer the server-computed total lbs; fall back to bags*weight, then the
// legacy quantity/unit fields for older records.
function formatFeedTotal(p: FeedPurchase): string {
  if (p.totalLbs != null) return `${p.totalLbs.toLocaleString()} lb`;
  if (p.bags != null && p.bagWeightLbs != null) {
    return `${(p.bags * p.bagWeightLbs).toLocaleString()} lb`;
  }
  if (p.quantity != null) return `${p.quantity} ${p.unit ?? ''}`.trim();
  return '—';
}

function Tile({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div className="card card-body !py-3">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="text-2xl font-semibold text-foreground mt-1 block">{value}</span>
    </div>
  );
}
