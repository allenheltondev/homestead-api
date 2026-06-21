import type { ReactElement } from 'react';
import { useState } from 'react';
import type { AnimalSex, CreateAnimalRequest } from '../api/types';
import PastureSelect from './PastureSelect';

interface Props {
  busy: boolean;
  serverError: string | null;
  submitLabel?: string;
  onSubmit: (payload: CreateAnimalRequest) => void;
  onCancel: () => void;
}

interface FormState {
  species: string;
  breed: string;
  name: string;
  tag: string;
  sex: '' | AnimalSex;
  dob: string;
  pasture: string;
}

const EMPTY: FormState = {
  species: '',
  breed: '',
  name: '',
  tag: '',
  sex: '',
  dob: '',
  pasture: '',
};

// Registers a new animal. species is required; everything else optional. New
// animals are always created active (lifecycle transitions go through the
// death/sale flows).
export default function RegisterAnimalForm({
  busy,
  serverError,
  submitLabel = 'Register animal',
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
    const species = form.species.trim();
    if (species.length === 0) {
      setValidationError('Species is required.');
      return;
    }
    if (form.dob && !/^\d{4}-\d{2}-\d{2}$/.test(form.dob)) {
      setValidationError('Date of birth must be YYYY-MM-DD.');
      return;
    }

    const payload: CreateAnimalRequest = { species };
    if (form.breed.trim()) payload.breed = form.breed.trim();
    if (form.name.trim()) payload.name = form.name.trim();
    if (form.tag.trim()) payload.tag = form.tag.trim();
    if (form.sex) payload.sex = form.sex;
    if (form.dob) payload.dob = form.dob;
    if (form.pasture) payload.pasture = form.pasture;

    onSubmit(payload);
  };

  return (
    <div className="card card-body space-y-3 max-w-2xl">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="field-label">Species</span>
          <input
            type="text"
            className="input"
            value={form.species}
            onChange={(e) => update('species', e.target.value)}
            placeholder="cattle, sheep, goat, ..."
            disabled={busy}
            autoFocus
          />
        </label>
        <label className="block">
          <span className="field-label">Breed</span>
          <input
            type="text"
            className="input"
            value={form.breed}
            onChange={(e) => update('breed', e.target.value)}
            disabled={busy}
          />
        </label>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="field-label">Name</span>
          <input
            type="text"
            className="input"
            value={form.name}
            onChange={(e) => update('name', e.target.value)}
            disabled={busy}
          />
        </label>
        <label className="block">
          <span className="field-label">Tag</span>
          <input
            type="text"
            className="input"
            value={form.tag}
            onChange={(e) => update('tag', e.target.value)}
            placeholder="ear tag / ID"
            disabled={busy}
          />
        </label>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="field-label">Sex</span>
          <select
            className="input"
            value={form.sex}
            onChange={(e) => update('sex', e.target.value as FormState['sex'])}
            disabled={busy}
          >
            <option value="">Unspecified</option>
            <option value="female">Female</option>
            <option value="male">Male</option>
            <option value="unknown">Unknown</option>
          </select>
        </label>
        <label className="block">
          <span className="field-label">Date of birth</span>
          <input
            type="date"
            className="input"
            value={form.dob}
            onChange={(e) => update('dob', e.target.value)}
            disabled={busy}
          />
        </label>
      </div>

      <label className="block">
        <span className="field-label">Pasture</span>
        <PastureSelect
          value={form.pasture}
          onChange={(id) => update('pasture', id)}
          disabled={busy}
          includeAny
          anyLabel="No pasture"
        />
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
