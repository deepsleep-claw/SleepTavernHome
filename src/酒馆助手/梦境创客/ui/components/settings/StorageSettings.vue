<template>
  <section class="dca-section-stack dca-storage-settings">
    <header class="dca-section-header">
      <div>
        <h3>文件与存储</h3>
        <p>附件与角色共享文件按角色归类；缓存只包含会话临时文件和可回收的历史版本。</p>
      </div>
      <button type="button" :disabled="busy || groups.length === 0" @click="clearAllCache">
        <i class="fa-solid fa-broom" aria-hidden="true"></i>{{ busy ? '处理中' : '清理全部缓存' }}
      </button>
    </header>

    <div class="dca-metric-grid">
      <div>
        <strong>{{ formatBytes(totalBytes) }}</strong>
        <span>托管文件</span>
      </div>
      <div>
        <strong>{{ formatBytes(totalAttachmentBytes) }}</strong>
        <span>附件与共享文件</span>
      </div>
      <div>
        <strong>{{ formatBytes(totalProjectBytes) }}</strong>
        <span>HTML 工程</span>
      </div>
      <div>
        <strong>{{ formatBytes(totalCacheBytes) }}</strong>
        <span>缓存与孤立版本</span>
      </div>
      <div>
        <strong>{{ formatBytes(state.storage.globalSkillBytes) }}</strong>
        <span>全局 Skill</span>
      </div>
    </div>

    <div v-if="groups.length" class="dca-character-storage-list">
      <details v-for="group in groups" :key="group.bindingId" class="dca-character-storage" :open="isCurrent(group.bindingId)">
        <summary>
          <span class="dca-storage-character-name">
            <i class="fa-regular fa-folder-open" aria-hidden="true"></i>
            <strong>{{ group.characterName }}</strong>
            <em v-if="isCurrent(group.bindingId)">当前角色</em>
          </span>
          <span>{{ group.files.length }} 个文件 · {{ formatBytes(group.totalBytes) }}</span>
        </summary>

        <div class="dca-storage-role-body">
          <div class="dca-storage-breakdown">
            <span>共享文件 {{ formatBytes(group.attachmentBytes) }}</span>
            <span>HTML 工程 {{ formatBytes(group.projectBytes) }}</span>
            <span>临时缓存 {{ formatBytes(group.cacheBytes) }}</span>
            <span>孤立版本 {{ formatBytes(group.orphanBytes) }}</span>
          </div>

          <div v-if="group.files.length" class="dca-managed-file-list">
            <article v-for="file in group.files" :key="file.fileId" class="dca-managed-file-row">
              <i :class="fileIcon(file.mediaType)" aria-hidden="true"></i>
              <div>
                <strong>{{ file.logicalPath }}</strong>
                <small>
                  {{ fileKind(file) }} · {{ formatBytes(file.size) }} · {{ formatSessionDate(file.updatedAt) }}
                  <template v-if="file.referencedSessionIds.length">
                    · 被 {{ file.referencedSessionIds.length }} 个会话引用
                  </template>
                </small>
              </div>
              <div class="dca-row-actions">
                <a :href="file.url" :download="file.name" title="下载文件">
                  <i class="fa-solid fa-download" aria-hidden="true"></i>
                </a>
                <button
                  class="dca-btn-danger"
                  type="button"
                  :disabled="busy"
                  :title="`删除 ${file.logicalPath}`"
                  @click="removeFile(file)"
                >
                  <i class="fa-regular fa-trash-can" aria-hidden="true"></i>
                </button>
              </div>
            </article>
          </div>
          <div v-else class="dca-empty">这个角色暂时没有托管文件。</div>

          <div class="dca-storage-role-actions">
            <button type="button" :disabled="busy || !hasCache(group)" @click="clearCharacterCache(group)">
              <i class="fa-solid fa-broom" aria-hidden="true"></i>清理缓存
            </button>
            <button class="dca-btn-danger" type="button" :disabled="busy || group.files.length === 0" @click="clearCharacterAll(group)">
              <i class="fa-regular fa-trash-can" aria-hidden="true"></i>全部清理
            </button>
            <button class="dca-btn-danger" type="button" :disabled="busy" @click="resetCharacter(group)">
              <i class="fa-solid fa-rotate-left" aria-hidden="true"></i>重置数据
            </button>
          </div>
        </div>
      </details>
    </div>
    <div v-else class="dca-empty">还没有由梦境创客托管的角色文件。</div>

    <div class="dca-storage-explanation">
      <div>
        <strong>清理缓存</strong>
        <small>删除 Temp、图片压缩副本和孤立文件，不影响仍在使用的附件与会话。</small>
      </div>
      <div>
        <strong>全部清理</strong>
        <small>额外删除附件与角色共享文件。引用这些文件的旧会话会保留，但无法继续生成。</small>
      </div>
      <div>
        <strong>重置数据</strong>
        <small>删除会话、操作记录、附件、缓存和角色索引；API、预设、Agent 配置与全局 Skill 保留。</small>
      </div>
    </div>

    <div class="dca-danger-zone dca-global-storage-actions">
      <div>
        <strong>所有角色</strong>
        <small>以下操作会作用于梦境创客管理的全部角色，请仔细确认范围。</small>
      </div>
      <div class="dca-row-actions">
        <button class="dca-btn-danger" type="button" :disabled="busy || groups.length === 0" @click="clearEverything">
          全部清理
        </button>
        <button class="dca-btn-danger" type="button" :disabled="busy || groups.length === 0" @click="resetEverything">
          重置全部数据
        </button>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import type {
  CharacterFileStorageSummary,
  ManagedFileSummary,
} from '../../../core/persistence/workspace-file-store';
import { formatBytes, formatSessionDate } from '../../composables/format';
import { useDreamCardAgent } from '../../composables/runtime';

const { action, openedSessionIds, runtime, state, workspaceView } = useDreamCardAgent();
const busy = ref(false);

const groups = computed(() => state.value.storage.characters);
const totalBytes = computed(() => groups.value.reduce((total, group) => total + group.totalBytes, 0));
const totalAttachmentBytes = computed(() =>
  groups.value.reduce((total, group) => total + group.attachmentBytes, 0),
);
const totalProjectBytes = computed(() => groups.value.reduce((total, group) => total + group.projectBytes, 0));
const totalCacheBytes = computed(() =>
  groups.value.reduce((total, group) => total + group.cacheBytes + group.orphanBytes, 0),
);

function isCurrent(bindingId: string): boolean {
  return state.value.currentCharacter?.bindingId === bindingId;
}

function hasCache(group: CharacterFileStorageSummary): boolean {
  return group.cacheBytes + group.orphanBytes > 0;
}

function fileIcon(mediaType: string): string {
  if (mediaType.startsWith('image/')) return 'fa-regular fa-image';
  if (mediaType.startsWith('audio/')) return 'fa-solid fa-file-audio';
  if (mediaType.startsWith('video/')) return 'fa-solid fa-file-video';
  if (mediaType.startsWith('text/')) return 'fa-regular fa-file-lines';
  return 'fa-regular fa-file';
}

function fileKind(file: ManagedFileSummary): string {
  if (file.scope === 'project') return 'HTML 工程';
  if (file.scope === 'temp') return '缓存';
  if (file.orphanedAt !== undefined) return '可回收历史版本';
  return '角色共享文件';
}

function affectedSessions(group: CharacterFileStorageSummary): number {
  return new Set(group.files.flatMap(file => file.referencedSessionIds)).size;
}

async function run(work: () => Promise<unknown>, success: string): Promise<boolean> {
  busy.value = true;
  try {
    const succeeded = await action(work);
    if (succeeded) toastr.success(success, '梦境创客');
    return succeeded;
  } finally {
    busy.value = false;
  }
}

async function clearCharacterCache(group: CharacterFileStorageSummary) {
  await run(() => runtime.clearCharacterCache(group.bindingId), `已清理“${group.characterName}”的缓存。`);
}

async function clearAllCache() {
  await run(() => runtime.clearAllCache(), '已清理全部角色的缓存。');
}

async function clearCharacterAll(group: CharacterFileStorageSummary) {
  const sessions = affectedSessions(group);
  const suffix = sessions ? `\n\n${sessions} 个历史会话引用了这些文件，清理后这些会话将无法继续生成。` : '';
  if (!window.confirm(`确定清理“${group.characterName}”的全部附件和缓存吗？${suffix}`)) return;
  await run(() => runtime.clearCharacterAttachments(group.bindingId), `已清理“${group.characterName}”的附件与缓存。`);
}

async function clearEverything() {
  const sessions = new Set(groups.value.flatMap(group => group.files.flatMap(file => file.referencedSessionIds))).size;
  const suffix = sessions ? `\n\n至少 ${sessions} 个历史会话引用了这些文件，之后将无法继续生成。` : '';
  if (!window.confirm(`确定清理所有角色的附件与缓存吗？${suffix}`)) return;
  await run(() => runtime.clearAllAttachments(), '已清理所有角色的附件与缓存。');
}

async function removeFile(file: ManagedFileSummary) {
  const suffix = file.referencedSessionIds.length
    ? `\n\n它被 ${file.referencedSessionIds.length} 个会话引用，删除后这些会话可能无法继续生成。`
    : '';
  if (!window.confirm(`确定删除“${file.logicalPath}”吗？${suffix}`)) return;
  await run(() => runtime.removeManagedFile(file.fileId), `已删除“${file.logicalPath}”。`);
}

async function resetCharacter(group: CharacterFileStorageSummary) {
  if (!window.confirm(`重置会删除“${group.characterName}”的全部会话、操作记录和文件。确定继续吗？`)) return;
  if (!window.confirm('此操作不可撤销。请再次确认重置这个角色的梦境创客数据。')) return;
  if (!(await run(() => runtime.resetCharacterData(group.bindingId), `已重置“${group.characterName}”的数据。`))) return;
  if (isCurrent(group.bindingId)) {
    openedSessionIds.value = [];
    workspaceView.value = 'home';
  }
}

async function resetEverything() {
  if (!window.confirm('重置全部数据会删除所有角色的会话、操作记录、附件与缓存。确定继续吗？')) return;
  if (!window.confirm('此操作不可撤销。请再次确认重置梦境创客的全部角色数据。')) return;
  if (!(await run(() => runtime.resetAllData(), '已重置全部角色数据。'))) return;
  openedSessionIds.value = [];
  workspaceView.value = 'home';
}
</script>

<style lang="scss">
.dca-storage-settings {
  padding-bottom: 2rem;
}

.dca-character-storage-list,
.dca-managed-file-list,
.dca-storage-explanation {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}

.dca-character-storage {
  overflow: clip;
  border: 1px solid var(--dca-border);
  border-radius: var(--dca-radius-md);
  background: var(--dca-surface);
}

.dca-character-storage > summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.75rem 0.85rem;
  cursor: pointer;
  color: var(--dca-text-secondary);
}

.dca-storage-character-name {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 0.45rem;
  color: var(--dca-text);
}

.dca-storage-character-name em {
  border-radius: 999px;
  padding: 0.08rem 0.42rem;
  background: var(--dca-accent-soft);
  color: var(--dca-accent);
  font-size: 0.72rem;
  font-style: normal;
}

.dca-storage-role-body {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
  border-top: 1px solid var(--dca-border);
  padding: 0.75rem;
}

.dca-storage-breakdown,
.dca-storage-role-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
  color: var(--dca-text-muted);
  font-size: 0.78rem;
}

.dca-storage-breakdown span {
  border-radius: 999px;
  padding: 0.18rem 0.5rem;
  background: var(--dca-canvas);
}

.dca-managed-file-row {
  display: grid;
  align-items: center;
  gap: 0.65rem;
  grid-template-columns: 1.2rem minmax(0, 1fr) auto;
  border-radius: var(--dca-radius-sm);
  padding: 0.48rem 0.55rem;
  background: var(--dca-canvas);
}

.dca-managed-file-row > i {
  color: var(--dca-text-muted);
  text-align: center;
}

.dca-managed-file-row > div:nth-child(2) {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 0.08rem;
}

.dca-managed-file-row strong,
.dca-managed-file-row small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dca-managed-file-row small,
.dca-storage-explanation small {
  color: var(--dca-text-muted);
}

.dca-managed-file-row .dca-row-actions a {
  display: inline-grid;
  width: 2rem;
  height: 2rem;
  place-items: center;
  border-radius: var(--dca-radius-sm);
  color: var(--dca-text-secondary);
}

.dca-managed-file-row .dca-row-actions a:hover {
  background: var(--dca-accent-soft);
  color: var(--dca-accent);
}

.dca-storage-role-actions {
  justify-content: flex-end;
}

.dca-storage-explanation {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.dca-storage-explanation > div {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  border: 1px solid var(--dca-border);
  border-radius: var(--dca-radius-md);
  padding: 0.65rem;
  background: var(--dca-surface);
}

.dca-danger-zone {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.8rem;
  border: 1px solid color-mix(in srgb, var(--dca-danger) 40%, transparent);
  border-radius: var(--dca-radius-md);
  padding: 0.65rem 0.75rem;
  background: var(--dca-danger-soft);
}

.dca-danger-zone > div:first-child {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 0.1rem;
}

.dca-danger-zone small {
  color: var(--dca-text-muted);
}

@media (max-width: 760px) {
  .dca-storage-explanation {
    grid-template-columns: 1fr;
  }

  .dca-character-storage > summary,
  .dca-danger-zone {
    align-items: flex-start;
    flex-direction: column;
  }

  .dca-managed-file-row {
    grid-template-columns: 1.2rem minmax(0, 1fr);
  }

  .dca-managed-file-row .dca-row-actions {
    grid-column: 2;
  }
}
</style>
