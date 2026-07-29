# worker-cms
Content management system on Workers

## Features

- **OAuth 2.1** login via Eventuai, GitHub, Google, Microsoft, or Apple with PKCE (Proof Key for Code Exchange); Apple ID tokens are signature- and nonce-verified
- **Dual JWT** security – short-lived access tokens (15 min) + rotatable refresh tokens (7 days) stored as httpOnly cookies; refresh tokens are hashed and stored in D1 for revocation
- **Capability-based access** – routes enforce granular permissions resolved from built-in or custom roles; delegated user/role managers cannot grant authority they do not already hold
- **Separated D1 content stores** – the CMS database keeps auth, sessions, draft, trash, taxonomy, and media metadata; the published database keeps only live content for public reads
- **Page versioning** – every save creates a new `page_versions` row; `draft_pages.current_page_version_id` points to the active version
- **Private R2 media uploads** – picture fields upload to a private R2 bucket and are served back through the Worker at `/media/...`
- **Tailwind CSS + VanillaJS** admin UI with inline HTML toolbar for content editing
- **Plugins** – extend the CMS with separate Worker plugins (lifecycle hooks, content types, fields/blocks, admin pages, publish targets). See [Plugins](#plugins).
- **Pluggable publish targets** – publishing fans out to one or more adapters: the published D1 database (default), static JSON in an R2 bucket, or any plugin Worker (IPFS, webhooks, search indexes). See [Publish targets](#publish-targets).
- **Credits & diamonds** – two independent per-user currencies that meter chargeable plugin actions; atomic, overdraft-proof, ledger-audited, each with admin grants, user-to-user transfers, and a shared site-wide pool that covers users who run out. See [Credits](#credits).

---

## Quick start

### 1. Install dependencies

```bash
npm install
```

### 2. Create the D1 databases

```bash
npx wrangler d1 create cms
npx wrangler d1 create cms-published
```

Copy the `database_id` values printed by the commands into `wrangler.toml`:

- `cms` -> `DB`
- `cms-published` -> `PUBLISHED_DB`

`DB` is the private CMS/admin database. It stores users, sessions, drafts,
trash, taxonomy, page versions, and media metadata.

`PUBLISHED_DB` is the published-content database. It stores the `live_pages`
and `live_page_tags` rows used by public readers. A separate public Worker can
be deployed with only this binding, so it has no access to CMS users, sessions,
drafts, or trash.

For an existing deployment, keep the existing `DB` binding and create the new
`PUBLISHED_DB`. Existing rows from old `live_*` tables are not moved
automatically; publish pages again or copy the current `live_pages` and
`live_page_tags` rows into `cms-published`. Older deployed CMS databases may
still contain legacy `live_*` tables, but CMS routes ignore them after this
change.

### 3. Run migrations

```bash
npx wrangler d1 migrations apply cms
npx wrangler d1 migrations apply cms-published
```

For local development, the checked-in script applies both local databases:

```bash
npm run db:migrate
```

For production, add `--remote` to each `wrangler d1 migrations apply` command.

The `cms` migrations create auth tables plus draft, trash, taxonomy,
versioning, media tables, and (with the `jobs` feature installed) the
`admin_jobs` table for durable background admin actions such as long plugin
duplicate/delete requests. The
`cms-published` migrations create only the published `live_*` content tables.
They do not automatically import rows from other D1 databases.

The baseline migrations are generated from the `schema.sql` fragments beside
the code they belong to — edit those, not `migrations/*.sql`, and run
`npm run build:migrations`. See [Feature profiles](#feature-profiles) for
choosing which features a deployment installs.

### 4. Create and bind the private R2 media bucket

Picture fields upload files to the `MEDIA_BUCKET` R2 binding. R2 buckets are not public by default; this CMS keeps the bucket private and serves objects through the Worker at `/media/<key>`.

Create the bucket:

```bash
npx wrangler r2 bucket create worker-cms-media
```

Bind it in `wrangler.toml`:

```toml
[[r2_buckets]]
binding = "MEDIA_BUCKET"
bucket_name = "worker-cms-media"
```

The checked-in `wrangler.toml` already contains this binding. If you choose another bucket name, update both the create command and `bucket_name`.

If uploads return a Cloudflare challenge page such as `Just a moment... Enable JavaScript and cookies to continue`, create a narrow Cloudflare skip rule for the authenticated upload endpoint. The Worker still requires a valid CMS session and editor role before writing to R2.

In the Cloudflare dashboard:

1. Go to **Security rules** or **Security > WAF > Custom rules**.
2. Create a custom rule named `Skip CMS upload challenge`.
3. Use this expression:
   ```text
(http.host eq "cms.eventuai.com" and http.request.uri.path eq "/admin/upload" and http.request.method eq "POST")
   ```
4. Set **Action** to **Skip**.
5. Select the product that appears in **Security > Events** for the failed upload, commonly **All managed rules**, **All Super Bot Fight Mode rules**, **Browser Integrity Check**, or **Security Level**.
6. Save the rule and retry the upload.

Cloudflare Bot Fight Mode on the Free plan cannot be skipped by a custom rule. If Security Events shows Bot Fight Mode, disable Bot Fight Mode for the zone or move to Super Bot Fight Mode/Bot Management so this endpoint can be exempted.

The page editor uses a Worker-owned preview route for picture field thumbnails:

```text
/media-preview/<key>
```

In production, `/media-preview/<key>` fetches the private R2-backed `/media/<key>` URL with Cloudflare Image Resizing options:

```ts
cf: { image: { width: 100, height: 100, fit: 'cover' } }
```

Enable **Images > Transformations** for the zone before relying on this optimization. If transformations are not enabled, the route falls back to the original `/media/<key>` object for preview display.

### 5. Configure secrets

```bash
# Random 32-byte secret for signing JWTs – e.g. openssl rand -hex 32
npx wrangler secret put JWT_SECRET
```

Then add a secret for each provider you enable (see step 6).

Create a `.dev.vars` file for local development (see `.dev.vars.example`).

### 6. Enable OAuth providers

Set `ENABLED_PROVIDERS` in `wrangler.toml` to a comma-separated list of the
providers you want to offer on the login page:

```toml
ENABLED_PROVIDERS = "eventuai,github,google,microsoft,apple"
```

Users will see one sign-in button per listed provider, in that order.
Add the Client ID and secret for every provider you enable.

To link an additional OAuth provider to the same CMS account, sign in first,
then start that provider's flow from the profile page (or use
`/auth/start?provider=google&link=1`).
The callback attaches the new provider identity to the current user; it will
not silently merge logged-out accounts just because their emails match.

#### Eventuai (self-hosted OAuth worker)

1. Register the CMS as a client on your OAuth worker — see the OAuth worker README for the `POST /admin/setup-clients` call.
2. Copy the generated `clientId` into `wrangler.toml`:
   ```toml
   EVENTUAI_CLIENT_ID = "<client-id>"
   ```
3. Store the matching secret:
   ```bash
   npx wrangler secret put EVENTUAI_CLIENT_SECRET
   ```

#### GitHub

1. Go to **GitHub → Settings → Developer settings → OAuth Apps → New OAuth App**.
2. Set **Authorization callback URL** to your `OAUTH_REDIRECT_URI` (e.g. `https://cms.example.com/auth/callback`).
3. Copy the **Client ID** into `wrangler.toml`:
   ```toml
   GITHUB_CLIENT_ID = "<client-id>"
   ```
4. Generate a **Client Secret** and store it:
   ```bash
   npx wrangler secret put GITHUB_CLIENT_SECRET
   ```

#### Google

1. Open [Google Cloud Console](https://console.cloud.google.com/) → **APIs & Services → Credentials**.
2. Click **Create Credentials → OAuth 2.0 Client ID** (type: *Web application*).
3. Add your `OAUTH_REDIRECT_URI` as an authorised redirect URI.
4. Copy the **Client ID** into `wrangler.toml`:
   ```toml
   GOOGLE_CLIENT_ID = "<client-id>"
   ```
5. Store the **Client Secret**:
   ```bash
   npx wrangler secret put GOOGLE_CLIENT_SECRET
   ```

#### Microsoft

1. Open **Microsoft Entra admin center → App registrations → New registration**.
2. Add your `OAUTH_REDIRECT_URI` as a web redirect URI.
3. Copy the **Application (client) ID** into `wrangler.toml`:
   ```toml
   MICROSOFT_CLIENT_ID = "<client-id>"
   ```
4. Optionally set `MICROSOFT_TENANT` to `common`, `organizations`, `consumers`, or a tenant ID/domain. It defaults to `common`.
5. Store the client secret:
   ```bash
   npx wrangler secret put MICROSOFT_CLIENT_SECRET
   ```

#### Apple

1. In Apple Developer, configure **Sign in with Apple** for your Services ID.
2. Add your `OAUTH_REDIRECT_URI` as a return URL.
3. Copy the Services ID into `wrangler.toml`:
   ```toml
   APPLE_CLIENT_ID = "<services-id>"
   ```
4. Generate an Apple client-secret JWT for that Services ID and store it:
   ```bash
   npx wrangler secret put APPLE_CLIENT_SECRET
   ```

> **Note:** GitHub and Google users have their role defaulted from the database.
> Promote accounts to `admin` / `editor` with the SQL command in step 7.

### 7. Set the first user's role

After signing in for the first time, update your role to `admin` in the CMS database. Multiple roles can be stored as a comma-separated list, for example `admin,viewer`:

```bash
npx wrangler d1 execute cms --remote \
  --command "UPDATE users SET role='admin,viewer' WHERE email='you@example.com'"
```

### 8. Run locally

```bash
npm run dev
```

Visit **http://localhost:8787** → redirects to the login page.

### 9. Deploy

```bash
npm run deploy
```

---

## Plugins

The CMS can be extended with **plugins**, each of which is a separate Cloudflare
Worker registered at runtime by HTTPS URL. Registration, enable/disable,
credential rotation, delegated page-type scopes, assets, quotas, and credits are
managed under **Admin → Plugins** without redeploying the CMS.
A plugin can add six things:

- **Lifecycle hooks** – run on page `create`/`update`/`publish`/`unpublish`/`delete`
  plus `submission` when a live-only page is mirrored into draft (webhooks,
  external search indexing, cache purge, notifications). Hooks are best-effort
  and never block the editor.
- **Content types** – register new `blueprint`/`blocks`/`blockLists`/`taxonomies`/`taxonomyLists`
  that merge into the editor's config. Plugin-contributed page types, block
  types, and taxonomies appear (read-only) in **Admin → Page Types / Block Types / Taxonomies**, badged with
  the contributing plugin's name. A companion plugin can also request delegated
  access with `readTypes`/`writeTypes` to use existing page types through the
  `/__cms` API without contributing their blueprints; an admin must approve
  those delegated scopes in plugin management before they are honored. Use `"*"`
  in `readTypes` or `writeTypes` to request access to all concrete page types.
- **Fields & blocks** – register new pagefield types and serve their Liquid
  snippets, which render through the CMS editor.
- **Edit, create & read views** – list page-type slugs in the manifest
  `editViews`, `newViews` (and/or `readViews`) to render the *whole* edit form,
  create form, or read-only view for those types yourself, instead of the
  built-in structured editor.
  See [Plugin edit views](#plugin-edit-views).
- **Admin routes + nav** – add an admin page (proxied at
  `/admin/plugins/<id>/...`) and a navigation entry. A nav item may set
  `group: 'settings'` to nest under the sidebar's **Settings** group instead of
  the top level; `roles` restricts who sees it.
- **Publish targets** – declare `publishTarget: true` in the manifest to receive
  full page snapshots whenever a page is published or unpublished (pin to IPFS,
  push to a search index, trigger a static-site rebuild). Unlike hooks, publish
  calls are awaited and failures surface in the editor. See
  [Publish targets](#publish-targets).

With no plugins registered, the system is inert and adds no plugin traffic.

### Localized Liquid views

Core and plugin Liquid views share the CMS translation catalog. Use a namespaced
key and escape the translated text at its output context:

```liquid
{{ "plugin.events.guest_list" | t | escape }}
```

Bundled defaults live in `views/locales/<locale>.json`. Administrators can add
supported content/UI locales and override or extend keys at **Settings →
Languages → Translations**; database values win over bundled JSON. Missing keys
fall back through the locale's configured fallback, then English, then render as
the key itself. Plugin keys should use `plugin.<plugin-id>.*` to avoid collisions.

The `language` value used by content remains separate from the signed-in user's
`uiLocale`. `mis` is the protected default content language meaning “language
unspecified” and cannot be enabled as a UI locale. Liquid views can also use
`l10n_number` and `l10n_date`; `uiLocale` and `uiDirection` are available as
render globals for locale-aware plugin behavior.

### How it works

Each plugin Worker implements a small HTTP contract under the reserved
`/__plugin` prefix (`/manifest`, `/views/*`, `/admin/*`, `/edit`, `/hooks/<event>`).
The CMS discovers enabled plugins from its `plugins` table, fetches and validates
their manifests (including a 256 KiB response limit), forwards the signed-in user
plus that plugin's dedicated secret on outbound calls, and merges approved
contributions into the editor. The reverse `/__cms` API requires `x-plugin-id`
and the matching plugin row's own `x-plugin-secret`; the legacy environment
`PLUGIN_SECRET` is never accepted for inbound authentication.

### Plugin edit views

By default every page is edited and created through the built-in structured
editor. A plugin can take over the whole edit form, create/new form, or both for
the page types it owns by listing their slugs in the manifest:

```js
const MANIFEST = {
  id: 'events',
  // …
  contentTypes: { blueprint: { event: ['@date', 'venue'] } },
  editViews: ['event'],
  newViews: ['event'],
};
```

For a page of one of those types the CMS `POST`s the editor context to the
plugin's `/__plugin/edit` endpoint (JSON body + `x-plugin-secret` + `x-cms-user`).
`editViews` owns existing-page edit forms; `newViews` owns create forms. Existing
plugins that only declare `editViews` continue to own both edit and create forms
for backwards compatibility.

```jsonc
{
  "mode": "edit",                 // or "new"
  "action": "/admin/pages/42",    // where the plugin's <form> must POST back
  "backHref": "/admin",
  "language": "en",
  "uiLocale": "zh-hant",        // CMS controls; separate from content language
  "uiDirection": "ltr",
  "pageType": "event",
  "page": { "id": 42, "name": "…", "slug": "…", "weight": 5,
            "start": null, "end": null, "timezone": "+0800",
            "editors": null, "lect": "{…stringified lect JSON…}" },
  "versions": [{ "id": 9, "created_at": "…", "action": "update" }],
  "flash": "…", "errors": ["…"]
}
```

The plugin returns an **HTML fragment** with `x-cms-chrome: 1` (and optionally a
percent-encoded `x-cms-title`); the CMS wraps it in the standard admin chrome and
serves it under the CMS origin. The fragment's `<form>` posts back to `action`
using the normal CMS field-name conventions (`@attr`, `.field|<lang>`, `*pointer`,
plus `name`/`slug`/`weight`/`page_type`/`action`), so save, versioning, and
publish all flow through the CMS's existing handler unchanged. Returning `404`
(or any error / non-HTML response) makes the CMS fall back to the built-in editor,
so a half-built plugin can never lock an editor out of a page. Like proxied admin
pages, the wrapped fragment runs under the CMS's strict nonce CSP — contribute
any field markup through Liquid snippets / view files rather than inline scripts.

To bypass a plugin edit view and use the built-in structured editor for a single
page, append **`?native=1`** (or `?editor=cms`) to the edit URL, e.g.
`/admin/pages/42/edit?native=1`. The flag is carried through the editor's form
action and post-save redirect, so it survives validation errors and reloads.

#### Read views

Every page also has a built-in **read-only view** at `/admin/pages/<id>/read`
(the eye icon on the dashboard, or *View* in the editor header): the same
structured content rendered as static text instead of inputs. A plugin can take
over that view for the page types it owns exactly like the edit view — list the
slugs under `readViews` (independent of `editViews`; a plugin may own the edit
view, the read view, both, or neither):

```js
const MANIFEST = {
  id: 'events',
  // …
  editViews: ['event'],
  newViews: ['event'],
  readViews: ['event'],
};
```

For a page of one of those types the CMS `POST`s a read context to the plugin's
`/__plugin/read` endpoint (JSON body + `x-plugin-secret` + `x-cms-user`). It
mirrors the edit context but omits the form-submission fields (`mode`, `action`,
`flash`, `errors`) and adds `editHref` — a link back to the CMS editor:

```jsonc
{
  "editHref": "/admin/pages/42/edit",
  "backHref": "/admin",
  "language": "en",
  "pageType": "event",
  "page": { "id": 42, "name": "…", "slug": "…", "weight": 5,
            "start": null, "end": null, "timezone": "+0800",
            "editors": null, "lect": "{…stringified lect JSON…}" },
  "versions": [{ "id": 9, "created_at": "…", "action": "update" }]
}
```

The plugin returns an **HTML fragment** with `x-cms-chrome: 1` (and optionally a
percent-encoded `x-cms-title`), wrapped in the standard admin chrome under the
strict nonce CSP — just like the edit view. Returning `404` (or any error /
non-HTML response) falls back to the built-in read view, and `?native=1`
(or `?editor=cms`) forces it, so a half-built plugin can never hide a page.

Admin responses are `X-Frame-Options: DENY` by default. A plugin **full-document**
admin response (no `x-cms-chrome`) may opt into being shown in a same-origin
`<iframe>` by setting `x-cms-frame: 1`; the proxy translates it to
`X-Frame-Options: SAMEORIGIN` with `frame-ancestors 'self'` (e.g. an EDM editor
embedding its own email preview). It is same-origin only — the response is still
served on the CMS origin.

### Adding a plugin

1. Build/deploy the plugin Worker (see [`examples/plugin-events`](examples/plugin-events)
   for a complete reference implementing all six capabilities).
2. Open **Admin → Plugins → Register plugin**, enter its public HTTPS base URL,
   and leave it disabled until you have reviewed its manifest and code.
3. Copy the generated dedicated secret from the plugin edit screen and store it
   on the plugin Worker with `wrangler secret put PLUGIN_SECRET`.
4. Enable the plugin and explicitly approve only the assets and delegated
   `readTypes`/`writeTypes` it needs.

> **Trust boundary:** plugin Workers receive scoped content and signed-in user
> context. Approved plugin JavaScript and proxied plugin pages execute on the
> CMS origin, so an enabled plugin is trusted application code, not a sandboxed
> third party. Review its source, pin approved asset hashes, grant least
> privilege, and rotate/revoke its dedicated secret if compromised.

### Automatic tenant registration

A multi-tenant plugin Worker serves several CMS hosts and keeps one
`tenant:<cms origin>` record per host in its own `TENANTS` KV namespace, holding
that pair's secret. Steps 3 above (copy the secret by hand) becomes a button
when the plugin's manifest declares `"autoTenant": true`: **Admin → Plugins →
(plugin) → Connect plugin**. Rotating the secret re-pushes it automatically.

The handshake never puts the secret on an unauthenticated wire, and never lets a
caller talk this CMS into registering someone else:

1. The CMS mints a single-use ticket (256-bit, 5-minute TTL), stores only its
   SHA-256 in `settings`, and POSTs `{tenant, plugin_id, ticket}` to the
   plugin's `/__plugin/tenants/enroll`. **No secret in this request.**
2. The plugin redeems the ticket by calling `POST {tenant}/__cms/tenant/claim`
   — dialing the named origin *itself*, so a request that lies about which CMS
   it is can never be redeemed. Only this response carries the secret.
3. The CMS destroys the ticket (compare-and-delete, so a wrong guess cannot burn
   a pending enrollment and two racing claims cannot both win) and audits the
   outcome as `plugin.tenant.connect`.

Requirements: `CANONICAL_ORIGIN` must be set — it is both the tenant id and the
origin the plugin verifies against — and the plugin must have a dedicated
secret. **Disconnect** asks the plugin to drop this CMS's record, authenticated
with the pairwise secret, so it can only ever remove its own row.

### Plugin write-back authentication

Server-to-server calls from a plugin to `/__cms/*` must send:

```http
x-plugin-id: events
x-plugin-secret: <that plugin's dedicated secret>
```

Owned blueprint types are writable. Manifest `readTypes` and `writeTypes` stay
inert until an administrator approves them, including wildcard `"*"` requests.
Responses under `/__cms` use `Cache-Control: no-store`. Existing plugin rows
whose `secret` is `NULL` must be rotated in the admin before they can call this
API; they fail closed with `503 plugin_api_unavailable`.

---

## Security model and release checklist

- Keep `JWT_SECRET` and OAuth client secrets in Cloudflare secrets (or
  `.dev.vars` locally), never in `wrangler.toml` or source control. Cloudflare
  account, zone, route, D1, R2, and OAuth client IDs are identifiers, not bearer
  credentials.
- Set `CANONICAL_ORIGIN` and use HTTPS. Configure `ALLOWED_EMAIL_DOMAINS` when
  the CMS is not intended to allow open viewer registration.
- Access JWTs are intentionally short-lived (15 minutes). Refresh sessions can
  be revoked immediately, but an already-issued access token can retain its
  embedded role until it expires; use a shorter TTL or a per-request session /
  authorization-version check for deployments that require immediate demotion.
- Plugin URL validation rejects obvious private-address literals, but it is not
  a complete DNS-rebinding defense. Only users with `plugin:manage` should
  register audited plugin origins.
- Run `npm test`, `npm run type-check`, and `npm audit` before release. The July
  2026 security review covered OAuth, sessions, RBAC, cross-origin mutations,
  plugins, uploads/media, rendering/CSP, structured JSON, publishing, and
  dependencies; it is not a substitute for an independent penetration test.

---

## Credits

Some actions cost **credits**, a per-user balance the host meters and charges.
Plugins declare their chargeable actions in the manifest (`credits`); an admin
sets prices under **Plugins → Credits**. `page_create` costs are charged
automatically by the host every time a page of that type is created (both the
`/__cms` write-back API and the built-in editor); `metered` costs are reported
by the plugin via `POST /__cms/credits/charge`. Charging is atomic and
overdraft-proof — a balance can never go below zero — and every change is
appended to the `credit_ledger` audit trail shown on the profile page.

**Managing balances (admin).** From **Users → _(a user)_ → Credits**, an admin
grants or deducts credits with a mandatory note. Deductions use the same
overdraft guard as spends.

**Transferring credits (any admin-area user).** From your own **Profile →
Credits**, you can send credits to another user by email. The move is atomic
and overdraft-guarded, and writes a paired ledger row on each side
(`transfer:send` / `transfer:receive`). Two rules apply: you cannot send to
yourself, and you cannot send to an administrator — admins manage credits
through the users admin above rather than by receiving transfers.

**Shared pool.** Besides per-user balances each currency has one site-wide
pool (`shared_credits`) with its own append-only ledger — it belongs to all users.
When a charged action costs more than the acting user's own balance, the pool
pays the **full** amount instead (all-or-nothing per pool, never split),
recorded in the shared ledger with that user as beneficiary; a spend fails
with 402 only when neither balance covers it. Credits flow **into** the pool
two ways: any user can donate their own credits from their **Profile**
(`shared:donate`, paired rows on both ledgers), and admins top it up — or
claw it back, note required — from the **Users** admin. Credits flow **out**
only through the automatic fallback above or through the privileged grant:
holders of the `credits:share` permission ("Transfer shared credits to a
user") get a **Grant from shared pool** form on a user's edit page that moves
pool credits into that user's balance (`shared:send` / `shared:receive`) —
users can never pull pool credits into their own account themselves. Admins
always hold the permission, and it can be granted to any custom role under
**Roles**.

### Currencies: credits and diamonds

There are two wallets, and they never convert into one another:

| Currency | Balance | Shared pool | For |
|---|---|---|---|
| `credit` | `credit_wallets` row | `shared_credits` row | ordinary metered actions — page creates, EDM sends |
| `diamond` | `credit_wallets` row | `shared_credits` row | premium actions the operator pays real money for — SMS and WhatsApp delivery |

A cost picks its wallet in the manifest with `"currency": "diamond"`; omitting
the field means credits, so every existing manifest keeps its meaning. An
unrecognised currency **drops** the cost rather than defaulting, so a typo can
never silently bill the wrong wallet.

Everything else is per currency and symmetric: balances, the shared pool and
its fallback, transfers, donations, admin adjustments, the ledger (each row
carries its `currency`), and recurring subscriptions (billed in whatever
currency the cost declares at sweep time). A diamond charge is refused when
the diamond balance and the diamond pool are both short — however many credits
the payer holds, and vice versa. The plugin API reports which wallet fell
short: a 402 carries `credit.currency`, so a plugin can say "buy diamonds"
rather than "buy credits". A single page type priced by two plugins in two
currencies costs both at once, all-or-nothing: if the second wallet is short,
the first is refunded before the create is refused.

The supported currency catalog lives in
`src/features/credits/currencies.ts`. The profile, user edit screen, users
admin and sidebar all render contributed wallet arrays. Balances and shared
pools are keyed by currency rows, so adding another currency needs only a
catalog entry, translations, and optional styling — no core TypeScript or SQL
change.

**Upgrading an existing database.** Fresh installs get the row-based wallet
schema from the generated baseline. A database that already applied the old
baseline must first add the diamond ledger shape if it has not already done
so, then copy both legacy user columns into `credit_wallets`:

```bash
wrangler d1 execute cms --remote --file migrations/upgrades/diamond-currency.sql
wrangler d1 execute cms --remote --file migrations/upgrades/credit-wallets.sql
```

If `diamond-currency.sql` was applied previously, run only
`credit-wallets.sql`. Run the wallet migration before deploying the Worker
that reads `credit_wallets`. These are not wrangler migrations (nothing under
`migrations/upgrades/` is applied automatically) and are not idempotent — run
each required script once per database. Legacy balance columns remain unused
on upgraded databases; fresh databases do not create them.

---

## Database schema

The flattened initial migrations create **31 application
D1 tables**: 29 in the private CMS database and 2 in the published database.
Live page editing also uses 2 SQLite tables inside each page's Durable Object;
these are not D1 tables.

The counts below exclude D1/SQLite internal tables and Durable Object storage.
The migration history was flattened into one initial file per D1 database in
July 2026. These baselines are intended for fresh databases. Before deploying
the flattened history over an existing installation, ensure every migration
from the previous history through `0016_i18n.sql` (and published migration
`0003_submission_scan_index.sql`) and `0002_credit_subscriptions.sql` has
already been applied; Wrangler will not re-run a modified `0001` that the
database has previously recorded.

An upgraded deployment may show additional legacy `live_*` tables in `DB`;
current CMS routes ignore those tables and use `PUBLISHED_DB` instead.

### Feature profiles

`cms.features.json` is the single switch per feature. Editing it and running
`npm run build` regenerates two things: the code registries a feature is
mounted through, and the schema its tables come from.

**Code.** `tools/build-features.mjs` writes `src/generated/` from
the profile, discovering each slice by convention (`feature.ts` exports one
`CmsFeature`; `routes.ts` / `routes/*.ts` export `*Routes`). Because those
generated files are the only thing importing a slice, dropping a feature takes
its modules out of the bundle.

**Schema.** Each feature keeps its SQL fragment next to its code —
`src/features/trash/schema.sql`, `src/features/plugins/schema.sql`, and so on —
and `tools/build-migrations.mjs` concatenates the enabled ones into the flat
files Wrangler applies:

```
src/core/schema.sql + every enabled fragment  →  migrations/0001_initial_schema.sql
src/core/publish/schema.sql                   →  migrations/published/0001_published_schema.sql
```

This exists because Wrangler allows exactly one `migrations_dir` per D1
database and has no CLI override — features cannot each own a folder that
Wrangler walks. It does **not** need extra databases: every feature shares the
same two, owning tables rather than databases.

A feature may own code, tables, or both. Ten are switchable:

| Feature | Owns |
|---|---|
| `plugins` | The plugin platform: registry, hooks, proxy, manage UI, `/__cms` API — plus `plugins`, `plugin_asset_approvals`, `plugin_page_type_approvals` (+3 indexes) |
| `credits` | Metered billing (credits and diamonds) and the credit summary screen — plus `credit_ledger`, `shared_credits`, `shared_credit_ledger`, `credit_subscriptions` (+4 indexes) |
| `search` | The advanced-search screen and bulk actions (code only; the query builder is core) |
| `users-roles` | The user and role admin screens (code only; the tables and permission resolver are core) |
| `i18n` | The languages and translations screens (code only; see the note below) |
| `trash` | `trash_pages`, `trash_page_tags`, `trash_page_versions` (+2 indexes, 2 triggers) |
| `runtime-content-types` | `page_types`, `block_types` (+1 trigger) |
| `media` | R2 uploads, `/media` delivery, the Files browser — plus `media_files` |
| `plugin-pointer-indexes` | the 4 `idx_draft_pages_pointer_*` expression indexes (requires `plugins`) — schema only, in its own slice directory |
| `jobs` | Durable background execution for long plugin actions and bulk page actions — the queue consumer, the runner, plus `admin_jobs` (+2 indexes) |

After editing `cms.features.json`:

```bash
npm run build
```

No code feature depends directly on another. Feature-owned runtime behavior is
composed through `src/features/services.ts`, whose concrete entries are
generated from `cms.features.json` just like `src/features/routers.ts`.
Contracts stay with their owning feature; callers use a local structural view
of a named service operation. An absent service is inert — pages are free
without `credits`, the Import/Export buttons disappear without the
import-export plugin, and the role editor lists only built-in permissions
without `plugins`. Core-wide platform hooks still use
`src/core/extensions.ts`. `feature.ts` supports `requires` for a genuine
dependency, validated by `assertFeatureRegistry` at startup; today none
declares one.

`npm run check:boundaries` enforces this. Nothing outside `src/features/` may
import a feature — not `src/core/`, not `src/routes/`, not `src/templates/`,
not `src/index.ts` — and no feature may import a sibling it has not declared.
Type-only imports count, because `tsc` fails on those too: an `import type`
reaching into a feature is exactly how a feature stays undroppable while
looking clean.

A fragment is any `src/**/schema.sql` (or `*.schema.sql`) declaring
`-- feature: <id>` in its header — the id, not the path, is what
`cms.features.json` switches on. A fragment also declares its dependencies as
`-- requires: <ids>`; the assembler orders fragments accordingly and refuses a
profile that enables a feature whose dependency is off.

**Turning a feature off never drops tables.** It only stops creating them on
fresh installs, so existing data is never at risk. Conversely, a database that
already applied the baseline will not pick up a newly enabled feature from a
regenerated baseline — D1 tracks migrations by filename, so a rewritten `0001`
is skipped. Emit an additive migration instead:

```bash
npm run build:migrations -- --enable credits
```

That writes `migrations/000N_enable_credits.sql` from the same fragment. The
fragments are idempotent (`CREATE ... IF NOT EXISTS`, `INSERT OR IGNORE`), so
applying it to a database that already has the tables is a no-op.

Because all features share one `d1_migrations` table, **migration filenames
must be globally unique** — a second `0002_add_index.sql` from a different
feature would be silently treated as already applied. Prefix migration files
with the feature id.

`npm run check:profiles` executes every profile against an in-memory SQLite and
verifies each feature is removable without breaking the rest; it runs as part
of `npm test`.

`locales` and `locale_messages` are **core**, not a fragment: the admin chrome
resolves the viewer's locale on every render, so the CMS cannot serve a page
without them. The optional part is the `i18n` *code* feature — the screens for
editing locales and translations. Serving the UI's own catalog
(`GET /admin/i18n/catalog/:locale`) stays core too.

The credits fragment owns `credit_wallets`, both ledgers, shared pools, and
subscriptions. Disabling the feature therefore leaves no credit-specific
objects in a fresh core-only database.

#### Deleting a feature's source

Switching a feature off keeps its code in the tree (out of the bundle, but
still there to read and audit). To remove it outright, delete the directory
**and** its key in `cms.features.json` — with the key still listed,
`build:migrations` refuses the build rather than silently treating the feature
as schema-only:

```bash
rm -rf src/features/trash
```

Then drop `"trash"` from `cms.features.json` and run `npm run build`. Every
switchable feature now has a directory to delete, so this works for all of
them. One detail: `plugin-pointer-indexes` declares `-- requires: plugins`, so
dropping the platform means dropping that slice in the same edit.

A key listed with no directory *and* no schema fragment fails the build rather
than being treated as a code-free feature — that is deliberate, because a
silently ignored key is how a table goes missing.

What deletion does not clean up: the feature's `views/sections/*.liquid` (the
whole `views/` directory ships as Worker assets regardless of profile) and its
`test/*.test.ts`. Remove those by hand.

### CMS database (`DB`) — 28 tables

The private schema is divided into five feature categories:

- **Content (13)**
  - Page lifecycle: `draft_pages`, `page_versions`, `trash_pages`, `trash_page_versions`
  - Classification: `taxonomies`, `tags`, `draft_page_tags`, `trash_page_tags`
  - Content model and media: `page_types`, `block_types`, `media_files`
  - Localization: `locales`, `locale_messages`
- **Identity and access (5)**
  - `users`, `user_oauth_identities`, `sessions`, `roles`, `role_permissions`
- **Credits (4)**
  - `credit_ledger`, `shared_credits`, `shared_credit_ledger`, `credit_subscriptions`
- **Plugin (5)**
  - `plugins`, `plugin_asset_approvals`, `plugin_page_type_approvals`, `settings`, `admin_jobs`
- **Compliance (1)**
  - `audit_log`

`admin_jobs` is grouped with Plugin because it coordinates long-running plugin
admin actions, although it also runs advanced-search bulk actions. The general
`settings` table is grouped there because it stores runtime CMS and plugin
configuration.

### Published database (`PUBLISHED_DB`) — 2 tables

| Table | Purpose |
|-------|---------|
| `live_pages` | Published page metadata and structured `lect` content |
| `live_page_tags` | Published page ↔ tag relationships |

Keeping public content in this separate database allows a public Worker to read
published pages without receiving access to users, sessions, drafts, trash,
plugin configuration, or other private CMS state.

### Live editing Durable Object — 2 tables per page object

| Table | Purpose |
|-------|---------|
| `crdt_ops` | Unsaved per-user field operations that form the live collaborative editing overlay; cleared after a save |
| `presence` | Currently connected editors and their last-seen/last-active state |

These tables are created by `PageSyncDO` in Durable Object SQLite storage, not
by the D1 migration directories.

### Publish / un-publish flow

```
                       ┌────▶  d1      PUBLISHED_DB.live_pages (default)
DB.draft_pages ── Publish ──▶  r2      PUBLISH_BUCKET pages/<uuid>.json + index.json
                       └────▶  plugin  /__plugin/publish/* (IPFS, webhooks, …)
```

Publish builds one snapshot from `DB.draft_pages` (page row + denormalized tag
links) and fans it out to every configured **publish target**; un-publish and
page deletion remove the page from every target the same way. See
[Publish targets](#publish-targets).

The default `d1` target upserts the snapshot into `PUBLISHED_DB.live_pages` by
`uuid`, preserving the draft page's numeric `id`, and replaces its
`live_page_tags` links; un-publish deletes both.

## Publish targets

Publishing is adapter-based (`src/core/publish/`). Built-in targets are selected with
the `PUBLISH_TARGETS` var (comma-separated, defaults to `"d1"`):

| Target | Requires | What it does |
|--------|----------|--------------|
| `d1` | `PUBLISHED_DB` binding | Upserts `live_pages` / `live_page_tags` in the published database (the original flow) |
| `r2` | `PUBLISH_BUCKET` binding | Writes static JSON: `pages/<uuid>.json` (full snapshot, `lect` parsed) plus `index.json` (listing of all live pages) |

```toml
[[r2_buckets]]
binding = "PUBLISH_BUCKET"
bucket_name = "worker-cms-published"

[vars]
PUBLISH_TARGETS = "d1,r2"
```

**Plugin targets** are not listed in `PUBLISH_TARGETS`; any plugin whose
manifest declares `publishTarget: true` automatically receives publish traffic
using that registration's dedicated secret. Two ready-to-deploy plugins:

- [`plugin-publish-ipfs`](https://github.com/zeroxcms/plugin-publish-ipfs) — pins
  each published page to IPFS via the Pinata API, tracks `uuid → CID` in KV so
  un-publish unpins.
- [`plugin-publish-webhook`](https://github.com/zeroxcms/plugin-publish-webhook) —
  forwards publish events to external URLs as HMAC-signed JSON webhooks (search
  indexers, static-site rebuilds, deploy hooks).

The contract is three POST endpoints, JSON body, `x-plugin-secret` header:

| Endpoint | Body | When |
|----------|------|------|
| `/__plugin/publish/page` | `{ page, tags, publishedAt }` | page published |
| `/__plugin/publish/remove` | `{ uuid }` | page unpublished or deleted |
| `/__plugin/publish/remove-tag` | `{ tagId }` | tag deleted (optional — a 404 is ignored) |

All targets are awaited on publish; per-target failures are logged and reported
in the editor flash message (`Page published, but these targets failed: …`)
without blocking the targets that succeeded.

The admin UI's publish-status badges read live state from the first configured
target that supports reads (`d1`, or `r2` when `d1` is absent). Plugin targets
are write-only.

---

## Project structure

The codebase is split along one line: **`core/` is what every deployment has,
`features/` is what a deployment chooses.** Nothing in `core/` imports a
feature implementation or feature-owned contract. Installed feature routers
and runtime services are selected by generated registries, while genuinely
core-wide platform hooks use `core/extensions.ts`.
`tools/check-boundaries.mjs` enforces this and fails the build when it is
violated; see [Feature profiles](#feature-profiles) for the switch that turns
features on and off.

```
├── cms.features.json      # One switch per feature — the profile for this deployment
├── migrations/            # GENERATED from the schema.sql fragments; do not edit
│   ├── 0001_initial_schema.sql
│   └── published/0001_published_schema.sql
├── tools/                 # Node-side generators and guards; never shipped
│   ├── build-features.mjs     # cms.features.json -> src/generated/*
│   ├── build-migrations.mjs   # schema.sql fragments -> migrations/*
│   ├── check-boundaries.mjs   # import-layering rules
│   ├── check-profiles.mjs     # every feature profile executes and is removable
│   └── install.mjs            # `npm run setup` wizard
├── src/
│   ├── index.ts           # Worker entry: fetch, queue, scheduled, DO exports
│   ├── types.ts           # Env bindings and shared content types
│   ├── cms-config.ts      # Compiled base blueprint, blocks and taxonomies
│   ├── core/              # Never optional
│   │   ├── extensions.ts  # What core will call if a feature provides it
│   │   ├── feature.ts     # The CmsFeature manifest contract
│   │   ├── schema.sql     # Core tables (users, pages, tags, roles, locales…)
│   │   ├── http/          # Headers, rate limit, request context, D1 sessions, forms
│   │   ├── auth/          # JWT, sessions, cookies, guards, roles, permissions
│   │   ├── db/            # Page/tag stores, lect, search, settings, content config
│   │   ├── render/        # Liquid, layout, admin chrome (buildBaseProps/renderPage)
│   │   ├── pages/         # Bulk page actions (publish/unpublish/trash a set)
│   │   ├── publish/       # Draft -> live pipeline and the d1/r2 adapters
│   │   └── durable-objects/  # PageSyncDO (live editing), FormOnceDO (form tokens)
│   ├── generated/         # GENERATED feature registries; do not edit
│   ├── features/          # Optional; each directory is one switchable feature
│   │   ├── plugins/       # The plugin platform: registry, hooks, proxy,
│   │   │                  #   manage UI, and the /__cms write-back API
│   │   ├── credits/       # Metered billing and the credit summary screen
│   │   ├── search/        # Advanced search screen and bulk actions
│   │   ├── media/         # R2 uploads, /media delivery, the Files browser
│   │   ├── trash/         # Soft-delete holding area
│   │   ├── runtime-content-types/  # Admin for DB-defined page/block types
│   │   ├── i18n/          # Languages and translations admin
│   │   └── users-roles/   # User and role administration
│   ├── routes/
│   │   ├── auth.ts        # OAuth 2.1 login / callback / logout / refresh
│   │   └── admin/         # Capability-protected admin routes (pages, tags,
│   │                      #   settings, profile, JSON API)
│   └── templates/         # Server renderers for core admin screens
├── views/
│   ├── layout/            # Liquid layout
│   ├── sections/          # Admin UI Liquid sections
│   ├── templates/         # Section composition maps
│   ├── locales/           # UI string catalogs
│   └── assets/            # Compiled Tailwind CSS and browser scripts
├── assets-source/         # Sources compiled into views/assets/ — kept OUT of
│   ├── admin.css          #   views/ because wrangler serves that whole
│   └── richtext-md.js     #   directory publicly
├── dictionary/            # Generated OpenCC tables for Chinese search
├── package.json
├── tsconfig.json
└── wrangler.toml
```

### A feature directory

Every feature reads the same way, so a slice is self-describing:

```
src/features/trash/
├── feature.ts     # The CmsFeature manifest: id, requires, navKeys, baseProps
├── routes.ts      # Admin router (or routes/<name>.ts when it owns several)
├── template.ts    # Server renderer (or templates/<name>.ts)
└── schema.sql     # Its tables, declaring `-- feature: trash`
```

`feature.ts` is the only thing core sees. Routers are registered separately
(`src/features/routers.ts`) because a router reaches back into the admin chrome
through `renderPage`, and listing them alongside the manifests would make the
import graph cyclic.

A feature may depend on another only by declaring it in `requires`, which is
validated at startup and enforced by the boundary guard. Today:

| Feature | Requires |
|---|---|
| `users-roles` | `plugins`, `credits` |
| `runtime-content-types`, `search`, `credits` | `plugins` |
| `plugins` | `credits` — the mutual dependency noted under [Feature profiles](#feature-profiles) |
| `trash`, `media`, `i18n` | — |
