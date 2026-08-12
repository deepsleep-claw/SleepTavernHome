<template>
  <section class="dca-section-stack">
    <header class="dca-section-header dca-theme-header">
      <div>
        <h3>主题</h3>
        <p>切换内置主题，或导入 CSS 与可选 JavaScript 组成的主题包。</p>
      </div>
      <div class="dca-inline-actions">
        <button type="button" class="dca-btn-primary" @click="fileInput?.click()">
          <i class="fa-solid fa-file-import" aria-hidden="true"></i>导入主题
        </button>
        <input
          ref="fileInput"
          class="dca-theme-file-input"
          type="file"
          accept=".json,.dca-theme,application/json"
          @change="importTheme"
        />
      </div>
    </header>

    <div class="dca-theme-notice">
      <i class="fa-solid fa-shield-halved" aria-hidden="true"></i>
      <span>CSS 仅作用于梦境创客界面；含 JavaScript 的主题需要额外确认，并拥有与梦境创客相同的页面权限。</span>
    </div>

    <section class="dca-theme-grid" aria-label="可用主题">
      <article
        v-for="theme in themes"
        :key="theme.id"
        class="dca-theme-card"
        :class="{ active: state.activeThemeId === theme.id }"
      >
        <button class="dca-theme-select" type="button" @click="selectTheme(theme.id)">
          <span class="dca-theme-preview" :style="previewStyle(theme)" aria-hidden="true">
            <span class="dca-theme-preview-sidebar"></span>
            <span class="dca-theme-preview-content">
              <i></i><i></i><i></i>
            </span>
          </span>
          <span class="dca-theme-copy">
            <span class="dca-theme-title-line">
              <strong>{{ theme.name }}</strong>
              <small v-if="state.activeThemeId === theme.id">使用中</small>
            </span>
            <span>{{ theme.description || '自定义梦境创客主题' }}</span>
            <span class="dca-theme-badges">
              <small>{{ theme.source === 'builtin' ? '内置' : '自定义' }}</small>
              <small>{{ schemeLabel(theme.colorScheme) }}</small>
              <small v-if="theme.hasJavascript" class="warning">含 JS</small>
            </span>
          </span>
        </button>
        <footer>
          <button type="button" class="dca-btn-ghost" @click="exportTheme(theme.id)">
            <i class="fa-solid fa-file-export" aria-hidden="true"></i>导出
          </button>
          <button
            v-if="theme.source === 'custom'"
            type="button"
            class="dca-btn-ghost dca-theme-delete"
            @click="deleteTheme(theme.id, theme.name)"
          >
            <i class="fa-solid fa-trash" aria-hidden="true"></i>删除
          </button>
        </footer>
      </article>
    </section>
  </section>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { useDreamCardAgent } from '../../composables/runtime';
import { getThemeStore, parseThemePackage } from '../../theme/store';
import { DEFAULT_THEME_ID, type ThemeColorScheme, type ThemeSummary } from '../../theme/types';

const { action, runtime, state } = useDreamCardAgent();
const store = getThemeStore();
const themes = ref<ThemeSummary[]>(store.all());
const fileInput = ref<HTMLInputElement>();
let unsubscribe = () => {};

function refreshThemes() {
  themes.value = store.all();
}

function schemeLabel(scheme: ThemeColorScheme): string {
  return scheme === 'auto' ? '自动明暗' : scheme === 'light' ? '浅色' : '深色';
}

function previewStyle(theme: ThemeSummary): Record<string, string> {
  const fallback = theme.colorScheme === 'light'
    ? { accent: '#171717', canvas: '#fafafa', surface: '#ffffff', text: '#171717' }
    : { accent: '#9d7cff', canvas: '#111116', surface: '#20202a', text: '#eeeeef' };
  const preview = theme.preview ?? fallback;
  return {
    '--dca-preview-accent': preview.accent,
    '--dca-preview-canvas': preview.canvas,
    '--dca-preview-surface': preview.surface,
    '--dca-preview-text': preview.text,
  };
}

async function selectTheme(id: string) {
  await action(() => runtime.updateSettings({ activeThemeId: id }));
}

async function importTheme(event: Event) {
  const input = event.currentTarget as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  try {
    if (file.size > 1024 * 1024) throw new Error('主题包不能超过 1 MiB。');
    const themePackage = parseThemePackage(await file.text());
    const hasJavascript = Boolean(themePackage.js?.trim());
    if (
      hasJavascript &&
      !window.confirm(
        `主题“${themePackage.name}”包含 JavaScript。\n\n` +
          '主题脚本可以读取或修改梦境创客与酒馆页面、访问网络和本地设置。仅导入你信任来源的主题。\n\n' +
          '确认导入并授权运行这份代码吗？',
      )
    ) {
      return;
    }
    const installed = await store.install(themePackage, hasJavascript);
    refreshThemes();
    await runtime.updateSettings({ activeThemeId: installed.package.id });
    toastr.success(`已导入并启用“${installed.package.name}”。`, '主题');
  } catch (error) {
    console.error('[梦境创客] 导入主题失败', error);
    toastr.error(error instanceof Error ? error.message : String(error), '导入主题失败');
  }
}

function exportTheme(id: string) {
  const theme = store.get(id);
  if (!theme) {
    toastr.error('主题不存在或已经被删除。', '导出主题失败');
    return;
  }
  const blob = new Blob([JSON.stringify(theme.package, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${theme.package.name.replace(/[\\/:*?"<>|]+/g, '-')}.dca-theme.json`;
  link.click();
  URL.revokeObjectURL(url);
}

async function deleteTheme(id: string, name: string) {
  if (!window.confirm(`确定删除自定义主题“${name}”吗？`)) return;
  if (state.value.activeThemeId === id) await runtime.updateSettings({ activeThemeId: DEFAULT_THEME_ID });
  store.remove(id);
  refreshThemes();
  toastr.success(`已删除“${name}”。`, '主题');
}

onMounted(() => {
  unsubscribe = store.subscribe(refreshThemes);
});
onBeforeUnmount(() => unsubscribe());
</script>

<style lang="scss">
.dca-theme-header {
  align-items: flex-start;
}

.dca-theme-file-input {
  display: none;
}

.dca-theme-notice {
  display: flex;
  align-items: flex-start;
  gap: 0.6rem;
  border: 1px solid color-mix(in srgb, var(--dca-info) 38%, var(--dca-border));
  border-radius: var(--dca-radius-md);
  padding: 0.75rem 0.85rem;
  background: var(--dca-info-soft);
  color: var(--dca-text-secondary);
  font-size: 0.82rem;
  line-height: 1.5;
}

.dca-theme-notice i {
  margin-top: 0.15rem;
  color: var(--dca-info);
}

.dca-theme-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.8rem;
}

.dca-theme-card {
  overflow: hidden;
  border: 1px solid var(--dca-border);
  border-radius: var(--dca-radius-lg);
  background: var(--dca-surface);
  transition:
    border-color var(--dca-motion-fast) ease,
    transform var(--dca-motion-fast) ease;
}

.dca-theme-card:hover {
  border-color: var(--dca-border-strong);
  transform: translateY(-1px);
}

.dca-theme-card.active {
  border-color: var(--dca-accent);
  box-shadow: 0 0 0 2px var(--dca-focus-ring);
}

.dca-app button.dca-theme-select {
  display: grid;
  width: 100%;
  height: auto;
  grid-template-columns: 7rem minmax(0, 1fr);
  gap: 0.8rem;
  border: 0;
  border-radius: 0;
  padding: 0.8rem;
  background: transparent;
  text-align: left;
}

.dca-app button.dca-theme-select:hover {
  background: var(--dca-highlight);
}

.dca-theme-preview {
  display: grid;
  height: 5rem;
  grid-template-columns: 30% 1fr;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--dca-preview-text) 20%, transparent);
  border-radius: calc(var(--dca-radius-md) * 0.8);
  background: var(--dca-preview-canvas);
}

.dca-theme-preview-sidebar {
  border-right: 1px solid color-mix(in srgb, var(--dca-preview-text) 14%, transparent);
  background: var(--dca-preview-surface);
}

.dca-theme-preview-content {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  padding: 0.75rem 0.55rem;
}

.dca-theme-preview-content i {
  height: 0.45rem;
  border-radius: 999px;
  background: color-mix(in srgb, var(--dca-preview-text) 28%, transparent);
}

.dca-theme-preview-content i:first-child {
  width: 65%;
  background: var(--dca-preview-accent);
}

.dca-theme-preview-content i:last-child {
  width: 78%;
}

.dca-theme-copy,
.dca-theme-title-line,
.dca-theme-badges {
  display: flex;
  min-width: 0;
}

.dca-theme-copy {
  flex-direction: column;
  gap: 0.35rem;
}

.dca-theme-copy > span:not(.dca-theme-title-line, .dca-theme-badges) {
  display: -webkit-box;
  overflow: hidden;
  color: var(--dca-text-muted);
  font-size: 0.76rem;
  line-height: 1.45;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.dca-theme-title-line {
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.dca-theme-title-line strong {
  overflow: hidden;
  color: var(--dca-text);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dca-theme-title-line small,
.dca-theme-badges small {
  border-radius: 999px;
  padding: 0.12rem 0.38rem;
  background: var(--dca-accent-soft);
  color: var(--dca-accent-strong);
  font-size: 0.66rem;
  white-space: nowrap;
}

.dca-theme-badges {
  flex-wrap: wrap;
  gap: 0.3rem;
  margin-top: auto;
}

.dca-theme-badges small {
  background: var(--dca-raised);
  color: var(--dca-text-muted);
}

.dca-theme-badges small.warning {
  background: var(--dca-warning-soft);
  color: var(--dca-warning);
}

.dca-theme-card > footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.4rem;
  border-top: 1px solid var(--dca-border);
  padding: 0.45rem 0.6rem;
}

.dca-app .dca-theme-card footer button {
  height: var(--dca-control-h-sm);
  padding: 0 0.55rem;
  font-size: 0.72rem;
}

.dca-app .dca-theme-delete:hover {
  background: var(--dca-danger-soft);
  color: var(--dca-danger);
}

@media (max-width: 760px) {
  .dca-theme-grid {
    grid-template-columns: 1fr;
  }

  .dca-theme-header {
    flex-direction: column;
    gap: 0.75rem;
  }
}

@media (max-width: 420px) {
  .dca-app button.dca-theme-select {
    grid-template-columns: 5.5rem minmax(0, 1fr);
  }
}
</style>
