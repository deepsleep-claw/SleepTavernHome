export const BACKUP_FREQUENCIES = [
  { seconds: 30, label: '30 秒' },
  { seconds: 60, label: '1 分钟' },
  { seconds: 120, label: '2 分钟' },
  { seconds: 300, label: '5 分钟' },
  { seconds: 600, label: '10 分钟' },
] as const;

export function normalizeBackupFrequency(value: unknown): number {
  return BACKUP_FREQUENCIES.some(option => option.seconds === value) ? (value as number) : 120;
}
