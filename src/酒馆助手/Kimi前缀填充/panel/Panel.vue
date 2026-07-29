<template>
  <template v-if="store.should_enable">
    <div class="inline-drawer">
      <div class="inline-drawer-toggle inline-drawer-header">
        <b>Kimi 前缀填充</b>
        <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
      </div>

      <div class="inline-drawer-content">
        <label class="kimi-partial-checkbox">
          <input v-model="store.enabled" type="checkbox" />
          <span>
            <strong>启用 Partial Mode</strong>
            <small>发送请求时，自动为末尾的 assistant 文本消息添加 <code>partial: true</code>。</small>
          </span>
        </label>
      </div>
    </div>
  </template>
</template>

<script setup lang="ts">
import { useKimiPartialModeStore } from '../store';

const store = useKimiPartialModeStore();
</script>

<style scoped>
.kimi-partial-checkbox {
  display: flex;
  align-items: flex-start;
  gap: 0.45rem;
}

.kimi-partial-checkbox > span {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.kimi-partial-checkbox small {
  color: var(--SmartThemeEmColor);
  line-height: 1.4;
}
</style>
