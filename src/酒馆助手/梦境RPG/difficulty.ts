const difficultyLevels = [
  { label: '非常困难', color: 'var(--drpg-check-fumble, #7f2938)' },
  { label: '困难', color: 'var(--drpg-check-failure, #bd4b43)' },
  { label: '普通', color: 'var(--drpg-check-hard, #6a842b)' },
  { label: '简单', color: 'var(--drpg-check-extreme, #23734f)' },
  { label: '非常简单', color: 'var(--drpg-check-critical, #198f4c)' },
] as const;

export function describeDifficulty(dc: number | string | undefined) {
  if (typeof dc === 'string' && !/^\d+$/.test(dc)) return undefined;
  const probability = Number(dc);
  if (!Number.isInteger(probability) || probability < 5 || probability > 95) return undefined;
  // 成功率上限属于当前档位，例如 20% 仍归入非常困难。
  const level = difficultyLevels[Math.floor((probability - 1) / 20)];
  return { ...level, text: `${level.label} · ${probability}%` };
}
