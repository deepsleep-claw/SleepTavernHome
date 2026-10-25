<template>
  <div
    class="dca-shortcut-menu"
    :class="{ 'is-short': height < 160 }"
    :style="{ maxHeight: `${height}px` }"
    @pointerdown="preserveInputFocus"
  >
    <nav v-if="references" class="dca-shortcut-categories" aria-label="引用分类">
      <button type="button" :aria-pressed="category === 'all'" @click="emit('category', 'all')">全部</button>
      <button
        v-for="group in REFERENCE_CATEGORIES"
        :key="group.id"
        type="button"
        :aria-pressed="category === group.id"
        @click="emit('category', group.id)"
      >
        {{ group.label }}
      </button>
    </nav>
    <div v-else class="dca-shortcut-heading">{{ heading }}<small>选择后补全，提交时执行</small></div>
    <div :id="listId" class="dca-shortcut-list" role="listbox" :aria-label="references ? '资源引用' : '输入快捷指令'">
      <template v-for="(item, index) in items" :key="item.id">
        <div v-if="index === 0 || item.group !== items[index - 1].group" class="dca-shortcut-group">
          {{ item.group }}
        </div>
        <button
          :id="`${listId}-${index}`"
          type="button"
          role="option"
          :aria-selected="index === selectedIndex"
          :aria-disabled="Boolean(item.disabledReason)"
          :class="{ active: index === selectedIndex, unavailable: item.disabledReason }"
          :title="item.disabledReason ?? item.description"
          @click="emit('select', item)"
        >
          <i :class="item.icon" aria-hidden="true"></i>
          <span class="dca-shortcut-copy"
            ><strong>{{ item.label }}</strong
            ><small>{{ item.disabledReason ?? item.description }}</small></span
          >
        </button>
      </template>
      <div v-if="!items.length" class="dca-shortcut-empty">
        {{
          references ? '此分类没有匹配的引用，可换分类或搜索名称、路径。' : '没有可用候选，请检查名称或当前会话配置。'
        }}
      </div>
    </div>
    <small class="dca-shortcut-footer">{{ references ? '引用当前会话中的资源' : 'Enter / Tab 补全 · Esc 关闭' }}</small>
  </div>
</template>

<script setup lang="ts">
import { REFERENCE_CATEGORIES, type ReferenceCategory } from '../../../core/session/composer-references';
import type { ComposerSuggestion } from '../../composables/composer-catalog';
defineProps<{
  items: ComposerSuggestion[];
  selectedIndex: number;
  category: ReferenceCategory | 'all';
  references: boolean;
  heading: string;
  height: number;
  listId: string;
}>();
const emit = defineEmits<{ select: [item: ComposerSuggestion]; category: [category: ReferenceCategory | 'all'] }>();
function preserveInputFocus(event: PointerEvent) {
  // 鼠标选择保留输入光标；触屏交给浏览器处理滚动与点击取消。
  if (event.pointerType !== 'touch') event.preventDefault();
}
</script>

<style lang="scss">
.dca-composer .dca-shortcut-menu {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  padding: 0;
}
.dca-shortcut-heading,
.dca-shortcut-footer {
  flex: 0 0 auto;
  padding: 0.45rem 0.6rem;
  color: var(--dca-text-muted);
  font-size: 0.72rem;
}
.dca-shortcut-heading {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 0.3rem;
}
.dca-shortcut-list {
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden auto;
  overscroll-behavior: contain;
  touch-action: pan-y;
  padding: 0.2rem;
}
.dca-shortcut-group {
  padding: 0.35rem 0.5rem 0.2rem;
  font-size: 0.7rem;
  color: var(--dca-text-muted);
}
.dca-composer .dca-shortcut-menu [role='option'] {
  min-height: 2.75rem;
}
.dca-shortcut-copy {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  gap: 0.15rem;
}
.dca-shortcut-copy strong,
.dca-shortcut-copy small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dca-shortcut-copy strong {
  font-size: 0.8rem;
  font-weight: 500;
}
.dca-shortcut-copy small {
  color: var(--dca-text-muted);
  font-size: 0.7rem;
}
.dca-composer .dca-shortcut-menu button.unavailable {
  opacity: 0.55;
}
.dca-shortcut-categories {
  display: flex;
  flex: 0 0 auto;
  gap: 0.2rem;
  padding: 0.2rem;
  overflow-x: auto;
  overscroll-behavior-x: contain;
  touch-action: pan-x;
  border-bottom: 1px solid var(--dca-border);
}
.dca-composer .dca-shortcut-menu .dca-shortcut-categories button {
  flex: 0 0 auto;
  width: auto;
  min-height: 2.75rem;
  white-space: nowrap;
  padding: 0.4rem 0.6rem;
}
.dca-composer .dca-shortcut-categories button[aria-pressed='true'] {
  background: var(--dca-accent-soft);
  color: var(--dca-accent);
}
.dca-shortcut-empty {
  padding: 0.6rem;
  font-size: 0.8rem;
  color: var(--dca-text-muted);
}
@media (max-width: 450px) {
  .dca-shortcut-footer {
    display: none;
  }
}
.dca-shortcut-menu.is-short .dca-shortcut-group,
.dca-shortcut-menu.is-short .dca-shortcut-footer,
.dca-shortcut-menu.is-short .dca-shortcut-heading small {
  display: none;
}
.dca-shortcut-menu.is-short .dca-shortcut-categories {
  padding: 0.1rem;
  scrollbar-width: none;
}
.dca-shortcut-menu.is-short .dca-shortcut-categories::-webkit-scrollbar {
  display: none;
}
</style>
