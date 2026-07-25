// ============================================================
// Migration assembler.
//
// Wrangler allows exactly one `migrations_dir` per D1 database and has no
// CLI override, so features cannot each own a migrations folder that wrangler
// walks. Instead features own SQL *fragments* under schema/, and this script
// concatenates the enabled ones into the flat baseline files wrangler already
// points at:
//
//   schema/cms/core.sql + schema/cms/features/<id>.sql   ->  migrations/0001_initial_schema.sql
//   schema/published/core.sql                            ->  migrations/published/0001_published_schema.sql
//
// The baseline filenames never change. D1 tracks applied migrations by name
// only (see wrangler's getUnappliedMigrationNames), so regenerating a baseline
// that an existing database has already applied is a no-op there — the new
// content only affects fresh installs. To add a feature's tables to a database
// that already ran the baseline, emit an additive migration instead:
//
//   node scripts/build-migrations.mjs --enable <feature>
//
// Fragments are idempotent (CREATE ... IF NOT EXISTS), so an enable migration
// is safe to apply to a database that happens to have the tables already.
//
// Usage:
//   node scripts/build-migrations.mjs            # write the baselines
//   node scripts/build-migrations.mjs --check    # exit 1 if they are stale
//   node scripts/build-migrations.mjs --enable X # additive migration for X
// ============================================================

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = fileURLToPath(new URL('..', import.meta.url));
const schemaDir = path.join(rootDir, 'schema');
const manifestPath = path.join(rootDir, 'cms.features.json');

const CMS_BASELINE = path.join(rootDir, 'migrations', '0001_initial_schema.sql');
const PUBLISHED_BASELINE = path.join(rootDir, 'migrations', 'published', '0001_published_schema.sql');

/** Reads the enabled-feature map from cms.features.json. */
export function readManifest() {
  const raw = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const features = raw.features ?? {};
  if (typeof features !== 'object' || Array.isArray(features)) {
    throw new Error('cms.features.json: "features" must be an object of id -> boolean');
  }
  return features;
}

/** Every feature fragment that exists on disk, in stable (sorted) order. */
export function availableFeatures() {
  const dir = path.join(schemaDir, 'cms', 'features');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .map((name) => name.slice(0, -'.sql'.length))
    .sort();
}

function fragmentPath(id) {
  return path.join(schemaDir, 'cms', 'features', `${id}.sql`);
}

/**
 * Feature-level dependencies, declared in the fragment header as
 * `-- requires: a, b`. "core" is implicit and ignored.
 */
export function requiredFeatures(id) {
  const match = /^--\s*requires:\s*(.+)$/m.exec(readFileSync(fragmentPath(id), 'utf8'));
  if (!match) return [];
  return match[1]
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value && value !== 'core');
}

/**
 * Enabled features in dependency order: a feature is always emitted after
 * everything it requires. Manifest order breaks ties, so the output is stable.
 */
function resolveOrder(features) {
  const available = availableFeatures();
  const enabled = Object.entries(features)
    .filter(([, on]) => on === true)
    .map(([id]) => id);

  for (const id of Object.keys(features)) {
    if (!available.includes(id)) {
      throw new Error(`cms.features.json lists "${id}", but ${path.relative(rootDir, fragmentPath(id))} does not exist`);
    }
  }
  for (const id of available) {
    if (!(id in features)) {
      throw new Error(`schema/cms/features/${id}.sql exists but is not listed in cms.features.json (add it as true or false)`);
    }
  }

  const ordered = [];
  const visiting = new Set();
  const visit = (id, trail) => {
    if (ordered.includes(id)) return;
    if (visiting.has(id)) {
      throw new Error(`circular feature dependency: ${[...trail, id].join(' -> ')}`);
    }
    visiting.add(id);
    for (const dependency of requiredFeatures(id)) {
      if (!enabled.includes(dependency)) {
        throw new Error(`feature "${id}" requires "${dependency}", which is disabled in cms.features.json`);
      }
      visit(dependency, [...trail, id]);
    }
    visiting.delete(id);
    ordered.push(id);
  };
  for (const id of enabled) visit(id, []);
  return ordered;
}

function generatedHeader(title, parts) {
  return [
    '-- ============================================================',
    `-- ${title}`,
    '--',
    '-- GENERATED FILE — do not edit. Edit the fragments under schema/',
    '-- and run `npm run build:migrations`.',
    '--',
    '-- Assembled from:',
    ...parts.map((part) => `--   ${part}`),
    '-- ============================================================',
    '',
  ].join('\n');
}

/** Concatenates fragments, normalizing to exactly one blank line between them. */
function concat(header, fragmentFiles) {
  const bodies = fragmentFiles.map((file) => readFileSync(file, 'utf8').trim());
  return `${header}\n${bodies.join('\n\n')}\n`;
}

export function buildCms(features) {
  const order = resolveOrder(features);
  const files = [path.join(schemaDir, 'cms', 'core.sql'), ...order.map(fragmentPath)];
  const parts = ['schema/cms/core.sql', ...order.map((id) => `schema/cms/features/${id}.sql`)];
  const disabled = Object.entries(features).filter(([, on]) => on !== true).map(([id]) => id);
  if (disabled.length) parts.push(`(disabled: ${disabled.join(', ')})`);
  return concat(generatedHeader('Initial CMS schema — applied to the private CMS (admin) database.', parts), files);
}

export function buildPublished() {
  return concat(
    generatedHeader('Published content schema — applied to the published-only D1 database.', ['schema/published/core.sql']),
    [path.join(schemaDir, 'published', 'core.sql')],
  );
}

/**
 * Writes an additive migration that creates one feature's objects on a
 * database that already applied the baseline. The number is one past the
 * highest existing migration; the name embeds the feature id so it stays
 * unique in the shared d1_migrations table.
 */
function writeEnableMigration(id) {
  const available = availableFeatures();
  if (!available.includes(id)) {
    throw new Error(`unknown feature "${id}". Available: ${available.join(', ')}`);
  }
  const dir = path.join(rootDir, 'migrations');
  const highest = readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .reduce((max, name) => Math.max(max, Number.parseInt(name.slice(0, 4), 10) || 0), 0);
  const number = String(highest + 1).padStart(4, '0');
  const target = path.join(dir, `${number}_enable_${id.replaceAll('-', '_')}.sql`);
  const header = [
    '-- ============================================================',
    `-- Enable feature: ${id}`,
    '--',
    '-- GENERATED by `node scripts/build-migrations.mjs --enable`. Creates this',
    "-- feature's objects on a database that already applied the baseline.",
    '-- Idempotent: every statement is CREATE ... IF NOT EXISTS or INSERT OR IGNORE.',
    '-- ============================================================',
    '',
  ].join('\n');
  writeFileSync(target, `${header}\n${readFileSync(fragmentPath(id), 'utf8').trim()}\n`);
  return path.relative(rootDir, target);
}

/** Absolute paths of the generated baselines, for callers that read them back. */
export const baselinePaths = { cms: CMS_BASELINE, published: PUBLISHED_BASELINE };

function main() {
  const args = process.argv.slice(2);
  const enableIndex = args.indexOf('--enable');
  if (enableIndex !== -1) {
    const id = args[enableIndex + 1];
    if (!id) throw new Error('--enable requires a feature id');
    console.log(`wrote ${writeEnableMigration(id)}`);
    console.log(`Set "${id}": true in cms.features.json, then run npm run build:migrations.`);
    return;
  }

  const features = readManifest();
  const outputs = [
    [CMS_BASELINE, buildCms(features)],
    [PUBLISHED_BASELINE, buildPublished()],
  ];

  if (args.includes('--check')) {
    const stale = outputs.filter(([file, content]) => !existsSync(file) || readFileSync(file, 'utf8') !== content);
    if (stale.length) {
      console.error('Generated migrations are stale. Run: npm run build:migrations');
      for (const [file] of stale) console.error(`  ${path.relative(rootDir, file)}`);
      process.exit(1);
    }
    console.log('migrations up to date');
    return;
  }

  for (const [file, content] of outputs) {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content);
    console.log(`wrote ${path.relative(rootDir, file)}`);
  }
}

// Only run the CLI when invoked directly; vitest.config.mts imports the
// builders to assemble alternate profiles for the assembly tests.
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
