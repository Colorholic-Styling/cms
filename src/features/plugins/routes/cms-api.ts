// The /__cms write-back API, surfaced as a feature router.
//
// It mounts at its own prefix outside the admin stack: callers are plugin
// Workers authenticating with a per-plugin secret, not signed-in browsers.

export { cmsApiRoutes as pluginApiRoutes } from '../api';
export { cmsTenantRoutes as pluginTenantRoutes } from '../api/tenant';

/** Mounted at this prefix by src/index.ts rather than under /admin. */
export const basePath = '/__cms';
