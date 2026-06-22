import type { ReactElement } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApiFetch, ApiError } from '../auth/useApiFetch';
import {
  createClaim,
  discoverSurplus,
  getCommunityRequests,
  getMyListings,
  isGrnNotConnected,
} from '../api/grn';
import type {
  CreateGrnClaimRequest,
  GrnDiscoverItem,
  GrnListing,
  GrnRequest,
} from '../api/types';
import Modal from '../components/Modal';
import StatusBadge from '../components/StatusBadge';
import { listingTone } from '../components/statusTone';
import { formatShortDate } from '../components/format';

type Tab = 'listings' | 'discover' | 'requests';

const TABS: { id: Tab; label: string }[] = [
  { id: 'listings', label: 'My listings' },
  { id: 'discover', label: 'Discover' },
  { id: 'requests', label: 'Community requests' },
];

export default function GoodRoots(): ReactElement {
  const apiFetch = useApiFetch();
  const [tab, setTab] = useState<Tab>('listings');

  // A "not connected" signal from any GRN call flips the whole page to the
  // connect prompt — the integration is all-or-nothing per homestead.
  const [notConnected, setNotConnected] = useState(false);

  const [listings, setListings] = useState<GrnListing[] | null>(null);
  const [listingsError, setListingsError] = useState<string | null>(null);

  const [requests, setRequests] = useState<GrnRequest[] | null>(null);
  const [requestsError, setRequestsError] = useState<string | null>(null);

  const [discoverItems, setDiscoverItems] = useState<GrnDiscoverItem[] | null>(null);
  const [discoverError, setDiscoverError] = useState<string | null>(null);
  const [discoverBusy, setDiscoverBusy] = useState(false);
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [radius, setRadius] = useState('25');

  const [claimTarget, setClaimTarget] = useState<GrnDiscoverItem | null>(null);
  const [claimBusy, setClaimBusy] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [claimedIds, setClaimedIds] = useState<Set<string>>(new Set());

  const loadListings = useCallback((): (() => void) => {
    let cancelled = false;
    setListingsError(null);
    setListings(null);
    getMyListings(apiFetch)
      .then((res) => {
        if (!cancelled) setListings(res.listings);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (isGrnNotConnected(err)) setNotConnected(true);
        else setListingsError(err instanceof Error ? err.message : 'Failed to load listings.');
      });
    return () => {
      cancelled = true;
    };
  }, [apiFetch]);

  const loadRequests = useCallback((): (() => void) => {
    let cancelled = false;
    setRequestsError(null);
    setRequests(null);
    getCommunityRequests(apiFetch)
      .then((res) => {
        if (!cancelled) setRequests(res.requests);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (isGrnNotConnected(err)) setNotConnected(true);
        else setRequestsError(err instanceof Error ? err.message : 'Failed to load requests.');
      });
    return () => {
      cancelled = true;
    };
  }, [apiFetch]);

  // Listings load on mount so a not-connected homestead shows the connect
  // prompt immediately, regardless of the active tab.
  useEffect(() => loadListings(), [loadListings]);

  useEffect(() => {
    if (notConnected) return;
    if (tab === 'requests' && requests === null && !requestsError) {
      return loadRequests();
    }
  }, [tab, notConnected, requests, requestsError, loadRequests]);

  const runDiscover = (): void => {
    const latNum = Number(lat);
    const lngNum = Number(lng);
    const radiusNum = Number(radius);
    if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) {
      setDiscoverError('Enter a valid latitude and longitude.');
      return;
    }
    setDiscoverError(null);
    setDiscoverBusy(true);
    setDiscoverItems(null);
    discoverSurplus(apiFetch, {
      lat: latNum,
      lng: lngNum,
      radius: Number.isFinite(radiusNum) ? radiusNum : 25,
    })
      .then((res) => setDiscoverItems(res.items))
      .catch((err: unknown) => {
        if (isGrnNotConnected(err)) setNotConnected(true);
        else setDiscoverError(err instanceof Error ? err.message : 'Discover failed.');
      })
      .finally(() => setDiscoverBusy(false));
  };

  const submitClaim = async (payload: CreateGrnClaimRequest): Promise<void> => {
    setClaimBusy(true);
    setClaimError(null);
    try {
      await createClaim(apiFetch, payload);
      setClaimedIds((prev) => new Set(prev).add(payload.listingId));
      setClaimTarget(null);
    } catch (err) {
      if (isGrnNotConnected(err)) {
        setNotConnected(true);
        setClaimTarget(null);
      } else {
        setClaimError(err instanceof ApiError ? err.message : (err as Error).message);
      }
    } finally {
      setClaimBusy(false);
    }
  };

  if (notConnected) {
    return <ConnectGoodRoots />;
  }

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold text-foreground">Good Roots Network</h1>
        <p className="text-muted-foreground">
          Share your surplus and find produce from homesteads near you.
        </p>
      </header>

      <div className="border-b border-border flex gap-1" role="tablist" aria-label="Good Roots sections">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t.id
                ? 'border-primary-600 text-primary-700'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'listings' && (
        <ListingsTab listings={listings} error={listingsError} />
      )}

      {tab === 'discover' && (
        <DiscoverTab
          items={discoverItems}
          error={discoverError}
          busy={discoverBusy}
          lat={lat}
          lng={lng}
          radius={radius}
          claimedIds={claimedIds}
          onLat={setLat}
          onLng={setLng}
          onRadius={setRadius}
          onSearch={runDiscover}
          onClaim={(item) => {
            setClaimError(null);
            setClaimTarget(item);
          }}
        />
      )}

      {tab === 'requests' && (
        <RequestsTab requests={requests} error={requestsError} />
      )}

      <Modal
        open={claimTarget !== null}
        title="Claim produce"
        onClose={() => (!claimBusy ? setClaimTarget(null) : undefined)}
      >
        {claimTarget && (
          <ClaimConfirm
            item={claimTarget}
            busy={claimBusy}
            serverError={claimError}
            onConfirm={(p) => void submitClaim(p)}
            onCancel={() => setClaimTarget(null)}
          />
        )}
      </Modal>
    </section>
  );
}

function ConnectGoodRoots(): ReactElement {
  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold text-foreground">Good Roots Network</h1>
        <p className="text-muted-foreground">
          Share your surplus and find produce from homesteads near you.
        </p>
      </header>
      <div className="card card-body text-center py-16 space-y-4">
        <div className="text-4xl" aria-hidden>
          🌱
        </div>
        <h2 className="text-lg font-semibold text-foreground">Connect Good Roots</h2>
        <p className="text-muted-foreground max-w-md mx-auto">
          Good Roots isn&apos;t connected to this homestead yet. Once connected, you can share
          surplus harvests, browse produce nearby, and claim what your community offers.
        </p>
        <p className="text-sm text-muted-foreground">
          Ask your administrator to enable the Good Roots Network integration to get started.
        </p>
      </div>
    </section>
  );
}

function ListingsTab({
  listings,
  error,
}: {
  listings: GrnListing[] | null;
  error: string | null;
}): ReactElement {
  if (error) return <p className="form-error">{error}</p>;
  if (listings === null) return <p className="text-muted-foreground">Loading...</p>;
  if (listings.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        You haven&apos;t shared any surplus yet. Use{' '}
        <Link to="/garden" className="text-primary-600 hover:underline">
          Share to Good Roots
        </Link>{' '}
        on a harvest to list it.
      </p>
    );
  }
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {listings.map((l) => (
        <div key={l.id} className="card card-body space-y-2">
          <div className="flex items-start justify-between gap-2">
            <span className="font-medium text-foreground">{l.crop}</span>
            <StatusBadge label={l.status} tone={listingTone(l.status)} />
          </div>
          <p className="text-sm text-muted-foreground">
            {l.quantity.toLocaleString()} {l.unit}
          </p>
          {l.note && <p className="text-sm text-muted-foreground">{l.note}</p>}
          <div className="text-xs text-muted-foreground border-t border-border pt-2 space-y-0.5">
            <p>Listed {formatShortDate(l.publishedAt)}</p>
            {l.status === 'claimed' && l.claimedBy && <p>Claimed by {l.claimedBy}</p>}
            {l.expiresAt && <p>Expires {formatShortDate(l.expiresAt)}</p>}
          </div>
        </div>
      ))}
    </div>
  );
}

function DiscoverTab({
  items,
  error,
  busy,
  lat,
  lng,
  radius,
  claimedIds,
  onLat,
  onLng,
  onRadius,
  onSearch,
  onClaim,
}: {
  items: GrnDiscoverItem[] | null;
  error: string | null;
  busy: boolean;
  lat: string;
  lng: string;
  radius: string;
  claimedIds: Set<string>;
  onLat: (v: string) => void;
  onLng: (v: string) => void;
  onRadius: (v: string) => void;
  onSearch: () => void;
  onClaim: (item: GrnDiscoverItem) => void;
}): ReactElement {
  return (
    <div className="space-y-4">
      <div className="card card-body flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">Latitude</span>
          <input
            type="number"
            step="any"
            className="input w-32 py-1.5"
            value={lat}
            onChange={(e) => onLat(e.target.value)}
            placeholder="40.7128"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">Longitude</span>
          <input
            type="number"
            step="any"
            className="input w-32 py-1.5"
            value={lng}
            onChange={(e) => onLng(e.target.value)}
            placeholder="-74.0060"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">Radius (mi)</span>
          <input
            type="number"
            min="1"
            className="input w-28 py-1.5"
            value={radius}
            onChange={(e) => onRadius(e.target.value)}
          />
        </label>
        <button type="button" className="btn-primary w-auto" onClick={onSearch} disabled={busy}>
          {busy ? 'Searching...' : 'Search'}
        </button>
      </div>

      {error && <p className="form-error">{error}</p>}

      {items === null && !error && (
        <p className="text-muted-foreground text-sm">
          Enter a location and search to browse community surplus near you.
        </p>
      )}
      {items && items.length === 0 && (
        <p className="text-muted-foreground text-sm">No surplus found within that radius.</p>
      )}
      {items && items.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {items.map((item) => {
            const claimed = claimedIds.has(item.id);
            return (
              <div key={item.id} className="card card-body space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <span className="font-medium text-foreground">{item.crop}</span>
                  {item.distanceMiles != null && (
                    <span className="text-xs text-muted-foreground shrink-0">
                      {item.distanceMiles.toFixed(1)} mi
                    </span>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">
                  {item.quantity.toLocaleString()} {item.unit}
                </p>
                {item.homestead && (
                  <p className="text-sm text-muted-foreground">from {item.homestead}</p>
                )}
                {item.note && <p className="text-sm text-muted-foreground">{item.note}</p>}
                <div className="flex items-center justify-between border-t border-border pt-2">
                  <span className="text-xs text-muted-foreground">
                    {formatShortDate(item.publishedAt)}
                  </span>
                  <button
                    type="button"
                    className="btn-primary btn-sm w-auto"
                    onClick={() => onClaim(item)}
                    disabled={claimed}
                  >
                    {claimed ? 'Claimed' : 'Claim'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function RequestsTab({
  requests,
  error,
}: {
  requests: GrnRequest[] | null;
  error: string | null;
}): ReactElement {
  if (error) return <p className="form-error">{error}</p>;
  if (requests === null) return <p className="text-muted-foreground">Loading...</p>;
  if (requests.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">No community requests right now.</p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="data-table">
        <thead>
          <tr>
            <th>Crop</th>
            <th>Wanted</th>
            <th>Homestead</th>
            <th>Distance</th>
            <th>Note</th>
            <th>Requested</th>
          </tr>
        </thead>
        <tbody>
          {requests.map((r) => (
            <tr key={r.id}>
              <td className="font-medium text-foreground">{r.crop}</td>
              <td>
                {r.quantity != null
                  ? `${r.quantity.toLocaleString()} ${r.unit ?? ''}`.trim()
                  : '—'}
              </td>
              <td className="text-muted-foreground">{r.homestead ?? '—'}</td>
              <td className="text-muted-foreground">
                {r.distanceMiles != null ? `${r.distanceMiles.toFixed(1)} mi` : '—'}
              </td>
              <td className="text-muted-foreground">{r.note ?? '—'}</td>
              <td className="text-muted-foreground">{formatShortDate(r.requestedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ClaimConfirm({
  item,
  busy,
  serverError,
  onConfirm,
  onCancel,
}: {
  item: GrnDiscoverItem;
  busy: boolean;
  serverError: string | null;
  onConfirm: (payload: CreateGrnClaimRequest) => void;
  onCancel: () => void;
}): ReactElement {
  const [quantity, setQuantity] = useState('');
  const [note, setNote] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);

  const submit = (): void => {
    setValidationError(null);
    const payload: CreateGrnClaimRequest = { listingId: item.id };
    if (quantity.trim().length > 0) {
      const value = Number(quantity);
      if (!Number.isFinite(value) || value <= 0) {
        setValidationError('Quantity must be a positive number.');
        return;
      }
      payload.quantity = value;
    }
    const n = note.trim();
    if (n.length > 0) payload.note = n;
    onConfirm(payload);
  };

  return (
    <div className="card card-body space-y-3 max-w-2xl">
      <p className="text-sm text-foreground">
        Claim <span className="font-medium">{item.crop}</span> ({item.quantity.toLocaleString()}{' '}
        {item.unit}){item.homestead ? ` from ${item.homestead}` : ''}? The grower will be
        notified.
      </p>
      <label className="block">
        <span className="field-label">Quantity to claim</span>
        <input
          type="number"
          min="0"
          step="0.01"
          className="input"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          placeholder={`Optional — up to ${item.quantity} ${item.unit}`}
          disabled={busy}
        />
      </label>
      <label className="block">
        <span className="field-label">Message to grower</span>
        <input
          type="text"
          className="input"
          value={note}
          onChange={(e) => setNote(e.target.value)}
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
          {busy ? 'Claiming...' : 'Confirm claim'}
        </button>
      </div>
    </div>
  );
}
