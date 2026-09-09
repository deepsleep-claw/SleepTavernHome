<template>
  <label v-if="mode === 'select'" class="dca-session-agent-select">
    <span>Agent</span>
    <DcaSelect
      :model-value="selectedAgentId"
      :options="agentOptions"
      placeholder="请选择 Agent"
      aria-label="当前会话 Agent"
      :disabled="disabled"
      @update:model-value="requestChange"
    />
  </label>
  <template v-else>
    <button
      v-for="agent in agentOptions"
      :key="agent.value"
      type="button"
      :disabled="disabled"
      :class="{ active: selectedAgentId === agent.value }"
      @click="requestChange(agent.value)"
    >
      <i class="fa-solid fa-check" :class="{ invisible: selectedAgentId !== agent.value }" aria-hidden="true"></i
      ><span>{{ agent.label }}</span>
    </button>
  </template>
  <Teleport v-if="pendingAgentId" to=".dca-app">
    <div class="dca-modal-backdrop" role="presentation">
      <section class="dca-modal dca-agent-change-dialog" role="dialog" aria-modal="true">
        <header>
          <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
          <div>
            <strong>切换当前会话的 Agent？</strong
            ><span>新的预设、Skill 与工具会立即生效，并可能失去已有请求的缓存命中。</span>
          </div>
        </header>
        <footer>
          <button type="button" @click="pendingAgentId = ''">取消</button
          ><button class="dca-btn-primary" type="button" @click="applyAgent(pendingAgentId)">仍然切换</button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>
<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useDreamCardAgent } from '../../composables/runtime';
import DcaSelect from '../DcaSelect.vue';
withDefaults(defineProps<{ mode?: 'select' | 'menu' }>(), { mode: 'select' });
const emit = defineEmits<{ picked: [] }>();
const { action, runtime, state } = useDreamCardAgent();
const pendingAgentId = ref('');
const agentOptions = computed(() =>
  (state.value.agentConfigurations ?? []).map(agent => ({ label: agent.name, value: agent.id })),
);
const selectedAgentId = computed(() => state.value.active?.agentConfiguration?.id ?? '');
const disabled = computed(
  () => !state.value.active || ['running', 'waiting-approval'].includes(state.value.active.status),
);
watch(
  () => state.value.active?.sessionId,
  () => {
    pendingAgentId.value = '';
  },
);
function requestChange(id: string) {
  if (disabled.value || !id) return;
  if (id === selectedAgentId.value) {
    emit('picked');
    return;
  }
  if (state.value.active?.ui.some(item => item.kind === 'user')) pendingAgentId.value = id;
  else void applyAgent(id);
}
async function applyAgent(id: string) {
  if (!id || disabled.value) return;
  if (await action(() => runtime.applyAgentConfiguration(id))) {
    pendingAgentId.value = '';
    emit('picked');
    toastr.success('当前会话的 Agent 已切换。', '梦境创客');
  }
}
</script>
