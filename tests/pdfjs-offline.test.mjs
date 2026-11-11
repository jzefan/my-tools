// Run after `pnpm build`: node --test tests/pdfjs-offline.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

test('PDF renderer resources are bundled from the installed pdfjs version', () => {
  for (const directory of ['cmaps', 'iccs', 'standard_fonts', 'wasm']) {
    const source = join('node_modules/pdfjs-dist', directory);
    const destination = join('dist/pdfjs', directory);
    const files = readdirSync(source).filter(file => statSync(join(source, file)).isFile());
    assert.ok(files.length > 0, directory);
    for (const file of files) {
      assert.deepEqual(readFileSync(join(destination, file)), readFileSync(join(source, file)), `${directory}/${file}`);
    }
  }
  const viewer = readFileSync('src/components/paper/PdfCanvasViewer.tsx', 'utf8');
  assert.doesNotMatch(viewer, /cdn\.jsdelivr|unpkg\.com/);
  for (const option of ['cMapUrl', 'standardFontDataUrl', 'wasmUrl']) assert.ok(viewer.includes(option));
});

test('development middleware sends executable MIME for PDF wasm fallback scripts', async () => {
  const { resolveConfig } = await import('vite');
  const { Writable } = await import('node:stream');
  const { once } = await import('node:events');
  const config = await resolveConfig({}, 'serve');
  const plugin = config.plugins.find(plugin => plugin.name === 'pdfjs-offline-resources');
  let middleware;
  plugin.configureServer({ middlewares: { use(handler) { middleware = handler; } } });
  const files = readdirSync('node_modules/pdfjs-dist/wasm');
  for (const [extension, mime] of [['.js', 'text/javascript'], ['.wasm', 'application/wasm']]) {
    const file = files.find(name => name.endsWith(extension));
    assert.ok(file);
    const response = new Writable({ write(_chunk, _encoding, done) { done(); } });
    const headers = {};
    response.setHeader = (name, value) => { headers[name] = value; };
    const finished = once(response, 'finish');
    middleware({ url: `/pdfjs/wasm/${file}` }, response, () => assert.fail('asset was not served'));
    await finished;
    assert.equal(headers['Content-Type'], mime);
  }
});
