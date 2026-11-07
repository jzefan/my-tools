import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const source = ts.transpileModule(fs.readFileSync(new URL('../src/utils/format.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { getPathBasename, getPathBreadcrumbs, pathWithoutExtension, generateDefaultOutputPath,
  generateDefaultConvertOutputPath, generateDefaultPdfToImageDir, generateDefaultMergeOutputPath,
  generateDefaultInsertOutputPath } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

test('Windows drive, UNC and extended paths preserve navigable roots', () => {
  for (const [path, expected] of [
    ['C:\\Users\\JZ\\Docs', ['C:\\', 'C:\\Users', 'C:\\Users\\JZ', 'C:\\Users\\JZ\\Docs']],
    ['C:/Users/JZ', ['C:\\', 'C:\\Users', 'C:\\Users\\JZ']],
    ['C:\\', ['C:\\']],
    ['\\\\server\\share\\folder', ['\\\\server\\share\\', '\\\\server\\share\\folder']],
    ['\\\\?\\C:\\Docs', ['\\\\?\\C:\\', '\\\\?\\C:\\Docs']],
    ['\\\\?\\UNC\\server\\share\\folder', ['\\\\?\\UNC\\server\\share\\', '\\\\?\\UNC\\server\\share\\folder']],
    ['/Users/JZ/Docs', ['/Users', '/Users/JZ', '/Users/JZ/Docs']],
    ['/', []],
  ]) assert.deepEqual(getPathBreadcrumbs(path).map(c => c.path), expected, path);
});

test('basenames handle both separators without exposing the full Windows path', () => {
  for (const path of ['C:\\Users\\JZ\\文件.pdf', '\\\\server\\share\\文件.pdf', '/Users/JZ/文件.pdf']) {
    assert.equal(getPathBasename(path), '文件.pdf');
  }
  assert.equal(getPathBasename('C:\\Users\\Docs\\'), 'Docs');
});

test('output paths only strip a filename extension, never a dotted directory', () => {
  for (const directory of ['C:\\version.2\\', '\\\\server\\share.2\\', '/tmp/version.2/']) {
    const plain = `${directory}document`;
    assert.equal(pathWithoutExtension(plain), plain);
    assert.equal(generateDefaultOutputPath(plain, 'compressed'), `${plain}_compressed.pdf`);
    assert.equal(generateDefaultConvertOutputPath(plain, 'docx'), `${plain}_converted.docx`);
    assert.equal(generateDefaultPdfToImageDir(plain), `${plain}_images`);
    assert.match(generateDefaultInsertOutputPath(plain), new RegExp(`_已插入_\\d{8}_\\d{4}\\.pdf$`));
    assert.equal(pathWithoutExtension(`${plain}.pdf`), plain);
  }
  assert.equal(pathWithoutExtension('/tmp/.hidden'), '/tmp/.hidden');
  assert.match(generateDefaultMergeOutputPath('C:\\'), /^C:\\合并文档_\d{8}_\d{4}\.pdf$/);
  assert.match(generateDefaultMergeOutputPath('\\\\server\\share\\'), /^\\\\server\\share\\合并文档_\d{8}_\d{4}\.pdf$/);
  assert.match(generateDefaultMergeOutputPath('/'), /^\/合并文档_\d{8}_\d{4}\.pdf$/);
});
