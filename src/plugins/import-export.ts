// Deep links into the import-export plugin.
//
// CSV import/export used to live in the CMS; it now ships as its own plugin
// Worker, so the host only needs to know where to point the buttons — and to
// hide them when the plugin is not installed.

import type { AppContext } from '../core/http/context';
import { pluginById } from './registry';

/** Manifest id of the plugin that owns CSV import/export since its extraction. */
export const IMPORT_EXPORT_PLUGIN_ID = 'import-export';

/** The plugin's admin base path when it is registered and enabled, else ''. */
export async function importExportPluginBase(env: AppContext['env']): Promise<string> {
  const plugin = await pluginById(env, IMPORT_EXPORT_PLUGIN_ID);
  return plugin ? `/admin/plugins/${IMPORT_EXPORT_PLUGIN_ID}` : '';
}

/**
 * Dashboard Import/Export button targets. The buttons deep-link into the
 * plugin when it's installed and disappear (empty hrefs) when it isn't.
 */
export async function importExportHrefs(
  env: AppContext['env'],
  pageType?: string,
): Promise<{ importHref: string; exportHref: string }> {
  const base = await importExportPluginBase(env);
  if (!base) return { importHref: '', exportHref: '' };
  return {
    importHref: pageType ? `${base}/import/${encodeURIComponent(pageType)}` : base,
    exportHref: pageType ? `${base}/export?page_type=${encodeURIComponent(pageType)}` : `${base}/export`,
  };
}
