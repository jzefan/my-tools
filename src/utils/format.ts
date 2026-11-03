export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
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
  const dotIndex = inputPath.lastIndexOf('.');
  if (dotIndex === -1) return `${inputPath}_${suffix}.pdf`;
  const base = inputPath.substring(0, dotIndex);
  return `${base}_${suffix}.pdf`;
}

export function generateDefaultConvertOutputPath(inputPath: string, targetExt: 'docx' | 'pdf'): string {
  const dotIndex = inputPath.lastIndexOf('.');
  if (dotIndex === -1) return `${inputPath}_converted.${targetExt}`;
  const base = inputPath.substring(0, dotIndex);
  return `${base}_converted.${targetExt}`;
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
