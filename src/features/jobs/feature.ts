import type { CmsFeature } from '../../core/feature';
// Importing this registers the feature's implementations of core's extension
// points (queue-message handling, and the two enqueue paths). Core calls
// whatever is registered and does nothing when this feature is absent — see
// src/core/extensions.ts.
import './extensions';

/**
 * Durable background execution for admin actions that would otherwise exceed
 * one Worker invocation: long plugin actions, and bulk publish/unpublish/delete
 * over a search result set. The `admin_jobs` row is the durable record, the
 * ADMIN_JOBS_QUEUE binding is the transport.
 *
 * No navKeys and no screens — a job reports itself through the flash on the
 * page that started it.
 *
 * Dropping it makes both callers run their work inline instead: the plugin
 * proxy forwards the request synchronously, and the search screen applies one
 * bounded slice (BULK_ACTION_PAGE_LIMIT pages) per submit. Nothing fails, but a
 * bulk action over a larger set no longer finishes in one click, and a slow
 * plugin action holds the request open.
 */
export const jobsFeature: CmsFeature = {
  id: 'jobs',
};
