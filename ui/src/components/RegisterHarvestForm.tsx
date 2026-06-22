import type { ReactElement } from 'react';
import { useState } from 'react';
import type { Bed, CreateHarvestLogRequest, GrowerCrop } from '../api/types';

interface Props {
  busy: boolean;
  serverError: string | null;
  beds?: Bed[];
  crops?: GrowerCrop[];
  submitLabel?: string;
  onSubmit: (payload: CreateHarvestLogRequest) => void;
  onCancel: () => void;
}

interface FormState {
  // Selected Good Roots crop-library id, '' when entering a custom crop.
  cropLibraryId: string;
  crop: string;
  quantity: string;
  unit: string;
  date: string;
  bedId: string;
  cost: string;
  note: string;
}

const EMPTY: FormState = {
  cropLibraryId: '',
  crop: '',
  quantity: '',
  unit: 'lb',
  date: '',
  bedId: '',
  cost: '',
  note: '',
};

// Builds the display name for a crop-library entry (crop · variety).
function cropLabel(c: GrowerCrop): string {
  return c.variety ? `${c.name} · ${c.variety}` : c.name;
}

// Logs a garden harvest. Crop is chosen from the Good Roots crop library (which
// stores cropLibraryId + cropName) with a free-text fallback when GRN is
// unconfigured. quantity is required; unit defaults to lb; date defaults
// server-side to today; bed, cost, and note are optional.
export default function RegisterHarvestForm({
  busy,
  serverError,
  beds,
  crops,
  submitLabel = 'Log harvest',
  onSubmit,
  onCancel,
}: Props): ReactElement {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [validationError, setValidationError] = useState<string | null>(null);

  const hasLibrary = !!crops && crops.length > 0;

  const update = <K extends keyof FormState>(key: K, value: FormState[K]): void => {
    setForm((f) => ({ ...f, [key]: value }));
  };

  // Selecting a library crop fixes the display crop name; '' returns to custom
  // free-text entry.
  const onSelectCrop = (id: string): void => {
    const picked = crops?.find((c) => c.id === id) ?? null;
    setForm((f) => ({
      ...f,
      cropLibraryId: id,
      crop: picked ? cropLabel(picked) : '',
    }));
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
    if (form.cropLibraryId) payload.cropLibraryId = form.cropLibraryId;
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

  // When a library crop is selected, the name is locked to that entry; the
  // "Custom" option re-enables free-text editing.
  const customCrop = form.cropLibraryId === '';

  return (
    <div className="card card-body space-y-3 max-w-2xl">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {hasLibrary ? (
          <label className="block sm:col-span-1">
            <span className="field-label">Crop</span>
            <select
              className="input"
              value={form.cropLibraryId}
              onChange={(e) => onSelectCrop(e.target.value)}
              disabled={busy}
            >
              <option value="">Custom (free text)</option>
              {crops?.map((c) => (
                <option key={c.id} value={c.id}>
                  {cropLabel(c)}
                </option>
              ))}
            </select>
            {customCrop && (
              <input
                type="text"
                className="input mt-2"
                value={form.crop}
                onChange={(e) => update('crop', e.target.value)}
                placeholder="e.g. tomatoes"
                disabled={busy}
              />
            )}
          </label>
        ) : (
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
        )}
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
