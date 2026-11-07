import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
// @ts-expect-error type error without @types/node package
import process from "node:process";

// @ts-expect-error node types are not part of the frontend dependency set
import fs from "node:fs";
// @ts-expect-error node types are not part of the frontend dependency set
import path from "node:path";
// @ts-expect-error node types are not part of the frontend dependency set
import { fileURLToPath } from "node:url";
import { netdiskDevProxy } from './vite.netdisk.ts';

function pdfjsResources(): Plugin {
  const root = fileURLToPath(new URL('./node_modules/pdfjs-dist/', import.meta.url));
  const directories = ['cmaps', 'standard_fonts', 'wasm'];
  return {
    name: 'pdfjs-offline-resources',
    generateBundle() {
      for (const directory of directories) {
        for (const file of fs.readdirSync(path.join(root, directory), { withFileTypes: true })) {
          if (file.isFile()) this.emitFile({ type: 'asset', fileName: `pdfjs/${directory}/${file.name}`,
            source: fs.readFileSync(path.join(root, directory, file.name)) });
        }
      }
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const pathname = new URL(request.url || '/', 'http://localhost').pathname;
        const match = /^\/pdfjs\/(cmaps|standard_fonts|wasm)\/([^/]+)$/.exec(pathname);
        if (!match) return next();
        let filename: string;
        try { filename = decodeURIComponent(match[2]); } catch { response.statusCode = 400; response.end(); return; }
        if (filename.includes('/') || filename.includes('\\') || filename === '..') { response.statusCode = 400; response.end(); return; }
        const target = path.join(root, match[1], filename);
        if (!fs.existsSync(target) || !fs.statSync(target).isFile()) { response.statusCode = 404; response.end(); return; }
        const contentType = /\.m?js$/.test(filename) ? 'text/javascript'
          : filename.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream';
        response.setHeader('Content-Type', contentType);
        const stream = fs.createReadStream(target);
        stream.on('error', () => { response.statusCode = 500; response.end(); });
        stream.pipe(response);
      });
    },
  };
}

const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const suiteTarget = process.env.VITE_SUITE_TARGET || (['docs', 'paper', 'cleaner', 'netdisk', 'typing'].includes(mode) ? mode : 'all');

  return {
    define: {
      'import.meta.env.VITE_SUITE_TARGET': JSON.stringify(suiteTarget),
    },
    plugins: [react(), tailwindcss(), pdfjsResources(), netdiskDevProxy()],

    // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
    //
    // 1. prevent Vite from obscuring rust errors
    clearScreen: false,
    // 2. tauri expects a fixed port, fail if that port is not available
    server: {
      port: 1420,
      strictPort: true,
      host: host || false,
      hmr: host
        ? {
            protocol: "ws",
            host,
            port: 1421,
          }
        : undefined,
      watch: {
        // 3. tell Vite to ignore watching `src-tauri`
        ignored: ["**/src-tauri/**"],
      },
    },
  };
});
