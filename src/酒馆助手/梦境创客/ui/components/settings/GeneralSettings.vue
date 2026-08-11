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
      <span>
        <strong>发送图片时低损压缩</strong>
        <small>保留原始分辨率和原图；仅压缩发送给LLM的JPEG、PNG与WebP，默认开启</small>
      </span>
      <input type="checkbox" :checked="state.compressImages" @change="toggleImageCompression" />
    </label>
    <label class="dca-toggle-row">
      <span>
        <strong>Ctrl + Enter 发送</strong>
        <small>关闭时按 Enter 发送，Shift + Enter 换行；开启后按 Enter 换行</small>
      </span>
      <input type="checkbox" :checked="state.sendWithCtrlEnter" @change="toggleSendShortcut" />
    </label>
    <label v-if="state.developerMode" class="dca-toggle-row dca-danger-row">
      <span>
        <strong>允许修改非角色正则与脚本</strong>
        <small>危险：允许 Agent 和工作区编辑器改写全局及当前预设资源；Agent 操作仍会逐次确认</small>
      </span>
      <input
        type="checkbox"
        :checked="state.dangerousNonCharacterResourceWrites"
        @change="toggleDangerousResourceWrites"
      />
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

async function toggleSendShortcut(event: Event) {
  await action(() => runtime.updateSettings({ sendWithCtrlEnter: (event.target as HTMLInputElement).checked }));
}

async function toggleImageCompression(event: Event) {
  await action(() => runtime.updateSettings({ compressImages: (event.target as HTMLInputElement).checked }));
}

async function toggleDeveloper(event: Event) {
  await action(() => runtime.updateSettings({ developerMode: (event.target as HTMLInputElement).checked }));
}

async function toggleDangerousResourceWrites(event: Event) {
  const enabled = (event.target as HTMLInputElement).checked;
  if (enabled && !window.confirm('这会允许修改全局和当前预设的正则与酒馆助手脚本。确定启用吗？')) {
    (event.target as HTMLInputElement).checked = false;
    return;
  }
  await action(() => runtime.updateSettings({ dangerousNonCharacterResourceWrites: enabled }));
}
</script>
