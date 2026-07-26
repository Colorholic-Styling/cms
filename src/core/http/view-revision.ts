import type { Env } from '../../types';

export function viewRevision(env: Pick<Env, 'CF_VERSION_METADATA' | 'VIEW_REVISION'>): string {
  const value = env.CF_VERSION_METADATA?.id
    || env.CF_VERSION_METADATA?.tag
    || env.CF_VERSION_METADATA?.timestamp
    || env.VIEW_REVISION
    || 'dev';
  return cleanRevision(value);
}

/** Strips anything that would need escaping in a query string. Shared with the
 *  plugin platform, which stamps plugin assets from its own manifests. */
export function cleanRevision(value: unknown): string {
  return String(value || '').replace(/[^A-Za-z0-9._:-]/g, '-');
}
