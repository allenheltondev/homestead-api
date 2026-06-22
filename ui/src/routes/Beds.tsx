import type { ReactElement } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApiFetch, ApiError } from '../auth/useApiFetch';
import { createBed, deleteBed, listBeds } from '../api/beds';
import {
  createPlanting,
  deletePlanting,
  listPlantings,
  updatePlanting,
} from '../api/plantings';
import type {
  Bed,
  CreateBedRequest,
  CreatePlantingRequest,
  Planting,
  PlantingStatus,
} from '../api/types';
import Modal from '../components/Modal';
import PlantingCalendar from '../components/PlantingCalendar';
import StatusBadge from '../components/StatusBadge';
import { plantingTone } from '../components/statusTone';
import { formatShortDate } from '../components/format';

const PLANTING_STATUSES: PlantingStatus[] = [
  'planned',
  'growing',
  'harvested',
  'failed',
];

export default function Beds(): ReactElement {
  const apiFetch = useApiFetch();
  const [beds, setBeds] = useState<Bed[] | null>(null);
  const [plantings, setPlantings] = useState<Planting[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [bedOpen, setBedOpen] = useState(false);
  const [bedBusy, setBedBusy] = useState(false);
  const [bedError, setBedError] = useState<string | null>(null);

  const [plantingOpen, setPlantingOpen] = useState(false);
  const [plantingBusy, setPlantingBusy] = useState(false);
  const [plantingError, setPlantingError] = useState<string | null>(null);

  const [deletingBedId, setDeletingBedId] = useState<string | null>(null);
  const [deletingPlantingId, setDeletingPlantingId] = useState<string | null>(null);
  const [updatingPlantingId, setUpdatingPlantingId] = useState<string | null>(null);

  const reload = useCallback((): (() => void) => {
    let cancelled = false;
    setError(null);
    setBeds(null);
    setPlantings(null);

    listBeds(apiFetch)
      .then((res) => {
        if (!cancelled) setBeds(res.beds);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });

    listPlantings(apiFetch)
      .then((res) => {
        if (!cancelled) setPlantings(res.plantings);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });

    return () => {
      cancelled = true;
    };
  }, [apiFetch]);

  useEffect(() => reload(), [reload]);

  const bedNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const b of beds ?? []) map.set(b.id, b.name);
    return map;
  }, [beds]);

  const currentYear = new Date().getUTCFullYear();

  const handleCreateBed = async (payload: CreateBedRequest): Promise<void> => {
    setBedBusy(true);
    setBedError(null);
    try {
      await createBed(apiFetch, payload);
      setBedOpen(false);
      reload();
    } catch (err) {
      setBedError(err instanceof ApiError ? err.message : (err as Error).message);
    } finally {
      setBedBusy(false);
    }
  };

  const handleDeleteBed = async (id: string): Promise<void> => {
    setDeletingBedId(id);
    try {
      await deleteBed(apiFetch, id);
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message);
    } finally {
      setDeletingBedId(null);
    }
  };

  const handleCreatePlanting = async (payload: CreatePlantingRequest): Promise<void> => {
    setPlantingBusy(true);
    setPlantingError(null);
    try {
      await createPlanting(apiFetch, payload);
      setPlantingOpen(false);
      reload();
    } catch (err) {
      setPlantingError(err instanceof ApiError ? err.message : (err as Error).message);
    } finally {
      setPlantingBusy(false);
    }
  };

  const handlePlantingStatus = async (
    id: string,
    status: PlantingStatus,
  ): Promise<void> => {
    setUpdatingPlantingId(id);
    try {
      await updatePlanting(apiFetch, id, { status });
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message);
    } finally {
      setUpdatingPlantingId(null);
    }
  };

  const handleDeletePlanting = async (id: string): Promise<void> => {
    setDeletingPlantingId(id);
    try {
      await deletePlanting(apiFetch, id);
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message);
    } finally {
      setDeletingPlantingId(null);
    }
  };

  return (
    <section className="space-y-8">
      <header className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold text-foreground">Beds &amp; plantings</h1>
          <p className="text-muted-foreground">
            Lay out your garden beds and track what is planted where.
          </p>
        </div>
        <Link to="/garden" className="btn-secondary w-auto">
          Back to garden
        </Link>
      </header>

      {error && <p className="form-error">{error}</p>}

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-lg font-semibold text-foreground">Planting calendar · {currentYear}</h2>
        </div>
        {plantings === null ? (
          <p className="text-muted-foreground">Loading...</p>
        ) : (
          <PlantingCalendar plantings={plantings} year={currentYear} />
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-lg font-semibold text-foreground">Beds</h2>
          <button
            type="button"
            className="btn-primary w-auto"
            onClick={() => {
              setBedError(null);
              setBedOpen(true);
            }}
          >
            Add bed
          </button>
        </div>
        {beds === null && !error && <p className="text-muted-foreground">Loading...</p>}
        {beds && beds.length === 0 && (
          <p className="text-muted-foreground text-sm">
            No beds yet. Add one to start organizing your plantings.
          </p>
        )}
        {beds && beds.length > 0 && (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Area (sq ft)</th>
                  <th>Location</th>
                  <th>Notes</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {beds.map((b) => (
                  <tr key={b.id}>
                    <td className="font-medium text-foreground">{b.name}</td>
                    <td className="text-muted-foreground">{b.area ?? '—'}</td>
                    <td className="text-muted-foreground">{b.location ?? '—'}</td>
                    <td className="text-muted-foreground">{b.notes ?? '—'}</td>
                    <td className="text-right">
                      <button
                        type="button"
                        className="btn-link text-error-600 hover:text-error-700"
                        onClick={() => void handleDeleteBed(b.id)}
                        disabled={deletingBedId === b.id}
                      >
                        {deletingBedId === b.id ? 'Removing...' : 'Delete'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-lg font-semibold text-foreground">Plantings</h2>
          <button
            type="button"
            className="btn-primary w-auto"
            onClick={() => {
              setPlantingError(null);
              setPlantingOpen(true);
            }}
          >
            Add planting
          </button>
        </div>
        {plantings === null && !error && <p className="text-muted-foreground">Loading...</p>}
        {plantings && plantings.length === 0 && (
          <p className="text-muted-foreground text-sm">
            No plantings yet. Add one to populate the calendar.
          </p>
        )}
        {plantings && plantings.length > 0 && (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Crop</th>
                  <th>Bed</th>
                  <th>Status</th>
                  <th>Sown</th>
                  <th>Harvest (exp.)</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {plantings.map((p) => (
                  <tr key={p.id}>
                    <td className="font-medium text-foreground">
                      {p.crop}
                      {p.variety ? (
                        <span className="text-muted-foreground"> · {p.variety}</span>
                      ) : null}
                    </td>
                    <td className="text-muted-foreground">
                      {p.bedId ? bedNameById.get(p.bedId) ?? '—' : '—'}
                    </td>
                    <td>
                      <div className="flex items-center gap-2">
                        <StatusBadge label={p.status} tone={plantingTone(p.status)} />
                        <select
                          className="input w-auto py-1 text-xs"
                          value={p.status}
                          disabled={updatingPlantingId === p.id}
                          onChange={(e) =>
                            void handlePlantingStatus(
                              p.id,
                              e.target.value as PlantingStatus,
                            )
                          }
                          aria-label={`Update status for ${p.crop}`}
                        >
                          {PLANTING_STATUSES.map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </select>
                      </div>
                    </td>
                    <td className="text-muted-foreground">
                      {formatShortDate(p.sowDate ?? p.transplantDate)}
                    </td>
                    <td className="text-muted-foreground">
                      {formatShortDate(p.harvestDate ?? p.expectedHarvestDate)}
                    </td>
                    <td className="text-right">
                      <button
                        type="button"
                        className="btn-link text-error-600 hover:text-error-700"
                        onClick={() => void handleDeletePlanting(p.id)}
                        disabled={deletingPlantingId === p.id}
                      >
                        {deletingPlantingId === p.id ? 'Removing...' : 'Delete'}
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
        open={bedOpen}
        title="Add bed"
        onClose={() => (!bedBusy ? setBedOpen(false) : undefined)}
      >
        <BedForm
          busy={bedBusy}
          serverError={bedError}
          onSubmit={(p) => void handleCreateBed(p)}
          onCancel={() => setBedOpen(false)}
        />
      </Modal>

      <Modal
        open={plantingOpen}
        title="Add planting"
        onClose={() => (!plantingBusy ? setPlantingOpen(false) : undefined)}
      >
        <PlantingForm
          busy={plantingBusy}
          serverError={plantingError}
          beds={beds ?? []}
          onSubmit={(p) => void handleCreatePlanting(p)}
          onCancel={() => setPlantingOpen(false)}
        />
      </Modal>
    </section>
  );
}

interface BedFormProps {
  busy: boolean;
  serverError: string | null;
  onSubmit: (payload: CreateBedRequest) => void;
  onCancel: () => void;
}

function BedForm({ busy, serverError, onSubmit, onCancel }: BedFormProps): ReactElement {
  const [name, setName] = useState('');
  const [area, setArea] = useState('');
  const [location, setLocation] = useState('');
  const [notes, setNotes] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);

  const submit = (): void => {
    setValidationError(null);
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      setValidationError('Name is required.');
      return;
    }
    const payload: CreateBedRequest = { name: trimmed };
    if (area.trim().length > 0) {
      const value = Number(area);
      if (!Number.isFinite(value) || value < 0) {
        setValidationError('Area must be a non-negative number.');
        return;
      }
      payload.area = value;
    }
    const loc = location.trim();
    if (loc.length > 0) payload.location = loc;
    const note = notes.trim();
    if (note.length > 0) payload.notes = note;
    onSubmit(payload);
  };

  return (
    <div className="card card-body space-y-3 max-w-2xl">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="field-label">Name</span>
          <input
            type="text"
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. North raised bed"
            disabled={busy}
            autoFocus
          />
        </label>
        <label className="block">
          <span className="field-label">Area (sq ft)</span>
          <input
            type="number"
            min="0"
            step="1"
            className="input"
            value={area}
            onChange={(e) => setArea(e.target.value)}
            placeholder="Optional"
            disabled={busy}
          />
        </label>
      </div>
      <label className="block">
        <span className="field-label">Location</span>
        <input
          type="text"
          className="input"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="Optional"
          disabled={busy}
        />
      </label>
      <label className="block">
        <span className="field-label">Notes</span>
        <input
          type="text"
          className="input"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Optional"
          disabled={busy}
        />
      </label>

      {validationError && <p className="form-error">{validationError}</p>}
      {serverError && <p className="form-error">{serverError}</p>}

      <div className="flex justify-end gap-2 pt-2">
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="button" className="btn-primary" onClick={submit} disabled={busy}>
          {busy ? 'Saving...' : 'Add bed'}
        </button>
      </div>
    </div>
  );
}

interface PlantingFormProps {
  busy: boolean;
  serverError: string | null;
  beds: Bed[];
  onSubmit: (payload: CreatePlantingRequest) => void;
  onCancel: () => void;
}

function PlantingForm({
  busy,
  serverError,
  beds,
  onSubmit,
  onCancel,
}: PlantingFormProps): ReactElement {
  const [crop, setCrop] = useState('');
  const [variety, setVariety] = useState('');
  const [bedId, setBedId] = useState('');
  const [status, setStatus] = useState<PlantingStatus>('planned');
  const [sowDate, setSowDate] = useState('');
  const [expectedHarvestDate, setExpectedHarvestDate] = useState('');
  const [note, setNote] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);

  const submit = (): void => {
    setValidationError(null);
    const trimmed = crop.trim();
    if (trimmed.length === 0) {
      setValidationError('Crop is required.');
      return;
    }
    const payload: CreatePlantingRequest = { crop: trimmed, status };
    const v = variety.trim();
    if (v.length > 0) payload.variety = v;
    if (bedId) payload.bedId = bedId;
    if (sowDate) payload.sowDate = sowDate;
    if (expectedHarvestDate) payload.expectedHarvestDate = expectedHarvestDate;
    const n = note.trim();
    if (n.length > 0) payload.note = n;
    onSubmit(payload);
  };

  return (
    <div className="card card-body space-y-3 max-w-2xl">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="field-label">Crop</span>
          <input
            type="text"
            className="input"
            value={crop}
            onChange={(e) => setCrop(e.target.value)}
            placeholder="e.g. tomatoes"
            disabled={busy}
            autoFocus
          />
        </label>
        <label className="block">
          <span className="field-label">Variety</span>
          <input
            type="text"
            className="input"
            value={variety}
            onChange={(e) => setVariety(e.target.value)}
            placeholder="Optional"
            disabled={busy}
          />
        </label>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="field-label">Bed</span>
          <select
            className="input"
            value={bedId}
            onChange={(e) => setBedId(e.target.value)}
            disabled={busy || beds.length === 0}
          >
            <option value="">Unassigned</option>
            {beds.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="field-label">Status</span>
          <select
            className="input"
            value={status}
            onChange={(e) => setStatus(e.target.value as PlantingStatus)}
            disabled={busy}
          >
            {PLANTING_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="field-label">Sow date</span>
          <input
            type="date"
            className="input"
            value={sowDate}
            onChange={(e) => setSowDate(e.target.value)}
            disabled={busy}
          />
        </label>
        <label className="block">
          <span className="field-label">Expected harvest</span>
          <input
            type="date"
            className="input"
            value={expectedHarvestDate}
            onChange={(e) => setExpectedHarvestDate(e.target.value)}
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

      {validationError && <p className="form-error">{validationError}</p>}
      {serverError && <p className="form-error">{serverError}</p>}

      <div className="flex justify-end gap-2 pt-2">
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="button" className="btn-primary" onClick={submit} disabled={busy}>
          {busy ? 'Saving...' : 'Add planting'}
        </button>
      </div>
    </div>
  );
}
