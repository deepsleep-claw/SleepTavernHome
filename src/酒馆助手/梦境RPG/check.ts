export type CheckGrade = 'critical' | 'extreme' | 'hard' | 'regular' | 'failure' | 'fumble';

export const gradeLabels: Record<CheckGrade, string> = {
  critical: '大成功',
  extreme: '极难成功',
  hard: '困难成功',
  regular: '常规成功',
  failure: '失败',
  fumble: '大失败',
};

export function classifyCheck(dc: number, check: number): CheckGrade | undefined {
  if (!Number.isInteger(dc) || dc < 5 || dc > 95 || !Number.isInteger(check) || check < 1 || check > 100)
    return undefined;
  if (check <= 5) return 'critical';
  if (check <= Math.floor(dc / 5)) return 'extreme';
  if (check <= Math.floor(dc / 2)) return 'hard';
  if (check <= dc) return 'regular';
  return check >= 96 ? 'fumble' : 'failure';
}

export function gradeRanges(check: number, dc: number | 'unset') {
  const ranges: Array<{ grade: CheckGrade; min: number; max: number }> = [];
  const [min, max] = dc === 'unset' ? [5, 95] : [dc, dc];
  for (let target = min; target <= max; target++) {
    const grade = classifyCheck(target, check);
    if (!grade) continue;
    const prior = ranges.at(-1);
    if (prior?.grade === grade) prior.max = target;
    else ranges.push({ grade, min: target, max: target });
  }
  return ranges;
}
