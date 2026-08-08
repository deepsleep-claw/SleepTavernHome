<template>
  <div class="dca-app">
    <header class="dca-header">
      <div class="dca-brand">
        <span class="dca-logo">梦</span>
        <div>
          <strong>梦境创客</strong>
          <small v-if="state.currentCharacter">{{ state.currentCharacter.name }} · {{ shortId(state.currentCharacter.bindingId) }}</small>
          <small v-else>请先打开一张角色卡</small>
        </div>
      </div>
      <div class="dca-header-actions">
        <span class="dca-status" :class="`dca-status-${state.active?.status ?? 'idle'}`">{{ statusLabel }}</span>
        <button class="dca-icon-button" type="button" title="刷新角色与会话" @click="refresh">
          <i class="fa-solid fa-rotate" aria-hidden="true"></i>
        </button>
      </div>
    </header>

    <div v-if="state.error" class="dca-alert dca-alert-error">
      <i class="fa-solid fa-circle-exclamation" aria-hidden="true"></i>
      <span>{{ state.error }}</span>
    </div>
    <div v-if="state.active?.readOnly" class="dca-alert dca-alert-warning">
      <span>此会话正在其他页面运行，当前只读。</span>
      <button type="button" @click="takeOver">手动接管</button>
    </div>

    <nav class="dca-tabs" aria-label="梦境创客功能">
      <button v-for="tab in tabs" :key="tab.id" type="button" :class="{ active: activeTab === tab.id }" @click="activeTab = tab.id">
        <i :class="tab.icon" aria-hidden="true"></i>
        <span>{{ tab.label }}</span>
        <em v-if="tab.id === 'diff' && changeCount">{{ changeCount }}</em>
      </button>
    </nav>

    <main class="dca-main">
      <section v-if="activeTab === 'chat'" class="dca-chat-panel">
        <div v-if="!state.active" class="dca-start-card">
          <h3>为当前角色开始创作</h3>
          <p>会话会绑定到角色卡，普通酒馆聊天与Agent请求互不干扰。</p>
          <label>
            <span>已有会话</span>
            <select v-model="selectedSessionId">
              <option value="">选择会话</option>
              <option v-for="session in currentSessions" :key="session.sessionId" :value="session.sessionId">
                {{ session.title }} · r{{ session.revision }}
              </option>
            </select>
          </label>
          <div class="dca-row-actions">
            <button type="button" :disabled="!selectedSessionId || state.busy" @click="openSelectedSession">打开会话</button>
            <button type="button" :disabled="!canCreateSession || state.busy" @click="createSession">新建会话</button>
          </div>
          <small v-if="state.profiles.length === 0">请先到“API”页保存一套设置。不会额外发送连接测试。</small>
        </div>

        <template v-else>
          <div class="dca-session-bar">
            <div>
              <strong>{{ state.active.title }}</strong>
              <small>{{ state.active.mode === 'yolo' ? 'YOLO：低风险自动写入' : '普通：批准后写入' }}</small>
            </div>
            <label class="dca-switch">
              <input
                type="checkbox"
                :checked="state.active.mode === 'yolo'"
                :disabled="state.active.readOnly"
                @change="setYolo"
              />
              <span>YOLO</span>
            </label>
            <select v-model="selectedSessionId" :disabled="isRunning || state.busy" title="切换当前角色的会话" @change="switchActiveSession">
              <option :value="state.active.sessionId">当前会话</option>
              <option v-for="session in currentSessions.filter(item => item.sessionId !== state.active?.sessionId)" :key="session.sessionId" :value="session.sessionId">{{ session.title }}</option>
            </select>
            <button type="button" :disabled="isRunning || Boolean(state.active.approval) || state.busy" @click="createSession">新会话</button>
          </div>

          <div ref="timelineElement" class="dca-timeline">
            <button v-if="hiddenTimelineCount > 0" class="dca-load-more" type="button" @click="timelineLimit += 200">
              再显示较早的 {{ Math.min(200, hiddenTimelineCount) }} 条
            </button>
            <article v-for="item in visibleTimeline" :key="item.id" class="dca-message" :class="`dca-message-${item.kind}`">
              <header>
                <span>{{ itemKindLabel(item.kind) }}</span>
                <small>{{ formatTime(item.at) }}</small>
              </header>
              <template v-if="editingMessageId === item.id">
                <textarea v-model="editingMessageText" rows="3"></textarea>
                <div class="dca-row-actions">
                  <button type="button" @click="saveEditedMessage(item.id)">保存</button>
                  <button type="button" @click="cancelEditMessage">取消</button>
                </div>
              </template>
              <details v-else-if="item.kind === 'tool'" :open="item.status === 'failed'" class="dca-tool-card">
                <summary>
                  <i class="fa-solid fa-screwdriver-wrench" aria-hidden="true"></i>
                  {{ item.toolName }}
                  <span :class="`dca-tool-${item.status}`">{{ item.status }}</span>
                </summary>
                <pre>{{ item.content }}</pre>
              </details>
              <p v-else>{{ cleanGuidance(item.content) }}</p>
              <footer v-if="item.kind === 'user'" class="dca-message-actions">
                <button type="button" :disabled="state.active.readOnly" @click="undoTo(item.id)">回退本轮修改</button>
                <button type="button" :disabled="state.active.readOnly" title="编辑并可重新发送" @click="beginEditMessage(item)">
                  <i class="fa-solid fa-pencil" aria-hidden="true"></i>
                </button>
                <button type="button" :disabled="state.active.readOnly || !canSend" @click="resend(item.id)">重新发送</button>
              </footer>
            </article>
            <div v-if="visibleTimeline.length === 0" class="dca-empty">告诉Agent你想怎样完善这张角色卡吧。</div>
          </div>

          <div v-if="isRunning" class="dca-guidance-box">
            <textarea v-model="guidance" rows="2" placeholder="中途引导：追加到下一次工具调用后；若本轮已完成则成为下一条消息"></textarea>
            <button type="button" :disabled="!guidance.trim()" @click="sendGuidance">插入引导</button>
          </div>

          <div class="dca-composer">
            <textarea
              v-model="message"
              rows="3"
              :disabled="!canSend"
              placeholder="例如：请检查角色动机，并补充三个互相呼应的世界书条目……"
              @keydown.ctrl.enter.prevent="send"
            ></textarea>
            <div class="dca-composer-actions">
              <button v-if="canResume" type="button" :disabled="state.busy" @click="resume">从中断处继续</button>
              <button v-if="isRunning" class="danger" type="button" @click="stop">停止</button>
              <button type="button" :disabled="!canSend || !message.trim() || state.busy" @click="send">发送</button>
            </div>
          </div>
        </template>
      </section>

      <section v-else-if="activeTab === 'files'" class="dca-split-panel">
        <aside class="dca-file-list">
          <header><strong>Card Workspace</strong><small>{{ files.length }} 个文件</small></header>
          <button
            v-for="file in visibleFiles"
            :key="file.path"
            type="button"
            :class="{ active: selectedFilePath === file.path }"
            @click="selectFile(file.path)"
          >
            <i :class="file.readonly ? 'fa-solid fa-lock' : 'fa-regular fa-file-lines'" aria-hidden="true"></i>
            <span>{{ file.path }}</span>
          </button>
          <button v-if="visibleFiles.length < files.length" class="dca-load-more" type="button" @click="fileLimit += 200">加载更多</button>
        </aside>
        <div class="dca-editor">
          <template v-if="selectedFile">
            <header>
              <div><strong>{{ selectedFile.path }}</strong><small>{{ selectedFile.mediaType }} · {{ selectedFile.resourceId }}</small></div>
              <button type="button" :disabled="!canEditFile || fileDraft === selectedFile.content" @click="saveFile">保存到Working Copy</button>
            </header>
            <textarea v-model="fileDraft" spellcheck="false" :readonly="!canEditFile"></textarea>
            <small v-if="!canEditFile">只读资源、只读会话或Agent运行期间不能编辑。</small>
          </template>
          <div v-else class="dca-empty">选择一个文件查看。路径使用大小写敏感POSIX语义。</div>
        </div>
      </section>

      <section v-else-if="activeTab === 'diff'" class="dca-section-stack">
        <header class="dca-section-header">
          <div><h3>Working Diff</h3><p>只会物化你批准的路径，酒馆中的不重叠手改会保留。</p></div>
          <div class="dca-row-actions">
            <button type="button" :disabled="!state.active || state.active.readOnly || state.busy" @click="undo">撤销</button>
            <button type="button" :disabled="!state.active || state.active.readOnly || state.busy" @click="redo">重做</button>
          </div>
        </header>
        <div v-if="!state.active?.approval" class="dca-empty">当前没有待批准修改。</div>
        <template v-else>
          <div v-for="warning in state.active.approval.warnings" :key="warning" class="dca-alert dca-alert-warning">{{ warning }}</div>
          <article v-for="change in approvalChanges" :key="change.path" class="dca-diff-item" :class="{ danger: change.highRisk }">
            <header>
              <div><strong>{{ change.label }}</strong><code>{{ change.path }}</code></div>
              <span v-if="change.highRisk">强制确认</span>
            </header>
            <div v-if="conflictByPath(change.path)" class="dca-conflict-grid">
              <details><summary>Base</summary><pre>{{ pretty(conflictByPath(change.path)?.base) }}</pre></details>
              <details><summary>酒馆当前</summary><pre>{{ pretty(conflictByPath(change.path)?.current) }}</pre></details>
              <details><summary>Agent</summary><pre>{{ pretty(conflictByPath(change.path)?.agent) }}</pre></details>
            </div>
            <div class="dca-decision">
              <label><input v-model="decisions[change.path]" type="radio" value="current" />保留酒馆当前</label>
              <label><input v-model="decisions[change.path]" type="radio" value="agent" />采用Agent修改</label>
            </div>
          </article>
          <div class="dca-sticky-actions">
            <span>未选择的项目会保留酒馆当前版本。</span>
            <button type="button" :disabled="state.busy || state.active.readOnly" @click="approve">提交已选修改</button>
          </div>
        </template>
      </section>

      <section v-else-if="activeTab === 'context'" class="dca-section-stack">
        <header class="dca-section-header"><div><h3>上下文监视器</h3><p>达到70%自动压缩；用户消息自身达到80%时暂停。</p></div></header>
        <template v-if="state.active">
          <div class="dca-context-meter">
            <span :style="{ width: `${Math.min(100, state.active.contextUsage.ratio * 100)}%` }"></span>
            <i style="left: 70%"></i>
          </div>
          <div class="dca-metric-grid">
            <div><strong>{{ state.active.contextUsage.totalTokens }}</strong><span>估算总Token</span></div>
            <div><strong>{{ state.active.contextUsage.remainingTokens }}</strong><span>剩余空间</span></div>
            <div><strong>{{ state.active.contextUsage.systemTokens }}</strong><span>静态头部</span></div>
            <div><strong>{{ state.active.contextUsage.userTokens }}</strong><span>用户消息</span></div>
            <div><strong>{{ state.active.contextUsage.assistantTokens }}</strong><span>助手消息</span></div>
            <div><strong>{{ state.active.contextUsage.toolTokens }}</strong><span>工具链</span></div>
          </div>
          <details><summary>上下文事件</summary><pre>{{ pretty(state.active.events.filter(event => event.type === 'context-compacted')) }}</pre></details>
        </template>
        <div v-else class="dca-empty">打开会话后显示上下文组成。</div>
      </section>

      <section v-else-if="activeTab === 'skills'" class="dca-section-stack">
        <header class="dca-section-header"><div><h3>Skill</h3><p>所有已启用Skill的摘要可见；full正文进入静态头，on-demand由Agent按需读取。</p></div></header>
        <article class="dca-skill-card builtin">
          <header><strong>角色卡与世界书文件读写</strong><span>内置 · full · 只读</span></header>
          <p>教Agent安全探索、编辑并校验Card Workspace。</p>
        </article>
        <article v-for="skill in state.active?.skills ?? []" :key="skill.id" class="dca-skill-card">
          <header><strong>{{ skill.name }}</strong><span>{{ skill.loading }}</span></header>
          <p>{{ skill.description }}</p>
          <code>/skills/user/{{ skill.id }}/SKILL.md</code>
        </article>
        <div v-if="!state.active" class="dca-empty">Skill与会话一起固定；请先打开会话。</div>
        <button v-else type="button" @click="openSkillFolder">在文件页编辑Skill</button>
      </section>

      <section v-else-if="activeTab === 'preset'" class="dca-section-stack">
        <header class="dca-section-header"><div><h3>结构化预设</h3><p>只编译Agent静态头部；编辑后需明确“应用新版”。</p></div></header>
        <div v-if="!presetDraft" class="dca-empty">打开会话后编辑其固定预设。</div>
        <template v-else>
          <label class="dca-field"><span>预设名称</span><input v-model="presetDraft.name" type="text" /></label>
          <article v-for="node in sortedPresetNodes" :key="node.id" class="dca-preset-node">
            <header>
              <input v-model="node.enabled" type="checkbox" />
              <input v-model="node.title" type="text" />
              <select v-model="node.role"><option value="system">system</option><option value="user">user</option><option value="assistant">assistant</option></select>
              <input v-model.number="node.order" type="number" />
              <button type="button" title="删除节点" @click="removePresetNode(node.id)"><i class="fa-solid fa-trash" aria-hidden="true"></i></button>
            </header>
            <textarea v-model="node.content" rows="5" spellcheck="false"></textarea>
          </article>
          <div class="dca-row-actions"><button type="button" @click="addPresetNode">添加节点</button><button type="button" @click="applyPreset">应用新版</button></div>
          <details><summary>可用位置宏</summary><code>{{ presetMacros.join(' · ') }}</code></details>
        </template>
      </section>

      <section v-else-if="activeTab === 'api'" class="dca-section-stack">
        <header class="dca-section-header"><div><h3>API设置</h3><p>接口类型只决定协议；Base URL不会自动填写，也不会额外测试连接。</p></div></header>
        <label class="dca-field"><span>已保存Profile</span><select :value="state.activeProfileId" @change="selectProfile"><option value="">请选择</option><option v-for="profile in state.profiles" :key="profile.id" :value="profile.id">{{ profile.name }} · {{ profile.model }}</option></select></label>
        <div class="dca-form-grid">
          <label class="dca-field"><span>名称</span><input v-model="profileForm.name" type="text" /></label>
          <label class="dca-field"><span>接口类型</span><select v-model="profileForm.protocol"><option value="openai-responses">OpenAI Responses</option><option value="openai-chat">OpenAI Chat</option><option value="anthropic">Anthropic Messages</option><option value="openai-compatible">OpenAI-compatible Chat</option></select></label>
          <label class="dca-field wide"><span>Base URL</span><input v-model="profileForm.baseURL" type="url" placeholder="由你填写完整地址" /></label>
          <label class="dca-field"><span>模型</span><input v-model="profileForm.model" type="text" /></label>
          <label class="dca-field"><span>API Key</span><input v-model="profileForm.apiKey" type="password" autocomplete="off" placeholder="加盐混淆保存" /></label>
          <label class="dca-field wide"><span>自定义请求头（JSON，默认空）</span><textarea v-model="profileForm.headers" rows="4" spellcheck="false"></textarea></label>
        </div>
        <p class="dca-security-note">AES-GCM与固定脚本密码只能避免明文展示，不是安全保险箱。建议只在本地酒馆使用。</p>
        <div class="dca-row-actions"><button type="button" @click="resetProfileForm">新建</button><button type="button" @click="saveProfile">保存（不测试连接）</button><button v-if="profileForm.id" class="danger" type="button" @click="removeProfile">删除</button></div>
      </section>

      <section v-else class="dca-section-stack">
        <header class="dca-section-header"><div><h3>设置与诊断</h3><p>开发日志只在当前浏览器页面内存中存在。</p></div></header>
        <label class="dca-toggle-row"><span><strong>显示悬浮按钮</strong><small>魔法棒入口始终保留</small></span><input type="checkbox" :checked="state.floatingButton" @change="toggleFloating" /></label>
        <label class="dca-toggle-row"><span><strong>开发者模式</strong><small>显示步骤、哈希、Revision与更多调试信息；不绕过任何保护</small></span><input type="checkbox" :checked="state.developerMode" @change="toggleDeveloper" /></label>
        <template v-if="state.developerMode">
          <div class="dca-metric-grid"><div><strong>{{ activeSessionIndex?.revision ?? 0 }}</strong><span>Revision</span></div><div><strong>{{ state.active?.events.length ?? 0 }}</strong><span>事务事件</span></div><div><strong>{{ state.active?.workingFiles.length ?? 0 }}</strong><span>工作区文件</span></div></div>
          <details open><summary>最近事件</summary><pre>{{ pretty(state.active?.events.slice(-100) ?? []) }}</pre></details>
          <details><summary>当前页面内存日志</summary><pre>{{ pretty(state.debugLogs.slice(-100)) }}</pre></details>
          <details><summary>会话索引（已脱离创作正文）</summary><pre>{{ pretty(activeSessionIndex) }}</pre></details>
          <button type="button" @click="copyDiagnostics">复制脱敏诊断包</button>
        </template>
        <details v-if="orphanSessions.length"><summary>其他角色或孤立会话（{{ orphanSessions.length }}）</summary><ul><li v-for="session in orphanSessions" :key="session.sessionId">{{ session.characterName }} · {{ session.title }} · r{{ session.revision }}</li></ul></details>
      </section>
    </main>

    <div v-if="state.toolConfirmation" class="dca-modal-backdrop">
      <section class="dca-modal">
        <h3>确认高危Skill操作</h3>
        <p>{{ state.toolConfirmation.description }}</p>
        <code>{{ state.toolConfirmation.toolName }} · {{ state.toolConfirmation.toolCallId }}</code>
        <div class="dca-row-actions"><button type="button" @click="resolveTool(false)">拒绝</button><button class="danger" type="button" @click="resolveTool(true)">允许这一次</button></div>
      </section>
    </div>

    <div v-if="!state.onboardingDone" class="dca-modal-backdrop">
      <section class="dca-modal dca-onboarding">
        <span>快速引导 {{ onboardingStep + 1 }} / 5</span>
        <h3>{{ onboarding[onboardingStep].title }}</h3>
        <p>{{ onboarding[onboardingStep].body }}</p>
        <div class="dca-row-actions"><button type="button" @click="finishOnboarding">跳过</button><button type="button" @click="nextOnboarding">{{ onboardingStep === 4 ? '开始创作' : '下一步' }}</button></div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { PRESET_MACROS, type StructuredPreset } from '../core/preset/compiler';
import type { SessionUiItem } from '../core/session/types';
import { getDreamCardAgentRuntime, type DreamCardAgentRuntimeState } from '../runtime/dream-card-agent-runtime';

const runtime = getDreamCardAgentRuntime();
const state = ref<DreamCardAgentRuntimeState>(runtime.snapshot());
const activeTab = ref('chat');
const message = ref('');
const guidance = ref('');
const selectedSessionId = ref('');
const timelineLimit = ref(200);
const fileLimit = ref(200);
const selectedFilePath = ref('');
const fileDraft = ref('');
const editingMessageId = ref('');
const editingMessageText = ref('');
const decisions = reactive<Record<string, 'agent' | 'current' | undefined>>({});
const onboardingStep = ref(0);
const presetDraft = ref<StructuredPreset>();
let unsubscribe = () => {};

const profileForm = reactive({ apiKey: '', baseURL: '', headers: '{}', id: '', model: '', name: '', protocol: 'openai-chat' as 'anthropic' | 'openai-chat' | 'openai-compatible' | 'openai-responses' });
const tabs = [
  { icon: 'fa-solid fa-comments', id: 'chat', label: '会话' },
  { icon: 'fa-solid fa-folder-tree', id: 'files', label: '文件' },
  { icon: 'fa-solid fa-code-compare', id: 'diff', label: 'Diff' },
  { icon: 'fa-solid fa-gauge-high', id: 'context', label: '上下文' },
  { icon: 'fa-solid fa-wand-magic-sparkles', id: 'skills', label: 'Skill' },
  { icon: 'fa-solid fa-layer-group', id: 'preset', label: '预设' },
  { icon: 'fa-solid fa-plug', id: 'api', label: 'API' },
  { icon: 'fa-solid fa-gear', id: 'settings', label: '设置' },
];
const onboarding = [
  { title: '先打开角色卡', body: '梦境创客只编辑当前单角色卡，并用稳定绑定避免会话串卡。' },
  { title: '准备API', body: '保存Base URL、Key和模型；首次真实请求才验证，不浪费测试Token。' },
  { title: '像文件一样创作', body: '角色字段、开场白、世界书和Skill都投影到隔离的Card Workspace。' },
  { title: '先快照，再修改', body: '每条要求都有检查点；普通模式逐项批准，YOLO仍拦截高危操作。' },
  { title: '窗口可以放心关闭', body: '关闭浮窗不会停止本页中的Agent；关闭浏览器则会标记异常中断并从成功步骤恢复。' },
];
const presetMacros = PRESET_MACROS.map(item => `{{${item}}}`);

const currentSessions = computed(() => state.value.sessions.filter(item => item.bindingId === state.value.currentCharacter?.bindingId));
const files = computed(() => state.value.active?.workingFiles ?? []);
const visibleFiles = computed(() => files.value.slice(0, fileLimit.value));
const selectedFile = computed(() => files.value.find(file => file.path === selectedFilePath.value));
const visibleTimeline = computed(() => (state.value.active?.ui ?? []).slice(-timelineLimit.value));
const hiddenTimelineCount = computed(() => Math.max(0, (state.value.active?.ui.length ?? 0) - timelineLimit.value));
const isRunning = computed(() => ['running', 'waiting-approval'].includes(state.value.active?.status ?? ''));
const canResume = computed(() => ['abnormal', 'failed', 'stopped', 'context-exhausted'].includes(state.value.active?.status ?? '') && !state.value.active?.approval && !state.value.active?.readOnly);
const canSend = computed(() => Boolean(state.value.active && !state.value.active.readOnly && !isRunning.value && !state.value.active.approval));
const canCreateSession = computed(() => Boolean(state.value.currentCharacter && state.value.profiles.length));
const canEditFile = computed(() => Boolean(selectedFile.value && !selectedFile.value.readonly && state.value.active && !state.value.active.readOnly && !isRunning.value));
const changeCount = computed(() => (state.value.active?.approval?.stateChanges.length ?? 0) + (state.value.active?.approval?.skillChanges.length ?? 0));
const approvalChanges = computed(() => [...(state.value.active?.approval?.stateChanges ?? []), ...(state.value.active?.approval?.skillChanges ?? [])]);
const statusLabel = computed(() => ({ abnormal: '异常中断', 'awaiting-approval': '等待批准', committing: '提交中', completed: '已完成', 'context-exhausted': '上下文已满', failed: '失败', idle: '空闲', running: '运行中', stopped: '已停止', 'waiting-approval': '工具确认' }[state.value.active?.status ?? 'idle']));
const sortedPresetNodes = computed(() => [...(presetDraft.value?.nodes ?? [])].sort((a, b) => a.order - b.order));
const activeSessionIndex = computed(() => state.value.sessions.find(item => item.sessionId === state.value.active?.sessionId));
const orphanSessions = computed(() => state.value.sessions.filter(item => item.bindingId !== state.value.currentCharacter?.bindingId));

watch(() => state.value.active?.approval?.candidateSnapshot, () => {
  Object.keys(decisions).forEach(key => delete decisions[key]);
  approvalChanges.value.forEach(change => { decisions[change.path] = 'current'; });
  if (state.value.active?.approval) activeTab.value = 'diff';
});
watch(() => state.value.active?.preset, preset => { if (preset) presetDraft.value = structuredClone(preset); }, { immediate: true });
watch(selectedFile, file => { fileDraft.value = file?.content ?? ''; });
watch(() => state.value.activeProfileId, id => {
  const profile = state.value.profiles.find(item => item.id === id);
  if (profile) Object.assign(profileForm, { apiKey: '', baseURL: profile.baseURL, headers: '{}', id: profile.id, model: profile.model, name: profile.name, protocol: profile.protocol });
}, { immediate: true });

onMounted(() => {
  unsubscribe = runtime.subscribe(next => { state.value = next; });
  void refresh();
});
onBeforeUnmount(() => unsubscribe());

async function action(work: () => Promise<unknown>) { try { await work(); } catch (error) { toastr.error(error instanceof Error ? error.message : String(error), '梦境创客'); } }
async function refresh() { await action(() => runtime.refreshCharacter()); }
async function createSession() { await action(async () => { await runtime.createSession(); activeTab.value = 'chat'; }); }
async function openSelectedSession() { await action(async () => { await runtime.openSession(selectedSessionId.value); activeTab.value = 'chat'; }); }
async function switchActiveSession() { if (selectedSessionId.value && selectedSessionId.value !== state.value.active?.sessionId) await openSelectedSession(); }
async function takeOver() { await action(() => runtime.takeOverSession()); }
async function send() { const text = message.value; message.value = ''; await action(() => runtime.send(text)); }
async function resume() { await action(() => runtime.resume()); }
function stop() { runtime.stop(); }
function sendGuidance() { runtime.enqueueGuidance(guidance.value); guidance.value = ''; }
async function approve() { await action(() => runtime.approve(Object.fromEntries(Object.entries(decisions).filter(([, value]) => value)) as Record<string, 'agent' | 'current'>)); }
async function undo() { await action(() => runtime.undo()); }
async function redo() { await action(() => runtime.redo()); }
async function undoTo(id: string) { await action(() => runtime.undoToUserMessage(id)); }
async function resend(id: string) { await action(() => runtime.resend(id)); }
function beginEditMessage(item: SessionUiItem) { editingMessageId.value = item.id; editingMessageText.value = item.content; }
function cancelEditMessage() { editingMessageId.value = ''; editingMessageText.value = ''; }
function saveEditedMessage(id: string) { runtime.editUserMessage(id, editingMessageText.value); cancelEditMessage(); }
function selectFile(path: string) { selectedFilePath.value = path; }
async function saveFile() { if (selectedFile.value) await action(() => runtime.writeWorkingFile(selectedFile.value!.path, fileDraft.value)); }
function openSkillFolder() { activeTab.value = 'files'; selectedFilePath.value = state.value.active?.workingFiles.find(file => file.path.includes('/skills/user/'))?.path ?? '/skills/index.md'; }
function conflictByPath(path: string) { return state.value.active?.approval?.conflicts.find(conflict => conflict.path === path); }
function setYolo(event: Event) { if (state.value.active) void action(() => runtime.setMode((event.target as HTMLInputElement).checked ? 'yolo' : 'normal')); }
function resolveTool(approved: boolean) { runtime.resolveToolConfirmation(approved); }
function resetProfileForm() { Object.assign(profileForm, { apiKey: '', baseURL: '', headers: '{}', id: '', model: '', name: '', protocol: 'openai-chat' }); }
async function saveProfile() { await action(async () => { const headers = JSON.parse(profileForm.headers || '{}') as Record<string, string>; await runtime.saveProfile({ ...profileForm, headers, id: profileForm.id || undefined }); profileForm.apiKey = ''; }); }
async function removeProfile() { await action(async () => { await runtime.removeProfile(profileForm.id); resetProfileForm(); }); }
async function selectProfile(event: Event) { const id = (event.target as HTMLSelectElement).value; if (id) await action(() => runtime.selectProfile(id)); }
async function toggleFloating(event: Event) { await action(() => runtime.updateSettings({ floatingButton: (event.target as HTMLInputElement).checked })); }
async function toggleDeveloper(event: Event) { await action(() => runtime.updateSettings({ developerMode: (event.target as HTMLInputElement).checked })); }
async function finishOnboarding() { await action(() => runtime.updateSettings({ onboardingDone: true })); }
async function nextOnboarding() { if (onboardingStep.value < 4) onboardingStep.value += 1; else await finishOnboarding(); }
function addPresetNode() { presetDraft.value?.nodes.push({ content: '{{custom_instructions}}', enabled: true, id: crypto.randomUUID(), order: (Math.max(0, ...presetDraft.value.nodes.map(node => node.order)) + 10), role: 'system', title: '新节点' }); }
function removePresetNode(id: string) { if (presetDraft.value) presetDraft.value.nodes = presetDraft.value.nodes.filter(node => node.id !== id); }
async function applyPreset() { if (!presetDraft.value) return; presetDraft.value.version += 1; await action(() => runtime.applyPreset(structuredClone(presetDraft.value!))); }
function shortId(value: string) { return value.length > 18 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value; }
function formatTime(at: number) { return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
function itemKindLabel(kind: SessionUiItem['kind']) { return ({ assistant: '梦境创客', guidance: '中途引导', status: '运行状态', tool: '工具调用', user: '你' })[kind]; }
function cleanGuidance(value: string) { return value.replace(/<\/?mid_turn_guidance>/gu, '').replace('这是对当前未完成目标的中途补充，不是替换旧目标的新任务。', '').trim(); }
function pretty(value: unknown) { return JSON.stringify(value, null, 2); }
async function copyDiagnostics() { await navigator.clipboard.writeText(JSON.stringify(runtime.diagnosticBundle(), null, 2)); toastr.success('已复制脱敏诊断包', '梦境创客'); }
</script>

<style lang="scss">
.dca-app { --dca-accent:#9d7cff; --dca-bg:#17151f; --dca-panel:#211e2b; --dca-border:#3e3850; --dca-text:#f5f1ff; --dca-muted:#aea6c2; display:flex; flex-direction:column; height:100%; min-height:0; overflow:hidden; background:linear-gradient(145deg,#17151f,#121018); color:var(--dca-text); font:14px/1.45 system-ui,sans-serif; }
.dca-app * { box-sizing:border-box; }
.dca-app button,.dca-app input,.dca-app textarea,.dca-app select { font:inherit; }
.dca-app button { border:1px solid var(--dca-border); border-radius:8px; padding:.48rem .75rem; background:#2b2638; color:var(--dca-text); cursor:pointer; }
.dca-app button:hover:not(:disabled) { border-color:var(--dca-accent); background:#352e49; }
.dca-app button:disabled { opacity:.45; cursor:not-allowed; }
.dca-app button.danger,.dca-diff-item.danger { border-color:#b85d72; }
.dca-app input,.dca-app textarea,.dca-app select { width:100%; border:1px solid var(--dca-border); border-radius:8px; padding:.52rem .65rem; background:#14121b; color:var(--dca-text); }
.dca-app textarea { resize:vertical; }
.dca-header { display:flex; flex:0 0 auto; align-items:center; justify-content:space-between; gap:1rem; border-bottom:1px solid var(--dca-border); padding:.65rem .8rem; background:#1e1a29; }
.dca-brand,.dca-header-actions,.dca-row-actions,.dca-composer-actions { display:flex; align-items:center; gap:.55rem; }
.dca-brand>div,.dca-section-header>div,.dca-session-bar>div,.dca-editor header>div { display:flex; min-width:0; flex-direction:column; }
.dca-brand small,.dca-section-header p,.dca-session-bar small,.dca-editor small,.dca-start-card small { color:var(--dca-muted); }
.dca-logo { display:grid; width:2.2rem; height:2.2rem; place-items:center; border-radius:12px; background:linear-gradient(135deg,#b69cff,#6f4bd8); font-weight:900; }
.dca-icon-button { width:2.2rem; height:2.2rem; padding:0!important; }
.dca-status { border:1px solid var(--dca-border); border-radius:999px; padding:.18rem .55rem; color:var(--dca-muted); font-size:.78rem; }
.dca-status-running,.dca-status-committing { border-color:#54b89a; color:#85e2c5; }
.dca-status-failed,.dca-status-abnormal { border-color:#c86c7f; color:#ff9eb2; }
.dca-status-awaiting-approval,.dca-status-waiting-approval { border-color:#d7a84c; color:#ffd47c; }
.dca-tabs { display:flex; flex:0 0 auto; gap:.15rem; overflow-x:auto; border-bottom:1px solid var(--dca-border); padding:.35rem .45rem; background:#181520; scrollbar-width:thin; }
.dca-tabs button { display:flex; flex:0 0 auto; align-items:center; gap:.35rem; border-color:transparent; background:transparent; color:var(--dca-muted); }
.dca-tabs button.active { border-color:var(--dca-border); background:#2a2536; color:var(--dca-text); }
.dca-tabs em { min-width:1.25rem; border-radius:999px; background:#8a6070; color:white; font-size:.72rem; font-style:normal; text-align:center; }
.dca-main { flex:1 1 auto; min-height:0; overflow:auto; }
.dca-chat-panel,.dca-section-stack { display:flex; min-height:100%; flex-direction:column; gap:.75rem; padding:.8rem; }
.dca-start-card { width:min(32rem,100%); margin:auto; border:1px solid var(--dca-border); border-radius:14px; padding:1rem; background:var(--dca-panel); }
.dca-start-card h3,.dca-section-header h3 { margin:0; }
.dca-start-card label,.dca-field { display:flex; flex-direction:column; gap:.3rem; margin:.7rem 0; }
.dca-session-bar,.dca-section-header,.dca-editor header,.dca-skill-card header,.dca-preset-node header,.dca-diff-item>header { display:flex; align-items:center; justify-content:space-between; gap:.7rem; }
.dca-session-bar select { width:auto; max-width:14rem; }
.dca-switch { display:flex; align-items:center; gap:.4rem; }
.dca-switch input { width:auto; }
.dca-timeline { display:flex; flex:1 1 auto; min-height:12rem; flex-direction:column; gap:.6rem; overflow:auto; padding:.2rem; }
.dca-message { max-width:90%; border:1px solid var(--dca-border); border-radius:12px; padding:.65rem .75rem; background:var(--dca-panel); }
.dca-message-user { align-self:flex-end; background:#302847; }
.dca-message-tool { width:92%; max-width:none; border-left:3px solid #7a669c; }
.dca-message-tool:has(.dca-tool-failed) { border-color:#bd6076; }
.dca-message-guidance { border-style:dashed; border-color:#c29b4f; }
.dca-message>header { display:flex; justify-content:space-between; color:var(--dca-muted); font-size:.76rem; }
.dca-message p { margin:.4rem 0 0; white-space:pre-wrap; overflow-wrap:anywhere; }
.dca-message-actions { display:flex; justify-content:flex-end; gap:.35rem; border-top:1px solid var(--dca-border); margin-top:.55rem; padding-top:.45rem; }
.dca-message-actions button { padding:.3rem .48rem; font-size:.76rem; }
.dca-tool-card summary { display:flex; align-items:center; gap:.45rem; cursor:pointer; }
.dca-tool-card summary span { margin-left:auto; }
.dca-tool-card pre,.dca-app details pre { max-height:18rem; overflow:auto; white-space:pre-wrap; word-break:break-word; }
.dca-tool-failed { color:#ff91a8; }
.dca-guidance-box,.dca-composer { display:grid; flex:0 0 auto; grid-template-columns:minmax(0,1fr) auto; gap:.5rem; border-top:1px solid var(--dca-border); padding-top:.65rem; }
.dca-composer { grid-template-columns:1fr; }
.dca-composer-actions { justify-content:flex-end; }
.dca-alert { display:flex; flex:0 0 auto; align-items:center; gap:.5rem; margin:.5rem .7rem 0; border:1px solid; border-radius:8px; padding:.5rem .65rem; }
.dca-alert-error { border-color:#b85d72; background:#3a202a; }
.dca-alert-warning { border-color:#9a783d; background:#352b1f; }
.dca-alert button { margin-left:auto; }
.dca-split-panel { display:grid; height:100%; min-height:0; grid-template-columns:minmax(15rem,.8fr) minmax(0,1.7fr); }
.dca-file-list { display:flex; min-height:0; flex-direction:column; overflow:auto; border-right:1px solid var(--dca-border); padding:.55rem; }
.dca-file-list header { display:flex; justify-content:space-between; padding:.4rem; }
.dca-file-list button { display:flex; align-items:center; gap:.45rem; overflow:hidden; border-color:transparent; background:transparent; text-align:left; }
.dca-file-list button span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.dca-file-list button.active { border-color:var(--dca-accent); background:#2d2740; }
.dca-editor { display:flex; min-height:0; flex-direction:column; gap:.55rem; padding:.75rem; }
.dca-editor textarea { flex:1 1 auto; min-height:12rem; resize:none; font:13px/1.5 ui-monospace,monospace; }
.dca-empty { margin:auto; border:1px dashed var(--dca-border); border-radius:10px; padding:1rem; color:var(--dca-muted); text-align:center; }
.dca-load-more { align-self:center; }
.dca-diff-item,.dca-skill-card,.dca-preset-node { border:1px solid var(--dca-border); border-radius:12px; padding:.7rem; background:var(--dca-panel); }
.dca-diff-item header>div { display:flex; min-width:0; flex-direction:column; }
.dca-diff-item code,.dca-skill-card code { color:var(--dca-muted); overflow-wrap:anywhere; }
.dca-decision { display:flex; flex-wrap:wrap; gap:1rem; margin-top:.55rem; }
.dca-decision label { display:flex; align-items:center; gap:.35rem; }
.dca-decision input { width:auto; }
.dca-conflict-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:.45rem; margin-top:.55rem; }
.dca-conflict-grid details { min-width:0; border:1px solid var(--dca-border); border-radius:8px; padding:.45rem; }
.dca-sticky-actions { position:sticky; bottom:0; display:flex; align-items:center; justify-content:space-between; gap:.7rem; border:1px solid var(--dca-border); border-radius:10px; padding:.65rem; background:#1e1a29; }
.dca-context-meter { position:relative; height:1rem; overflow:hidden; border:1px solid var(--dca-border); border-radius:999px; background:#111018; }
.dca-context-meter span { display:block; height:100%; background:linear-gradient(90deg,#6f4bd8,#d19273); }
.dca-context-meter i { position:absolute; top:0; bottom:0; width:2px; background:white; }
.dca-metric-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(8rem,1fr)); gap:.55rem; }
.dca-metric-grid div { display:flex; flex-direction:column; border:1px solid var(--dca-border); border-radius:10px; padding:.7rem; background:var(--dca-panel); }
.dca-metric-grid strong { font-size:1.2rem; }
.dca-metric-grid span { color:var(--dca-muted); }
.dca-skill-card.builtin { border-color:#705aa0; }
.dca-skill-card p { margin:.4rem 0; }
.dca-preset-node header { display:grid; grid-template-columns:auto minmax(8rem,1fr) 7rem 5rem auto; }
.dca-preset-node header input[type=checkbox] { width:auto; }
.dca-preset-node textarea { margin-top:.55rem; font-family:ui-monospace,monospace; }
.dca-form-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:.2rem .7rem; }
.dca-form-grid .wide { grid-column:1/-1; }
.dca-security-note { border-left:3px solid #c39b4d; padding-left:.7rem; color:var(--dca-muted); }
.dca-toggle-row { display:flex; align-items:center; justify-content:space-between; gap:1rem; border:1px solid var(--dca-border); border-radius:10px; padding:.7rem; background:var(--dca-panel); }
.dca-toggle-row span { display:flex; flex-direction:column; }
.dca-toggle-row small { color:var(--dca-muted); }
.dca-toggle-row input { width:auto; }
.dca-modal-backdrop { position:fixed; inset:0; z-index:10000; display:grid; place-items:center; padding:1rem; background:#08070cbb; }
.dca-modal { width:min(30rem,100%); border:1px solid var(--dca-border); border-radius:14px; padding:1rem; box-shadow:0 20px 60px #0009; background:#211d2c; }
.dca-modal h3 { margin:.3rem 0; }
.dca-modal .dca-row-actions { justify-content:flex-end; margin-top:1rem; }
.dca-onboarding>span { color:var(--dca-accent); }
@media (max-width:720px) {
  .dca-tabs button span { display:none; }
  .dca-tabs { justify-content:space-around; }
  .dca-message { max-width:96%; }
  .dca-split-panel { grid-template-columns:1fr; grid-template-rows:minmax(8rem,35%) minmax(0,65%); }
  .dca-file-list { border-right:0; border-bottom:1px solid var(--dca-border); }
  .dca-conflict-grid,.dca-form-grid { grid-template-columns:1fr; }
  .dca-preset-node header { grid-template-columns:auto 1fr 6rem; }
  .dca-preset-node header input[type=number],.dca-preset-node header button { grid-row:2; }
  .dca-guidance-box { grid-template-columns:1fr; }
}
.dca-floating-window { position:fixed; z-index:6000; display:flex; flex-direction:column; min-width:420px; min-height:380px; overflow:hidden; border:1px solid #4c4560; border-radius:14px; box-shadow:0 22px 70px #000b; background:#17151f; }
.dca-floating-titlebar { display:flex; flex:0 0 auto; align-items:center; justify-content:space-between; height:2.7rem; border-bottom:1px solid #3e3850; padding:0 .45rem 0 .8rem; background:#231f2e; color:#f5f1ff; cursor:move; user-select:none; }
.dca-floating-titlebar button { display:grid; width:2rem; height:2rem; place-items:center; border:0; border-radius:8px; background:transparent; color:#f5f1ff; cursor:pointer; }
.dca-floating-body { flex:1 1 auto; min-height:0; overflow:hidden; }
.dca-floating-resize { position:absolute; right:0; bottom:0; width:18px; height:18px; cursor:nwse-resize; }
.dca-floating-resize::after { position:absolute; right:3px; bottom:3px; width:8px; height:8px; border-right:2px solid #9d7cff; border-bottom:2px solid #9d7cff; content:''; }
.dca-floating-window-mobile { min-width:0; min-height:0; border-radius:0; }
.dca-floating-window-mobile .dca-floating-titlebar { cursor:default; }
.dca-floating-window-mobile .dca-floating-resize { display:none; }
.dca-floating-trigger { position:fixed; right:1.15rem; bottom:calc(1.15rem + var(--tt-inset-bottom,0px)); z-index:5900; display:grid; width:3.15rem; height:3.15rem; place-items:center; border:1px solid #8067c6; border-radius:50%; box-shadow:0 10px 28px #0008; background:linear-gradient(145deg,#9d7cff,#6845c7); color:white; font-size:1.2rem; cursor:pointer; }
.dca-floating-trigger:hover { transform:translateY(-2px); filter:brightness(1.08); }
</style>
