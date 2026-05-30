import type { SquareMoney } from '../types/square.types';
import type { ApiMoney } from '../types/api.types';

// Square stores all monetary values in the smallest currency unit (cents for USD).
// We normalize to a plain number here since JSON doesn't support BigInt.
export function formatMoney(money: SquareMoney): ApiMoney {
  // Square SDK may return amount as bigint — coerce to number for JSON serialization
  const amount = typeof money.amount === 'bigint' ? Number(money.amount) : (money.amount ?? 0);

  const currency = money.currency ?? 'USD';

  const formatted = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(amount / 100);

  return { amount, currency, formatted };
}
