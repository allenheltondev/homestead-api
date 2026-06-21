import type { ReactElement } from 'react';
import type { EggCostStats } from '../api/types';

interface Props {
  stats: EggCostStats;
}

// Formats a USD amount with cents — cost-per-dozen/egg figures are small, so
// the whole-dollar formatMoney helper isn't precise enough here.
function money(amount: number): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: 'USD',
    }).format(amount);
  } catch {
    return `$${amount.toFixed(2)}`;
  }
}

// Cost-per-dozen analytics card: your home-produced cost vs. the store price,
// with a cheaper/more-expensive indicator. When consumption data is available
// it surfaces both the purchase-basis and the refined consumption-basis cost.
export default function EggCostCard({ stats }: Props): ReactElement {
  const cheaper = stats.cheaperThanStore;
  const savings = Math.abs(stats.savingsPerDozen);
  const consumption = stats.consumptionBasis;

  return (
    <div className="card card-body space-y-4">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Cost per dozen
          </span>
          <span className="block text-3xl font-semibold text-foreground mt-1">
            {money(stats.costPerDozen)}
          </span>
          <span className="text-xs text-muted-foreground">
            {money(stats.costPerEgg)} per egg · purchase basis
          </span>
        </div>
        <span
          className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${
            cheaper
              ? 'bg-success-100 text-success-700'
              : 'bg-warning-100 text-warning-700'
          }`}
        >
          {cheaper ? 'Cheaper than store' : 'Pricier than store'}
        </span>
      </div>

      <p className="text-sm text-muted-foreground">
        {cheaper ? 'You save' : 'You pay'}{' '}
        <span className={`font-medium ${cheaper ? 'text-success-700' : 'text-warning-700'}`}>
          {money(savings)}
        </span>{' '}
        per dozen vs. a store price of {money(stats.storePricePerDozen)}.
      </p>

      {consumption && (
        <div className="rounded-md border border-border bg-muted px-3 py-2.5">
          <div className="flex items-baseline justify-between gap-3">
            <div>
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Consumption basis
              </span>
              <span className="block text-2xl font-semibold text-foreground mt-0.5">
                {money(consumption.costPerDozen)}
              </span>
              <span className="text-xs text-muted-foreground">
                {money(consumption.costPerEgg)} per egg · feed actually fed
              </span>
            </div>
            <span
              className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${
                consumption.cheaperThanStore
                  ? 'bg-success-100 text-success-700'
                  : 'bg-warning-100 text-warning-700'
              }`}
            >
              {consumption.cheaperThanStore ? 'Cheaper than store' : 'Pricier than store'}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            {consumption.poultryFeedConsumedLbs.toLocaleString()} lb consumed worth{' '}
            {money(consumption.poultryFeedConsumedValue)}.
          </p>
        </div>
      )}

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm border-t border-border pt-3">
        <div>
          <dt className="text-muted-foreground">Eggs</dt>
          <dd className="font-medium text-foreground">{stats.eggs.toLocaleString()}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Dozens</dt>
          <dd className="font-medium text-foreground">{stats.dozens.toLocaleString()}</dd>
        </div>
        <div className="col-span-2">
          <dt className="text-muted-foreground">Poultry feed spend</dt>
          <dd className="font-medium text-foreground">{money(stats.poultryFeedSpend)}</dd>
        </div>
      </dl>
    </div>
  );
}
