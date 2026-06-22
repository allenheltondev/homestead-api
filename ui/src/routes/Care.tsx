import type { ReactElement } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { useApiFetch, ApiError } from '../auth/useApiFetch';
import {
  completeCareTask,
  createCareTask,
  deleteCareTask,
  listCareTasks,
} from '../api/care';
import type {
  CareTask,
  CareTaskCadence,
  CareTaskStatus,
  CreateCareTaskRequest,
} from '../api/types';
import Modal from '../components/Modal';
import PageHeader from '../components/PageHeader';
import { formatShortDate } from '../components/format';

const CADENCES: CareTaskCadence[] = ['once', 'daily', 'weekly', 'monthly', 'yearly'];

// Whole-day difference from today (UTC) to a due date. Negative => overdue.
function daysUntil(dueDate: string): number {
  const due = Date.parse(`${dueDate.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(due)) return 0;
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((due - today) / 86_400_000);
}

function dueLabel(days: number): { text: string; tone: 'overdue' | 'soon' | 'later' } {
  if (days < 0) return { text: `${Math.abs(days)}d overdue`, tone: 'overdue' };
  if (days === 0) return { text: 'Due today', tone: 'soon' };
  if (days <= 3) return { text: `Due in ${days}d`, tone: 'soon' };
  return { text: `Due in ${days}d`, tone: 'later' };
}

export default function Care(): ReactElement {
  const apiFetch = useApiFetch();
  const [tasks, setTasks] = useState<CareTask[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'' | CareTaskStatus>('open');

  const [createOpen, setCreateOpen] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [busyId, setBusyId] = useState<string | null>(null);

  const reload = useCallback((): (() => void) => {
    let cancelled = false;
    setError(null);
    setTasks(null);
    listCareTasks(apiFetch, { status: statusFilter || undefined })
      .then((res) => {
        if (!cancelled) setTasks(res.care_tasks);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [apiFetch, statusFilter]);

  useEffect(() => reload(), [reload]);

  const handleCreate = async (payload: CreateCareTaskRequest): Promise<void> => {
    setCreateBusy(true);
    setCreateError(null);
    try {
      await createCareTask(apiFetch, payload);
      setCreateOpen(false);
      reload();
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : (err as Error).message);
    } finally {
      setCreateBusy(false);
    }
  };

  const handleComplete = async (id: string): Promise<void> => {
    setBusyId(id);
    try {
      await completeCareTask(apiFetch, id);
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (id: string): Promise<void> => {
    setBusyId(id);
    try {
      await deleteCareTask(apiFetch, id);
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="space-y-6">
      <PageHeader
        title="Care schedule"
        subtitle="Recurring tasks with due dates and due-soon highlighting."
        actions={
          <button
            type="button"
            className="btn-primary"
            onClick={() => {
              setCreateError(null);
              setCreateOpen(true);
            }}
          >
            Add task
          </button>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Status</span>
          <select
            className="input w-auto py-1.5"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as '' | CareTaskStatus)}
          >
            <option value="open">Open</option>
            <option value="done">Done</option>
            <option value="">All</option>
          </select>
        </label>
      </div>

      {error && <p className="form-error">{error}</p>}
      {tasks === null && !error && <p className="text-muted-foreground">Loading...</p>}
      {tasks && tasks.length === 0 && (
        <div className="card card-body text-center py-12 space-y-4">
          <p className="text-muted-foreground">No care tasks yet.</p>
          <button
            type="button"
            className="btn-primary inline-flex w-auto mx-auto"
            onClick={() => {
              setCreateError(null);
              setCreateOpen(true);
            }}
          >
            Add your first task
          </button>
        </div>
      )}
      {tasks && tasks.length > 0 && (
        <ul className="space-y-3">
          {tasks.map((t) => {
            const days = daysUntil(t.dueDate);
            const label = dueLabel(days);
            const isDone = t.status === 'done';
            const borderTone =
              isDone || label.tone === 'later'
                ? 'border-border'
                : label.tone === 'overdue'
                  ? 'border-error-300'
                  : 'border-warning-300';
            return (
              <li key={t.id} className={`card card-body border-l-4 ${borderTone}`}>
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-foreground">{t.title}</span>
                      {t.category && (
                        <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                          {t.category}
                        </span>
                      )}
                      <span className="text-xs text-muted-foreground">{t.cadence}</span>
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {t.animalRef ? `${t.animalRef} · ` : ''}
                      {formatShortDate(t.dueDate)}
                      {t.note ? ` · ${t.note}` : ''}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {isDone ? (
                      <span className="inline-flex items-center rounded-full bg-success-100 text-success-700 px-2.5 py-1 text-xs font-medium">
                        Done
                      </span>
                    ) : (
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${
                          label.tone === 'overdue'
                            ? 'bg-error-100 text-error-700'
                            : label.tone === 'soon'
                              ? 'bg-warning-100 text-warning-700'
                              : 'bg-muted text-muted-foreground'
                        }`}
                      >
                        {label.text}
                      </span>
                    )}
                    {!isDone && (
                      <button
                        type="button"
                        className="btn-secondary btn-sm"
                        onClick={() => void handleComplete(t.id)}
                        disabled={busyId === t.id}
                      >
                        {busyId === t.id ? '...' : 'Complete'}
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn-link text-error-600 hover:text-error-700"
                      onClick={() => void handleDelete(t.id)}
                      disabled={busyId === t.id}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Modal
        open={createOpen}
        title="Add care task"
        onClose={() => (!createBusy ? setCreateOpen(false) : undefined)}
      >
        <CareTaskForm
          busy={createBusy}
          serverError={createError}
          onSubmit={(p) => void handleCreate(p)}
          onCancel={() => setCreateOpen(false)}
        />
      </Modal>
    </section>
  );
}

interface FormProps {
  busy: boolean;
  serverError: string | null;
  onSubmit: (payload: CreateCareTaskRequest) => void;
  onCancel: () => void;
}

function CareTaskForm({ busy, serverError, onSubmit, onCancel }: FormProps): ReactElement {
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('');
  const [animalRef, setAnimalRef] = useState('');
  const [cadence, setCadence] = useState<CareTaskCadence>('once');
  const [dueDate, setDueDate] = useState('');
  const [note, setNote] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);

  const submit = (): void => {
    setValidationError(null);
    const titleText = title.trim();
    if (titleText.length === 0) {
      setValidationError('Title is required.');
      return;
    }
    const payload: CreateCareTaskRequest = { title: titleText, cadence };
    const cat = category.trim();
    if (cat.length > 0) payload.category = cat;
    const ref = animalRef.trim();
    if (ref.length > 0) payload.animalRef = ref;
    if (dueDate) payload.dueDate = dueDate;
    const noteText = note.trim();
    if (noteText.length > 0) payload.note = noteText;
    onSubmit(payload);
  };

  return (
    <div className="card card-body space-y-3 max-w-2xl">
      <label className="block">
        <span className="field-label">Title</span>
        <input
          type="text"
          className="input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Hoof trim"
          disabled={busy}
          autoFocus
        />
      </label>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="field-label">Category</span>
          <input
            type="text"
            className="input"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="Optional — e.g. vaccination"
            disabled={busy}
          />
        </label>
        <label className="block">
          <span className="field-label">Animal</span>
          <input
            type="text"
            className="input"
            value={animalRef}
            onChange={(e) => setAnimalRef(e.target.value)}
            placeholder="Optional — name or tag"
            disabled={busy}
          />
        </label>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="field-label">Cadence</span>
          <select
            className="input"
            value={cadence}
            onChange={(e) => setCadence(e.target.value as CareTaskCadence)}
            disabled={busy}
          >
            {CADENCES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="field-label">Due date</span>
          <input
            type="date"
            className="input"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            disabled={busy}
          />
          <span className="field-hint mt-1 block">Defaults to today if left blank.</span>
        </label>
      </div>

      <label className="block">
        <span className="field-label">Note</span>
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
          {busy ? 'Saving...' : 'Add task'}
        </button>
      </div>
    </div>
  );
}
