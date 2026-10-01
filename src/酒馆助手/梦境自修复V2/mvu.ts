import { NO_MVU, type MvuStatus } from './prompts';

type MvuBridge = {
  getMessageUpdateStatus?: () => Omit<MvuStatus, 'available'>;
  reprocessMessage?: (message_id: number) => Promise<void>;
};

function bridge(): MvuBridge | undefined {
  return (window.parent as unknown as { Mvu?: MvuBridge }).Mvu;
}

export function getMvuStatus(): MvuStatus {
  const api = bridge();
  if (!api) return { ...NO_MVU };
  const state = api.getMessageUpdateStatus?.();
  return state ? { ...state, available: true } : { ...NO_MVU, available: true };
}

export async function updateMvu(message_id: number): Promise<void> {
  const api = bridge();
  if (!api?.getMessageUpdateStatus?.().enabled || !api.reprocessMessage)
    throw new Error('MVU 联动接口未启用，请加载配套 MVU 脚本。');
  await api.reprocessMessage(message_id);
}
