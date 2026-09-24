/**
 * Builds dual ESM and CommonJS output with tsc alone.
 *
 * Under `module: nodenext` tsc picks the emit format from the nearest
 * package.json `type` field of each *input* file, not from a flag. This package
 * is `type: module`, so a second pass compiles a staged copy of `src/` that
 * sits under a `type: commonjs` manifest.
 *
 * Compiling file-per-file rather than bundling keeps one module instance per
 * output tree, so `instanceof` still works across the subpath exports — an
 * error thrown inside `@e-pay/node/express` is caught by a check against
 * `EpayWebhookSignatureError` imported from `@e-pay/node`.
 */

import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(pkgRoot, 'dist');
const cjsStage = resolve(dist, '.cjs-src');

/** Runs the workspace tsc, streaming its diagnostics. */
function tsc(project) {
  execFileSync('tsc', ['-p', project], { cwd: pkgRoot, stdio: 'inherit' });
}

function writeManifest(dir, type) {
  writeFileSync(resolve(dir, 'package.json'), `${JSON.stringify({ type }, null, 2)}\n`);
}

rmSync(dist, { recursive: true, force: true });

// ESM: src/ sits under this package's `type: module` manifest.
tsc('tsconfig.build.json');
writeManifest(resolve(dist, 'esm'), 'module');

// CommonJS: stage src/ beneath a `type: commonjs` manifest and recompile.
mkdirSync(cjsStage, { recursive: true });
cpSync(resolve(pkgRoot, 'src'), cjsStage, { recursive: true });
writeManifest(cjsStage, 'commonjs');
tsc('tsconfig.cjs.json');
writeManifest(resolve(dist, 'cjs'), 'commonjs');

rmSync(cjsStage, { recursive: true, force: true });

console.log('built dist/esm (ESM) and dist/cjs (CommonJS)');
