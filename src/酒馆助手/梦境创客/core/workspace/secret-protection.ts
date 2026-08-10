import { lintSource } from '@secretlint/core';
import { creator as anthropicRule } from '@secretlint/secretlint-rule-anthropic';
import { creator as awsRule } from '@secretlint/secretlint-rule-aws';
import { creator as basicAuthRule } from '@secretlint/secretlint-rule-basicauth';
import { creator as databaseRule } from '@secretlint/secretlint-rule-database-connection-string';
import { creator as gcpRule } from '@secretlint/secretlint-rule-gcp';
import { creator as githubRule } from '@secretlint/secretlint-rule-github';
import { creator as gitlabRule } from '@secretlint/secretlint-rule-gitlab';
import { creator as openaiRule } from '@secretlint/secretlint-rule-openai';
import { creator as privateKeyRule } from '@secretlint/secretlint-rule-privatekey';
import { creator as slackRule } from '@secretlint/secretlint-rule-slack';
import { creator as stripeRule } from '@secretlint/secretlint-rule-stripe';
import { sha256 } from '../transaction/canonical';

export type SecretFinding = {
  end: number;
  endColumn: number;
  endLine: number;
  ruleId: string;
  start: number;
  startColumn: number;
  startLine: number;
};

export type SecretMaskResult = {
  findings: SecretFinding[];
  maskedContent: string;
  warning?: string;
};

export type SecretRestoreResult = {
  content: string;
  removed: SecretFinding[];
  warning?: string;
};

const PLACEHOLDER = /<<DCA_SECRET:([a-f0-9]{20})>>/gu;
const PLACEHOLDER_LIKE = /<<DCA_SECRET:[^>\r\n]*>>/gu;
const rules = [
  ['openai', openaiRule],
  ['anthropic', anthropicRule],
  ['aws', awsRule],
  ['gcp', gcpRule],
  ['github', githubRule],
  ['gitlab', gitlabRule],
  ['private-key', privateKeyRule],
  ['basic-auth', basicAuthRule],
  ['database-connection-string', databaseRule],
  ['slack', slackRule],
  ['stripe', stripeRule],
].map(([id, rule]) => ({ id, rule }));

export function isProtectedScriptDataPath(path: string): boolean {
  return /^\/tavern-helper-scripts\/(?:character|global|preset-current)\/scripts\/[^/]+\/data\.yaml$/u.test(path);
}

function normalizedFindings(
  messages: Awaited<ReturnType<typeof lintSource>>['messages'],
): SecretFinding[] {
  const sorted = messages
    .map(message => ({
      end: message.range[1],
      endColumn: message.loc.end.column,
      endLine: message.loc.end.line,
      ruleId: message.ruleId,
      start: message.range[0],
      startColumn: message.loc.start.column,
      startLine: message.loc.start.line,
    }))
    .sort((left, right) => left.start - right.start || right.end - left.end);
  const result: SecretFinding[] = [];
  for (const finding of sorted) {
    const previous = result.at(-1);
    if (!previous || finding.start >= previous.end) {
      result.push(finding);
      continue;
    }
    if (finding.end > previous.end) {
      previous.end = finding.end;
      previous.endColumn = finding.endColumn;
      previous.endLine = finding.endLine;
    }
    if (!previous.ruleId.includes(finding.ruleId)) previous.ruleId += `,${finding.ruleId}`;
  }
  return result;
}

export async function scanSecrets(content: string, path: string): Promise<SecretFinding[]> {
  const result = await lintSource({
    options: {
      config: { rules } as Parameters<typeof lintSource>[0]['options']['config'],
      locale: 'en',
      maskSecrets: true,
      noPhysicFilePath: true,
    },
    source: { content, contentType: 'text', ext: '.yaml', filePath: path },
  });
  return normalizedFindings(result.messages);
}

async function placeholderFor(path: string, finding: SecretFinding, value: string): Promise<string> {
  const fingerprint = await sha256(`${path}\u0000${finding.start}\u0000${finding.end}\u0000${value}`);
  return `<<DCA_SECRET:${fingerprint.slice(0, 20)}>>`;
}

export async function maskSecretsForModel(content: string, path: string): Promise<SecretMaskResult> {
  if (!isProtectedScriptDataPath(path)) return { findings: [], maskedContent: content };
  try {
    const findings = await scanSecrets(content, path);
    const replacements = await Promise.all(
      findings.map(async finding => ({
        ...finding,
        placeholder: await placeholderFor(path, finding, content.slice(finding.start, finding.end)),
      })),
    );
    let maskedContent = content;
    for (const finding of replacements.toReversed()) {
      maskedContent = `${maskedContent.slice(0, finding.start)}${finding.placeholder}${maskedContent.slice(finding.end)}`;
    }
    return { findings, maskedContent };
  } catch {
    return {
      findings: [],
      maskedContent: content,
      warning: '敏感信息检测暂时不可用；本次按原文返回，请谨慎处理 data.yaml。',
    };
  }
}

export async function restoreSecretsFromModel(
  currentContent: string,
  candidateContent: string,
  path: string,
): Promise<SecretRestoreResult> {
  if (!isProtectedScriptDataPath(path)) return { content: candidateContent, removed: [] };
  const masked = await maskSecretsForModel(currentContent, path);
  if (masked.warning) return { content: candidateContent, removed: [], warning: masked.warning };
  const expected = new Map<string, { finding: SecretFinding; value: string }>();
  for (const finding of masked.findings) {
    const value = currentContent.slice(finding.start, finding.end);
    expected.set(await placeholderFor(path, finding, value), { finding, value });
  }
  const placeholders = [...candidateContent.matchAll(PLACEHOLDER)].map(match => match[0]);
  const placeholderLike = [...candidateContent.matchAll(PLACEHOLDER_LIKE)].map(match => match[0]);
  if (placeholderLike.length !== placeholders.length || placeholders.some(token => !expected.has(token))) {
    throw new Error('敏感占位符已损坏、来自其他资源或无法验证；请重新读取该 data.yaml 后再修改。');
  }
  if (new Set(placeholders).size !== placeholders.length) {
    throw new Error('敏感占位符不能复制；请重新读取该 data.yaml 后再修改。');
  }
  const expectedOrder = [...expected.keys()].filter(token => placeholders.includes(token));
  if (expectedOrder.some((token, index) => token !== placeholders[index])) {
    throw new Error('敏感占位符的相对位置已移动；请重新读取该 data.yaml 后再修改。');
  }
  let content = candidateContent;
  for (const token of placeholders) content = content.replace(token, expected.get(token)!.value);
  return {
    content,
    removed: [...expected.entries()].filter(([token]) => !placeholders.includes(token)).map(([, value]) => value.finding),
  };
}

