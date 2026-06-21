import type { ReactElement } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApiFetch, ApiError } from '../auth/useApiFetch';
import { createFeedPurchase, deleteFeedPurchase, listFeedPurchases } from '../api/feed';
import type { CreateFeedPurchaseRequest, FeedPurchase } from '../api/types';
import Modal from '../components/Modal';
import RegisterFeedPurchaseForm from '../components/RegisterFeedPurchaseForm';
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
    return () => {
      cancelled = true;
    };
  }, [apiFetch, from, to, type]);

  useEffect(() => reload(), [reload]);

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
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <section className="space-y-4">
      <header className="flex items-start justify-between gap-4">
        <h1 className="text-2xl font-semibold text-foreground">Feed</h1>
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
      </header>

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
                <th>Quantity</th>
                <th>Cost</th>
                <th>Vendor</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {purchases.map((p) => (
                <tr key={p.id}>
                  <td className="text-muted-foreground">{formatShortDate(p.purchasedAt)}</td>
                  <td>{p.type}</td>
                  <td className="text-muted-foreground">
                    {p.quantity} {p.unit}
                  </td>
                  <td>{formatMoney(p.cost)}</td>
                  <td className="text-muted-foreground">{p.vendor}</td>
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
