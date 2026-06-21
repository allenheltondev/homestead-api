import type { ReactElement, ReactNode } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useApiFetch, ApiError } from '../auth/useApiFetch';
import { getAnimal, deleteAnimal } from '../api/animals';
import { listAnimalEvents, recordDeath, recordSale } from '../api/lifecycle';
import { listAnimalMoves, moveAnimal } from '../api/movements';
import { listPastures } from '../api/pastures';
import type {
  Animal,
  AnimalEvent,
  MoveAnimalRequest,
  Move,
  Pasture,
  RecordDeathRequest,
} from '../api/types';
import Modal from '../components/Modal';
import RecordDeathModal from '../components/RecordDeathModal';
import MoveAnimalModal from '../components/MoveAnimalModal';
import { ageLabel, formatMoney, formatShortDate } from '../components/format';

export default function AnimalDetail(): ReactElement {
  const { animalId } = useParams<{ animalId: string }>();
  const apiFetch = useApiFetch();
  const navigate = useNavigate();

  const [animal, setAnimal] = useState<Animal | null>(null);
  const [events, setEvents] = useState<AnimalEvent[] | null>(null);
  const [moves, setMoves] = useState<Move[] | null>(null);
  const [pastureMap, setPastureMap] = useState<Map<string, Pasture>>(new Map());
  const [loadError, setLoadError] = useState<string | null>(null);

  const [deathOpen, setDeathOpen] = useState(false);
  const [deathBusy, setDeathBusy] = useState(false);
  const [deathError, setDeathError] = useState<string | null>(null);

  const [moveOpen, setMoveOpen] = useState(false);
  const [moveBusy, setMoveBusy] = useState(false);
  const [moveError, setMoveError] = useState<string | null>(null);

  const [saleOpen, setSaleOpen] = useState(false);
  const [saleBusy, setSaleBusy] = useState(false);
  const [saleError, setSaleError] = useState<string | null>(null);
  const [saleDate, setSaleDate] = useState('');
  const [saleBuyer, setSaleBuyer] = useState('');
  const [salePrice, setSalePrice] = useState('');

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const reload = useCallback((): (() => void) => {
    if (!animalId) return () => {};
    let cancelled = false;
    setLoadError(null);

    getAnimal(apiFetch, animalId)
      .then((res) => {
        if (!cancelled) setAnimal(res);
      })
      .catch((err: Error) => {
        if (!cancelled) setLoadError(err.message);
      });

    listAnimalEvents(apiFetch, animalId)
      .then((res) => {
        if (!cancelled) setEvents(res.events);
      })
      .catch(() => {
        if (!cancelled) setEvents([]);
      });

    listAnimalMoves(apiFetch, animalId)
      .then((res) => {
        if (!cancelled) setMoves(res.moves);
      })
      .catch(() => {
        if (!cancelled) setMoves([]);
      });

    return () => {
      cancelled = true;
    };
  }, [apiFetch, animalId]);

  useEffect(() => reload(), [reload]);

  useEffect(() => {
    let cancelled = false;
    listPastures(apiFetch, { limit: 500 })
      .then((res) => {
        if (!cancelled) setPastureMap(new Map(res.pastures.map((p) => [p.id, p])));
      })
      .catch(() => {
        // Best effort.
      });
    return () => {
      cancelled = true;
    };
  }, [apiFetch]);

  const pastureName = (id: string | null): string =>
    id ? (pastureMap.get(id)?.name ?? id.slice(0, 8)) : '-';

  const handleDeath = async (payload: RecordDeathRequest): Promise<void> => {
    if (!animalId) return;
    setDeathBusy(true);
    setDeathError(null);
    try {
      await recordDeath(apiFetch, animalId, payload);
      setDeathOpen(false);
      reload();
    } catch (err) {
      setDeathError(err instanceof ApiError ? err.message : (err as Error).message);
    } finally {
      setDeathBusy(false);
    }
  };

  const handleMove = async (payload: MoveAnimalRequest): Promise<void> => {
    if (!animalId) return;
    setMoveBusy(true);
    setMoveError(null);
    try {
      await moveAnimal(apiFetch, animalId, payload);
      setMoveOpen(false);
      reload();
    } catch (err) {
      setMoveError(err instanceof ApiError ? err.message : (err as Error).message);
    } finally {
      setMoveBusy(false);
    }
  };

  const handleSale = async (): Promise<void> => {
    if (!animalId) return;
    if (saleDate && !/^\d{4}-\d{2}-\d{2}$/.test(saleDate)) {
      setSaleError('Date must be YYYY-MM-DD.');
      return;
    }
    const price = salePrice.trim() === '' ? undefined : Number(salePrice);
    if (price !== undefined && (!Number.isFinite(price) || price < 0)) {
      setSaleError('Price must be a non-negative number.');
      return;
    }
    setSaleBusy(true);
    setSaleError(null);
    try {
      await recordSale(apiFetch, animalId, {
        ...(saleDate ? { date: saleDate } : {}),
        ...(saleBuyer.trim() ? { buyer: saleBuyer.trim() } : {}),
        ...(price !== undefined ? { price } : {}),
      });
      setSaleOpen(false);
      reload();
    } catch (err) {
      setSaleError(err instanceof ApiError ? err.message : (err as Error).message);
    } finally {
      setSaleBusy(false);
    }
  };

  const handleDelete = async (): Promise<void> => {
    if (!animalId) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await deleteAnimal(apiFetch, animalId);
      navigate('/animals');
    } catch (err) {
      setDeleteError(err instanceof ApiError ? err.message : (err as Error).message);
    } finally {
      setDeleteBusy(false);
    }
  };

  if (loadError) {
    return (
      <section className="space-y-2">
        <h1 className="text-2xl font-semibold">Animal not found</h1>
        <p className="form-error">{loadError}</p>
        <Link to="/animals" className="btn-link">
          Back to animals
        </Link>
      </section>
    );
  }

  if (!animal) {
    return (
      <section>
        <h1 className="text-2xl font-semibold">Animal</h1>
        <p className="text-muted-foreground">Loading...</p>
      </section>
    );
  }

  const displayName = animal.name ?? animal.tag ?? animal.id.slice(0, 8);
  const isActive = animal.status === 'active';

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold text-foreground">{displayName}</h1>
          <p className="text-muted-foreground">
            {animal.species}
            {animal.breed ? ` · ${animal.breed}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`status-pill status-${animal.status} self-center`}>{animal.status}</span>
          {isActive && (
            <>
              <button type="button" className="btn-secondary" onClick={() => setMoveOpen(true)}>
                Move
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setSaleError(null);
                  setSaleOpen(true);
                }}
              >
                Record sale
              </button>
              <button
                type="button"
                className="btn-destructive"
                onClick={() => {
                  setDeathError(null);
                  setDeathOpen(true);
                }}
              >
                Record death
              </button>
            </>
          )}
          <button
            type="button"
            className="btn-ghost"
            onClick={() => {
              setDeleteError(null);
              setDeleteOpen(true);
            }}
          >
            Delete
          </button>
        </div>
      </header>

      <dl className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-3">
        <Detail label="Tag" value={animal.tag ?? '-'} />
        <Detail label="Sex" value={animal.sex ?? '-'} />
        <Detail label="Date of birth" value={formatShortDate(animal.dob)} />
        <Detail label="Age" value={ageLabel(animal.dob)} />
        <Detail
          label="Pasture"
          value={
            animal.pasture ? (
              <Link to={`/pastures/${animal.pasture}`} className="text-primary-600 hover:underline">
                {pastureName(animal.pasture)}
              </Link>
            ) : (
              '-'
            )
          }
        />
        <Detail label="Registered" value={formatShortDate(animal.createdAt)} />
      </dl>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-foreground">Lineage</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <ParentTile label="Dam (mother)" id={animal.damId} />
          <ParentTile label="Sire (father)" id={animal.sireId} />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-foreground">Lifecycle events</h2>
        {events === null ? (
          <p className="text-muted-foreground">Loading events...</p>
        ) : events.length === 0 ? (
          <p className="text-muted-foreground text-sm">No lifecycle events recorded.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Date</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <tr key={`${e.type}-${e.ts}`}>
                    <td>{e.type}</td>
                    <td className="text-muted-foreground">
                      {formatShortDate(e.date ?? e.dob ?? e.ts)}
                    </td>
                    <td className="text-muted-foreground">{eventDetails(e)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-foreground">Move history</h2>
        {moves === null ? (
          <p className="text-muted-foreground">Loading moves...</p>
        ) : moves.length === 0 ? (
          <p className="text-muted-foreground text-sm">No moves recorded.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>From</th>
                  <th>To</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {moves.map((m) => (
                  <tr key={m.ts}>
                    <td className="text-muted-foreground">{formatShortDate(m.ts)}</td>
                    <td className="text-muted-foreground">{pastureName(m.fromPastureId)}</td>
                    <td>
                      <Link
                        to={`/pastures/${m.toPastureId}`}
                        className="text-primary-600 hover:underline"
                      >
                        {pastureName(m.toPastureId)}
                      </Link>
                    </td>
                    <td className="text-muted-foreground">{m.notes ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <RecordDeathModal
        open={deathOpen}
        animalName={displayName}
        busy={deathBusy}
        serverError={deathError}
        onConfirm={(p) => void handleDeath(p)}
        onClose={() => (!deathBusy ? setDeathOpen(false) : undefined)}
      />

      <MoveAnimalModal
        open={moveOpen}
        animalName={displayName}
        busy={moveBusy}
        serverError={moveError}
        currentPastureId={animal.pasture}
        onConfirm={(p) => void handleMove(p)}
        onClose={() => (!moveBusy ? setMoveOpen(false) : undefined)}
      />

      <Modal
        open={saleOpen}
        title="Record sale"
        onClose={() => (!saleBusy ? setSaleOpen(false) : undefined)}
      >
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Mark <strong className="text-foreground">{displayName}</strong> as sold. This is a
            terminal transition.
          </p>
          <label className="block">
            <span className="field-label">Date</span>
            <input
              type="date"
              className="input"
              value={saleDate}
              onChange={(e) => setSaleDate(e.target.value)}
              disabled={saleBusy}
            />
          </label>
          <label className="block">
            <span className="field-label">Buyer</span>
            <input
              type="text"
              className="input"
              value={saleBuyer}
              onChange={(e) => setSaleBuyer(e.target.value)}
              disabled={saleBusy}
            />
          </label>
          <label className="block">
            <span className="field-label">Price (USD)</span>
            <input
              type="number"
              min="0"
              step="any"
              className="input"
              value={salePrice}
              onChange={(e) => setSalePrice(e.target.value)}
              disabled={saleBusy}
            />
          </label>
          {saleError && <p className="form-error">{saleError}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setSaleOpen(false)}
              disabled={saleBusy}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={() => void handleSale()}
              disabled={saleBusy}
            >
              {saleBusy ? 'Recording...' : 'Record sale'}
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        open={deleteOpen}
        title="Delete animal"
        onClose={() => (!deleteBusy ? setDeleteOpen(false) : undefined)}
      >
        <div className="space-y-3">
          <p className="text-sm text-foreground">
            Permanently delete <strong>{displayName}</strong>? This can&apos;t be undone.
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
              {deleteBusy ? 'Deleting...' : 'Delete animal'}
            </button>
          </div>
        </div>
      </Modal>
    </section>
  );
}

function Detail({ label, value }: { label: string; value: ReactNode }): ReactElement {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="text-sm text-foreground mt-0.5">{value}</dd>
    </div>
  );
}

function ParentTile({ label, id }: { label: string; id: string | null }): ReactElement {
  return (
    <div className="card card-body !py-3">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="text-sm mt-1 block">
        {id ? (
          <Link to={`/animals/${id}`} className="text-primary-600 hover:underline">
            {id.slice(0, 12)}…
          </Link>
        ) : (
          <span className="text-muted-foreground">Unknown</span>
        )}
      </span>
    </div>
  );
}

function eventDetails(e: AnimalEvent): string {
  const parts: string[] = [];
  if (e.cause) parts.push(`cause: ${e.cause}`);
  if (e.buyer) parts.push(`buyer: ${e.buyer}`);
  if (e.price !== null) parts.push(formatMoney(e.price));
  if (e.damId) parts.push(`dam: ${e.damId.slice(0, 8)}…`);
  if (e.sireId) parts.push(`sire: ${e.sireId.slice(0, 8)}…`);
  return parts.length > 0 ? parts.join(' · ') : '-';
}
