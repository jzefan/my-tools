import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const source = ts.transpileModule(fs.readFileSync(new URL('../src/utils/paperAi.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { generatePaperOverview, askPaperQuestion } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const config = { apiKey: 'test-key', endpoint: 'https://invalid.example', model: 'mock' };
const pages = [{ pageNo: 7, text: '明代海运史，无机器学习或实验。' }];
const overview = () => generatePaperOverview('id', '海运史', pages, config);
const reply = value => { globalThis.fetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(value) } }] }) }); };
const valid = () => Object.fromEntries(['researchQuestion', 'method', 'experimentalDesign', 'keyFindings', 'limitations', 'takeaways'].map(key => [key, { content: '原文未涉及实验。', category: 'model_synthesis', evidenceQuote: pages[0].text, pageNo: 7 }]));
test('AI errors and source evidence validation', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = () => { throw new Error('unexpected network'); };
    await assert.rejects(generatePaperOverview('id', '海运史', pages), /配置/);
    await assert.rejects(askPaperQuestion('海运史', '有什么结论', '', pages[0].text), /配置/);
    globalThis.fetch = async () => ({ ok: false, status: 401 });
    await assert.rejects(overview(), /HTTP 401/);
    await assert.rejects(askPaperQuestion('海运史', '问题', '', '', undefined, config), /HTTP 401/);
    reply({}); await assert.rejects(overview(), /字段无效/);
    const forged = valid(); forged.method.evidenceQuote = 'F1 increased by 99%';
    reply(forged); await assert.rejects(overview(), /引文无法/);
    const wrongPage = valid(); wrongPage.method.pageNo = 1;
    reply(wrongPage); await assert.rejects(overview(), /引文无法/);
    reply(valid()); const result = await overview();
    assert.equal(result.sections.length, 6);
    assert.equal(result.sections[1].evidence[0].pageNo, 7);
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ choices: [] }) });
    await assert.rejects(overview(), /空内容/);
    globalThis.fetch = async () => { throw new Error('offline'); };
    await assert.rejects(overview(), /offline/);
  } finally { globalThis.fetch = original; }
});
