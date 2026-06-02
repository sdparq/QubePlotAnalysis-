/**
 * Currency conversion for the Economic tab.
 *
 * All monetary values in `EconomicConfig` and in the `computeEconomic` engine
 * are stored canonically in AED (the default of the OMRT/QUBE class library).
 * The user picks a display currency in the UI; this module converts AED into
 * (and back from) that currency using a nominal static rate table.
 *
 * Rates are AED → currency, i.e. the number of units of `currency` you get for
 * one AED. Approximate mid-2025 / 2026 levels — fine for a planning tool, not
 * for accounting. AED itself is pegged to USD at 3.6725, SAR is also pegged
 * to USD, so those rates are stable. EUR / GBP fluctuate.
 */

export const BASE_CURRENCY = "AED" as const;

/** Units of currency per 1 AED. */
export const AED_RATES: Record<string, number> = {
  AED: 1,
  USD: 0.2723,
  EUR: 0.2540,
  SAR: 1.0206,
  GBP: 0.2150,
};

export function rateForCurrency(currency: string | undefined): number {
  const c = (currency ?? BASE_CURRENCY).toUpperCase();
  return AED_RATES[c] ?? 1;
}

/** AED → display currency. */
export function fromBase(amountAed: number, currency: string | undefined): number {
  return amountAed * rateForCurrency(currency);
}

/** Display currency → AED. */
export function toBase(amount: number, currency: string | undefined): number {
  const r = rateForCurrency(currency);
  return r > 0 ? amount / r : amount;
}
