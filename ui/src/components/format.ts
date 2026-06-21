// Small shared formatting helpers used across the homestead screens.

export function formatMoney(amount: number, currency = 'USD'): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `$${amount}`;
  }
}

// Renders an ISO date or date-time as a short, locale-aware date in UTC so
// YYYY-MM-DD values don't drift across timezones.
export function formatShortDate(iso: string | null): string {
  if (!iso) return '-';
  const value = iso.length <= 10 ? `${iso}T00:00:00Z` : iso;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(d);
}

// A whole-day difference helper used for ages. Returns null on bad input.
export function ageInDays(dob: string | null): number | null {
  if (!dob) return null;
  const start = Date.parse(`${dob.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(start)) return null;
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.max(0, Math.round((today - start) / 86_400_000));
}

// A human age label like "2y 3mo" or "12d" from a date of birth.
export function ageLabel(dob: string | null): string {
  const days = ageInDays(dob);
  if (days === null) return '-';
  if (days < 31) return `${days}d`;
  const months = Math.floor(days / 30.44);
  if (months < 24) return `${months}mo`;
  const years = Math.floor(months / 12);
  const remMonths = months % 12;
  return remMonths > 0 ? `${years}y ${remMonths}mo` : `${years}y`;
}
