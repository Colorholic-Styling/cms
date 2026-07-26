// The plugin platform's implementations of core's extension points.
//
// Importing this module registers them. Core calls whatever is registered and
// does nothing when the platform is absent, which is what makes the platform
// droppable: nothing in core/ names it.

import { registerCoreExtensions, type ContributedNavItem } from '../core/extensions';
import type { PublishAdapter } from '../core/publish/adapter';
import type { PublishLectRule } from '../core/publish/projection';
import { flattenMessages } from '../core/i18n';
import type { Env, JWTPayload } from '../types';
import { getPlugins, pluginNav, PLUGIN_ORIGIN, PLUGIN_PREFIX } from './registry';
import { pluginTenantId } from './proxy';
import { deliverHooks } from './hooks';
import { pluginAdapter } from './publish-adapter';

registerCoreExtensions({
  async publishAdapters(env: Env): Promise<PublishAdapter[]> {
    const adapters: PublishAdapter[] = [];
    for (const plugin of (await getPlugins(env)).filter((candidate) => candidate.manifest.publishTarget)) {
      if (!plugin.secret) {
        console.error(`Plugin ${plugin.manifest.id} declares publishTarget but has no secret configured`);
        continue;
      }
      adapters.push(pluginAdapter(plugin, plugin.secret, pluginTenantId(env)));
    }
    return adapters;
  },

  async sidebarNav(env: Env): Promise<ContributedNavItem[]> {
    return pluginNav(env);
  },

  async localeCatalog(env: Env, localeCode: string): Promise<Record<string, string>> {
    const views = (await getPlugins(env))
      .filter((plugin) => plugin.manifest.i18n === true)
      .map((plugin) => plugin.fetcher);
    return pluginBundledCatalog(views, localeCode);
  },

  /**
   * A rule is honored only when the declaring plugin also owns the type's
   * blueprint, so a plugin cannot thin out pages it does not own. First
   * declaration wins on (unexpected) overlap.
   */
  async lectRules(env: Env): Promise<Record<string, PublishLectRule>> {
    const rules: Record<string, PublishLectRule> = {};
    for (const plugin of await getPlugins(env)) {
      const declared = plugin.manifest.contentTypes?.publishLect ?? {};
      const owned = plugin.manifest.contentTypes?.blueprint ?? {};
      for (const [pageType, rule] of Object.entries(declared)) {
        if (!Object.hasOwn(owned, pageType)) continue;
        if (!Object.hasOwn(rules, pageType)) rules[pageType] = rule;
      }
    }
    return rules;
  },

  async notifyPageEvent(env, user: JWTPayload | undefined, event, pages): Promise<void> {
    await deliverHooks(env, user, event, pages);
  },
});

async function pluginBundledCatalog(plugins: Fetcher[], code: string): Promise<Record<string, string>> {
  const catalogs = await Promise.all(plugins.map(async (plugin) => {
    try {
      const response = await plugin.fetch(
        `${PLUGIN_ORIGIN}${PLUGIN_PREFIX}/views/locales/${encodeURIComponent(code)}.json`,
      );
      if (!response.ok) return {};
      return flattenMessages(await response.json());
    } catch {
      return {};
    }
  }));
  return Object.assign({}, ...catalogs);
}
