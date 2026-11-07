import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
let executable = process.env.PAPER_TEST_ELECTRON;
if (!executable) {
  try { executable = createRequire(import.meta.url)('electron'); }
  catch { throw new Error('设置 PAPER_TEST_ELECTRON 为 Electron 可执行文件路径，先运行论文版 Vite 开发服务。'); }
}
const child = spawn(executable, [new URL('./paper-reader-runtime.cjs', import.meta.url).pathname], { stdio: 'inherit', env: process.env });
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
