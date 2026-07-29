/**
 * Currency catalog owned entirely by the credits feature.
 *
 * Storage is row-based, shared contracts accept opaque strings, and the admin
 * shell renders contributed wallet rows. Adding a currency therefore means
 * adding one entry here plus its translations; core code and SQL stay fixed.
 */
export const CREDIT_CURRENCY_DEFINITIONS = [
  {
    id: 'credit',
    default: true,
    fallbackLabel: 'credits',
    sidebarClass: 'text-amber-400',
    sidebarIcon: 'coins',
    showInSidebarWhenEmpty: true,
  },
  {
    id: 'diamond',
    default: false,
    fallbackLabel: 'diamonds',
    sidebarClass: 'text-violet-400',
    sidebarIcon: 'diamond',
    showInSidebarWhenEmpty: false,
  },
] as const;

export type CreditCurrency = typeof CREDIT_CURRENCY_DEFINITIONS[number]['id'];

export const CREDIT_CURRENCIES: readonly CreditCurrency[] =
  CREDIT_CURRENCY_DEFINITIONS.map((definition) => definition.id);

export const DEFAULT_CREDIT_CURRENCY: CreditCurrency =
  CREDIT_CURRENCY_DEFINITIONS.find((definition) => definition.default)?.id ?? 'credit';

const DEFINITIONS = new Map<string, typeof CREDIT_CURRENCY_DEFINITIONS[number]>(
  CREDIT_CURRENCY_DEFINITIONS.map((definition) => [definition.id, definition]),
);

export function isCreditCurrency(value: unknown): value is CreditCurrency {
  return typeof value === 'string' && DEFINITIONS.has(value);
}

export function creditCurrencyDefinition(currency: CreditCurrency): typeof CREDIT_CURRENCY_DEFINITIONS[number] {
  return DEFINITIONS.get(currency) ?? CREDIT_CURRENCY_DEFINITIONS[0];
}
