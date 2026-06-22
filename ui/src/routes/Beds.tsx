import type { ReactElement } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApiFetch, ApiError } from '../auth/useApiFetch';
import {
  createBed,
  createGrowerCrop,
  deleteBed,
  deleteGrowerCrop,
  isGrnNotConnected,
  listBeds,
  listCatalogCrops,
  listCatalogVarieties,
  listGrowerCrops,
  updateGrowerCrop,
} from '../api/grn';
import type {
  Bed,
  CatalogCrop,
  CatalogVariety,
  CreateBedRequest,
  CreateGrowerCropRequest,
  GrowerCrop,
} from '../api/types';
import Modal from '../components/Modal';

export default function Beds(): ReactElement {
  const apiFetch = useApiFetch();
  const [crops, setCrops] = useState<GrowerCrop[] | null>(null);
  const [beds, setBeds] = useState<Bed[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // A "not connected" signal from any GRN call flips the whole page to the
  // connect prompt — the crop library and beds live in Good Roots now.
  const [notConnected, setNotConnected] = useState(false);

  const [cropModalOpen, setCropModalOpen] = useState(false);
  const [editingCrop, setEditingCrop] = useState<GrowerCrop | null>(null);
  const [cropBusy, setCropBusy] = useState(false);
  const [cropError, setCropError] = useState<string | null>(null);
  const [deletingCropId, setDeletingCropId] = useState<string | null>(null);

  const [bedOpen, setBedOpen] = useState(false);
  const [bedBusy, setBedBusy] = useState(false);
  const [bedError, setBedError] = useState<string | null>(null);
  const [deletingBedId, setDeletingBedId] = useState<string | null>(null);

  const reload = useCallback((): (() => void) => {
    let cancelled = false;
    setError(null);
    setCrops(null);
    setBeds(null);

    listGrowerCrops(apiFetch)
      .then((res) => {
        if (!cancelled) setCrops(res.crops);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (isGrnNotConnected(err)) setNotConnected(true);
        else setError(err instanceof Error ? err.message : 'Failed to load crops.');
      });

    listBeds(apiFetch)
      .then((res) => {
        if (!cancelled) setBeds(res.beds);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (isGrnNotConnected(err)) setNotConnected(true);
        else setError(err instanceof Error ? err.message : 'Failed to load beds.');
      });

    return () => {
      cancelled = true;
    };
  }, [apiFetch]);

  useEffect(() => reload(), [reload]);

  const handleSaveCrop = async (
    payload: CreateGrowerCropRequest,
  ): Promise<void> => {
    setCropBusy(true);
    setCropError(null);
    try {
      if (editingCrop) {
        await updateGrowerCrop(apiFetch, editingCrop.id, payload);
      } else {
        await createGrowerCrop(apiFetch, payload);
      }
      setCropModalOpen(false);
      setEditingCrop(null);
      reload();
    } catch (err) {
      if (isGrnNotConnected(err)) {
        setNotConnected(true);
        setCropModalOpen(false);
      } else {
        setCropError(err instanceof ApiError ? err.message : (err as Error).message);
      }
    } finally {
      setCropBusy(false);
    }
  };

  const handleDeleteCrop = async (id: string): Promise<void> => {
    setDeletingCropId(id);
    try {
      await deleteGrowerCrop(apiFetch, id);
      reload();
    } catch (err) {
      if (isGrnNotConnected(err)) setNotConnected(true);
      else setError(err instanceof ApiError ? err.message : (err as Error).message);
    } finally {
      setDeletingCropId(null);
    }
  };

  const handleCreateBed = async (payload: CreateBedRequest): Promise<void> => {
    setBedBusy(true);
    setBedError(null);
    try {
      await createBed(apiFetch, payload);
      setBedOpen(false);
      reload();
    } catch (err) {
      if (isGrnNotConnected(err)) {
        setNotConnected(true);
        setBedOpen(false);
      } else {
        setBedError(err instanceof ApiError ? err.message : (err as Error).message);
      }
    } finally {
      setBedBusy(false);
    }
  };

  const handleDeleteBed = async (id: string): Promise<void> => {
    setDeletingBedId(id);
    try {
      await deleteBed(apiFetch, id);
      reload();
    } catch (err) {
      if (isGrnNotConnected(err)) setNotConnected(true);
      else setError(err instanceof ApiError ? err.message : (err as Error).message);
    } finally {
      setDeletingBedId(null);
    }
  };

  if (notConnected) {
    return <ConnectGoodRoots />;
  }

  return (
    <section className="space-y-8">
      <header className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold text-foreground">Garden beds &amp; crops</h1>
          <p className="text-muted-foreground">
            Manage your Good Roots crop library and garden beds.
          </p>
        </div>
        <Link to="/garden" className="btn-secondary w-auto">
          Back to garden
        </Link>
      </header>

      {error && <p className="form-error">{error}</p>}

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-lg font-semibold text-foreground">Crop library</h2>
          <button
            type="button"
            className="btn-primary w-auto"
            onClick={() => {
              setEditingCrop(null);
              setCropError(null);
              setCropModalOpen(true);
            }}
          >
            Add crop
          </button>
        </div>
        {crops === null && !error && <p className="text-muted-foreground">Loading...</p>}
        {crops && crops.length === 0 && (
          <p className="text-muted-foreground text-sm">
            No crops yet. Add one to build your Good Roots crop library.
          </p>
        )}
        {crops && crops.length > 0 && (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Crop</th>
                  <th>Variety</th>
                  <th>Category</th>
                  <th>Notes</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {crops.map((c) => (
                  <tr key={c.id}>
                    <td className="font-medium text-foreground">{c.name}</td>
                    <td className="text-muted-foreground">{c.variety ?? '—'}</td>
                    <td className="text-muted-foreground">{c.category ?? '—'}</td>
                    <td className="text-muted-foreground">{c.notes ?? '—'}</td>
                    <td className="text-right whitespace-nowrap">
                      <button
                        type="button"
                        className="btn-link"
                        onClick={() => {
                          setEditingCrop(c);
                          setCropError(null);
                          setCropModalOpen(true);
                        }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn-link text-error-600 hover:text-error-700 ml-3"
                        onClick={() => void handleDeleteCrop(c.id)}
                        disabled={deletingCropId === c.id}
                      >
                        {deletingCropId === c.id ? 'Removing...' : 'Delete'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-lg font-semibold text-foreground">Beds</h2>
          <button
            type="button"
            className="btn-primary w-auto"
            onClick={() => {
              setBedError(null);
              setBedOpen(true);
            }}
          >
            Add bed
          </button>
        </div>
        {beds === null && !error && <p className="text-muted-foreground">Loading...</p>}
        {beds && beds.length === 0 && (
          <p className="text-muted-foreground text-sm">
            No beds yet. Add one to organize where your crops grow.
          </p>
        )}
        {beds && beds.length > 0 && (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Area (sq ft)</th>
                  <th>Location</th>
                  <th>Notes</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {beds.map((b) => (
                  <tr key={b.id}>
                    <td className="font-medium text-foreground">{b.name}</td>
                    <td className="text-muted-foreground">{b.area ?? '—'}</td>
                    <td className="text-muted-foreground">{b.location ?? '—'}</td>
                    <td className="text-muted-foreground">{b.notes ?? '—'}</td>
                    <td className="text-right">
                      <button
                        type="button"
                        className="btn-link text-error-600 hover:text-error-700"
                        onClick={() => void handleDeleteBed(b.id)}
                        disabled={deletingBedId === b.id}
                      >
                        {deletingBedId === b.id ? 'Removing...' : 'Delete'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Modal
        open={cropModalOpen}
        title={editingCrop ? 'Edit crop' : 'Add crop'}
        onClose={() => {
          if (cropBusy) return;
          setCropModalOpen(false);
          setEditingCrop(null);
        }}
      >
        <CropForm
          crop={editingCrop}
          busy={cropBusy}
          serverError={cropError}
          onSubmit={(p) => void handleSaveCrop(p)}
          onCancel={() => {
            setCropModalOpen(false);
            setEditingCrop(null);
          }}
        />
      </Modal>

      <Modal
        open={bedOpen}
        title="Add bed"
        onClose={() => (!bedBusy ? setBedOpen(false) : undefined)}
      >
        <BedForm
          busy={bedBusy}
          serverError={bedError}
          onSubmit={(p) => void handleCreateBed(p)}
          onCancel={() => setBedOpen(false)}
        />
      </Modal>
    </section>
  );
}

function ConnectGoodRoots(): ReactElement {
  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold text-foreground">Garden beds &amp; crops</h1>
        <p className="text-muted-foreground">
          Manage your Good Roots crop library and garden beds.
        </p>
      </header>
      <div className="card card-body text-center py-16 space-y-4">
        <div className="text-4xl" aria-hidden>
          🌱
        </div>
        <h2 className="text-lg font-semibold text-foreground">Connect Good Roots</h2>
        <p className="text-muted-foreground max-w-md mx-auto">
          Good Roots isn&apos;t connected to this homestead yet. Once connected, you can build
          your crop library, organize garden beds, and tie harvests to the crops you grow.
        </p>
        <p className="text-sm text-muted-foreground">
          Ask your administrator to enable the Good Roots Network integration to get started.
        </p>
      </div>
    </section>
  );
}

interface CropFormProps {
  crop: GrowerCrop | null;
  busy: boolean;
  serverError: string | null;
  onSubmit: (payload: CreateGrowerCropRequest) => void;
  onCancel: () => void;
}

function CropForm({
  crop,
  busy,
  serverError,
  onSubmit,
  onCancel,
}: CropFormProps): ReactElement {
  const apiFetch = useApiFetch();

  const [name, setName] = useState(crop?.name ?? '');
  const [variety, setVariety] = useState(crop?.variety ?? '');
  const [category, setCategory] = useState(crop?.category ?? '');
  const [notes, setNotes] = useState(crop?.notes ?? '');
  const [catalogCropId, setCatalogCropId] = useState(crop?.catalogCropId ?? '');
  const [catalogVarietyId, setCatalogVarietyId] = useState(
    crop?.catalogVarietyId ?? '',
  );
  const [validationError, setValidationError] = useState<string | null>(null);

  // Catalog picker reference data. Loaded best-effort; the form still works as
  // free text when the catalog is unavailable.
  const [catalogCrops, setCatalogCrops] = useState<CatalogCrop[]>([]);
  const [varieties, setVarieties] = useState<CatalogVariety[]>([]);

  useEffect(() => {
    let cancelled = false;
    listCatalogCrops(apiFetch)
      .then((res) => {
        if (!cancelled) setCatalogCrops(res.crops);
      })
      .catch(() => {
        if (!cancelled) setCatalogCrops([]);
      });
    return () => {
      cancelled = true;
    };
  }, [apiFetch]);

  useEffect(() => {
    if (!catalogCropId) {
      setVarieties([]);
      return;
    }
    let cancelled = false;
    listCatalogVarieties(apiFetch, catalogCropId)
      .then((res) => {
        if (!cancelled) setVarieties(res.varieties);
      })
      .catch(() => {
        if (!cancelled) setVarieties([]);
      });
    return () => {
      cancelled = true;
    };
  }, [apiFetch, catalogCropId]);

  // Choosing a catalog crop prefills the name (and category when known) so the
  // grower crop stays aligned with the shared catalog.
  const onPickCatalogCrop = (id: string): void => {
    setCatalogCropId(id);
    setCatalogVarietyId('');
    const picked = catalogCrops.find((c) => c.id === id);
    if (picked) {
      setName(picked.name);
      if (picked.category) setCategory(picked.category);
    }
  };

  const onPickVariety = (id: string): void => {
    setCatalogVarietyId(id);
    const picked = varieties.find((v) => v.id === id);
    if (picked) setVariety(picked.name);
  };

  const submit = (): void => {
    setValidationError(null);
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      setValidationError('Crop name is required.');
      return;
    }
    const payload: CreateGrowerCropRequest = { name: trimmed };
    const v = variety.trim();
    if (v.length > 0) payload.variety = v;
    const cat = category.trim();
    if (cat.length > 0) payload.category = cat;
    const note = notes.trim();
    if (note.length > 0) payload.notes = note;
    if (catalogCropId) payload.catalogCropId = catalogCropId;
    if (catalogVarietyId) payload.catalogVarietyId = catalogVarietyId;
    onSubmit(payload);
  };

  return (
    <div className="card card-body space-y-3 max-w-2xl">
      {catalogCrops.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block">
            <span className="field-label">Catalog crop</span>
            <select
              className="input"
              value={catalogCropId}
              onChange={(e) => onPickCatalogCrop(e.target.value)}
              disabled={busy}
            >
              <option value="">Custom (free text)</option>
              {catalogCrops.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <span className="field-hint mt-1 block">
              Pick from the shared catalog or enter your own below.
            </span>
          </label>
          <label className="block">
            <span className="field-label">Catalog variety</span>
            <select
              className="input"
              value={catalogVarietyId}
              onChange={(e) => onPickVariety(e.target.value)}
              disabled={busy || !catalogCropId || varieties.length === 0}
            >
              <option value="">
                {catalogCropId ? 'Any / custom' : 'Select a crop first'}
              </option>
              {varieties.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="field-label">Crop name</span>
          <input
            type="text"
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Tomato"
            disabled={busy}
            autoFocus
          />
        </label>
        <label className="block">
          <span className="field-label">Variety</span>
          <input
            type="text"
            className="input"
            value={variety}
            onChange={(e) => setVariety(e.target.value)}
            placeholder="Optional"
            disabled={busy}
          />
        </label>
      </div>

      <label className="block">
        <span className="field-label">Category</span>
        <input
          type="text"
          className="input"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          placeholder="Optional — e.g. vegetable, herb"
          disabled={busy}
        />
      </label>

      <label className="block">
        <span className="field-label">Notes</span>
        <input
          type="text"
          className="input"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Optional"
          disabled={busy}
        />
      </label>

      {validationError && <p className="form-error">{validationError}</p>}
      {serverError && <p className="form-error">{serverError}</p>}

      <div className="flex justify-end gap-2 pt-2">
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="button" className="btn-primary" onClick={submit} disabled={busy}>
          {busy ? 'Saving...' : crop ? 'Save crop' : 'Add crop'}
        </button>
      </div>
    </div>
  );
}

interface BedFormProps {
  busy: boolean;
  serverError: string | null;
  onSubmit: (payload: CreateBedRequest) => void;
  onCancel: () => void;
}

function BedForm({ busy, serverError, onSubmit, onCancel }: BedFormProps): ReactElement {
  const [name, setName] = useState('');
  const [area, setArea] = useState('');
  const [location, setLocation] = useState('');
  const [notes, setNotes] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);

  const submit = (): void => {
    setValidationError(null);
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      setValidationError('Name is required.');
      return;
    }
    const payload: CreateBedRequest = { name: trimmed };
    if (area.trim().length > 0) {
      const value = Number(area);
      if (!Number.isFinite(value) || value < 0) {
        setValidationError('Area must be a non-negative number.');
        return;
      }
      payload.area = value;
    }
    const loc = location.trim();
    if (loc.length > 0) payload.location = loc;
    const note = notes.trim();
    if (note.length > 0) payload.notes = note;
    onSubmit(payload);
  };

  return (
    <div className="card card-body space-y-3 max-w-2xl">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="field-label">Name</span>
          <input
            type="text"
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. North raised bed"
            disabled={busy}
            autoFocus
          />
        </label>
        <label className="block">
          <span className="field-label">Area (sq ft)</span>
          <input
            type="number"
            min="0"
            step="1"
            className="input"
            value={area}
            onChange={(e) => setArea(e.target.value)}
            placeholder="Optional"
            disabled={busy}
          />
        </label>
      </div>
      <label className="block">
        <span className="field-label">Location</span>
        <input
          type="text"
          className="input"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="Optional"
          disabled={busy}
        />
      </label>
      <label className="block">
        <span className="field-label">Notes</span>
        <input
          type="text"
          className="input"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Optional"
          disabled={busy}
        />
      </label>

      {validationError && <p className="form-error">{validationError}</p>}
      {serverError && <p className="form-error">{serverError}</p>}

      <div className="flex justify-end gap-2 pt-2">
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="button" className="btn-primary" onClick={submit} disabled={busy}>
          {busy ? 'Saving...' : 'Add bed'}
        </button>
      </div>
    </div>
  );
}
