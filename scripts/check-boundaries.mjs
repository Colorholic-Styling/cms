// ============================================================
// Import-boundary guard for the admin chrome.
//
// utils/admin-render.ts became a god module by accretion: one convenient
// import at a time, until the trash screen transitively depended on the
// billing engine and the search index. Nothing failed when that happened,
// which is why it kept happening.
//
// These rules make it fail. They cover the layering the refactor paid for:
// core/ never depends on a feature, features never depend on each other, the
// chrome reaches feature code only through the manifest registry, and no
// import cycle runs through it.
//
// Usage: node scripts/check-boundaries.mjs [--quiet]
// ============================================================

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = fileURLToPath(new URL('..', import.meta.url));
const quiet = process.argv.includes('--quiet');

const CHROME = 'src/core/render/chrome.ts';
const REGISTRY = 'src/features/index.ts';
const ROUTERS = 'src/features/routers.ts';

// Feature machinery the chrome must never pull in directly: every admin page
// render would pay for it, and no admin page except one needs it.
const FORBIDDEN_IN_CHROME = [
  'src/core/db/search.ts',
  'src/core/db/chinese.ts',
  'src/core/publish/index.ts',
  'src/core/publish/projection.ts',
  'src/features/search/template.ts',
  'dictionary/chinese-chars.ts',
];

// Paths in FORBIDDEN_IN_CHROME must exist, or the rule silently passes forever.
// They have moved once already (the utils/ dissolution), so this is checked.

const files = [];
(function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (full.endsWith('.ts') && !full.endsWith('.d.ts')) files.push(path.relative(rootDir, full));
  }
})(path.join(rootDir, 'src'));

/** Value imports only — `import type` is erased and costs nothing at runtime. */
function importsOf(file) {
  const source = readFileSync(path.join(rootDir, file), 'utf8');
  const out = new Set();
  const pattern = /(^|\n)\s*import\s+(type\s+)?([\s\S]*?)from\s+'(\.[^']+)'/g;
  for (let match = pattern.exec(source); match; match = pattern.exec(source)) {
    if (match[2]) continue;
    const target = path.normalize(path.join(path.dirname(file), match[4]));
    const resolved = [`${target}.ts`, path.join(target, 'index.ts'), target].find((candidate) => files.includes(candidate));
    if (resolved) out.add(resolved);
  }
  return [...out];
}

const graph = new Map(files.map((file) => [file, importsOf(file)]));

function closure(root, blocked = new Set()) {
  const seen = new Set();
  const stack = [root];
  while (stack.length) {
    const node = stack.pop();
    if (seen.has(node) || blocked.has(node)) continue;
    seen.add(node);
    for (const next of graph.get(node) ?? []) if (!blocked.has(next)) stack.push(next);
  }
  return seen;
}

const failures = [];

for (const forbidden of FORBIDDEN_IN_CHROME) {
  if (!files.includes(forbidden) && forbidden.startsWith('src/')) {
    failures.push(`FORBIDDEN_IN_CHROME lists ${forbidden}, which no longer exists — the rule would pass by accident`);
  }
}

// 1. The chrome may reach feature code only through the contributor registry.
const withoutRegistry = closure(CHROME, new Set([REGISTRY]));
for (const file of withoutRegistry) {
  if (file.startsWith('src/features/')) {
    failures.push(`${CHROME} reaches ${file} without going through ${REGISTRY}`);
  }
}

// 2. Not even the registry may drag the heavy feature machinery into the chrome.
const full = closure(CHROME);
for (const forbidden of FORBIDDEN_IN_CHROME) {
  if (full.has(forbidden)) failures.push(`${CHROME} reaches ${forbidden}; every admin render would pay for it`);
}

// 3. core/ may not reach into features/ at all, except the chrome reading the
//    manifest registry. This is the layering the utils/ dissolution paid for:
//    without it, "core" is just a folder name.
for (const file of files.filter((f) => f.startsWith('src/core/'))) {
  for (const target of graph.get(file) ?? []) {
    if (!target.startsWith('src/features/')) continue;
    if (file === CHROME && target === REGISTRY) continue;
    failures.push(`${file} imports ${target}; core must not depend on a feature (only ${CHROME} -> ${REGISTRY})`);
  }
}

// 4. A feature may not import a sibling feature. Shared code belongs in core/
//    or plugins/; a genuine dependency should become a `requires` entry and an
//    explicit exception here, not an ad-hoc import.
// `generated/` is the registry, not a slice: it aggregates every feature by
// design, which is exactly what this rule forbids everywhere else.
const featureOf = (file) => {
  const owner = (file.match(/^src\/features\/([^/]+)\//) ?? [])[1];
  return owner === 'generated' ? undefined : owner;
};
for (const file of files) {
  const owner = featureOf(file);
  if (!owner) continue;
  for (const target of graph.get(file) ?? []) {
    const other = featureOf(target);
    if (other && other !== owner) {
      failures.push(`${file} imports ${target}; features must not depend on each other`);
    }
  }
}

// 5. The registry is the one place that names features, so keep it a list of
//    imports and a little validation — heavier logic there would not survive
//    being generated from cms.features.json.
for (const target of graph.get(REGISTRY) ?? []) {
  if (!target.startsWith('src/features/') && !target.startsWith('src/core/')) {
    failures.push(`${REGISTRY} imports ${target}; it should only list feature contributors`);
  }
}

// 5b. The generated manifest list must not reach a router, or generation would
//     reintroduce the cycle the two-file split exists to prevent.
const GENERATED_MANIFESTS = 'src/features/generated/manifests.ts';
for (const file of closure(GENERATED_MANIFESTS)) {
  if (/^src\/features\/[^/]+\/routes(\.ts|\/)/.test(file)) {
    failures.push(`${GENERATED_MANIFESTS} reaches ${file}; manifests must not pull in routers`);
  }
}

// 6. Routers are registered separately precisely so the chrome never sees
//    them: a router reaches back into the chrome via renderPage, so importing
//    one from the manifest registry would re-bloat the chrome and make the
//    graph cyclic.
if (full.has(ROUTERS)) {
  failures.push(`${CHROME} reaches ${ROUTERS}; feature routers must stay out of the manifest registry`);
}
for (const file of full) {
  if (/^src\/features\/[^/]+\/routes\.ts$/.test(file)) {
    failures.push(`${CHROME} reaches ${file}; only ${ROUTERS} may import feature routers`);
  }
}

// 7. No import cycle may run through the chrome. This is the failure mode the
//    router split exists to prevent, and it is silent until a bundler happens
//    to order the modules badly.
const cycle = (() => {
  const trail = [];
  const onPath = new Set();
  const done = new Set();
  const walk = (node) => {
    if (onPath.has(node)) return [...trail.slice(trail.indexOf(node)), node];
    if (done.has(node)) return null;
    onPath.add(node);
    trail.push(node);
    for (const next of graph.get(node) ?? []) {
      const found = walk(next);
      if (found) return found;
    }
    onPath.delete(node);
    done.add(node);
    trail.pop();
    return null;
  };
  return walk(CHROME);
})();
if (cycle) failures.push(`import cycle through the chrome: ${cycle.join(' -> ')}`);

// 8. Every registered router must belong to an installed feature, or the two
//    registries have drifted and a route is mounted for a feature that is
//    supposed to be gone.
const featureIds = [...(readFileSync(path.join(rootDir, REGISTRY), 'utf8').matchAll(/import\s+\{\s*(\w+)\s*\}\s+from\s+'\.\/([\w-]+)\//g))]
  .map((match) => match[2]);
const routerIds = [...(readFileSync(path.join(rootDir, ROUTERS), 'utf8').matchAll(/id:\s*'([\w-]+)'/g))].map((match) => match[1]);
for (const id of routerIds) {
  if (!featureIds.includes(id)) {
    failures.push(`${ROUTERS} mounts a router for "${id}", which is not installed in ${REGISTRY}`);
  }
}

if (failures.length) {
  console.error(`\n${failures.length} import-boundary violation(s):`);
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exit(1);
}
if (!quiet) {
  const viaRegistry = full.size - withoutRegistry.size;
  console.log(`✓ chrome closure: ${full.size} modules (${withoutRegistry.size} core + ${viaRegistry} via ${REGISTRY})`);
}
