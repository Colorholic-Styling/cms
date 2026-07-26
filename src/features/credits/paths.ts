// The admin paths this feature owns, in one place.
//
// Two modules need them and must agree: ./routes/panels.ts registers the
// handlers (mounted under /admin, so it uses the bare paths) and
// ./extensions.ts renders the form actions the browser posts to (absolute).
// A leaf module on purpose — ./extensions.ts is reached from feature.ts, which
// the admin chrome reads, so it must not import a router.

/** Registered under /admin by the feature router. */
export const PROFILE_TRANSFER_PATH = '/profile/credits/transfer';
export const PROFILE_DONATE_PATH = '/profile/credits/shared';
export const SHARED_POOL_ADJUST_PATH = '/users/shared-credits';

/** Form action for a path this feature registers. */
export function adminAction(path: string): string {
  return `/admin${path}`;
}
