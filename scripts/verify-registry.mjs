import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { setTimeout } from 'node:timers/promises';
const pkg = JSON.parse(readFileSync('packages/create-lokalchat/package.json'));
const expected = 'sha512-' + createHash('sha512').update(readFileSync(process.argv[2])).digest('base64');
// npm may accept a publication before registry processing completes.
// Allow up to five minutes; never republish an accepted version on timeout.
for (let attempt = 0; attempt < 60; attempt++) {
  const response = await fetch(`https://registry.npmjs.org/lokalchat/${pkg.version}`);
  if (response.ok) {
    const data = await response.json();
    const latest = await fetch('https://registry.npmjs.org/lokalchat/latest').then(r => r.json());
    if (data.dist?.integrity === expected && latest.version === pkg.version) {
      console.log(`Verified registry integrity and latest for lokalchat@${pkg.version}`);
      process.exit(0);
    }
  }
  await setTimeout(5000);
}
assert.fail('Registry version/integrity/latest not confirmed; inspect registry before retrying publication');
