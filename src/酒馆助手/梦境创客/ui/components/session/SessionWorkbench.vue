<template>
  <section
    class="dca-workbench"
    :class="{ 'sidebar-collapsed': sidebarCollapsed }"
    :style="{ '--dca-sidebar-width': `${sidebarWidth}px` }"
  >
    <div class="dca-session-panel">
      <SessionToolbar :sidebar-collapsed="sidebarCollapsed" @toggle-sidebar="toggleSidebar" />
      <SessionTimeline @open-diff="openDiff" />
      <div v-if="state.activeSessionAccess === 'readonly-history'" class="dca-readonly-composer">
        <i class="fa-solid fa-lock" aria-hidden="true"></i>
        <div>
          <strong>历史记录只读</strong
          ><span>对应角色卡已不可用。你仍可查看消息、工具过程、操作记录与 Diff，但不能发送或修改内容。</span>
        </div>
      </div>
      <SessionComposer v-else />
    </div>
    <div
      v-if="!sidebarCollapsed"
      class="dca-sidebar-resizer"
      title="拖拽调整侧栏宽度"
      @pointerdown="beginSidebarResize"
    ></div>
    <SessionSidebar
      v-if="!sidebarCollapsed"
      v-model:tab="sidebarTab"
      :diff-focus="diffFocus"
      :focus-file-path="focusFilePath"
      @close="sidebarCollapsed = true"
    />
    <OperationReplayDialog />
  </section>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { useDreamCardAgent, type SidebarTab } from '../../composables/runtime';
import type { OperationDiffFocus } from '../../composables/operation-diff';
import { useSidebarResize } from '../../composables/sidebar-resize';
import SessionComposer from './SessionComposer.vue';
import OperationReplayDialog from './OperationReplayDialog.vue';
import SessionTimeline from './SessionTimeline.vue';
import SessionToolbar from './SessionToolbar.vue';
import SessionSidebar from './sidebar/SessionSidebar.vue';

const { sidebarFocus, state } = useDreamCardAgent();

const sidebarCollapsed = ref(true);
const sidebarWidth = ref(390);
const sidebarTab = ref<SidebarTab>('files');
const focusFilePath = ref('');
const diffFocus = ref<(OperationDiffFocus & { requestId: number }) | undefined>();
const { beginSidebarResize } = useSidebarResize(sidebarWidth);

function toggleSidebar() {
  sidebarCollapsed.value = !sidebarCollapsed.value;
}

function openSidebar(tab: SidebarTab) {
  sidebarTab.value = tab;
  sidebarCollapsed.value = false;
}

function openDiff(focus: OperationDiffFocus) {
  diffFocus.value = { ...focus, requestId: Date.now() };
  if (window.innerWidth > 720) {
    sidebarWidth.value = Math.max(sidebarWidth.value, Math.min(680, window.innerWidth * (2 / 3)));
  }
  openSidebar('diff');
}

// 其它区域（如 Skill 设置页）请求在侧栏中定位文件。
// immediate：请求可能在本组件挂载前就已发出（例如从设置页跳转过来）。
watch(
  sidebarFocus,
  request => {
    if (!request) return;
    if (!state.value.active) {
      sidebarFocus.value = undefined;
      return;
    }
    focusFilePath.value = request.filePath ?? '';
    openSidebar(request.tab);
    sidebarFocus.value = undefined;
  },
  { immediate: true },
);
</script>

<style lang="scss">
.dca-workbench {
  position: relative;
  display: grid;
  height: 100%;
  min-height: 0;
  grid-template-columns: minmax(0, 1fr) 6px minmax(20rem, var(--dca-sidebar-width));
}

.dca-workbench.sidebar-collapsed {
  grid-template-columns: minmax(0, 1fr);
}

.dca-session-panel {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
}

.dca-readonly-composer {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 0.75rem;
  margin: 0.7rem;
  border: 1px solid color-mix(in srgb, var(--dca-info) 28%, transparent);
  border-radius: 0.75rem;
  padding: 0.75rem 0.9rem;
  background: color-mix(in srgb, var(--dca-info-soft) 55%, transparent);
  color: var(--dca-text-muted);
}
.dca-readonly-composer > i {
  color: var(--dca-info);
}
.dca-readonly-composer > div {
  display: flex;
  flex-direction: column;
}
.dca-readonly-composer strong {
  color: var(--dca-text);
  font-size: 0.82rem;
}
.dca-readonly-composer span {
  font-size: 0.72rem;
}

.dca-sidebar-resizer {
  position: relative;
  min-width: 6px;
  background: var(--dca-surface);
  cursor: col-resize;
}

.dca-sidebar-resizer::after {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 2px;
  width: 1px;
  background: var(--dca-border);
  content: '';
  transition:
    left var(--dca-motion-fast) ease,
    width var(--dca-motion-fast) ease,
    background var(--dca-motion-fast) ease;
}

.dca-sidebar-resizer:hover::after,
.dca-resizing-sidebar .dca-sidebar-resizer::after {
  left: 1px;
  width: 3px;
  background: var(--dca-accent);
}

.dca-resizing-sidebar {
  cursor: col-resize !important;
  user-select: none !important;
}

@media (max-width: 720px) {
  .dca-workbench:not(.sidebar-collapsed) {
    display: block;
  }

  .dca-workbench:not(.sidebar-collapsed) > .dca-session-panel {
    height: 100%;
  }

  .dca-workbench:not(.sidebar-collapsed) > .dca-session-sidebar {
    position: absolute;
    z-index: 30;
    inset: 0;
    width: 100%;
    height: 100%;
    border-left: 0;
    background: var(--dca-surface);
    box-shadow: var(--dca-shadow-3);
  }

  .dca-sidebar-resizer {
    display: none;
  }
}
</style>
