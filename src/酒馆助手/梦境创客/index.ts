import { checkMinimumVersion } from '@util/common';
import { createProbeModel, createProbeStream } from './core/provider-probe';

export const DREAM_CARD_AGENT_ID = 'dream-card-agent';
export const DREAM_CARD_AGENT_NAME = '梦境创客';
export const dreamCardAgentProbe = createProbeStream;

$(() => {
  checkMinimumVersion('4.0.0', DREAM_CARD_AGENT_NAME);

  // 在正式运行时注册前，先确保四种 AI SDK Provider 已被浏览器包完整带入。
  // 创建模型对象不会发起网络请求，也不会读取用户配置。
  createProbeModel({
    apiKey: '',
    baseURL: 'https://example.invalid/v1',
    model: 'probe',
    protocol: 'openai-responses',
  });
  console.info(`[${DREAM_CARD_AGENT_NAME}] AI SDK Core 已加载。`);
});
