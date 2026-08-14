<template>
  <section class="dca-section-stack dca-download-settings">
    <header class="dca-section-header">
      <div>
        <h3>资源下载</h3>
      </div>
    </header>

    <section class="dca-download-summary" aria-label="资源下载状态">
      <div>
        <strong>{{ resources.length }} 项资源</strong>
        <span>·</span>
        <span>已下载 <b>{{ downloadedCount }}</b></span>
        <span>·</span>
        <span>待下载 <em>{{ pendingCount }}</em></span>
      </div>
      <div class="dca-row-actions">
        <button type="button" :disabled="working" @click="refresh">
          <i class="fa-solid fa-rotate" aria-hidden="true"></i>刷新
        </button>
        <button class="dca-btn-primary" type="button" :disabled="working || pendingCount === 0" @click="downloadAll">
          <i class="fa-solid fa-download" aria-hidden="true"></i>{{ working ? '下载中' : '下载全部' }}
        </button>
      </div>
    </section>

    <section v-for="group in resourceGroups" :key="group.title" class="dca-download-group">
      <h4>{{ group.title }}</h4>
      <div class="dca-download-list">
        <article v-for="resource in group.resources" :key="resource.id" class="dca-resource-download-card">
          <div class="dca-resource-download-icon">
            <i :class="resourceIcon(resource.id)" aria-hidden="true"></i>
          </div>
          <div class="dca-resource-download-main">
            <strong>{{ resource.name }}</strong>
            <p>{{ resource.description }}</p>
          </div>
          <small>v{{ resource.version }} · {{ formatBytes(resource.size) }}</small>
          <div class="dca-resource-download-state">
            <span v-if="resource.cached && resource.state !== 'outdated'" class="downloaded">
              <i class="fa-regular fa-circle-check" aria-hidden="true"></i>已下载
            </span>
            <button
              v-else
              type="button"
              :disabled="resource.state === 'downloading' || working"
              @click="download(resource.id, resource.cached)"
            >
              <i class="fa-solid fa-download" aria-hidden="true"></i>
              {{ resource.state === 'downloading' ? '下载中' : resource.cached ? '更新' : '下载' }}
            </button>
          </div>
          <span v-if="resource.error" class="dca-resource-error" :title="resource.error">
            <i class="fa-solid fa-circle-exclamation" aria-hidden="true"></i>{{ resource.error }}
          </span>
        </article>
      </div>
    </section>

    <div v-if="!resources.length" class="dca-empty">
      尚未读取到资源清单。点击“刷新”重新获取。
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { formatBytes } from '../../composables/format';
import { useDreamCardAgent } from '../../composables/runtime';

const { action, runtime, state } = useDreamCardAgent();
const working = ref(false);
const resources = computed(() => state.value.builtinSkillResources ?? []);
const downloadedCount = computed(() => resources.value.filter(resource => resource.cached).length);
const pendingCount = computed(() => resources.value.filter(resource => !resource.cached || resource.state === 'outdated').length);
const resourceGroups = computed(() => {
  const creativeIds = new Set(['html-project', 'plain-html-regex', 'tavern-helper-regex']);
  return [
    { title: '创作能力', resources: resources.value.filter(resource => creativeIds.has(resource.id)) },
    { title: '参考资料', resources: resources.value.filter(resource => !creativeIds.has(resource.id)) },
  ].filter(group => group.resources.length > 0);
});

function resourceIcon(id: string): string {
  return ({
    'html-project': 'fa-solid fa-code',
    'mvu-frontend': 'fa-solid fa-display',
    'mvu-zod-card': 'fa-solid fa-database',
    'plain-html-regex': 'fa-solid fa-shield-halved',
    'tavern-helper-api': 'fa-regular fa-file-code',
    'tavern-helper-regex': 'fa-solid fa-puzzle-piece',
  } as Record<string, string>)[id] ?? 'fa-solid fa-box-archive';
}

async function run(work: () => Promise<void>): Promise<boolean> {
  working.value = true;
  try {
    return await action(work);
  } finally {
    working.value = false;
  }
}

async function refresh() {
  await run(() => runtime.refreshBuiltinSkillResources(false));
}

async function downloadAll() {
  const targets = resources.value.filter(resource => !resource.cached || resource.state === 'outdated');
  if (!targets.length) return;
  const succeeded = await run(async () => {
    const results = await Promise.allSettled(targets.map(resource => runtime.downloadBuiltinSkillResource(resource.id, resource.cached)));
    const failed = results.filter(result => result.status === 'rejected').length;
    if (failed) throw new Error(`${failed} 项资源下载失败，请查看对应资源状态后重试。`);
  });
  if (succeeded) toastr.success('资源下载完成。', '梦境创客');
}

async function download(id: string, force: boolean) {
  if (await run(() => runtime.downloadBuiltinSkillResource(id, force))) {
    toastr.success(force ? '资源已经更新。' : '资源已经下载。', '梦境创客');
  }
}
</script>

<style lang="scss">
.dca-download-settings {
  gap: 1rem;
}

.dca-download-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.8rem 1rem;
  border: 1px solid var(--dca-border);
  border-radius: var(--dca-radius-md);
  background: var(--dca-surface);
}

.dca-download-summary > div:first-child {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  color: var(--dca-text-secondary);
}

.dca-download-summary b {
  color: var(--dca-success);
}

.dca-download-summary em {
  color: var(--dca-danger);
  font-style: normal;
  font-weight: 700;
}

.dca-download-group {
  display: grid;
  gap: 0.55rem;
}

.dca-download-group h4 {
  margin: 0;
  color: var(--dca-text-secondary);
  font-size: 0.9rem;
}

.dca-download-list {
  display: grid;
  gap: 0.45rem;
}

.dca-resource-download-card {
  display: grid;
  grid-template-columns: 2.5rem minmax(0, 1fr) auto minmax(6rem, auto);
  align-items: center;
  gap: 0.8rem;
  min-height: 4.4rem;
  padding: 0.65rem 0.8rem;
  border: 1px solid var(--dca-border);
  border-radius: var(--dca-radius-md);
  background: var(--dca-surface);
}

.dca-resource-download-icon {
  display: grid;
  width: 2.5rem;
  height: 2.5rem;
  place-items: center;
  border-radius: var(--dca-radius-sm);
  background: var(--dca-overlay);
  color: var(--dca-text-secondary);
}

.dca-resource-download-main {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 0.15rem;
}

.dca-resource-download-main p {
  overflow: hidden;
  margin: 0;
  color: var(--dca-text-muted);
  font-size: 0.8rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dca-resource-download-card > small {
  color: var(--dca-text-muted);
  white-space: nowrap;
}

.dca-resource-download-state {
  display: flex;
  justify-content: flex-end;
}

.dca-resource-download-state .downloaded {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  color: var(--dca-success);
  white-space: nowrap;
}

.dca-resource-download-state button {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
}

.dca-resource-error {
  grid-column: 2 / -1;
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 0.35rem;
  overflow: hidden;
  color: var(--dca-danger);
  font-size: 0.75rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 720px) {
  .dca-download-summary {
    align-items: stretch;
    flex-direction: column;
  }

  .dca-download-summary .dca-row-actions {
    justify-content: flex-start;
  }

  .dca-resource-download-card {
    grid-template-columns: 2.35rem minmax(0, 1fr) auto;
  }

  .dca-resource-download-card > small {
    display: none;
  }

  .dca-resource-download-state {
    grid-column: 3;
  }

  .dca-resource-error {
    grid-column: 2 / -1;
  }
}
</style>
