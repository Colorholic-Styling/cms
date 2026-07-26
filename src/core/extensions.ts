// Extension points core offers to droppable platform features.
//
// Core used to reach into src/plugins directly — the chrome asked it for
// sidebar entries, publish asked it for extra targets, the job runner asked it
// to deliver hooks. That made the plugin platform impossible to remove: core
// would not compile without it.
//
// Now the dependency runs the other way. Core declares what it will call if
// someone provides it; a feature registers an implementation at module load.
// Nothing registered means the extension point is simply inert, which is
// exactly what a build without that feature should do.
//
// Registration happens while modules are evaluating, before any request is
// served, so a handler is always in place by the time a route runs.

import type { Env } from '../types';
import type { JWTPayload } from '../types';
import type { PublishAdapter } from './publish/adapter';
import type { PublishLectRule } from './publish/projection';

/** A sidebar entry contributed at runtime rather than declared in code. */
export interface ContributedNavItem {
  pluginId: string;
  label: string;
  href: string;
  roles?: string[];
  group?: 'settings';
  i18n: boolean;
}

/** A content-type fragment contributed at runtime. */
export interface ContributedContentTypes {
  blueprint?: Record<string, unknown[]>;
  blocks?: Record<string, unknown[]>;
  blockLists?: Record<string, string[]>;
  taxonomies?: Record<string, string>;
  taxonomyLists?: Record<string, string[]>;
}

/** Page lifecycle events core announces to whoever is listening. */
export type PageEvent = 'create' | 'submission' | 'update' | 'publish' | 'unpublish' | 'delete';

/** The subset of a page that a listener is given. */
export interface PageEventPage {
  id: number;
  uuid?: string;
  page_type?: string | null;
  name?: string;
  slug?: string;
}

export interface CoreExtensions {
  /**
   * Publish targets beyond the built-in d1/r2 adapters. The plugin platform
   * contributes one per plugin whose manifest declares `publishTarget`.
   */
  publishAdapters?(env: Env): Promise<PublishAdapter[]>;
  /** Sidebar entries to append to the ones core declares. */
  sidebarNav?(env: Env): Promise<ContributedNavItem[]>;
  /**
   * UI-string catalogs merged *under* the core ones, so a contributed string
   * never overrides a CMS string or a database override.
   */
  localeCatalog?(env: Env, localeCode: string): Promise<Record<string, string>>;
  /**
   * Content-type fragments merged between the compiled base config and the
   * database layer, so a database page type still overrides a contributed one.
   */
  contentTypes?(env: Env): Promise<ContributedContentTypes[]>;
  /** Per-page-type rules for what survives publication. */
  lectRules?(env: Env): Promise<Record<string, PublishLectRule>>;
  /** Announce a page lifecycle event. Must never throw or block the response. */
  notifyPageEvent?(env: Env, user: JWTPayload | undefined, event: PageEvent, pages: PageEventPage[]): Promise<void>;
  /**
   * Perform a queued `plugin_admin_action` job: forward the recorded request
   * to the plugin that owns it. Resolves with the response status and any
   * Location header; throws to fail the job.
   */
  runPluginAction?(env: Env, job: PluginActionJob): Promise<{ status: number; location: string | null }>;
}

/** The recorded request a `plugin_admin_action` job replays. */
export interface PluginActionJob {
  pluginId: string;
  method: string;
  path: string;
  contentType: string | null;
  body: string | null;
  user: { sub: string | number; email: string; name: string; role: string };
}

let registered: CoreExtensions = {};

/**
 * Called once at module load by whichever feature provides these. Merging
 * rather than replacing lets more than one feature contribute.
 */
export function registerCoreExtensions(extensions: CoreExtensions): void {
  registered = { ...registered, ...extensions };
}

/** The currently registered extensions; empty when no feature provides them. */
export function coreExtensions(): Readonly<CoreExtensions> {
  return registered;
}

/** Test seam: drops every registration. */
export function resetCoreExtensions(): void {
  registered = {};
}
