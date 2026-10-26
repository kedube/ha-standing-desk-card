/// <reference types="node" />
import { pathToFileURL } from 'node:url';

/**
 * Release numbering: 0.01, 0.02 … 0.99, then 1.00, 1.01 … — two decimal places, no "v" prefix.
 * Tags in any other format are ignored.
 */
const RELEASE_TAG = /^(\d+)\.(\d{2})$/;

/** The version after the highest release tag, or 0.01 when there is none. */
export function nextVersion(tags: readonly string[]): string {
  let latest = 0; // in hundredths
  for (const tag of tags) {
    const match = RELEASE_TAG.exec(tag.trim());
    if (match) latest = Math.max(latest, Number(match[1]) * 100 + Number(match[2]));
  }
  const next = latest + 1;
  return `${Math.floor(next / 100)}.${String(next % 100).padStart(2, '0')}`;
}

// CLI: node scripts/next-version.ts $(git tag --list)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(nextVersion(process.argv.slice(2)));
}
