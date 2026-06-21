import type { ReactElement } from 'react';
import { useState } from 'react';
import type { MoveAnimalRequest } from '../api/types';
import Modal from './Modal';
import PastureSelect from './PastureSelect';

interface Props {
  open: boolean;
  animalName: string;
  busy: boolean;
  serverError: string | null;
  currentPastureId?: string | null;
  onConfirm: (payload: MoveAnimalRequest) => void;
  onClose: () => void;
}

// Moves an animal into a pasture. Records a move-history event and updates
// the animal->pasture pointer. notes and a backdated timestamp are optional.
export default function MoveAnimalModal({
  open,
  animalName,
  busy,
  serverError,
  currentPastureId,
  onConfirm,
  onClose,
}: Props): ReactElement {
  const [toPastureId, setToPastureId] = useState('');
  const [notes, setNotes] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);

  const submit = (): void => {
    setValidationError(null);
    if (!toPastureId) {
      setValidationError('Pick a destination pasture.');
      return;
    }
    if (currentPastureId && toPastureId === currentPastureId) {
      setValidationError('Animal is already in that pasture.');
      return;
    }
    const payload: MoveAnimalRequest = { toPastureId };
    if (notes.trim()) payload.notes = notes.trim();
    onConfirm(payload);
  };

  return (
    <Modal open={open} title="Move animal" onClose={() => (!busy ? onClose() : undefined)}>
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Move <strong className="text-foreground">{animalName}</strong> to a new pasture.
        </p>

        <label className="block">
          <span className="field-label">Destination pasture</span>
          <PastureSelect
            value={toPastureId}
            onChange={setToPastureId}
            disabled={busy}
            ariaLabel="Destination pasture"
          />
        </label>

        <label className="block">
          <span className="field-label">Notes</span>
          <textarea
            rows={3}
            className="input"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            disabled={busy}
          />
        </label>

        {validationError && <p className="form-error">{validationError}</p>}
        {serverError && <p className="form-error">{serverError}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn-primary" onClick={submit} disabled={busy}>
            {busy ? 'Moving...' : 'Move animal'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
