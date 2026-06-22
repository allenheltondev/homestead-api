import type { ReactElement } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApiFetch, ApiError } from '../auth/useApiFetch';
import {
  createHarvestLog,
  deleteHarvestLog,
  listHarvestLogs,
  publishHarvestLog,
  unpublishHarvestLog,
} from '../api/harvest';
import { getGardenStats } from '../api/garden';
import { listBeds, listGrowerCrops } from '../api/grn';
import type {
  Bed,
  CreateHarvestLogRequest,
  GardenStats,
  GrowerCrop,
  HarvestLog,
} from '../api/types';
import Modal from '../components/Modal';
import RegisterHarvestForm from '../components/RegisterHarvestForm';
import HarvestYieldChart from '../components/HarvestYieldChart';
import StatusBadge from '../components/StatusBadge';
import { listingTone } from '../components/statusTone';
import { formatMoney, formatShortDate } from '../components/format';

export default function Garden(): ReactElement {
  const apiFetch = useApiFetch();
  const [logs, setLogs] = useState<HarvestLog[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<GardenStats | null>(null);
  const [beds, setBeds] = useState<Bed[]>([]);
  const [crops, setCrops] = useState<GrowerCrop[]>([]);

  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const [createOpen, setCreateOpen] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [sharingId, setSharingId] = useState<string | null>(null);

  const reload = useCallback((): (() => void) => {
    let cancelled = false;
    setError(null);
    setLogs(null);
    listHarvestLogs(apiFetch, { from: from || undefined, to: to || undefined })
      .then((res) => {
        if (!cancelled) setLogs(res.harvest_logs);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });

    // Best-effort: garden economics card is independent of the history list.
    getGardenStats(apiFetch)
      .then((res) => {
        if (!cancelled) setStats(res);
      })
      .catch(() => {
        if (!cancelled) setStats(null);
      });

    // Best-effort: GRN beds power the harvest form's bed picker.
    listBeds(apiFetch)
      .then((res) => {
        if (!cancelled) setBeds(res.beds);
      })
      .catch(() => {
        if (!cancelled) setBeds([]);
      });

    // Best-effort: GRN crop library powers the harvest form's crop selector.
    // When unavailable, the form falls back to free-text crop entry.
    listGrowerCrops(apiFetch)
      .then((res) => {
        if (!cancelled) setCrops(res.crops);
      })
      .catch(() => {
        if (!cancelled) setCrops([]);
      });

    return () => {
      cancelled = true;
    };
  }, [apiFetch, from, to]);

  useEffect(() => reload(), [reload]);

  const handleCreate = async (payload: CreateHarvestLogRequest): Promise<void> => {
    setCreateBusy(true);
    setCreateError(null);
    try {
      await createHarvestLog(apiFetch, payload);
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
      await deleteHarvestLog(apiFetch, id);
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message);
    } finally {
      setDeletingId(null);
    }
  };

  const handleToggleShare = async (log: HarvestLog): Promise<void> => {
    setSharingId(log.id);
    setError(null);
    try {
      if (log.listing && log.listing.status !== 'expired') {
        await unpublishHarvestLog(apiFetch, log.id);
      } else {
        await publishHarvestLog(apiFetch, log.id, {
          quantity: log.quantity,
          unit: log.unit,
        });
      }
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message);
    } finally {
      setSharingId(null);
    }
  };

  return (
    <section className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold text-foreground">Garden</h1>
          <p className="text-muted-foreground">
            Log harvests, track yield by crop, and watch your cost per unit.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/beds" className="btn-secondary w-auto">
            Beds &amp; crops
          </Link>
          <button
            type="button"
            className="btn-primary"
            onClick={() => {
              setCreateError(null);
              setCreateOpen(true);
            }}
          >
            Log harvest
          </button>
        </div>
      </header>

      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Tile label="Harvests" value={String(stats.totalHarvests)} />
          <Tile label="Crops" value={String(stats.byCrop.length)} />
          <Tile
            label="Input cost"
            value={stats.totalCost > 0 ? formatMoney(stats.totalCost) : '—'}
          />
          <Tile
            label="Est. value"
            value={stats.totalValue > 0 ? formatMoney(stats.totalValue) : '—'}
            accent={stats.totalValue >= stats.totalCost ? 'success' : undefined}
          />
        </div>
      )}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-foreground">Yield by crop</h2>
        {stats === null ? (
          <p className="rounded-md bg-muted text-muted-foreground text-sm text-center py-6">
            Garden analytics are unavailable right now.
          </p>
        ) : (
          <HarvestYieldChart byCrop={stats.byCrop} />
        )}
      </section>

      {stats && stats.byCrop.some((c) => c.cost != null || c.value != null) && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">Cost &amp; yield by crop</h2>
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Crop</th>
                  <th>Yield</th>
                  <th>Harvests</th>
                  <th>Cost</th>
                  <th>Cost / unit</th>
                  <th>Est. value</th>
                </tr>
              </thead>
              <tbody>
                {stats.byCrop.map((c) => (
                  <tr key={c.crop}>
                    <td className="font-medium text-foreground">{c.crop}</td>
                    <td>
                      {c.quantity.toLocaleString()} {c.unit}
                    </td>
                    <td className="text-muted-foreground">{c.harvests}</td>
                    <td className="text-muted-foreground">
                      {c.cost != null ? formatMoney(c.cost) : '—'}
                    </td>
                    <td className="text-muted-foreground">
                      {c.cost != null && c.quantity > 0
                        ? `${formatMoney(c.cost / c.quantity)}/${c.unit}`
                        : '—'}
                    </td>
                    <td className="text-muted-foreground">
                      {c.value != null ? formatMoney(c.value) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

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

      {error && <p className="form-error">{error}</p>}
      {logs === null && !error && <p className="text-muted-foreground">Loading...</p>}
      {logs && logs.length === 0 && (
        <p className="text-muted-foreground text-sm">No harvests match these filters.</p>
      )}
      {logs && logs.length > 0 && (
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Harvested</th>
                <th>Crop</th>
                <th>Quantity</th>
                <th>Good Roots</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => {
                const shared = log.listing && log.listing.status !== 'expired';
                return (
                  <tr key={log.id}>
                    <td className="text-muted-foreground">{formatShortDate(log.date)}</td>
                    <td className="font-medium text-foreground">{log.crop}</td>
                    <td>
                      {log.quantity.toLocaleString()} {log.unit}
                    </td>
                    <td>
                      {log.listing ? (
                        <StatusBadge
                          label={log.listing.status}
                          tone={listingTone(log.listing.status)}
                        />
                      ) : (
                        <span className="text-muted-foreground text-sm">Not shared</span>
                      )}
                    </td>
                    <td className="text-right whitespace-nowrap">
                      <button
                        type="button"
                        className="btn-link"
                        onClick={() => void handleToggleShare(log)}
                        disabled={
                          sharingId === log.id || log.listing?.status === 'claimed'
                        }
                        title={
                          log.listing?.status === 'claimed'
                            ? 'Claimed listings cannot be unshared'
                            : undefined
                        }
                      >
                        {sharingId === log.id
                          ? 'Working...'
                          : shared
                            ? 'Unshare'
                            : 'Share to Good Roots'}
                      </button>
                      <button
                        type="button"
                        className="btn-link text-error-600 hover:text-error-700 ml-3"
                        onClick={() => void handleDelete(log.id)}
                        disabled={deletingId === log.id}
                      >
                        {deletingId === log.id ? 'Removing...' : 'Delete'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={createOpen}
        title="Log harvest"
        onClose={() => (!createBusy ? setCreateOpen(false) : undefined)}
      >
        <RegisterHarvestForm
          busy={createBusy}
          serverError={createError}
          beds={beds}
          crops={crops}
          onSubmit={(p) => void handleCreate(p)}
          onCancel={() => setCreateOpen(false)}
        />
      </Modal>
    </section>
  );
}

function Tile({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: 'success';
}): ReactElement {
  const valueColor = accent === 'success' ? 'text-success-700' : 'text-foreground';
  return (
    <div className="card card-body !py-3">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className={`text-2xl font-semibold mt-1 block ${valueColor}`}>{value}</span>
    </div>
  );
}
