// Fails when two decision records claim the same number, or a filename does not
// match the convention.
//
// WHY THIS EXISTS
// Agents work in parallel worktrees. "Take the next free number" is computed
// against the branch the agent can see, and two agents branching from the same
// commit both see the same next number. The collision does not exist on either
// branch, so neither agent's checks catch it, and it appears only in the merge
// commit.
//
// CI runs this on pull_request, which GitHub evaluates against the merge
// commit, so a duplicate that exists nowhere in either branch alone still turns
// the PR red. That is the whole point: this is a check whose value is entirely
// in where it runs.
//
// WHAT THIS DOES NOT COVER
// Whether the decision is a good one, whether it duplicates an earlier ADR in
// substance, or whether it is superseded and unmarked. It compares filenames.

import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(process.cwd(), 'docs', 'architecture', 'decisions');
const PATTERN = /^(\d{4})-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;

let entries;
try {
  entries = readdirSync(DIR).filter((name) => name.endsWith('.md'));
} catch {
  console.log('check-adr-numbers: no decisions directory yet, nothing to check');
  process.exit(0);
}

const malformed = [];
const byNumber = new Map();

for (const name of entries) {
  if (name === 'README.md') continue;
  const match = PATTERN.exec(name);
  if (!match) {
    malformed.push(name);
    continue;
  }
  const number = match[1];
  if (!byNumber.has(number)) byNumber.set(number, []);
  byNumber.get(number).push(name);
}

const duplicates = [...byNumber.entries()].filter(([, names]) => names.length > 1);

if (malformed.length === 0 && duplicates.length === 0) {
  console.log(`check-adr-numbers: ${byNumber.size} decisions, every number unique`);
  process.exit(0);
}

if (duplicates.length > 0) {
  console.error('check-adr-numbers: two decisions claim the same number\n');
  for (const [number, names] of duplicates) {
    console.error(`  ${number}: ${names.join(', ')}`);
  }
  console.error(`
Two agents took the same next free number from the same base commit. Renumber
the later one, take the next number after everything on main AND everything in
an open pull request, and update any link that names the old number.
`);
}

if (malformed.length > 0) {
  console.error('check-adr-numbers: filenames that do not match NNNN-kebab-slug.md\n');
  for (const name of malformed) console.error(`  ${name}`);
  console.error('');
}

process.exit(1);
