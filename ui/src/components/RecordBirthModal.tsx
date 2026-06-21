import type { ReactElement } from 'react';
import { useState } from 'react';
import type { RecordBirthRequest } from '../api/types';
import Modal from './Modal';
import AnimalSelect from './AnimalSelect';
import PastureSelect from './PastureSelect';

interface Props {
  open: boolean;
  busy: boolean;
  serverError: string | null;
  // Pre-fill the species (e.g. from the dam) when known.
  defaultSpecies?: string;
  onConfirm: (payload: RecordBirthRequest) => void;
  onClose: () => void;
}

// Records a birth: creates a new active animal and its BIRTH lifecycle event
// in one call, with optional dam/sire parentage links.
export default function RecordBirthModal({
  open,
  busy,
  serverError,
  defaultSpecies = '',
  onConfirm,
  onClose,
}: Props): ReactElement {
  const [species, setSpecies] = useState(defaultSpecies);
  const [name, setName] = useState('');
  const [tag, setTag] = useState('');
  const [sex, setSex] = useState<'' | 'female' | 'male' | 'unknown'>('');
  const [dob, setDob] = useState('');
  const [pasture, setPasture] = useState('');
  const [damId, setDamId] = useState('');
  const [sireId, setSireId] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);

  const submit = (): void => {
    setValidationError(null);
    const trimmedSpecies = species.trim();
    if (trimmedSpecies.length === 0) {
      setValidationError('Species is required.');
      return;
    }
    if (dob && !/^\d{4}-\d{2}-\d{2}$/.test(dob)) {
      setValidationError('Date of birth must be YYYY-MM-DD.');
      return;
    }

    const payload: RecordBirthRequest = { species: trimmedSpecies };
    if (name.trim()) payload.name = name.trim();
    if (tag.trim()) payload.tag = tag.trim();
    if (sex) payload.sex = sex;
    if (dob) payload.dob = dob;
    if (pasture) payload.pasture = pasture;
    if (damId) payload.damId = damId;
    if (sireId) payload.sireId = sireId;

    onConfirm(payload);
  };

  return (
    <Modal open={open} title="Record birth" onClose={() => (!busy ? onClose() : undefined)}>
      <div className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block">
            <span className="field-label">Species</span>
            <input
              type="text"
              className="input"
              value={species}
              onChange={(e) => setSpecies(e.target.value)}
              disabled={busy}
              autoFocus
            />
          </label>
          <label className="block">
            <span className="field-label">Date of birth</span>
            <input
              type="date"
              className="input"
              value={dob}
              onChange={(e) => setDob(e.target.value)}
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
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={busy}
            />
          </label>
          <label className="block">
            <span className="field-label">Tag</span>
            <input
              type="text"
              className="input"
              value={tag}
              onChange={(e) => setTag(e.target.value)}
              disabled={busy}
            />
          </label>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block">
            <span className="field-label">Sex</span>
            <select
              className="input"
              value={sex}
              onChange={(e) => setSex(e.target.value as typeof sex)}
              disabled={busy}
            >
              <option value="">Unspecified</option>
              <option value="female">Female</option>
              <option value="male">Male</option>
              <option value="unknown">Unknown</option>
            </select>
          </label>
          <label className="block">
            <span className="field-label">Pasture</span>
            <PastureSelect
              value={pasture}
              onChange={setPasture}
              disabled={busy}
              includeAny
              anyLabel="No pasture"
            />
          </label>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block">
            <span className="field-label">Dam (mother)</span>
            <AnimalSelect
              value={damId}
              onChange={setDamId}
              sex="female"
              disabled={busy}
              ariaLabel="Dam"
            />
          </label>
          <label className="block">
            <span className="field-label">Sire (father)</span>
            <AnimalSelect
              value={sireId}
              onChange={setSireId}
              sex="male"
              disabled={busy}
              ariaLabel="Sire"
            />
          </label>
        </div>

        {validationError && <p className="form-error">{validationError}</p>}
        {serverError && <p className="form-error">{serverError}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn-primary" onClick={submit} disabled={busy}>
            {busy ? 'Recording...' : 'Record birth'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
