<template>
  <section class="dca-section-stack">
    <header class="dca-section-header">
      <div>
        <h3>常规</h3>
        <p>调整入口显示和页面行为。</p>
      </div>
    </header>
    <label class="dca-toggle-row">
      <span><strong>显示悬浮按钮</strong><small>魔法棒入口始终保留</small></span>
      <input type="checkbox" :checked="state.floatingButton" @change="toggleFloating" />
    </label>
    <label class="dca-toggle-row">
      <span><strong>开发者模式</strong><small>显示步骤、哈希、Revision 与调试信息，不绕过保护</small></span>
      <input type="checkbox" :checked="state.developerMode" @change="toggleDeveloper" />
    </label>
  </section>
</template>

<script setup lang="ts">
import { useDreamCardAgent } from '../../composables/runtime';

const { action, runtime, state } = useDreamCardAgent();

async function toggleFloating(event: Event) {
  await action(() => runtime.updateSettings({ floatingButton: (event.target as HTMLInputElement).checked }));
}

async function toggleDeveloper(event: Event) {
  await action(() => runtime.updateSettings({ developerMode: (event.target as HTMLInputElement).checked }));
}
</script>
