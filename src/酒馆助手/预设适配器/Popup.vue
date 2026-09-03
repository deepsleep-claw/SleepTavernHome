<template>
  <div ref="root" class="preset-adapter-root" :class="`preset-adapter-root-${store.active_tab}`">
    <aside class="preset-adapter-sidebar">
      <div class="preset-adapter-brand">
        <span class="preset-adapter-brand-mark" aria-hidden="true">
          <svg class="preset-adapter-brand-whale" viewBox="0 0 112 96" focusable="false">
            <path
              class="preset-adapter-brand-star"
              d="m76 5 2.9 6 6.6 1-4.8 4.6 1.1 6.6-5.8-3.1-5.9 3.1 1.2-6.6-4.8-4.6 6.6-1z"
            />
            <path
              class="preset-adapter-brand-spout"
              d="M70 33c.5-6.6-2-10.2-6.1-13.5M72 32c2.3-5.4 6.1-8 10.5-9.7"
            />
            <path
              class="preset-adapter-brand-tail"
              d="M31.5 50.4C21.7 47 14.2 39.1 14.7 29.5c9.7.3 17.1 4.7 21.1 12.1.1-8.4 4.7-15.2 12.5-19.5 2.3 10.5-1.9 21.3-12.2 29.1z"
            />
            <path
              class="preset-adapter-brand-whale-body"
              d="M29.6 48.4c5.7-15.2 24.5-22.5 43-16.9 15.7 4.7 23.6 15.8 19.4 27.3-5 13.9-26.4 19.5-45.2 12.1-9.3-3.7-15.3-11.2-17.2-22.5z"
            />
            <path
              class="preset-adapter-brand-belly"
              d="M39.4 61.3c11.9 7.8 33.8 6.7 49.6-2.8-3.9 12.1-23.6 18.2-41.3 12.3-3.4-1.1-6.2-3.8-8.3-9.5z"
            />
            <path
              class="preset-adapter-brand-fin"
              d="M56 68.9c-2.6 10-10.5 14.2-17.3 8.4 6.9-2.4 11.7-6.2 14.1-11.2z"
            />
            <circle class="preset-adapter-brand-eye" cx="76.8" cy="44.8" r="2.5" />
            <path class="preset-adapter-brand-smile" d="M77.8 56.3c3.4 2.8 7.3 2.5 10.4-.6" />
          </svg>
        </span>
        <strong>梦鲸思客</strong>
      </div>

      <nav class="preset-adapter-tabs" aria-label="梦鲸思客设置页签">
        <button
          type="button"
          class="preset-adapter-tab"
          :class="{ 'preset-adapter-tab-active': store.active_tab === 'preset' }"
          :aria-current="store.active_tab === 'preset' ? 'page' : undefined"
          @click="store.setActiveTab('preset')"
          @keydown.enter.prevent="store.setActiveTab('preset')"
          @keydown.space.prevent="store.setActiveTab('preset')"
        >
          <i class="fa-solid fa-sliders" aria-hidden="true"></i>
          <span>预设调校</span>
        </button>
        <button
          type="button"
          class="preset-adapter-tab"
          :class="{ 'preset-adapter-tab-active': store.active_tab === 'summary' }"
          :aria-current="store.active_tab === 'summary' ? 'page' : undefined"
          @click="store.setActiveTab('summary')"
          @keydown.enter.prevent="store.setActiveTab('summary')"
          @keydown.space.prevent="store.setActiveTab('summary')"
        >
          <i class="fa-regular fa-rectangle-list" aria-hidden="true"></i>
          <span>总结</span>
          <em v-if="store.summary_state.summary_count > 0">{{ store.summary_state.summary_count }}</em>
        </button>
        <button
          type="button"
          class="preset-adapter-tab"
          :class="{ 'preset-adapter-tab-active': store.active_tab === 'debug' }"
          :aria-current="store.active_tab === 'debug' ? 'page' : undefined"
          :disabled="!store.debug_available"
          @click="store.setActiveTab('debug')"
          @keydown.enter.prevent="store.setActiveTab('debug')"
          @keydown.space.prevent="store.setActiveTab('debug')"
        >
          <i class="fa-solid fa-bug" aria-hidden="true"></i>
          <span>Debug</span>
          <em v-if="store.debug_records.length > 0">{{ store.debug_records.length }}</em>
        </button>
      </nav>
    </aside>

    <main ref="workspace" class="preset-adapter-workspace">
      <header class="preset-adapter-header">
        <div class="preset-adapter-heading">
          <h3>{{ page_title }}</h3>
          <p>{{ page_subtitle }}</p>
        </div>
        <div class="preset-adapter-header-actions">
          <span class="preset-adapter-preset">{{ store.loaded_preset_name }}</span>
          <button type="button" class="preset-adapter-icon-button" title="刷新" @click="store.refresh()">
            <i class="fa-solid fa-rotate" aria-hidden="true"></i>
          </button>
          <details v-if="store.active_tab === 'preset'" class="preset-adapter-more-menu">
            <summary title="更多操作"><i class="fa-solid fa-ellipsis-vertical" aria-hidden="true"></i></summary>
            <div>
              <button type="button" :disabled="store.favorite_options.length === 0" @click="confirmClearFavorites()">
                清空收藏
              </button>
            </div>
          </details>
        </div>
      </header>

      <input
        ref="import_file_input"
        type="file"
        accept="application/json,.json"
        hidden
        @change="importPresetSettings"
      />

      <section v-if="store.active_tab === 'preset'" class="preset-adapter-preset-page">
        <div class="preset-adapter-preset-toolbar">
          <p>
            {{ store.groups.length }} 组 · {{ option_count }} 个选项<span v-if="variable_input_count > 0">
              · {{ variable_input_count }} 个变量输入</span
            >
          </p>
          <div class="preset-adapter-actions">
            <template v-if="store.export_mode">
              <span class="preset-adapter-selection-count">已选 {{ store.selected_export_count }} 项</span>
              <button
                type="button"
                class="preset-adapter-button-primary"
                :disabled="store.is_applying"
                @click="store.exportSelectedOptions()"
              >
                确认导出
              </button>
              <button type="button" :disabled="store.is_applying" @click="store.cancelExportMode()">取消</button>
            </template>
            <template v-else-if="store.organizing">
              <span class="preset-adapter-organizing-label"
                ><i class="fa-solid fa-grip" aria-hidden="true"></i> 整理中</span
              >
              <button type="button" @click="store.restoreGroupOrder()">恢复默认顺序</button>
              <button type="button" class="preset-adapter-button-primary" @click="store.setOrganizing(false)">
                完成
              </button>
            </template>
            <template v-else>
              <button type="button" @click="store.setOrganizing(true)">
                <i class="fa-solid fa-arrow-down-up-across-line" aria-hidden="true"></i> 整理布局
              </button>
              <button type="button" @click="store.setAllGroupsCollapsed(!store.all_groups_collapsed)">
                <i
                  class="fa-solid"
                  :class="store.all_groups_collapsed ? 'fa-angles-down' : 'fa-angles-up'"
                  aria-hidden="true"
                ></i>
                {{ store.all_groups_collapsed ? '全部展开' : '全部折叠' }}
              </button>
              <button
                type="button"
                :disabled="store.is_applying || store.has_blocking_errors"
                @click="openImportFilePicker()"
              >
                <i class="fa-solid fa-arrow-down" aria-hidden="true"></i> 导入
              </button>
              <button
                type="button"
                :disabled="store.is_applying || store.has_blocking_errors"
                @click="store.startExportMode()"
              >
                <i class="fa-solid fa-arrow-up" aria-hidden="true"></i> 导出
              </button>
            </template>
          </div>
        </div>

        <section v-if="store.errors.length > 0" class="preset-adapter-errors">
          <strong>配置错误</strong>
          <ul>
            <li v-for="error in store.errors" :key="error">{{ error }}</li>
          </ul>
        </section>

        <section v-if="!store.export_mode" class="preset-adapter-favorites">
          <header>
            <button type="button" class="preset-adapter-section-heading" @click="store.toggleFavoritesCollapsed()">
              <span
                ><i class="fa-solid fa-star" aria-hidden="true"></i><strong>星标捷径</strong
                ><small>多选快捷入口</small></span
              >
              <i
                class="fa-solid"
                :class="store.ui_preferences.favorites_collapsed ? 'fa-chevron-down' : 'fa-chevron-up'"
                aria-hidden="true"
              ></i>
            </button>
            <button
              v-if="store.favorite_options.length > 0"
              type="button"
              class="preset-adapter-text-button"
              @click="confirmClearFavorites()"
            >
              清空收藏
            </button>
          </header>
          <div v-if="!store.ui_preferences.favorites_collapsed" class="preset-adapter-favorite-grid">
            <div v-if="store.favorite_options.length === 0" class="preset-adapter-favorite-empty">
              <i class="fa-regular fa-star" aria-hidden="true"></i>
              <span>给多选项点亮星标，即可放到这里</span>
            </div>
            <article
              v-for="favorite in store.favorite_options"
              v-else
              :key="favorite.key"
              class="preset-adapter-favorite-card"
              :class="{
                'preset-adapter-option-active': favorite.option.status === 'active',
                'preset-adapter-reordering': reorder_key === favorite.key,
              }"
              data-reorder-kind="favorite"
              :data-reorder-key="favorite.key"
            >
              <button
                v-if="store.organizing"
                type="button"
                class="preset-adapter-drag-handle"
                title="拖动排序"
                @pointerdown="startReorder('favorite', favorite.key, $event)"
              >
                <i class="fa-solid fa-grip-vertical" aria-hidden="true"></i>
              </button>
              <button
                type="button"
                class="preset-adapter-favorite-action"
                :disabled="store.organizing || store.is_applying"
                @click="handleOptionClick(favorite.group_id, favorite.option.id)"
              >
                <i :class="favorite.option.status_icon_class" aria-hidden="true"></i>
                <span
                  ><strong>{{ favorite.option.label }}</strong
                  ><small>{{ favorite.group_label }}</small></span
                >
              </button>
              <button
                type="button"
                class="preset-adapter-star-button preset-adapter-star-button-active"
                title="取消收藏"
                aria-label="取消收藏"
                aria-pressed="true"
                @click="store.toggleFavoriteOption(favorite.group_id, favorite.option.id)"
                @keydown.enter.prevent="store.toggleFavoriteOption(favorite.group_id, favorite.option.id)"
                @keydown.space.prevent="store.toggleFavoriteOption(favorite.group_id, favorite.option.id)"
              >
                <i class="fa-solid fa-star" aria-hidden="true"></i>
              </button>
            </article>
          </div>
        </section>

        <div v-if="store.groups.length === 0" class="preset-adapter-empty">未配置选项组</div>
        <div class="preset-adapter-group-list">
          <section
            v-for="group in store.groups"
            :key="group.id"
            class="preset-adapter-group"
            :class="{
              'preset-adapter-group-collapsed': !isGroupContentVisible(group.id),
              'preset-adapter-reordering': reorder_key === group.id,
            }"
            data-reorder-kind="group"
            :data-reorder-key="group.id"
          >
            <header class="preset-adapter-group-header">
              <button
                v-if="store.organizing"
                type="button"
                class="preset-adapter-drag-handle"
                title="拖动排序"
                @pointerdown="startReorder('group', group.id, $event)"
              >
                <i class="fa-solid fa-grip-vertical" aria-hidden="true"></i>
              </button>
              <button
                type="button"
                class="preset-adapter-group-toggle"
                :disabled="store.organizing || store.export_mode"
                @click="store.toggleGroupCollapsed(group.id)"
              >
                <span class="preset-adapter-group-title">
                  <strong>{{ group.label }}</strong>
                  <small v-if="group.description">{{ group.description }}</small>
                </span>
                <span class="preset-adapter-group-summary">{{ getGroupSummary(group) }}</span>
                <i
                  class="fa-solid"
                  :class="isGroupContentVisible(group.id) ? 'fa-chevron-up' : 'fa-chevron-down'"
                  aria-hidden="true"
                ></i>
              </button>
            </header>

            <div v-show="isGroupContentVisible(group.id)" class="preset-adapter-group-body">
              <div
                v-if="group.options.length > 0"
                class="preset-adapter-options"
                :class="`preset-adapter-options-${group.layout}`"
              >
                <article
                  v-for="option in group.options"
                  :key="option.id"
                  class="preset-adapter-option"
                  :class="[
                    `preset-adapter-option-${option.status}`,
                    {
                      'preset-adapter-option-export-mode': store.export_mode,
                      'preset-adapter-option-export-selected': store.isExportOptionSelected(group.id, option.id),
                      'preset-adapter-option-export-unavailable': store.export_mode && !option.exportable,
                      'preset-adapter-option-favorite': store.isFavoriteOption(group.id, option.preference_id),
                    },
                  ]"
                >
                  <button
                    type="button"
                    class="preset-adapter-option-action"
                    :disabled="
                      store.is_applying ||
                      store.has_blocking_errors ||
                      (!store.export_mode && option.status === 'unmatched')
                    "
                    :title="option.matched_summary"
                    @click="handleOptionClick(group.id, option.id)"
                  >
                    <span class="preset-adapter-option-main">
                      <i :class="option.status_icon_class" aria-hidden="true"></i>
                      <span class="preset-adapter-option-title"
                        ><span>{{ option.label }}</span
                        ><small v-if="option.description">{{ option.description }}</small></span
                      >
                    </span>
                  </button>
                  <button
                    v-if="group.mode === 'multiple' && !store.export_mode"
                    type="button"
                    class="preset-adapter-star-button"
                    :class="{
                      'preset-adapter-star-button-active': store.isFavoriteOption(group.id, option.preference_id),
                    }"
                    :title="store.isFavoriteOption(group.id, option.preference_id) ? '取消收藏' : '加入收藏'"
                    :aria-label="store.isFavoriteOption(group.id, option.preference_id) ? '取消收藏' : '加入收藏'"
                    :aria-pressed="store.isFavoriteOption(group.id, option.preference_id)"
                    @click="store.toggleFavoriteOption(group.id, option.id)"
                    @keydown.enter.prevent="store.toggleFavoriteOption(group.id, option.id)"
                    @keydown.space.prevent="store.toggleFavoriteOption(group.id, option.id)"
                  >
                    <i
                      :class="
                        store.isFavoriteOption(group.id, option.preference_id)
                          ? 'fa-solid fa-star'
                          : 'fa-regular fa-star'
                      "
                      aria-hidden="true"
                    ></i>
                  </button>
                </article>
              </div>

              <div v-if="group.reasoner_format_checks.length > 0" class="preset-adapter-reasoner-format-checks">
                <div
                  v-for="check in group.reasoner_format_checks"
                  :key="check.id"
                  class="preset-adapter-reasoner-format-check"
                >
                  <div class="preset-adapter-reasoner-format-check-main">
                    <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i
                    ><span class="preset-adapter-reasoner-format-check-text"
                      ><strong>{{ check.label }}</strong
                      ><span>{{ check.message }}</span
                      ><small v-if="check.description">{{ check.description }}</small></span
                    >
                  </div>
                  <button
                    type="button"
                    class="preset-adapter-reasoner-format-check-action"
                    :disabled="store.is_applying || check.disabled"
                    @click="store.applyReasonerFormatCheck(group.id, check.id)"
                  >
                    确认设置
                  </button>
                </div>
              </div>

              <div v-if="group.variable_inputs.length > 0" class="preset-adapter-variable-inputs">
                <label v-for="input in group.variable_inputs" :key="input.id" class="preset-adapter-variable-input">
                  <span class="preset-adapter-variable-input-label"
                    ><strong>{{ input.label }}</strong
                    ><small v-if="input.description">{{ input.description }}</small></span
                  >
                  <input
                    class="preset-adapter-variable-input-control"
                    type="text"
                    :value="input.value"
                    :disabled="input.disabled"
                    :placeholder="input.disabled ? '请先打开一个聊天' : ''"
                    :title="input.variable_id"
                    autocomplete="off"
                    @input="handleVariableInput(group.id, input.id, $event)"
                  />
                </label>
              </div>
            </div>
          </section>
        </div>
      </section>

      <section v-else-if="store.active_tab === 'summary'" class="preset-adapter-summary">
        <div v-if="!store.summary_state.has_chat" class="preset-adapter-empty">
          需要打开一个聊天后才能使用总结功能。
        </div>

        <template v-else>
          <div class="preset-adapter-summary-metrics">
            <article>
              <i class="fa-regular fa-file-lines" aria-hidden="true"></i
              ><span
                ><small>已总结</small><strong>{{ store.summary_state.summary_count }}<em>次</em></strong></span
              >
            </article>
            <article>
              <i class="fa-regular fa-message" aria-hidden="true"></i
              ><span
                ><small>发送楼层</small
                ><strong
                  >{{ store.summary_state.unhidden_message_count
                  }}<em>/ {{ store.summary_state.total_message_count }}</em></strong
                ></span
              >
            </article>
            <article>
              <i class="fa-solid fa-coins" aria-hidden="true"></i
              ><span
                ><small>预计 Token</small><strong>{{ summary_total_tokens }}</strong></span
              >
            </article>
          </div>

          <div class="preset-adapter-summary-dashboard">
            <section class="preset-adapter-summary-section preset-adapter-summary-workspace-card">
              <header class="preset-adapter-summary-inline-header preset-adapter-summary-workspace-header">
                <div class="preset-adapter-summary-workspace-heading">
                  <h4>楼层工作区</h4>
                  <p class="preset-adapter-description">集中管理楼层可见性与总结内容</p>
                </div>
                <div class="preset-adapter-summary-workspace-actions">
                  <div class="preset-adapter-summary-inline-actions">
                    <button
                      type="button"
                      class="menu_button"
                      :disabled="store.is_applying"
                      @click="addSummaryMessage()"
                    >
                      <i class="fa-solid fa-plus" aria-hidden="true"></i>
                      <span>添加</span>
                    </button>
                    <button
                      type="button"
                      class="menu_button"
                      :disabled="store.is_applying"
                      @click="store.scanCurrentSummaryMessages()"
                    >
                      <i class="fa-solid fa-expand" aria-hidden="true"></i>
                      <span>扫描</span>
                    </button>
                  </div>
                  <label class="preset-adapter-summary-filter-control">
                    <input
                      type="checkbox"
                      :checked="store.summary_settings.filter_html_code_blocks"
                      @change="setSummaryFilterHtmlCodeBlocks"
                    />
                    <span>自动过滤 <code>HTML</code> 代码块</span>
                  </label>
                </div>
              </header>

              <div
                class="preset-adapter-summary-workspace-body"
                :class="`preset-adapter-summary-workspace-view-${mobile_summary_workspace_view}`"
              >
                <div class="preset-adapter-summary-floor-filters" role="tablist" aria-label="楼层工作区视图">
                  <button
                    type="button"
                    role="tab"
                    aria-controls="preset-adapter-summary-floor-list"
                    :aria-selected="isSummaryWorkspaceTabSelected('all')"
                    :class="{
                      'preset-adapter-summary-floor-filter-active': isSummaryWorkspaceTabSelected('all'),
                    }"
                    @click="showSummaryFloorList('all')"
                    @keydown.enter.prevent="showSummaryFloorList('all')"
                    @keydown.space.prevent="showSummaryFloorList('all')"
                  >
                    <i class="fa-solid fa-layer-group" aria-hidden="true"></i>
                    全部楼层
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-controls="preset-adapter-summary-floor-list"
                    :aria-selected="isSummaryWorkspaceTabSelected('summary')"
                    :class="{
                      'preset-adapter-summary-floor-filter-active': isSummaryWorkspaceTabSelected('summary'),
                    }"
                    @click="showSummaryFloorList('summary')"
                    @keydown.enter.prevent="showSummaryFloorList('summary')"
                    @keydown.space.prevent="showSummaryFloorList('summary')"
                  >
                    <i class="fa-regular fa-bookmark" aria-hidden="true"></i>
                    总结书签 <span>{{ store.summary_state.summary_count }}</span>
                  </button>
                  <button
                    v-if="is_compact_summary_workspace && mobile_summary_workspace_view === 'preview'"
                    type="button"
                    class="preset-adapter-summary-floor-preview-tab preset-adapter-summary-floor-filter-active"
                    role="tab"
                    aria-controls="preset-adapter-summary-floor-preview"
                    aria-selected="true"
                  >
                    <i class="fa-regular fa-eye" aria-hidden="true"></i>
                    楼层预览
                  </button>
                </div>

                <section
                  id="preset-adapter-summary-floor-list"
                  class="preset-adapter-summary-floor-pane"
                  aria-label="楼层管理"
                >
                  <div v-if="summary_floor_rows.length === 0" class="preset-adapter-empty">
                    {{ summary_floor_filter === 'summary' ? '暂无总结楼层' : '暂无楼层信息' }}
                  </div>
                  <div v-else class="preset-adapter-summary-floor-table-scroll">
                    <table class="preset-adapter-summary-table preset-adapter-summary-floor-table">
                      <thead>
                        <tr>
                          <th>楼层范围</th>
                          <th>类型/状态</th>
                          <th>Token数</th>
                          <th>操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr
                          v-for="row in summary_floor_rows"
                          :key="row.key"
                          :aria-current="selected_summary_floor_row?.key === row.key ? 'true' : undefined"
                          tabindex="0"
                          :class="{
                            'preset-adapter-summary-floor-row-summary': row.summary_message_id !== undefined,
                            'preset-adapter-summary-floor-row-selected': selected_summary_floor_row?.key === row.key,
                            'preset-adapter-summary-floor-row-missing': row.summary_exists === false,
                          }"
                          @click="selectSummaryFloorRow(row)"
                          @keydown.enter.prevent="selectSummaryFloorRow(row)"
                          @keydown.space.prevent="selectSummaryFloorRow(row)"
                        >
                          <td>
                            <span
                              class="preset-adapter-summary-floor-label"
                              :class="{
                                'preset-adapter-summary-floor-label-bookmarked': row.summary_message_id !== undefined,
                              }"
                            >
                              <i
                                v-if="row.summary_message_id !== undefined"
                                class="fa-solid fa-bookmark"
                                aria-hidden="true"
                              ></i>
                              <span>{{ row.range }}</span>
                            </span>
                          </td>
                          <td>{{ row.status }}</td>
                          <td>{{ row.token_count }}</td>
                          <td>
                            <div class="preset-adapter-summary-floor-actions">
                              <button
                                v-if="row.operation_label"
                                type="button"
                                class="menu_button"
                                :disabled="store.is_applying"
                                @click.stop="store.setSummaryFloorRowHidden(row)"
                              >
                                {{ row.operation_label }}
                              </button>
                              <button
                                v-if="row.summary_message_id !== undefined"
                                type="button"
                                class="preset-adapter-summary-floor-bookmark"
                                :disabled="store.is_applying"
                                title="取消总结书签"
                                aria-label="取消总结书签"
                                @click.stop="store.deleteSummaryMessageId(row.summary_message_id)"
                              >
                                <i class="fa-solid fa-bookmark" aria-hidden="true"></i>
                              </button>
                            </div>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  <footer v-if="summary_total_row" class="preset-adapter-summary-floor-total">
                    <strong>总计</strong>
                    <span>{{ summary_total_row.status }}</span>
                    <b>{{ summary_total_row.token_count }} Token</b>
                  </footer>
                </section>

                <section
                  id="preset-adapter-summary-floor-preview"
                  ref="summary_detail_pane"
                  class="preset-adapter-summary-detail-pane"
                  aria-label="楼层预览"
                  tabindex="-1"
                >
                  <div v-if="!selected_summary_floor_row" class="preset-adapter-empty">暂无可查看楼层</div>
                  <article v-else class="preset-adapter-summary-viewer">
                    <header>
                      <div>
                        <strong>{{ selected_summary_floor_title }}</strong>
                        <small v-if="selected_summary_floor_row.summary_exists === false">失效</small>
                        <small v-else-if="selected_single_floor_message">
                          {{ selected_single_floor_message.is_hidden ? '隐藏' : '显示' }}
                        </small>
                        <small v-else>
                          显示 {{ selected_floor_visible_count }} · 隐藏 {{ selected_floor_hidden_count }}
                        </small>
                      </div>
                      <div class="preset-adapter-summary-detail-actions">
                        <button
                          v-if="selected_summary_floor_row?.operation_label"
                          type="button"
                          class="menu_button"
                          :disabled="store.is_applying"
                          @click="toggleSelectedSummaryVisibility()"
                        >
                          {{ selected_summary_floor_row.operation_label }}
                        </button>
                        <button
                          v-if="selected_single_floor_message"
                          type="button"
                          class="preset-adapter-summary-detail-bookmark"
                          :class="{
                            'preset-adapter-summary-detail-bookmark-active': selected_summary_floor_is_bookmarked,
                          }"
                          :disabled="store.is_applying"
                          :title="selected_summary_floor_is_bookmarked ? '取消总结书签' : '添加总结书签'"
                          :aria-label="selected_summary_floor_is_bookmarked ? '取消总结书签' : '添加总结书签'"
                          @click="toggleSelectedFloorBookmark()"
                        >
                          <i
                            :class="
                              selected_summary_floor_is_bookmarked ? 'fa-solid fa-bookmark' : 'fa-regular fa-bookmark'
                            "
                            aria-hidden="true"
                          ></i>
                        </button>
                        <span class="preset-adapter-summary-detail-divider" aria-hidden="true"></span>
                        <button
                          type="button"
                          :disabled="selected_summary_floor_row_index <= 0"
                          title="上一个楼层组"
                          aria-label="上一个楼层组"
                          @click="selectAdjacentSummaryFloorRow(-1)"
                        >
                          <i class="fa-solid fa-chevron-left" aria-hidden="true"></i>
                        </button>
                        <button
                          type="button"
                          :disabled="selected_summary_floor_row_index >= summary_floor_rows.length - 1"
                          title="下一个楼层组"
                          aria-label="下一个楼层组"
                          @click="selectAdjacentSummaryFloorRow(1)"
                        >
                          <i class="fa-solid fa-chevron-right" aria-hidden="true"></i>
                        </button>
                      </div>
                    </header>
                    <div v-if="selected_summary_floor_row.summary_exists === false" class="preset-adapter-empty">
                      该书签对应的楼层已不存在。
                    </div>
                    <div v-else-if="selected_single_floor_message" class="preset-adapter-summary-content">
                      <div v-if="!selected_floor_has_native_content" class="preset-adapter-empty">
                        过滤后无可显示内容。
                      </div>
                      <div
                        ref="selected_floor_native_host"
                        class="preset-adapter-summary-rendered"
                        :class="{ 'preset-adapter-summary-rendered-empty': !selected_floor_has_native_content }"
                      ></div>
                    </div>
                    <div v-else class="preset-adapter-summary-range-content">
                      <div class="preset-adapter-summary-range-toolbar">
                        <p>逐层调整该区间的发送可见性</p>
                        <div>
                          <button
                            type="button"
                            class="menu_button"
                            :disabled="
                              store.is_applying || selected_floor_visible_count === selected_floor_messages.length
                            "
                            @click="setSelectedFloorMessagesHidden(false)"
                          >
                            全部显示
                          </button>
                          <button
                            type="button"
                            class="menu_button"
                            :disabled="
                              store.is_applying || selected_floor_hidden_count === selected_floor_messages.length
                            "
                            @click="setSelectedFloorMessagesHidden(true)"
                          >
                            全部隐藏
                          </button>
                        </div>
                      </div>
                      <div class="preset-adapter-summary-range-list">
                        <article
                          v-for="message in selected_floor_messages"
                          :key="message.message_id"
                          class="preset-adapter-summary-range-row"
                        >
                          <div class="preset-adapter-summary-range-floor">
                            <strong>第 {{ message.message_id }} 层</strong>
                            <small>{{ getSummaryMessageRoleLabel(message.role) }}</small>
                          </div>
                          <span class="preset-adapter-summary-range-token">{{ message.token_count ?? '-' }} Token</span>
                          <span
                            class="preset-adapter-summary-range-state"
                            :class="{
                              'preset-adapter-summary-range-state-hidden': message.is_hidden,
                            }"
                          >
                            {{ message.is_hidden ? '隐藏' : '显示' }}
                          </span>
                          <button
                            type="button"
                            class="menu_button"
                            :disabled="store.is_applying"
                            @click="store.setSummaryFloorMessagesHidden([message.message_id], !message.is_hidden)"
                          >
                            {{ message.is_hidden ? '设为显示' : '设为隐藏' }}
                          </button>
                        </article>
                      </div>
                    </div>
                  </article>
                </section>
              </div>
            </section>

            <section class="preset-adapter-summary-section preset-adapter-summary-settings">
              <header class="preset-adapter-summary-section-heading">
                <h4>总结策略</h4>
                <p class="preset-adapter-description">配置生成方式与总结完成后的楼层处理</p>
              </header>

              <div class="preset-adapter-summary-settings-grid">
                <div class="preset-adapter-summary-setting-block">
                  <h4>总结使用设置</h4>
                  <dl class="preset-adapter-summary-definition">
                    <dt>设置组</dt>
                    <dd>{{ store.summary_generation_status.group_label || '未配置' }}</dd>
                    <dt>选项</dt>
                    <dd>{{ store.summary_generation_status.option_label || '未配置' }}</dd>
                    <dt>当前状态</dt>
                    <dd>{{ store.summary_generation_status.status_label }}</dd>
                    <dt>命中提示词</dt>
                    <dd>{{ store.summary_generation_status.matched_summary || '无' }}</dd>
                  </dl>
                  <ul
                    v-if="store.summary_generation_status.errors.length > 0"
                    class="preset-adapter-summary-error-list"
                  >
                    <li v-for="error in store.summary_generation_status.errors" :key="error">{{ error }}</li>
                  </ul>
                  <label class="preset-adapter-summary-standalone-option preset-adapter-summary-manual-option">
                    <input
                      type="checkbox"
                      :checked="store.summary_settings.manual_prompt_enabled"
                      @change="setSummaryManualPromptEnabled"
                    />
                    <span>
                      <strong>手动输入总结需求</strong>
                      <small>开始总结时弹出输入框；未开启时发送“开始总结”。</small>
                    </span>
                  </label>
                </div>

                <div class="preset-adapter-summary-mode-block">
                  <h4>内容处理</h4>
                  <div class="preset-adapter-summary-setting-grid">
                    <label>
                      <span>总结内容处理</span>
                      <select :value="store.summary_settings.content_handling" @change="setSummaryContentHandling">
                        <option value="direct">直接总结（推荐）</option>
                        <option value="worldbook">放置于世界书</option>
                        <option value="first_message">放置于首层</option>
                      </select>
                    </label>
                  </div>
                  <p class="preset-adapter-summary-mode-description">{{ summary_content_handling_description }}</p>
                </div>

                <section class="preset-adapter-summary-subsettings">
                  <header class="preset-adapter-summary-subsettings-header">
                    <h4>总结后隐藏楼层设置</h4>
                    <button
                      type="button"
                      class="preset-adapter-text-button"
                      :disabled="store.is_applying"
                      @click="store.resetSummaryHideRules()"
                    >
                      <i class="fa-solid fa-arrow-rotate-left" aria-hidden="true"></i>
                      重置设置
                    </button>
                  </header>
                  <div class="preset-adapter-summary-subsettings-body">
                    <p class="preset-adapter-description">
                      若总结内容处理为放置于世界书或放置于首层，推荐开启隐藏总结楼层。
                    </p>
                    <div class="preset-adapter-summary-hide-layout">
                      <div class="preset-adapter-summary-hide-controls">
                        <label class="preset-adapter-summary-scope-option">
                          <input
                            type="checkbox"
                            :checked="store.summary_settings.hide_rules.only_before_latest_summary"
                            @change="setSummaryHideRule('only_before_latest_summary', $event)"
                          />
                          <span>
                            <strong>仅处理最新总结楼层及其之前</strong>
                            <small>最新总结之后的新剧情不会被这些规则影响。</small>
                          </span>
                        </label>

                        <div class="preset-adapter-summary-checkbox-grid">
                          <label>
                            <input
                              type="checkbox"
                              :checked="store.summary_settings.hide_rules.hide_first"
                              @change="setSummaryHideRule('hide_first', $event)"
                            />
                            <span>隐藏首层</span>
                          </label>
                          <label>
                            <input
                              type="checkbox"
                              :checked="store.summary_settings.hide_rules.hide_user"
                              @change="setSummaryHideRule('hide_user', $event)"
                            />
                            <span>隐藏用户输入楼层</span>
                          </label>
                          <label>
                            <input
                              type="checkbox"
                              :checked="store.summary_settings.hide_rules.hide_assistant_system"
                              @change="setSummaryHideRule('hide_assistant_system', $event)"
                            />
                            <span>隐藏系统/助手楼层</span>
                          </label>
                          <label>
                            <input
                              type="checkbox"
                              :checked="store.summary_settings.hide_rules.hide_summary"
                              @change="setSummaryHideRule('hide_summary', $event)"
                            />
                            <span>隐藏总结楼层</span>
                          </label>
                          <div class="preset-adapter-summary-keep-latest-option">
                            <label>
                              <input
                                type="checkbox"
                                :checked="store.summary_settings.hide_rules.keep_latest_enabled"
                                @change="setSummaryHideRule('keep_latest_enabled', $event)"
                              />
                              <span>不隐藏最新</span>
                            </label>
                            <input
                              type="number"
                              min="0"
                              step="1"
                              inputmode="numeric"
                              aria-label="不隐藏最新楼层数量"
                              :disabled="!store.summary_settings.hide_rules.keep_latest_enabled"
                              :value="store.summary_settings.hide_rules.keep_latest_count"
                              @change="setSummaryKeepLatestCount"
                            />
                            <span>层</span>
                          </div>
                          <label>
                            <input
                              type="checkbox"
                              :checked="store.summary_settings.hide_rules.auto_hide_after_manual"
                              @change="setSummaryHideRule('auto_hide_after_manual', $event)"
                            />
                            <span>手动总结后自动隐藏楼层</span>
                          </label>
                        </div>
                      </div>

                      <aside class="preset-adapter-summary-hide-preview" aria-label="隐藏楼层预览">
                        <table>
                          <tbody>
                            <tr>
                              <th scope="row">已隐藏</th>
                              <td>{{ store.summary_hide_preview.current_hidden_count }} 层</td>
                            </tr>
                            <tr>
                              <th scope="row">预计隐藏</th>
                              <td>
                                {{
                                  store.summary_hide_preview.projected_hidden_count === undefined
                                    ? '—'
                                    : `${store.summary_hide_preview.projected_hidden_count} 层`
                                }}
                              </td>
                            </tr>
                            <tr>
                              <th scope="row">最新总结层</th>
                              <td>
                                {{
                                  store.summary_hide_preview.latest_summary_floor === undefined
                                    ? '无'
                                    : `第 ${store.summary_hide_preview.latest_summary_floor} 层`
                                }}
                              </td>
                            </tr>
                            <tr>
                              <th scope="row">当前楼层</th>
                              <td>
                                {{
                                  store.summary_hide_preview.current_floor === undefined
                                    ? '无'
                                    : `第 ${store.summary_hide_preview.current_floor} 层`
                                }}
                              </td>
                            </tr>
                          </tbody>
                        </table>
                        <p v-if="store.summary_hide_preview.scope_missing" role="status">当前没有可隐藏楼层</p>
                      </aside>
                    </div>

                    <div class="preset-adapter-actions">
                      <button
                        type="button"
                        class="menu_button"
                        :disabled="store.is_applying"
                        @click="confirmApplySummaryHideOnly()"
                      >
                        一键隐藏
                      </button>
                      <button
                        type="button"
                        class="menu_button"
                        :disabled="store.is_applying"
                        @click="confirmSyncSummaryHideRules()"
                      >
                        一键隐藏（取消隐藏非设置楼层）
                      </button>
                      <button
                        type="button"
                        class="menu_button"
                        :disabled="store.is_applying"
                        @click="confirmUnhideSummaryAll()"
                      >
                        全部取消隐藏
                      </button>
                    </div>
                  </div>
                </section>
              </div>
              <footer class="preset-adapter-summary-strategy-footer">
                <button
                  type="button"
                  class="preset-adapter-summary-regenerate"
                  :disabled="
                    store.is_applying || store.is_summary_running || !store.summary_regeneration_status.can_start
                  "
                  :title="store.summary_regeneration_status.reason || '为最新总结层生成一个可切换的新版本'"
                  @click="store.regenerateSummary()"
                >
                  <i class="fa-solid fa-rotate-left" aria-hidden="true"></i>
                  {{ store.is_summary_running ? '生成中...' : '重新总结' }}
                </button>
                <button
                  type="button"
                  class="preset-adapter-summary-start"
                  :disabled="
                    store.is_applying || store.is_summary_running || !store.summary_generation_status.can_start
                  "
                  @click="confirmStartSummary()"
                >
                  <i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i>
                  {{ store.is_summary_running ? '总结中...' : '开始总结' }}
                </button>
              </footer>
            </section>
          </div>
        </template>
      </section>

      <section v-else-if="store.active_tab === 'debug'" class="preset-adapter-debug">
        <div class="preset-adapter-debug-mobile-switch" aria-label="Debug 手机端视图">
          <button
            type="button"
            :class="{ 'preset-adapter-debug-mobile-switch-active': mobile_debug_view === 'records' }"
            @click="mobile_debug_view = 'records'"
          >
            记录
          </button>
          <button
            type="button"
            :class="{ 'preset-adapter-debug-mobile-switch-active': mobile_debug_view === 'detail' }"
            :disabled="!selected_debug_record"
            @click="mobile_debug_view = 'detail'"
          >
            详情
          </button>
        </div>

        <div class="preset-adapter-debug-layout" :class="`preset-adapter-debug-mobile-${mobile_debug_view}`">
          <aside class="preset-adapter-debug-records">
            <header class="preset-adapter-debug-pane-header">
              <div>
                <h4>Debug 记录</h4>
                <p class="preset-adapter-description">保留最新 {{ store.debug_records.length }} / 50 条</p>
              </div>
              <button
                type="button"
                class="menu_button"
                :disabled="store.debug_loading || store.debug_records.length === 0"
                @click="store.clearDebugRecords()"
              >
                清空
              </button>
            </header>

            <div v-if="store.debug_loading" class="preset-adapter-empty">正在载入 Debug 信息…</div>
            <div v-else-if="store.debug_records.length === 0" class="preset-adapter-empty">暂无 Debug 信息</div>
            <div v-else class="preset-adapter-debug-record-list">
              <button
                v-for="record in store.debug_records"
                :key="record.id"
                type="button"
                class="preset-adapter-debug-record"
                :class="{ 'preset-adapter-debug-record-active': record.id === store.selected_debug_record_id }"
                @click="selectDebugRecord(record.id)"
                @keydown.enter.prevent="selectDebugRecord(record.id)"
                @keydown.space.prevent="selectDebugRecord(record.id)"
              >
                <strong>{{ record.title }}</strong>
                <small>{{ formatDebugTime(record.created_at) }}</small>
                <span class="preset-adapter-debug-record-summary">
                  总排序 {{ record.summary.total_rows }} · 触发 {{ record.summary.triggered_rows }} · 错误
                  {{ record.summary.error_count }}
                </span>
              </button>
            </div>
          </aside>

          <section class="preset-adapter-debug-detail">
            <template v-if="selected_debug_record">
              <header class="preset-adapter-debug-pane-header">
                <div>
                  <h4>{{ selected_debug_record.title }}</h4>
                  <p class="preset-adapter-description">{{ formatDebugTime(selected_debug_record.created_at) }}</p>
                </div>
                <button type="button" class="menu_button" @click="openDebugRawModal()">原始数据</button>
              </header>

              <div class="preset-adapter-debug-metrics">
                <span v-for="metric in getDebugMetrics(selected_debug_record)" :key="metric.label">
                  {{ metric.label }} {{ metric.value }}
                </span>
              </div>

              <section class="preset-adapter-debug-section">
                <h4>总排序</h4>
                <div v-if="debug_total_rows.length === 0" class="preset-adapter-empty">无总排序信息</div>
                <details v-for="entry in debug_total_rows" :key="entry.key" class="preset-adapter-debug-row">
                  <summary>{{ getDebugTotalSummary(entry.row) }}</summary>
                  <dl>
                    <template v-for="field in getDebugRowFields(entry.row)" :key="field.key">
                      <dt>{{ field.key }}</dt>
                      <dd>
                        <template v-if="field.key === '详细内容'">
                          <span>{{ field.preview }}</span>
                          <button
                            type="button"
                            class="menu_button"
                            @click="openDebugRowContentModal('总排序 - 详细内容', entry.row)"
                          >
                            详情
                          </button>
                        </template>
                        <template v-else>{{ field.text }}</template>
                      </dd>
                    </template>
                  </dl>
                </details>
              </section>

              <section class="preset-adapter-debug-section">
                <h4>触发蓝灯绿灯</h4>
                <div v-if="debug_triggered_rows.length === 0" class="preset-adapter-empty">无触发信息</div>
                <details v-for="entry in debug_triggered_rows" :key="entry.key" class="preset-adapter-debug-row">
                  <summary>{{ getDebugTriggeredSummary(entry.row) }}</summary>
                  <dl>
                    <template v-for="field in getDebugRowFields(entry.row)" :key="field.key">
                      <dt>{{ field.key }}</dt>
                      <dd>
                        <template v-if="field.key === '详细内容'">
                          <span>{{ field.preview }}</span>
                          <button
                            type="button"
                            class="menu_button"
                            @click="openDebugRowContentModal('触发蓝灯绿灯 - 详细内容', entry.row)"
                          >
                            详情
                          </button>
                        </template>
                        <template v-else>{{ field.text }}</template>
                      </dd>
                    </template>
                  </dl>
                </details>
              </section>

              <section class="preset-adapter-debug-section">
                <h4>错误信息</h4>
                <textarea
                  class="preset-adapter-debug-error-text"
                  readonly
                  :value="debug_error_text || '无错误信息'"
                ></textarea>
              </section>
            </template>
            <div v-else class="preset-adapter-empty">请选择一条 Debug 记录</div>
          </section>
        </div>
      </section>
    </main>

    <div v-if="debug_text_modal" class="preset-adapter-review-backdrop" @click.self="closeDebugTextModal()">
      <section class="preset-adapter-debug-text-panel" role="dialog" aria-modal="true">
        <header class="preset-adapter-review-header">
          <h3>{{ debug_text_modal.title }}</h3>
          <button
            type="button"
            class="menu_button preset-adapter-icon-button"
            title="关闭"
            @click="closeDebugTextModal()"
          >
            <i class="fa-solid fa-xmark" aria-hidden="true"></i>
          </button>
        </header>
        <textarea class="preset-adapter-debug-large-text" readonly :value="debug_text_modal.content"></textarea>
      </section>
    </div>

    <div v-if="store.review_panel" class="preset-adapter-review-backdrop" @click.self="store.closeReviewPanel()">
      <section class="preset-adapter-review-panel" role="dialog" aria-modal="true">
        <header class="preset-adapter-review-header">
          <div>
            <h3>{{ store.review_panel.title }}</h3>
            <p v-if="store.review_panel.kind === 'export'" class="preset-adapter-description">
              文件名：{{ store.review_panel.filename }}
            </p>
            <p v-else class="preset-adapter-description">
              匹配成功 {{ store.review_panel.items.length }} 项，匹配失败
              {{ store.review_panel.failed_items.length }} 项。导入后会自动保存当前预设，所有导入项默认关闭。
            </p>
          </div>
          <button
            type="button"
            class="menu_button preset-adapter-icon-button"
            title="关闭"
            :disabled="store.is_applying"
            @click="store.closeReviewPanel()"
          >
            <i class="fa-solid fa-xmark" aria-hidden="true"></i>
          </button>
        </header>

        <div class="preset-adapter-review-body">
          <section
            v-if="store.review_panel.kind === 'import' && store.review_panel.failed_items.length > 0"
            class="preset-adapter-review-section"
          >
            <h4>匹配失败</h4>
            <article
              v-for="item in store.review_panel.failed_items"
              :key="item.key"
              class="preset-adapter-review-item preset-adapter-review-item-failed"
            >
              <div class="preset-adapter-review-item-main">
                <span class="preset-adapter-review-badge preset-adapter-review-badge-failed">匹配失败</span>
                <span class="preset-adapter-review-badge preset-adapter-review-badge-append">{{
                  item.action_label
                }}</span>
                <strong>{{ item.name }}</strong>
              </div>
              <p>{{ item.group_id }} / {{ item.match_id }}</p>
              <p>{{ item.issue }}</p>
              <details>
                <summary>内容预览</summary>
                <pre>{{ item.preview }}</pre>
              </details>
            </article>
          </section>

          <section class="preset-adapter-review-section">
            <h4>{{ store.review_panel.kind === 'export' ? '将要导出' : '将要导入' }}</h4>
            <div v-if="store.review_panel.items.length === 0" class="preset-adapter-empty">没有匹配成功的设置</div>
            <article v-for="item in store.review_panel.items" :key="item.key" class="preset-adapter-review-item">
              <div class="preset-adapter-review-item-main">
                <span class="preset-adapter-review-badge" :class="`preset-adapter-review-badge-${item.action}`">
                  {{ item.action_label }}
                </span>
                <strong>{{ item.name }}</strong>
              </div>
              <p>{{ item.group_label }} · {{ item.group_id }} / {{ item.match_id }}</p>
              <details>
                <summary>内容预览</summary>
                <pre>{{ item.preview }}</pre>
              </details>
            </article>
          </section>
        </div>

        <footer class="preset-adapter-review-footer">
          <template v-if="store.review_panel.kind === 'export'">
            <button
              type="button"
              class="menu_button"
              :disabled="store.is_applying"
              @click="store.confirmExportReview()"
            >
              导出
            </button>
            <button type="button" class="menu_button" :disabled="store.is_applying" @click="store.closeReviewPanel()">
              取消
            </button>
          </template>
          <template v-else-if="store.review_panel.failed_items.length > 0">
            <button type="button" class="menu_button" :disabled="store.is_applying" @click="confirmImport(true)">
              导入全部
            </button>
            <button type="button" class="menu_button" :disabled="store.is_applying" @click="confirmImport(false)">
              仅导入匹配成功
            </button>
            <button type="button" class="menu_button" :disabled="store.is_applying" @click="store.closeReviewPanel()">
              取消
            </button>
          </template>
          <template v-else>
            <button type="button" class="menu_button" :disabled="store.is_applying" @click="confirmImport(true)">
              导入
            </button>
            <button type="button" class="menu_button" :disabled="store.is_applying" @click="store.closeReviewPanel()">
              取消
            </button>
          </template>
        </footer>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  type GroupView,
  type SummaryContentHandling,
  type SummaryFloorRow,
  type SummaryHideRules,
  type SummaryMessageView,
  usePresetAdapterStore,
} from './store';

const store = usePresetAdapterStore();
const option_count = computed(() => store.groups.reduce((total, group) => total + group.options.length, 0));
const variable_input_count = computed(() =>
  store.groups.reduce((total, group) => total + group.variable_inputs.length, 0),
);
const page_title = computed(() =>
  store.active_tab === 'preset' ? '预设调校' : store.active_tab === 'summary' ? '总结工作台' : '运行诊断',
);
const page_subtitle = computed(() =>
  store.active_tab === 'preset'
    ? '为每次对话选择恰到好处的思考方式'
    : store.active_tab === 'summary'
      ? '整理对话脉络，精确控制发送楼层'
      : '追踪压缩排序、触发与错误',
);
const summary_content_handling_description = computed(
  () =>
    ({
      direct: '推荐选项，总结楼层会作为消息楼层，并且对AI隐藏总结楼层前的其他普通楼层。',
      first_message: '总结楼层消息会同时自动添加到首层消息的最后，若使用该选项，建议勾选【隐藏总结楼层】',
      worldbook: '总结楼层消息会同时自动加入到世界书里，若使用该选项，建议勾选【隐藏总结楼层】',
    })[store.summary_settings.content_handling],
);
const summary_total_tokens = computed(
  () => store.summary_state.floor_rows.find(row => row.total)?.token_count ?? '统计中',
);
const summary_floor_filter = ref<'all' | 'summary'>('all');
const mobile_summary_workspace_view = ref<'all' | 'summary' | 'preview'>('all');
const is_compact_summary_workspace = ref(false);
const all_summary_floor_rows = computed(() => store.summary_state.floor_rows.filter(row => !row.total));
const summary_floor_rows = computed(() =>
  all_summary_floor_rows.value.filter(
    row => summary_floor_filter.value === 'all' || row.summary_message_id !== undefined,
  ),
);
const summary_total_row = computed(() => store.summary_state.floor_rows.find(row => row.total));
const selected_summary_floor_row_key = ref<string>();
const selected_summary_floor_row = computed(() => {
  const selected_row = all_summary_floor_rows.value.find(row => row.key === selected_summary_floor_row_key.value);
  return selected_row ?? summary_floor_rows.value[0] ?? all_summary_floor_rows.value[0];
});
const selected_summary_floor_row_index = computed(() =>
  summary_floor_rows.value.findIndex(row => row.key === selected_summary_floor_row.value?.key),
);
const selected_floor_messages = computed(() => {
  const row = selected_summary_floor_row.value;
  if (!row) {
    return [];
  }
  const messages_by_id = new Map(
    store.summary_state.floor_messages.map(message => [message.message_id, message] as const),
  );
  return row.message_ids
    .map(message_id => messages_by_id.get(message_id))
    .filter((message): message is SummaryMessageView => message !== undefined);
});
const selected_single_floor_message = computed(() =>
  selected_floor_messages.value.length === 1 ? selected_floor_messages.value[0] : undefined,
);
const selected_summary_floor_is_bookmarked = computed(
  () => selected_summary_floor_row.value?.summary_message_id !== undefined,
);
const selected_floor_hidden_count = computed(
  () => selected_floor_messages.value.filter(message => message.is_hidden).length,
);
const selected_floor_visible_count = computed(
  () => selected_floor_messages.value.length - selected_floor_hidden_count.value,
);
const selected_summary_floor_title = computed(() => {
  const row = selected_summary_floor_row.value;
  if (!row) {
    return '楼层详情';
  }
  if (row.summary_exists === false) {
    return `${row.range} · 失效书签`;
  }
  if (selected_single_floor_message.value) {
    return selected_summary_floor_is_bookmarked.value ? `${row.range} · 总结书签` : `${row.range} · 原始楼层`;
  }
  return `${row.range} · 逐层可见性`;
});
const root = ref<HTMLElement>();
const workspace = ref<HTMLElement>();
const summary_detail_pane = ref<HTMLElement>();
const selected_floor_native_host = ref<HTMLElement>();
const selected_floor_has_native_content = ref(false);
const import_file_input = ref<HTMLInputElement>();
const debug_text_modal = ref<{ content: string; title: string }>();
const mobile_debug_view = ref<'records' | 'detail'>('records');
const reorder_key = ref('');
let stop_reorder_tracking = () => {};
let debug_content_request_serial = 0;
let summary_workspace_resize_observer: ResizeObserver | undefined;
const selected_debug_record = computed(() => store.selected_debug_record);
const debug_total_rows = computed(() => getDebugRows(selected_debug_record.value?.state.total_rows));
const debug_triggered_rows = computed(() => getTriggeredDebugRows(selected_debug_record.value?.state.triggered_rows));
const debug_error_text = computed(() =>
  getDebugArray(selected_debug_record.value?.state.error_logs).map(getDebugValueText).join('\n\n'),
);

watch(
  () => store.active_tab,
  async active_tab => {
    if (active_tab === 'debug') {
      mobile_debug_view.value = 'records';
    }
    await nextTick();
    if (workspace.value) {
      workspace.value.scrollTop = 0;
    }
  },
);

watch(
  [
    () => store.active_tab,
    () => selected_single_floor_message.value?.message_id,
    () => selected_single_floor_message.value?.content,
    () => store.summary_settings.filter_html_code_blocks,
  ],
  async () => {
    await nextTick();
    renderSelectedFloorNativeMessage();
  },
  { immediate: true },
);

type DebugRecord = NonNullable<typeof store.selected_debug_record>;
type DebugRow = Record<string, unknown>;

onMounted(() => {
  const update_summary_workspace_size = () => {
    is_compact_summary_workspace.value = (root.value?.clientWidth ?? Number.POSITIVE_INFINITY) <= 760;
  };
  update_summary_workspace_size();
  if (root.value) {
    summary_workspace_resize_observer = new ResizeObserver(update_summary_workspace_size);
    summary_workspace_resize_observer.observe(root.value);
  }
  store.startDebugWatch();
  store.startEffectWatch();
  store.startSummaryWatch();
});

onBeforeUnmount(() => {
  summary_workspace_resize_observer?.disconnect();
  stop_reorder_tracking();
  store.stopDebugWatch();
  store.stopEffectWatch();
  store.stopSummaryWatch();
});

function openImportFilePicker() {
  import_file_input.value?.click();
}

function selectDebugRecord(record_id: string) {
  store.selectDebugRecord(record_id);
  mobile_debug_view.value = 'detail';
  nextTick(() => {
    if (workspace.value) {
      workspace.value.scrollTop = 0;
    }
  });
}

function handleOptionClick(group_id: string, option_id: string) {
  if (store.export_mode) {
    store.toggleExportOption(group_id, option_id);
    return;
  }
  void store.applyOption(group_id, option_id);
}

function getGroupSummary(group: GroupView): string {
  if (group.options.length === 0) {
    return `${group.mode_label} · ${group.variable_inputs.length || group.reasoner_format_checks.length} 项`;
  }
  const active_count = group.options.filter(option => option.status === 'active').length;
  return group.mode === 'single'
    ? `单选 · 已选 ${active_count}/${group.options.length}`
    : `多选 · 已启用 ${active_count}/${group.options.length}`;
}

function isGroupContentVisible(group_id: string): boolean {
  return store.export_mode || (!store.organizing && !store.isGroupCollapsed(group_id));
}

function isSummaryWorkspaceTabSelected(tab: 'all' | 'summary'): boolean {
  return is_compact_summary_workspace.value
    ? mobile_summary_workspace_view.value === tab
    : summary_floor_filter.value === tab;
}

function showSummaryFloorList(filter: 'all' | 'summary') {
  summary_floor_filter.value = filter;
  mobile_summary_workspace_view.value = filter;
}

function selectSummaryFloorRow(row: SummaryFloorRow) {
  selected_summary_floor_row_key.value = row.key;
  if (is_compact_summary_workspace.value) {
    mobile_summary_workspace_view.value = 'preview';
    nextTick(() => {
      if (summary_detail_pane.value) {
        summary_detail_pane.value.scrollTop = 0;
        summary_detail_pane.value.focus({ preventScroll: true });
      }
    });
  }
}

function selectAdjacentSummaryFloorRow(offset: -1 | 1) {
  const next_row = summary_floor_rows.value[selected_summary_floor_row_index.value + offset];
  if (next_row) {
    selectSummaryFloorRow(next_row);
  }
}

function toggleSelectedSummaryVisibility() {
  if (selected_summary_floor_row.value) {
    void store.setSummaryFloorRowHidden(selected_summary_floor_row.value);
  }
}

function setSelectedFloorMessagesHidden(is_hidden: boolean) {
  void store.setSummaryFloorMessagesHidden(
    selected_floor_messages.value.map(message => message.message_id),
    is_hidden,
  );
}

function toggleSelectedFloorBookmark() {
  const message = selected_single_floor_message.value;
  if (!message) {
    return;
  }

  if (selected_summary_floor_is_bookmarked.value) {
    store.deleteSummaryMessageId(message.message_id);
  } else {
    store.addSummaryMessageIdFromInput(message.message_id);
  }

  nextTick(() => {
    const next_row = all_summary_floor_rows.value.find(row => row.message_ids.includes(message.message_id));
    if (next_row) {
      selectSummaryFloorRow(next_row);
    }
  });
}

function getSummaryMessageRoleLabel(role: SummaryMessageView['role']): string {
  if (role === 'user') {
    return '用户消息';
  }
  if (role === 'system') {
    return '系统消息';
  }
  return '助手消息';
}

function renderSelectedFloorNativeMessage() {
  const host = selected_floor_native_host.value;
  const message = selected_single_floor_message.value;
  host?.replaceChildren();
  if (!host || !message || store.active_tab !== 'summary') {
    selected_floor_has_native_content.value = false;
    return;
  }

  const source = $(`.mes[mesid="${message.message_id}"] .mes_text`).get(0);
  if (source) {
    const clone = source.cloneNode(true) as HTMLElement;
    if (store.summary_settings.filter_html_code_blocks) {
      clone.querySelectorAll('.TH-render').forEach(element => element.remove());
      clone.querySelectorAll('pre').forEach(pre => {
        const code = pre.querySelector('code');
        if (/(?:^|\s)(?:custom-)?(?:language-)?html(?:\s|$)/i.test(code?.className ?? '')) {
          pre.remove();
        }
      });
    }
    host.append(clone);
  } else {
    const fallback = host.ownerDocument.createElement('div');
    fallback.className = 'mes_text';
    const formatted_message = SillyTavern.messageFormatting(
      message.content,
      message.name ?? SillyTavern.name2,
      message.role === 'system',
      message.role === 'user',
      message.message_id,
    );
    fallback.innerHTML = store.summary_settings.filter_html_code_blocks
      ? removeFormattedHtmlCodeBlocks(formatted_message)
      : formatted_message;
    host.append(fallback);
  }

  selected_floor_has_native_content.value =
    (host.textContent?.trim().length ?? 0) > 0 || host.querySelector('iframe, img, video, audio, svg') !== null;
}

function startReorder(kind: 'favorite' | 'group', key: string, event: PointerEvent) {
  if (event.pointerType === 'mouse' && event.button !== 0) {
    return;
  }
  event.preventDefault();
  stop_reorder_tracking();
  reorder_key.value = key;
  const owner_document = (event.currentTarget as HTMLElement).ownerDocument;
  const selector = `[data-reorder-kind="${kind}"]`;

  const move = (move_event: PointerEvent) => {
    const target = owner_document
      .elementFromPoint(move_event.clientX, move_event.clientY)
      ?.closest<HTMLElement>(selector);
    const target_key = target?.dataset.reorderKey;
    if (!target_key || target_key === reorder_key.value) {
      return;
    }
    if (kind === 'group') {
      store.moveGroup(reorder_key.value, target_key);
    } else {
      store.moveFavorite(reorder_key.value, target_key);
    }
  };
  const stop = () => {
    owner_document.removeEventListener('pointermove', move);
    owner_document.removeEventListener('pointerup', stop);
    owner_document.removeEventListener('pointercancel', stop);
    reorder_key.value = '';
    stop_reorder_tracking = () => {};
  };
  stop_reorder_tracking = stop;
  owner_document.addEventListener('pointermove', move);
  owner_document.addEventListener('pointerup', stop);
  owner_document.addEventListener('pointercancel', stop);
}

function handleVariableInput(group_id: string, input_id: string, event: Event) {
  store.updateVariableInput(group_id, input_id, (event.target as HTMLInputElement).value);
}

async function importPresetSettings(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) {
    return;
  }

  await store.importPresetSettings(await file.text());
  input.value = '';
}

function confirmImport(include_failed: boolean) {
  void store.confirmImportReview(include_failed);
}

function isConfirmed(result: unknown): boolean {
  return result === true || result === SillyTavern.POPUP_RESULT.AFFIRMATIVE;
}

async function confirmPopup(message: string): Promise<boolean> {
  return isConfirmed(await SillyTavern.callGenericPopup(message, SillyTavern.POPUP_TYPE.CONFIRM));
}

async function confirmClearFavorites() {
  if (await confirmPopup('确认清空所有收藏？分组顺序和折叠状态不会受到影响。')) {
    store.clearFavorites();
  }
}

function getEventValue(event: Event): string {
  return (event.target as HTMLSelectElement).value;
}

function getEventChecked(event: Event): boolean {
  return (event.target as HTMLInputElement).checked;
}

function setSummaryContentHandling(event: Event) {
  store.setSummaryContentHandling(getEventValue(event) as SummaryContentHandling);
}

function setSummaryFilterHtmlCodeBlocks(event: Event) {
  store.setSummaryFilterHtmlCodeBlocks(getEventChecked(event));
}

function setSummaryManualPromptEnabled(event: Event) {
  store.setSummaryManualPromptEnabled(getEventChecked(event));
}

type SummaryBooleanHideRule = Exclude<keyof SummaryHideRules, 'keep_latest_count'>;

function setSummaryHideRule(rule: SummaryBooleanHideRule, event: Event) {
  store.setSummaryHideRule(rule, getEventChecked(event));
}

function setSummaryKeepLatestCount(event: Event) {
  store.setSummaryKeepLatestCount((event.target as HTMLInputElement).value);
}

function removeFormattedHtmlCodeBlocks(formatted_message: string): string {
  const template = document.createElement('template');
  template.innerHTML = formatted_message;

  template.content.querySelectorAll('.TH-render').forEach(element => element.remove());
  template.content.querySelectorAll('pre').forEach(pre => {
    const code = pre.querySelector('code');
    const language_classes = code?.className ?? '';
    if (/(?:^|\s)(?:custom-)?(?:language-)?html(?:\s|$)/i.test(language_classes)) {
      pre.remove();
    }
  });

  return template.innerHTML.trim();
}

async function addSummaryMessage() {
  const result = await SillyTavern.callGenericPopup('请输入要标记为总结层的楼层号。', SillyTavern.POPUP_TYPE.INPUT);
  if (result === undefined || result === false || result === SillyTavern.POPUP_RESULT.CANCELLED) {
    return;
  }

  const input = String(result).trim();
  if (!/^\d+$/.test(input)) {
    toastr.error('请输入有效的楼层号。');
    return;
  }

  const message_id = Number(input);
  store.addSummaryMessageIdFromInput(message_id);
}

async function confirmApplySummaryHideOnly() {
  if (await confirmPopup('确认按当前规则隐藏命中楼层？不会取消隐藏未命中的楼层。')) {
    await store.applySummaryHideOnly();
  }
}

async function confirmSyncSummaryHideRules() {
  if (await confirmPopup('确认按当前规则同步所有楼层隐藏状态？未命中的楼层会被取消隐藏。')) {
    await store.syncSummaryHideRules();
  }
}

async function confirmUnhideSummaryAll() {
  if (await confirmPopup('确认取消隐藏当前聊天的所有楼层？')) {
    await store.unhideSummaryAll();
  }
}

async function confirmStartSummary() {
  await store.startManualSummary();
}

function isDebugObject(value: unknown): value is DebugRow {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getDebugArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function getDebugValueText(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value === undefined) {
    return '';
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function getDebugSummaryText(value: unknown, max_length = 96): string {
  const text = getDebugValueText(value).replace(/\s+/g, ' ').trim();
  if (!text) {
    return '空';
  }
  return text.length > max_length ? text.slice(0, max_length) : text;
}

function getDebugPreview(value: unknown, max_length = 240): string {
  const text = getDebugValueText(value);
  return text.length > max_length ? `${text.slice(0, max_length)}……` : text;
}

function getDebugRows(value: unknown): { key: string; row: DebugRow }[] {
  return getDebugArray(value).map((item, index) => ({
    key: String(index),
    row: isDebugObject(item) ? item : { 值: item },
  }));
}

function getTriggeredDebugRows(value: unknown): { key: string; row: DebugRow }[] {
  return getDebugArray(value).map((item, index) => {
    const row = isDebugObject(item) && isDebugObject(item.row) ? item.row : item;
    const key = isDebugObject(item) && typeof item.key === 'string' ? item.key : String(index);
    return {
      key,
      row: isDebugObject(row) ? row : { 值: row },
    };
  });
}

const debug_content_metadata_keys = new Set(['详细内容摘要', '详细内容长度', '详细内容hash', '详细内容缓存键']);

function getDebugRowFields(row: DebugRow): { key: string; preview: string; text: string }[] {
  return Object.entries(row)
    .filter(([key]) => !debug_content_metadata_keys.has(key))
    .map(([key, value]) => ({
      key,
      preview: getDebugPreview(value),
      text: getDebugValueText(value),
    }));
}

function getDebugTotalSummary(row: DebugRow): string {
  return `${getDebugSummaryText(row.类型)} - ${getDebugSummaryText(row.来源)} - ${getDebugSummaryText(row.详细内容摘要 ?? row.详细内容)}……`;
}

function getDebugTriggeredSummary(row: DebugRow): string {
  return `${getDebugSummaryText(row.触发类型)} - ${getDebugSummaryText(row.名称)} - ${getDebugSummaryText(row.详细内容摘要 ?? row.详细内容)}……`;
}

function getDebugMetrics(record: DebugRecord): { label: string; value: number }[] {
  return [
    { label: '总排序', value: record.summary.total_rows },
    { label: '触发', value: record.summary.triggered_rows },
    { label: '错误', value: record.summary.error_count },
    { label: '失败', value: record.summary.failed },
    { label: '已载入', value: record.summary.loaded_total },
    { label: '绿灯缓存', value: record.summary.green_cache_insertions },
    { label: '残留包裹', value: record.summary.wrapper_paired + record.summary.wrapper_orphan },
  ];
}

function formatDebugTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function openDebugTextModal(title: string, content: string) {
  debug_content_request_serial += 1;
  debug_text_modal.value = { content, title };
}

async function openDebugRowContentModal(title: string, row: DebugRow) {
  const record_id = selected_debug_record.value?.id;
  const content_id = typeof row.详细内容缓存键 === 'string' ? row.详细内容缓存键 : undefined;
  const fallback_content = getDebugValueText(row.详细内容);
  if (!record_id || !content_id) {
    openDebugTextModal(title, fallback_content);
    return;
  }

  const request_serial = ++debug_content_request_serial;
  debug_text_modal.value = { content: '正在从 Debug 存储读取完整正文…', title };
  try {
    const content = await store.getDebugContent(record_id, content_id);
    if (debug_content_request_serial !== request_serial) {
      return;
    }
    if (content === undefined) {
      toastr.warning('未找到完整 Debug 正文，已显示现有预览。');
    }
    debug_text_modal.value = { content: content ?? fallback_content, title };
  } catch (error) {
    if (debug_content_request_serial !== request_serial) {
      return;
    }
    console.warn('[预设适配器] 读取 Debug 正文失败。', { content_id, error, record_id });
    toastr.warning('读取完整 Debug 正文失败，已显示现有预览。');
    debug_text_modal.value = { content: fallback_content, title };
  }
}

function openDebugRawModal() {
  if (!selected_debug_record.value) {
    return;
  }
  openDebugTextModal('原始数据', JSON.stringify(selected_debug_record.value.state, null, 2));
}

function closeDebugTextModal() {
  debug_content_request_serial += 1;
  debug_text_modal.value = undefined;
}
</script>

<style>
.preset-adapter-floating-window {
  position: fixed;
  z-index: 4000;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  box-sizing: border-box;
  container-type: inline-size;
  overflow: hidden;
  border: 1px solid var(--pa-border);
  border-radius: 8px;
  box-shadow: 0 12px 36px var(--pa-shadow);
  background-color: var(--pa-ink);
  color: var(--pa-text);
}

.preset-adapter-floating-titlebar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex: 0 0 auto;
  min-height: 2.55rem;
  border-bottom: 1px solid var(--pa-border);
  padding: 0.25rem 0.4rem 0.25rem 0.75rem;
  background-color: var(--pa-surface-soft);
  cursor: grab;
  touch-action: none;
  user-select: none;
}

.preset-adapter-floating-titlebar:active {
  cursor: grabbing;
}

.preset-adapter-floating-title {
  display: inline-flex;
  align-items: center;
  min-width: 0;
  gap: 0.5rem;
  font-weight: 700;
}

.preset-adapter-floating-title span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preset-adapter-floating-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 2em;
  height: 2em;
  padding: 0;
}

.preset-adapter-floating-title-actions {
  display: inline-flex;
  align-items: center;
  flex: 0 0 auto;
  gap: 0.3rem;
}

.preset-adapter-floating-theme {
  display: inline-grid;
  place-items: center;
  width: 2em;
  height: 2em;
  padding: 0;
}

.preset-adapter-theme-picker {
  position: absolute;
  z-index: 90;
  top: 3.15rem;
  right: 0.55rem;
  display: flex;
  flex-direction: column;
  width: min(28rem, calc(100% - 1.1rem));
  max-height: calc(100% - 3.7rem);
  overflow: auto;
  border: 1px solid var(--pa-border-strong);
  border-radius: var(--pa-card-radius, 12px);
  padding: 0.65rem;
  background: var(--pa-popover-background, var(--pa-surface-raised));
  box-shadow: 0 1rem 2.8rem var(--pa-shadow);
  color: var(--pa-text);
  overscroll-behavior: contain;
  gap: 0.6rem;
}

.preset-adapter-theme-picker[hidden] {
  display: none;
}

.preset-adapter-theme-picker > header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.7rem;
}

.preset-adapter-theme-picker > header > div {
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: 0.08rem;
}

.preset-adapter-theme-picker > header strong {
  color: var(--pa-heading, var(--pa-text));
  font-size: 0.92rem;
}

.preset-adapter-theme-picker > header small {
  color: var(--pa-muted);
  font-size: 0.72rem;
}

.preset-adapter-theme-picker > header button {
  display: inline-grid;
  place-items: center;
  flex: 0 0 auto;
  width: 2rem;
  height: 2rem;
  border: 1px solid var(--pa-border);
  border-radius: var(--pa-control-radius, 8px);
  padding: 0;
  background: var(--pa-control-background, transparent);
  color: var(--pa-text);
  cursor: pointer;
}

.preset-adapter-theme-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.45rem;
}

.preset-adapter-theme-option {
  display: grid;
  grid-template-columns: 2rem minmax(0, 1fr);
  min-width: 0;
  border: 1px solid var(--pa-border);
  border-radius: var(--pa-control-radius, 9px);
  padding: 0.5rem;
  background: var(--pa-control-background, transparent);
  color: var(--pa-text);
  text-align: left;
  cursor: pointer;
  gap: 0.45rem;
}

.preset-adapter-theme-option:hover {
  border-color: var(--pa-border-strong);
  background: var(--pa-control-hover-background, var(--pa-surface-raised));
}

.preset-adapter-theme-option[aria-pressed='true'] {
  border-color: var(--pa-coral);
  background: var(--pa-active-background, var(--pa-coral-soft));
  box-shadow: inset 3px 0 0 var(--pa-coral);
}

.preset-adapter-theme-option-icon {
  display: grid;
  grid-row: 1 / span 2;
  place-items: center;
  width: 2rem;
  height: 2rem;
  border-radius: 50%;
  background: var(--pa-highlight-soft, var(--pa-surface-soft));
  color: var(--pa-gold);
}

.preset-adapter-theme-option-copy {
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: 0.08rem;
}

.preset-adapter-theme-option-copy strong,
.preset-adapter-theme-option-copy small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preset-adapter-theme-option-copy strong {
  font-size: 0.82rem;
}

.preset-adapter-theme-option-copy small {
  color: var(--pa-muted);
  font-size: 0.68rem;
}

.preset-adapter-theme-option-swatches {
  grid-column: 2;
  display: flex;
  height: 0.3rem;
  overflow: hidden;
  border-radius: 999px;
}

.preset-adapter-theme-option-swatches i {
  flex: 1 1 0;
}

.preset-adapter-floating-body {
  box-sizing: border-box;
  min-width: 0;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  padding: 0.75rem;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
  touch-action: pan-y;
}

.preset-adapter-floating-resize {
  position: absolute;
  z-index: 50;
  right: 0;
  bottom: 0;
  width: 2rem;
  height: 2rem;
  cursor: nwse-resize;
  touch-action: none;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
}

.preset-adapter-floating-resize::after {
  position: absolute;
  right: 0.25rem;
  bottom: 0.25rem;
  width: 0.55rem;
  height: 0.55rem;
  border-right: 2px solid var(--pa-muted);
  border-bottom: 2px solid var(--pa-muted);
  content: '';
  opacity: 0.8;
}

@media (max-width: 720px) {
  .preset-adapter-floating-body {
    padding: 0.6rem;
  }

  .preset-adapter-floating-titlebar {
    min-height: 2.4rem;
  }

}

@container (max-width: 760px) {
  .preset-adapter-floating-resize {
    right: 0;
    bottom: 3.9rem;
    width: 3.25rem;
    height: 3.25rem;
  }

  .preset-adapter-floating-resize::after {
    right: 0.5rem;
    bottom: 0.5rem;
    width: 0.72rem;
    height: 0.72rem;
  }

  .preset-adapter-theme-picker {
    top: 2.95rem;
    right: 0.35rem;
    width: calc(100% - 0.7rem);
    max-height: calc(100% - 7.3rem);
    padding: 0.5rem;
  }

  .preset-adapter-theme-grid {
    gap: 0.35rem;
  }

  .preset-adapter-theme-option {
    grid-template-columns: 1.65rem minmax(0, 1fr);
    padding: 0.42rem;
  }

  .preset-adapter-theme-option-icon {
    width: 1.65rem;
    height: 1.65rem;
  }
}
</style>

<style>
.preset-adapter-floating-window {
  --pa-ink: var(--preset-adapter-theme-background, #090f1e);
  --pa-ink-soft: var(--preset-adapter-theme-background-soft, #11182a);
  --pa-surface: var(--preset-adapter-theme-surface, #191b2a);
  --pa-surface-raised: var(--preset-adapter-theme-surface-raised, #222232);
  --pa-surface-soft: var(--preset-adapter-theme-surface-soft, #151a2a);
  --pa-border: var(--preset-adapter-theme-border, rgb(232 205 174 / 20%));
  --pa-border-strong: var(--preset-adapter-theme-border-strong, rgb(241 197 164 / 38%));
  --pa-text: var(--preset-adapter-theme-text, #fff0d6);
  --pa-muted: var(--preset-adapter-theme-text-muted, #aeb0bd);
  --pa-description-text: var(--preset-adapter-theme-description-text, #b8bbc8);
  --pa-coral: var(--preset-adapter-theme-accent, #ff817a);
  --pa-coral-soft: var(--preset-adapter-theme-accent-soft, rgb(255 129 122 / 16%));
  --pa-gold: var(--preset-adapter-theme-highlight, #f2bd65);
  --pa-teal: var(--preset-adapter-theme-success, #76c7b1);
  --pa-danger: var(--preset-adapter-theme-danger, #f06f75);
  --pa-shadow: var(--preset-adapter-theme-shadow, rgb(0 0 0 / 58%));
  --pa-heading: var(--preset-adapter-theme-text-strong, #ffe5be);
  --pa-accent-text: var(--preset-adapter-theme-accent-text, #ffd9c9);
  --pa-highlight-text: var(--preset-adapter-theme-highlight-text, #ffd16f);
  --pa-overlay-faint: rgb(255 255 255 / 3%);
  --pa-overlay-subtle: rgb(255 255 255 / 5%);
  --pa-overlay-hover: rgb(255 255 255 / 8%);
  --pa-titlebar-background: linear-gradient(90deg, #0d1425, #121727);
  --pa-workspace-background: radial-gradient(circle at 86% 2%, rgb(102 77 124 / 16%), transparent 34%), var(--pa-ink);
  --pa-sidebar-background: linear-gradient(180deg, rgb(9 18 38 / 95%), rgb(8 13 27 / 98%)), var(--pa-ink);
  --pa-popover-background: #171b2b;
  --pa-card-background: linear-gradient(145deg, var(--pa-overlay-faint), transparent 55%), var(--pa-surface);
  --pa-control-background: var(--pa-overlay-subtle);
  --pa-control-hover-background: var(--pa-overlay-hover);
  --pa-active-background: linear-gradient(90deg, color-mix(in srgb, var(--pa-coral) 18%, transparent), var(--pa-coral-soft));
  --pa-highlight-soft: color-mix(in srgb, var(--pa-gold) 13%, transparent);
  --pa-highlight-border: color-mix(in srgb, var(--pa-gold) 44%, transparent);
  --pa-accent-glow: color-mix(in srgb, var(--pa-coral) 74%, transparent);
  --pa-primary-button-background: linear-gradient(135deg, #f36f72, #ff8c78);
  --pa-primary-button-border: #ff9b8e;
  --pa-primary-button-shadow: rgb(243 111 114 / 26%);
  --pa-primary-button-text: #fff5e8;
  --pa-window-radius: 16px;
  --pa-card-radius: 12px;
  --pa-control-radius: 9px;
  border-color: var(--pa-border-strong);
  border-radius: var(--pa-window-radius);
  background: var(--pa-ink);
  box-shadow: 0 24px 70px var(--pa-shadow);
  color: var(--pa-text);
}

.preset-adapter-floating-window[data-preset-adapter-theme='deep-blue'] {
  --pa-ink: var(--preset-adapter-theme-background, #06152a);
  --pa-ink-soft: var(--preset-adapter-theme-background-soft, #091e36);
  --pa-surface: var(--preset-adapter-theme-surface, #0d2947);
  --pa-surface-raised: var(--preset-adapter-theme-surface-raised, #12375d);
  --pa-surface-soft: var(--preset-adapter-theme-surface-soft, #0a223d);
  --pa-border: var(--preset-adapter-theme-border, rgb(91 166 226 / 24%));
  --pa-border-strong: var(--preset-adapter-theme-border-strong, rgb(95 181 247 / 48%));
  --pa-text: var(--preset-adapter-theme-text, #e5f3ff);
  --pa-muted: var(--preset-adapter-theme-text-muted, #9bb4ca);
  --pa-description-text: var(--preset-adapter-theme-description-text, #9bb4ca);
  --pa-coral: var(--preset-adapter-theme-accent, #38a8ff);
  --pa-coral-soft: var(--preset-adapter-theme-accent-soft, rgb(56 168 255 / 16%));
  --pa-gold: var(--preset-adapter-theme-highlight, #79d7ff);
  --pa-teal: var(--preset-adapter-theme-success, #58d6c0);
  --pa-danger: var(--preset-adapter-theme-danger, #ff7f93);
  --pa-shadow: var(--preset-adapter-theme-shadow, rgb(0 8 22 / 52%));
  --pa-heading: var(--preset-adapter-theme-text-strong, #edf8ff);
  --pa-accent-text: var(--preset-adapter-theme-accent-text, #a9dcff);
  --pa-highlight-text: var(--preset-adapter-theme-highlight-text, #a9efff);
  --pa-overlay-faint: rgb(148 211 255 / 3%);
  --pa-overlay-subtle: rgb(148 211 255 / 6%);
  --pa-overlay-hover: rgb(148 211 255 / 10%);
  --pa-titlebar-background: linear-gradient(90deg, #06172c, #09213b);
  --pa-workspace-background:
    radial-gradient(ellipse at 84% 4%, rgb(35 139 226 / 21%), transparent 38%),
    repeating-radial-gradient(ellipse at 8% 100%, transparent 0 18px, rgb(80 178 240 / 5%) 20px 21px, transparent 23px 34px),
    var(--pa-ink);
  --pa-sidebar-background: linear-gradient(180deg, rgb(5 29 55 / 98%), rgb(4 20 39 / 99%));
  --pa-popover-background: #0a2440;
  --pa-card-background: linear-gradient(145deg, rgb(95 181 247 / 7%), transparent 58%), var(--pa-surface);
  --pa-active-background: linear-gradient(90deg, rgb(56 168 255 / 24%), rgb(56 168 255 / 7%));
  --pa-primary-button-background: linear-gradient(135deg, #157ed2, #35b9ef);
  --pa-primary-button-border: #62caff;
  --pa-primary-button-shadow: rgb(31 151 224 / 24%);
  --pa-primary-button-text: #f3fbff;
  --pa-window-radius: 16px;
  --pa-card-radius: 13px;
  --pa-control-radius: 10px;
  color-scheme: dark;
}

.preset-adapter-floating-window[data-preset-adapter-theme='purple-black'] {
  --pa-ink: var(--preset-adapter-theme-background, #100b1d);
  --pa-ink-soft: var(--preset-adapter-theme-background-soft, #181022);
  --pa-surface: var(--preset-adapter-theme-surface, #21152f);
  --pa-surface-raised: var(--preset-adapter-theme-surface-raised, #2e1a43);
  --pa-surface-soft: var(--preset-adapter-theme-surface-soft, #1a1027);
  --pa-border: var(--preset-adapter-theme-border, rgb(195 140 255 / 22%));
  --pa-border-strong: var(--preset-adapter-theme-border-strong, rgb(201 139 255 / 44%));
  --pa-text: var(--preset-adapter-theme-text, #f3e9ff);
  --pa-muted: var(--preset-adapter-theme-text-muted, #baa7c9);
  --pa-description-text: var(--preset-adapter-theme-description-text, #baa7c9);
  --pa-coral: var(--preset-adapter-theme-accent, #b665ff);
  --pa-coral-soft: var(--preset-adapter-theme-accent-soft, rgb(182 101 255 / 17%));
  --pa-gold: var(--preset-adapter-theme-highlight, #e59cff);
  --pa-teal: var(--preset-adapter-theme-success, #7dd5be);
  --pa-danger: var(--preset-adapter-theme-danger, #ff789c);
  --pa-shadow: var(--preset-adapter-theme-shadow, rgb(5 0 12 / 60%));
  --pa-heading: var(--preset-adapter-theme-text-strong, #f6eaff);
  --pa-accent-text: var(--preset-adapter-theme-accent-text, #e5c4ff);
  --pa-highlight-text: var(--preset-adapter-theme-highlight-text, #f0c8ff);
  --pa-overlay-faint: rgb(225 187 255 / 3%);
  --pa-overlay-subtle: rgb(225 187 255 / 6%);
  --pa-overlay-hover: rgb(225 187 255 / 10%);
  --pa-titlebar-background: linear-gradient(90deg, #150d24, #251238);
  --pa-workspace-background:
    radial-gradient(ellipse at 86% 8%, rgb(152 67 218 / 22%), transparent 38%),
    radial-gradient(ellipse at 18% 92%, rgb(97 47 171 / 16%), transparent 45%),
    var(--pa-ink);
  --pa-sidebar-background: linear-gradient(180deg, rgb(25 12 40 / 98%), rgb(13 8 24 / 99%));
  --pa-popover-background: #28163a;
  --pa-card-background: linear-gradient(145deg, rgb(217 170 255 / 6%), transparent 55%), var(--pa-surface);
  --pa-active-background: linear-gradient(90deg, rgb(182 101 255 / 26%), rgb(182 101 255 / 6%));
  --pa-primary-button-background: linear-gradient(135deg, #8e42dc, #c05cff);
  --pa-primary-button-border: #ce8aff;
  --pa-primary-button-shadow: rgb(165 73 231 / 26%);
  --pa-primary-button-text: #fff6ff;
  --pa-window-radius: 14px;
  --pa-card-radius: 8px;
  --pa-control-radius: 4px;
  color-scheme: dark;
}

.preset-adapter-floating-window[data-preset-adapter-theme='jade-green'] {
  --pa-ink: var(--preset-adapter-theme-background, #edf7f2);
  --pa-ink-soft: var(--preset-adapter-theme-background-soft, #f7fbf9);
  --pa-surface: var(--preset-adapter-theme-surface, #f1f8f4);
  --pa-surface-raised: var(--preset-adapter-theme-surface-raised, #ffffff);
  --pa-surface-soft: var(--preset-adapter-theme-surface-soft, #e5f1eb);
  --pa-border: var(--preset-adapter-theme-border, rgb(35 112 87 / 18%));
  --pa-border-strong: var(--preset-adapter-theme-border-strong, rgb(35 112 87 / 34%));
  --pa-text: var(--preset-adapter-theme-text, #183f35);
  --pa-muted: var(--preset-adapter-theme-text-muted, #5d776f);
  --pa-description-text: var(--preset-adapter-theme-description-text, #4f6c63);
  --pa-coral: var(--preset-adapter-theme-accent, #238768);
  --pa-coral-soft: var(--preset-adapter-theme-accent-soft, rgb(35 135 104 / 14%));
  --pa-gold: var(--preset-adapter-theme-highlight, #a77d35);
  --pa-teal: var(--preset-adapter-theme-success, #218b75);
  --pa-danger: var(--preset-adapter-theme-danger, #b94f5d);
  --pa-shadow: var(--preset-adapter-theme-shadow, rgb(40 75 62 / 18%));
  --pa-heading: var(--preset-adapter-theme-text-strong, #174b3d);
  --pa-accent-text: var(--preset-adapter-theme-accent-text, #145b47);
  --pa-highlight-text: var(--preset-adapter-theme-highlight-text, #805a1f);
  --pa-overlay-faint: rgb(27 94 72 / 3%);
  --pa-overlay-subtle: rgb(27 94 72 / 5%);
  --pa-overlay-hover: rgb(27 94 72 / 9%);
  --pa-titlebar-background: linear-gradient(90deg, #f5fbf8, #e7f3ed);
  --pa-workspace-background:
    radial-gradient(ellipse at 91% 5%, rgb(66 167 130 / 12%), transparent 36%),
    repeating-linear-gradient(116deg, transparent 0 52px, rgb(35 135 104 / 3%) 53px 54px, transparent 55px 96px),
    var(--pa-ink);
  --pa-sidebar-background: linear-gradient(180deg, #e5f3ec, #d8ebe2);
  --pa-popover-background: #fbfefd;
  --pa-card-background: linear-gradient(145deg, rgb(255 255 255 / 72%), transparent 58%), var(--pa-surface);
  --pa-active-background: linear-gradient(90deg, rgb(35 135 104 / 20%), rgb(35 135 104 / 6%));
  --pa-primary-button-background: linear-gradient(135deg, #237f64, #46a889);
  --pa-primary-button-border: #4da98c;
  --pa-primary-button-shadow: rgb(35 112 87 / 20%);
  --pa-primary-button-text: #f7fffb;
  --pa-window-radius: 15px;
  --pa-card-radius: 12px;
  --pa-control-radius: 10px;
  color-scheme: light;
}

.preset-adapter-floating-window[data-preset-adapter-theme='moon-white'] {
  --pa-ink: var(--preset-adapter-theme-background, #f8f4ec);
  --pa-ink-soft: var(--preset-adapter-theme-background-soft, #fffdf8);
  --pa-surface: var(--preset-adapter-theme-surface, #f5efe4);
  --pa-surface-raised: var(--preset-adapter-theme-surface-raised, #fffaf0);
  --pa-surface-soft: var(--preset-adapter-theme-surface-soft, #eee6d8);
  --pa-border: var(--preset-adapter-theme-border, rgb(110 89 61 / 18%));
  --pa-border-strong: var(--preset-adapter-theme-border-strong, rgb(110 89 61 / 32%));
  --pa-text: var(--preset-adapter-theme-text, #42382e);
  --pa-muted: var(--preset-adapter-theme-text-muted, #7a6f63);
  --pa-description-text: var(--preset-adapter-theme-description-text, #6c6055);
  --pa-coral: var(--preset-adapter-theme-accent, #b7873d);
  --pa-coral-soft: var(--preset-adapter-theme-accent-soft, rgb(183 135 61 / 14%));
  --pa-gold: var(--preset-adapter-theme-highlight, #c99a4a);
  --pa-teal: var(--preset-adapter-theme-success, #4f8a72);
  --pa-danger: var(--preset-adapter-theme-danger, #b85d63);
  --pa-shadow: var(--preset-adapter-theme-shadow, rgb(72 54 35 / 16%));
  --pa-heading: var(--preset-adapter-theme-text-strong, #4b3927);
  --pa-accent-text: var(--preset-adapter-theme-accent-text, #7d561f);
  --pa-highlight-text: var(--preset-adapter-theme-highlight-text, #8a6122);
  --pa-overlay-faint: rgb(93 70 42 / 3%);
  --pa-overlay-subtle: rgb(93 70 42 / 5%);
  --pa-overlay-hover: rgb(93 70 42 / 8%);
  --pa-titlebar-background: linear-gradient(90deg, #fffaf0, #f1e9dc);
  --pa-workspace-background:
    linear-gradient(150deg, transparent 62%, rgb(178 143 91 / 6%) 62.5%, transparent 63%),
    radial-gradient(ellipse at 86% 5%, rgb(201 154 74 / 9%), transparent 34%),
    var(--pa-ink);
  --pa-sidebar-background: linear-gradient(180deg, #f2eadf, #e9dfd0);
  --pa-popover-background: #fffdf8;
  --pa-card-background: linear-gradient(145deg, rgb(255 255 255 / 66%), transparent 58%), var(--pa-surface);
  --pa-active-background: linear-gradient(90deg, rgb(183 135 61 / 18%), rgb(183 135 61 / 5%));
  --pa-primary-button-background: linear-gradient(135deg, #ac7d35, #c99a4a);
  --pa-primary-button-border: #c89d5a;
  --pa-primary-button-shadow: rgb(145 105 47 / 18%);
  --pa-primary-button-text: #fffaf0;
  --pa-window-radius: 10px;
  --pa-card-radius: 6px;
  --pa-control-radius: 4px;
  color-scheme: light;
}

.preset-adapter-floating-window[data-preset-adapter-theme='frost-blue'] {
  --pa-ink: var(--preset-adapter-theme-background, #f2f8ff);
  --pa-ink-soft: var(--preset-adapter-theme-background-soft, #fafdff);
  --pa-surface: var(--preset-adapter-theme-surface, #eaf3fd);
  --pa-surface-raised: var(--preset-adapter-theme-surface-raised, #ffffff);
  --pa-surface-soft: var(--preset-adapter-theme-surface-soft, #dceafb);
  --pa-border: var(--preset-adapter-theme-border, rgb(49 116 181 / 18%));
  --pa-border-strong: var(--preset-adapter-theme-border-strong, rgb(49 116 181 / 34%));
  --pa-text: var(--preset-adapter-theme-text, #173a5e);
  --pa-muted: var(--preset-adapter-theme-text-muted, #5c7692);
  --pa-description-text: var(--preset-adapter-theme-description-text, #4f6c88);
  --pa-coral: var(--preset-adapter-theme-accent, #2b83d7);
  --pa-coral-soft: var(--preset-adapter-theme-accent-soft, rgb(43 131 215 / 14%));
  --pa-gold: var(--preset-adapter-theme-highlight, #69aee8);
  --pa-teal: var(--preset-adapter-theme-success, #3c9c8a);
  --pa-danger: var(--preset-adapter-theme-danger, #bd5872);
  --pa-shadow: var(--preset-adapter-theme-shadow, rgb(45 88 132 / 17%));
  --pa-heading: var(--preset-adapter-theme-text-strong, #164875);
  --pa-accent-text: var(--preset-adapter-theme-accent-text, #155d9f);
  --pa-highlight-text: var(--preset-adapter-theme-highlight-text, #286da8);
  --pa-overlay-faint: rgb(40 102 160 / 3%);
  --pa-overlay-subtle: rgb(40 102 160 / 5%);
  --pa-overlay-hover: rgb(40 102 160 / 9%);
  --pa-titlebar-background: linear-gradient(90deg, #f8fbff, #e4f0fc);
  --pa-workspace-background:
    repeating-conic-gradient(from 24deg at 94% 104%, rgb(72 151 221 / 5%) 0 9deg, transparent 9deg 22deg),
    radial-gradient(ellipse at 85% 2%, rgb(82 161 229 / 10%), transparent 34%),
    var(--pa-ink);
  --pa-sidebar-background: linear-gradient(180deg, #e7f2fd, #d8e8f8);
  --pa-popover-background: #fafdff;
  --pa-card-background: linear-gradient(145deg, rgb(255 255 255 / 72%), transparent 58%), var(--pa-surface);
  --pa-active-background: linear-gradient(90deg, rgb(43 131 215 / 19%), rgb(43 131 215 / 5%));
  --pa-primary-button-background: linear-gradient(135deg, #277bc8, #58a9ea);
  --pa-primary-button-border: #6bb4ed;
  --pa-primary-button-shadow: rgb(43 112 176 / 18%);
  --pa-primary-button-text: #f8fcff;
  --pa-window-radius: 12px;
  --pa-card-radius: 8px;
  --pa-control-radius: 6px;
  color-scheme: light;
}

.preset-adapter-floating-window[data-preset-adapter-theme='night-gold'] {
  color-scheme: dark;
}

.preset-adapter-floating-titlebar {
  min-height: 2.7rem;
  border-color: var(--pa-border);
  background: var(--pa-titlebar-background);
}

.preset-adapter-floating-title {
  color: var(--pa-heading);
  letter-spacing: 0.04em;
}

.preset-adapter-floating-close,
.preset-adapter-floating-titlebar button {
  border: 1px solid var(--pa-border);
  border-radius: var(--pa-control-radius);
  background: var(--pa-control-background);
  color: var(--pa-text);
}

.preset-adapter-floating-body {
  overflow: hidden;
  padding: 0;
  background: var(--pa-workspace-background);
  container-type: inline-size;
}

.preset-adapter-root.preset-adapter-root {
  display: grid;
  grid-template-columns: 158px minmax(0, 1fr);
  gap: 0;
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  color: var(--pa-text);
}

.preset-adapter-root *,
.preset-adapter-root *::before,
.preset-adapter-root *::after {
  box-sizing: border-box;
}

.preset-adapter-root button,
.preset-adapter-root input,
.preset-adapter-root select,
.preset-adapter-root textarea {
  font: inherit;
}

.preset-adapter-root button {
  color: inherit;
}

.preset-adapter-root .preset-adapter-sidebar {
  display: flex;
  flex-direction: column;
  min-width: 0;
  border-right: 1px solid var(--pa-border-strong);
  background: var(--pa-sidebar-background);
}

.preset-adapter-root .preset-adapter-brand {
  display: grid;
  place-items: center;
  gap: 0.6rem;
  min-height: 9.5rem;
  padding: 1.15rem 0.6rem;
  color: var(--pa-heading);
  text-align: center;
  letter-spacing: 0.16em;
}

.preset-adapter-root .preset-adapter-brand-mark {
  position: relative;
  display: grid;
  place-items: center;
  width: 5.6rem;
  height: 4.8rem;
  color: var(--pa-gold);
}

.preset-adapter-root .preset-adapter-brand-whale {
  display: block;
  width: 100%;
  height: 100%;
  overflow: visible;
  filter: drop-shadow(0 6px 12px color-mix(in srgb, var(--pa-shadow) 54%, transparent));
}

.preset-adapter-root .preset-adapter-brand-star {
  fill: var(--pa-gold);
  stroke: var(--pa-highlight-text);
  stroke-width: 1.4;
  stroke-linejoin: round;
}

.preset-adapter-root .preset-adapter-brand-spout,
.preset-adapter-root .preset-adapter-brand-smile {
  fill: none;
  stroke: var(--pa-accent-text);
  stroke-width: 2.2;
  stroke-linecap: round;
}

.preset-adapter-root .preset-adapter-brand-tail,
.preset-adapter-root .preset-adapter-brand-whale-body {
  fill: color-mix(in srgb, var(--pa-coral) 24%, var(--pa-surface-raised));
  stroke: var(--pa-accent-text);
  stroke-width: 2;
  stroke-linejoin: round;
}

.preset-adapter-root .preset-adapter-brand-belly {
  fill: color-mix(in srgb, var(--pa-gold) 18%, var(--pa-surface-raised));
}

.preset-adapter-root .preset-adapter-brand-fin {
  fill: color-mix(in srgb, var(--pa-coral) 36%, var(--pa-surface-raised));
  stroke: var(--pa-accent-text);
  stroke-width: 1.8;
  stroke-linejoin: round;
}

.preset-adapter-root .preset-adapter-brand-eye {
  fill: var(--pa-heading);
  stroke: var(--pa-surface-raised);
  stroke-width: 1.2;
}

.preset-adapter-root .preset-adapter-tabs {
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  gap: 0;
  border: 0;
  padding: 0;
}

.preset-adapter-root .preset-adapter-tab {
  position: relative;
  display: grid;
  grid-template-columns: 1.25rem minmax(0, 1fr) auto;
  align-items: center;
  min-height: 4rem;
  border: 0;
  border-radius: 0;
  padding: 0.7rem 0.85rem;
  background: transparent;
  color: var(--pa-muted);
  text-align: left;
  cursor: pointer;
  gap: 0.65rem;
}

.preset-adapter-root .preset-adapter-tab:hover {
  background: var(--pa-overlay-subtle);
  color: var(--pa-text);
}

.preset-adapter-root .preset-adapter-tab-active {
  background: var(--pa-active-background);
  color: var(--pa-accent-text);
}

.preset-adapter-root .preset-adapter-tab-active::before {
  position: absolute;
  inset: 0 auto 0 0;
  width: 4px;
  border-radius: 0 3px 3px 0;
  background: var(--pa-coral);
  box-shadow: 0 0 14px var(--pa-accent-glow);
  content: '';
}

.preset-adapter-root .preset-adapter-tab-active > i {
  color: var(--pa-coral);
}

.preset-adapter-root .preset-adapter-tab > span {
  min-width: 0;
  border: 0;
  border-radius: 0;
  padding: 0;
  background: transparent;
  color: inherit;
  font-size: 0.86rem;
  line-height: 1.35;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preset-adapter-root .preset-adapter-tab em {
  min-width: 1.65rem;
  border: 1px solid var(--pa-border);
  border-radius: 999px;
  padding: 0.1rem 0.35rem;
  color: var(--pa-muted);
  font-size: 0.73rem;
  font-style: normal;
  text-align: center;
}

.preset-adapter-root .preset-adapter-workspace {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  padding: clamp(0.8rem, 1.6cqw, 1.25rem);
  gap: 0.72rem;
}

.preset-adapter-root .preset-adapter-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
}

.preset-adapter-root .preset-adapter-heading h3 {
  margin: 0;
  color: var(--pa-heading);
  font-size: clamp(1.45rem, 2cqw, 1.9rem);
  line-height: 1.08;
  letter-spacing: 0.035em;
}

.preset-adapter-root .preset-adapter-heading p {
  margin: 0.3rem 0 0;
  color: var(--pa-muted);
  font-size: 0.92rem;
}

.preset-adapter-root .preset-adapter-header-actions {
  display: flex;
  align-items: center;
  gap: 0.55rem;
}

.preset-adapter-root .preset-adapter-preset {
  display: inline-flex;
  align-items: center;
  min-height: 2.3rem;
  margin: 0;
  border: 1px solid var(--pa-coral);
  border-radius: 999px;
  padding: 0.28rem 0.9rem;
  color: var(--pa-coral);
  font-size: 0.86rem;
  white-space: nowrap;
}

.preset-adapter-root .preset-adapter-icon-button,
.preset-adapter-root .preset-adapter-more-menu > summary {
  display: inline-grid;
  place-items: center;
  width: 2.35rem;
  height: 2.35rem;
  border: 1px solid var(--pa-border);
  border-radius: var(--pa-control-radius);
  padding: 0;
  background: var(--pa-control-background);
  cursor: pointer;
  list-style: none;
}

.preset-adapter-root .preset-adapter-more-menu {
  position: relative;
}

.preset-adapter-root .preset-adapter-more-menu > summary::-webkit-details-marker {
  display: none;
}

.preset-adapter-root .preset-adapter-more-menu > div {
  position: absolute;
  top: calc(100% + 0.35rem);
  right: 0;
  z-index: 20;
  display: grid;
  width: 10rem;
  border: 1px solid var(--pa-border-strong);
  border-radius: var(--pa-card-radius);
  padding: 0.35rem;
  background: var(--pa-popover-background);
  box-shadow: 0 14px 30px var(--pa-shadow);
}

.preset-adapter-root .preset-adapter-more-menu button {
  border: 0;
  border-radius: 7px;
  padding: 0.55rem 0.7rem;
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.preset-adapter-root .preset-adapter-more-menu button:hover {
  background: var(--pa-coral-soft);
}

.preset-adapter-root .preset-adapter-preset-page {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.preset-adapter-root .preset-adapter-preset-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 2.3rem;
  gap: 0.8rem;
}

.preset-adapter-root .preset-adapter-preset-toolbar p {
  margin: 0;
  color: var(--pa-muted);
  font-size: 0.84rem;
}

.preset-adapter-root .preset-adapter-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 0.45rem;
}

.preset-adapter-root .preset-adapter-actions button,
.preset-adapter-root .preset-adapter-reasoner-format-check-action,
.preset-adapter-root .preset-adapter-summary-inline-actions button,
.preset-adapter-root .preset-adapter-summary-section .menu_button,
.preset-adapter-root .preset-adapter-debug-pane-header .menu_button {
  width: auto;
  min-height: 2.15rem;
  border: 1px solid var(--pa-border);
  border-radius: var(--pa-control-radius);
  padding: 0.28rem 0.65rem;
  background: var(--pa-control-background);
  color: var(--pa-text);
  cursor: pointer;
}

.preset-adapter-root .preset-adapter-actions button:hover,
.preset-adapter-root .preset-adapter-summary-inline-actions button:hover,
.preset-adapter-root .preset-adapter-summary-section .menu_button:hover {
  border-color: var(--pa-border-strong);
  background: var(--pa-control-hover-background);
}

.preset-adapter-root .preset-adapter-actions .preset-adapter-button-primary,
.preset-adapter-root .preset-adapter-button-primary {
  border-color: var(--pa-coral);
  background: var(--pa-coral-soft);
  color: var(--pa-accent-text);
}

.preset-adapter-root .preset-adapter-organizing-label {
  color: var(--pa-gold);
  font-size: 0.84rem;
}

.preset-adapter-root .preset-adapter-favorites,
.preset-adapter-root .preset-adapter-group,
.preset-adapter-root .preset-adapter-summary-section,
.preset-adapter-root .preset-adapter-debug-records,
.preset-adapter-root .preset-adapter-debug-section {
  border: 1px solid var(--pa-border);
  border-radius: var(--pa-card-radius);
  background: var(--pa-card-background);
  box-shadow: inset 0 1px 0 var(--pa-overlay-faint);
}

.preset-adapter-root .preset-adapter-favorites {
  padding: 0.55rem;
}

.preset-adapter-root .preset-adapter-favorites > header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.preset-adapter-root .preset-adapter-section-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex: 1;
  border: 0;
  padding: 0;
  background: transparent;
  cursor: pointer;
}

.preset-adapter-root .preset-adapter-section-heading > span {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}

.preset-adapter-root .preset-adapter-section-heading .fa-star,
.preset-adapter-root .preset-adapter-star-button-active {
  color: var(--pa-gold);
}

.preset-adapter-root .preset-adapter-section-heading small {
  color: var(--pa-muted);
  font-weight: 400;
}

.preset-adapter-root .preset-adapter-text-button {
  border: 0;
  padding: 0.25rem 0.45rem;
  background: transparent;
  color: var(--pa-muted);
  font-size: 0.78rem;
  cursor: pointer;
}

.preset-adapter-root .preset-adapter-favorite-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(15rem, 100%), 1fr));
  gap: 0.45rem;
  margin-top: 0.5rem;
}

.preset-adapter-root .preset-adapter-favorite-card {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  min-height: 3.55rem;
  overflow: hidden;
  border: 1px solid var(--pa-border);
  border-radius: var(--pa-card-radius);
  background: var(--pa-surface-raised);
  gap: 0.25rem;
}

.preset-adapter-root .preset-adapter-favorite-card.preset-adapter-option-active {
  border-color: color-mix(in srgb, var(--pa-coral) 58%, transparent);
  background: linear-gradient(90deg, var(--pa-coral-soft), var(--pa-surface-raised));
  box-shadow: inset 4px 0 0 var(--pa-coral);
}

.preset-adapter-root .preset-adapter-favorite-action {
  grid-column: 2;
  display: flex;
  align-items: center;
  width: 100%;
  min-width: 0;
  min-height: 3.4rem;
  border: 0;
  padding: 0.45rem 0.55rem;
  background: transparent;
  text-align: left;
  cursor: pointer;
  gap: 0.65rem;
}

.preset-adapter-root .preset-adapter-favorite-action > span {
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: 0.18rem;
}

.preset-adapter-root .preset-adapter-favorite-action strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preset-adapter-root .preset-adapter-favorite-action small {
  color: var(--pa-muted);
}

.preset-adapter-root .preset-adapter-favorite-empty {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 3.1rem;
  border: 1px dashed var(--pa-border);
  border-radius: 9px;
  color: var(--pa-muted);
  gap: 0.5rem;
}

.preset-adapter-root .preset-adapter-star-button,
.preset-adapter-root .preset-adapter-drag-handle {
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  width: 2.3rem;
  height: 2.3rem;
  border: 1px solid var(--pa-border);
  border-radius: var(--pa-control-radius);
  padding: 0;
  background: var(--pa-overlay-faint);
  color: var(--pa-muted);
  cursor: pointer;
  transition:
    border-color 150ms ease,
    background-color 150ms ease,
    color 150ms ease,
    box-shadow 150ms ease;
}

.preset-adapter-root .preset-adapter-drag-handle {
  grid-column: 1;
  margin-left: 0.45rem;
  color: var(--pa-gold);
  cursor: grab;
  touch-action: none;
}

.preset-adapter-root .preset-adapter-favorite-card > .preset-adapter-star-button {
  grid-column: 3;
  margin-right: 0.45rem;
  border-color: color-mix(in srgb, var(--pa-gold) 48%, transparent);
  background: color-mix(in srgb, var(--pa-gold) 12%, transparent);
  color: var(--pa-highlight-text);
}

.preset-adapter-root .preset-adapter-reordering {
  border-color: var(--pa-gold) !important;
  opacity: 0.72;
  transform: scale(0.992);
}

.preset-adapter-root .preset-adapter-group-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  grid-auto-flow: row dense;
  align-items: start;
  gap: 0.5rem;
}

.preset-adapter-root .preset-adapter-group {
  grid-column: span 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-top: 1px solid var(--pa-border);
  padding: 0;
  gap: 0;
  transition:
    border-color 150ms ease,
    transform 150ms ease;
}

.preset-adapter-root .preset-adapter-group:first-child {
  grid-column: 1 / -1;
}

.preset-adapter-root .preset-adapter-group-header {
  display: flex;
  align-items: stretch;
  min-height: 2.55rem;
  padding: 0;
  gap: 0.35rem;
}

.preset-adapter-root .preset-adapter-group-toggle {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: center;
  flex: 1;
  min-width: 0;
  border: 0;
  padding: 0.38rem 0.55rem;
  background: transparent;
  text-align: left;
  cursor: pointer;
  gap: 0.55rem;
}

.preset-adapter-root .preset-adapter-group-title {
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: 0.15rem;
}

.preset-adapter-root .preset-adapter-group-title strong {
  color: var(--pa-heading);
  font-size: 0.88rem;
}

.preset-adapter-root .preset-adapter-group-title small {
  overflow: hidden;
  color: var(--pa-muted);
  font-size: 0.76rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preset-adapter-root .preset-adapter-group-summary {
  color: var(--pa-muted);
  font-size: 0.78rem;
  white-space: nowrap;
}

.preset-adapter-root .preset-adapter-group-body {
  display: grid;
  gap: 0.4rem;
  border-top: 1px solid var(--pa-border);
  padding: 0.45rem;
}

.preset-adapter-root .preset-adapter-options {
  gap: 0.38rem;
}

.preset-adapter-root .preset-adapter-options-grid {
  grid-template-columns: repeat(auto-fit, minmax(min(12rem, 100%), 1fr));
}

.preset-adapter-root .preset-adapter-option {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: stretch;
  min-height: 2.45rem;
  overflow: hidden;
  border: 1px solid var(--pa-border);
  border-radius: var(--pa-control-radius);
  padding: 0;
  background: var(--pa-surface-soft);
  transition:
    border-color 150ms ease,
    background-color 150ms ease,
    box-shadow 150ms ease;
}

.preset-adapter-root .preset-adapter-option:hover {
  border-color: var(--pa-border-strong);
  background: var(--pa-surface-raised);
}

.preset-adapter-root .preset-adapter-option-favorite:not(.preset-adapter-option-active) {
  border-color: var(--pa-highlight-border);
  background: linear-gradient(90deg, color-mix(in srgb, var(--pa-gold) 7%, transparent), var(--pa-surface-soft) 45%);
}

.preset-adapter-root .preset-adapter-option-action {
  min-width: 0;
  min-height: 2.4rem;
  border: 0;
  padding: 0.32rem 0.48rem;
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.preset-adapter-floating-window .preset-adapter-root .preset-adapter-option-title small {
  color: var(--pa-description-text) !important;
  opacity: 1;
  -webkit-text-fill-color: var(--pa-description-text);
}

.preset-adapter-root .preset-adapter-option .preset-adapter-star-button {
  align-self: center;
  width: 1.75rem;
  height: 1.75rem;
  margin-right: 0.25rem;
  border-color: transparent;
  background: transparent;
}

.preset-adapter-root .preset-adapter-option .preset-adapter-star-button-active {
  border-color: color-mix(in srgb, var(--pa-gold) 52%, transparent);
  background: color-mix(in srgb, var(--pa-gold) 14%, transparent);
  color: var(--pa-highlight-text);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--pa-gold) 8%, transparent);
}

.preset-adapter-root .preset-adapter-option-active:not(.preset-adapter-option-export-mode) {
  border-color: color-mix(in srgb, var(--pa-coral) 66%, transparent);
  background: linear-gradient(90deg, var(--pa-coral-soft), var(--pa-surface-soft));
  box-shadow: inset 4px 0 0 var(--pa-coral);
}

.preset-adapter-root .preset-adapter-option-active .preset-adapter-option-main i,
.preset-adapter-root .preset-adapter-option-active .preset-adapter-option-title > span {
  color: var(--pa-accent-text);
}

.preset-adapter-root .preset-adapter-option-main {
  align-items: center;
}

.preset-adapter-root .preset-adapter-variable-input {
  border-color: var(--pa-border);
  background: var(--pa-surface-soft);
}

.preset-adapter-floating-window .preset-adapter-root .preset-adapter-variable-input-label small {
  color: var(--pa-description-text) !important;
  opacity: 1;
  -webkit-text-fill-color: var(--pa-description-text);
}

.preset-adapter-root .preset-adapter-variable-input-control,
.preset-adapter-root .preset-adapter-summary-settings select {
  min-height: 2.45rem;
  border: 1px solid var(--pa-border);
  border-radius: 8px;
  padding: 0.4rem 0.65rem;
  background: var(--pa-ink-soft);
  color: var(--pa-text);
}

.preset-adapter-floating-window .preset-adapter-root .preset-adapter-variable-input-control {
  border-color: var(--pa-border) !important;
  background: var(--pa-ink-soft) !important;
  box-shadow: none !important;
  color: var(--pa-text) !important;
  opacity: 1;
  -webkit-text-fill-color: var(--pa-text);
}

.preset-adapter-floating-window .preset-adapter-root .preset-adapter-variable-input-control::placeholder {
  color: var(--pa-muted) !important;
  opacity: 1;
  -webkit-text-fill-color: var(--pa-muted);
}

.preset-adapter-floating-window .preset-adapter-root .preset-adapter-variable-input-control:disabled {
  background: color-mix(in srgb, var(--pa-surface-soft) 72%, var(--pa-ink-soft)) !important;
  color: var(--pa-muted) !important;
  opacity: 1 !important;
  -webkit-text-fill-color: var(--pa-muted);
}

.preset-adapter-root .preset-adapter-errors {
  border-color: color-mix(in srgb, var(--pa-danger) 55%, transparent);
  background: color-mix(in srgb, var(--pa-danger) 9%, transparent);
}

.preset-adapter-root .preset-adapter-empty {
  border-color: var(--pa-border);
  color: var(--pa-muted);
}

.preset-adapter-root .preset-adapter-summary {
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  min-height: 100%;
  gap: 0.62rem;
}

.preset-adapter-root .preset-adapter-summary-metrics {
  display: grid;
  flex: 0 0 auto;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.55rem;
}

.preset-adapter-root .preset-adapter-summary-dashboard {
  flex: 0 0 auto;
}

.preset-adapter-root .preset-adapter-summary-metrics article {
  display: flex;
  align-items: center;
  min-height: 4.25rem;
  border: 1px solid var(--pa-border);
  border-radius: 11px;
  padding: 0.58rem 0.75rem;
  background: linear-gradient(135deg, var(--pa-overlay-subtle), transparent), var(--pa-surface);
  gap: 0.62rem;
}

.preset-adapter-root .preset-adapter-summary-metrics article > i {
  color: var(--pa-gold);
  font-size: 1.3rem;
}

.preset-adapter-root .preset-adapter-summary-metrics article > span {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.preset-adapter-root .preset-adapter-summary-metrics small {
  color: var(--pa-muted);
}

.preset-adapter-root .preset-adapter-summary-metrics strong {
  font-size: 1.3rem;
  font-weight: 500;
}

.preset-adapter-root .preset-adapter-summary-metrics em {
  margin-left: 0.35rem;
  color: var(--pa-muted);
  font-size: 0.8rem;
  font-style: normal;
}

.preset-adapter-root .preset-adapter-summary-dashboard {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  align-items: stretch;
  gap: 0.55rem;
}

.preset-adapter-root .preset-adapter-summary-section {
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--pa-border);
  border-radius: 11px;
  padding: 0.65rem;
  background: linear-gradient(135deg, var(--pa-overlay-faint), transparent), var(--pa-surface);
}

.preset-adapter-root .preset-adapter-summary-settings {
  display: flex;
  flex-direction: column;
  grid-column: 1 / -1;
  gap: 0.65rem;
}

.preset-adapter-root .preset-adapter-summary-workspace-card {
  display: flex;
  flex-direction: column;
  grid-column: 1 / -1;
  height: clamp(31rem, 55cqw, 38rem);
  min-width: 0;
  overflow: hidden;
  padding: 0;
}

.preset-adapter-root .preset-adapter-summary-workspace-header {
  flex: 0 0 auto;
  border-bottom: 1px solid var(--pa-border);
  padding: 0.7rem 0.8rem;
}

.preset-adapter-root .preset-adapter-summary-workspace-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.8rem;
}

.preset-adapter-root .preset-adapter-summary-workspace-body {
  display: grid;
  flex: 1;
  grid-template-columns: minmax(22rem, 0.82fr) minmax(0, 1.35fr);
  grid-template-rows: auto minmax(0, 1fr);
  min-height: 0;
  overflow: hidden;
  background: var(--pa-ink-soft);
}

.preset-adapter-root .preset-adapter-summary-floor-pane,
.preset-adapter-root .preset-adapter-summary-detail-pane {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.preset-adapter-root .preset-adapter-summary-floor-pane {
  grid-column: 1;
  grid-row: 2;
  border-right: 1px solid var(--pa-border);
}

.preset-adapter-root .preset-adapter-summary-detail-pane {
  grid-column: 2;
  grid-row: 1 / 3;
}

.preset-adapter-root .preset-adapter-summary-floor-filters {
  display: flex;
  align-items: center;
  flex: 0 0 auto;
  grid-column: 1;
  grid-row: 1;
  height: 3.15rem;
  min-height: 3.15rem;
  max-height: 3.15rem;
  box-sizing: border-box;
  border-right: 1px solid var(--pa-border);
  border-bottom: 1px solid var(--pa-border);
  padding: 0.42rem;
  gap: 0.3rem;
}

.preset-adapter-root .preset-adapter-summary-floor-filters button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 2.25rem;
  border: 1px solid transparent;
  border-radius: 7px;
  padding: 0.35rem 0.6rem;
  background: transparent;
  color: var(--pa-muted);
  cursor: pointer;
  gap: 0.42rem;
}

.preset-adapter-root .preset-adapter-summary-floor-filters button:hover {
  border-color: var(--pa-border);
  background: var(--pa-overlay-subtle);
  color: var(--pa-text);
}

.preset-adapter-root .preset-adapter-summary-floor-filters .preset-adapter-summary-floor-filter-active {
  border-color: color-mix(in srgb, var(--pa-gold) 48%, transparent);
  background: color-mix(in srgb, var(--pa-gold) 8%, transparent);
  color: var(--pa-heading);
}

.preset-adapter-root .preset-adapter-summary-floor-filters button > span {
  color: var(--pa-gold);
  font-size: 0.72rem;
}

.preset-adapter-root .preset-adapter-summary-floor-pane > .preset-adapter-empty,
.preset-adapter-root .preset-adapter-summary-detail-pane > .preset-adapter-empty {
  display: grid;
  flex: 1;
  place-items: center;
  margin: 0.6rem;
}

.preset-adapter-root .preset-adapter-summary-floor-table-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
  scrollbar-gutter: stable;
}

.preset-adapter-root .preset-adapter-summary-floor-table {
  width: 100%;
  table-layout: fixed;
  overflow: visible;
  border: 0;
  border-radius: 0;
  font-size: 0.78rem;
}

.preset-adapter-root .preset-adapter-summary-floor-table thead {
  position: sticky;
  z-index: 2;
  top: 0;
}

.preset-adapter-root .preset-adapter-summary-floor-table th {
  background: var(--pa-ink-soft);
  color: var(--pa-muted);
  white-space: nowrap;
}

.preset-adapter-root .preset-adapter-summary-floor-table th:nth-child(1) {
  width: 27%;
}

.preset-adapter-root .preset-adapter-summary-floor-table th:nth-child(2) {
  width: 25%;
}

.preset-adapter-root .preset-adapter-summary-floor-table th:nth-child(3) {
  width: 18%;
}

.preset-adapter-root .preset-adapter-summary-floor-table th:nth-child(4) {
  width: 30%;
}

.preset-adapter-root .preset-adapter-summary-floor-table th,
.preset-adapter-root .preset-adapter-summary-floor-table td {
  padding: 0.48rem 0.52rem;
  vertical-align: middle;
}

.preset-adapter-root .preset-adapter-summary-floor-table tbody tr {
  cursor: pointer;
  outline: none;
  transition:
    background-color 140ms ease,
    box-shadow 140ms ease;
}

.preset-adapter-root .preset-adapter-summary-floor-table tbody tr:hover,
.preset-adapter-root .preset-adapter-summary-floor-table tbody tr:focus-visible {
  background: var(--pa-overlay-faint);
}

.preset-adapter-root .preset-adapter-summary-floor-table tbody tr:focus-visible {
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--pa-gold) 58%, transparent);
}

.preset-adapter-root .preset-adapter-summary-floor-table .preset-adapter-summary-floor-row-summary {
  background: linear-gradient(90deg, color-mix(in srgb, var(--pa-coral) 7%, transparent), transparent 65%);
}

.preset-adapter-root .preset-adapter-summary-floor-table .preset-adapter-summary-floor-row-selected {
  background: linear-gradient(90deg, color-mix(in srgb, var(--pa-coral) 17%, transparent), color-mix(in srgb, var(--pa-coral) 4%, transparent));
  box-shadow: inset 3px 0 0 var(--pa-coral);
}

.preset-adapter-root .preset-adapter-summary-floor-table .preset-adapter-summary-floor-row-missing {
  opacity: 0.68;
}

.preset-adapter-root .preset-adapter-summary-floor-label {
  display: inline-flex;
  align-items: center;
  min-width: 0;
  gap: 0.38rem;
}

.preset-adapter-root .preset-adapter-summary-floor-label-bookmarked {
  color: var(--pa-accent-text);
}

.preset-adapter-root .preset-adapter-summary-floor-label span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preset-adapter-root .preset-adapter-summary-floor-actions,
.preset-adapter-root .preset-adapter-summary-detail-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.28rem;
}

.preset-adapter-root .preset-adapter-summary-floor-actions .menu_button {
  min-height: 1.85rem;
  padding: 0.18rem 0.48rem;
  font-size: 0.72rem;
}

.preset-adapter-root .preset-adapter-summary-floor-bookmark,
.preset-adapter-root .preset-adapter-summary-detail-bookmark,
.preset-adapter-root .preset-adapter-summary-detail-actions > button:not(.menu_button) {
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  width: 2rem;
  height: 2rem;
  border: 1px solid var(--pa-border);
  border-radius: 7px;
  padding: 0;
  background: var(--pa-overlay-subtle);
  color: var(--pa-muted);
  cursor: pointer;
}

.preset-adapter-root .preset-adapter-summary-floor-bookmark,
.preset-adapter-root .preset-adapter-summary-detail-bookmark-active {
  border-color: color-mix(in srgb, var(--pa-coral) 38%, transparent);
  background: color-mix(in srgb, var(--pa-coral) 9%, transparent);
  color: var(--pa-accent-text);
}

.preset-adapter-root .preset-adapter-summary-floor-bookmark:hover,
.preset-adapter-root .preset-adapter-summary-detail-bookmark:hover {
  border-color: color-mix(in srgb, var(--pa-gold) 62%, transparent);
  background: color-mix(in srgb, var(--pa-gold) 12%, transparent);
  color: var(--pa-gold);
}

.preset-adapter-root .preset-adapter-summary-floor-total {
  display: grid;
  align-items: center;
  flex: 0 0 auto;
  grid-template-columns: 0.65fr 1fr auto;
  min-height: 2.65rem;
  border-top: 1px solid var(--pa-border);
  padding: 0.42rem 0.55rem;
  background: var(--pa-ink);
  color: var(--pa-muted);
  font-size: 0.78rem;
  gap: 0.5rem;
}

.preset-adapter-root .preset-adapter-summary-floor-total strong,
.preset-adapter-root .preset-adapter-summary-floor-total b {
  color: var(--pa-heading);
}

.preset-adapter-root .preset-adapter-summary-floor-total b {
  font-weight: 600;
  white-space: nowrap;
}

.preset-adapter-root .preset-adapter-summary-filter-control {
  display: inline-flex;
  align-items: center;
  flex: 0 0 auto;
  gap: 0.4rem;
  color: var(--pa-muted);
  font-size: 0.78rem;
  cursor: pointer;
}

.preset-adapter-root .preset-adapter-summary-filter-control code {
  color: var(--pa-gold);
}

.preset-adapter-root .preset-adapter-summary-viewer {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.preset-adapter-root .preset-adapter-summary-viewer > header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex: 0 0 3.15rem;
  height: 3.15rem;
  min-height: 3.15rem;
  max-height: 3.15rem;
  box-sizing: border-box;
  border-bottom: 1px solid var(--pa-border);
  padding: 0.55rem 0.7rem;
  color: var(--pa-heading);
  gap: 0.7rem;
}

.preset-adapter-root .preset-adapter-summary-viewer > header > div:first-child {
  display: flex;
  align-items: center;
  min-width: 0;
  gap: 0.55rem;
}

.preset-adapter-root .preset-adapter-summary-viewer > header small {
  color: var(--pa-muted);
  font-weight: 400;
}

.preset-adapter-root .preset-adapter-summary-detail-actions .menu_button {
  min-height: 2rem;
  padding: 0.2rem 0.55rem;
}

.preset-adapter-root .preset-adapter-summary-detail-actions > button:disabled {
  cursor: not-allowed;
  opacity: 0.38;
}

.preset-adapter-root .preset-adapter-summary-detail-divider {
  width: 1px;
  height: 1.4rem;
  margin-inline: 0.1rem;
  background: var(--pa-border);
}

.preset-adapter-root .preset-adapter-summary-viewer .preset-adapter-summary-content {
  flex: 1;
  min-height: 0;
  max-height: none;
  overflow: auto;
  border-top: 0;
  padding: 0.75rem 0.85rem;
}

.preset-adapter-root .preset-adapter-summary-rendered {
  line-height: 1.55;
  overflow-wrap: anywhere;
}

.preset-adapter-root .preset-adapter-summary-rendered-empty {
  display: none;
}

.preset-adapter-root .preset-adapter-summary-range-content {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.preset-adapter-root .preset-adapter-summary-range-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex: 0 0 auto;
  border-bottom: 1px solid var(--pa-border);
  padding: 0.55rem 0.7rem;
  background: var(--pa-overlay-faint);
  gap: 0.65rem;
}

.preset-adapter-root .preset-adapter-summary-range-toolbar p {
  margin: 0;
  color: var(--pa-muted);
  font-size: 0.76rem;
}

.preset-adapter-root .preset-adapter-summary-range-toolbar > div {
  display: flex;
  flex: 0 0 auto;
  gap: 0.35rem;
}

.preset-adapter-root .preset-adapter-summary-range-toolbar .menu_button {
  min-height: 1.9rem;
  padding: 0.18rem 0.5rem;
  font-size: 0.72rem;
}

.preset-adapter-root .preset-adapter-summary-range-list {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 0.48rem;
  scrollbar-gutter: stable;
}

.preset-adapter-root .preset-adapter-summary-range-row {
  display: grid;
  grid-template-columns: minmax(7rem, 1fr) auto auto auto;
  align-items: center;
  min-height: 3rem;
  border: 1px solid transparent;
  border-bottom-color: var(--pa-border);
  padding: 0.42rem 0.5rem;
  gap: 0.6rem;
}

.preset-adapter-root .preset-adapter-summary-range-row:hover {
  border-color: var(--pa-overlay-hover);
  border-radius: 7px;
  background: var(--pa-overlay-faint);
}

.preset-adapter-root .preset-adapter-summary-range-floor {
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: 0.08rem;
}

.preset-adapter-root .preset-adapter-summary-range-floor strong {
  overflow: hidden;
  color: var(--pa-heading);
  font-size: 0.78rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preset-adapter-root .preset-adapter-summary-range-floor small,
.preset-adapter-root .preset-adapter-summary-range-token {
  color: var(--pa-muted);
  font-size: 0.7rem;
}

.preset-adapter-root .preset-adapter-summary-range-token {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.preset-adapter-root .preset-adapter-summary-range-state {
  min-width: 3rem;
  border: 1px solid color-mix(in srgb, var(--pa-teal) 24%, transparent);
  border-radius: 999px;
  padding: 0.18rem 0.42rem;
  background: color-mix(in srgb, var(--pa-teal) 8%, transparent);
  color: var(--pa-teal);
  font-size: 0.68rem;
  text-align: center;
}

.preset-adapter-root .preset-adapter-summary-range-state-hidden {
  border-color: color-mix(in srgb, var(--pa-coral) 28%, transparent);
  background: color-mix(in srgb, var(--pa-coral) 8%, transparent);
  color: var(--pa-accent-text);
}

.preset-adapter-root .preset-adapter-summary-range-row > .menu_button {
  min-height: 1.85rem;
  padding: 0.18rem 0.48rem;
  font-size: 0.7rem;
  white-space: nowrap;
}

.preset-adapter-root .preset-adapter-summary-section-heading h4,
.preset-adapter-root .preset-adapter-summary-mode-block h4 {
  margin: 0;
}

.preset-adapter-root .preset-adapter-summary-section-heading {
  min-width: 0;
}

.preset-adapter-root .preset-adapter-summary-settings-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  align-items: stretch;
  margin: 0;
  gap: 0.55rem;
}

.preset-adapter-root .preset-adapter-summary-settings > summary {
  grid-column: 1 / -1;
}

.preset-adapter-root .preset-adapter-summary-setting-block,
.preset-adapter-root .preset-adapter-summary-mode-block,
.preset-adapter-root .preset-adapter-summary-standalone-option,
.preset-adapter-root .preset-adapter-summary-subsettings {
  border-color: var(--pa-border);
  background: var(--pa-surface-soft);
}

.preset-adapter-root .preset-adapter-summary-setting-block {
  grid-column: 1;
}

.preset-adapter-root .preset-adapter-summary-mode-block {
  display: flex;
  flex-direction: column;
  grid-column: 2;
  min-width: 0;
  border: 1px solid var(--pa-border);
  border-radius: 8px;
  padding: 0.65rem;
  gap: 0.65rem;
}

.preset-adapter-root .preset-adapter-summary-mode-block .preset-adapter-summary-standalone-option {
  flex: 1;
  margin: 0;
}

.preset-adapter-root .preset-adapter-summary-manual-option {
  margin-top: auto;
}

.preset-adapter-root .preset-adapter-summary-mode-description {
  flex: 1;
  margin: 0;
  border: 1px solid color-mix(in srgb, var(--pa-gold) 22%, transparent);
  border-radius: 8px;
  padding: 0.65rem;
  background: color-mix(in srgb, var(--pa-gold) 7%, transparent);
  color: var(--pa-muted);
  font-size: 0.76rem;
  line-height: 1.55;
}

.preset-adapter-root .preset-adapter-summary-subsettings {
  grid-column: 1 / -1;
  border: 1px solid var(--pa-border);
  border-radius: 8px;
  padding: 0.65rem;
}

.preset-adapter-root .preset-adapter-summary-subsettings-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-width: 0;
  gap: 0.65rem;
}

.preset-adapter-root .preset-adapter-summary-subsettings-header h4 {
  margin: 0;
}

.preset-adapter-root .preset-adapter-summary-subsettings-header .preset-adapter-text-button {
  flex: 0 0 auto;
}

.preset-adapter-root .preset-adapter-summary-hide-layout {
  display: grid;
  grid-template-columns: minmax(14rem, 1fr) minmax(9.75rem, 0.62fr);
  align-items: stretch;
  gap: 0.65rem;
}

.preset-adapter-root .preset-adapter-summary-hide-controls {
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: 0.55rem;
}

.preset-adapter-root .preset-adapter-summary-scope-option {
  display: flex;
  align-items: flex-start;
  border-bottom: 1px solid var(--pa-border);
  padding: 0.2rem 0 0.55rem;
  gap: 0.45rem;
}

.preset-adapter-root .preset-adapter-summary-scope-option > input {
  flex: 0 0 auto;
  margin-top: 0.2rem;
}

.preset-adapter-root .preset-adapter-summary-scope-option > span {
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: 0.08rem;
}

.preset-adapter-root .preset-adapter-summary-scope-option small {
  color: var(--pa-muted);
  font-size: 0.68rem;
  font-weight: 400;
  line-height: 1.4;
}

.preset-adapter-root .preset-adapter-summary-hide-controls .preset-adapter-summary-checkbox-grid {
  display: flex;
  flex-direction: column;
  gap: 0.42rem;
}

.preset-adapter-root .preset-adapter-summary-keep-latest-option {
  display: flex;
  align-items: center;
  min-width: 0;
  gap: 0.4rem;
}

.preset-adapter-root .preset-adapter-summary-keep-latest-option label {
  display: inline-flex;
  align-items: center;
  min-width: 0;
  gap: 0.45rem;
}

.preset-adapter-root .preset-adapter-summary-keep-latest-option > input {
  width: 4.25rem;
  min-height: 1.95rem;
  border: 1px solid var(--pa-border);
  border-radius: 7px;
  padding: 0.25rem 0.4rem;
  background: var(--pa-ink-soft);
  color: var(--pa-text);
  text-align: center;
}

.preset-adapter-root .preset-adapter-summary-hide-preview {
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--pa-border);
  border-radius: 8px;
  background: var(--pa-ink-soft);
}

.preset-adapter-root .preset-adapter-summary-hide-preview table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  font-size: 0.72rem;
}

.preset-adapter-root .preset-adapter-summary-hide-preview th,
.preset-adapter-root .preset-adapter-summary-hide-preview td {
  border-bottom: 1px solid var(--pa-border);
  padding: 0.48rem 0.52rem;
  text-align: left;
  white-space: nowrap;
}

.preset-adapter-root .preset-adapter-summary-hide-preview th {
  width: 52%;
  color: var(--pa-muted);
  font-weight: 500;
}

.preset-adapter-root .preset-adapter-summary-hide-preview td {
  color: var(--pa-text);
  font-variant-numeric: tabular-nums;
  font-weight: 700;
}

.preset-adapter-root .preset-adapter-summary-hide-preview tr:last-child > * {
  border-bottom: 0;
}

.preset-adapter-root .preset-adapter-summary-hide-preview p {
  margin: auto 0 0;
  border-top: 1px solid color-mix(in srgb, var(--pa-gold) 22%, transparent);
  padding: 0.45rem 0.52rem;
  background: color-mix(in srgb, var(--pa-gold) 7%, transparent);
  color: var(--pa-gold);
  font-size: 0.68rem;
  line-height: 1.35;
}

.preset-adapter-root .preset-adapter-summary-subsettings-body > .preset-adapter-actions {
  justify-content: flex-end;
}

.preset-adapter-root .preset-adapter-summary-strategy-footer {
  display: flex;
  justify-content: flex-end;
  border-top: 1px solid var(--pa-border);
  padding-top: 0.55rem;
  gap: 0.55rem;
}

.preset-adapter-root .preset-adapter-summary-regenerate {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: min(11rem, 100%);
  min-height: 2.8rem;
  border: 1px solid var(--pa-border-strong);
  border-radius: 10px;
  padding: 0.55rem 1rem;
  background: var(--pa-surface-raised);
  color: var(--pa-text);
  font-weight: 700;
  cursor: pointer;
  gap: 0.5rem;
}

.preset-adapter-root .preset-adapter-summary-start {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: min(15rem, 100%);
  min-height: 2.8rem;
  border: 1px solid var(--pa-primary-button-border);
  border-radius: 10px;
  padding: 0.55rem 1.25rem;
  background: var(--pa-primary-button-background);
  box-shadow: 0 8px 22px var(--pa-primary-button-shadow);
  color: var(--pa-primary-button-text);
  font-weight: 700;
  cursor: pointer;
  gap: 0.55rem;
}

.preset-adapter-root .preset-adapter-summary-strategy-footer .preset-adapter-summary-start,
.preset-adapter-root .preset-adapter-summary-strategy-footer .preset-adapter-summary-regenerate {
  margin-bottom: 0;
}

.preset-adapter-root .preset-adapter-summary-table {
  border-color: var(--pa-border);
}

.preset-adapter-root .preset-adapter-summary-table th,
.preset-adapter-root .preset-adapter-summary-table td {
  border-color: var(--pa-border);
}

.preset-adapter-root .preset-adapter-debug {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.preset-adapter-root .preset-adapter-debug-layout {
  flex: 1 1 auto;
  grid-template-columns: minmax(15.5rem, 0.32fr) minmax(0, 1fr);
  height: auto;
  min-height: 0;
  gap: 0.65rem;
}

.preset-adapter-root .preset-adapter-debug-mobile-switch {
  display: none;
}

.preset-adapter-root .preset-adapter-debug-records {
  padding: 0.6rem;
}

.preset-adapter-root .preset-adapter-debug-record {
  border-color: var(--pa-border);
  border-radius: 9px;
  background: var(--pa-surface-soft);
  padding: 0.45rem 0.5rem;
}

.preset-adapter-root .preset-adapter-debug-record-active {
  border-color: var(--pa-coral);
  background: linear-gradient(90deg, var(--pa-coral-soft), var(--pa-surface-soft));
  box-shadow: inset 3px 0 0 var(--pa-coral);
}

.preset-adapter-root .preset-adapter-debug-detail {
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(14rem, 1fr);
  grid-template-rows: auto auto minmax(0, 1fr) minmax(8rem, 0.78fr);
  align-content: stretch;
  min-width: 0;
  overflow: hidden;
  padding: 0 0.3rem 0 0;
  gap: 0.55rem;
}

.preset-adapter-root .preset-adapter-debug-detail > .preset-adapter-debug-pane-header,
.preset-adapter-root .preset-adapter-debug-detail > .preset-adapter-debug-metrics {
  grid-column: 1 / -1;
}

.preset-adapter-root .preset-adapter-debug-detail > .preset-adapter-debug-section:nth-of-type(1) {
  grid-column: 1;
  grid-row: 3 / span 2;
  overflow: auto;
}

.preset-adapter-root .preset-adapter-debug-detail > .preset-adapter-debug-section:nth-of-type(2) {
  grid-column: 2;
  grid-row: 3;
  overflow: auto;
}

.preset-adapter-root .preset-adapter-debug-detail > .preset-adapter-debug-section:nth-of-type(3) {
  grid-column: 2;
  grid-row: 4;
  overflow: hidden;
}

.preset-adapter-root .preset-adapter-debug-metrics {
  display: grid;
  grid-template-columns: repeat(7, minmax(4.3rem, 1fr));
  min-height: 2.15rem;
  overflow-x: auto;
  gap: 0.45rem;
}

.preset-adapter-root .preset-adapter-debug-metrics span {
  display: inline-flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  min-height: 2.15rem;
  border-color: color-mix(in srgb, var(--pa-teal) 28%, transparent);
  border-radius: 9px;
  background: color-mix(in srgb, var(--pa-teal) 8%, transparent);
  color: var(--pa-teal);
  font-size: 0.78rem;
  text-align: center;
}

.preset-adapter-root .preset-adapter-debug-section {
  border-top: 1px solid var(--pa-border);
  padding: 0.6rem;
}

.preset-adapter-root .preset-adapter-debug-row {
  border-color: var(--pa-border);
  background: var(--pa-surface-soft);
}

.preset-adapter-root .preset-adapter-debug-error-text {
  flex: 1;
  min-height: 8rem;
  border-color: color-mix(in srgb, var(--pa-teal) 28%, transparent);
  background: color-mix(in srgb, var(--pa-teal) 7%, transparent);
  color: var(--pa-teal);
}

@container (max-width: 980px) {
  .preset-adapter-root .preset-adapter-summary-dashboard {
    grid-template-columns: 1fr;
  }

  .preset-adapter-root .preset-adapter-summary-dashboard > * {
    grid-column: 1;
    grid-row: auto;
  }

  .preset-adapter-root .preset-adapter-summary-settings-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .preset-adapter-root .preset-adapter-summary-setting-block {
    grid-column: 1;
  }

  .preset-adapter-root .preset-adapter-summary-mode-block {
    grid-column: 2;
  }

  .preset-adapter-root .preset-adapter-summary-subsettings {
    grid-column: 1 / -1;
  }

  .preset-adapter-root .preset-adapter-summary-workspace-body {
    grid-template-columns: minmax(19rem, 0.9fr) minmax(0, 1.1fr);
  }

  .preset-adapter-root .preset-adapter-summary-workspace-actions {
    flex-wrap: wrap;
  }
}

@container (max-width: 760px) {
  .preset-adapter-root.preset-adapter-root {
    display: flex;
    flex-direction: column;
  }

  .preset-adapter-root .preset-adapter-sidebar {
    position: sticky;
    bottom: 0;
    z-index: 30;
    order: 2;
    min-height: 3.9rem;
    border-top: 1px solid var(--pa-border-strong);
    border-right: 0;
  }

  .preset-adapter-root .preset-adapter-brand,
  .preset-adapter-root .preset-adapter-sidebar-actions {
    display: none;
  }

  .preset-adapter-root .preset-adapter-tabs {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .preset-adapter-root .preset-adapter-tab {
    display: flex;
    flex-direction: column;
    justify-content: center;
    min-height: 3.9rem;
    padding: 0.35rem;
    font-size: 0.72rem;
    text-align: center;
    gap: 0.18rem;
  }

  .preset-adapter-root .preset-adapter-tab em {
    position: absolute;
    top: 0.25rem;
    right: calc(50% - 1.7rem);
    min-width: 1.2rem;
    padding: 0.02rem 0.2rem;
    font-size: 0.62rem;
  }

  .preset-adapter-root .preset-adapter-tab-active::before {
    inset: auto 20% 0;
    width: auto;
    height: 3px;
  }

  .preset-adapter-root .preset-adapter-workspace {
    order: 1;
    padding: 0.65rem;
    gap: 0.55rem;
  }

  .preset-adapter-root .preset-adapter-header {
    align-items: center;
  }

  .preset-adapter-root .preset-adapter-heading h3 {
    font-size: 1.32rem;
  }

  .preset-adapter-root .preset-adapter-heading p,
  .preset-adapter-root .preset-adapter-preset {
    display: none;
  }

  .preset-adapter-root .preset-adapter-preset-toolbar {
    align-items: flex-start;
    flex-direction: column;
    gap: 0.4rem;
  }

  .preset-adapter-root .preset-adapter-actions {
    justify-content: flex-start;
  }

  .preset-adapter-root .preset-adapter-favorite-grid,
  .preset-adapter-root .preset-adapter-group-list,
  .preset-adapter-root .preset-adapter-summary-metrics,
  .preset-adapter-root .preset-adapter-summary-dashboard {
    grid-template-columns: 1fr;
  }

  .preset-adapter-root .preset-adapter-group,
  .preset-adapter-root .preset-adapter-group:first-child,
  .preset-adapter-root .preset-adapter-summary-dashboard > * {
    grid-column: 1;
    grid-row: auto;
  }

  .preset-adapter-root .preset-adapter-options-grid,
  .preset-adapter-root .preset-adapter-options-row {
    grid-auto-flow: row;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .preset-adapter-root .preset-adapter-option {
    min-height: 3.15rem;
  }

  .preset-adapter-root .preset-adapter-option-action {
    min-height: 3.1rem;
    padding: 0.38rem;
  }

  .preset-adapter-root .preset-adapter-option-title > span {
    font-size: 0.8rem;
    line-height: 1.25;
  }

  .preset-adapter-root .preset-adapter-option-title small {
    display: -webkit-box;
    overflow: hidden;
    font-size: 0.68rem;
    line-height: 1.25;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
  }

  .preset-adapter-root .preset-adapter-summary-metrics {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    overflow: visible;
    gap: 0.35rem;
  }

  .preset-adapter-root .preset-adapter-summary-metrics article {
    min-width: 0;
    min-height: 3.65rem;
    padding: 0.45rem 0.5rem;
    gap: 0.42rem;
  }

  .preset-adapter-root .preset-adapter-summary-metrics article > i {
    font-size: 1rem;
  }

  .preset-adapter-root .preset-adapter-summary-metrics small {
    overflow: hidden;
    font-size: 0.66rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .preset-adapter-root .preset-adapter-summary-metrics strong {
    font-size: 1rem;
    white-space: nowrap;
  }

  .preset-adapter-root .preset-adapter-summary-metrics em {
    margin-left: 0.18rem;
    font-size: 0.64rem;
  }

  .preset-adapter-root .preset-adapter-summary-settings-grid {
    display: block;
  }

  .preset-adapter-root .preset-adapter-summary-settings-grid > * {
    margin-top: 0.65rem;
  }

  .preset-adapter-root .preset-adapter-summary-hide-layout {
    grid-template-columns: 1fr;
  }

  .preset-adapter-root .preset-adapter-summary-hide-preview {
    min-height: 0;
  }

  .preset-adapter-root .preset-adapter-summary-subsettings-body > .preset-adapter-actions {
    display: grid;
    grid-template-columns: 1fr;
    width: 100%;
  }

  .preset-adapter-root .preset-adapter-summary-subsettings-body > .preset-adapter-actions button {
    width: 100%;
    white-space: normal;
  }

  .preset-adapter-root .preset-adapter-summary-strategy-footer {
    display: grid;
    grid-template-columns: 1fr;
  }

  .preset-adapter-root .preset-adapter-summary-regenerate,
  .preset-adapter-root .preset-adapter-summary-start {
    width: 100%;
  }

  .preset-adapter-root .preset-adapter-summary-workspace-header {
    align-items: flex-start;
    flex-direction: column;
    gap: 0.45rem;
    padding: 0.52rem 0.62rem;
  }

  .preset-adapter-root .preset-adapter-summary-workspace-heading {
    display: flex;
    align-items: baseline;
    max-width: 100%;
    gap: 0.5rem;
  }

  .preset-adapter-root .preset-adapter-summary-workspace-heading h4,
  .preset-adapter-root .preset-adapter-summary-workspace-heading p {
    margin: 0;
  }

  .preset-adapter-root .preset-adapter-summary-workspace-heading p {
    overflow: hidden;
    font-size: 0.74rem;
    line-height: 1.25;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .preset-adapter-root .preset-adapter-summary-workspace-actions {
    align-items: center;
    justify-content: flex-start;
    width: 100%;
    gap: 0.5rem;
  }

  .preset-adapter-root .preset-adapter-summary-workspace-actions .preset-adapter-summary-inline-actions {
    flex: 0 0 auto;
    flex-wrap: nowrap;
  }

  .preset-adapter-root .preset-adapter-summary-workspace-actions .preset-adapter-summary-inline-actions .menu_button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 1.95rem;
    margin: 0;
    padding: 0.22rem 0.55rem;
    gap: 0.35rem;
    white-space: nowrap;
  }

  .preset-adapter-root .preset-adapter-summary-workspace-actions .preset-adapter-summary-inline-actions .menu_button i {
    position: static;
    flex: 0 0 auto;
    width: auto;
    margin: 0;
    line-height: 1;
  }

  .preset-adapter-root .preset-adapter-summary-filter-control {
    flex: 1 1 auto;
    min-width: 0;
    gap: 0.3rem;
    font-size: 0.72rem;
    white-space: nowrap;
  }

  .preset-adapter-root .preset-adapter-summary-filter-control > span {
    overflow: hidden;
    min-width: 0;
    text-overflow: ellipsis;
  }

  .preset-adapter-root .preset-adapter-summary-workspace-card {
    height: clamp(42rem, 195cqw, 50rem);
  }

  .preset-adapter-root .preset-adapter-summary-workspace-body {
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .preset-adapter-root .preset-adapter-summary-floor-filters {
    width: 100%;
    border-right: 0;
    overflow-x: hidden;
  }

  .preset-adapter-root .preset-adapter-summary-floor-filters button {
    flex: 1 1 0;
    min-width: 0;
    padding-inline: 0.3rem;
    font-size: 0.72rem;
    white-space: nowrap;
  }

  .preset-adapter-root .preset-adapter-summary-floor-pane {
    flex: 1 1 auto;
    height: auto;
    border-right: 0;
    border-bottom: 0;
  }

  .preset-adapter-root .preset-adapter-summary-detail-pane {
    flex: 1 1 auto;
    height: auto;
  }

  .preset-adapter-root .preset-adapter-summary-workspace-view-all .preset-adapter-summary-detail-pane,
  .preset-adapter-root .preset-adapter-summary-workspace-view-summary .preset-adapter-summary-detail-pane,
  .preset-adapter-root .preset-adapter-summary-workspace-view-preview .preset-adapter-summary-floor-pane {
    display: none;
  }

  .preset-adapter-root .preset-adapter-summary-floor-table {
    display: block;
    width: 100%;
    min-width: 0;
    table-layout: auto;
  }

  .preset-adapter-root .preset-adapter-summary-floor-table thead {
    display: none;
  }

  .preset-adapter-root .preset-adapter-summary-floor-table tbody {
    display: block;
  }

  .preset-adapter-root .preset-adapter-summary-floor-table tbody tr {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    grid-template-rows: auto auto;
    min-height: 3.65rem;
    border-bottom: 1px solid var(--pa-border);
    padding: 0.48rem 0.55rem;
    column-gap: 0.55rem;
  }

  .preset-adapter-root .preset-adapter-summary-floor-table td {
    display: flex;
    align-items: center;
    min-width: 0;
    border: 0;
    padding: 0;
  }

  .preset-adapter-root .preset-adapter-summary-floor-table td:nth-child(1) {
    grid-column: 1;
    grid-row: 1;
    font-weight: 600;
  }

  .preset-adapter-root .preset-adapter-summary-floor-table td:nth-child(2) {
    grid-column: 1;
    grid-row: 2;
    color: var(--pa-muted);
    font-size: 0.7rem;
  }

  .preset-adapter-root .preset-adapter-summary-floor-table td:nth-child(3) {
    grid-column: 2;
    grid-row: 1 / 3;
    color: var(--pa-heading);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .preset-adapter-root .preset-adapter-summary-floor-table td:nth-child(3)::after {
    content: ' T';
    color: var(--pa-muted);
    font-size: 0.64rem;
  }

  .preset-adapter-root .preset-adapter-summary-floor-table td:nth-child(4) {
    grid-column: 3;
    grid-row: 1 / 3;
  }

  .preset-adapter-root .preset-adapter-summary-floor-table-scroll {
    overflow-x: hidden;
  }

  .preset-adapter-root .preset-adapter-summary-floor-actions {
    flex-wrap: nowrap;
  }

  .preset-adapter-root .preset-adapter-summary-floor-actions .menu_button {
    min-height: 1.8rem;
    padding-inline: 0.42rem;
  }

  .preset-adapter-root .preset-adapter-summary-viewer > header {
    align-items: flex-start;
    flex-basis: auto;
    flex-direction: column;
    height: auto;
    min-height: 0;
    max-height: none;
  }

  .preset-adapter-root .preset-adapter-summary-detail-actions {
    flex-wrap: wrap;
    justify-content: flex-start;
    width: 100%;
  }

  .preset-adapter-root .preset-adapter-summary-range-toolbar {
    align-items: stretch;
    flex-direction: column;
  }

  .preset-adapter-root .preset-adapter-summary-range-toolbar > div {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .preset-adapter-root .preset-adapter-summary-range-row {
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-rows: auto auto;
    min-height: 4rem;
    gap: 0.3rem 0.55rem;
  }

  .preset-adapter-root .preset-adapter-summary-range-floor {
    grid-column: 1;
    grid-row: 1;
  }

  .preset-adapter-root .preset-adapter-summary-range-token {
    grid-column: 1;
    grid-row: 2;
  }

  .preset-adapter-root .preset-adapter-summary-range-state {
    grid-column: 2;
    grid-row: 1;
  }

  .preset-adapter-root .preset-adapter-summary-range-row > .menu_button {
    grid-column: 2;
    grid-row: 2;
  }

  .preset-adapter-root .preset-adapter-summary-start {
    position: static;
    width: 100%;
  }

  .preset-adapter-root .preset-adapter-debug {
    flex: 0 0 auto;
    overflow: visible;
  }

  .preset-adapter-root .preset-adapter-debug-layout {
    display: block;
    height: auto;
    min-height: 0;
  }

  .preset-adapter-root .preset-adapter-debug-mobile-switch {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    margin-bottom: 0.55rem;
    border: 1px solid var(--pa-border);
    border-radius: 8px;
    padding: 0.2rem;
    background: var(--pa-ink-soft);
    gap: 0.2rem;
  }

  .preset-adapter-root .preset-adapter-debug-mobile-switch button {
    min-height: 2.25rem;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--pa-muted);
    cursor: pointer;
  }

  .preset-adapter-root .preset-adapter-debug-mobile-switch .preset-adapter-debug-mobile-switch-active {
    background: var(--pa-coral-soft);
    color: var(--pa-accent-text);
    box-shadow: inset 0 -2px 0 var(--pa-coral);
  }

  .preset-adapter-root .preset-adapter-debug-mobile-records .preset-adapter-debug-detail,
  .preset-adapter-root .preset-adapter-debug-mobile-detail .preset-adapter-debug-records {
    display: none;
  }

  .preset-adapter-root .preset-adapter-debug-records {
    height: auto;
    min-height: 0;
  }

  .preset-adapter-root .preset-adapter-debug-record-list {
    display: flex;
    flex-direction: column;
    overflow: visible;
    padding: 0;
  }

  .preset-adapter-root .preset-adapter-debug-record {
    flex: 0 0 auto;
  }

  .preset-adapter-root .preset-adapter-debug-detail {
    display: flex;
    flex-direction: column;
    overflow: visible;
    margin-top: 0;
    padding: 0;
  }

  .preset-adapter-root .preset-adapter-debug-metrics {
    display: flex;
  }

  .preset-adapter-root .preset-adapter-debug-metrics span {
    flex: 0 0 5.6rem;
  }
}

.preset-adapter-floating-window .preset-adapter-root
  :is(
    .preset-adapter-favorites,
    .preset-adapter-group,
    .preset-adapter-summary-section,
    .preset-adapter-summary-metrics article,
    .preset-adapter-summary-workspace-card,
    .preset-adapter-summary-strategy,
    .preset-adapter-debug-records,
    .preset-adapter-debug-section
  ) {
  border-radius: var(--pa-card-radius);
}

.preset-adapter-floating-window .preset-adapter-root
  :is(
    .preset-adapter-option,
    .preset-adapter-favorite-card,
    .preset-adapter-debug-record,
    .preset-adapter-debug-row,
    .preset-adapter-summary-range-row,
    button:not(.preset-adapter-tab)
  ) {
  border-radius: var(--pa-control-radius);
}

.preset-adapter-floating-window[data-preset-adapter-theme='night-gold'] .preset-adapter-root
  :is(.preset-adapter-group, .preset-adapter-favorites, .preset-adapter-option) {
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--pa-gold) 5%, transparent);
}

.preset-adapter-floating-window[data-preset-adapter-theme='deep-blue'] .preset-adapter-root
  :is(.preset-adapter-group, .preset-adapter-favorites, .preset-adapter-summary-section) {
  box-shadow:
    inset 0 1px 0 rgb(170 224 255 / 8%),
    0 0.35rem 1rem rgb(0 20 46 / 14%);
}

.preset-adapter-floating-window[data-preset-adapter-theme='deep-blue'] .preset-adapter-root button:not(.preset-adapter-tab) {
  box-shadow: inset 0 1px 0 rgb(174 226 255 / 8%);
}

.preset-adapter-floating-window[data-preset-adapter-theme='purple-black']
  :is(.preset-adapter-theme-option, .preset-adapter-theme-picker > header button),
.preset-adapter-floating-window[data-preset-adapter-theme='purple-black'] .preset-adapter-root
  :is(.preset-adapter-actions button, .preset-adapter-option, .preset-adapter-icon-button) {
  clip-path: polygon(0.32rem 0, 100% 0, 100% calc(100% - 0.32rem), calc(100% - 0.32rem) 100%, 0 100%, 0 0.32rem);
}

.preset-adapter-floating-window[data-preset-adapter-theme='purple-black'] .preset-adapter-root
  :is(.preset-adapter-group, .preset-adapter-favorites, .preset-adapter-summary-section) {
  border-left-color: color-mix(in srgb, var(--pa-coral) 54%, transparent);
  box-shadow: inset 2px 0 0 color-mix(in srgb, var(--pa-coral) 18%, transparent);
}

.preset-adapter-floating-window[data-preset-adapter-theme='jade-green'] .preset-adapter-root
  :is(.preset-adapter-group, .preset-adapter-favorites, .preset-adapter-summary-section) {
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 72%),
    0 0.35rem 1rem rgb(37 92 73 / 8%);
}

.preset-adapter-floating-window[data-preset-adapter-theme='jade-green'] .preset-adapter-root button:not(.preset-adapter-tab) {
  box-shadow: inset 0 -1px 0 rgb(35 112 87 / 12%);
}

.preset-adapter-floating-window[data-preset-adapter-theme='moon-white'] .preset-adapter-root
  :is(.preset-adapter-group, .preset-adapter-favorites, .preset-adapter-summary-section, button) {
  box-shadow: none;
}

.preset-adapter-floating-window[data-preset-adapter-theme='moon-white'] .preset-adapter-root
  :is(.preset-adapter-group-header, .preset-adapter-summary-workspace-header) {
  border-bottom-color: color-mix(in srgb, var(--pa-gold) 26%, transparent);
}

.preset-adapter-floating-window[data-preset-adapter-theme='frost-blue'] .preset-adapter-root
  :is(.preset-adapter-group, .preset-adapter-favorites, .preset-adapter-summary-section) {
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 82%),
    0 0.4rem 1.1rem rgb(39 102 164 / 8%);
}

.preset-adapter-floating-window[data-preset-adapter-theme='frost-blue'] .preset-adapter-root
  :is(.preset-adapter-actions button, .preset-adapter-option, .preset-adapter-icon-button) {
  clip-path: polygon(0.22rem 0, calc(100% - 0.22rem) 0, 100% 0.22rem, 100% calc(100% - 0.22rem), calc(100% - 0.22rem) 100%, 0.22rem 100%, 0 0.22rem);
}
</style>

<style scoped>
@layer preset-adapter-legacy {
  .preset-adapter-root {
    display: flex;
    flex-direction: column;
    gap: 0.7rem;
    min-width: 0;
    min-height: 100%;
    color: var(--pa-text);
    container-type: inline-size;
  }

  .preset-adapter-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
  }

  .preset-adapter-header > div,
  .preset-adapter-group-title {
    min-width: 0;
  }

  .preset-adapter-header h3,
  .preset-adapter-group-header h4 {
    margin: 0;
    line-height: 1.25;
  }

  .preset-adapter-description {
    margin: 0.22rem 0 0;
    color: var(--pa-muted);
    font-size: 0.88rem;
    line-height: 1.45;
    white-space: pre-line;
  }

  .preset-adapter-preset {
    display: inline-block;
    margin-top: 0.35rem;
    color: var(--pa-muted);
    font-size: 0.9rem;
  }

  .preset-adapter-tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    border-bottom: 1px solid var(--pa-border);
    padding-bottom: 0.45rem;
  }

  .preset-adapter-tab {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 2rem;
    border: 1px solid var(--pa-border);
    border-radius: 6px;
    padding: 0.25rem 0.7rem;
    background-color: var(--pa-surface-soft);
    color: var(--pa-text);
    cursor: pointer;
    gap: 0.35rem;
  }

  .preset-adapter-tab:hover,
  .preset-adapter-tab-active {
    border-color: var(--pa-coral);
    background-color: var(--pa-surface-raised);
  }

  .preset-adapter-tab:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }

  .preset-adapter-tab span {
    border: 1px solid var(--pa-border);
    border-radius: 999px;
    padding: 0 0.4rem;
    color: var(--pa-muted);
    font-size: 0.78rem;
    line-height: 1.35;
  }

  .preset-adapter-stats {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }

  .preset-adapter-stats span {
    border: 1px solid var(--pa-border);
    border-radius: 999px;
    padding: 0.15rem 0.55rem;
    background-color: var(--pa-surface-soft);
    color: var(--pa-muted);
    font-size: 0.85rem;
  }

  .preset-adapter-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem;
  }

  .preset-adapter-actions .menu_button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: auto;
    min-width: 4.5rem;
    min-height: 2rem;
    padding-inline: 0.75rem;
    white-space: nowrap;
  }

  .preset-adapter-selection-count {
    color: var(--pa-muted);
    font-size: 0.88rem;
  }

  .preset-adapter-summary {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    min-height: 0;
    padding-bottom: 1.25rem;
  }

  .preset-adapter-summary-section {
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
    border-top: 1px solid var(--pa-border);
    padding-top: 0.75rem;
  }

  .preset-adapter-summary-section > h4,
  .preset-adapter-summary-setting-block h4,
  .preset-adapter-summary-inline-header h4 {
    margin: 0;
    line-height: 1.25;
  }

  .preset-adapter-summary-message-list {
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
  }

  .preset-adapter-summary-message {
    margin-left: 0.75rem;
    border: 1px solid var(--pa-border);
    border-radius: 8px;
    background-color: var(--pa-surface-soft);
  }

  .preset-adapter-summary-message summary {
    padding-left: 0.95rem;
  }

  .preset-adapter-summary-message summary,
  .preset-adapter-summary-panel > summary {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: 0.65rem;
    padding: 0.55rem 0.65rem;
    cursor: pointer;
    font-weight: 700;
    list-style: none;
  }

  .preset-adapter-summary-message summary::-webkit-details-marker,
  .preset-adapter-summary-panel > summary::-webkit-details-marker {
    display: none;
  }

  .preset-adapter-summary-message summary::before,
  .preset-adapter-summary-panel > summary::before {
    content: '';
    width: 0;
    height: 0;
    border-top: 0.32rem solid transparent;
    border-bottom: 0.32rem solid transparent;
    border-left: 0.42rem solid var(--pa-muted);
    transition: transform 120ms ease;
  }

  .preset-adapter-summary-message[open] > summary::before,
  .preset-adapter-summary-panel[open] > summary::before {
    transform: rotate(90deg);
  }

  .preset-adapter-summary-message small {
    margin-left: auto;
    color: var(--pa-muted);
    font-weight: 400;
  }

  .preset-adapter-summary-content {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    max-height: min(28rem, 55vh);
    overflow: auto;
    border-top: 1px solid var(--pa-border);
    padding: 0.65rem;
  }

  .preset-adapter-summary-content-filter {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    margin-left: 0.75rem;
    border: 1px solid var(--pa-border);
    border-radius: 8px;
    padding: 0.55rem 0.65rem;
    background-color: var(--pa-surface-soft);
  }

  .preset-adapter-summary-content-filter label {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
  }

  .preset-adapter-summary-content-filter code {
    color: var(--pa-gold);
  }

  .preset-adapter-summary-rendered {
    line-height: 1.55;
    overflow-wrap: anywhere;
  }

  .preset-adapter-summary-rendered table {
    width: 100%;
    border-collapse: collapse;
    margin-block: 0.75rem;
    border: 1px solid var(--pa-border);
    font-size: 0.92em;
  }

  .preset-adapter-summary-rendered th,
  .preset-adapter-summary-rendered td {
    border: 1px solid var(--pa-border);
    padding: 0.42rem 0.55rem;
    text-align: left;
    vertical-align: top;
  }

  .preset-adapter-summary-rendered thead th {
    background-color: var(--pa-surface-raised);
    color: var(--pa-muted);
    font-weight: 700;
  }

  .preset-adapter-summary-rendered tbody tr:nth-child(odd) {
    background-color: var(--pa-surface-soft);
  }

  .preset-adapter-summary-rendered tbody tr:nth-child(even) {
    background-color: color-mix(in srgb, var(--pa-surface-soft) 45%, transparent);
  }

  .preset-adapter-summary-table {
    width: 100%;
    border-collapse: collapse;
    overflow: hidden;
    border: 1px solid var(--pa-border);
    border-radius: 8px;
    font-size: 0.9rem;
  }

  .preset-adapter-summary-table th,
  .preset-adapter-summary-table td {
    border-bottom: 1px solid var(--pa-border);
    padding: 0.45rem 0.55rem;
    text-align: left;
    vertical-align: top;
  }

  .preset-adapter-summary-table th {
    background-color: var(--pa-surface-soft);
    color: var(--pa-muted);
    font-weight: 700;
  }

  .preset-adapter-summary-table tr:last-child td {
    border-bottom: 0;
  }

  .preset-adapter-summary-total-row td {
    background-color: var(--pa-surface-raised);
    color: var(--pa-muted);
    font-weight: 700;
  }

  .preset-adapter-summary-table .menu_button {
    width: auto;
    min-height: 1.75rem;
    padding-inline: 0.55rem;
    white-space: nowrap;
  }

  .preset-adapter-summary-settings {
    border-top: 1px solid var(--pa-border);
    padding-top: 0.75rem;
  }

  .preset-adapter-summary-settings > :not(summary) {
    margin-left: 0.75rem;
  }

  .preset-adapter-summary-panel > summary {
    border: 1px solid var(--pa-border);
    border-radius: 8px;
    background-color: var(--pa-surface-soft);
  }

  .preset-adapter-summary-setting-block {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .preset-adapter-summary-definition {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    gap: 0.35rem 0.65rem;
    margin: 0;
  }

  .preset-adapter-summary-definition dt {
    color: var(--pa-muted);
  }

  .preset-adapter-summary-definition dd {
    margin: 0;
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .preset-adapter-summary-error-list {
    margin: 0;
    padding-left: 1.2rem;
    color: var(--pa-gold);
    white-space: pre-wrap;
  }

  .preset-adapter-summary-setting-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(15rem, 100%), 1fr));
    gap: 0.55rem;
  }

  .preset-adapter-summary-setting-grid label {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    color: var(--pa-muted);
    font-size: 0.88rem;
  }

  .preset-adapter-summary-setting-grid select {
    width: 100%;
  }

  .preset-adapter-summary-standalone-option {
    display: flex;
    align-items: flex-start;
    gap: 0.55rem;
    border: 1px solid var(--pa-border);
    border-radius: 8px;
    padding: 0.65rem;
    background-color: var(--pa-surface-soft);
    cursor: pointer;
  }

  .preset-adapter-summary-standalone-option input {
    flex: 0 0 auto;
    margin-top: 0.2rem;
  }

  .preset-adapter-summary-standalone-option > span {
    display: flex;
    flex-direction: column;
    min-width: 0;
    gap: 0.15rem;
  }

  .preset-adapter-summary-standalone-option small {
    color: var(--pa-muted);
    font-weight: 400;
    line-height: 1.4;
  }

  .preset-adapter-summary-subsettings {
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
    border-top: 1px solid var(--pa-border);
    padding-top: 0.65rem;
  }

  .preset-adapter-summary-subsettings > h4 {
    margin: 0;
    line-height: 1.25;
  }

  .preset-adapter-summary-subsettings-body {
    display: flex;
    flex-direction: column;
    gap: 0.65rem;
  }

  .preset-adapter-summary-inline-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
  }

  .preset-adapter-summary-inline-actions {
    display: inline-flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 0.35rem;
  }

  .preset-adapter-summary-inline-actions .menu_button {
    width: auto;
    min-height: 2rem;
    padding-inline: 0.75rem;
  }

  .preset-adapter-summary-checkbox-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(16rem, 100%), 1fr));
    gap: 0.45rem 0.75rem;
  }

  .preset-adapter-summary-checkbox-grid label {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    min-width: 0;
  }

  .preset-adapter-summary-start {
    flex-shrink: 0;
    justify-content: center;
    width: 100%;
    min-height: 2.75rem;
    margin-bottom: 1.25rem;
    font-size: 1rem;
    font-weight: 700;
  }

  .preset-adapter-icon-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2em;
    height: 2em;
    padding: 0;
  }

  .preset-adapter-errors {
    border: 1px solid var(--pa-gold);
    border-radius: 8px;
    padding: 0.75rem;
    background-color: var(--pa-surface-soft);
  }

  .preset-adapter-errors ul {
    margin: 0.5rem 0 0;
    padding-left: 1.25rem;
    white-space: pre-wrap;
  }

  .preset-adapter-empty {
    border: 1px dashed var(--pa-border);
    border-radius: 8px;
    padding: 1rem;
    color: var(--pa-muted);
    text-align: center;
  }

  .preset-adapter-group {
    display: flex;
    flex-direction: column;
    gap: 0.65rem;
    border-top: 1px solid var(--pa-border);
    padding-top: 0.75rem;
  }

  .preset-adapter-group-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.75rem;
  }

  .preset-adapter-group-header span {
    flex: 0 0 auto;
    border: 1px solid var(--pa-border);
    border-radius: 999px;
    padding: 0.1rem 0.5rem;
    color: var(--pa-muted);
    font-size: 0.85rem;
  }

  .preset-adapter-options {
    gap: 0.5rem;
  }

  .preset-adapter-options-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(15rem, 100%), 1fr));
  }

  .preset-adapter-options-row {
    display: grid;
    grid-auto-columns: minmax(0, 1fr);
    grid-auto-flow: column;
  }

  .preset-adapter-options-row .preset-adapter-option {
    min-width: 0;
  }

  .preset-adapter-reasoner-format-checks {
    display: grid;
    gap: 0.5rem;
  }

  .preset-adapter-reasoner-format-check {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 0.65rem;
    border: 1px solid var(--pa-gold);
    border-radius: 8px;
    padding: 0.65rem;
    background-color: color-mix(in srgb, var(--pa-gold) 12%, var(--pa-surface-soft) 88%);
  }

  .preset-adapter-reasoner-format-check-main {
    display: flex;
    align-items: flex-start;
    min-width: 0;
    gap: 0.55rem;
  }

  .preset-adapter-reasoner-format-check-main > i {
    flex: 0 0 auto;
    margin-top: 0.15rem;
    color: var(--pa-gold);
  }

  .preset-adapter-reasoner-format-check-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
    gap: 0.12rem;
    line-height: 1.35;
    overflow-wrap: anywhere;
  }

  .preset-adapter-reasoner-format-check-text small {
    color: var(--pa-muted);
    font-size: 0.8rem;
    white-space: pre-line;
  }

  .preset-adapter-reasoner-format-check-action {
    width: auto;
    min-width: 5.5rem;
    min-height: 2rem;
    padding-inline: 0.75rem;
    white-space: nowrap;
  }

  .preset-adapter-variable-inputs {
    display: grid;
    gap: 0.5rem;
  }

  .preset-adapter-variable-input {
    display: grid;
    grid-template-columns: minmax(8rem, 0.8fr) minmax(12rem, 1.2fr);
    align-items: center;
    gap: 0.6rem 0.8rem;
    border: 1px solid var(--pa-border);
    border-radius: 8px;
    padding: 0.65rem;
    background-color: var(--pa-surface-soft);
  }

  .preset-adapter-variable-input-label {
    display: flex;
    flex-direction: column;
    min-width: 0;
    gap: 0.12rem;
  }

  .preset-adapter-variable-input-label strong {
    overflow-wrap: anywhere;
  }

  .preset-adapter-variable-input-label small {
    color: var(--pa-muted);
    font-size: 0.8rem;
    font-weight: 400;
    line-height: 1.35;
    overflow-wrap: anywhere;
    white-space: pre-line;
  }

  .preset-adapter-variable-input-control {
    box-sizing: border-box;
    width: 100%;
    min-width: 0;
    max-width: none;
    margin: 0;
  }

  .preset-adapter-variable-input-control:disabled {
    cursor: not-allowed;
    opacity: 0.65;
  }

  .preset-adapter-option {
    display: grid;
    grid-template-columns: 1fr;
    gap: 0.25rem 0.5rem;
    align-items: center;
    min-height: 3.55rem;
    border: 1px solid var(--pa-border);
    border-radius: 8px;
    padding: 0.55rem 0.65rem;
    background-color: var(--pa-surface-soft);
    color: var(--pa-text);
    text-align: left;
    cursor: pointer;
    transition:
      border-color 160ms ease,
      background-color 160ms ease,
      box-shadow 160ms ease;
  }

  .preset-adapter-option:disabled {
    cursor: not-allowed;
    opacity: 0.65;
  }

  .preset-adapter-option:not(:disabled):hover {
    border-color: var(--pa-coral);
    background-color: var(--pa-surface-raised);
  }

  .preset-adapter-option-export-mode {
    border-style: dashed;
  }

  .preset-adapter-option-export-selected {
    border-color: var(--pa-gold);
    box-shadow: inset 0 0 0 2px var(--pa-gold);
    background-color: color-mix(in srgb, var(--pa-gold) 18%, var(--pa-surface-soft) 82%);
  }

  .preset-adapter-option-export-unavailable {
    opacity: 0.58;
  }

  .preset-adapter-option-main {
    display: inline-flex;
    align-items: flex-start;
    min-width: 0;
    gap: 0.45rem;
    font-weight: 700;
  }

  .preset-adapter-option-title {
    display: flex;
    flex-direction: column;
    min-width: 0;
    gap: 0.12rem;
  }

  .preset-adapter-option-title > span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .preset-adapter-option-title small {
    color: var(--pa-muted);
    font-size: 0.8rem;
    font-weight: 400;
    line-height: 1.35;
    overflow-wrap: anywhere;
    white-space: pre-line;
  }

  .preset-adapter-option-active:not(.preset-adapter-option-export-mode) {
    border-color: var(--pa-coral);
    background-color: color-mix(in srgb, var(--pa-coral) 18%, var(--pa-surface-soft) 82%);
    box-shadow:
      inset 3px 0 0 var(--pa-coral),
      inset 0 0 0 1px color-mix(in srgb, var(--pa-coral) 42%, transparent);
  }

  .preset-adapter-option-active:not(.preset-adapter-option-export-mode):not(:disabled):hover {
    border-color: var(--pa-coral);
    background-color: color-mix(in srgb, var(--pa-coral) 24%, var(--pa-surface-soft) 76%);
  }

  .preset-adapter-option-active .preset-adapter-option-main i,
  .preset-adapter-option-active .preset-adapter-option-title > span {
    color: var(--pa-coral);
  }

  .preset-adapter-option-unmatched .preset-adapter-option-main i {
    color: var(--pa-muted);
  }

  .preset-adapter-options-row .preset-adapter-option {
    align-content: start;
  }

  .preset-adapter-review-backdrop {
    position: fixed;
    inset: 0;
    z-index: 4200;
    display: flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    padding: 1rem;
    background-color: var(--pa-surface-raised);
  }

  .preset-adapter-review-panel {
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    width: min(44rem, calc(100vw - 2rem));
    max-height: min(44rem, calc(100dvh - 2rem));
    overflow: hidden;
    border: 1px solid var(--pa-border);
    border-radius: 8px;
    box-shadow: 0 12px 36px var(--pa-shadow);
    background-color: var(--pa-ink);
    color: var(--pa-text);
  }

  .preset-adapter-review-header,
  .preset-adapter-review-footer {
    display: flex;
    flex-wrap: wrap;
    flex: 0 0 auto;
    gap: 0.65rem;
    padding: 0.75rem;
  }

  .preset-adapter-review-header {
    align-items: flex-start;
    justify-content: space-between;
    border-bottom: 1px solid var(--pa-border);
    background-color: var(--pa-surface-soft);
  }

  .preset-adapter-review-header > div {
    min-width: 0;
  }

  .preset-adapter-review-header h3,
  .preset-adapter-review-section h4 {
    margin: 0;
    line-height: 1.25;
  }

  .preset-adapter-review-body {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    min-height: 0;
    gap: 0.75rem;
    overflow: auto;
    padding: 0.75rem;
  }

  .preset-adapter-review-section {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .preset-adapter-review-item {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    border: 1px solid var(--pa-border);
    border-radius: 8px;
    padding: 0.65rem;
    background-color: var(--pa-surface-soft);
  }

  .preset-adapter-review-item-failed {
    border-color: var(--pa-gold);
  }

  .preset-adapter-review-item-main {
    display: flex;
    align-items: center;
    min-width: 0;
    gap: 0.45rem;
  }

  .preset-adapter-review-item-main strong {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .preset-adapter-review-item p {
    margin: 0;
    color: var(--pa-muted);
    font-size: 0.86rem;
    line-height: 1.35;
    word-break: break-word;
  }

  .preset-adapter-review-badge {
    flex: 0 0 auto;
    border: 1px solid var(--pa-border);
    border-radius: 999px;
    padding: 0.08rem 0.45rem;
    background-color: var(--pa-surface-soft);
    color: var(--pa-text);
    font-size: 0.78rem;
    line-height: 1.35;
  }

  .preset-adapter-review-badge-create,
  .preset-adapter-review-badge-export {
    border-color: var(--pa-coral);
  }

  .preset-adapter-review-badge-overwrite,
  .preset-adapter-review-badge-failed,
  .preset-adapter-review-badge-append {
    border-color: var(--pa-gold);
  }

  .preset-adapter-review-item details {
    border-top: 1px solid var(--pa-border);
    padding-top: 0.35rem;
  }

  .preset-adapter-review-item summary {
    color: var(--pa-muted);
    cursor: pointer;
    font-size: 0.86rem;
  }

  .preset-adapter-review-item pre {
    max-height: 14rem;
    overflow: auto;
    margin: 0.45rem 0 0;
    border: 1px solid var(--pa-border);
    border-radius: 6px;
    padding: 0.55rem;
    background-color: var(--pa-surface-raised);
    color: var(--pa-text);
    font: inherit;
    font-size: 0.82rem;
    line-height: 1.45;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .preset-adapter-review-footer {
    align-items: center;
    justify-content: center;
    border-top: 1px solid var(--pa-border);
    background-color: var(--pa-surface-soft);
  }

  .preset-adapter-review-footer .menu_button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: auto;
    min-width: 5rem;
    min-height: 2rem;
    padding-inline: 0.75rem;
    white-space: nowrap;
  }

  .preset-adapter-debug {
    flex: 1 1 auto;
    min-height: 0;
    min-width: 0;
    overflow: hidden;
  }

  .preset-adapter-debug-layout {
    display: grid;
    grid-template-columns: minmax(13rem, 0.85fr) minmax(0, 1.65fr);
    gap: 0.75rem;
    align-items: stretch;
    height: 100%;
    min-height: 0;
  }

  .preset-adapter-debug-records,
  .preset-adapter-debug-detail {
    display: flex;
    flex-direction: column;
    min-height: 0;
    min-width: 0;
    gap: 0.55rem;
  }

  .preset-adapter-debug-section {
    display: flex;
    flex: 0 0 auto;
    flex-direction: column;
    min-width: 0;
    gap: 0.55rem;
  }

  .preset-adapter-debug-section > h4,
  .preset-adapter-debug-row {
    flex: 0 0 auto;
  }

  .preset-adapter-debug-records {
    overflow: hidden;
  }

  .preset-adapter-debug-detail {
    overflow: auto;
    padding-right: 0.1rem;
    scrollbar-gutter: stable;
  }

  .preset-adapter-debug-pane-header {
    display: flex;
    flex: 0 0 auto;
    align-items: flex-start;
    justify-content: space-between;
    min-width: 0;
    gap: 0.55rem;
  }

  .preset-adapter-debug-pane-header > div {
    min-width: 0;
  }

  .preset-adapter-debug-pane-header h4,
  .preset-adapter-debug-section h4 {
    margin: 0;
    line-height: 1.25;
  }

  .preset-adapter-debug-pane-header .menu_button,
  .preset-adapter-debug-row .menu_button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: auto;
    min-height: 1.85rem;
    padding-inline: 0.65rem;
    white-space: nowrap;
  }

  .preset-adapter-debug-record-list {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    gap: 0.45rem;
    min-height: 0;
    overflow: auto;
    padding-right: 0.1rem;
    scrollbar-gutter: stable;
  }

  .preset-adapter-debug-record {
    display: flex;
    flex-direction: column;
    min-width: 0;
    gap: 0.25rem;
    border: 1px solid var(--pa-border);
    border-radius: 8px;
    padding: 0.55rem;
    background-color: var(--pa-surface-soft);
    color: var(--pa-text);
    text-align: left;
    cursor: pointer;
  }

  .preset-adapter-debug-record:hover,
  .preset-adapter-debug-record-active {
    border-color: var(--pa-coral);
    background-color: var(--pa-surface-raised);
  }

  .preset-adapter-debug-record strong,
  .preset-adapter-debug-record-summary {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .preset-adapter-debug-record small,
  .preset-adapter-debug-record-summary {
    color: var(--pa-muted);
    font-size: 0.8rem;
  }

  .preset-adapter-debug-metrics {
    display: flex;
    flex: 0 0 auto;
    flex-wrap: wrap;
    gap: 0.35rem;
  }

  .preset-adapter-debug-metrics span {
    border: 1px solid var(--pa-border);
    border-radius: 999px;
    padding: 0.1rem 0.45rem;
    background-color: var(--pa-surface-soft);
    color: var(--pa-muted);
    font-size: 0.8rem;
  }

  .preset-adapter-debug-row {
    border: 1px solid var(--pa-border);
    border-radius: 8px;
    padding: 0.55rem;
    background-color: var(--pa-surface-soft);
  }

  .preset-adapter-debug-row summary {
    overflow: hidden;
    color: var(--pa-text);
    cursor: pointer;
    font-weight: 700;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .preset-adapter-debug-row dl {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    gap: 0.35rem 0.55rem;
    margin: 0.55rem 0 0;
    border-top: 1px solid var(--pa-border);
    padding-top: 0.5rem;
  }

  .preset-adapter-debug-row dt {
    color: var(--pa-muted);
    font-size: 0.84rem;
  }

  .preset-adapter-debug-row dd {
    min-width: 0;
    margin: 0;
    color: var(--pa-text);
    font-size: 0.84rem;
    line-height: 1.45;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .preset-adapter-debug-row dd:has(.menu_button) {
    display: flex;
    align-items: flex-start;
    gap: 0.45rem;
  }

  .preset-adapter-debug-row dd span {
    min-width: 0;
    flex: 1 1 auto;
  }

  .preset-adapter-debug-error-text,
  .preset-adapter-debug-large-text {
    box-sizing: border-box;
    width: 100%;
    border: 1px solid var(--pa-border);
    border-radius: 8px;
    padding: 0.65rem;
    background-color: var(--pa-surface-raised);
    color: var(--pa-text);
    font: inherit;
    line-height: 1.45;
    resize: vertical;
  }

  .preset-adapter-debug-error-text {
    min-height: 8rem;
  }

  .preset-adapter-debug-text-panel {
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    width: min(58rem, calc(100vw - 2rem));
    height: min(42rem, calc(100dvh - 2rem));
    overflow: hidden;
    border: 1px solid var(--pa-border);
    border-radius: 8px;
    box-shadow: 0 12px 36px var(--pa-shadow);
    background-color: var(--pa-ink);
    color: var(--pa-text);
  }

  .preset-adapter-debug-text-panel .preset-adapter-review-header {
    align-items: center;
  }

  .preset-adapter-debug-large-text {
    flex: 1 1 auto;
    min-height: 0;
    border-width: 0;
    border-radius: 0;
    resize: none;
  }

  @container (max-width: 720px) {
    .preset-adapter-summary-settings > :not(summary) {
      margin-left: 0.45rem;
    }

    .preset-adapter-variable-input {
      grid-template-columns: 1fr;
    }

    .preset-adapter-debug {
      flex: 0 0 auto;
      overflow: visible;
    }

    .preset-adapter-debug-layout {
      grid-template-columns: 1fr;
      align-items: start;
      height: auto;
    }

    .preset-adapter-debug-records {
      height: min(16rem, 42vh);
      min-height: 12rem;
    }

    .preset-adapter-debug-detail {
      overflow: visible;
      padding-right: 0;
    }

    .preset-adapter-debug-row dl {
      grid-template-columns: 1fr;
    }

    .preset-adapter-debug-row dd:has(.menu_button) {
      flex-direction: column;
    }
  }

  @media (max-width: 720px) {
    .preset-adapter-header {
      gap: 0.6rem;
    }

    .preset-adapter-options-grid {
      grid-template-columns: 1fr;
    }

    .preset-adapter-option {
      min-height: 3.4rem;
    }

    .preset-adapter-reasoner-format-check {
      grid-template-columns: 1fr;
    }

    .preset-adapter-reasoner-format-check-action {
      justify-self: start;
    }

    .preset-adapter-review-backdrop {
      align-items: stretch;
      padding: 0.6rem;
    }

    .preset-adapter-review-panel {
      width: 100%;
      max-height: calc(100dvh - 1.2rem);
    }

    .preset-adapter-review-header,
    .preset-adapter-review-body,
    .preset-adapter-review-footer {
      padding: 0.6rem;
    }

    .preset-adapter-review-footer .menu_button {
      flex: 0 1 auto;
    }

    .preset-adapter-debug-layout {
      grid-template-columns: 1fr;
      align-items: start;
      height: auto;
    }

    .preset-adapter-debug {
      flex: 0 0 auto;
      overflow: visible;
    }

    .preset-adapter-debug-records {
      height: min(16rem, 42vh);
      min-height: 12rem;
    }

    .preset-adapter-debug-detail {
      overflow: visible;
      padding-right: 0;
    }

    .preset-adapter-debug-record-list {
      max-height: none;
    }

    .preset-adapter-debug-row dl {
      grid-template-columns: 1fr;
    }

    .preset-adapter-debug-row dd:has(.menu_button) {
      flex-direction: column;
    }

    .preset-adapter-debug-text-panel {
      width: 100%;
      height: calc(100dvh - 1.2rem);
    }
  }
}
</style>
