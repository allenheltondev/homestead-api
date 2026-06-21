import type { ReactElement } from 'react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useApiFetch, ApiError } from '../auth/useApiFetch';
import { deletePasture, getPasture, listPastureAnimals } from '../api/pastures';
import { listAnimals } from '../api/animals';
import type { Animal, Pasture, PastureAnimal } from '../api/types';
import Modal from '../components/Modal';
import { formatShortDate } from '../components/format';

export default function PastureDetail(): ReactElement {
  const { pastureId } = useParams<{ pastureId: string }>();
  const apiFetch = useApiFetch();
  const navigate = useNavigate();

  const [pasture, setPasture] = useState<Pasture | null>(null);
  const [occupants, setOccupants] = useState<PastureAnimal[] | null>(null);
  const [animalMap, setAnimalMap] = useState<Map<string, Animal>>(new Map());
  const [loadError, setLoadError] = useState<string | null>(null);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    if (!pastureId) return;
    let cancelled = false;
    setLoadError(null);

    getPasture(apiFetch, pastureId)
      .then((res) => {
        if (!cancelled) setPasture(res);
      })
      .catch((err: Error) => {
        if (!cancelled) setLoadError(err.message);
      });

    listPastureAnimals(apiFetch, pastureId)
      .then((res) => {
        if (!cancelled) setOccupants(res.animals);
      })
      .catch(() => {
        if (!cancelled) setOccupants([]);
      });

    // Enrich the occupant pointers with names by pulling the animals filtered
    // to this pasture.
    listAnimals(apiFetch, { pasture: pastureId })
      .then((res) => {
        if (!cancelled) setAnimalMap(new Map(res.animals.map((a) => [a.id, a])));
      })
      .catch(() => {
        // Best effort — table falls back to ids.
      });

    return () => {
      cancelled = true;
    };
  }, [apiFetch, pastureId]);

  const handleDelete = async (): Promise<void> => {
    if (!pastureId) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await deletePasture(apiFetch, pastureId);
      navigate('/pastures');
    } catch (err) {
      setDeleteError(err instanceof ApiError ? err.message : (err as Error).message);
    } finally {
      setDeleteBusy(false);
    }
  };

  if (loadError) {
    return (
      <section className="space-y-2">
        <h1 className="text-2xl font-semibold">Pasture not found</h1>
        <p className="form-error">{loadError}</p>
        <Link to="/pastures" className="btn-link">
          Back to pastures
        </Link>
      </section>
    );
  }

  if (!pasture) {
    return (
      <section>
        <h1 className="text-2xl font-semibold">Pasture</h1>
        <p className="text-muted-foreground">Loading...</p>
      </section>
    );
  }

  const animalLabel = (id: string): string => {
    const a = animalMap.get(id);
    if (!a) return id.slice(0, 8);
    return a.name ?? a.tag ?? id.slice(0, 8);
  };

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold text-foreground">{pasture.name}</h1>
          {pasture.acreage !== null && (
            <p className="text-muted-foreground">{pasture.acreage} acres</p>
          )}
        </div>
        <button
          type="button"
          className="btn-destructive"
          onClick={() => {
            setDeleteError(null);
            setDeleteOpen(true);
          }}
        >
          Delete
        </button>
      </header>

      {pasture.notes && (
        <section className="card card-body">
          <h2 className="text-sm font-semibold text-foreground mb-1">Notes</h2>
          <p className="text-sm text-foreground whitespace-pre-wrap">{pasture.notes}</p>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-foreground">
          Occupancy
          {occupants && (
            <span className="text-muted-foreground font-normal text-base"> · {occupants.length}</span>
          )}
        </h2>
        {occupants === null ? (
          <p className="text-muted-foreground">Loading occupants...</p>
        ) : occupants.length === 0 ? (
          <p className="text-muted-foreground text-sm">No animals currently in this pasture.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Animal</th>
                  <th>Species</th>
                  <th>Moved in</th>
                </tr>
              </thead>
              <tbody>
                {occupants.map((o) => (
                  <tr key={o.animalId}>
                    <td>
                      <Link
                        to={`/animals/${o.animalId}`}
                        className="text-primary-600 hover:underline"
                      >
                        {animalLabel(o.animalId)}
                      </Link>
                    </td>
                    <td className="text-muted-foreground">
                      {animalMap.get(o.animalId)?.species ?? '-'}
                    </td>
                    <td className="text-muted-foreground">{formatShortDate(o.movedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Modal
        open={deleteOpen}
        title="Delete pasture"
        onClose={() => (!deleteBusy ? setDeleteOpen(false) : undefined)}
      >
        <div className="space-y-3">
          <p className="text-sm text-foreground">
            Permanently delete <strong>{pasture.name}</strong>? This can&apos;t be undone.
          </p>
          {deleteError && <p className="form-error">{deleteError}</p>}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setDeleteOpen(false)}
              disabled={deleteBusy}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn-destructive"
              onClick={() => void handleDelete()}
              disabled={deleteBusy}
            >
              {deleteBusy ? 'Deleting...' : 'Delete pasture'}
            </button>
          </div>
        </div>
      </Modal>
    </section>
  );
}
