<template>
  <section class="dca-section-stack">
    <header class="dca-section-header">
      <div>
        <h3>诊断</h3>
        <p>详细日志只保存在当前浏览器页面内存中。</p>
      </div>
    </header>
    <div class="dca-metric-grid">
      <div v-if="state.developerMode">
        <strong>{{ activeSessionIndex?.revision ?? 0 }}</strong>
        <span>Revision</span>
      </div>
      <div>
        <strong>{{ state.active?.events.length ?? 0 }}</strong>
        <span>事务事件</span>
      </div>
      <div>
        <strong>{{ state.active?.workingFiles.length ?? 0 }}</strong>
        <span>工作区文件</span>
      </div>
    </div>
    <template v-if="state.developerMode">
      <details open>
        <summary>最近事件</summary>
        <pre>{{ pretty(state.active?.events.slice(-100) ?? []) }}</pre>
      </details>
      <details>
        <summary>当前页面内存日志</summary>
        <pre>{{ pretty(state.debugLogs.slice(-100)) }}</pre>
      </details>
      <details>
        <summary>会话索引</summary>
        <pre>{{ pretty(activeSessionIndex) }}</pre>
      </details>
      <button class="dca-diagnostics-copy" type="button" @click="copyDiagnostics">复制脱敏诊断包</button>
    </template>
    <p v-else class="dca-muted-note">在“常规”中开启开发者模式后显示详细信息。</p>
    <details v-if="orphanSessions.length">
      <summary>其他角色或孤立会话（{{ orphanSessions.length }}）</summary>
      <ul>
        <li v-for="session in orphanSessions" :key="session.sessionId">
          {{ session.characterName }} · {{ session.title
          }}<template v-if="state.developerMode"> · r{{ session.revision }}</template>
        </li>
      </ul>
    </details>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { pretty } from '../../composables/format';
import { useDreamCardAgent } from '../../composables/runtime';

const { runtime, state } = useDreamCardAgent();

const activeSessionIndex = computed(() =>
  state.value.sessions.find(item => item.sessionId === state.value.active?.sessionId),
);
const orphanSessions = computed(() =>
  state.value.sessions.filter(item => item.bindingId !== state.value.currentCharacter?.bindingId),
);

async function copyDiagnostics() {
  await navigator.clipboard.writeText(JSON.stringify(runtime.diagnosticBundle(), null, 2));
  toastr.success('已复制脱敏诊断包', '梦境创客');
}
</script>

<style lang="scss">
.dca-diagnostics-copy {
  align-self: flex-start;
}
</style>
