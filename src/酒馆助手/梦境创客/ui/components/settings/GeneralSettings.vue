<template>
  <section class="dca-section-stack">
    <header class="dca-section-header">
      <div>
        <h3>常规</h3>
        <p>调整入口显示和页面行为。</p>
      </div>
    </header>
    <section class="dca-settings-group" aria-label="常规行为">
      <div class="dca-toggle-row">
        <span><strong>显示悬浮按钮</strong><small>魔法棒入口始终保留</small></span>
        <DcaSwitch label="显示悬浮按钮" :model-value="state.floatingButton" @update:model-value="toggleFloating" />
      </div>
      <div class="dca-toggle-row">
        <span>
          <strong>发送图片时低损压缩</strong>
          <small>保留原始分辨率和原图；仅压缩发送给LLM的JPEG、PNG与WebP，默认开启</small>
        </span>
        <DcaSwitch
          label="发送图片时低损压缩"
          :model-value="state.compressImages"
          @update:model-value="toggleImageCompression"
        />
      </div>
      <div class="dca-toggle-row">
        <span>
          <strong>Ctrl + Enter 发送</strong>
          <small>关闭时按 Enter 发送，Shift + Enter 换行；开启后按 Enter 换行</small>
        </span>
        <DcaSwitch
          label="Ctrl + Enter 发送"
          :model-value="state.sendWithCtrlEnter"
          @update:model-value="toggleSendShortcut"
        />
      </div>
      <div v-if="state.developerMode" class="dca-toggle-row dca-danger-row">
        <span>
          <strong>允许修改非角色正则与脚本</strong>
          <small>危险：允许 Agent 和工作区编辑器改写全局及当前预设资源；Agent 操作仍会逐次确认</small>
        </span>
        <DcaSwitch
          label="允许修改非角色正则与脚本"
          :model-value="state.dangerousNonCharacterResourceWrites"
          @update:model-value="toggleDangerousResourceWrites"
        />
      </div>
      <div class="dca-toggle-row">
        <span><strong>开发者模式</strong><small>显示步骤、哈希、Revision 与调试信息，不绕过保护</small></span>
        <DcaSwitch label="开发者模式" :model-value="state.developerMode" @update:model-value="toggleDeveloper" />
      </div>
    </section>
  </section>
</template>

<script setup lang="ts">
import { useDreamCardAgent } from '../../composables/runtime';
import DcaSwitch from '../DcaSwitch.vue';

const { action, runtime, state } = useDreamCardAgent();

async function toggleFloating(enabled: boolean) {
  await action(() => runtime.updateSettings({ floatingButton: enabled }));
}

async function toggleSendShortcut(enabled: boolean) {
  await action(() => runtime.updateSettings({ sendWithCtrlEnter: enabled }));
}

async function toggleImageCompression(enabled: boolean) {
  await action(() => runtime.updateSettings({ compressImages: enabled }));
}

async function toggleDeveloper(enabled: boolean) {
  await action(() => runtime.updateSettings({ developerMode: enabled }));
}

async function toggleDangerousResourceWrites(enabled: boolean) {
  if (enabled && !window.confirm('这会允许修改全局和当前预设的正则与酒馆助手脚本。确定启用吗？')) {
    return;
  }
  await action(() => runtime.updateSettings({ dangerousNonCharacterResourceWrites: enabled }));
}
</script>
