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
  // MUTUAL with credits, and that is a real defect rather than a design:
  // credits prices plugin-declared costs, while the /__cms API and the manage
  // screen charge and refund through the credit engine. Neither can be
  // installed without the other today. Splitting the balance ledger
  // (spend/refund/adjust, which has no plugin dependency) into core would
  // break the cycle — see the note in features/credits/service.ts.
  requires: ['credits'],
  navKeys: ['plugins'],
};
