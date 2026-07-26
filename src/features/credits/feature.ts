import type { CmsFeature } from '../../core/feature';
import { getCreditBalance, getSharedCreditBalance } from './service';
import { userIdFromContext } from '../../core/http/forms';

/**
 * Metered billing. The admin screens still live in routes/admin (users,
 * profile, settings) because they are interleaved with non-credit handlers;
 * what this manifest owns is the pair of balances in the sidebar footer and
 * the Credit Summary nav entry.
 *
 * Dropping it from the registry removes the balances (showCredits gates the
 * markup) and takes the credits engine out of every admin route's import
 * graph — see scripts/check-boundaries.mjs.
 */
export const creditsFeature: CmsFeature = {
  id: 'credits',
  navKeys: ['credits'],
  async baseProps(c) {
    const [userCredits, sharedCredits] = await Promise.all([
      getCreditBalance(c.env, userIdFromContext(c)),
      getSharedCreditBalance(c.env),
    ]);
    return {
      userCredits: userCredits ?? 0,
      sharedCredits,
      showCredits: true,
    };
  },
};
