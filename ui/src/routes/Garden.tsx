import type { ReactElement } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApiFetch, ApiError } from '../auth/useApiFetch';
import { getGardenStats } from '../api/garden';
import {
  getCropHarvests,
  isGrnNotConnected,
  listGrowerCrops,
  publishCropSurplus,
  recordCropHarvest,
} from '../api/grn';
import type {
  GardenStats,
  GrnListing,
  GrowerCrop,
  HarvestItem,
  HarvestLogResponse,
  PublishCropSurplusRequest,
  RecordCropHarvestRequest,
} from '../api/types';
import Modal from '../components/Modal';
import RegisterHarvestForm from '../components/RegisterHarvestForm';
import HarvestYieldChart from '../components/HarvestYieldChart';
import StatusBadge from '../components/StatusBadge';
import { listingTone } from '../components/statusTone';
import { formatMoney, formatShortDate } from '../components/format';

// Builds the display name for a crop-library entry (crop · variety).
function cropLabel(c: GrowerCrop): string {
  return c.variety ? `${c.name} · ${c.variety}` : c.name;
}

export default function Garden(): ReactElement {
  const apiFetch = useApiFetch();
  const [error, setError] = useState<string | null>(null);
  const [notConnected, setNotConnected] = useState(false);
  const [stats, setStats] = useState<GardenStats | null>(null);
  const [crops, setCrops] = useState<GrowerCrop[] | null>(null);

  // The crop whose GRN harvest log is shown.
  const [selectedCropId, setSelectedCropId] = useState('');
  const [harvests, setHarvests] = useState<HarvestLogResponse | null>(null);
  const [harvestsError, setHarvestsError] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [shareOpen, setShareOpen] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const [shareResult, setShareResult] = useState<GrnListing | null>(null);

  // GRN crop library powers the crop selector + harvest form. A "not connected"
  // signal flips the page to the connect prompt.
  const loadCrops = useCallback((): (() => void) => {
    let cancelled = false;
    setError(null);
    setCrops(null);
    listGrowerCrops(apiFetch)
      .then((res) => {
        if (cancelled) return;
        setCrops(res.crops);
        // Default the selection to the first crop once loaded.
        setSelectedCropId((prev) =>
          prev || (res.crops.length > 0 ? res.crops[0].id : ''),
        );
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (isGrnNotConnected(err)) setNotConnected(true);
        else setError(err instanceof Error ? err.message : 'Failed to load crops.');
      });
    return () => {
      cancelled = true;
    };
  }, [apiFetch]);

  // Garden economics card + yield chart are independent of the GRN crop list.
  const loadStats = useCallback((): (() => void) => {
    let cancelled = false;
    getGardenStats(apiFetch)
      .then((res) => {
        if (!cancelled) setStats(res);
      })
      .catch(() => {
        if (!cancelled) setStats(null);
      });
    return () => {
      cancelled = true;
    };
  }, [apiFetch]);

  // The selected crop's GRN harvest log + running total.
  const loadHarvests = useCallback((): (() => void) => {
    let cancelled = false;
    if (!selectedCropId) {
      setHarvests(null);
      setHarvestsError(null);
      return () => {
        cancelled = true;
      };
    }
    setHarvestsError(null);
    setHarvests(null);
    getCropHarvests(apiFetch, selectedCropId)
      .then((res) => {
        if (!cancelled) setHarvests(res);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (isGrnNotConnected(err)) setNotConnected(true);
        else
          setHarvestsError(
            err instanceof Error ? err.message : 'Failed to load harvests.',
          );
      });
    return () => {
      cancelled = true;
    };
  }, [apiFetch, selectedCropId]);

  useEffect(() => loadCrops(), [loadCrops]);
  useEffect(() => loadStats(), [loadStats]);
  useEffect(() => loadHarvests(), [loadHarvests]);

  const handleCreate = async (
    cropLibraryId: string,
    payload: RecordCropHarvestRequest,
  ): Promise<void> => {
    setCreateBusy(true);
    setCreateError(null);
    try {
      await recordCropHarvest(apiFetch, cropLibraryId, payload);
      setCreateOpen(false);
      // Surface the new harvest immediately under its crop.
      setSelectedCropId(cropLibraryId);
      loadHarvests();
      loadStats();
    } catch (err) {
      if (isGrnNotConnected(err)) {
        setNotConnected(true);
        setCreateOpen(false);
      } else {
        setCreateError(err instanceof ApiError ? err.message : (err as Error).message);
      }
    } finally {
      setCreateBusy(false);
    }
  };

  const handleShare = async (
    cropLibraryId: string,
    payload: PublishCropSurplusRequest,
  ): Promise<void> => {
    setShareBusy(true);
    setShareError(null);
    try {
      const listing = await publishCropSurplus(apiFetch, cropLibraryId, payload);
      setShareResult(listing);
    } catch (err) {
      if (isGrnNotConnected(err)) {
        setNotConnected(true);
        setShareOpen(false);
      } else {
        setShareError(err instanceof ApiError ? err.message : (err as Error).message);
      }
    } finally {
      setShareBusy(false);
    }
  };

  if (notConnected) {
    return <ConnectGoodRoots />;
  }

  const selectedCrop = crops?.find((c) => c.id === selectedCropId) ?? null;

  return (
    <section className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold text-foreground">Garden</h1>
          <p className="text-muted-foreground">
            Log harvests to Good Roots per crop, track yield, and watch your cost per unit.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/beds" className="btn-secondary w-auto">
            Beds &amp; crops
          </Link>
          <button
            type="button"
            className="btn-primary"
            disabled={!crops || crops.length === 0}
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

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex items-end gap-3">
            <h2 className="text-lg font-semibold text-foreground">Harvest log</h2>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">Crop</span>
              <select
                className="input w-auto py-1.5"
                value={selectedCropId}
                onChange={(e) => setSelectedCropId(e.target.value)}
                disabled={!crops || crops.length === 0}
              >
                {crops?.length ? (
                  crops.map((c) => (
                    <option key={c.id} value={c.id}>
                      {cropLabel(c)}
                    </option>
                  ))
                ) : (
                  <option value="">No crops yet</option>
                )}
              </select>
            </label>
          </div>
          {selectedCrop && (
            <button
              type="button"
              className="btn-secondary w-auto"
              onClick={() => {
                setShareError(null);
                setShareResult(null);
                setShareOpen(true);
              }}
            >
              Share surplus
            </button>
          )}
        </div>

        {error && <p className="form-error">{error}</p>}

        {!error && crops !== null && crops.length === 0 && (
          <p className="text-muted-foreground text-sm">
            No crops in your library yet. Add crops on the{' '}
            <Link to="/beds" className="text-primary-600 hover:underline">
              Beds &amp; crops
            </Link>{' '}
            page to start logging harvests.
          </p>
        )}

        {harvestsError && <p className="form-error">{harvestsError}</p>}
        {selectedCropId && harvests === null && !harvestsError && (
          <p className="text-muted-foreground">Loading...</p>
        )}
        {harvests && (
          <>
            <p className="text-sm text-muted-foreground">
              {harvests.harvestCount.toLocaleString()} harvest
              {harvests.harvestCount === 1 ? '' : 's'} · {' '}
              <span className="font-medium text-foreground">
                {harvests.totalHarvested.toLocaleString()}
              </span>{' '}
              total
            </p>
            {harvests.harvests.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No harvests recorded for this crop yet.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Harvested</th>
                      <th>Amount</th>
                      <th>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {harvests.harvests.map((h: HarvestItem) => (
                      <tr key={h.id}>
                        <td className="text-muted-foreground">
                          {formatShortDate(h.harvestedOn)}
                        </td>
                        <td>
                          {h.amount.toLocaleString()} {h.unit ?? ''}
                        </td>
                        <td className="text-muted-foreground">{h.notes ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </section>

      <Modal
        open={createOpen}
        title="Log harvest"
        onClose={() => (!createBusy ? setCreateOpen(false) : undefined)}
      >
        <RegisterHarvestForm
          busy={createBusy}
          serverError={createError}
          crops={crops ?? []}
          initialCropLibraryId={selectedCropId}
          onSubmit={(id, p) => void handleCreate(id, p)}
          onCancel={() => setCreateOpen(false)}
        />
      </Modal>

      <Modal
        open={shareOpen}
        title="Share surplus"
        onClose={() => (!shareBusy ? setShareOpen(false) : undefined)}
      >
        {selectedCrop && (
          <ShareSurplusForm
            crop={selectedCrop}
            busy={shareBusy}
            serverError={shareError}
            result={shareResult}
            onSubmit={(p) => void handleShare(selectedCrop.id, p)}
            onClose={() => setShareOpen(false)}
          />
        )}
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

function ShareSurplusForm({
  crop,
  busy,
  serverError,
  result,
  onSubmit,
  onClose,
}: {
  crop: GrowerCrop;
  busy: boolean;
  serverError: string | null;
  result: GrnListing | null;
  onSubmit: (payload: PublishCropSurplusRequest) => void;
  onClose: () => void;
}): ReactElement {
  const [amount, setAmount] = useState('');
  const [availableEnd, setAvailableEnd] = useState('');
  const [pickupNotes, setPickupNotes] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);

  const label = crop.variety ? `${crop.name} · ${crop.variety}` : crop.name;

  // Once a listing comes back, show its status instead of the form.
  if (result) {
    return (
      <div className="card card-body space-y-3 max-w-2xl">
        <p className="text-sm text-foreground">
          Surplus shared for <span className="font-medium">{label}</span>.
        </p>
        <div className="card card-body space-y-2">
          <div className="flex items-start justify-between gap-2">
            <span className="font-medium text-foreground">{result.crop}</span>
            <StatusBadge label={result.status} tone={listingTone(result.status)} />
          </div>
          <p className="text-sm text-muted-foreground">
            {result.quantity.toLocaleString()} {result.unit}
          </p>
          {result.note && <p className="text-sm text-muted-foreground">{result.note}</p>}
          <div className="text-xs text-muted-foreground border-t border-border pt-2 space-y-0.5">
            <p>Listed {formatShortDate(result.publishedAt)}</p>
            {result.expiresAt && <p>Expires {formatShortDate(result.expiresAt)}</p>}
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Link to="/good-roots" className="btn-secondary w-auto">
            View listings
          </Link>
          <button type="button" className="btn-primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    );
  }

  const submit = (): void => {
    setValidationError(null);
    const payload: PublishCropSurplusRequest = {};
    if (amount.trim().length > 0) {
      const value = Number(amount);
      if (!Number.isFinite(value) || value <= 0) {
        setValidationError('Amount must be a positive number.');
        return;
      }
      payload.amount = value;
    }
    if (availableEnd) payload.availableEnd = availableEnd;
    const notes = pickupNotes.trim();
    if (notes.length > 0) payload.pickupNotes = notes;
    onSubmit(payload);
  };

  return (
    <div className="card card-body space-y-3 max-w-2xl">
      <p className="text-sm text-muted-foreground">
        Share surplus from <span className="font-medium text-foreground">{label}</span> with the
        Good Roots community.
      </p>
      <label className="block">
        <span className="field-label">Amount</span>
        <input
          type="number"
          min="0"
          step="0.01"
          className="input"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="Optional — defaults to your available surplus"
          disabled={busy}
        />
      </label>
      <label className="block">
        <span className="field-label">Available until</span>
        <input
          type="date"
          className="input"
          value={availableEnd}
          onChange={(e) => setAvailableEnd(e.target.value)}
          disabled={busy}
        />
      </label>
      <label className="block">
        <span className="field-label">Pickup note</span>
        <input
          type="text"
          className="input"
          value={pickupNotes}
          onChange={(e) => setPickupNotes(e.target.value)}
          placeholder="Optional — e.g. porch pickup after 5pm"
          disabled={busy}
        />
      </label>

      {validationError && <p className="form-error">{validationError}</p>}
      {serverError && <p className="form-error">{serverError}</p>}

      <div className="flex justify-end gap-2 pt-2">
        <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button type="button" className="btn-primary" onClick={submit} disabled={busy}>
          {busy ? 'Sharing...' : 'Share surplus'}
        </button>
      </div>
    </div>
  );
}

function ConnectGoodRoots(): ReactElement {
  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold text-foreground">Garden</h1>
        <p className="text-muted-foreground">
          Log harvests to Good Roots per crop, track yield, and watch your cost per unit.
        </p>
      </header>
      <div className="card card-body text-center py-16 space-y-4">
        <div className="text-4xl" aria-hidden>
          🌱
        </div>
        <h2 className="text-lg font-semibold text-foreground">Connect Good Roots</h2>
        <p className="text-muted-foreground max-w-md mx-auto">
          Good Roots isn&apos;t connected to this homestead yet. Once connected, you can log
          harvests against your crops, track yield, and share surplus with your community.
        </p>
        <p className="text-sm text-muted-foreground">
          Ask your administrator to enable the Good Roots Network integration to get started.
        </p>
      </div>
    </section>
  );
}
