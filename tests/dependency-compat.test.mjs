// Exercise the dependency overrides and ESLint plugins without contacting a database or provider.
import assert from 'node:assert/strict';
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import hooks from 'eslint-plugin-react-hooks';
import refresh from 'eslint-plugin-react-refresh';
import { z } from 'zod';

const eslint = new ESLint({
  overrideConfigFile: true,
  overrideConfig: [{
    files: ['**/*.{ts,tsx}'],
    languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } },
    plugins: { '@typescript-eslint': tseslint.plugin, 'react-hooks': hooks, 'react-refresh': refresh },
    rules: { '@typescript-eslint/no-unused-vars': 'error', 'react-hooks/rules-of-hooks': 'error', 'react-refresh/only-export-components': 'error' },
  }],
});
const [good] = await eslint.lintText('import { useState } from "react"; export function Counter() { const [value] = useState<number>(0); return <span>{value}</span>; }', { filePath: 'src/security-check.tsx' });
assert.equal(good.errorCount, 0, JSON.stringify(good.messages));
const [bad] = await eslint.lintText('import { useState } from "react"; function wrong() { useState(0); }', { filePath: 'src/security-check.tsx' });
assert(bad.messages.some(message => message.ruleId === 'react-hooks/rules-of-hooks'));
assert(bad.messages.some(message => message.ruleId === '@typescript-eslint/no-unused-vars'));
assert.equal(z.array(z.string()).max(2).safeParse(['a', 'b', 'c']).success, false);
console.log('Dependency compatibility checks passed.');
