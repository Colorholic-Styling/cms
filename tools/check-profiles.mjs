// ============================================================
// Feature-profile checker.
//
// Assembles every interesting feature profile and *executes* it against an
// in-memory SQLite, which the text-level assertions in
// test/schema-assembly.test.ts cannot do (those tests run inside workerd).
//
// Executing is what catches the failures that matter when a feature is
// dropped: an index or trigger left behind referencing a table that is no
// longer created, a foreign key to a dropped table, or statements emitted in
// the wrong order.
//
// For each optional feature it also derives — by diffing the full profile
// against that feature turned off — exactly which database objects the
// feature owns, and reports leakage (objects that disappear when a *different*
// feature is disabled).
//
// Usage: node scripts/check-profiles.mjs [--quiet]
// ============================================================

import { DatabaseSync } from 'node:sqlite';
import { availableFeatures, buildCms, requiredFeatures } from './build-migrations.mjs';

const quiet = process.argv.includes('--quiet');
const features = availableFeatures();

/** Features that (transitively) require `id`, so they must go when it does. */
function dependents(id) {
  const out = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    for (const candidate of features) {
      if (out.has(candidate) || candidate === id) continue;
      const needs = requiredFeatures(candidate);
      if (needs.includes(id) || needs.some((need) => out.has(need))) {
        out.add(candidate);
        changed = true;
      }
    }
  }
  return [...out];
}

function profile(enabled) {
  return Object.fromEntries(features.map((id) => [id, enabled.includes(id)]));
}

/** Executes an assembled baseline and returns its sqlite_master object names. */
function objectsFor(sql, label) {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(sql);
  } catch (error) {
    throw new Error(`profile "${label}" failed to execute: ${error.message}`);
  }
  const rows = db.prepare(
    "SELECT type, name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name",
  ).all();
  db.close();
  return new Set(rows.map((row) => `${row.type} ${row.name}`));
}

const failures = [];
function check(condition, message) {
  if (!condition) failures.push(message);
}

// ── Full profile: the baseline every existing install runs ───────────────────
const fullSql = buildCms(profile(features));
const full = objectsFor(fullSql, 'full');
if (!quiet) console.log(`full profile: ${full.size} objects, ${(fullSql.length / 1024).toFixed(1)} kB of SQL\n`);

// ── Lean profile: core only ──────────────────────────────────────────────────
const leanSql = buildCms(profile([]));
const lean = objectsFor(leanSql, 'lean');
for (const object of lean) {
  check(full.has(object), `lean profile created "${object}", which the full profile does not`);
}
check(lean.has('table users'), 'lean profile is missing the core users table');
check(lean.has('table pages'), 'lean profile is missing the core pages table');

// ── One feature off at a time ────────────────────────────────────────────────
const owned = new Map();
for (const id of features) {
  const alsoOff = dependents(id);
  const enabled = features.filter((other) => other !== id && !alsoOff.includes(other));
  const objects = objectsFor(buildCms(profile(enabled)), `without ${id}`);

  const removed = [...full].filter((object) => !objects.has(object));
  const added = [...objects].filter((object) => !full.has(object));
  owned.set(id, { removed, alsoOff });

  check(added.length === 0, `disabling "${id}" ADDED objects: ${added.join(', ')}`);
  check(removed.length > 0, `disabling "${id}" removed nothing — is the fragment empty?`);
  for (const object of lean) {
    check(objects.has(object), `disabling "${id}" also removed core object "${object}"`);
  }

  if (!quiet) {
    const suffix = alsoOff.length ? `  (+ dependents: ${alsoOff.join(', ')})` : '';
    console.log(`− ${id.padEnd(24)} removes ${String(removed.length).padStart(2)} objects${suffix}`);
    console.log(`  ${removed.join(', ')}\n`);
  }
}

// Every optional object must belong to exactly one feature, or the fragments
// have leaked into each other.
const optional = [...full].filter((object) => !lean.has(object));
for (const object of optional) {
  const owners = features.filter((id) => owned.get(id).removed.includes(object));
  const direct = owners.filter((id) => !owners.some((other) => other !== id && owned.get(other).alsoOff.includes(id)));
  check(direct.length === 1, `"${object}" is owned by ${direct.length} features (${direct.join(', ') || 'none'})`);
}

// ── Dependency enforcement ───────────────────────────────────────────────────
// A fragment that declares `-- requires: x` must be refused when x is off,
// rather than emitting SQL that references something never created. Derived
// from the fragments rather than naming a pair, so it keeps holding as
// dependencies appear and disappear — including in a build where the feature
// on either end has been deleted outright.
for (const dependency of features) {
  const needers = features.filter((id) => requiredFeatures(id).includes(dependency));
  if (!needers.length) continue;
  let threw = false;
  try {
    buildCms(profile(features.filter((id) => id !== dependency)));
  } catch {
    threw = true;
  }
  check(threw, `disabling "${dependency}" while "${needers.join('", "')}" is enabled should have thrown`);
}

if (failures.length) {
  console.error(`\n${failures.length} profile check(s) failed:`);
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exit(1);
}
console.log(`✓ ${features.length} features are independently removable (${optional.length} optional objects, ${lean.size} core)`);
