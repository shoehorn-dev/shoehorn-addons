import { build } from 'esbuild';

const isWatch = process.argv.includes('--watch');

// Backend bundle: QuickJS IIFE format with global exports.
const backendConfig = {
  entryPoints: ['src/index.ts'],
  bundle: true,
  outfile: 'dist/addon.js',
  format: 'iife',
  globalName: '__addon__',
  footer: { js: 'if(typeof __addon__!=="undefined"){for(var k in __addon__)globalThis[k]=__addon__[k];}' },
  target: 'es2020',
  platform: 'neutral',
  minify: !isWatch,
  sourcemap: isWatch,
};

// Frontend bundle: ESM for browser dynamic import by addon loader.
// Pure vanilla JS/TS - no Svelte compiler needed. Components use DOM APIs
// directly to avoid dual Svelte runtime conflicts with the host app.
const frontendConfig = {
  entryPoints: ['src/frontend.ts'],
  bundle: true,
  outfile: 'dist/frontend.js',
  format: 'esm',
  target: 'es2020',
  platform: 'browser',
  minify: !isWatch,
  sourcemap: isWatch,
};

if (isWatch) {
  await build({ ...backendConfig, plugins: [] });
  console.log('Watching for changes...');
} else {
  await build(backendConfig);
  console.log('Build complete: dist/addon.js');

  await build(frontendConfig);
  console.log('Build complete: dist/frontend.js');
}
