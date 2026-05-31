import * as esbuild from 'esbuild';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const result = await esbuild.build({
  entryPoints: [path.join(root, 'server/index.ts')],
  platform: 'node',
  bundle: true,
  format: 'esm',
  outdir: path.join(root, 'dist'),
  external: ['canvas', 'fsevents'],
  banner: {
    js: [
      "import { createRequire as _cjsRequire } from 'module';",
      "import { fileURLToPath as _cjsFileURLToPath } from 'url';",
      "import { dirname as _cjsDirname } from 'path';",
      "const require = _cjsRequire(import.meta.url);",
      "const __filename = _cjsFileURLToPath(import.meta.url);",
      "const __dirname = _cjsDirname(__filename);",
    ].join('\n'),
  },
  plugins: [
    {
      name: 'vite-prod-redirect',
      setup(build) {
        build.onResolve({ filter: /^\.\/vite$/ }, args => {
          if (args.importer && args.importer.includes('server/index')) {
            return { path: path.join(root, 'server', 'vite-prod.ts') };
          }
        });
      },
    },
  ],
  logLevel: 'info',
});

console.log('[build-prod] Server bundle complete — dist/index.js is self-contained.');
