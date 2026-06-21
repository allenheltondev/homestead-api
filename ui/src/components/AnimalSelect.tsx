import type { ReactElement } from 'react';
import { useEffect, useState } from 'react';
import { useApiFetch } from '../auth/useApiFetch';
import { listAnimals } from '../api/animals';
import type { Animal } from '../api/types';

interface Props {
  value: string;
  onChange: (animalId: string) => void;
  // Restrict the pickable list, e.g. to dams (sex=female) or sires (male).
  sex?: 'female' | 'male';
  excludeId?: string;
  disabled?: boolean;
  placeholder?: string;
  ariaLabel?: string;
}

// A parent picker for the birth flow. Lists active animals, optionally
// filtered by sex, and reports the selected animal's ULID.
export default function AnimalSelect({
  value,
  onChange,
  sex,
  excludeId,
  disabled,
  placeholder = 'None',
  ariaLabel,
}: Props): ReactElement {
  const apiFetch = useApiFetch();
  const [animals, setAnimals] = useState<Animal[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listAnimals(apiFetch, { status: 'active' })
      .then((res) => {
        if (!cancelled) {
          setAnimals(res.animals);
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

  const options = animals.filter((a) => {
    if (excludeId && a.id === excludeId) return false;
    if (sex && a.sex && a.sex !== sex) return false;
    return true;
  });

  const label = (a: Animal): string => {
    const name = a.name ?? a.tag ?? a.id.slice(0, 8);
    return `${name} (${a.species})`;
  };

  return (
    <div>
      <select
        className="input"
        value={value}
        disabled={disabled}
        aria-label={ariaLabel ?? 'Animal'}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{placeholder}</option>
        {options.map((a) => (
          <option key={a.id} value={a.id}>
            {label(a)}
          </option>
        ))}
      </select>
      {loadError && (
        <p className="text-xs text-error-600 mt-1">Could not load animals: {loadError}</p>
      )}
    </div>
  );
}
