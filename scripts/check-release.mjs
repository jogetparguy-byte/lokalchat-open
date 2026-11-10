import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const pkg = JSON.parse(readFileSync('packages/create-lokalchat/package.json'));
assert.equal(pkg.name, 'lokalchat');
assert.match(pkg.version, /^\d+\.\d+\.\d+$/, 'Only stable releases may update latest');
assert.equal(process.env.GITHUB_REF, `refs/tags/v${pkg.version}`, 'Tag must match installer version');
console.log(`Release tag verified: lokalchat@${pkg.version}`);
