import type { ReactElement } from 'react';
import { useState } from 'react';
import type { Bed, CreateHarvestLogRequest } from '../api/types';

interface Props {
  busy: boolean;
  serverError: string | null;
  beds?: Bed[];
  submitLabel?: string;
  onSubmit: (payload: CreateHarvestLogRequest) => void;
  onCancel: () => void;
}

interface FormState {
  crop: string;
  quantity: string;
  unit: string;
  date: string;
  bedId: string;
  cost: string;
  note: string;
}

const EMPTY: FormState = {
  crop: '',
  quantity: '',
  unit: 'lb',
  date: '',
  bedId: '',
  cost: '',
  note: '',
};

// Logs a garden harvest. crop and quantity are required; unit defaults to lb;
// date defaults server-side to today; bed, cost, and note are optional.
export default function RegisterHarvestForm({
  busy,
  serverError,
  beds,
  submitLabel = 'Log harvest',
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
    const crop = form.crop.trim();
    if (crop.length === 0) {
      setValidationError('Crop is required.');
      return;
    }
    const quantity = Number(form.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setValidationError('Quantity must be a positive number.');
      return;
    }

    const payload: CreateHarvestLogRequest = { crop, quantity };
    const unit = form.unit.trim();
    if (unit.length > 0) payload.unit = unit;
    if (form.date) payload.date = form.date;
    if (form.bedId) payload.bedId = form.bedId;
    const note = form.note.trim();
    if (note.length > 0) payload.note = note;
    if (form.cost.trim().length > 0) {
      const cost = Number(form.cost);
      if (!Number.isFinite(cost) || cost < 0) {
        setValidationError('Cost must be a non-negative number.');
        return;
      }
      payload.cost = cost;
    }

    onSubmit(payload);
  };

  return (
    <div className="card card-body space-y-3 max-w-2xl">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <label className="block sm:col-span-1">
          <span className="field-label">Crop</span>
          <input
            type="text"
            className="input"
            value={form.crop}
            onChange={(e) => update('crop', e.target.value)}
            placeholder="e.g. tomatoes"
            disabled={busy}
            autoFocus
          />
        </label>
        <label className="block">
          <span className="field-label">Quantity</span>
          <input
            type="number"
            min="0"
            step="0.01"
            className="input"
            value={form.quantity}
            onChange={(e) => update('quantity', e.target.value)}
            disabled={busy}
          />
        </label>
        <label className="block">
          <span className="field-label">Unit</span>
          <input
            type="text"
            className="input"
            value={form.unit}
            onChange={(e) => update('unit', e.target.value)}
            placeholder="lb, count, bunch"
            disabled={busy}
          />
        </label>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="field-label">Bed</span>
          <select
            className="input"
            value={form.bedId}
            onChange={(e) => update('bedId', e.target.value)}
            disabled={busy || !beds || beds.length === 0}
          >
            <option value="">Unassigned</option>
            {beds?.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="field-label">Input cost (USD)</span>
          <input
            type="number"
            min="0"
            step="0.01"
            className="input"
            value={form.cost}
            onChange={(e) => update('cost', e.target.value)}
            placeholder="Optional"
            disabled={busy}
          />
          <span className="field-hint mt-1 block">Used to compute cost per unit.</span>
        </label>
      </div>

      <label className="block">
        <span className="field-label">Note</span>
        <input
          type="text"
          className="input"
          value={form.note}
          onChange={(e) => update('note', e.target.value)}
          placeholder="Optional"
          disabled={busy}
        />
      </label>

      <label className="block">
        <span className="field-label">Harvested on</span>
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
