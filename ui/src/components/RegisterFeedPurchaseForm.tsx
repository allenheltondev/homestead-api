import type { ReactElement } from 'react';
import { useState } from 'react';
import type { CreateFeedPurchaseRequest } from '../api/types';

interface Props {
  busy: boolean;
  serverError: string | null;
  submitLabel?: string;
  onSubmit: (payload: CreateFeedPurchaseRequest) => void;
  onCancel: () => void;
}

interface FormState {
  feedType: string;
  bags: string;
  bagWeightLbs: string;
  cost: string;
  date: string;
  flock: string;
}

const EMPTY: FormState = {
  feedType: '',
  bags: '',
  bagWeightLbs: '',
  cost: '',
  date: '',
  flock: '',
};

// Records a feed-by-the-bag purchase. feedType/bags/bagWeightLbs are required;
// the server computes total lbs (bags * bagWeightLbs). cost and date are
// optional — date defaults server-side to today when left blank.
export default function RegisterFeedPurchaseForm({
  busy,
  serverError,
  submitLabel = 'Record purchase',
  onSubmit,
  onCancel,
}: Props): ReactElement {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [validationError, setValidationError] = useState<string | null>(null);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]): void => {
    setForm((f) => ({ ...f, [key]: value }));
  };

  const bagsNum = Number(form.bags);
  const bagWeightNum = Number(form.bagWeightLbs);
  const totalLbs =
    Number.isFinite(bagsNum) && Number.isFinite(bagWeightNum) && bagsNum > 0 && bagWeightNum > 0
      ? bagsNum * bagWeightNum
      : null;

  const submit = (): void => {
    setValidationError(null);
    const feedType = form.feedType.trim();

    if (feedType.length === 0) {
      setValidationError('Feed type is required.');
      return;
    }
    if (!Number.isFinite(bagsNum) || bagsNum <= 0) {
      setValidationError('Bags must be a positive number.');
      return;
    }
    if (!Number.isFinite(bagWeightNum) || bagWeightNum <= 0) {
      setValidationError('Bag weight must be a positive number.');
      return;
    }

    const cost = Number(form.cost);
    if (form.cost.trim().length > 0 && (!Number.isFinite(cost) || cost < 0)) {
      setValidationError('Cost must be a non-negative number.');
      return;
    }

    const payload: CreateFeedPurchaseRequest = {
      feedType,
      bags: bagsNum,
      bagWeightLbs: bagWeightNum,
    };
    if (form.cost.trim().length > 0) payload.cost = cost;
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

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
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
        <label className="block">
          <span className="field-label">Cost (USD)</span>
          <input
            type="number"
            min="0"
            step="any"
            className="input"
            value={form.cost}
            onChange={(e) => update('cost', e.target.value)}
            disabled={busy}
          />
          <span className="field-hint mt-1 block">Optional.</span>
        </label>
      </div>

      <div className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
        Total feed:{' '}
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
        <span className="field-label">Purchased on</span>
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
