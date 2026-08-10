<template>
  <div v-if="skillEditorRequest" class="dca-modal-backdrop">
    <section class="dca-modal dca-skill-editor" role="dialog" aria-modal="true" aria-labelledby="dca-skill-title">
      <header>
        <div>
          <h3 id="dca-skill-title">{{ skillDeletePending ? '删除 Skill' : skillDraft.id ? '编辑 Skill' : '新建 Skill' }}</h3>
          <p v-if="!skillDeletePending">
            Skill 保存在全局资源库，可跨角色和会话复用；当前会话从下一条消息开始采用新版。
          </p>
        </div>
        <button class="dca-icon-btn" type="button" title="关闭" @click="closeSkillEditor">
          <i class="fa-solid fa-xmark" aria-hidden="true"></i>
        </button>
      </header>
      <div v-if="skillDeletePending" class="dca-alert dca-alert-warning">
        <span>
          确认从全局资源库删除“{{ skillDraft.name }}”？它会同时从所有 Agent 配置的 Skill 开关组中移除，已有会话的历史内容不受影响。
        </span>
      </div>
      <template v-else>
        <div class="dca-form-grid">
          <label class="dca-field"><span>名称</span><input v-model="skillDraft.name" type="text" /></label>
          <label class="dca-field">
            <span>类型</span>
            <select v-model="skillDraft.loading">
              <option value="full">full · 全量加载</option>
              <option value="on-demand">on-demand · 按需读取</option>
            </select>
          </label>
          <label class="dca-field wide">
            <span>摘要</span>
            <input v-model="skillDraft.description" type="text" maxlength="240" />
          </label>
          <label class="dca-field wide">
            <span>内容</span>
            <textarea v-model="skillDraft.body" rows="16" spellcheck="false" placeholder="# 工作流程"></textarea>
          </label>
        </div>
        <div v-if="skillModifyPending" class="dca-alert dca-alert-warning">
          <span>修改会影响之后使用这个全局 Skill 的所有角色与会话，确认保存新版吗？</span>
          <button type="button" @click="commitSkillSave">确认保存</button>
        </div>
      </template>
      <div class="dca-skill-editor-footer">
        <button
          v-if="skillDraft.id && !skillDeletePending"
          class="dca-btn-danger"
          type="button"
          @click="skillDeletePending = true"
        >
          删除
        </button>
        <button type="button" @click="closeSkillEditor">取消</button>
        <button v-if="skillDeletePending" class="dca-btn-danger" type="button" @click="deleteSkill">确认删除</button>
        <button v-else class="dca-btn-primary" type="button" :disabled="!canSaveSkill" @click="saveSkill">
          保存 Skill
        </button>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, shallowRef, toRaw, watch } from 'vue';
import { createSkillTemplate } from '../../core/skills/skill-registry';
import type { AgentSkill, SkillLoadingMode } from '../../core/skills/types';
import { useDreamCardAgent } from '../composables/runtime';

const { action, runtime, skillEditorRequest } = useDreamCardAgent();

const skillDeletePending = ref(false);
const skillModifyPending = ref(false);
// Skill内容会被structuredClone后写回；保持浅引用，避免Vue再次把references/assets包装成不可克隆的Proxy。
const editingSkill = shallowRef<AgentSkill>();
const skillDraft = reactive({
  body: '',
  description: '',
  id: '',
  loading: 'on-demand' as SkillLoadingMode,
  name: '',
});

const canSaveSkill = computed(
  () => skillDraft.name.trim() !== '' && skillDraft.description.trim() !== '' && skillDraft.body.trim() !== '',
);

watch(skillEditorRequest, request => {
  if (!request) return;
  skillDeletePending.value = request.deleting;
  skillModifyPending.value = false;
  if (request.skill) {
    const skill = structuredClone(toRaw(request.skill));
    editingSkill.value = skill;
    Object.assign(skillDraft, skill);
  } else {
    const template = createSkillTemplate('新 Skill', '说明这个Skill何时使用、能帮助Agent做什么。', 'on-demand');
    editingSkill.value = undefined;
    Object.assign(skillDraft, { ...template, id: '' });
  }
});

function closeSkillEditor() {
  skillEditorRequest.value = undefined;
  skillDeletePending.value = false;
  skillModifyPending.value = false;
  editingSkill.value = undefined;
}

function skillFromDraft(): AgentSkill {
  const source = editingSkill.value;
  const template = createSkillTemplate(skillDraft.name, skillDraft.description, skillDraft.loading);
  const id = source?.id ?? `${template.id}-${crypto.randomUUID().slice(0, 8)}`;
  return {
    assets: structuredClone(source?.assets ?? {}),
    body: skillDraft.body.trim(),
    builtin: false,
    description: skillDraft.description.trim(),
    id,
    loading: skillDraft.loading,
    name: skillDraft.name.trim(),
    references: structuredClone(source?.references ?? {}),
  };
}

async function saveSkill() {
  if (editingSkill.value && !skillModifyPending.value) {
    skillModifyPending.value = true;
    return;
  }
  await commitSkillSave();
}

async function commitSkillSave() {
  const skill = skillFromDraft();
  if (await action(() => runtime.saveGlobalSkill(skill))) {
    closeSkillEditor();
    toastr.success(`全局Skill“${skill.name}”已保存，下条用户消息开始采用新版。`, '梦境创客');
  }
}

async function deleteSkill() {
  if (!skillDraft.id) return;
  if (await action(() => runtime.removeGlobalSkill(skillDraft.id))) {
    const name = skillDraft.name;
    closeSkillEditor();
    toastr.success(`已删除全局Skill“${name}”。`, '梦境创客');
  }
}
</script>

<style lang="scss">
.dca-skill-editor {
  display: flex;
  width: min(46rem, 100%);
  max-height: min(52rem, calc(100vh - 2rem));
  flex-direction: column;
  gap: 0.75rem;
  overflow: auto;
}

.dca-skill-editor > header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
}

.dca-skill-editor > header h3,
.dca-skill-editor > header p {
  margin: 0;
}

.dca-skill-editor > header p {
  margin-top: 0.2rem;
  color: var(--dca-text-muted);
  font-size: 0.82rem;
}

.dca-skill-editor-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.45rem;
}

.dca-skill-editor-footer .dca-btn-danger {
  margin-right: auto;
}
</style>
