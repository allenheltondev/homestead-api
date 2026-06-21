import type { ReactElement } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApiFetch, ApiError } from '../auth/useApiFetch';
import { createPasture, listPastures } from '../api/pastures';
import { getPastureOccupancy } from '../api/stats';
import type { CreatePastureRequest, Pasture } from '../api/types';
import Modal from '../components/Modal';

export default function Pastures(): ReactElement {
  const apiFetch = useApiFetch();
  const [pastures, setPastures] = useState<Pasture[] | null>(null);
  const [occupancy, setOccupancy] = useState<Map<string, number>>(new Map());
  const [error, setError] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [acreage, setAcreage] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const reload = useCallback((): (() => void) => {
    let cancelled = false;
    setError(null);
    listPastures(apiFetch, { limit: 500 })
      .then((res) => {
        if (!cancelled) setPastures(res.pastures);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });

    getPastureOccupancy(apiFetch)
      .then((res) => {
        if (!cancelled) {
          setOccupancy(new Map(res.pastures.map((p) => [p.pastureId, p.count])));
        }
      })
      .catch(() => {
        // Best effort — counts default to 0.
      });

    return () => {
      cancelled = true;
    };
  }, [apiFetch]);

  useEffect(() => reload(), [reload]);

  const handleCreate = async (): Promise<void> => {
    setCreateError(null);
    if (name.trim().length === 0) {
      setCreateError('Name is required.');
      return;
    }
    const acreageNum = acreage.trim() === '' ? undefined : Number(acreage);
    if (acreageNum !== undefined && (!Number.isFinite(acreageNum) || acreageNum < 0)) {
      setCreateError('Acreage must be a non-negative number.');
      return;
    }
    const payload: CreatePastureRequest = { name: name.trim() };
    if (acreageNum !== undefined) payload.acreage = acreageNum;
    if (notes.trim()) payload.notes = notes.trim();

    setBusy(true);
    try {
      await createPasture(apiFetch, payload);
      setCreateOpen(false);
      setName('');
      setAcreage('');
      setNotes('');
      reload();
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-4">
      <header className="flex items-start justify-between gap-4">
        <h1 className="text-2xl font-semibold text-foreground">Pastures</h1>
        <button
          type="button"
          className="btn-primary"
          onClick={() => {
            setCreateError(null);
            setCreateOpen(true);
          }}
        >
          Add pasture
        </button>
      </header>

      {error && <p className="form-error">{error}</p>}
      {pastures === null && !error && <p className="text-muted-foreground">Loading...</p>}
      {pastures && pastures.length === 0 && (
        <div className="card card-body text-center py-12 space-y-4">
          <p className="text-muted-foreground">No pastures yet.</p>
          <button type="button" className="btn-primary inline-block" onClick={() => setCreateOpen(true)}>
            Add your first pasture
          </button>
        </div>
      )}
      {pastures && pastures.length > 0 && (
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Acreage</th>
                <th>Occupancy</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {pastures.map((p) => (
                <tr key={p.id}>
                  <td>
                    <Link to={`/pastures/${p.id}`} className="text-primary-600 hover:underline">
                      {p.name}
                    </Link>
                  </td>
                  <td className="text-muted-foreground">{p.acreage ?? '-'}</td>
                  <td>{occupancy.get(p.id) ?? 0}</td>
                  <td className="text-muted-foreground truncate max-w-xs">{p.notes ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={createOpen}
        title="Add pasture"
        onClose={() => (!busy ? setCreateOpen(false) : undefined)}
      >
        <div className="space-y-3">
          <label className="block">
            <span className="field-label">Name</span>
            <input
              type="text"
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={busy}
              autoFocus
            />
          </label>
          <label className="block">
            <span className="field-label">Acreage</span>
            <input
              type="number"
              min="0"
              step="any"
              className="input"
              value={acreage}
              onChange={(e) => setAcreage(e.target.value)}
              disabled={busy}
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
          {createError && <p className="form-error">{createError}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setCreateOpen(false)}
              disabled={busy}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={() => void handleCreate()}
              disabled={busy}
            >
              {busy ? 'Saving...' : 'Add pasture'}
            </button>
          </div>
        </div>
      </Modal>
    </section>
  );
}
