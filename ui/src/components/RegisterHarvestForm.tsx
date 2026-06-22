import type { ReactElement } from 'react';
import { useState } from 'react';
import type { GrowerCrop, RecordCropHarvestRequest } from '../api/types';

interface Props {
  busy: boolean;
  serverError: string | null;
  crops: GrowerCrop[];
  // Pre-selected crop-library id (e.g. when logging from a crop's harvest view).
  initialCropLibraryId?: string;
  submitLabel?: string;
  onSubmit: (cropLibraryId: string, payload: RecordCropHarvestRequest) => void;
  onCancel: () => void;
}

interface FormState {
  // Selected Good Roots crop-library id the harvest is recorded against.
  cropLibraryId: string;
  amount: string;
  unit: string;
  harvestedOn: string;
  notes: string;
}

// Builds the display name for a crop-library entry (crop · variety).
function cropLabel(c: GrowerCrop): string {
  return c.variety ? `${c.name} · ${c.variety}` : c.name;
}

// Records a garden harvest against a Good Roots crop. The crop is chosen from
// the GRN crop library (harvests are stored per-crop in Good Roots). amount is
// required and must be positive; unit defaults to lb; harvestedOn defaults
// server-side to today; notes is optional.
export default function RegisterHarvestForm({
  busy,
  serverError,
  crops,
  initialCropLibraryId = '',
  submitLabel = 'Log harvest',
  onSubmit,
  onCancel,
}: Props): ReactElement {
  const [form, setForm] = useState<FormState>({
    cropLibraryId: initialCropLibraryId,
    amount: '',
    unit: 'lb',
    harvestedOn: '',
    notes: '',
  });
  const [validationError, setValidationError] = useState<string | null>(null);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]): void => {
    setForm((f) => ({ ...f, [key]: value }));
  };

  const submit = (): void => {
    setValidationError(null);
    if (!form.cropLibraryId) {
      setValidationError('Select a crop to record this harvest against.');
      return;
    }
    const amount = Number(form.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setValidationError('Amount must be a positive number.');
      return;
    }

    const payload: RecordCropHarvestRequest = { amount };
    const unit = form.unit.trim();
    if (unit.length > 0) payload.unit = unit;
    if (form.harvestedOn) payload.harvestedOn = form.harvestedOn;
    const notes = form.notes.trim();
    if (notes.length > 0) payload.notes = notes;

    onSubmit(form.cropLibraryId, payload);
  };

  return (
    <div className="card card-body space-y-3 max-w-2xl">
      {crops.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Add a crop to your Good Roots crop library before logging a harvest.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className="block sm:col-span-1">
              <span className="field-label">Crop</span>
              <select
                className="input"
                value={form.cropLibraryId}
                onChange={(e) => update('cropLibraryId', e.target.value)}
                disabled={busy}
              >
                <option value="">Select a crop…</option>
                {crops.map((c) => (
                  <option key={c.id} value={c.id}>
                    {cropLabel(c)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="field-label">Amount</span>
              <input
                type="number"
                min="0"
                step="0.01"
                className="input"
                value={form.amount}
                onChange={(e) => update('amount', e.target.value)}
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

          <label className="block">
            <span className="field-label">Notes</span>
            <input
              type="text"
              className="input"
              value={form.notes}
              onChange={(e) => update('notes', e.target.value)}
              placeholder="Optional"
              disabled={busy}
            />
          </label>

          <label className="block">
            <span className="field-label">Harvested on</span>
            <input
              type="date"
              className="input"
              value={form.harvestedOn}
              onChange={(e) => update('harvestedOn', e.target.value)}
              disabled={busy}
            />
            <span className="field-hint mt-1 block">Defaults to today if left blank.</span>
          </label>
        </>
      )}

      {validationError && <p className="form-error">{validationError}</p>}
      {serverError && <p className="form-error">{serverError}</p>}

      <div className="flex justify-end gap-2 pt-2">
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button
          type="button"
          className="btn-primary"
          onClick={submit}
          disabled={busy || crops.length === 0}
        >
          {busy ? 'Saving...' : submitLabel}
        </button>
      </div>
    </div>
  );
}
