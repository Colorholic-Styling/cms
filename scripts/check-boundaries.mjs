// ============================================================
// Import-boundary guard for the admin chrome.
//
// utils/admin-render.ts became a god module by accretion: one convenient
// import at a time, until the trash screen transitively depended on the
// billing engine and the search index. Nothing failed when that happened,
// which is why it kept happening.
//
// These rules make it fail. They are deliberately narrow — the src/features
// layout is still transitional, so this checks the one boundary that has
// already been paid for rather than a layering scheme that does not exist yet.
//
// Usage: node scripts/check-boundaries.mjs [--quiet]
// ============================================================

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = fileURLToPath(new URL('..', import.meta.url));
const quiet = process.argv.includes('--quiet');

const CHROME = 'src/core/render/chrome.ts';
const REGISTRY = 'src/features/contributions.ts';

// Feature machinery the chrome must never pull in directly: every admin page
// render would pay for it, and no admin page except one needs it.
const FORBIDDEN_IN_CHROME = [
  'src/utils/search.ts',
  'src/publish/index.ts',
  'src/publish/projection.ts',
  'src/templates/advanced-search.ts',
  'src/utils/chinese.ts',
  'dictionary/chinese-chars.ts',
];

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

// 3. Outside the chrome, core/ must not know that features exist at all.
for (const file of files.filter((candidate) => candidate.startsWith('src/core/') && candidate !== CHROME)) {
  for (const target of graph.get(file) ?? []) {
    if (target.startsWith('src/features/')) failures.push(`${file} imports ${target}; only ${CHROME} may reach features, via ${REGISTRY}`);
  }
}

// 4. The registry is the one place that names features, so keep it a list of
//    imports and nothing else — logic there would not survive being generated.
for (const target of graph.get(REGISTRY) ?? []) {
  if (!target.startsWith('src/features/') && !target.startsWith('src/core/')) {
    failures.push(`${REGISTRY} imports ${target}; it should only list feature contributors`);
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
