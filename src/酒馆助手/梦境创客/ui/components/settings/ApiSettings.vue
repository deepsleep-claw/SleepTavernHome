<template>
  <section class="dca-section-stack">
    <header class="dca-section-header">
      <div>
        <h3>API Profile</h3>
        <p>接口类型只决定协议；需要时可单独从接口读取模型列表。</p>
      </div>
    </header>
    <div class="dca-resource-toolbar">
      <label class="dca-field">
        <span>已保存 Profile</span>
        <select :value="state.activeProfileId" @change="selectProfile">
          <option value="">请选择</option>
          <option v-for="profile in state.profiles" :key="profile.id" :value="profile.id">
            {{ profile.name }} · {{ profile.model }}
          </option>
        </select>
      </label>
      <div class="dca-row-actions">
        <button type="button" @click="resetProfileForm">新建</button>
        <button v-if="profileForm.id" class="dca-btn-danger" type="button" @click="removeProfile">删除</button>
      </div>
    </div>
    <div class="dca-form-grid">
      <label class="dca-field"><span>名称</span><input v-model="profileForm.name" type="text" /></label>
      <label class="dca-field">
        <span>接口类型</span>
        <select v-model="profileForm.protocol">
          <option value="openai-responses">OpenAI Responses</option>
          <option value="openai-chat">OpenAI Chat</option>
          <option value="anthropic">Anthropic Messages</option>
          <option value="openai-compatible">OpenAI-compatible Chat</option>
        </select>
      </label>
      <label class="dca-field wide">
        <span>Base URL</span>
        <input v-model="profileForm.baseURL" type="url" placeholder="API版本根路径，例如 https://服务地址/v1" />
      </label>
      <label class="dca-field wide">
        <span>模型</span>
        <div class="dca-model-picker">
          <input v-model="profileForm.model" list="dca-model-options" type="text" />
          <button type="button" :disabled="modelsLoading || !profileForm.baseURL.trim()" @click="fetchModels">
            <i class="fa-solid fa-cloud-arrow-down" aria-hidden="true"></i>
            {{ modelsLoading ? '读取中' : '获取模型' }}
          </button>
        </div>
        <datalist id="dca-model-options">
          <option v-for="model in modelOptions" :key="model" :value="model"></option>
        </datalist>
        <small v-if="modelOptions.length">已读取 {{ modelOptions.length }} 个模型，可输入筛选。</small>
      </label>
      <label class="dca-field">
        <span>API Key</span>
        <input
          v-model="profileForm.apiKey"
          type="password"
          autocomplete="off"
          :placeholder="profileForm.id ? '留空则保留已保存Key' : '加盐混淆保存'"
        />
      </label>
      <label class="dca-field wide">
        <span>自定义请求头（JSON，默认空）</span>
        <textarea
          v-model="profileForm.headers"
          rows="4"
          :placeholder="profileForm.id ? '留空则保留已保存请求头' : '{}'"
          spellcheck="false"
        ></textarea>
      </label>
    </div>
    <p class="dca-security-note">
      AES-GCM 与固定脚本密码只能避免明文展示，不是安全保险箱。建议只在本地酒馆使用。
    </p>
    <div class="dca-resource-savebar">
      <span>{{ profileForm.id ? '正在编辑已保存 Profile' : '正在创建新 Profile' }}</span>
      <button class="dca-btn-primary" type="button" @click="saveProfile">保存 Profile</button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { reactive, ref, watch } from 'vue';
import { useDreamCardAgent } from '../../composables/runtime';

const { action, runtime, state } = useDreamCardAgent();

const profileForm = reactive({
  apiKey: '',
  baseURL: '',
  headers: '{}',
  id: '',
  model: '',
  name: '',
  protocol: 'openai-chat' as 'anthropic' | 'openai-chat' | 'openai-compatible' | 'openai-responses',
});
const modelOptions = ref<string[]>([]);
const modelsLoading = ref(false);

watch(
  () => state.value.activeProfileId,
  id => {
    const profile = state.value.profiles.find(item => item.id === id);
    if (profile)
      Object.assign(profileForm, {
        apiKey: '',
        baseURL: profile.baseURL,
        headers: '',
        id: profile.id,
        model: profile.model,
        name: profile.name,
        protocol: profile.protocol,
      });
    modelOptions.value = [];
  },
  { immediate: true },
);

function resetProfileForm() {
  Object.assign(profileForm, {
    apiKey: '',
    baseURL: '',
    headers: '{}',
    id: '',
    model: '',
    name: '',
    protocol: 'openai-chat',
  });
  modelOptions.value = [];
}

function profileInput() {
  const headers = profileForm.headers.trim() ? (JSON.parse(profileForm.headers) as Record<string, string>) : undefined;
  return { ...profileForm, headers, id: profileForm.id || undefined };
}

async function saveProfile() {
  try {
    if (await action(() => runtime.saveProfile(profileInput()))) {
      profileForm.apiKey = '';
      profileForm.headers = '';
    }
  } catch (error) {
    toastr.error(error instanceof Error ? error.message : String(error), '梦境创客');
  }
}

async function fetchModels() {
  modelsLoading.value = true;
  try {
    modelOptions.value = await runtime.listModels(profileInput());
    if (modelOptions.value.length === 0) toastr.warning('接口返回了空模型列表。', '梦境创客');
    else toastr.success(`已读取 ${modelOptions.value.length} 个模型。`, '梦境创客');
  } catch (error) {
    toastr.error(error instanceof Error ? error.message : String(error), '梦境创客');
  } finally {
    modelsLoading.value = false;
  }
}

async function removeProfile() {
  if (await action(() => runtime.removeProfile(profileForm.id))) resetProfileForm();
}

async function selectProfile(event: Event) {
  const id = (event.target as HTMLSelectElement).value;
  if (id) await action(() => runtime.selectProfile(id));
}
</script>

<style lang="scss">
.dca-model-picker {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 0.4rem;
}

.dca-security-note {
  margin: 0;
  border-left: 3px solid var(--dca-warning);
  padding-left: 0.65rem;
  color: var(--dca-text-muted);
  font-size: 0.82rem;
}
</style>
