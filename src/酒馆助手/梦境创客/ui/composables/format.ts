// 通用格式化纯函数。

export function formatBytes(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_024 ** 2) return `${(bytes / 1_024).toFixed(1)} KB`;
  if (bytes < 1_024 ** 3) return `${(bytes / 1_024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1_024 ** 3).toFixed(1)} GB`;
}

export function formatTime(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function formatSessionDate(at: number): string {
  const value = new Date(at);
  const today = new Date();
  if (value.toDateString() === today.toDateString()) return `今天 ${formatTime(at)}`;
  return value.toLocaleDateString([], { day: 'numeric', month: 'short' });
}

export function shortId(value: string): string {
  return value.length > 18 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
}

export function pretty(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function downloadText(name: string, content: string, type: string): void {
  downloadBlob(name, new Blob([content], { type }));
}

export function downloadBytes(name: string, content: Uint8Array, type: string): void {
  downloadBlob(name, new Blob([Uint8Array.from(content).buffer], { type }));
}

function downloadBlob(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

/** 运行耗时：按天、时、分、秒取最前两个非零单位；不足一秒显示“不足1秒”。 */
export function formatRunDuration(durationMs: number): string {
  if (durationMs < 1_000) return '不足1秒';
  const totalSeconds = Math.floor(durationMs / 1_000);
  const units = [
    { label: '天', seconds: 86_400 },
    { label: '时', seconds: 3_600 },
    { label: '分', seconds: 60 },
    { label: '秒', seconds: 1 },
  ];
  let remaining = totalSeconds;
  const values: string[] = [];
  for (const unit of units) {
    const value = Math.floor(remaining / unit.seconds);
    remaining %= unit.seconds;
    if (value > 0) values.push(`${value}${unit.label}`);
    if (values.length === 2) break;
  }
  return values.join('');
}
