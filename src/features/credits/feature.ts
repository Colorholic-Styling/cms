import type { CmsFeature } from '../../core/feature';
// Importing this registers the feature's implementations of core's extension
// points (page-create charging, the credits panels on the profile and users
// screens, the subscription sweep). Core calls whatever is registered and does
// nothing when this feature is not installed — see src/core/extensions.ts.
import './extensions';
import { getCreditBalances, getSharedCreditBalances } from './service';
import { userIdFromContext } from '../../core/http/forms';

/**
 * Metered billing: balances, the ledger, transfers and the shared pool. The
 * screens that host a credits panel (profile, users) belong to core and to the
 * users-roles feature; this feature contributes their props and owns the forms
 * they post to, so neither has to know credits exist.
 *
 * Dropping it from the registry removes the balances (showCredits gates the
 * markup) and takes the credits engine out of every admin route's import
 * graph — see scripts/check-boundaries.mjs.
 */
export const creditsFeature: CmsFeature = {
  id: 'credits',
  // No `requires`: priced actions arrive through core's creditContributors
  // extension rather than from the plugin platform directly, so this installs
  // alone. With nothing contributing, every action is free and the summary is
  // empty — balances, transfers and the shared pool still work.
  navKeys: ['credits'],
  async baseProps(c) {
    const [balances, shared] = await Promise.all([
      getCreditBalances(c.env, userIdFromContext(c)),
      getSharedCreditBalances(c.env),
    ]);
    const userDiamonds = balances?.diamond ?? 0;
    return {
      userCredits: balances?.credit ?? 0,
      sharedCredits: shared.credit,
      showCredits: true,
      userDiamonds,
      sharedDiamonds: shared.diamond,
      // The premium wallet only earns sidebar space once it is in play —
      // an install that prices nothing in diamonds never shows an empty row.
      showDiamonds: userDiamonds > 0 || shared.diamond > 0,
    };
  },
};
