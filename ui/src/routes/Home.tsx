import type { ReactElement, ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApiFetch } from '../auth/useApiFetch';
import {
  getCareDue,
  getDigest,
  getEggCost,
  getFeedStats,
  getPnl,
  getStatsSummary,
} from '../api/stats';
import type {
  CareDueStats,
  DigestStats,
  EggCostStats,
  FeedStats,
  PnlStats,
  StatsSummary,
} from '../api/types';
import HerdChart from '../components/HerdChart';
import FeedSpendChart from '../components/FeedSpendChart';
import EggCostCard from '../components/EggCostCard';
import DigestCard from '../components/DigestCard';
import { formatMoney, formatShortDate } from '../components/format';

interface DashboardData {
  summary: StatsSummary;
  feed: FeedStats | null;
  eggCost: EggCostStats | null;
  digest: DigestStats | null;
  pnl: PnlStats | null;
  careDue: CareDueStats | null;
}

export default function Home(): ReactElement {
  const apiFetch = useApiFetch();
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setData(null);

    Promise.all([
      getStatsSummary(apiFetch),
      // Best-effort: drives the per-type spend chart for the current month.
      getFeedStats(apiFetch).catch(() => null),
      // Best-effort: cost-per-dozen card for the current month.
      getEggCost(apiFetch).catch(() => null),
      // Best-effort: the "this week" digest card.
      getDigest(apiFetch).catch(() => null),
      // Best-effort: homestead P&L summary card.
      getPnl(apiFetch).catch(() => null),
      // Best-effort: care tasks due now or soon.
      getCareDue(apiFetch).catch(() => null),
    ])
      .then(([summary, feed, eggCost, digest, pnl, careDue]) => {
        if (cancelled) return;
        setData({ summary, feed, eggCost, digest, pnl, careDue });
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });

    return () => {
      cancelled = true;
    };
  }, [apiFetch]);

  if (error) {
    return (
      <section className="space-y-4">
        <h1 className="text-3xl font-semibold text-foreground">Dashboard</h1>
        <p className="form-error">Could not load your dashboard: {error}</p>
      </section>
    );
  }

  if (!data) {
    return (
      <section className="space-y-6">
        <h1 className="text-3xl font-semibold text-foreground">Dashboard</h1>
        <p className="text-muted-foreground">Loading...</p>
      </section>
    );
  }

  const { summary, feed, eggCost, digest, pnl, careDue } = data;
  const noData = summary.herd.totalAnimals === 0 && summary.pastures.total === 0;

  if (noData) {
    return (
      <section className="space-y-6">
        <DashboardHeader />
        <div className="card card-body text-center py-16 space-y-4">
          <p className="text-muted-foreground">
            Nothing tracked yet. Register your first animal to start watching your herd.
          </p>
          <Link to="/animals/new" className="btn-primary inline-flex w-auto mx-auto">
            Register your first animal
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-8">
      <DashboardHeader />

      {digest && <DigestCard digest={digest} />}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Active animals"
          value={String(summary.herd.activeAnimals)}
          sub={
            <span className="text-muted-foreground">
              {summary.herd.totalAnimals} total on record
            </span>
          }
        />
        <StatCard
          label={`Births in ${summary.asOf.year}`}
          value={String(summary.births.thisYear)}
          sub={
            <span className="text-muted-foreground">{summary.births.thisMonth} this month</span>
          }
        />
        <StatCard
          label={`Deaths in ${summary.asOf.year}`}
          value={String(summary.deaths.thisYear)}
          accent={summary.deaths.thisYear > 0 ? 'warning' : undefined}
          sub={
            <span className="text-muted-foreground">{summary.deaths.thisMonth} this month</span>
          }
        />
        <StatCard
          label="Feed spend this month"
          value={formatMoney(summary.feed.thisMonthSpend)}
          sub={
            <Link to="/feed" className="text-primary-600 hover:underline">
              View feed
            </Link>
          }
        />
        <StatCard
          label="Eggs this month"
          value={String(summary.eggs.thisMonth)}
          sub={
            <span className="text-muted-foreground">{summary.eggs.thisWeek} this week</span>
          }
        />
        <StatCard
          label="Cost per dozen"
          value={formatMoney(summary.eggCost.costPerDozenThisMonth)}
          accent={summary.eggCost.cheaperThanStore ? 'success' : 'warning'}
          sub={
            <Link to="/eggs" className="text-primary-600 hover:underline">
              {summary.eggCost.cheaperThanStore ? 'Cheaper than store' : 'View eggs'}
            </Link>
          }
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">Herd by species</h2>
          <HerdChart bySpecies={summary.herd.bySpecies} />
        </section>

        <PanelCard
          title="Pasture occupancy"
          action={
            <Link to="/pastures" className="btn-link">
              All pastures
            </Link>
          }
        >
          {summary.pastures.occupancy.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2">No pastures yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {summary.pastures.occupancy.map((p, i) => (
                <li
                  key={`${p.name ?? 'pasture'}-${i}`}
                  className="py-3 first:pt-0 last:pb-0 flex items-center justify-between gap-3"
                >
                  <span className="text-sm font-medium text-foreground truncate">
                    {p.name ?? 'Unnamed pasture'}
                  </span>
                  <span className="text-sm text-muted-foreground shrink-0">
                    {p.count} animal{p.count === 1 ? '' : 's'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </PanelCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">
            Feed spend by type · {summary.asOf.month}
          </h2>
          <FeedSpendChart byType={feed?.byType ?? {}} />
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">Egg cost per dozen</h2>
          {eggCost ? (
            <EggCostCard stats={eggCost} />
          ) : (
            <p className="rounded-md bg-muted text-muted-foreground text-sm text-center py-6">
              Log egg collections and a poultry feed purchase to see your cost per dozen.
            </p>
          )}
        </section>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <PanelCard
          title="Profit & loss"
          action={
            <Link to="/pnl" className="btn-link">
              View P&amp;L
            </Link>
          }
        >
          {pnl ? (
            <PnlSummaryCard pnl={pnl} />
          ) : (
            <p className="text-sm text-muted-foreground py-2">
              Add sales and log costs to see your homestead net.
            </p>
          )}
        </PanelCard>

        <PanelCard
          title="Care due soon"
          action={
            <Link to="/care" className="btn-link">
              All tasks
            </Link>
          }
        >
          {!careDue || careDue.tasks.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2">Nothing due right now.</p>
          ) : (
            <ul className="divide-y divide-border">
              {careDue.tasks.slice(0, 5).map((t) => (
                <li
                  key={t.id}
                  className="py-3 first:pt-0 last:pb-0 flex items-center justify-between gap-3"
                >
                  <span className="text-sm font-medium text-foreground truncate">{t.title}</span>
                  <span
                    className={`text-xs shrink-0 ${
                      t.overdue ? 'text-error-700' : 'text-warning-700'
                    }`}
                  >
                    {t.overdue
                      ? `${Math.abs(t.daysUntilDue)}d overdue`
                      : t.daysUntilDue === 0
                        ? 'Due today'
                        : `in ${t.daysUntilDue}d`}{' '}
                    · {formatShortDate(t.dueDate)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </PanelCard>
      </div>
    </section>
  );
}

function DashboardHeader(): ReactElement {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="space-y-1">
        <h1 className="text-3xl font-semibold text-foreground">Dashboard</h1>
        <p className="text-muted-foreground">
          Your herd, births and deaths, feed spend, and pasture occupancy.
        </p>
      </div>
      <Link to="/animals/new" className="btn-primary w-auto">
        Register animal
      </Link>
    </header>
  );
}

function StatCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: ReactNode;
  accent?: 'warning' | 'success';
}): ReactElement {
  const valueColor =
    accent === 'warning'
      ? 'text-warning-700'
      : accent === 'success'
        ? 'text-success-700'
        : 'text-foreground';
  return (
    <div className="card card-body !py-4">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className={`text-2xl font-semibold mt-1 block ${valueColor}`}>{value}</span>
      {sub && <span className="text-xs mt-1 block">{sub}</span>}
    </div>
  );
}

function PanelCard({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}): ReactElement {
  return (
    <div className="card">
      <div className="card-header flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
        {action}
      </div>
      <div className="card-body">{children}</div>
    </div>
  );
}

function PnlSummaryCard({ pnl }: { pnl: PnlStats }): ReactElement {
  const profitable = pnl.net >= 0;
  return (
    <div className="space-y-3">
      <div>
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Net {pnl.period ? `· ${pnl.period}` : ''}
        </span>
        <span
          className={`block text-3xl font-semibold mt-1 ${
            profitable ? 'text-success-700' : 'text-warning-700'
          }`}
        >
          {formatMoney(pnl.net)}
        </span>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm border-t border-border pt-3">
        <div>
          <dt className="text-muted-foreground">Revenue</dt>
          <dd className="font-medium text-success-700">{formatMoney(pnl.totalRevenue)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Costs</dt>
          <dd className="font-medium text-warning-700">{formatMoney(pnl.totalCosts)}</dd>
        </div>
      </dl>
    </div>
  );
}
