import type { ReactElement } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { useApiFetch, ApiError } from '../auth/useApiFetch';
import {
  createIncubationBatch,
  deleteIncubationBatch,
  listIncubationBatches,
  updateIncubationBatch,
} from '../api/incubation';
import { createBreeding, deleteBreeding, listBreedings } from '../api/breeding';
import {
  createGrowoutBatch,
  listGrowoutBatches,
  updateGrowoutBatch,
} from '../api/growout';
import type {
  Breeding,
  CreateBreedingRequest,
  CreateGrowoutBatchRequest,
  CreateIncubationBatchRequest,
  GrowoutBatch,
  IncubationBatch,
} from '../api/types';
import Modal from '../components/Modal';
import { formatShortDate } from '../components/format';

function daysUntil(dueDate: string | null): number | null {
  if (!dueDate) return null;
  const due = Date.parse(`${dueDate.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(due)) return null;
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((due - today) / 86_400_000);
}

function dueText(days: number | null): string {
  if (days === null) return '—';
  if (days < 0) return `${Math.abs(days)}d ago`;
  if (days === 0) return 'today';
  return `in ${days}d`;
}

export default function Hatchery(): ReactElement {
  const apiFetch = useApiFetch();

  const [batches, setBatches] = useState<IncubationBatch[] | null>(null);
  const [breedings, setBreedings] = useState<Breeding[] | null>(null);
  const [growout, setGrowout] = useState<GrowoutBatch[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [incOpen, setIncOpen] = useState(false);
  const [incBusy, setIncBusy] = useState(false);
  const [incError, setIncError] = useState<string | null>(null);

  const [breedOpen, setBreedOpen] = useState(false);
  const [breedBusy, setBreedBusy] = useState(false);
  const [breedError, setBreedError] = useState<string | null>(null);

  const [growOpen, setGrowOpen] = useState(false);
  const [growBusy, setGrowBusy] = useState(false);
  const [growError, setGrowError] = useState<string | null>(null);

  const [hatchFor, setHatchFor] = useState<IncubationBatch | null>(null);
  const [hatchBusy, setHatchBusy] = useState(false);
  const [hatchError, setHatchError] = useState<string | null>(null);

  const [processFor, setProcessFor] = useState<GrowoutBatch | null>(null);
  const [processBusy, setProcessBusy] = useState(false);
  const [processError, setProcessError] = useState<string | null>(null);

  const [busyId, setBusyId] = useState<string | null>(null);

  const reload = useCallback((): (() => void) => {
    let cancelled = false;
    setError(null);
    setBatches(null);
    setBreedings(null);
    setGrowout(null);

    listIncubationBatches(apiFetch)
      .then((res) => {
        if (!cancelled) setBatches(res.incubation_batches);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    listBreedings(apiFetch)
      .then((res) => {
        if (!cancelled) setBreedings(res.breedings);
      })
      .catch(() => {
        if (!cancelled) setBreedings([]);
      });
    listGrowoutBatches(apiFetch)
      .then((res) => {
        if (!cancelled) setGrowout(res.growout_batches);
      })
      .catch(() => {
        if (!cancelled) setGrowout([]);
      });

    return () => {
      cancelled = true;
    };
  }, [apiFetch]);

  useEffect(() => reload(), [reload]);

  const handleCreateIncubation = async (
    payload: CreateIncubationBatchRequest,
  ): Promise<void> => {
    setIncBusy(true);
    setIncError(null);
    try {
      await createIncubationBatch(apiFetch, payload);
      setIncOpen(false);
      reload();
    } catch (err) {
      setIncError(err instanceof ApiError ? err.message : (err as Error).message);
    } finally {
      setIncBusy(false);
    }
  };

  const handleRecordHatch = async (count: number, date: string): Promise<void> => {
    if (!hatchFor) return;
    setHatchBusy(true);
    setHatchError(null);
    try {
      await updateIncubationBatch(apiFetch, hatchFor.id, {
        hatchedCount: count,
        hatchedDate: date || undefined,
        status: 'hatched',
      });
      setHatchFor(null);
      reload();
    } catch (err) {
      setHatchError(err instanceof ApiError ? err.message : (err as Error).message);
    } finally {
      setHatchBusy(false);
    }
  };

  const handleDeleteIncubation = async (id: string): Promise<void> => {
    setBusyId(id);
    try {
      await deleteIncubationBatch(apiFetch, id);
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const handleCreateBreeding = async (payload: CreateBreedingRequest): Promise<void> => {
    setBreedBusy(true);
    setBreedError(null);
    try {
      await createBreeding(apiFetch, payload);
      setBreedOpen(false);
      reload();
    } catch (err) {
      setBreedError(err instanceof ApiError ? err.message : (err as Error).message);
    } finally {
      setBreedBusy(false);
    }
  };

  const handleDeleteBreeding = async (id: string): Promise<void> => {
    setBusyId(id);
    try {
      await deleteBreeding(apiFetch, id);
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const handleCreateGrowout = async (payload: CreateGrowoutBatchRequest): Promise<void> => {
    setGrowBusy(true);
    setGrowError(null);
    try {
      await createGrowoutBatch(apiFetch, payload);
      setGrowOpen(false);
      reload();
    } catch (err) {
      setGrowError(err instanceof ApiError ? err.message : (err as Error).message);
    } finally {
      setGrowBusy(false);
    }
  };

  const handleProcess = async (count: number, date: string): Promise<void> => {
    if (!processFor) return;
    setProcessBusy(true);
    setProcessError(null);
    try {
      await updateGrowoutBatch(apiFetch, processFor.id, {
        status: 'processed',
        processedCount: count,
        processedDate: date || undefined,
      });
      setProcessFor(null);
      reload();
    } catch (err) {
      setProcessError(err instanceof ApiError ? err.message : (err as Error).message);
    } finally {
      setProcessBusy(false);
    }
  };

  return (
    <section className="space-y-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold text-foreground">Hatchery &amp; breeding</h1>
        <p className="text-muted-foreground">
          Incubation batches, upcoming kiddings, and grow-out flocks.
        </p>
      </header>

      {error && <p className="form-error">{error}</p>}

      {/* Incubation ------------------------------------------------------- */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-lg font-semibold text-foreground">Incubation</h2>
          <button
            type="button"
            className="btn-primary btn-sm"
            onClick={() => {
              setIncError(null);
              setIncOpen(true);
            }}
          >
            Set eggs
          </button>
        </div>
        {batches === null ? (
          <p className="text-muted-foreground">Loading...</p>
        ) : batches.length === 0 ? (
          <p className="rounded-md bg-muted text-muted-foreground text-sm text-center py-6">
            No incubation batches yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Bird type</th>
                  <th>Eggs set</th>
                  <th>Set</th>
                  <th>Expected hatch</th>
                  <th>Status</th>
                  <th>Hatched</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {batches.map((b) => {
                  const days = daysUntil(b.expectedHatchDate);
                  return (
                    <tr key={b.id}>
                      <td className="font-medium text-foreground">{b.birdType}</td>
                      <td>{b.eggsSet}</td>
                      <td className="text-muted-foreground">{formatShortDate(b.setDate)}</td>
                      <td className="text-muted-foreground">
                        {b.expectedHatchDate ? (
                          <>
                            {formatShortDate(b.expectedHatchDate)}
                            {b.status === 'incubating' && (
                              <span className="block text-xs">({dueText(days)})</span>
                            )}
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td>
                        <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                          {b.status}
                        </span>
                      </td>
                      <td className="text-muted-foreground">
                        {b.hatchedCount == null ? '—' : b.hatchedCount}
                      </td>
                      <td className="text-right whitespace-nowrap">
                        {b.status === 'incubating' && (
                          <button
                            type="button"
                            className="btn-link"
                            onClick={() => {
                              setHatchError(null);
                              setHatchFor(b);
                            }}
                          >
                            Record hatch
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn-link text-error-600 hover:text-error-700 ml-3"
                          onClick={() => void handleDeleteIncubation(b.id)}
                          disabled={busyId === b.id}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Breeding --------------------------------------------------------- */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-lg font-semibold text-foreground">
            Upcoming breedings &amp; kiddings
          </h2>
          <button
            type="button"
            className="btn-primary btn-sm"
            onClick={() => {
              setBreedError(null);
              setBreedOpen(true);
            }}
          >
            Record breeding
          </button>
        </div>
        {breedings === null ? (
          <p className="text-muted-foreground">Loading...</p>
        ) : breedings.length === 0 ? (
          <p className="rounded-md bg-muted text-muted-foreground text-sm text-center py-6">
            No breedings recorded yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Species</th>
                  <th>Dam</th>
                  <th>Sire</th>
                  <th>Bred</th>
                  <th>Expected due</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {breedings.map((b) => {
                  const days = daysUntil(b.expectedDueDate);
                  const soon = days !== null && days >= 0 && days <= 7;
                  return (
                    <tr key={b.id}>
                      <td className="font-medium text-foreground">{b.species}</td>
                      <td className="text-muted-foreground">{b.damRef ?? '—'}</td>
                      <td className="text-muted-foreground">{b.sireRef ?? '—'}</td>
                      <td className="text-muted-foreground">{formatShortDate(b.bredDate)}</td>
                      <td>
                        {b.expectedDueDate ? (
                          <span className={soon ? 'text-warning-700 font-medium' : ''}>
                            {formatShortDate(b.expectedDueDate)}{' '}
                            <span className="text-xs">({dueText(days)})</span>
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="text-right">
                        <button
                          type="button"
                          className="btn-link text-error-600 hover:text-error-700"
                          onClick={() => void handleDeleteBreeding(b.id)}
                          disabled={busyId === b.id}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Grow-out --------------------------------------------------------- */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-lg font-semibold text-foreground">Grow-out</h2>
          <button
            type="button"
            className="btn-primary btn-sm"
            onClick={() => {
              setGrowError(null);
              setGrowOpen(true);
            }}
          >
            Start batch
          </button>
        </div>
        {growout === null ? (
          <p className="text-muted-foreground">Loading...</p>
        ) : growout.length === 0 ? (
          <p className="rounded-md bg-muted text-muted-foreground text-sm text-center py-6">
            No grow-out batches yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Batch</th>
                  <th>Species</th>
                  <th>Count</th>
                  <th>Started</th>
                  <th>Status</th>
                  <th>Processed</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {growout.map((g) => (
                  <tr key={g.id}>
                    <td className="font-medium text-foreground">{g.label}</td>
                    <td>{g.species}</td>
                    <td>{g.count}</td>
                    <td className="text-muted-foreground">{formatShortDate(g.startDate)}</td>
                    <td>
                      <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                        {g.status}
                      </span>
                    </td>
                    <td className="text-muted-foreground">
                      {g.processedCount == null ? '—' : g.processedCount}
                    </td>
                    <td className="text-right">
                      {g.status === 'growing' && (
                        <button
                          type="button"
                          className="btn-link"
                          onClick={() => {
                            setProcessError(null);
                            setProcessFor(g);
                          }}
                        >
                          Process
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Modal
        open={incOpen}
        title="Set eggs to incubate"
        onClose={() => (!incBusy ? setIncOpen(false) : undefined)}
      >
        <IncubationForm
          busy={incBusy}
          serverError={incError}
          onSubmit={(p) => void handleCreateIncubation(p)}
          onCancel={() => setIncOpen(false)}
        />
      </Modal>

      <Modal
        open={breedOpen}
        title="Record breeding"
        onClose={() => (!breedBusy ? setBreedOpen(false) : undefined)}
      >
        <BreedingForm
          busy={breedBusy}
          serverError={breedError}
          onSubmit={(p) => void handleCreateBreeding(p)}
          onCancel={() => setBreedOpen(false)}
        />
      </Modal>

      <Modal
        open={growOpen}
        title="Start grow-out batch"
        onClose={() => (!growBusy ? setGrowOpen(false) : undefined)}
      >
        <GrowoutForm
          busy={growBusy}
          serverError={growError}
          onSubmit={(p) => void handleCreateGrowout(p)}
          onCancel={() => setGrowOpen(false)}
        />
      </Modal>

      <Modal
        open={hatchFor !== null}
        title="Record hatch"
        onClose={() => (!hatchBusy ? setHatchFor(null) : undefined)}
      >
        <CountDateForm
          busy={hatchBusy}
          serverError={hatchError}
          countLabel="Chicks hatched"
          dateLabel="Hatched on"
          submitLabel="Record hatch"
          onSubmit={(count, date) => void handleRecordHatch(count, date)}
          onCancel={() => setHatchFor(null)}
        />
      </Modal>

      <Modal
        open={processFor !== null}
        title="Process batch"
        onClose={() => (!processBusy ? setProcessFor(null) : undefined)}
      >
        <CountDateForm
          busy={processBusy}
          serverError={processError}
          countLabel="Birds processed"
          dateLabel="Processed on"
          submitLabel="Process"
          onSubmit={(count, date) => void handleProcess(count, date)}
          onCancel={() => setProcessFor(null)}
        />
      </Modal>
    </section>
  );
}

interface IncubationFormProps {
  busy: boolean;
  serverError: string | null;
  onSubmit: (payload: CreateIncubationBatchRequest) => void;
  onCancel: () => void;
}

function IncubationForm({
  busy,
  serverError,
  onSubmit,
  onCancel,
}: IncubationFormProps): ReactElement {
  const [birdType, setBirdType] = useState('');
  const [eggsSet, setEggsSet] = useState('');
  const [setDate, setSetDate] = useState('');
  const [note, setNote] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);

  const submit = (): void => {
    setValidationError(null);
    const type = birdType.trim();
    if (type.length === 0) {
      setValidationError('Bird type is required.');
      return;
    }
    const count = Number(eggsSet);
    if (!Number.isInteger(count) || count <= 0) {
      setValidationError('Eggs set must be a positive whole number.');
      return;
    }
    const payload: CreateIncubationBatchRequest = { birdType: type, eggsSet: count };
    if (setDate) payload.setDate = setDate;
    const noteText = note.trim();
    if (noteText.length > 0) payload.note = noteText;
    onSubmit(payload);
  };

  return (
    <div className="card card-body space-y-3 max-w-2xl">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="field-label">Bird type</span>
          <input
            type="text"
            className="input"
            value={birdType}
            onChange={(e) => setBirdType(e.target.value)}
            placeholder="e.g. chicken, duck, quail"
            disabled={busy}
            autoFocus
          />
        </label>
        <label className="block">
          <span className="field-label">Eggs set</span>
          <input
            type="number"
            min="1"
            step="1"
            className="input"
            value={eggsSet}
            onChange={(e) => setEggsSet(e.target.value)}
            disabled={busy}
          />
        </label>
      </div>
      <label className="block">
        <span className="field-label">Set on</span>
        <input
          type="date"
          className="input"
          value={setDate}
          onChange={(e) => setSetDate(e.target.value)}
          disabled={busy}
        />
        <span className="field-hint mt-1 block">
          Expected hatch date is computed from the bird type when left blank.
        </span>
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
      {validationError && <p className="form-error">{validationError}</p>}
      {serverError && <p className="form-error">{serverError}</p>}
      <div className="flex justify-end gap-2 pt-2">
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="button" className="btn-primary" onClick={submit} disabled={busy}>
          {busy ? 'Saving...' : 'Set eggs'}
        </button>
      </div>
    </div>
  );
}

interface BreedingFormProps {
  busy: boolean;
  serverError: string | null;
  onSubmit: (payload: CreateBreedingRequest) => void;
  onCancel: () => void;
}

function BreedingForm({
  busy,
  serverError,
  onSubmit,
  onCancel,
}: BreedingFormProps): ReactElement {
  const [species, setSpecies] = useState('');
  const [damRef, setDamRef] = useState('');
  const [sireRef, setSireRef] = useState('');
  const [bredDate, setBredDate] = useState('');
  const [expectedDueDate, setExpectedDueDate] = useState('');
  const [note, setNote] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);

  const submit = (): void => {
    setValidationError(null);
    const sp = species.trim();
    if (sp.length === 0) {
      setValidationError('Species is required.');
      return;
    }
    const payload: CreateBreedingRequest = { species: sp };
    const dam = damRef.trim();
    if (dam.length > 0) payload.damRef = dam;
    const sire = sireRef.trim();
    if (sire.length > 0) payload.sireRef = sire;
    if (bredDate) payload.bredDate = bredDate;
    if (expectedDueDate) payload.expectedDueDate = expectedDueDate;
    const noteText = note.trim();
    if (noteText.length > 0) payload.note = noteText;
    onSubmit(payload);
  };

  return (
    <div className="card card-body space-y-3 max-w-2xl">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <label className="block">
          <span className="field-label">Species</span>
          <input
            type="text"
            className="input"
            value={species}
            onChange={(e) => setSpecies(e.target.value)}
            placeholder="e.g. goat"
            disabled={busy}
            autoFocus
          />
        </label>
        <label className="block">
          <span className="field-label">Dam</span>
          <input
            type="text"
            className="input"
            value={damRef}
            onChange={(e) => setDamRef(e.target.value)}
            placeholder="Optional"
            disabled={busy}
          />
        </label>
        <label className="block">
          <span className="field-label">Sire</span>
          <input
            type="text"
            className="input"
            value={sireRef}
            onChange={(e) => setSireRef(e.target.value)}
            placeholder="Optional"
            disabled={busy}
          />
        </label>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="field-label">Bred on</span>
          <input
            type="date"
            className="input"
            value={bredDate}
            onChange={(e) => setBredDate(e.target.value)}
            disabled={busy}
          />
          <span className="field-hint mt-1 block">Defaults to today if left blank.</span>
        </label>
        <label className="block">
          <span className="field-label">Expected due</span>
          <input
            type="date"
            className="input"
            value={expectedDueDate}
            onChange={(e) => setExpectedDueDate(e.target.value)}
            disabled={busy}
          />
          <span className="field-hint mt-1 block">
            Computed from species gestation when blank.
          </span>
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
          {busy ? 'Saving...' : 'Record breeding'}
        </button>
      </div>
    </div>
  );
}

interface GrowoutFormProps {
  busy: boolean;
  serverError: string | null;
  onSubmit: (payload: CreateGrowoutBatchRequest) => void;
  onCancel: () => void;
}

function GrowoutForm({
  busy,
  serverError,
  onSubmit,
  onCancel,
}: GrowoutFormProps): ReactElement {
  const [label, setLabel] = useState('');
  const [species, setSpecies] = useState('');
  const [count, setCount] = useState('');
  const [startDate, setStartDate] = useState('');
  const [note, setNote] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);

  const submit = (): void => {
    setValidationError(null);
    const labelText = label.trim();
    if (labelText.length === 0) {
      setValidationError('Batch label is required.');
      return;
    }
    const sp = species.trim();
    if (sp.length === 0) {
      setValidationError('Species is required.');
      return;
    }
    const n = Number(count);
    if (!Number.isInteger(n) || n <= 0) {
      setValidationError('Count must be a positive whole number.');
      return;
    }
    const payload: CreateGrowoutBatchRequest = { label: labelText, species: sp, count: n };
    if (startDate) payload.startDate = startDate;
    const noteText = note.trim();
    if (noteText.length > 0) payload.note = noteText;
    onSubmit(payload);
  };

  return (
    <div className="card card-body space-y-3 max-w-2xl">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <label className="block">
          <span className="field-label">Batch label</span>
          <input
            type="text"
            className="input"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Spring broilers"
            disabled={busy}
            autoFocus
          />
        </label>
        <label className="block">
          <span className="field-label">Species</span>
          <input
            type="text"
            className="input"
            value={species}
            onChange={(e) => setSpecies(e.target.value)}
            placeholder="e.g. chicken"
            disabled={busy}
          />
        </label>
        <label className="block">
          <span className="field-label">Count</span>
          <input
            type="number"
            min="1"
            step="1"
            className="input"
            value={count}
            onChange={(e) => setCount(e.target.value)}
            disabled={busy}
          />
        </label>
      </div>
      <label className="block">
        <span className="field-label">Started on</span>
        <input
          type="date"
          className="input"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          disabled={busy}
        />
        <span className="field-hint mt-1 block">Defaults to today if left blank.</span>
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
      {validationError && <p className="form-error">{validationError}</p>}
      {serverError && <p className="form-error">{serverError}</p>}
      <div className="flex justify-end gap-2 pt-2">
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="button" className="btn-primary" onClick={submit} disabled={busy}>
          {busy ? 'Saving...' : 'Start batch'}
        </button>
      </div>
    </div>
  );
}

interface CountDateFormProps {
  busy: boolean;
  serverError: string | null;
  countLabel: string;
  dateLabel: string;
  submitLabel: string;
  onSubmit: (count: number, date: string) => void;
  onCancel: () => void;
}

function CountDateForm({
  busy,
  serverError,
  countLabel,
  dateLabel,
  submitLabel,
  onSubmit,
  onCancel,
}: CountDateFormProps): ReactElement {
  const [count, setCount] = useState('');
  const [date, setDate] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);

  const submit = (): void => {
    setValidationError(null);
    const n = Number(count);
    if (!Number.isInteger(n) || n < 0) {
      setValidationError('Count must be zero or a positive whole number.');
      return;
    }
    onSubmit(n, date);
  };

  return (
    <div className="card card-body space-y-3 max-w-2xl">
      <label className="block">
        <span className="field-label">{countLabel}</span>
        <input
          type="number"
          min="0"
          step="1"
          className="input"
          value={count}
          onChange={(e) => setCount(e.target.value)}
          disabled={busy}
          autoFocus
        />
      </label>
      <label className="block">
        <span className="field-label">{dateLabel}</span>
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
          {busy ? 'Saving...' : submitLabel}
        </button>
      </div>
    </div>
  );
}
