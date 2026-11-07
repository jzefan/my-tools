import type { Plugin } from 'vite';
import type { NetdiskSource } from './src/types/netdisk.ts';
import { buildNetdiskRequest } from './src/utils/netdisk.ts';

/** Same-origin development transport. Packaged desktop builds use Rust HTTP. */
export function netdiskDevProxy(): Plugin {
  return {
    name: 'netdisk-development-transport',
    configureServer(server) {
      server.middlewares.use('/__netdisk/search', async (request, response) => {
        response.setHeader('Content-Type', 'application/json; charset=utf-8');
        response.setHeader('Cache-Control', 'no-store');
        const fail = (message: string, status = 502) => { if (!response.destroyed) { response.statusCode = status; response.end(JSON.stringify({ error: message })); } };
        if (request.method !== 'POST') return fail('仅支持 POST', 405);
        const origin = request.headers.origin;
        if (origin && new URL(origin).host !== request.headers.host) return fail('来源无效', 403);
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 22_000);
        response.once('close', () => controller.abort());
        try {
          let input = '';
          for await (const chunk of request) {
            input += chunk.toString();
            if (input.length > 8192) return fail('请求过大', 413);
          }
          const data = JSON.parse(input);
          if (!['pansou', 'pansearch', 'qupansou', 'melost', 'qkpanso'].includes(data.kind) || typeof data.keyword !== 'string' || !data.keyword.trim() || [...data.keyword].length > 120 || typeof data.baseUrl !== 'string' || (data.cloudType !== undefined && !['', 'baidu', 'aliyun'].includes(data.cloudType))) return fail('请求参数无效', 400);
          const source = { kind: data.kind, baseUrl: data.baseUrl } as NetdiskSource;
          const upstream = buildNetdiskRequest(source, data.keyword.trim(), !!data.refresh, data.cloudType || '');
          const headers: Record<string, string> = { Accept: data.kind === 'pansearch' ? 'text/html' : 'application/json', 'User-Agent': 'Mozilla/5.0 DocTools/1.0' };
          if (upstream.body) headers['Content-Type'] = 'application/json';
          Object.assign(headers, upstream.headers);
          if (data.kind === 'pansou' && typeof data.token === 'string' && data.token.trim()) headers.Authorization = `Bearer ${data.token.trim()}`;
          const result = await fetch(upstream.url, { method: upstream.body ? 'POST' : 'GET', headers, body: upstream.body, signal: controller.signal, credentials: 'omit' });
          if (!result.ok) return fail(result.status === 401 || result.status === 403 ? '服务需要认证或拒绝访问' : result.status === 429 ? '搜索过于频繁，请稍后重试' : `服务返回 HTTP ${result.status}`);
          let size = 0;
          const chunks: Uint8Array[] = [];
          const reader = result.body?.getReader();
          if (!reader) return fail('响应为空');
          try {
            while (true) {
              const chunk = await reader.read(); if (chunk.done) break;
              size += chunk.value.length;
              if (size > 8 * 1024 * 1024) { await reader.cancel(); return fail('搜索响应过大'); }
              chunks.push(chunk.value);
            }
          } finally { reader.releaseLock(); }
          const joined = new Uint8Array(size); let offset = 0;
          for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.length; }
          const text = new TextDecoder().decode(joined);
          let payload: unknown;
          if (data.kind === 'pansearch') {
            const match = text.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
            if (!match) return fail('搜索源页面结构已变化');
            payload = JSON.parse(match[1]);
          } else payload = JSON.parse(text);
          if (!response.destroyed) response.end(JSON.stringify(payload));
        } catch (error) {
          fail(controller.signal.aborted ? '连接超时或搜索已取消' : error instanceof SyntaxError ? '搜索源未返回有效数据' : '连接失败，请检查网络或服务地址');
        } finally { clearTimeout(timeout); }
      });
    },
  };
}
