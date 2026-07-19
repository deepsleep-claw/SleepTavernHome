<template>
  <section class="th-updater-panel" aria-label="脚本更新">
    <div class="th-updater-summary">
      <span class="th-updater-version">v{{ snapshot.runningVersion }}</span>
      <span v-if="snapshot.updateAvailable && snapshot.latestVersion" class="th-updater-latest">
        可更新至 v{{ snapshot.latestVersion }}
      </span>
      <span v-else-if="snapshot.status === 'up-to-date'" class="th-updater-current">已是最新版</span>
    </div>

    <div class="th-updater-actions">
      <button
        type="button"
        class="menu_button"
        :disabled="isBusy"
        title="检查更新"
        aria-label="检查更新"
        @click="checkForUpdates"
      >
        <i class="fa-solid fa-rotate" :class="{ 'fa-spin': snapshot.status === 'checking' }" aria-hidden="true"></i>
      </button>
      <button
        v-if="snapshot.updateAvailable && snapshot.latestVersion"
        type="button"
        class="menu_button th-updater-install"
        :disabled="isBusy"
        @click="installUpdate"
      >
        更新
      </button>
    </div>

    <small v-if="snapshot.error" class="th-updater-error">{{ snapshot.error }}</small>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, shallowRef } from 'vue';

import type { PluginUpdaterController, UpdaterSnapshot } from './contracts';

const props = defineProps<{
  updater: PluginUpdaterController;
}>();

const snapshot = shallowRef<UpdaterSnapshot>(props.updater.getSnapshot());
const isBusy = computed(() => snapshot.value.status === 'checking' || snapshot.value.status === 'installing');

let unsubscribe: (() => void) | undefined;

onMounted(() => {
  unsubscribe = props.updater.subscribe(value => {
    snapshot.value = value;
  });
});

onUnmounted(() => {
  unsubscribe?.();
});

async function checkForUpdates() {
  try {
    await props.updater.check();
  } catch {
    // 错误已经写入更新器快照，由面板统一显示。
  }
}

async function installUpdate() {
  const latestVersion = snapshot.value.latestVersion;
  if (!latestVersion) {
    return;
  }

  const confirmed = await SillyTavern.callGenericPopup(
    `确定将${props.updater.pluginName}更新至 v${latestVersion} 吗？`,
    SillyTavern.POPUP_TYPE.CONFIRM,
  );
  if (confirmed !== true && confirmed !== SillyTavern.POPUP_RESULT.AFFIRMATIVE) {
    return;
  }

  try {
    await props.updater.install();
  } catch {
    // 错误已经写入更新器快照，由面板统一显示。
  }
}
</script>

<style scoped>
.th-updater-panel {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.4rem 0.65rem;
  padding: 0.65rem 0;
  border-top: 1px solid var(--SmartThemeBorderColor);
}

.th-updater-summary,
.th-updater-actions {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  min-width: 0;
}

.th-updater-version {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.th-updater-latest,
.th-updater-current {
  overflow: hidden;
  opacity: 0.75;
  font-size: 0.9em;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.th-updater-actions .menu_button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  min-width: 2em;
  height: 2em;
  margin: 0;
  padding: 0 0.55rem;
}

.th-updater-error {
  grid-column: 1 / -1;
  color: var(--crimson70, #d66);
  overflow-wrap: anywhere;
}

@media (max-width: 600px) {
  .th-updater-panel {
    grid-template-columns: minmax(0, 1fr);
  }

  .th-updater-actions {
    justify-content: flex-end;
  }
}
</style>
