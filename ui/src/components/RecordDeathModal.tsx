import type { ReactElement } from 'react';
import { useState } from 'react';
import type { RecordDeathRequest } from '../api/types';
import Modal from './Modal';

interface Props {
  open: boolean;
  animalName: string;
  busy: boolean;
  serverError: string | null;
  onConfirm: (payload: RecordDeathRequest) => void;
  onClose: () => void;
}

// Records a death: a terminal transition to the deceased status plus a DEATH
// lifecycle event. Date and cause are both optional.
export default function RecordDeathModal({
  open,
  animalName,
  busy,
  serverError,
  onConfirm,
  onClose,
}: Props): ReactElement {
  const [date, setDate] = useState('');
  const [cause, setCause] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);

  const submit = (): void => {
    setValidationError(null);
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setValidationError('Date must be YYYY-MM-DD.');
      return;
    }
    const payload: RecordDeathRequest = {};
    if (date) payload.date = date;
    if (cause.trim()) payload.cause = cause.trim();
    onConfirm(payload);
  };

  return (
    <Modal open={open} title="Record death" onClose={() => (!busy ? onClose() : undefined)}>
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Mark <strong className="text-foreground">{animalName}</strong> as deceased. This is a
          terminal transition.
        </p>

        <label className="block">
          <span className="field-label">Date</span>
          <input
            type="date"
            className="input"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            disabled={busy}
          />
        </label>

        <label className="block">
          <span className="field-label">Cause</span>
          <textarea
            rows={3}
            className="input"
            value={cause}
            onChange={(e) => setCause(e.target.value)}
            placeholder="illness, predation, ..."
            disabled={busy}
          />
        </label>

        {validationError && <p className="form-error">{validationError}</p>}
        {serverError && <p className="form-error">{serverError}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn-destructive" onClick={submit} disabled={busy}>
            {busy ? 'Recording...' : 'Record death'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
