// The plugin platform's implementations of core's extension points.
//
// Importing this module registers them; core calls whatever is registered and
// does nothing when the platform is absent.

import { registerCoreExtensions } from '../core/extensions';
import type { PublishAdapter } from '../core/publish/adapter';
import type { Env } from '../types';
import { getPlugins } from './registry';
import { pluginTenantId } from './proxy';
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
});
