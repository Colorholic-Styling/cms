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
import type { AppContext } from './http/context';
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

/**
 * One contributor's claim over content-type slugs, for the admin type
 * listings. Structural on purpose: core must not know what a plugin is.
 */
export interface ContentTypeContributorInfo {
  /** Display name shown in the listing's source column. */
  name: string;
  /** The slug maps this contributor declares. */
  contentTypes?: ContributedContentTypes;
}

/** A page the editor is about to create, for the create-limit check. */
export interface PageCreateCandidate {
  pageType: string;
  parentId: number | null;
  /** The submitted translation, used by per-lect limits. */
  lect?: unknown;
}

/**
 * The outcome of charging for a page create. `ok: false` carries a
 * ready-to-show message the editor adds to its validation errors; `ok: true`
 * carries the compensating action to run if the insert then fails, which is a
 * no-op for a free page type.
 */
export type PageCreateChargeResult =
  | { ok: true; refund(): Promise<void> }
  | { ok: false; error: string };

/** Data a plugin-owned editor view is rendered from. */
export interface EditViewContext {
  /** 'new' for the create form, 'edit' for an existing page. */
  mode: 'new' | 'edit';
  /** Form POST target — the CMS's existing create/update handler. */
  action: string;
  /** Where the editor's back / cancel control should return to. */
  backHref: string;
  /** Active editing language. */
  language: string;
  /** Signed-in user's CMS interface locale (added by the dispatcher). */
  uiLocale?: string;
  /** Text direction for uiLocale. */
  uiDirection?: 'ltr' | 'rtl';
  /** The page type being edited or created. */
  pageType: string;
  page: {
    /** Numeric id when editing; '' when creating. */
    id: number | string;
    name: string;
    slug: string;
    pageType: string;
    weight: number;
    start: string | null;
    end: string | null;
    timezone: string | null;
    editors: string | null;
    /** Stringified lect JSON for the current/selected version. */
    lect: string;
  };
  /** Saved versions (most-recent first), for an optional version picker. */
  versions: Array<{ id: number; created_at: string; action: string | null }>;
  /** Flash message to surface, if any. */
  flash?: string;
  /** Validation errors to surface when re-rendering after a failed save. */
  errors?: string[];
}

/** Read-only twin of EditViewContext — no form to POST, plus an edit link. */
export interface ReadViewContext {
  /** Link to the CMS editor for this page (for an optional "Edit" control). */
  editHref: string;
  /** Where the view's back / cancel control should return to. */
  backHref: string;
  /** Active display language. */
  language: string;
  /** Signed-in user's CMS interface locale (added by the dispatcher). */
  uiLocale?: string;
  /** Text direction for uiLocale. */
  uiDirection?: 'ltr' | 'rtl';
  /** The page type being viewed. */
  pageType: string;
  page: EditViewContext['page'];
  /** Saved versions (most-recent first), for an optional version picker. */
  versions: EditViewContext['versions'];
}

/**
 * An admin screen that lets another feature contribute template props — the
 * profile page and the users admin both host a credits panel they must not
 * have to import. The screen keys are the contract; a contributor that does
 * not recognise one returns nothing.
 */
export type AdminScreen =
  | { screen: 'profile' }
  | { screen: 'users' }
  | { screen: 'user'; userId: number };

/** Deep links into whoever owns CSV import/export. Empty strings hide the control. */
export interface ImportExportHrefs {
  importHref: string;
  exportHref: string;
  /** Export of the current advanced-search result set. */
  searchExportHref: string;
}

/** A permission declared outside the built-in set, for the role editor. */
export interface ContributedPermission {
  value: string;
  label: string;
}

/** How a declared cost is charged. */
export type CreditChargeKind = 'page_create' | 'metered' | 'recurring';

/** When a recurring cost bills: 'advance' charges the current usage snapshot
 *  for the coming period; 'arrears' charges the period's high-water mark once
 *  the period has elapsed. */
export type CreditBillingMode = 'advance' | 'arrears';

/**
 * A cost declared by a contributor (today, in a plugin manifest). Remote
 * input: whoever prices it validates and normalises every field, so this is
 * the wire shape, not a guarantee.
 */
export interface ContributedCreditDef {
  /** Identifier unique within the contributor, e.g. "create_guest_list". */
  key: string;
  /** Human label shown in the credits admin and the ledger. */
  label?: string;
  /** Optional longer description shown in the credits admin. */
  description?: string;
  charge: CreditChargeKind;
  /** Required when charge is 'page_create': the page type whose creation is
   *  charged. Must be one of `pricablePageTypes`. */
  page_type?: string;
  /** Display unit for metered/recurring costs (e.g. "recipient", "record");
   *  defaults to "action". */
  unit?: string;
  /** Cost in credits until an admin configures a value. Omitted or 0 = free —
   *  a freshly deployed manifest never silently starts charging. */
  default?: number;
  /** Recurring only: usage block size the price applies to. Omitted → 1. */
  per?: number;
  /** Recurring only: billing period. Only 'month' is supported. */
  period?: 'month';
  /** Recurring only: 'advance' (default) or 'arrears'. */
  billing?: CreditBillingMode;
}

/** Someone who declares priced actions. The plugin platform contributes one
 *  per installed plugin; a build without it contributes none, so everything
 *  is free. */
export interface CreditContributor {
  /** Stable id — used in the ledger and in the per-contributor price setting. */
  id: string;
  /** Display name for the credits admin. */
  name: string;
  /** Declared costs, as written. */
  credits: readonly ContributedCreditDef[];
  /** Page types this contributor may attach a page_create price to. Anything
   *  outside it is dropped, so nobody can price another's content. */
  pricablePageTypes: ReadonlySet<string>;
  /** Where an admin configures these prices, for the summary's edit links. */
  manageHref?: string;
}

/** A quota a contributor declares, resolved to its effective value. For the
 *  cross-contributor summary; whoever owns the quotas enforces them. */
export interface ContributedLimitSummary {
  contributorId: string;
  contributorLabel: string;
  key: string;
  label: string;
  description: string;
  scope: 'total' | 'per_parent' | 'per_pointer' | 'per_second';
  /** Set when scope is 'per_pointer'. */
  pointerKey?: string;
  /** null means unlimited. */
  value: number | null;
  /** Where an admin configures this quota. */
  manageHref: string;
}

/**
 * The result of charging for one or more page creates. `refund()` compensates
 * a charge whose write then failed — in full by default, or `amount` of it
 * when only some of the batch was written.
 */
export type CreditChargeOutcome =
  | { ok: true; charged: number; refund(amount?: number): Promise<void> }
  | { ok: false; reason: 'unknown_user' }
  | { ok: false; reason: 'insufficient'; required: number; balance: number; sharedBalance: number };

/** One editable price on a contributor's pricing screen. */
export interface CreditPricingRow {
  key: string;
  label: string;
  description: string;
  /** Human charge description, e.g. the page type or the metered unit. */
  chargeLabel: string;
  /** Translation key for chargeLabel. */
  chargeKey: string;
  /** Price that applies until an admin configures one. */
  defaultValue: number;
  /** Price in force now. */
  effectiveValue: number;
  /** False when effectiveValue is just the default. */
  configured: boolean;
}

/** An authenticated inbound API caller (today, a plugin Worker). */
export interface ApiCallerIdentity {
  /** The contributor id this request is authenticated as. */
  callerId: string;
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
  /**
   * A view source that resolves feature-owned Liquid templates after the CMS's
   * own assets. Core falls back to env.VIEWS, so an install without a
   * contributor reads templates straight from the bundle.
   */
  viewSource?(env: Env): Fetcher;
  /** Who else declares content types, for the admin type listings. */
  contentTypeContributors?(env: Env): Promise<ContentTypeContributorInfo[]>;
  /**
   * True when this page type is republished automatically after a save. Core
   * only ever republishes a page that is already live.
   */
  autoPublishesPageType?(env: Env, pageType: string): Promise<boolean>;
  /**
   * Per-type create limits. Resolves to a ready-to-show message when a
   * candidate is refused, or null when every candidate may be created.
   */
  checkCreateLimits?(env: Env, candidates: readonly PageCreateCandidate[]): Promise<string | null>;
  /**
   * Where the dashboard's Import/Export buttons and the advanced-search CSV
   * export point. Empty hrefs hide the controls, which is what an install
   * without the owning feature gets.
   */
  importExportHrefs?(env: Env, pageType?: string): Promise<ImportExportHrefs>;
  /**
   * Charge the signed-in user for creating `pageType`, before the row is
   * inserted. Core treats an unregistered extension as "free".
   */
  chargePageCreate?(c: AppContext, pageType: string): Promise<PageCreateChargeResult>;
  /**
   * Render the create/edit form through whoever owns this page type. Null
   * means core should render its own editor.
   */
  pageEditView?(c: AppContext, context: EditViewContext): Promise<Response | null>;
  /** As pageEditView, for the read-only view. */
  pageReadView?(c: AppContext, context: ReadViewContext): Promise<Response | null>;
  /**
   * Cron work owned by a feature, run from the Worker's scheduled handler.
   * Returns a line to log, or null when there was nothing to do.
   */
  runScheduled?(env: Env): Promise<string | null>;
  /** Extra template props for an admin screen owned by someone else. */
  adminScreenProps?(c: AppContext, target: AdminScreen): Promise<Record<string, unknown>>;
  /** Permissions declared outside the built-in set, for the role editor. */
  contributedPermissions?(env: Env): Promise<ContributedPermission[]>;
  /**
   * Everyone declaring priced actions. Whoever prices them reads this instead
   * of the platform that hosts them, so the two install independently.
   */
  creditContributors?(env: Env): Promise<CreditContributor[]>;
  /** One contributor by id, or null when it is not installed. */
  creditContributor?(env: Env, id: string): Promise<CreditContributor | null>;
  /** Declared quotas with their effective values, for the summary screen. */
  limitSummaries?(env: Env): Promise<ContributedLimitSummary[]>;
  /**
   * One contributor's declared costs and their configured prices, for a
   * pricing screen hosted by whoever manages that contributor. Unregistered
   * means nothing prices anything, so the screen should not be offered.
   */
  creditPricing?(env: Env, contributorId: string): Promise<CreditPricingRow[]>;
  /**
   * Saves prices from that screen. `submitted` is keyed by credit key, with
   * raw form values; anything unrecognised or blank is ignored (blank unsets,
   * so the default applies). Resolves with what was actually stored.
   */
  saveCreditPricing?(env: Env, contributorId: string, submitted: Record<string, string>): Promise<Record<string, number>>;
  /**
   * Charge `payerUserId` for creating these page types, before the rows are
   * written. Unregistered means every page is free.
   */
  chargePageCreates?(env: Env, input: {
    /** Page types being created, with how many of each. */
    pageTypes: ReadonlyArray<{ pageType: string; count: number }>;
    /** Who pays; null when the request has no acting user (nothing is charged). */
    payerUserId: number | null;
    /** Attributed in the ledger when a contributor acts for the user. */
    contributorId?: string;
  }): Promise<CreditChargeOutcome>;
  /**
   * Authenticate an inbound contributor API request. Returns the caller, or a
   * Response to send back verbatim when authentication fails. Unregistered
   * means the endpoint has no way to identify callers and must 404.
   */
  authenticateApiCaller?(c: AppContext): Promise<ApiCallerIdentity | Response>;
  /** The user a contributor is acting on behalf of, from the request headers. */
  actingUserId?(c: AppContext): number | null;
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
