import { describe, expect, it } from 'vitest';
import { maskSecretsForModel, restoreSecretsFromModel, scanSecrets } from './secret-protection';

const STRIPE_KEY = `sk_test_${'A'.repeat(24)}`;
const DATA_PATH = '/scripts/character/scripts/script-1/data.yaml';

describe('script data secret protection', () => {
  it('只遮罩官方规则命中的精确区间，并可用未改动占位符恢复原值', async () => {
    const content = `public: hello\nstripe: ${STRIPE_KEY}\nend: world\n`;
    const result = await maskSecretsForModel(content, DATA_PATH);
    expect(result.findings).toHaveLength(1);
    expect(result.maskedContent).not.toContain(STRIPE_KEY);
    expect(result.maskedContent).toMatch(/stripe: <<DCA_SECRET:[a-f0-9]{20}>>/u);
    const candidate = result.maskedContent.replace('public: hello', 'public: changed');
    const restored = await restoreSecretsFromModel(content, candidate, DATA_PATH);
    expect(restored.content).toContain(STRIPE_KEY);
    expect(restored.content).toContain('public: changed');
    expect(restored.removed).toEqual([]);
  });

  it('拒绝损坏、复制或调换占位符，并记录显式删除', async () => {
    const second = `sk_test_${'B'.repeat(24)}`;
    const content = `a: ${STRIPE_KEY}\nb: ${second}\n`;
    const masked = await maskSecretsForModel(content, DATA_PATH);
    const tokens = [...masked.maskedContent.matchAll(/<<DCA_SECRET:[a-f0-9]{20}>>/gu)].map(match => match[0]);
    await expect(restoreSecretsFromModel(content, `a: ${tokens[1]}\nb: ${tokens[0]}\n`, DATA_PATH)).rejects.toThrow(
      '相对位置已移动',
    );
    await expect(restoreSecretsFromModel(content, `a: ${tokens[0]}\nb: ${tokens[0]}\n`, DATA_PATH)).rejects.toThrow(
      '不能复制',
    );
    await expect(
      restoreSecretsFromModel(content, masked.maskedContent.replace(tokens[0], '<<DCA_SECRET:broken>>'), DATA_PATH),
    ).rejects.toThrow('已损坏');
    const removed = await restoreSecretsFromModel(content, `a: removed\nb: ${tokens[1]}\n`, DATA_PATH);
    expect(removed.removed).toHaveLength(1);
  });

  it('不扫描 data.yaml 以外的文件', async () => {
    expect(await maskSecretsForModel(STRIPE_KEY, '/character/definition/description.md')).toEqual({
      findings: [],
      maskedContent: STRIPE_KEY,
    });
    expect(await scanSecrets(`key: ${STRIPE_KEY}`, DATA_PATH)).toHaveLength(1);
  });
});
