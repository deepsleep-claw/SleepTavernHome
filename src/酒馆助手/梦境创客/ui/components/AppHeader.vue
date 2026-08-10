<template>
  <header class="dca-header">
    <div class="dca-brand">
      <span class="dca-logo">梦</span>
      <div class="dca-brand-text">
        <strong>梦境创客</strong>
        <small v-if="state.currentCharacter">
          {{ state.currentCharacter.name }} · {{ shortId(state.currentCharacter.bindingId) }}
        </small>
        <small v-else>请先打开一张角色卡</small>
      </div>
    </div>
    <div class="dca-header-actions">
      <span class="dca-badge" :class="`dca-badge-${state.active?.status ?? 'idle'}`">{{ statusLabel }}</span>
      <button class="dca-icon-btn" type="button" title="刷新角色与会话" @click="refresh">
        <i class="fa-solid fa-rotate" aria-hidden="true"></i>
      </button>
    </div>
  </header>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { shortId } from '../composables/format';
import { useDreamCardAgent } from '../composables/runtime';

const { runtime, state } = useDreamCardAgent();

const statusLabel = computed(
  () =>
    ({
      abnormal: '异常中断',
      'awaiting-approval': '等待批准',
      committing: '提交中',
      completed: '已完成',
      'context-exhausted': '上下文已满',
      failed: '失败',
      idle: '空闲',
      running: '运行中',
      stopped: '已停止',
      'waiting-approval': '工具确认',
    })[state.value.active?.status ?? 'idle'],
);

async function refresh() {
  try {
    await runtime.refreshCharacter();
  } catch {
    // 刷新错误已经进入运行时状态并显示在窗口顶端，不再重复弹出全局Toast。
  }
}
</script>

<style lang="scss">
.dca-header {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  border-bottom: 1px solid var(--dca-border);
  padding: 0.5rem 0.75rem;
  background: var(--dca-surface);
}

.dca-brand {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 0.6rem;
}

.dca-logo {
  display: grid;
  width: 2rem;
  height: 2rem;
  flex: 0 0 auto;
  place-items: center;
  border-radius: var(--dca-radius-sm);
  background: var(--dca-accent);
  color: #fff;
  font-weight: 900;
}

.dca-brand-text {
  display: flex;
  min-width: 0;
  flex-direction: column;
  line-height: 1.25;
}

.dca-brand-text small {
  overflow: hidden;
  color: var(--dca-text-muted);
  font-size: 0.76rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dca-header-actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 0.5rem;
}
</style>
