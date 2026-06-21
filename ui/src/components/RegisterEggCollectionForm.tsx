import type { ReactElement } from 'react';
import { useState } from 'react';
import type { CreateEggCollectionRequest } from '../api/types';

interface Props {
  busy: boolean;
  serverError: string | null;
  submitLabel?: string;
  onSubmit: (payload: CreateEggCollectionRequest) => void;
  onCancel: () => void;
}

interface FormState {
  count: string;
  date: string;
  coop: string;
  flock: string;
}

const EMPTY: FormState = {
  count: '',
  date: '',
  coop: '',
  flock: '',
};

// Logs an egg collection. count is required; date defaults server-side to
// today when blank, and coop is optional.
export default function RegisterEggCollectionForm({
  busy,
  serverError,
  submitLabel = 'Log eggs',
  onSubmit,
  onCancel,
}: Props): ReactElement {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [validationError, setValidationError] = useState<string | null>(null);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]): void => {
    setForm((f) => ({ ...f, [key]: value }));
  };

  const submit = (): void => {
    setValidationError(null);
    const count = Number(form.count);

    if (!Number.isInteger(count) || count <= 0) {
      setValidationError('Count must be a positive whole number.');
      return;
    }

    const payload: CreateEggCollectionRequest = { count };
    if (form.date) payload.date = form.date;
    const coop = form.coop.trim();
    if (coop.length > 0) payload.coop = coop;
    const flock = form.flock.trim();
    if (flock.length > 0) payload.flock = flock;

    onSubmit(payload);
  };

  return (
    <div className="card card-body space-y-3 max-w-2xl">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="field-label">Egg count</span>
          <input
            type="number"
            min="1"
            step="1"
            className="input"
            value={form.count}
            onChange={(e) => update('count', e.target.value)}
            disabled={busy}
            autoFocus
          />
        </label>
        <label className="block">
          <span className="field-label">Coop</span>
          <input
            type="text"
            className="input"
            value={form.coop}
            onChange={(e) => update('coop', e.target.value)}
            placeholder="Optional"
            disabled={busy}
          />
        </label>
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
          Attributes eggs to a flock for per-flock cost analytics.
        </span>
      </label>

      <label className="block">
        <span className="field-label">Collected on</span>
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
