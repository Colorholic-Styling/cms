// Cache-busting revisions for plugin-owned assets and views.
//
// The CMS stamps its own asset URLs with viewRevision() (core); a plugin's
// assets move on the plugin Worker's own deploy cycle, so they are stamped
// from whatever version the manifest reports. Lives beside the platform
// rather than in core/http so a build without plugins does not carry it.

import { cleanRevision } from '../../core/http/view-revision';
import type { PluginManifest } from './types';

/** The plugin Worker's deploy revision, from whichever field the manifest uses. */
export function pluginWorkerRevision(manifest: PluginManifest): string {
  const workerVersion = manifest.workerVersion;
  const metadata = typeof workerVersion === 'object' && workerVersion !== null
    ? workerVersion
    : manifest.cfVersionMetadata || manifest.CF_VERSION_METADATA;
  return cleanRevision(
    manifest.workerVersionId
      || manifest.worker_version_id
      || (typeof workerVersion === 'string' ? workerVersion : '')
      || metadata?.id
      || metadata?.tag
      || metadata?.timestamp
      || '',
  );
}

/** The deploy revision, falling back to the declared manifest version. */
export function pluginViewRevision(manifest: PluginManifest): string {
  return pluginWorkerRevision(manifest) || cleanRevision(manifest.version);
}
