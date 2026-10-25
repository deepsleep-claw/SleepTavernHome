import type { ApiModel, ApiProvider } from './provider-config';
import { requiresReasoning } from './model-behavior';

export function modelCommandValue(providerId: string, modelId: string): string {
  return `${encodeURIComponent(providerId)}/${encodeURIComponent(modelId)}`;
}

export function reasoningOptions(_provider?: ApiProvider, model?: ApiModel) {
  if (!model || model.modelSettings.capabilities.reasoning === 'disabled') return [];
  const options = [
    { value: 'auto', label: '自动', description: '由接口或模型自行决定' },
    ...(requiresReasoning(model.modelId) ? [] : [{ value: 'off', label: '关闭推理', description: '本会话关闭推理' }]),
    ...model.modelSettings.reasoningEfforts.map(item => ({ value: item.id, label: item.name, description: item.id })),
  ];
  return options.filter(
    (item, index) =>
      (!requiresReasoning(model.modelId) || !['none', 'off', 'disabled'].includes(item.value)) &&
      options.findIndex(other => other.value === item.value) === index,
  );
}

export function resolveCommandModel(providers: ApiProvider[], query: string) {
  const name = query.trim().normalize('NFC').toLocaleLowerCase();
  const models = providers
    .filter(provider => provider.enabled)
    .flatMap(provider => provider.models.filter(model => model.enabled).map(model => ({ provider, model })));
  const exact = models.find(({ provider, model }) => modelCommandValue(provider.id, model.id) === query.trim());
  if (exact) return exact;
  const named = models.filter(({ provider, model }) => `${provider.name}/${model.name}` === query.trim());
  if (named.length === 1) return named[0];
  const matches = models.filter(({ provider, model }) =>
    [modelCommandValue(provider.id, model.id), `${provider.name}/${model.name}`, model.name, model.modelId].some(
      value => value.normalize('NFC').toLocaleLowerCase() === name,
    ),
  );
  if (matches.length !== 1)
    throw new Error(
      matches.length
        ? '模型名称有重名，请从 /model 候选列表选择具体渠道和模型。'
        : '模型不存在或已禁用，请从 /model 候选列表重新选择。',
    );
  return matches[0];
}
