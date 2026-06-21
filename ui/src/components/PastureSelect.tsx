import type { ReactElement } from 'react';
import { useEffect, useState } from 'react';
import { useApiFetch } from '../auth/useApiFetch';
import { listPastures } from '../api/pastures';
import type { Pasture } from '../api/types';

interface Props {
  value: string;
  onChange: (pastureId: string) => void;
  disabled?: boolean;
  placeholder?: string;
  includeAny?: boolean;
  anyLabel?: string;
  ariaLabel?: string;
}

// A pasture picker backed by the live pasture list. Reports the selected
// pasture id (a ULID), or '' for the "any"/none option.
export default function PastureSelect({
  value,
  onChange,
  disabled,
  placeholder = 'Select a pasture…',
  includeAny = false,
  anyLabel = 'Any pasture',
  ariaLabel,
}: Props): ReactElement {
  const apiFetch = useApiFetch();
  const [pastures, setPastures] = useState<Pasture[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listPastures(apiFetch, { limit: 500 })
      .then((res) => {
        if (!cancelled) {
          setPastures(res.pastures);
          setLoadError(null);
        }
      })
      .catch((err: Error) => {
        if (!cancelled) setLoadError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [apiFetch]);

  const known = pastures.some((p) => p.id === value);

  return (
    <div>
      <select
        className="input"
        value={value}
        disabled={disabled}
        aria-label={ariaLabel ?? 'Pasture'}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{includeAny ? anyLabel : placeholder}</option>
        {value && !known && <option value={value}>{value}</option>}
        {pastures.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      {loadError && (
        <p className="text-xs text-error-600 mt-1">Could not load pastures: {loadError}</p>
      )}
    </div>
  );
}
