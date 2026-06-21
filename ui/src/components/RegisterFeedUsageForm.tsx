import type { ReactElement } from 'react';
import { useState } from 'react';
import type { CreateFeedConsumptionRequest } from '../api/types';

interface Props {
  busy: boolean;
  serverError: string | null;
  submitLabel?: string;
  onSubmit: (payload: CreateFeedConsumptionRequest) => void;
  onCancel: () => void;
}

type Mode = 'lbs' | 'bags';

interface FormState {
  feedType: string;
  mode: Mode;
  lbs: string;
  bags: string;
  bagWeightLbs: string;
  date: string;
  flock: string;
}

const EMPTY: FormState = {
  feedType: '',
  mode: 'lbs',
  lbs: '',
  bags: '',
  bagWeightLbs: '',
  date: '',
  flock: '',
};

// Records feed consumption. feedType is required; supply usage either as a
// direct lb amount or as bags * bag weight (server computes lbs). date defaults
// server-side to today when left blank.
export default function RegisterFeedUsageForm({
  busy,
  serverError,
  submitLabel = 'Record usage',
  onSubmit,
  onCancel,
}: Props): ReactElement {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [validationError, setValidationError] = useState<string | null>(null);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]): void => {
    setForm((f) => ({ ...f, [key]: value }));
  };

  const lbsNum = Number(form.lbs);
  const bagsNum = Number(form.bags);
  const bagWeightNum = Number(form.bagWeightLbs);
  const totalLbs =
    form.mode === 'lbs'
      ? Number.isFinite(lbsNum) && lbsNum > 0
        ? lbsNum
        : null
      : Number.isFinite(bagsNum) &&
          Number.isFinite(bagWeightNum) &&
          bagsNum > 0 &&
          bagWeightNum > 0
        ? bagsNum * bagWeightNum
        : null;

  const submit = (): void => {
    setValidationError(null);
    const feedType = form.feedType.trim();

    if (feedType.length === 0) {
      setValidationError('Feed type is required.');
      return;
    }

    const payload: CreateFeedConsumptionRequest = { feedType };

    if (form.mode === 'lbs') {
      if (!Number.isFinite(lbsNum) || lbsNum <= 0) {
        setValidationError('Pounds used must be a positive number.');
        return;
      }
      payload.lbs = lbsNum;
    } else {
      if (!Number.isFinite(bagsNum) || bagsNum <= 0) {
        setValidationError('Bags must be a positive number.');
        return;
      }
      if (!Number.isFinite(bagWeightNum) || bagWeightNum <= 0) {
        setValidationError('Bag weight must be a positive number.');
        return;
      }
      payload.bags = bagsNum;
      payload.bagWeightLbs = bagWeightNum;
    }

    if (form.date) payload.date = form.date;
    const flock = form.flock.trim();
    if (flock.length > 0) payload.flock = flock;

    onSubmit(payload);
  };

  return (
    <div className="card card-body space-y-3 max-w-2xl">
      <label className="block">
        <span className="field-label">Feed type</span>
        <input
          type="text"
          className="input"
          value={form.feedType}
          onChange={(e) => update('feedType', e.target.value)}
          placeholder="layer pellets, scratch, ..."
          disabled={busy}
          autoFocus
        />
      </label>

      <div className="flex gap-4 text-sm">
        <label className="inline-flex items-center gap-2">
          <input
            type="radio"
            name="usage-mode"
            checked={form.mode === 'lbs'}
            onChange={() => update('mode', 'lbs')}
            disabled={busy}
          />
          <span>By pounds</span>
        </label>
        <label className="inline-flex items-center gap-2">
          <input
            type="radio"
            name="usage-mode"
            checked={form.mode === 'bags'}
            onChange={() => update('mode', 'bags')}
            disabled={busy}
          />
          <span>By bags</span>
        </label>
      </div>

      {form.mode === 'lbs' ? (
        <label className="block">
          <span className="field-label">Pounds used</span>
          <input
            type="number"
            min="0"
            step="any"
            className="input"
            value={form.lbs}
            onChange={(e) => update('lbs', e.target.value)}
            disabled={busy}
          />
        </label>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block">
            <span className="field-label">Bags</span>
            <input
              type="number"
              min="0"
              step="any"
              className="input"
              value={form.bags}
              onChange={(e) => update('bags', e.target.value)}
              disabled={busy}
            />
          </label>
          <label className="block">
            <span className="field-label">Bag weight (lb)</span>
            <input
              type="number"
              min="0"
              step="any"
              className="input"
              value={form.bagWeightLbs}
              onChange={(e) => update('bagWeightLbs', e.target.value)}
              disabled={busy}
            />
          </label>
        </div>
      )}

      <div className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
        Feed used:{' '}
        <span className="font-medium text-foreground">
          {totalLbs === null ? '—' : `${totalLbs.toLocaleString()} lb`}
        </span>
      </div>

      <label className="block">
        <span className="field-label">Flock</span>
        <input
          type="text"
          className="input"
          value={form.flock}
          onChange={(e) => update('flock', e.target.value)}
          placeholder="Optional — e.g. layers, pullets"
          disabled={busy}
        />
        <span className="field-hint mt-1 block">
          Attributes poultry feed to a flock for per-flock cost analytics.
        </span>
      </label>

      <label className="block">
        <span className="field-label">Used on</span>
        <input
          type="date"
          className="input"
          value={form.date}
          onChange={(e) => update('date', e.target.value)}
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
