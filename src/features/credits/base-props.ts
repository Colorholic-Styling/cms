// The credits feature's slice of the admin chrome: the two balances in the
// sidebar footer.
//
// This is the only reason the chrome ever needed utils/credits. Dropping the
// entry from src/features/contributions.ts drops the balances from the sidebar
// (showCredits gates the markup) and takes the credits engine out of every
// admin route's import graph.

import type { BasePropsContributor } from '../../core/render/contributions';
import { getCreditBalance, getSharedCreditBalance } from '../../utils/credits';
import { userIdFromContext } from '../../utils/forms';

export const creditsBaseProps: BasePropsContributor = {
  id: 'credits',
  async props(c) {
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
