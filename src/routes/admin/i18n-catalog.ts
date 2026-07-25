// GET /admin/i18n/catalog/:locale — the admin UI's own translations, fetched
// by the client renderer on every page (the chrome emits catalogHref).
//
// Core, not part of the i18n feature: without it the whole admin interface
// falls back to raw message keys. The feature owns the screens for *editing*
// locales and translations, not serving them.

import { Hono } from 'hono';
import type { Env, Variables } from '../../types';
import { buildTranslationCatalog } from '../../utils/i18n';

export const i18nCatalogRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

i18nCatalogRoutes.get('/i18n/catalog/:locale', async (c) => {
  try {
    return c.json(await buildTranslationCatalog(c.env, c.req.param('locale'), true), 200, {
      'Cache-Control': 'private, no-cache',
    });
  } catch {
    return c.json({ error: 'Locale not found' }, 404);
  }
});

