// Language and translation administration: which locales exist, which are
// enabled for content and for the UI, and per-locale message overrides.
//
// Extracted from routes/admin/settings.ts. Serving the catalog stays core
// (routes/admin/i18n-catalog.ts) — only editing is optional.

import { Hono } from 'hono';
import type { Env, Variables } from '../../types';
import { requirePermission } from '../../core/auth/guards';
import { renderPage } from '../../core/render/chrome';
import { logAudit } from '../../core/db/audit';
import { languagesPage, translationsPage, type LocaleViewRow } from './template';
import { clearConfigCache } from '../../plugins/config';
import {
  deleteLocale,
  deleteLocaleMessage,
  listLocaleMessages,
  listLocales,
  normalizeLocaleCode,
  loadBundledLocaleCatalog,
  saveLocale,
  saveLocaleMessage,
} from '../../core/i18n';

export const i18nRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

i18nRoutes.use('/settings/languages', requirePermission('menu:manage'));
i18nRoutes.use('/settings/languages/*', requirePermission('menu:manage'));
i18nRoutes.use('/settings/translations', requirePermission('menu:manage'));
i18nRoutes.use('/settings/translations/*', requirePermission('menu:manage'));

function message(value: string | undefined): string {
  return value ? value.slice(0, 300) : '';
}

i18nRoutes.get('/settings/languages', async (c) => {
  const locales = await listLocales(c.env);
  const rows: LocaleViewRow[] = locales.map((locale) => ({
    code: locale.code,
    label: locale.label,
    contentEnabled: locale.content_enabled === 1,
    uiEnabled: locale.ui_enabled === 1,
    direction: locale.direction,
    fallbackCode: locale.fallback_code ?? '',
    weight: locale.weight,
    builtin: locale.builtin === 1,
    protected: locale.code === 'mis',
    updateAction: `/admin/settings/languages/${encodeURIComponent(locale.code)}`,
    deleteAction: `/admin/settings/languages/${encodeURIComponent(locale.code)}/delete`,
    translationsHref: `/admin/settings/translations?locale=${encodeURIComponent(locale.code)}`,
    fallbackOptions: locales.filter((option) => option.code !== locale.code).map((option) => ({
      code: option.code,
      label: `${option.label} (${option.code})`,
      selected: option.code === locale.fallback_code,
    })),
  }));
  return renderPage(c, languagesPage, {
    locales: rows,
    flash: message(c.req.query('flash')),
    error: message(c.req.query('error')),
  });
});

i18nRoutes.post('/settings/languages', async (c) => {
  const form = await c.req.formData();
  try {
    const code = await saveLocale(c.env, Object.fromEntries(form));
    clearConfigCache();
    logAudit(c, 'locale.create', 'locale', code);
    return c.redirect('/admin/settings/languages?flash=Language+added', 303);
  } catch (error) {
    return c.redirect(`/admin/settings/languages?error=${encodeURIComponent(error instanceof Error ? error.message : 'Unable to add language')}`, 303);
  }
});

i18nRoutes.post('/settings/languages/:code', async (c) => {
  const form = await c.req.formData();
  try {
    const code = await saveLocale(c.env, Object.fromEntries(form), c.req.param('code'));
    clearConfigCache();
    logAudit(c, 'locale.update', 'locale', code);
    return c.redirect('/admin/settings/languages?flash=Language+saved', 303);
  } catch (error) {
    return c.redirect(`/admin/settings/languages?error=${encodeURIComponent(error instanceof Error ? error.message : 'Unable to save language')}`, 303);
  }
});

i18nRoutes.post('/settings/languages/:code/delete', async (c) => {
  try {
    await deleteLocale(c.env, c.req.param('code'));
    clearConfigCache();
    logAudit(c, 'locale.delete', 'locale', c.req.param('code'));
    return c.redirect('/admin/settings/languages?flash=Language+deleted', 303);
  } catch (error) {
    return c.redirect(`/admin/settings/languages?error=${encodeURIComponent(error instanceof Error ? error.message : 'Unable to delete language')}`, 303);
  }
});

i18nRoutes.get('/settings/translations', async (c) => {
  const locales = await listLocales(c.env);
  const requested = c.req.query('locale') ?? 'en';
  const selected = locales.find((locale) => locale.code === requested) ?? locales.find((locale) => locale.code === 'en') ?? locales[0];
  if (!selected) return c.notFound();
  const [messages, bundledMessages] = await Promise.all([
    listLocaleMessages(c.env, selected.code),
    loadBundledLocaleCatalog(c.env, selected.code),
  ]);
  const overrides = new Map(messages.map((entry) => [entry.message_key, entry]));
  const messageKeys = [...new Set([...Object.keys(bundledMessages), ...overrides.keys()])].sort();
  return renderPage(c, translationsPage, {
    localeCode: selected.code,
    localeLabel: selected.label,
    localeOptions: locales.map((locale) => ({ code: locale.code, label: locale.label, selected: locale.code === selected.code })),
    messages: messageKeys.map((key) => {
      const override = overrides.get(key);
      return {
        key,
        fileValue: bundledMessages[key] ?? '',
        hasFileValue: key in bundledMessages,
        overrideValue: override?.value ?? '',
        hasOverride: !!override,
        deleteAction: override
          ? `/admin/settings/translations/${encodeURIComponent(selected.code)}/${encodeURIComponent(key)}/delete`
          : '',
      };
    }),
    flash: message(c.req.query('flash')),
    error: message(c.req.query('error')),
  });
});

i18nRoutes.post('/settings/translations', async (c) => {
  const form = await c.req.formData();
  const locale = String(form.get('locale') ?? 'en');
  try {
    await saveLocaleMessage(c.env, locale, form.get('key'), form.get('value'), String(c.get('user').sub));
    logAudit(c, 'locale_message.upsert', 'locale', locale);
    return c.redirect(`/admin/settings/translations?locale=${encodeURIComponent(locale)}&flash=Translation+saved`, 303);
  } catch (error) {
    return c.redirect(`/admin/settings/translations?locale=${encodeURIComponent(locale)}&error=${encodeURIComponent(error instanceof Error ? error.message : 'Unable to save translation')}`, 303);
  }
});

i18nRoutes.post('/settings/translations/:locale/:key/delete', async (c) => {
  const locale = normalizeLocaleCode(c.req.param('locale'));
  await deleteLocaleMessage(c.env, locale, c.req.param('key'));
  logAudit(c, 'locale_message.delete', 'locale', locale);
  return c.redirect(`/admin/settings/translations?locale=${encodeURIComponent(locale)}&flash=Translation+deleted`, 303);
});

