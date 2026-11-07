export function getPathBasename(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '');
  return trimmed.slice(Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\')) + 1);
}

export function pathWithoutExtension(path: string): string {
  const basenameStart = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1;
  const dot = path.lastIndexOf('.');
  return dot > basenameStart ? path.slice(0, dot) : path;
}

export function getPathBreadcrumbs(path: string): { name: string; path: string }[] {
  if (!path) return [];
  const normalized = path.replace(/\\/g, '/');
  const windows = /^[a-z]:\//i.test(normalized) || normalized.startsWith('//');
  const separator = windows ? '\\' : '/';
  const rootMatch = normalized.match(/^(\/\/\?\/UNC\/[^/]+\/[^/]+|\/\/\?\/[a-z]:|\/\/[^/]+\/[^/]+|[a-z]:)(?:\/|$)/i);
  const root = rootMatch ? rootMatch[1].replace(/\//g, separator) + separator : normalized.startsWith('/') ? '/' : '';
  const rest = rootMatch ? normalized.slice(rootMatch[0].length) : normalized.replace(/^\/+/, '');
  const crumbs: { name: string; path: string }[] = rootMatch ? [{ name: root.replace(/[\\/]+$/, ''), path: root }] : [];
  let current = root;
  for (const name of rest.split('/').filter(Boolean)) {
    current += (current && !current.endsWith(separator) ? separator : '') + name;
    crumbs.push({ name, path: current });
  }
  return crumbs;
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(sizes.length - 1, Math.floor(Math.log(bytes) / Math.log(k)));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/** macOS「系统设置 › 储存空间」按十进制显示磁盘容量：1 GB = 1000³ 字节。 */
export function formatDiskSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const step = 1000;
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(step)));
  const value = bytes / step ** index;
  return `${index === 0 ? value.toFixed(0) : value.toFixed(2)} ${units[index]}`;
}

export function formatDate(timestamp: number): string {
  if (!timestamp) return '-';
  const date = new Date(timestamp * 1000);
  return date.toLocaleDateString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function generateDefaultMergeOutputPath(dir: string): string {
  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
  
  const separator = dir.includes('\\') ? '\\' : '/';
  const cleanDir = dir.endsWith(separator) ? dir.slice(0, -1) : dir;
  return `${cleanDir}${separator}合并文档_${timestamp}.pdf`;
}

export function generateDefaultOutputPath(inputPath: string, suffix: string): string {
  const base = pathWithoutExtension(inputPath);
  return `${base}_${suffix}.pdf`;
}

export function generateDefaultConvertOutputPath(inputPath: string, targetExt: 'docx' | 'pdf'): string {
  const base = pathWithoutExtension(inputPath);
  return `${base}_converted.${targetExt}`;
}

export function generateDefaultInsertOutputPath(targetPdfPath: string): string {
  const base = pathWithoutExtension(targetPdfPath);
  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
  return `${base}_已插入_${timestamp}.pdf`;
}

export function generateDefaultPdfToImageDir(pdfPath: string): string {
  const base = pathWithoutExtension(pdfPath);
  return base === pdfPath ? `${pdfPath}_images` : base;
}

export function getFileTypeBadge(extension: string): { label: string; color: string } {
  const ext = extension.toLowerCase();
  switch (ext) {
    case 'pdf':
      return { label: 'PDF', color: 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20' };
    case 'docx':
    case 'doc':
      return { label: 'WORD', color: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20' };
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'webp':
    case 'bmp':
    case 'tiff':
      return { label: 'IMG', color: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20' };
    default:
      return { label: ext.toUpperCase() || 'FILE', color: 'bg-gray-500/10 text-gray-600 dark:text-gray-400 border-gray-500/20' };
  }
}
