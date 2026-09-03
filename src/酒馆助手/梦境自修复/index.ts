import { checkMinimumVersion } from '@util/common';
import {
  applyPatchText,
  DREAM_SELF_REPAIR_ACTION_EVENT,
  DREAM_SELF_REPAIR_RESULT_EVENT,
  DREAM_SELF_REPAIR_STATE_EVENT,
  DREAM_SELF_REPAIR_STATE_REQUEST_EVENT,
  DREAM_SELF_REPAIR_VARIABLE_KEY,
  extractLastSelfCheck,
  getRepairStatus,
  isRepairState,
  reversePatchRecords,
  type RepairAction,
  type RepairRunResult,
  type RepairState,
} from './core';

const SCRIPT_NAME = '梦境自修复';

type UiAction = Exclude<RepairAction, 'auto'>;

type UiActionDetail = {
  action: UiAction;
  message_id: number;
  patch_text?: string;
  request_id: string;
};

type UiStateRequestDetail = {
  message_id: number;
  request_id: string;
};

const pending_operations = new Map<number, Promise<void>>();

function getHostDocument(): Document {
  try {
    return window.parent.document;
  } catch {
    return document;
  }
}

function emitHostEvent(event_name: string, detail: unknown): void {
  const host_document = getHostDocument();
  const HostCustomEvent = host_document.defaultView?.CustomEvent ?? CustomEvent;
  host_document.dispatchEvent(new HostCustomEvent(event_name, { detail }));
}

function isMessageId(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function parseActionDetail(event: Event): UiActionDetail | undefined {
  const detail = (event as CustomEvent<unknown>).detail;
  if (!detail || typeof detail !== 'object') {
    return undefined;
  }

  const candidate = detail as Partial<UiActionDetail>;
  if (
    !isMessageId(candidate.message_id) ||
    (candidate.action !== 'repatch' && candidate.action !== 'reverse') ||
    typeof candidate.request_id !== 'string'
  ) {
    return undefined;
  }

  if (candidate.action === 'repatch' && typeof candidate.patch_text !== 'string') {
    return undefined;
  }

  return candidate as UiActionDetail;
}

function parseStateRequestDetail(event: Event): UiStateRequestDetail | undefined {
  const detail = (event as CustomEvent<unknown>).detail;
  if (!detail || typeof detail !== 'object') {
    return undefined;
  }

  const candidate = detail as Partial<UiStateRequestDetail>;
  if (!isMessageId(candidate.message_id) || typeof candidate.request_id !== 'string') {
    return undefined;
  }
  return candidate as UiStateRequestDetail;
}

function readRepairState(message: ChatMessage): RepairState | undefined {
  const state = message.data?.[DREAM_SELF_REPAIR_VARIABLE_KEY];
  return isRepairState(state) ? _.cloneDeep(state) : undefined;
}

function summarizeState(state: RepairState | undefined) {
  const records = state?.records ?? [];
  const reverted_count = records.filter(record => record.reverted).length;
  return {
    status: state?.status ?? 'idle',
    record_count: records.length,
    active_count: records.length - reverted_count,
    reverted_count,
    last_result: state?.last_result,
  };
}

function buildRunResult(
  action: RepairAction,
  result: { success_count: number; skipped_count: number; errors: string[] },
): RepairRunResult {
  return {
    action,
    success_count: result.success_count,
    skipped_count: result.skipped_count,
    errors: result.errors,
  };
}

async function saveRepairState(
  message: ChatMessage,
  repaired_message: string,
  state: RepairState,
  chat_id: string | undefined,
): Promise<void> {
  if (SillyTavern.getCurrentChatId() !== chat_id) {
    throw new Error('聊天已切换，本次自修复结果未写入。');
  }

  const data = _.cloneDeep(message.data ?? {});
  data[DREAM_SELF_REPAIR_VARIABLE_KEY] = state;
  await setChatMessages([{ message_id: message.message_id, message: repaired_message, data }], { refresh: 'affected' });
}

function enqueueMessageOperation(message_id: number, operation: () => Promise<void>): Promise<void> {
  const previous = pending_operations.get(message_id) ?? Promise.resolve();
  const current = previous
    .catch(() => undefined)
    .then(operation)
    .finally(() => {
      if (pending_operations.get(message_id) === current) {
        pending_operations.delete(message_id);
      }
    });
  pending_operations.set(message_id, current);
  return current;
}

function formatAttemptSummary(success_count: number, skipped_count: number): string {
  const skipped = skipped_count > 0 ? `，跳过 ${skipped_count} 条` : '';
  return `成功 ${success_count} 条${skipped}`;
}

async function applyRepair(message_id: number, patch_text: string, action: 'auto' | 'repatch'): Promise<RepairState> {
  const chat_id = SillyTavern.getCurrentChatId();
  const message = getChatMessages(message_id)[0];
  if (!message || message.role !== 'assistant') {
    throw new Error('目标楼层不是角色输出。');
  }

  const result = applyPatchText(message.message, patch_text);
  const old_state = readRepairState(message);
  const records = result.success_count > 0 ? result.records : (old_state?.records ?? []);
  const state: RepairState = {
    version: 1,
    status: getRepairStatus(records),
    records,
    last_result: buildRunResult(action, result),
  };

  await saveRepairState(message, result.success_count > 0 ? result.message : message.message, state, chat_id);

  const summary = formatAttemptSummary(result.success_count, result.skipped_count);
  if (result.success_count > 0) {
    console.info(`[${SCRIPT_NAME}] 第 ${message_id} 楼 ${summary}。`);
    if (action === 'repatch') {
      toastr.success(summary, SCRIPT_NAME);
    }
  } else {
    console.warn(`[${SCRIPT_NAME}] 第 ${message_id} 楼没有可应用的 Patch。`, result.errors);
    if (action === 'repatch') {
      toastr.warning(
        `没有可应用的 Patch${result.skipped_count ? `，跳过 ${result.skipped_count} 条` : ''}。`,
        SCRIPT_NAME,
      );
    }
  }

  return state;
}

async function reverseRepair(message_id: number): Promise<RepairState> {
  const chat_id = SillyTavern.getCurrentChatId();
  const message = getChatMessages(message_id)[0];
  if (!message || message.role !== 'assistant') {
    throw new Error('目标楼层不是角色输出。');
  }

  const old_state = readRepairState(message);
  if (!old_state || old_state.records.length === 0) {
    throw new Error('该楼层没有可反 Patch 的成功记录。');
  }

  const result = reversePatchRecords(message.message, old_state.records);
  const state: RepairState = {
    version: 1,
    status: getRepairStatus(result.records),
    records: result.records,
    last_result: buildRunResult('reverse', result),
  };

  await saveRepairState(message, result.success_count > 0 ? result.message : message.message, state, chat_id);

  const summary = formatAttemptSummary(result.success_count, result.skipped_count);
  if (result.success_count > 0) {
    toastr.success(`反 Patch ${summary}`, SCRIPT_NAME);
  } else if (state.status === 'reverted') {
    toastr.info('当前成功记录均已还原。', SCRIPT_NAME);
  } else {
    toastr.warning('没有找到可还原的 after 文本。', SCRIPT_NAME);
  }

  return state;
}

function emitActionResult(detail: UiActionDetail, ok: boolean, message: string, state?: RepairState): void {
  emitHostEvent(DREAM_SELF_REPAIR_RESULT_EVENT, {
    request_id: detail.request_id,
    message_id: detail.message_id,
    action: detail.action,
    ok,
    message,
    state: summarizeState(state),
  });
}

async function handleUiAction(detail: UiActionDetail): Promise<void> {
  try {
    const state =
      detail.action === 'repatch'
        ? await applyRepair(detail.message_id, detail.patch_text ?? '', 'repatch')
        : await reverseRepair(detail.message_id);
    emitActionResult(detail, true, '操作完成。', state);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[${SCRIPT_NAME}] UI 操作失败：`, error);
    toastr.error(message, SCRIPT_NAME);
    emitActionResult(detail, false, message);
  }
}

async function handleReceivedMessage(message_id: number): Promise<void> {
  const message = getChatMessages(message_id)[0];
  if (!message || message.role !== 'assistant') {
    return;
  }

  const self_check = extractLastSelfCheck(message.message);
  if (!self_check) {
    return;
  }

  await applyRepair(message_id, self_check.patch, 'auto');
}

function handleStateRequest(event: Event): void {
  const detail = parseStateRequestDetail(event);
  if (!detail) {
    return;
  }

  let state: RepairState | undefined;
  try {
    const message = getChatMessages(detail.message_id)[0];
    state = message ? readRepairState(message) : undefined;
  } catch (error) {
    console.warn(`[${SCRIPT_NAME}] 读取第 ${detail.message_id} 楼状态失败：`, error);
  }

  emitHostEvent(DREAM_SELF_REPAIR_STATE_EVENT, {
    request_id: detail.request_id,
    message_id: detail.message_id,
    state: summarizeState(state),
  });
}

$(() => {
  checkMinimumVersion('4.0.0', SCRIPT_NAME);

  const host_document = getHostDocument();
  const received_event = eventMakeLast(tavern_events.MESSAGE_RECEIVED, (message_id: number) => {
    void enqueueMessageOperation(message_id, () => handleReceivedMessage(message_id)).catch(error => {
      console.error(`[${SCRIPT_NAME}] 自动 Patch 失败：`, error);
      toastr.error(error instanceof Error ? error.message : String(error), SCRIPT_NAME);
    });
  });

  const action_listener = (event: Event) => {
    const detail = parseActionDetail(event);
    if (!detail) {
      return;
    }
    void enqueueMessageOperation(detail.message_id, () => handleUiAction(detail));
  };

  host_document.addEventListener(DREAM_SELF_REPAIR_ACTION_EVENT, action_listener);
  host_document.addEventListener(DREAM_SELF_REPAIR_STATE_REQUEST_EVENT, handleStateRequest);

  $(window).on('pagehide', () => {
    received_event.stop();
    host_document.removeEventListener(DREAM_SELF_REPAIR_ACTION_EVENT, action_listener);
    host_document.removeEventListener(DREAM_SELF_REPAIR_STATE_REQUEST_EVENT, handleStateRequest);
    pending_operations.clear();
  });
});
