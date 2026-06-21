import type { ReactElement } from 'react';
import { useState } from 'react';
import type { CreateHealthExpenseRequest } from '../api/types';
import AnimalSelect from './AnimalSelect';

interface Props {
  busy: boolean;
  serverError: string | null;
  submitLabel?: string;
  onSubmit: (payload: CreateHealthExpenseRequest) => void;
  onCancel: () => void;
}

interface FormState {
  category: string;
  cost: string;
  animalRef: string;
  note: string;
  date: string;
}

const EMPTY: FormState = {
  category: '',
  cost: '',
  animalRef: '',
  note: '',
  date: '',
};

// Logs a health/vet expense. category and cost are required; animalRef, note,
// and date are optional — date defaults server-side to today when blank.
export default function RegisterHealthExpenseForm({
  busy,
  serverError,
  submitLabel = 'Log expense',
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
    const category = form.category.trim();
    const cost = Number(form.cost);

    if (category.length === 0) {
      setValidationError('Category is required.');
      return;
    }
    if (!Number.isFinite(cost) || cost < 0) {
      setValidationError('Cost must be a non-negative number.');
      return;
    }

    const payload: CreateHealthExpenseRequest = { category, cost };
    if (form.animalRef) payload.animalRef = form.animalRef;
    const note = form.note.trim();
    if (note.length > 0) payload.note = note;
    if (form.date) payload.date = form.date;

    onSubmit(payload);
  };

  return (
    <div className="card card-body space-y-3 max-w-2xl">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="field-label">Category</span>
          <input
            type="text"
            className="input"
            value={form.category}
            onChange={(e) => update('category', e.target.value)}
            placeholder="vet, medication, vaccine, ..."
            disabled={busy}
            autoFocus
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
        </label>
      </div>

      <label className="block">
        <span className="field-label">Animal</span>
        <AnimalSelect
          value={form.animalRef}
          onChange={(id) => update('animalRef', id)}
          disabled={busy}
          placeholder="Whole herd / unattributed"
          ariaLabel="Animal"
        />
        <span className="field-hint mt-1 block">Optional — attribute to a single animal.</span>
      </label>

      <label className="block">
        <span className="field-label">Note</span>
        <textarea
          rows={2}
          className="input"
          value={form.note}
          onChange={(e) => update('note', e.target.value)}
          placeholder="Optional"
          disabled={busy}
        />
      </label>

      <label className="block">
        <span className="field-label">Date</span>
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
