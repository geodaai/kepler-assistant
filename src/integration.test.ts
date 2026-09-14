import {existsSync, readFileSync} from 'node:fs';
import {dirname, resolve, relative} from 'node:path';
import ts from 'typescript';
import {expect, it} from 'vitest';

// Follow local imports (including dynamic imports) without executing the browser
// dependency graph. An indirect store import used to create a second room and
// override the host's connector provider even when only commands were imported.
function localDependencies(entry: string, seen = new Set<string>()): Set<string> {
  if (seen.has(entry)) return seen;
  seen.add(entry);
  const {importedFiles} = ts.preProcessFile(readFileSync(entry, 'utf8'), true);
  for (const {fileName} of importedFiles) {
    if (!fileName.startsWith('.')) continue;
    const base = resolve(dirname(entry), fileName);
    const target = [base + '.ts', base + '.tsx', base + '/index.ts'].find(existsSync);
    if (!target) throw new Error(`Cannot resolve ${fileName} from ${entry}`);
    localDependencies(target, seen);
  }
  return seen;
}

it('keeps the integration entry independent of the standalone room and panel', () => {
  const root = resolve(import.meta.dirname);
  const graph = [...localDependencies(resolve(root, 'integration.ts'))].map(file =>
    relative(root, file)
  );
  expect(graph).toContain('assistant-tools.ts');
  expect(graph).toContain('analysis/index.ts');
  expect(graph).not.toContain('store.ts');
  expect(graph).not.toContain('assistant-panel.tsx');
  expect(graph).not.toContain('components/MainView.tsx');
});

it('retains the standalone root entry', () => {
  const root = resolve(import.meta.dirname);
  const graph = localDependencies(resolve(root, 'index.ts'));
  expect(graph.has(resolve(root, 'store.ts'))).toBe(true);
  expect(graph.has(resolve(root, 'assistant-panel.tsx'))).toBe(true);
});
