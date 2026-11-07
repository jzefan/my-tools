import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const moduleUrl = path => 'data:text/javascript;base64,' + Buffer.from(ts.transpileModule(fs.readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText).toString('base64');
const reader = await import(moduleUrl('../src/utils/paperReader.ts'));
const citations = await import(moduleUrl('../src/utils/citations.ts'));
const outline = await import(moduleUrl('../src/utils/paperOutline.ts'));
const geometry = await import(moduleUrl('../src/utils/paperGeometry.ts'));
const ai = await import(moduleUrl('../src/utils/paperAi.ts'));
const config = { provider: 'deepseek', model: 'test', apiKey: 'secret', endpoint: 'https://test.invalid', temperature: 0 };

test('source search folds typography without conflating mathematics', () => {
  assert.equal(reader.findPaperMatches([{ pageNo: 2, text: 'oﬃce non\u2011linear 10²' }], 'office').length, 1);
  assert.equal(reader.findPaperMatches([{ pageNo: 2, text: '10²' }], '102').length, 0);
  assert.equal(reader.findPaperMatches([{ pageNo: 2, text: 'word' }], '   ').length, 0);
  assert.equal(reader.clampPaperPage(999, 3), 3);
  assert.equal(reader.clampPaperPage(NaN, 3), 1);
});

test('references terminate at appendix and duplicate numbers remain ambiguous', () => {
  const refs = citations.extractNumberedReferences([{ pageNo: 3, text: 'References\n[1] J. Doe and R. Patel. A study. 2024.\n[1] Another author. Other study. 2023.\nSupplementary Materials and Methods\n[2] Not a reference.' }]);
  assert.equal(refs.length, 2);
  assert.equal(refs[0].firstAuthor, 'J. Doe');
  const match = citations.matchCitationWithReferences({ numbers: [1, 2] }, refs);
  assert.equal(match.candidates.length, 2);
  assert(match.candidates.every(candidate => candidate.confidence === 'low'));
  assert.deepEqual(match.unmatchedNumbers, [2]);
  assert.equal(citations.normalizeAcademicExternalUrl('http://dx.doi.org/10.1000/test'), 'https://doi.org/10.1000/test');
  assert.throws(() => citations.normalizeAcademicExternalUrl('javascript:alert(1)'));
  assert.throws(() => citations.normalizeAcademicExternalUrl('https://doi.org.evil.invalid/10.1000/test'));
});

test('native PDF outline preserves groups and survives damaged destinations', async () => {
  const entries = await outline.readPdfOutline({ numPages: 5, getOutline: async () => [
    { title: 'Group', dest: null, items: [{ title: 'Child', dest: 'child', items: [] }] },
    { title: 'Bad', dest: [99], items: [] }, { title: 'Valid', dest: [0], items: [] }],
    getDestination: async () => [{ num: 9, gen: 0 }], getPageIndex: async () => 3 });
  assert.deepEqual(entries.map(entry => [entry.title, entry.pageNo]), [['Group', null], ['Child', 4], ['Valid', 1]]);
});

test('canonical annotation geometry round trips through rotation', () => {
  const canonical = { width: 100, height: 200, convertToPdfPoint: (x, y) => [x, y], convertToViewportPoint: (x, y) => [x, y] };
  const active = { width: 400, height: 200, convertToPdfPoint: (x, y) => [y / 2, (400 - x) / 2], convertToViewportPoint: (x, y) => [400 - y * 2, x * 2] };
  const rect = { x: .1, y: .2, width: .3, height: .1 };
  const projected = geometry.projectCanonicalRect(rect, canonical, active);
  const [roundTrip] = geometry.normalizeRectsToCanonical([{ left: projected.x * 400, top: projected.y * 200, right: (projected.x + projected.width) * 400, bottom: (projected.y + projected.height) * 200, width: projected.width * 400, height: projected.height * 200 }], { left: 0, top: 0, right: 400, bottom: 200, width: 400, height: 200 }, active, canonical);
  for (const key of Object.keys(rect)) assert(Math.abs(roundTrip[key] - rect[key]) < 1e-8);
  assert.equal(geometry.joinSelectedText(['multi-', 'page selection']), 'multi-page selection');
});

test('overview retains late sections and drops unsupported author claims', async () => {
  const pages = Array.from({ length: 800 }, (_, i) => ({ pageNo: i + 1, text: 'x'.repeat(2000) }));
  assert.equal(ai.overviewSource(pages).at(-1).pageNo, 800);
  const previous = globalThis.fetch;
  try {
    const output = Object.fromEntries(['researchQuestion', 'method', 'experimentalDesign', 'keyFindings', 'limitations', 'takeaways'].map(key => [key, [{ content: 'unsupported', category: 'author_claim', evidence: [] }, { content: 'model synthesis', category: 'model_synthesis', evidence: [] }]]));
    globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(output) } }] }));
    const result = await ai.generatePaperOverview('p', 't', [{ pageNo: 1, text: 'source' }], config);
    assert.equal(result.rejectedCount, 6);
    assert(result.sections.every(section => section.claims.length === 1));
  } finally { globalThis.fetch = previous; }
});

test('streamed QA validates every reference and honors context opt-outs', async () => {
  const previous = globalThis.fetch;
  const pages = [{ pageNo: 7, text: 'evidence from the source' }];
  try {
    let payload;
    globalThis.fetch = async (_url, options) => {
      payload = JSON.parse(options.body);
      const chunks = ['data: {"choices":[{"delta":{"reasoning_content":"thinking"}}]}\r\n\r\n', 'data: {"choices":[{"delta":{"content":"Answer [source:p.7]"}}]}\n\n', 'data: [DONE]'];
      return new Response(new ReadableStream({ start(controller) { const encoder = new TextEncoder(); for (const chunk of chunks) { const bytes = encoder.encode(chunk); controller.enqueue(bytes.slice(0, 5)); controller.enqueue(bytes.slice(5)); } controller.close(); } }), { headers: { 'Content-Type': 'text/event-stream' } });
    };
    const deltas = [], thoughts = [];
    const result = await ai.answerPaperQuestion({ title: 't', question: 'q', pages }, config, { onDelta: text => deltas.push(text), onReasoning: text => thoughts.push(text) });
    assert.equal(result.status, 'verified'); assert.equal(deltas.at(-1), 'Answer [source:p.7]'); assert.equal(thoughts.at(-1), 'thinking');
    globalThis.fetch = async (_url, options) => { payload = JSON.parse(options.body); return new Response(JSON.stringify({ choices: [{ message: { content: 'Valid [source:p.7], forged [source:p.8]' } }] })); };
    const invalid = await ai.answerPaperQuestion({ title: 't', question: 'q', pages }, config);
    assert.equal(invalid.status, 'invalid'); assert.equal(invalid.evidence.length, 0);
    await ai.answerPaperQuestion({ title: 't', question: 'q', pages, selection: { text: 'private selection', pageNo: 7, rects: [], screenshot: 'private image' }, includeSelection: false, includeNearby: false, includeScreenshot: false }, config);
    assert(!JSON.stringify(payload).includes('private')); assert(!JSON.stringify(payload).includes('evidence from the source'));
    const controller = new AbortController(); controller.abort();
    globalThis.fetch = async (_url, options) => { assert(options.signal.aborted); throw new DOMException('Aborted', 'AbortError'); };
    await assert.rejects(ai.answerPaperQuestion({ title: 't', question: 'q', pages }, config, { signal: controller.signal }), /Aborted/);
  } finally { globalThis.fetch = previous; }
});

test('Markdown retains QA fields and evidence while excluding another paper', () => {
  const markdown = reader.paperMarkdown({ id: 'p', title: 'T' }, [{ paperId: 'p', pageNo: 2, type: 'ai_qa', selectedText: 'source', question: 'q', answer: 'a', noteText: '', qaState: 'verified', evidence: [{ pageNo: 3, quote: 'proof' }] }, { paperId: 'other', selectedText: 'must not appear' }]);
  assert(markdown.includes('问题：q')); assert(markdown.includes('proof')); assert(!markdown.includes('must not appear'));
});
