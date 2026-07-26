// GET /admin/settings/credits — chargeable actions and effective prices
// across installed plugins, plus their creation limits.
//
// Extracted from routes/admin/settings.ts, where it sat between the branding
// and language screens for no reason other than sharing a URL prefix.

import { Hono } from 'hono';
import type { Env, Variables } from '../../types';
import { renderPage } from '../../core/render/chrome';
import { userCan } from '../../core/auth/permissions';
import { getPlugins } from '../plugins/registry';
import { listPlugins } from '../plugins/store';
import { creditUnitLabel, effectiveCreditsForPlugin, type EffectiveCredit } from './service';
import { effectiveLimitsForPlugin, type NormalizedLimitDef } from '../plugins/limits';
import { creditSummaryPage, type CreditSummaryRow, type LimitSummaryRow } from './template';

export const creditSettingsRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

function creditSummaryChargeLabel(credit: EffectiveCredit): string {
  if (credit.def.charge === 'page_create') return `On create: ${credit.def.pageType}`;
  if (credit.def.charge === 'recurring') {
    return `Monthly (${credit.def.billing}) per ${creditUnitLabel(credit.def)}`;
  }
  return `Metered per ${credit.def.unit}`;
}

function creditSummaryChargeKey(credit: EffectiveCredit): string {
  if (credit.def.charge === 'page_create') return 'credits.summary.on_create';
  if (credit.def.charge === 'recurring') {
    return credit.def.billing === 'arrears' ? 'credits.summary.monthly_arrears_per' : 'credits.summary.monthly_advance_per';
  }
  return 'credits.summary.metered_per';
}

function limitSummaryScopeLabel(def: NormalizedLimitDef): string {
  if (def.scope === 'per_second') return 'Per second';
  if (def.scope === 'per_parent') return 'Per parent page';
  if (def.scope === 'per_pointer') return `Per ${def.pointerKey}`;
  return 'Total';
}

function bySummaryOrder(
  a: { pluginLabel: string; label: string; key: string },
  b: { pluginLabel: string; label: string; key: string },
): number {
  return a.pluginLabel.localeCompare(b.pluginLabel)
    || a.label.localeCompare(b.label)
    || a.key.localeCompare(b.key);
}

creditSettingsRoutes.get('/settings/credits', async (c) => {
  const [plugins, pluginRecords] = await Promise.all([
    getPlugins(c.env),
    listPlugins(c.env.DB),
  ]);
  const recordIds = new Map(pluginRecords.map((record) => [record.url, record.id]));
  const manageHref = (binding: string, section: 'credits' | 'limits'): string => {
    const id = recordIds.get(binding);
    return id ? `/admin/plugins-manage/${id}/${section}` : '/admin/plugins-manage';
  };

  const rows: CreditSummaryRow[] = (await Promise.all(plugins.map(async (plugin) => {
    const credits = await effectiveCreditsForPlugin(c.env, plugin);
    const pluginLabel = plugin.manifest.name || plugin.label || plugin.manifest.id;
    return credits.map((credit) => ({
      pluginLabel,
      pluginId: plugin.manifest.id,
      key: credit.def.key,
      label: credit.def.label,
      description: credit.def.description,
      chargeLabel: creditSummaryChargeLabel(credit),
      chargeKey: creditSummaryChargeKey(credit),
      chargeValue: (credit.def.charge === 'page_create' ? credit.def.pageType : creditUnitLabel(credit.def)) ?? '',
      effectiveLabel: credit.value === 0 ? 'Free' : `${credit.value} credits`,
      effectiveFree: credit.value === 0,
      effectiveValue: credit.value,
      manageHref: manageHref(plugin.binding, 'credits'),
    }));
  }))).flat().sort(bySummaryOrder);

  const limitRows: LimitSummaryRow[] = (await Promise.all(plugins.map(async (plugin) => {
    const limits = await effectiveLimitsForPlugin(c.env, plugin);
    const pluginLabel = plugin.manifest.name || plugin.label || plugin.manifest.id;
    return limits.map((limit) => ({
      pluginLabel,
      pluginId: plugin.manifest.id,
      key: limit.def.key,
      label: limit.def.label,
      description: limit.def.description,
      scopeLabel: limitSummaryScopeLabel(limit.def),
      scopeKey: limit.def.scope === 'per_second'
        ? 'credits.summary.per_second'
        : limit.def.scope === 'per_parent'
          ? 'credits.summary.per_parent_page'
          : limit.def.scope === 'per_pointer'
            ? 'credits.summary.per'
            : 'credits.summary.total',
      scopeValue: limit.def.scope === 'per_pointer' ? (limit.def.pointerKey ?? '') : '',
      effectiveLabel: limit.value === null ? 'Unlimited' : `${limit.value}`,
      effectiveUnlimited: limit.value === null,
      effectiveValue: limit.value,
      manageHref: manageHref(plugin.binding, 'limits'),
    }));
  }))).flat().sort(bySummaryOrder);

  const pluginCount = new Set([...rows, ...limitRows].map((row) => row.pluginId)).size;
  const paidCount = rows.filter((row) => row.effectiveLabel !== 'Free').length;

  return renderPage(c, creditSummaryPage, {
    rows,
    limitRows,
    pluginCount,
    chargeCount: rows.length,
    paidCount,
    // Everyone may view the summary; only plugin managers see the edit links.
    canConfigure: await userCan(c, 'plugin:manage'),
  });
});

