import type { ReactElement } from 'react';
import { useState } from 'react';
import { FEED_UNITS, type CreateFeedPurchaseRequest, type FeedUnit } from '../api/types';

interface Props {
  busy: boolean;
  serverError: string | null;
  submitLabel?: string;
  onSubmit: (payload: CreateFeedPurchaseRequest) => void;
  onCancel: () => void;
}

interface FormState {
  type: string;
  quantity: string;
  unit: FeedUnit;
  cost: string;
  vendor: string;
  purchasedAt: string;
}

const EMPTY: FormState = {
  type: '',
  quantity: '',
  unit: 'lb',
  cost: '',
  vendor: '',
  purchasedAt: '',
};

// Records a feed purchase. type/quantity/unit/cost/vendor are required;
// purchasedAt defaults server-side to now when left blank.
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

  const submit = (): void => {
    setValidationError(null);
    const type = form.type.trim();
    const vendor = form.vendor.trim();
    const quantity = Number(form.quantity);
    const cost = Number(form.cost);

    if (type.length === 0) {
      setValidationError('Feed type is required.');
      return;
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setValidationError('Quantity must be a positive number.');
      return;
    }
    if (!Number.isFinite(cost) || cost < 0) {
      setValidationError('Cost must be a non-negative number.');
      return;
    }
    if (vendor.length === 0) {
      setValidationError('Vendor is required.');
      return;
    }

    const payload: CreateFeedPurchaseRequest = {
      type,
      quantity,
      unit: form.unit,
      cost,
      vendor,
    };
    if (form.purchasedAt) payload.purchasedAt = form.purchasedAt;

    onSubmit(payload);
  };

  return (
    <div className="card card-body space-y-3 max-w-2xl">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="field-label">Feed type</span>
          <input
            type="text"
            className="input"
            value={form.type}
            onChange={(e) => update('type', e.target.value)}
            placeholder="hay, grain, mineral, ..."
            disabled={busy}
            autoFocus
          />
        </label>
        <label className="block">
          <span className="field-label">Vendor</span>
          <input
            type="text"
            className="input"
            value={form.vendor}
            onChange={(e) => update('vendor', e.target.value)}
            disabled={busy}
          />
        </label>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <label className="block">
          <span className="field-label">Quantity</span>
          <input
            type="number"
            min="0"
            step="any"
            className="input"
            value={form.quantity}
            onChange={(e) => update('quantity', e.target.value)}
            disabled={busy}
          />
        </label>
        <label className="block">
          <span className="field-label">Unit</span>
          <select
            className="input"
            value={form.unit}
            onChange={(e) => update('unit', e.target.value as FeedUnit)}
            disabled={busy}
          >
            {FEED_UNITS.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
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
        </label>
      </div>

      <label className="block">
        <span className="field-label">Purchased on</span>
        <input
          type="date"
          className="input"
          value={form.purchasedAt}
          onChange={(e) => update('purchasedAt', e.target.value)}
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
