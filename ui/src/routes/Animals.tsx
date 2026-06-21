import type { ReactElement } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApiFetch, ApiError } from '../auth/useApiFetch';
import { listAnimals } from '../api/animals';
import { recordBirth } from '../api/lifecycle';
import { listPastures } from '../api/pastures';
import type { Animal, AnimalStatus, Pasture, RecordBirthRequest } from '../api/types';
import RecordBirthModal from '../components/RecordBirthModal';
import { ageLabel } from '../components/format';

export default function Animals(): ReactElement {
  const apiFetch = useApiFetch();
  const navigate = useNavigate();
  const [animals, setAnimals] = useState<Animal[] | null>(null);
  const [pastureMap, setPastureMap] = useState<Map<string, Pasture>>(new Map());
  const [error, setError] = useState<string | null>(null);

  const [species, setSpecies] = useState('');
  const [status, setStatus] = useState<'' | AnimalStatus>('');
  const [pasture, setPasture] = useState('');

  const [birthOpen, setBirthOpen] = useState(false);
  const [birthBusy, setBirthBusy] = useState(false);
  const [birthError, setBirthError] = useState<string | null>(null);

  // Server-side filters: status + pasture go to the API (they pick the index).
  // Species is applied client-side so the dropdown can be data-driven.
  const reload = useCallback((): (() => void) => {
    let cancelled = false;
    setError(null);
    setAnimals(null);
    listAnimals(apiFetch, {
      status: status || undefined,
      pasture: pasture || undefined,
    })
      .then((res) => {
        if (!cancelled) setAnimals(res.animals);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [apiFetch, status, pasture]);

  useEffect(() => reload(), [reload]);

  const handleBirth = async (payload: RecordBirthRequest): Promise<void> => {
    setBirthBusy(true);
    setBirthError(null);
    try {
      const { animal } = await recordBirth(apiFetch, payload);
      navigate(`/animals/${animal.id}`);
    } catch (err) {
      setBirthError(err instanceof ApiError ? err.message : (err as Error).message);
    } finally {
      setBirthBusy(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    listPastures(apiFetch, { limit: 500 })
      .then((res) => {
        if (!cancelled) setPastureMap(new Map(res.pastures.map((p) => [p.id, p])));
      })
      .catch(() => {
        // Best effort; the table falls back to showing pasture ids.
      });
    return () => {
      cancelled = true;
    };
  }, [apiFetch]);

  const speciesOptions = useMemo(() => {
    if (!animals) return [];
    return [...new Set(animals.map((a) => a.species))].sort();
  }, [animals]);

  const pastureOptions = useMemo(() => [...pastureMap.values()], [pastureMap]);

  const filtered = useMemo(() => {
    if (!animals) return null;
    if (!species) return animals;
    return animals.filter((a) => a.species === species);
  }, [animals, species]);

  const pastureName = (id: string | null): string =>
    id ? (pastureMap.get(id)?.name ?? id.slice(0, 8)) : '-';

  return (
    <section className="space-y-4">
      <header className="flex items-start justify-between gap-4">
        <h1 className="text-2xl font-semibold text-foreground">Animals</h1>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              setBirthError(null);
              setBirthOpen(true);
            }}
          >
            Record birth
          </button>
          <Link to="/animals/new" className="btn-primary">
            Register animal
          </Link>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Species</span>
          <select
            className="input w-auto py-1.5"
            value={species}
            onChange={(e) => setSpecies(e.target.value)}
          >
            <option value="">All</option>
            {speciesOptions.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Status</span>
          <select
            className="input w-auto py-1.5"
            value={status}
            onChange={(e) => setStatus(e.target.value as '' | AnimalStatus)}
          >
            <option value="">All</option>
            <option value="active">Active</option>
            <option value="sold">Sold</option>
            <option value="deceased">Deceased</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Pasture</span>
          <select
            className="input w-auto py-1.5"
            value={pasture}
            onChange={(e) => setPasture(e.target.value)}
          >
            <option value="">All</option>
            {pastureOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && <p className="form-error">{error}</p>}
      {filtered === null && !error && <p className="text-muted-foreground">Loading...</p>}
      {filtered && filtered.length === 0 && animals && animals.length === 0 && (
        <div className="card card-body text-center py-12 space-y-4">
          <p className="text-muted-foreground">No animals yet.</p>
          <Link to="/animals/new" className="btn-primary inline-block">
            Register your first animal
          </Link>
        </div>
      )}
      {filtered && filtered.length === 0 && animals && animals.length > 0 && (
        <p className="text-muted-foreground text-sm">No animals match these filters.</p>
      )}
      {filtered && filtered.length > 0 && (
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name / tag</th>
                <th>Species</th>
                <th>Breed</th>
                <th>Sex</th>
                <th>Age</th>
                <th>Pasture</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((a) => (
                <tr key={a.id}>
                  <td>
                    <Link to={`/animals/${a.id}`} className="text-primary-600 hover:underline">
                      {a.name ?? a.tag ?? a.id.slice(0, 8)}
                    </Link>
                  </td>
                  <td>{a.species}</td>
                  <td className="text-muted-foreground">{a.breed ?? '-'}</td>
                  <td className="text-muted-foreground">{a.sex ?? '-'}</td>
                  <td className="text-muted-foreground">{ageLabel(a.dob)}</td>
                  <td className="text-muted-foreground">{pastureName(a.pasture)}</td>
                  <td>
                    <span className={`status-pill status-${a.status}`}>{a.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <RecordBirthModal
        open={birthOpen}
        busy={birthBusy}
        serverError={birthError}
        onConfirm={(p) => void handleBirth(p)}
        onClose={() => (!birthBusy ? setBirthOpen(false) : undefined)}
      />
    </section>
  );
}
