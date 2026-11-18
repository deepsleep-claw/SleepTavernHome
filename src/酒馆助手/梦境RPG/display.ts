import { classifyCheck, gradeLabels, gradeRanges, type CheckGrade } from './check';
import { describeDifficulty } from './difficulty';
import { answerTokens, checkTokens, type AnswerToken } from './protocol';

interface DisplayOptions {
  enabled: boolean;
  allowSecretReveal: boolean;
  showAnswerResults: boolean;
}
interface DisplayBinding {
  key: string;
  messageId: number;
}
interface DisplayDetails {
  mode?: string;
  grade?: CheckGrade | 'secret';
  title?: string;
  question?: string;
  value?: string;
  difficultyColor?: string;
  outcome?: { check: number; dc: number | 'unset'; secret: boolean };
  label?: string;
  numbers?: string;
  context?: string;
  masked?: boolean;
}
const actionSelector = '[data-drpg-answer]';
const resultSelector = '[data-drpg-check]';
const allSelector = `${actionSelector},${resultSelector}`;

function compatibleSelector(selector: string) {
  // 酒馆格式化消息时会为自定义样式类添加 custom- 前缀。
  return `${selector},${selector.replaceAll('.drpg-', '.custom-drpg-')}`;
}

function text(root: Element, selector: string, value: string) {
  const node = root.querySelector<HTMLElement>(compatibleSelector(selector));
  if (node && node.textContent !== value) node.textContent = value;
}

function hidden(root: Element, selector: string, value: boolean) {
  const node = root.querySelector<HTMLElement>(compatibleSelector(selector));
  if (node && node.hidden !== value) node.hidden = value;
}

function checkValue(token: AnswerToken): number | undefined {
  const value = token.attributes.check;
  const number = Number(value);
  return /^\d+$/.test(value ?? '') && number >= 1 && number <= 100 ? number : undefined;
}

function numberLabel(token: AnswerToken, check: number) {
  const dc = token.attributes.dc;
  if (dc === 'unset') return `判定 ${check}`;
  const target = Number(dc);
  return /^\d+$/.test(dc ?? '') && target >= 5 && target <= 95 ? `${check} / ${target}` : '';
}

function secretLabel(token: AnswerToken, check: number) {
  const grade = classifyCheck(Number(token.attributes.dc), check);
  const numbers = token.attributes.dc === 'unset' ? String(check) : numberLabel(token, check) || String(check);
  return `暗骰·${grade ? gradeLabels[grade] : '难度待定'}·${numbers}`;
}

function applyOutcome(root: HTMLElement, outcome: DisplayDetails['outcome']) {
  const row = root.querySelector<HTMLElement>(compatibleSelector('.drpg-action-outcome'));
  if (!row) return;
  if (!outcome) {
    if (!row.hidden) row.hidden = true;
    if (row.hasChildNodes()) row.replaceChildren();
    delete row.dataset.drpgOutcomeKey;
    return;
  }
  const { check, dc, secret } = outcome;
  const key = `${check}:${dc}:${secret}`;
  if (row.dataset.drpgOutcomeKey !== key) {
    const document = row.ownerDocument;
    const fragment = document.createDocumentFragment();
    if (dc === 'unset') {
      const dice = document.createElement('span');
      dice.textContent = `${secret ? '暗骰 · ' : ''}骰值 ${check}`;
      fragment.append(dice);
    }
    for (const { grade, min, max } of gradeRanges(check, dc)) {
      const line = document.createElement('span');
      line.style.setProperty('--drpg-outcome-color', `var(--drpg-check-${grade})`);
      line.textContent =
        dc === 'unset'
          ? `${gradeLabels[grade]} · 成功率 ${min === max ? min : `${min}–${max}`}%`
          : `${secret ? '暗骰 · ' : ''}${gradeLabels[grade]} · ${check} / ${dc}`;
      fragment.append(line);
    }
    row.replaceChildren(fragment);
    row.dataset.drpgOutcomeKey = key;
  }
  if (row.hidden) row.hidden = false;
}

function applyDetails(root: HTMLElement, details: DisplayDetails = {}) {
  for (const key of ['mode', 'grade'] as const) {
    const value = details[key];
    if (value === undefined) {
      if (key in root.dataset) delete root.dataset[key];
    } else if (root.dataset[key] !== value) root.dataset[key] = value;
  }
  const difficultyColor = details.difficultyColor ?? '';
  if (root.style.getPropertyValue('--drpg-difficulty-color') !== difficultyColor) {
    if (difficultyColor) root.style.setProperty('--drpg-difficulty-color', difficultyColor);
    else root.style.removeProperty('--drpg-difficulty-color');
  }
  if (details.title) {
    if (root.title !== details.title) root.title = details.title;
  } else if (root.hasAttribute('title')) root.removeAttribute('title');
  text(root, '.drpg-action-value', details.value ?? '');
  text(root, '.drpg-action-question', details.question ?? '');
  text(root, '.drpg-grade', details.label ?? '');
  text(root, '.drpg-result-numbers', details.numbers ?? '');
  text(root, '.drpg-secret-reveal', '[暗骰结果]');
  hidden(root, '.drpg-action-value', !details.value);
  hidden(root, '.drpg-action-question', !details.question);
  if (root.matches(actionSelector)) applyOutcome(root, details.outcome);
  hidden(root, '.drpg-grade', !details.label);
  hidden(root, '.drpg-result-numbers', !details.numbers);
  hidden(root, '.drpg-secret-reveal', !details.masked);
  hidden(root, '.drpg-result-meta', !details.label && !details.numbers && !details.masked);
  if (details.context !== undefined) {
    text(root, '.drpg-result-content', details.context);
    if (root.dataset.drpgContext !== 'true') root.dataset.drpgContext = 'true';
  } else if (root.dataset.drpgContext === 'true') {
    text(root, '.drpg-result-content', '');
    delete root.dataset.drpgContext;
  }
}

export function createRpgDisplay(options: () => DisplayOptions) {
  const host = window.parent;
  const document = host.document;
  const pending = new Set<number>();
  const revealed = new Set<string>();
  const bindings = new WeakMap<HTMLElement, DisplayBinding>();
  const cache = new Map<number, { source: string; answers: AnswerToken[]; checks: AnswerToken[] }>();
  const listeners: EventOnReturn[] = [];
  let timer: number | undefined;
  let destroyed = false;
  let firstGeneratingMessage: number | undefined;
  let streamFrame: { messageId: number; text: string } | undefined;
  let acceptStream = true;

  const floorId = (node: Node): number | undefined => {
    const element = node.nodeType === 1 ? (node as Element) : node.parentElement;
    const value = element?.closest('[mesid]')?.getAttribute('mesid');
    return value && /^\d+$/.test(value) ? Number(value) : undefined;
  };

  const actionDetails = (token: AnswerToken, current: DisplayOptions): DisplayDetails => {
    const { mode = 'open', q, dc } = token.attributes;
    const details: DisplayDetails = { mode, title: q, question: q };
    if (mode === 'none' || dc === 'none') return { ...details, value: '无需检定' };
    const secret = mode === 'secret';
    const check = current.showAnswerResults && (!secret || current.allowSecretReveal) ? checkValue(token) : undefined;
    if (dc === 'unset') {
      return { ...details, value: '[命运未定]', ...(check !== undefined && { outcome: { dc, check, secret } }) };
    }
    const difficulty = describeDifficulty(dc);
    if (secret && (check === undefined || !difficulty)) return { ...details, value: '暗骰未定' };
    return {
      ...details,
      value: difficulty?.text,
      difficultyColor: difficulty?.color,
      ...(difficulty && check !== undefined && { outcome: { dc: Number(dc), check, secret } }),
    };
  };

  const resultDetails = (token: AnswerToken, canReveal: boolean, isRevealed: boolean): DisplayDetails => {
    const details: DisplayDetails = {
      mode: token.attributes.mode ?? 'open',
      ...(!token.text && { context: token.attributes.q ?? '' }),
    };
    if (token.attributes.mode === 'none' || token.attributes.dc === 'none') return { ...details, label: '无需检定' };
    const check = checkValue(token);
    if (check === undefined) return details;
    const secret = token.attributes.mode === 'secret';
    if (secret && (!canReveal || !isRevealed)) {
      return { ...details, grade: 'secret', ...(canReveal ? { masked: true } : { label: '暗骰已定' }) };
    }
    const grade = classifyCheck(Number(token.attributes.dc), check);
    if (secret) return { ...details, grade, label: secretLabel(token, check) };
    const numbers = numberLabel(token, check);
    return {
      ...details,
      grade,
      label: grade ? gradeLabels[grade] : undefined,
      numbers: numbers ? `${grade ? '· ' : ''}${numbers}` : '',
    };
  };

  const annotate = (
    messageId: number,
    nodes: HTMLElement[],
    tokens: AnswerToken[],
    kind: 'answer' | 'check',
    current: DisplayOptions,
  ) => {
    const used = new Set<number>();
    const normalize = (value: string) => value.replace(/\s+/g, ' ').trim();
    for (const root of nodes) {
      const label = normalize(
        root.querySelector(compatibleSelector(kind === 'answer' ? '.drpg-action-content' : '.drpg-result-content'))
          ?.textContent ?? '',
      );
      let index = tokens.findIndex(
        (token, ordinal) =>
          !used.has(ordinal) && (normalize(token.text) === label || normalize(token.attributes.q ?? '') === label),
      );
      if (index < 0) index = tokens.findIndex((_token, ordinal) => !used.has(ordinal));
      if (index < 0) {
        applyDetails(root);
        bindings.delete(root);
        continue;
      }
      used.add(index);
      const token = tokens[index];
      const key = JSON.stringify([messageId, kind, index, token.raw]);
      bindings.set(root, { key, messageId });
      applyDetails(
        root,
        kind === 'answer'
          ? actionDetails(token, current)
          : resultDetails(token, current.allowSecretReveal, revealed.has(key)),
      );
    }
  };

  const updateMessage = (messageId: number, current: DisplayOptions) => {
    const root = retrieveDisplayedMessage(messageId)[0];
    if (!root) return;
    const answers = [...root.querySelectorAll<HTMLElement>(actionSelector)];
    const checks = [...root.querySelectorAll<HTMLElement>(resultSelector)];
    if (!answers.length && !checks.length) return;
    const frame = streamFrame?.messageId === messageId ? streamFrame : undefined;
    const streaming =
      frame !== undefined ||
      (firstGeneratingMessage !== undefined && messageId >= firstGeneratingMessage && messageId === getLastMessageId());
    if (!current.enabled) {
      [...answers, ...checks].forEach(node => {
        applyDetails(node);
        bindings.delete(node);
      });
      checks.forEach(node => node.toggleAttribute('data-drpg-complete', !streaming));
      return;
    }
    const message = getChatMessages(messageId)[0];
    if (!message) {
      [...answers, ...checks].forEach(node => {
        applyDetails(node);
        bindings.delete(node);
      });
      return;
    }
    let parsed = cache.get(messageId);
    if (parsed?.source !== message.message) {
      parsed = {
        source: message.message,
        answers: answerTokens(message.message),
        checks: checkTokens(message.message),
      };
      cache.set(messageId, parsed);
    }
    annotate(messageId, answers, parsed.answers, 'answer', current);
    const streamedChecks = frame && checks.length ? checkTokens(frame.text) : undefined;
    annotate(messageId, checks, streamedChecks?.length ? streamedChecks : parsed.checks, 'check', current);
    // 放开尺寸前先补齐结果，避免新替换的节点先以单行布局出现。
    checks.forEach(node => node.toggleAttribute('data-drpg-complete', !streaming));
  };

  const observe = () => observer.observe(document.body, { childList: true, characterData: true, subtree: true });
  const flush = () => {
    timer = undefined;
    if (destroyed) return;
    const current = options();
    if (!current.enabled || !current.allowSecretReveal) revealed.clear();
    const ids = [...pending];
    pending.clear();
    // 暂停观察自身写入，保留流式正文与组件原节点。
    observer.disconnect();
    try {
      for (const id of ids) {
        try {
          updateMessage(id, current);
        } catch (error) {
          console.warn('[梦境RPG] 暂未完成消息显示更新', error);
        }
      }
    } finally {
      if (!destroyed) observe();
    }
  };
  const schedule = (messageId: number) => {
    if (destroyed || !Number.isInteger(messageId) || messageId < 0) return;
    pending.add(messageId);
    if (timer === undefined) timer = host.setTimeout(flush, 32);
  };
  const refresh = () => {
    const current = options();
    if (!current.enabled || !current.allowSecretReveal) revealed.clear();
    for (const root of document.querySelectorAll(allSelector)) {
      const id = floorId(root);
      if (id !== undefined) schedule(id);
    }
  };
  const observer = new MutationObserver(records => {
    for (const record of records) {
      const id = floorId(record.target);
      if (id !== undefined) schedule(id);
      else
        for (const node of record.addedNodes) {
          if (node.nodeType !== 1) continue;
          const element = node as Element;
          const own = floorId(element);
          if (own !== undefined) schedule(own);
          for (const child of element.querySelectorAll('[mesid]')) {
            const childId = floorId(child);
            if (childId !== undefined) schedule(childId);
          }
        }
    }
  });
  const onClick = (event: MouseEvent) => {
    const target = event.target as Node | null;
    const element = target?.nodeType === 1 ? (target as Element) : target?.parentElement;
    const button = element?.closest(compatibleSelector('.drpg-secret-reveal'));
    const root = button?.closest<HTMLElement>(resultSelector);
    const current = options();
    if (!root || !current.enabled || !current.allowSecretReveal) return;
    const binding = bindings.get(root);
    if (!binding) return;
    event.preventDefault();
    event.stopPropagation();
    revealed.add(binding.key);
    schedule(binding.messageId);
  };
  document.addEventListener('click', onClick);
  observe();
  for (const event of [
    tavern_events.USER_MESSAGE_RENDERED,
    tavern_events.CHARACTER_MESSAGE_RENDERED,
    tavern_events.MESSAGE_RECEIVED,
    tavern_events.MESSAGE_EDITED,
    tavern_events.MESSAGE_UPDATED,
    tavern_events.MESSAGE_SWIPED,
  ]) {
    listeners.push(eventOn(event, schedule));
  }
  const endGeneration = () => {
    if (streamFrame) schedule(streamFrame.messageId);
    const last = getLastMessageId();
    if (firstGeneratingMessage !== undefined && last >= firstGeneratingMessage) schedule(last);
    streamFrame = undefined;
    firstGeneratingMessage = undefined;
    acceptStream = false;
  };
  listeners.push(
    eventOn(tavern_events.GENERATION_STARTED, (type, _options, dryRun) => {
      if (dryRun) return;
      const sameMessage = ['continue', 'swipe', 'regenerate'].includes(type);
      firstGeneratingMessage = getLastMessageId() + (sameMessage ? 0 : 1);
      streamFrame = undefined;
      acceptStream = true;
    }),
    eventOn(tavern_events.STREAM_TOKEN_RECEIVED, text => {
      if (!acceptStream) return;
      const messageId = getLastMessageId();
      if (streamFrame && streamFrame.messageId !== messageId) schedule(streamFrame.messageId);
      streamFrame = { messageId, text };
      schedule(messageId);
    }),
    eventOn(tavern_events.GENERATION_STOPPED, endGeneration),
    eventOn(tavern_events.GENERATION_ENDED, endGeneration),
    eventOn(tavern_events.CHAT_CHANGED, () => {
      streamFrame = undefined;
      firstGeneratingMessage = undefined;
      acceptStream = false;
      cache.clear();
      revealed.clear();
      refresh();
    }),
  );
  refresh();
  return {
    refresh,
    destroy() {
      destroyed = true;
      observer.disconnect();
      if (timer !== undefined) host.clearTimeout(timer);
      listeners.forEach(listener => listener.stop());
      document.removeEventListener('click', onClick);
      document.querySelectorAll<HTMLElement>(allSelector).forEach(node => {
        applyDetails(node);
        if (node.matches(resultSelector)) node.setAttribute('data-drpg-complete', '');
      });
      pending.clear();
      cache.clear();
      revealed.clear();
    },
  };
}
