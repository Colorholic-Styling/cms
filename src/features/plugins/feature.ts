import type { CmsFeature } from '../../core/feature';
// Importing this registers the platform's implementations of core's extension
// points (sidebar nav, locale catalogs, publish targets, hooks, plugin jobs).
// Core calls whatever is registered and does nothing when this feature is not
// installed — see src/core/extensions.ts.
import './extensions';

/**
 * The plugin platform: the registry, manifest resolution, hook delivery, the
 * admin proxy, the manage UI, and the /__cms write-back API.
 *
 * DROPPING THIS BREAKS INSTALLED PLUGINS. /__cms is a live contract — plugin
 * Workers call it with their own secret — so a build without this feature can
 * still serve content but cannot register plugins, proxy their admin pages,
 * deliver hooks, or accept their writes.
 */
export const pluginsFeature: CmsFeature = {
  id: 'plugins',
  // No `requires`: the platform cooperates with the credits engine through the
  // generated feature-service registry, so either installs alone. With credits
  // off, plugin-declared costs are simply never charged.
  navKeys: ['plugins'],
};
