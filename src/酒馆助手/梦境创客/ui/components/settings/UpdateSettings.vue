<template>
  <section class="dca-section-stack dca-update-settings">
    <header class="dca-section-header">
      <div>
        <h3>更新</h3>
        <p>管理梦境创客版本并检查稳定版更新。</p>
      </div>
    </header>

    <article class="dca-update-summary dca-card">
      <div class="dca-update-product">
        <span class="dca-update-logo"><i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i></span>
        <div>
          <strong>梦境创客</strong>
          <span>当前版本 v{{ snapshot.runningVersion }}</span>
          <small :class="{ error: snapshot.status === 'error', available: snapshot.updateAvailable }">
            <i :class="statusIcon" aria-hidden="true"></i>{{ statusLabel }}
          </small>
        </div>
      </div>
      <div class="dca-update-actions">
        <button
          v-if="snapshot.updateAvailable && snapshot.latestVersion"
          class="dca-btn-primary"
          type="button"
          :disabled="busy"
          @click="installUpdate"
        >
          <i class="fa-solid fa-download" aria-hidden="true"></i>下载并安装 v{{ snapshot.latestVersion }}
        </button>
        <button type="button" :disabled="busy" @click="checkForUpdates">
          <i class="fa-solid fa-rotate" :class="{ 'fa-spin': snapshot.status === 'checking' }" aria-hidden="true"></i>
          重新检查
        </button>
        <button v-if="snapshot.latestVersion" class="dca-text-link" type="button" @click="openReleaseNotes">
          查看更新说明
        </button>
      </div>
    </article>

    <div v-if="snapshot.error" class="dca-alert dca-alert-error">
      <i class="fa-solid fa-circle-exclamation" aria-hidden="true"></i>
      <span>{{ snapshot.error }}</span>
    </div>

    <section class="dca-settings-group" aria-label="更新设置">
      <div class="dca-toggle-row">
        <span>
          <strong>首次加载后静默检查更新</strong>
          <small>默认开启；检查失败不会打断梦境创客启动</small>
        </span>
        <DcaSwitch label="首次加载后静默检查更新" :model-value="checkOnLoad" @update:model-value="toggleCheckOnLoad" />
      </div>
      <div class="dca-update-info-row">
        <span><strong>更新渠道</strong><small>当前仅提供稳定版</small></span>
        <span>稳定版</span>
      </div>
      <div class="dca-update-info-row">
        <span><strong>最近检查</strong><small>每次手动检查都会刷新</small></span>
        <time>{{ checkedAtLabel }}</time>
      </div>
    </section>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { DREAM_CARD_AGENT_REPOSITORY, DREAM_CARD_AGENT_TAG_PREFIX } from '../../../version';
import { setCheckUpdatesOnLoad, shouldCheckUpdatesOnLoad, useDreamCardAgentUpdater } from '../../updater';
import DcaSwitch from '../DcaSwitch.vue';

const updater = useDreamCardAgentUpdater();
const snapshot = updater.snapshot;
const checkOnLoad = ref(shouldCheckUpdatesOnLoad());
const busy = computed(() => snapshot.value.status === 'checking' || snapshot.value.status === 'installing');
const checkedAtLabel = computed(() => {
  if (!snapshot.value.checkedAt) return '尚未检查';
  const value = new Date(snapshot.value.checkedAt);
  return Number.isNaN(value.getTime()) ? '未知' : value.toLocaleString('zh-CN');
});
const statusLabel = computed(() => {
  if (snapshot.value.status === 'checking') return '正在检查更新';
  if (snapshot.value.status === 'installing') return '正在准备更新';
  if (snapshot.value.status === 'error') return '检查更新失败';
  if (snapshot.value.updateAvailable && snapshot.value.latestVersion) {
    return `发现新版本 v${snapshot.value.latestVersion}`;
  }
  if (snapshot.value.status === 'up-to-date') return '已是最新版';
  return '尚未检查更新';
});
const statusIcon = computed(() => {
  if (snapshot.value.status === 'checking' || snapshot.value.status === 'installing')
    return 'fa-solid fa-spinner fa-spin';
  if (snapshot.value.status === 'error') return 'fa-solid fa-circle-exclamation';
  if (snapshot.value.updateAvailable) return 'fa-solid fa-circle-arrow-up';
  return 'fa-solid fa-circle-check';
});

function toggleCheckOnLoad(value: boolean) {
  checkOnLoad.value = value;
  setCheckUpdatesOnLoad(value);
  toastr.success(value ? '已开启加载后静默检查。' : '已关闭加载后静默检查。', '梦境创客');
}

async function checkForUpdates() {
  try {
    const result = await updater.check();
    if (result.updateAvailable && result.latestVersion)
      toastr.info(`发现新版本 v${result.latestVersion}。`, '梦境创客');
    else toastr.success('当前已经是最新版。', '梦境创客');
  } catch {
    // 详细错误由更新器快照统一展示。
  }
}

async function installUpdate() {
  const version = snapshot.value.latestVersion;
  if (!version) return;
  const confirmed = await SillyTavern.callGenericPopup(
    `确定将梦境创客更新至 v${version} 吗？页面会在准备完成后刷新。`,
    SillyTavern.POPUP_TYPE.CONFIRM,
  );
  if (confirmed !== true && confirmed !== SillyTavern.POPUP_RESULT.AFFIRMATIVE) return;
  try {
    await updater.install();
  } catch {
    // 详细错误由更新器快照统一展示。
  }
}

function openReleaseNotes() {
  const version = snapshot.value.latestVersion;
  if (!version) return;
  const url = `https://github.com/${DREAM_CARD_AGENT_REPOSITORY}/releases/tag/${DREAM_CARD_AGENT_TAG_PREFIX}${version}`;
  window.parent.open(url, '_blank', 'noopener,noreferrer');
}
</script>

<style lang="scss">
.dca-update-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 1rem;
}
.dca-update-product {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 0.8rem;
}
.dca-update-logo {
  display: grid;
  width: 3.4rem;
  height: 3.4rem;
  flex: 0 0 auto;
  place-items: center;
  border: 1px solid var(--dca-border-strong);
  border-radius: var(--dca-radius-md);
  background: var(--dca-brand-gradient);
  color: var(--dca-on-accent);
  font-size: 1.25rem;
}
.dca-update-product > div {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 0.12rem;
}
.dca-update-product strong {
  font-size: 1.05rem;
}
.dca-update-product span {
  color: var(--dca-text-secondary);
}
.dca-update-product small {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  color: var(--dca-success);
}
.dca-update-product small.available {
  color: var(--dca-accent-strong);
}
.dca-update-product small.error {
  color: var(--dca-danger);
}
.dca-update-actions {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 0.45rem;
}
.dca-update-info-row {
  display: flex;
  min-height: 4.1rem;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  border-bottom: 1px solid var(--dca-border);
  padding: 0.72rem 0.9rem;
}
.dca-update-info-row:last-child {
  border-bottom: 0;
}
.dca-update-info-row > span:first-child {
  display: flex;
  flex-direction: column;
}
.dca-update-info-row small {
  color: var(--dca-text-muted);
}
.dca-update-info-row > span:last-child,
.dca-update-info-row time {
  color: var(--dca-text-secondary);
}
@media (max-width: 720px) {
  .dca-update-summary {
    align-items: stretch;
    flex-direction: column;
  }
  .dca-update-actions {
    justify-content: flex-start;
  }
}
</style>
