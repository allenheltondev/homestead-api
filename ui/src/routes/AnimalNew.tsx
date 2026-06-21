import type { ReactElement } from 'react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApiFetch, ApiError } from '../auth/useApiFetch';
import { createAnimal } from '../api/animals';
import type { CreateAnimalRequest } from '../api/types';
import RegisterAnimalForm from '../components/RegisterAnimalForm';

export default function AnimalNew(): ReactElement {
  const apiFetch = useApiFetch();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const handleSubmit = async (payload: CreateAnimalRequest): Promise<void> => {
    setBusy(true);
    setServerError(null);
    try {
      const animal = await createAnimal(apiFetch, payload);
      navigate(`/animals/${animal.id}`);
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-4">
      <header>
        <h1 className="text-2xl font-semibold text-foreground">Register animal</h1>
      </header>
      <RegisterAnimalForm
        busy={busy}
        serverError={serverError}
        submitLabel="Register animal"
        onSubmit={(p) => void handleSubmit(p)}
        onCancel={() => navigate('/animals')}
      />
    </section>
  );
}
