import { watch } from 'vue';

import { getHostDocument, getHostWindow } from './host-context';
import { mountMobileWorldSelects } from './mobile-world-select-module';
import type { useModernLayoutStore } from './store';

const WORLD_INFO_ENABLED_CLASS = 'th-modern-wi-enabled';
const WORLD_INFO_NATIVE_CLASS = 'th-modern-wi-native';
const SELECTED_ENTRY_CLASS = 'th-modern-wi-selected';
const SELECTED_ROW_CLASS = 'th-modern-wi-row-checked';
const MULTI_SELECT_CLASS = 'th-modern-wi-multiselect';
const NARROW_CLASS = 'th-modern-wi-narrow';
const DETAIL_OPEN_CLASS = 'th-modern-wi-detail-open';
const ROOT_DETAIL_OPEN_CLASS = 'th-modern-wi-mobile-detail-open';
const TABS_READY_FLAG = 'thModernTabsReady';
const SUMMARY_READY_FLAG = 'thModernSummaryReady';
const SUMMARY_LAYOUT_VERSION = '2026-07-18-compact-v2';
const CONDITIONAL_READY_FLAG = 'thModernConditionalReady';
const SHORTCUT_SYNC_READY_FLAG = 'thModernShortcutSyncReady';
const ENTRY_LAYOUT_VERSION = '2026-07-08-tabs-v4';
const pendingActiveTabsByUid = new Map<number, string>();

type Store = ReturnType<typeof useModernLayoutStore>;
type HostWindow = Window & {
    readonly MutationObserver: typeof MutationObserver;
    readonly $?: JQueryStatic;
};

type MovedNode = {
    marker: Comment;
    node: Node;
};

type NativeWorldInfoController = {
    destroy: () => boolean;
};

type ScheduleSummaryUpdate = (entry: HTMLElement) => void;

const SHORTCUT_FIELD_SOURCE_SELECTORS: Array<[string, string]> = [
    ['th-modern-wi-position-field', 'select[name="position"]'],
    ['th-modern-wi-depth-field', 'input[name="depth"]'],
    ['th-modern-wi-outlet-field', 'input[name="outletName"]'],
    ['th-modern-wi-order-field', 'input[name="order"]'],
    ['th-modern-wi-no-recursion-field', 'input[name="excludeRecursion"]'],
    ['th-modern-wi-prevent-recursion-field', 'input[name="preventRecursion"]'],
];

function getEntryUid(entry: HTMLElement): number | undefined {
    const uid = entry.getAttribute('uid') ?? entry.dataset.uid;
    const parsed = Number(uid);
    return Number.isFinite(parsed) ? parsed : undefined;
}

function getSelectedWorldName(document: Document): string {
    const select = document.querySelector<HTMLSelectElement>('#world_editor_select');
    if (!select || select.value === '') {
        return '';
    }
    return select.selectedOptions[0]?.textContent?.trim() ?? '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getErrorMessage(error: unknown): string {
    return isRecord(error) && typeof error.message === 'string' ? error.message : String(error);
}

function removeWorldInfoEntries(data: unknown, selectedUids: ReadonlySet<number>, hostWindow: Window): Record<string, unknown> {
    const cloned = hostWindow.structuredClone(data) as unknown;
    if (!isRecord(cloned) || !isRecord(cloned.entries)) {
        throw new Error('世界书数据缺少 entries 对象');
    }

    let deletedCount = 0;
    for (const [key, entry] of Object.entries(cloned.entries)) {
        const uid = Number(isRecord(entry) && entry.uid !== undefined ? entry.uid : key);
        if (Number.isFinite(uid) && selectedUids.has(uid)) {
            delete cloned.entries[key];
            deletedCount += 1;
        }
    }

    if (deletedCount !== selectedUids.size) {
        throw new Error(`仅找到 ${deletedCount}/${selectedUids.size} 个待删除条目`);
    }

    if (isRecord(cloned.originalData) && Array.isArray(cloned.originalData.entries)) {
        cloned.originalData.entries = cloned.originalData.entries.filter(entry => {
            const uid = Number(isRecord(entry) ? entry.uid ?? entry.id : undefined);
            return !Number.isFinite(uid) || !selectedUids.has(uid);
        });
    }

    return cloned;
}

type ClosestCapableTarget = EventTarget & {
    closest?: Element['closest'];
    nodeType?: number;
    parentElement?: Element | null;
};

function targetToElement(target: EventTarget | null): Element | null {
    const candidate = target as ClosestCapableTarget | null;
    if (!candidate) {
        return null;
    }

    if (typeof candidate.closest === 'function') {
        return candidate as unknown as Element;
    }

    return candidate.nodeType === 3 ? candidate.parentElement ?? null : null;
}

function closestEntry(target: EventTarget | null): HTMLElement | null {
    return targetToElement(target)?.closest<HTMLElement>('.world_entry') ?? null;
}

function isInteractiveTarget(target: EventTarget | null): boolean {
    const element = targetToElement(target);
    if (!element) {
        return false;
    }

    return Boolean(element.closest([
        '.th-modern-wi-tab',
        '.th-modern-wi-editor-surface',
        '.th-modern-wi-editor-actions',
        '.th-modern-wi-toolbar',
        '.drag-handle',
        '.inline-drawer-toggle',
        '.move_entry_button',
        '.duplicate_entry_button',
        '.delete_entry_button',
        'input',
        'select',
        'textarea',
        'button',
        'a',
        'label',
        '.menu_button',
        '.select2',
        '.select2-container',
    ].join(',')));
}

function getSelectableListEntry(target: EventTarget | null): HTMLElement | null {
    const element = targetToElement(target);
    if (!element || !element.closest('#world_popup_entries_list')) {
        return null;
    }

    if (isInteractiveTarget(element)) {
        return null;
    }

    return closestEntry(element);
}

function moveNode(node: Node, target: HTMLElement, moved: MovedNode[]): void {
    const parent = node.parentNode;
    if (!parent) {
        return;
    }

    const marker = target.ownerDocument.createComment('th-modern-wi-restore');
    parent.insertBefore(marker, node);
    target.append(node);
    moved.push({ marker, node });
}

function restoreMovedNodes(moved: MovedNode[]): void {
    for (const item of [...moved].reverse()) {
        const parent = item.marker.parentNode;
        if (!parent) {
            continue;
        }
        parent.insertBefore(item.node, item.marker);
        item.marker.remove();
    }
    moved.length = 0;
}

function makeElement<K extends keyof HTMLElementTagNameMap>(
    document: Document,
    tag: K,
    className?: string,
    text?: string,
): HTMLElementTagNameMap[K] {
    const element = document.createElement(tag);
    if (className) {
        element.className = className;
    }
    if (text !== undefined) {
        element.textContent = text;
    }
    return element;
}

function createIconButton(document: Document, className: string, title: string, icon: string): HTMLButtonElement {
    const button = makeElement(document, 'button', className);
    button.type = 'button';
    button.title = title;
    button.setAttribute('aria-label', title);
    button.innerHTML = `<i class="${icon}" aria-hidden="true"></i>`;
    return button;
}

function wrapField(document: Document, target: HTMLElement, label: string, wide = false): HTMLElement {
    const wrapper = makeElement(document, 'label', `th-modern-wi-field${wide ? ' th-modern-wi-field-wide' : ''}`);
    wrapper.classList.add('th-modern-wi-labeled-field');
    const title = makeElement(document, 'span', 'th-modern-wi-field-label', label);
    wrapper.append(title, target);
    return wrapper;
}

function appendSectionTitle(document: Document, panel: HTMLElement, text: string, className = ''): void {
    panel.append(makeElement(document, 'div', `th-modern-wi-section-title${className ? ` ${className}` : ''}`, text));
}

function findControlRoot(control: Element | null): HTMLElement | null {
    if (!control) {
        return null;
    }

    return control.closest<HTMLElement>([
        '.world_entry_form_control',
        '.range-block',
        '.checkbox_label',
        'label.checkbox',
        'label',
        '.flex-container',
    ].join(',')) ?? control.parentElement;
}

function appendExistingControl(
    document: Document,
    panel: HTMLElement,
    entry: HTMLElement,
    selector: string,
    label?: string,
    wide = false,
    fieldClass = '',
): void {
    const control = entry.querySelector<HTMLElement>(selector);
    const root = findControlRoot(control);
    if (!root || root.closest('.th-modern-wi-panel')) {
        return;
    }

    if (label && root === control) {
        const wrapper = wrapField(document, root, label, wide);
        if (fieldClass) {
            wrapper.classList.add(fieldClass);
        }
        panel.append(wrapper);
        return;
    }

    root.classList.add('th-modern-wi-native-field');
    if (label) {
        root.classList.add('th-modern-wi-labeled-field');
        if (!root.querySelector(':scope > .th-modern-wi-field-label')) {
            root.prepend(makeElement(document, 'span', 'th-modern-wi-field-label', label));
        }
    }
    if (wide) {
        root.classList.add('th-modern-wi-native-field-wide');
    }
    if (fieldClass) {
        root.classList.add(fieldClass);
    }
    panel.append(root);
}

function appendExistingControlFromRoot(
    panel: HTMLElement,
    entry: HTMLElement,
    selector: string,
    rootSelector: string,
    wide = false,
    fieldClass = '',
    label = '',
): void {
    const control = entry.querySelector<HTMLElement>(selector);
    const root = control?.closest<HTMLElement>(rootSelector);
    if (!root || root.closest('.th-modern-wi-panel')) {
        return;
    }

    root.classList.add('th-modern-wi-native-field');
    if (label) {
        root.classList.add('th-modern-wi-labeled-field');
        if (!root.querySelector(':scope > .th-modern-wi-field-label')) {
            root.prepend(makeElement(getHostDocument(), 'span', 'th-modern-wi-field-label', label));
        }
    }
    if (wide) {
        root.classList.add('th-modern-wi-native-field-wide');
    }
    if (fieldClass) {
        root.classList.add(fieldClass);
    }
    panel.append(root);
}

function appendHeaderControl(
    document: Document,
    panel: HTMLElement,
    entry: HTMLElement,
    selector: string,
    label: string,
    wide = false,
    fieldClass = '',
): void {
    const control = entry.querySelector<HTMLElement>(selector);
    if (!control || control.closest('.th-modern-wi-panel')) {
        return;
    }

    const wrapper = wrapField(document, control, label, wide);
    if (fieldClass) {
        wrapper.classList.add(fieldClass);
    }
    panel.append(wrapper);
}

function dispatchNativeControlEvent(control: HTMLElement): void {
    const EventCtor = control.ownerDocument.defaultView?.Event ?? Event;
    control.dispatchEvent(new EventCtor('input', { bubbles: true }));
    control.dispatchEvent(new EventCtor('change', { bubbles: true }));
}

function syncControlValue(
    source: HTMLInputElement | HTMLSelectElement,
    target: HTMLInputElement | HTMLSelectElement,
): void {
    const sourceTag = source.tagName.toLowerCase();
    const targetTag = target.tagName.toLowerCase();
    if (sourceTag === 'input' && targetTag === 'input' && (source as HTMLInputElement).type === 'checkbox') {
        (target as HTMLInputElement).checked = (source as HTMLInputElement).checked;
        return;
    }
    if (sourceTag === 'select' && targetTag === 'select') {
        (target as HTMLSelectElement).selectedIndex = (source as HTMLSelectElement).selectedIndex;
        return;
    }
    target.value = source.value;
}

function findNativeShortcutSource(
    entry: HTMLElement,
    editor: HTMLElement,
    selector: string,
): HTMLInputElement | HTMLSelectElement | null {
    const controls = [
        ...Array.from(editor.querySelectorAll<HTMLInputElement | HTMLSelectElement>(selector)),
        ...Array.from(entry.querySelectorAll<HTMLInputElement | HTMLSelectElement>(selector)),
    ];
    return controls.find(control => !control.closest('.th-modern-wi-shortcut-field')) ?? controls[0] ?? null;
}

function getShortcutSourceSelector(field: HTMLElement): string | undefined {
    return SHORTCUT_FIELD_SOURCE_SELECTORS.find(([className]) => field.classList.contains(className))?.[1];
}

function bindShortcutMirrorControls(entry: HTMLElement, editor: HTMLElement): void {
    for (const field of editor.querySelectorAll<HTMLElement>('.th-modern-wi-shortcut-field')) {
        const selector = getShortcutSourceSelector(field);
        if (!selector) {
            continue;
        }

        const mirror = field.querySelector<HTMLInputElement | HTMLSelectElement>('input, select');
        const source = findNativeShortcutSource(entry, editor, selector);
        if (!mirror || !source || mirror === source || mirror.dataset[SHORTCUT_SYNC_READY_FLAG] === 'true') {
            continue;
        }

        const syncToSource = () => {
            syncControlValue(mirror, source);
            dispatchNativeControlEvent(source);
        };
        const syncFromSource = () => {
            syncControlValue(source, mirror);
            mirror.disabled = source.disabled;
        };

        mirror.addEventListener('input', syncToSource);
        mirror.addEventListener('change', syncToSource);
        source.addEventListener('input', syncFromSource);
        source.addEventListener('change', syncFromSource);
        mirror.dataset[SHORTCUT_SYNC_READY_FLAG] = 'true';
        syncFromSource();
    }
}

function appendMirrorControl(
    document: Document,
    panel: HTMLElement,
    entry: HTMLElement,
    selector: string,
    label: string,
    wide = false,
    fieldClass = '',
): void {
    const source = entry.querySelector<HTMLInputElement | HTMLSelectElement>(selector);
    if (!source) {
        return;
    }

    const isSelect = source.tagName.toLowerCase() === 'select';
    const isCheckbox = !isSelect && (source as HTMLInputElement).type === 'checkbox';
    const mirror = isSelect
        ? makeElement(document, 'select')
        : makeElement(document, 'input');

    mirror.classList.add('th-modern-wi-shortcut-control');
    mirror.setAttribute('aria-label', label);

    if (isSelect) {
        const selectMirror = mirror as HTMLSelectElement;
        const selectSource = source as HTMLSelectElement;
        for (const option of Array.from(selectSource.options)) {
            const clone = document.createElement('option');
            for (const attribute of Array.from(option.attributes)) {
                clone.setAttribute(attribute.name, attribute.value);
            }
            clone.textContent = option.textContent;
            selectMirror.append(clone);
        }
        selectMirror.selectedIndex = selectSource.selectedIndex;
    } else {
        const inputMirror = mirror as HTMLInputElement;
        const inputSource = source as HTMLInputElement;
        inputMirror.type = inputSource.type || 'text';
        inputMirror.placeholder = inputSource.placeholder;
        inputMirror.min = inputSource.min;
        inputMirror.max = inputSource.max;
        inputMirror.step = inputSource.step;
        if (isCheckbox) {
            inputMirror.checked = inputSource.checked;
        } else {
            inputMirror.value = inputSource.value;
        }
    }

    (mirror as HTMLInputElement | HTMLSelectElement).disabled = source.disabled;

    const syncToSource = () => {
        if (isCheckbox) {
            (source as HTMLInputElement).checked = (mirror as HTMLInputElement).checked;
        } else if (isSelect) {
            (source as HTMLSelectElement).selectedIndex = (mirror as HTMLSelectElement).selectedIndex;
        } else {
            source.value = (mirror as HTMLInputElement | HTMLSelectElement).value;
        }
        dispatchNativeControlEvent(source);
    };

    const syncFromSource = () => {
        if (isCheckbox) {
            (mirror as HTMLInputElement).checked = (source as HTMLInputElement).checked;
        } else if (isSelect) {
            (mirror as HTMLSelectElement).selectedIndex = (source as HTMLSelectElement).selectedIndex;
        } else {
            (mirror as HTMLInputElement | HTMLSelectElement).value = source.value;
        }
        (mirror as HTMLInputElement | HTMLSelectElement).disabled = source.disabled;
    };

    mirror.addEventListener('input', syncToSource);
    mirror.addEventListener('change', syncToSource);
    source.addEventListener('input', syncFromSource);
    source.addEventListener('change', syncFromSource);
    mirror.dataset[SHORTCUT_SYNC_READY_FLAG] = 'true';

    const wrapper = wrapField(document, mirror, label, wide);
    wrapper.classList.add('th-modern-wi-shortcut-field');
    if (fieldClass) {
        wrapper.classList.add(fieldClass);
    }
    panel.append(wrapper);
}

function appendSharedControlSlot(
    document: Document,
    panel: HTMLElement,
    label: string,
    sharedName: string,
    wide = false,
    fieldClass = '',
): HTMLElement {
    const slot = makeElement(document, 'div', 'th-modern-wi-shared-slot');
    slot.dataset.sharedName = sharedName;
    const wrapper = wrapField(document, slot, label, wide);
    wrapper.classList.add('th-modern-wi-shared-field', fieldClass);
    panel.append(wrapper);
    return slot;
}

function appendSharedExistingControl(
    entry: HTMLElement,
    selector: string,
    sharedName: string,
    slots: HTMLElement[],
): void {
    const control = entry.querySelector<HTMLElement>(selector);
    const root = findControlRoot(control);
    if (!root || root.closest('.th-modern-wi-panel')) {
        return;
    }

    root.classList.add('th-modern-wi-shared-control');
    root.dataset.sharedName = sharedName;
    slots[0]?.append(root);
}

function getSharedControlSearchRoots(entry: HTMLElement, editor: HTMLElement): HTMLElement[] {
    const roots = [
        editor,
        editor.closest<HTMLElement>('.inline-drawer-content.inline-drawer-outlet'),
        editor.closest<HTMLElement>('.th-modern-wi-editor-entry-host'),
        entry,
    ];
    return roots.filter((root, index): root is HTMLElement => Boolean(root) && roots.indexOf(root) === index);
}

function ensureSharedExistingControl(
    entry: HTMLElement,
    editor: HTMLElement,
    selector: string,
    sharedName: string,
): HTMLElement | null {
    const roots = getSharedControlSearchRoots(entry, editor);
    for (const root of roots) {
        const existing = root.querySelector<HTMLElement>(`.th-modern-wi-shared-control[data-shared-name="${sharedName}"]`);
        if (existing) {
            return existing;
        }
    }

    for (const searchRoot of roots) {
        const control = searchRoot.querySelector<HTMLElement>(selector);
        const root = findControlRoot(control);
        if (!root) {
            continue;
        }

        root.classList.add('th-modern-wi-shared-control');
        root.dataset.sharedName = sharedName;
        return root;
    }

    return null;
}

function syncSharedControls(
    entry: HTMLElement,
    editor: HTMLElement,
    panelName: string,
): void {
    const controls = new Set(editor.querySelectorAll<HTMLElement>('.th-modern-wi-shared-control[data-shared-name]'));
    const primaryControl = ensureSharedExistingControl(entry, editor, '.keyprimary', 'primary-key');
    if (primaryControl) {
        controls.add(primaryControl);
    }

    for (const control of controls) {
        const sharedName = control.dataset.sharedName;
        if (!sharedName) {
            continue;
        }
        const targetSlot = editor.querySelector<HTMLElement>(
            `.th-modern-wi-panel-${panelName} .th-modern-wi-shared-slot[data-shared-name="${sharedName}"]`,
        );
        if (targetSlot && control.parentElement !== targetSlot) {
            targetSlot.append(control);
        }
    }
}

function syncConditionalFields(entry: HTMLElement, editor: HTMLElement): void {
    const activePanel = editor.querySelector<HTMLElement>('.th-modern-wi-panel:not([hidden])');
    const activePosition = activePanel?.querySelector<HTMLSelectElement>('.th-modern-wi-position-field select');
    const positionControls = Array.from(editor.querySelectorAll<HTMLSelectElement>('.th-modern-wi-position-field select, select[name="position"]'));
    const position = activePosition
        ?? positionControls.find(control => !control.closest('.th-modern-wi-shortcut-field'))
        ?? positionControls[0]
        ?? entry.querySelector<HTMLSelectElement>('select[name="position"]');
    const delayUntilRecursion = editor.querySelector<HTMLInputElement>('input[name="delay_until_recursion"]')
        ?? entry.querySelector<HTMLInputElement>('input[name="delay_until_recursion"]');
    const positionValue = position?.value;
    const positionText = position?.selectedOptions[0]?.textContent?.trim().toLowerCase() ?? '';
    const positionKind = isDepthPosition(position)
        ? 'depth'
        : positionValue === '7' || positionText.includes('outlet') || positionText.includes('锚点')
            ? 'outlet'
            : 'normal';
    const hasRecursionDelay = Boolean(delayUntilRecursion?.checked);

    editor.dataset.thModernPositionKind = positionKind;
    editor.dataset.thModernRecursionDelay = hasRecursionDelay ? 'true' : 'false';

    for (const field of editor.querySelectorAll<HTMLElement>('.th-modern-wi-depth-field')) {
        field.hidden = positionKind !== 'depth';
        for (const input of field.querySelectorAll<HTMLInputElement>('input')) {
            input.disabled = positionKind !== 'depth';
            input.style.visibility = positionKind === 'depth' ? 'visible' : 'hidden';
        }
    }
    for (const field of editor.querySelectorAll<HTMLElement>('.th-modern-wi-outlet-field')) {
        field.hidden = positionKind !== 'outlet';
    }
    for (const field of editor.querySelectorAll<HTMLElement>('.th-modern-wi-recursion-level-field')) {
        field.hidden = !hasRecursionDelay;
    }
}

function bindConditionalFields(entry: HTMLElement, editor: HTMLElement): void {
    const sync = () => syncConditionalFields(entry, editor);

    if (editor.dataset[CONDITIONAL_READY_FLAG] !== 'true') {
        const handleChange = (event: Event) => {
            const target = targetToElement(event.target);
            if (!target?.closest('.th-modern-wi-position-field, select[name="position"], .th-modern-wi-delay-recursion-field, input[name="delay_until_recursion"]')) {
                return;
            }
            sync();
        };
        editor.addEventListener('input', handleChange);
        editor.addEventListener('change', handleChange);
        editor.dataset[CONDITIONAL_READY_FLAG] = 'true';
    }
    sync();
}

function getEntryTitle(entry: HTMLElement, source: ParentNode = entry): string {
    const comment = source.querySelector<HTMLTextAreaElement>('textarea[name="comment"]')?.value.trim();
    return comment || `UID ${getEntryUid(entry) ?? ''}`.trim();
}

function isDepthPosition(position: HTMLSelectElement | null): boolean {
    const selectedOption = position?.selectedOptions[0];
    const positionValue = position?.value;
    const positionRole = selectedOption?.dataset.role;
    const positionText = selectedOption?.textContent?.trim().toLowerCase() ?? '';
    return positionValue === '4'
        || positionRole === '0'
        || positionRole === '1'
        || positionRole === '2'
        || positionText.includes('@d')
        || positionText.includes('depth')
        || positionText.includes('深度');
}

function getEntryPosition(source: ParentNode): string {
    const position = source.querySelector<HTMLSelectElement>('select[name="position"]');
    const positionText = position?.selectedOptions[0]?.textContent?.trim() || '';
    const depth = source.querySelector<HTMLInputElement>('input[name="depth"]')?.value.trim();
    return isDepthPosition(position) && depth ? `${positionText} ${depth}` : positionText;
}

function updateEntrySummary(entry: HTMLElement, source: ParentNode = entry): void {
    const summary = entry.querySelector<HTMLElement>('.th-modern-wi-row-summary');
    if (!summary) {
        return;
    }

    const order = source.querySelector<HTMLInputElement>('input[name="order"]')?.value;
    const state = source.querySelector<HTMLSelectElement>('select[name="entryStateSelector"]')?.value;
    const title = summary.querySelector<HTMLElement>('.th-modern-wi-row-title');
    const meta = summary.querySelector<HTMLElement>('.th-modern-wi-row-meta');
    const stats = summary.querySelector<HTMLElement>('.th-modern-wi-row-stats');
    if (title) {
        title.textContent = getEntryTitle(entry, source);
    }
    if (meta) {
        meta.textContent = getEntryPosition(source);
    }
    if (stats) {
        stats.textContent = order ? `#${order}` : '';
    }
    if (state) {
        entry.dataset.thModernEntryState = state;
    }
}

function ensureEntrySummary(document: Document, entry: HTMLElement, scheduleSummaryUpdate: ScheduleSummaryUpdate): void {
    const header = entry.querySelector<HTMLElement>(':scope > form.world_entry_form > .inline-drawer > .inline-drawer-header');
    if (!header) {
        return;
    }

    let summary = header.querySelector<HTMLElement>('.th-modern-wi-row-summary');
    if (!summary) {
        summary = makeElement(document, 'div', 'th-modern-wi-row-summary');
        summary.tabIndex = 0;
        summary.setAttribute('role', 'button');
        summary.setAttribute('aria-label', '打开世界书条目');
        header.append(summary);
    }
    if (summary.dataset.layoutVersion !== SUMMARY_LAYOUT_VERSION) {
        summary.innerHTML = [
            '<span class="th-modern-wi-row-leading" aria-hidden="true">',
            '<span class="th-modern-wi-select-dot"></span>',
            '<span class="th-modern-wi-entry-state-icon"></span>',
            '</span>',
            '<span class="th-modern-wi-row-text">',
            '<span class="th-modern-wi-row-primary">',
            '<strong class="th-modern-wi-row-title"></strong>',
            '<span class="th-modern-wi-row-stats"></span>',
            '</span>',
            '<small class="th-modern-wi-row-meta"></small>',
            '</span>',
        ].join('');
        summary.dataset.layoutVersion = SUMMARY_LAYOUT_VERSION;
    }

    if (entry.dataset[SUMMARY_READY_FLAG] !== 'true') {
        entry.dataset[SUMMARY_READY_FLAG] = 'true';
        entry.addEventListener('input', () => scheduleSummaryUpdate(entry));
        entry.addEventListener('change', () => scheduleSummaryUpdate(entry));
    }
    updateEntrySummary(entry);
}

function showPanel(entry: HTMLElement, panelName: string, root: ParentNode = entry): void {
    entry.dataset.thModernActiveTab = panelName;
    for (const button of root.querySelectorAll<HTMLElement>('.th-modern-wi-tab')) {
        const active = button.dataset.panel === panelName;
        button.classList.toggle('active', active);
        button.setAttribute('aria-selected', String(active));
    }
    for (const panel of root.querySelectorAll<HTMLElement>('.th-modern-wi-panel')) {
        panel.hidden = panel.dataset.panel !== panelName;
    }
    syncSharedControls(entry, root as HTMLElement, panelName);
    syncConditionalFields(entry, root as HTMLElement);
    root.querySelector<HTMLElement>('.th-modern-wi-panels')?.scrollTo({ top: 0, left: 0 });
}

function takePreferredPanel(entry: HTMLElement): string {
    const uid = getEntryUid(entry);
    if (uid !== undefined) {
        const pendingPanel = pendingActiveTabsByUid.get(uid);
        if (pendingPanel) {
            pendingActiveTabsByUid.delete(uid);
            return pendingPanel;
        }
    }

    return entry.dataset.thModernActiveTab || 'main';
}

function localizeEntryStateSelector(entry: HTMLElement): void {
    const selector = entry.querySelector<HTMLSelectElement>('select[name="entryStateSelector"]');
    if (!selector) {
        return;
    }

    const labels: Record<string, string> = {
        constant: '🔵 常量',
        normal: '🟢 普通',
        vectorized: '🔗 向量化',
    };
    for (const option of selector.options) {
        const label = labels[option.value];
        if (label) {
            option.textContent = label;
        }
    }
}

function bindEntryEditorEvents(entry: HTMLElement, editor: HTMLElement): void {
    if (editor.dataset.thModernSwitchCaptureReady !== 'true') {
        editor.addEventListener('click', event => {
            const target = targetToElement(event.target);
            if (!target?.closest('.switch_input_type_icon')) {
                return;
            }
            const uid = getEntryUid(entry);
            if (uid !== undefined) {
                const panelName = target.closest<HTMLElement>('.th-modern-wi-panel')?.dataset.panel
                    || entry.dataset.thModernActiveTab
                    || 'keywords';
                pendingActiveTabsByUid.set(uid, panelName);
            }
        }, true);
        editor.dataset.thModernSwitchCaptureReady = 'true';
    }

    editor.onclick = event => {
        if (event.defaultPrevented) {
            return;
        }

        const target = targetToElement(event.target);
        const tab = target?.closest<HTMLElement>('.th-modern-wi-tab');
        if (tab && editor.contains(tab)) {
            const panelName = tab.dataset.panel;
            if (!panelName) {
                return;
            }
            event.preventDefault();
            showPanel(entry, panelName, editor);
            return;
        }

        const action = target?.closest<HTMLButtonElement>('.th-modern-wi-action');
        if (!action || !editor.contains(action)) {
            return;
        }

        const actionName = action.dataset.action
            || (action.classList.contains('danger') ? 'delete' : action.title.includes('复制') ? 'duplicate' : 'move');
        const selector = {
            move: '.move_entry_button',
            duplicate: '.duplicate_entry_button',
            delete: '.delete_entry_button',
        }[actionName];
        if (!selector) {
            return;
        }

        event.preventDefault();
        entry.querySelector<HTMLElement>(selector)?.click();
    };
}

function setupEntryTabs(document: Document, entry: HTMLElement, scheduleSummaryUpdate: ScheduleSummaryUpdate): boolean {
    const content = entry.querySelector<HTMLElement>(':scope > form.world_entry_form > .inline-drawer > .inline-drawer-content.inline-drawer-outlet');
    const edit = entry.querySelector<HTMLElement>('.world_entry_edit');
    if (!content || !edit) {
        return false;
    }

    if (entry.dataset[TABS_READY_FLAG] === 'true') {
        const existingEditor = content.querySelector<HTMLElement>(':scope > .th-modern-wi-editor-surface');
        if (existingEditor) {
            existingEditor.dataset.thModernLayoutVersion = ENTRY_LAYOUT_VERSION;
            localizeEntryStateSelector(entry);
            bindEntryEditorEvents(entry, existingEditor);
            bindShortcutMirrorControls(entry, existingEditor);
            bindConditionalFields(entry, existingEditor);
            showPanel(entry, takePreferredPanel(entry), existingEditor);
            return true;
        }
        delete entry.dataset[TABS_READY_FLAG];
    }

    entry.dataset[TABS_READY_FLAG] = 'true';
    ensureEntrySummary(document, entry, scheduleSummaryUpdate);
    localizeEntryStateSelector(entry);

    const editor = makeElement(document, 'div', 'th-modern-wi-editor-surface');
    editor.dataset.thModernLayoutVersion = ENTRY_LAYOUT_VERSION;
    const top = makeElement(document, 'div', 'th-modern-wi-editor-top');
    const enableDock = makeElement(document, 'div', 'th-modern-wi-enable-dock');
    const actions = makeElement(document, 'div', 'th-modern-wi-editor-actions');
    const move = createIconButton(document, 'menu_button th-modern-wi-action', '移动/复制到其他世界书', 'fa-solid fa-arrow-right-arrow-left');
    const duplicate = createIconButton(document, 'menu_button th-modern-wi-action', '复制条目', 'fa-regular fa-copy');
    const remove = createIconButton(document, 'menu_button th-modern-wi-action danger', '删除条目', 'fa-regular fa-trash-can');
    move.dataset.action = 'move';
    duplicate.dataset.action = 'duplicate';
    remove.dataset.action = 'delete';
    actions.append(move, duplicate, remove);

    const tabbar = makeElement(document, 'div', 'th-modern-wi-tabs');
    const panels = makeElement(document, 'div', 'th-modern-wi-panels');
    const tabDefs = [
        ['main', '主要'],
        ['keywords', '关键词'],
        ['insert', '插入'],
        ['trigger', '触发'],
    ] as const;

    const panelMap = new Map<string, HTMLElement>();
    for (const [name, label] of tabDefs) {
        const button = makeElement(document, 'button', 'th-modern-wi-tab', label);
        button.type = 'button';
        button.dataset.panel = name;
        button.addEventListener('click', event => {
            event.preventDefault();
            showPanel(entry, name, editor);
        });
        tabbar.append(button);

        const panel = makeElement(document, 'div', 'th-modern-wi-panel');
        panel.classList.add(`th-modern-wi-panel-${name}`);
        panel.dataset.panel = name;
        panels.append(panel);
        panelMap.set(name, panel);
    }

    const contentPanel = makeElement(document, 'div', 'th-modern-wi-content-panel');
    top.append(enableDock, tabbar, actions);
    editor.append(top, panels, contentPanel);
    content.prepend(editor);
    bindEntryEditorEvents(entry, editor);

    appendHeaderControl(document, enableDock, entry, '.killSwitch', '启用', false, 'th-modern-wi-enable-field');

    const main = panelMap.get('main')!;
    appendHeaderControl(document, main, entry, 'textarea[name="comment"]', '条目标题/备注', true, 'th-modern-wi-title-field');
    appendHeaderControl(document, main, entry, 'select[name="entryStateSelector"]', '条目状态', false, 'th-modern-wi-state-field');
    appendMirrorControl(document, main, entry, 'select[name="position"]', '插入位置', true, 'th-modern-wi-position-field');
    appendMirrorControl(document, main, entry, 'input[name="depth"]', '深度', false, 'th-modern-wi-depth-field');
    appendMirrorControl(document, main, entry, 'input[name="outletName"]', '锚点名称', false, 'th-modern-wi-outlet-field');
    appendMirrorControl(document, main, entry, 'input[name="order"]', '顺序', false, 'th-modern-wi-order-field');
    appendMirrorControl(document, main, entry, 'input[name="excludeRecursion"]', '不可递归', false, 'th-modern-wi-no-recursion-field');
    const mainPrimaryKeySlot = appendSharedControlSlot(document, main, '主要关键字', 'primary-key', true, 'th-modern-wi-primary-key-field');
    appendMirrorControl(document, main, entry, 'input[name="preventRecursion"]', '防止进一步递归', false, 'th-modern-wi-prevent-recursion-field');

    const keywords = panelMap.get('keywords')!;
    const keywordPrimaryKeySlot = appendSharedControlSlot(document, keywords, '主要关键字', 'primary-key', true, 'th-modern-wi-primary-key-field');
    appendExistingControl(document, keywords, entry, 'select[name="entryLogicType"]', '逻辑', false, 'th-modern-wi-logic-field');
    appendExistingControl(document, keywords, entry, '.keysecondary', '可选过滤器', true, 'th-modern-wi-secondary-key-field');
    appendExistingControl(document, keywords, entry, 'select[name="caseSensitive"]', '区分大小写', false, 'th-modern-wi-case-field');
    appendExistingControl(document, keywords, entry, 'select[name="matchWholeWords"]', '全词匹配', false, 'th-modern-wi-whole-field');
    appendExistingControl(document, keywords, entry, 'select[name="useGroupScoring"]', '组评分', false, 'th-modern-wi-group-scoring-field');
    appendExistingControl(document, keywords, entry, 'input[name="scanDepth"]', '扫描深度', false, 'th-modern-wi-scan-field');
    appendExistingControl(document, keywords, entry, 'input[name="automationId"]', '自动化 ID', false, 'th-modern-wi-automation-field');
    appendSharedExistingControl(entry, '.keyprimary', 'primary-key', [mainPrimaryKeySlot, keywordPrimaryKeySlot]);

    const insert = panelMap.get('insert')!;
    appendHeaderControl(document, insert, entry, 'select[name="position"]', '插入位置', true, 'th-modern-wi-position-field');
    appendHeaderControl(document, insert, entry, 'input[name="depth"]', '深度', false, 'th-modern-wi-depth-field');
    appendExistingControl(document, insert, entry, 'input[name="outletName"]', '锚点名称', false, 'th-modern-wi-outlet-field');
    appendHeaderControl(document, insert, entry, 'input[name="order"]', '顺序', false, 'th-modern-wi-order-field');
    appendHeaderControl(document, insert, entry, 'input[name="probability"]', '触发概率', false, 'th-modern-wi-probability-field');
    appendExistingControl(document, insert, entry, 'input[name="useProbability"]', '使用概率', false, 'th-modern-wi-use-probability-field');
    appendExistingControl(document, insert, entry, 'input[name="group"]', '包含组', true, 'th-modern-wi-group-field');
    appendExistingControl(document, insert, entry, 'input[name="groupWeight"]', '分组权重', false, 'th-modern-wi-group-weight-field');
    appendExistingControl(document, insert, entry, 'input[name="sticky"]', '黏附', false, 'th-modern-wi-sticky-field');
    appendExistingControl(document, insert, entry, 'input[name="cooldown"]', '冷却', false, 'th-modern-wi-cooldown-field');
    appendExistingControl(document, insert, entry, 'input[name="delay"]', '延迟', false, 'th-modern-wi-delay-field');
    appendExistingControlFromRoot(insert, entry, 'select[name="characterFilter"]', '.flex4', true, 'th-modern-wi-character-filter-field', '绑定到角色或标签');
    appendExistingControlFromRoot(insert, entry, 'select[name="triggers"]', '.flex4', true, 'th-modern-wi-generation-trigger-field', '筛选生成触发器');
    appendExistingControl(document, insert, entry, 'input[name="delayUntilRecursionLevel"]', '递归等级', false, 'th-modern-wi-recursion-level-field');
    appendExistingControl(document, insert, entry, 'input[name="excludeRecursion"]', '不可递归', false, 'th-modern-wi-no-recursion-field');
    appendExistingControl(document, insert, entry, 'input[name="preventRecursion"]', '防止进一步递归', false, 'th-modern-wi-prevent-recursion-field');
    appendExistingControl(document, insert, entry, 'input[name="delay_until_recursion"]', '延迟到递归', false, 'th-modern-wi-delay-recursion-field');
    appendExistingControl(document, insert, entry, 'input[name="ignoreBudget"]', '无视回复限额', false, 'th-modern-wi-budget-field');

    const trigger = panelMap.get('trigger')!;
    appendSectionTitle(document, trigger, '额外匹配来源', 'th-modern-wi-match-source-title');
    appendExistingControl(document, trigger, entry, 'input[name="matchCharacterDescription"]', '角色描述', false, 'th-modern-wi-match-source-field');
    appendExistingControl(document, trigger, entry, 'input[name="matchCharacterPersonality"]', '角色性格', false, 'th-modern-wi-match-source-field');
    appendExistingControl(document, trigger, entry, 'input[name="matchScenario"]', '情景', false, 'th-modern-wi-match-source-field');
    appendExistingControl(document, trigger, entry, 'input[name="matchPersonaDescription"]', '用户设定描述', false, 'th-modern-wi-match-source-field');
    appendExistingControl(document, trigger, entry, 'input[name="matchCharacterDepthPrompt"]', '角色备注', false, 'th-modern-wi-match-source-field');
    appendExistingControl(document, trigger, entry, 'input[name="matchCreatorNotes"]', '创作者的注释', false, 'th-modern-wi-match-source-field');

    appendExistingControl(document, contentPanel, entry, 'textarea[name="content"]', '正文', true);
    bindShortcutMirrorControls(entry, editor);
    bindConditionalFields(entry, editor);

    showPanel(entry, takePreferredPanel(entry), editor);
    return true;
}

class NativeWorldInfoEnhancer implements NativeWorldInfoController {
    private readonly document: Document;
    private readonly window: HostWindow;
    private readonly moved: MovedNode[] = [];
    private observer?: MutationObserver;
    private shell?: HTMLElement;
    private listPane?: HTMLElement;
    private editorPane?: HTMLElement;
    private observedList?: HTMLElement;
    private documentClickHandler?: (event: MouseEvent) => void;
    private documentKeyDownHandler?: (event: KeyboardEvent) => void;
    private documentChangeHandler?: (event: Event) => void;
    private worldSelectChangeHandler?: () => void;
    private worldSelect?: JQuery<HTMLSelectElement>;
    private narrowQuery?: MediaQueryList;
    private narrowQueryHandler?: () => void;
    private readonly editorMoved: MovedNode[] = [];
    private readonly pendingSummaryUpdates = new Map<HTMLElement, number>();
    private multiButton?: HTMLButtonElement;
    private deleteSelectedButton?: HTMLButtonElement;
    private moreMenu?: HTMLDetailsElement;
    private selectedUids = new Set<number>();
    private selectedEntry?: HTMLElement;
    private selectedWorldName = '';
    private worldRevision = 0;
    private deleteBusy = false;
    private lockedWorldSelect?: { element: HTMLSelectElement; wasDisabled: boolean };
    private mounted = false;
    private multiSelect = false;
    private mobileDetailOpen = false;
    private mobileListScrollTop = 0;
    private pendingEnhance = 0;
    private pendingEditorRetry = 0;
    private editorRetryRevision = 0;
    private mobileWorldSelects?: ReturnType<typeof mountMobileWorldSelects>;

    constructor() {
        this.document = getHostDocument();
        this.window = getHostWindow() as HostWindow;
    }

    private readonly scheduleSummaryUpdate: ScheduleSummaryUpdate = entry => {
        if (!this.mounted || this.pendingSummaryUpdates.has(entry)) {
            return;
        }

        const frame = this.window.requestAnimationFrame(() => {
            this.pendingSummaryUpdates.delete(entry);
            if (this.mounted && entry.isConnected) {
                updateEntrySummary(entry);
            }
        });
        this.pendingSummaryUpdates.set(entry, frame);
    };

    mount(): void {
        if (this.mounted) {
            return;
        }

        const worldInfo = this.findWorldInfo();
        const popup = this.findWorldPopup();
        const list = this.findEntriesList();
        if (!worldInfo || !popup || !list) {
            return;
        }

        this.mounted = true;
        this.selectedWorldName = getSelectedWorldName(this.document);
        worldInfo.classList.add(WORLD_INFO_NATIVE_CLASS);
        this.buildLayout(popup, list);
        this.mobileWorldSelects = mountMobileWorldSelects();
        this.bindResponsiveMode();
        this.bindEvents();
        this.enhanceEntries();
        if (!this.isNarrowMode()) {
            this.selectFirstEntry();
        }
    }

    destroy(): boolean {
        const wasMounted = this.mounted;
        this.worldRevision += 1;
        this.setDeleteBusy(false);
        const worldInfo = this.findWorldInfo();
        worldInfo?.classList.remove(WORLD_INFO_NATIVE_CLASS, MULTI_SELECT_CLASS, ROOT_DETAIL_OPEN_CLASS);
        this.observer?.disconnect();
        this.observer = undefined;
        this.cancelPendingEditorRetry();
        this.cancelPendingSummaryUpdates();
        this.clearSelection();
        this.selectedUids.clear();
        pendingActiveTabsByUid.clear();
        this.selectedWorldName = '';
        this.multiSelect = false;
        this.mounted = false;
        if (this.pendingEnhance) {
            this.window.cancelAnimationFrame(this.pendingEnhance);
            this.pendingEnhance = 0;
        }
        if (this.documentClickHandler) {
            this.document.removeEventListener('click', this.documentClickHandler, true);
            this.documentClickHandler = undefined;
        }
        if (this.documentKeyDownHandler) {
            this.document.removeEventListener('keydown', this.documentKeyDownHandler, true);
            this.documentKeyDownHandler = undefined;
        }
        if (this.documentChangeHandler) {
            this.document.removeEventListener('change', this.documentChangeHandler, true);
            this.documentChangeHandler = undefined;
        }
        if (this.worldSelect && this.worldSelectChangeHandler) {
            this.worldSelect.off(`change.thModernWorldInfo_${getScriptId()}`, this.worldSelectChangeHandler);
        }
        this.worldSelect = undefined;
        this.worldSelectChangeHandler = undefined;
        if (this.narrowQuery && this.narrowQueryHandler) {
            this.narrowQuery.removeEventListener('change', this.narrowQueryHandler);
        }
        this.narrowQuery = undefined;
        this.narrowQueryHandler = undefined;
        this.mobileDetailOpen = false;
        this.mobileListScrollTop = 0;
        this.mobileWorldSelects?.destroy();
        this.mobileWorldSelects = undefined;

        for (const entry of this.document.querySelectorAll<HTMLElement>('.world_entry')) {
            entry.classList.remove(SELECTED_ENTRY_CLASS, SELECTED_ROW_CLASS);
        }
        this.observedList = undefined;

        restoreMovedNodes(this.moved);
        this.shell?.remove();
        this.shell = undefined;
        this.listPane = undefined;
        this.editorPane = undefined;
        this.moreMenu = undefined;
        return wasMounted;
    }

    private bindResponsiveMode(): void {
        this.narrowQuery = this.window.matchMedia('(max-width: 899.98px)');
        this.narrowQueryHandler = () => this.syncResponsiveMode();
        this.narrowQuery.addEventListener('change', this.narrowQueryHandler);
        this.syncResponsiveMode();
    }

    private isNarrowMode(): boolean {
        return this.narrowQuery?.matches ?? this.window.matchMedia('(max-width: 899.98px)').matches;
    }

    private syncResponsiveMode(): void {
        const isNarrow = this.isNarrowMode();
        const detailOpen = isNarrow && this.mobileDetailOpen && Boolean(this.selectedEntry);
        this.shell?.classList.toggle(NARROW_CLASS, isNarrow);
        this.findWorldInfo()?.classList.toggle(ROOT_DETAIL_OPEN_CLASS, detailOpen);
        if (!isNarrow) {
            this.mobileDetailOpen = false;
            this.shell?.classList.remove(DETAIL_OPEN_CLASS);
            this.selectFirstEntry();
            return;
        }
        this.shell?.classList.toggle(DETAIL_OPEN_CLASS, detailOpen);
    }

    private openMobileDetail(): void {
        if (!this.isNarrowMode()) {
            return;
        }
        const worldInfo = this.findWorldInfo();
        this.mobileListScrollTop = worldInfo?.scrollTop ?? 0;
        this.mobileDetailOpen = true;
        this.syncResponsiveMode();
        worldInfo?.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    }

    private closeMobileDetail(): void {
        const worldInfo = this.findWorldInfo();
        this.mobileDetailOpen = false;
        this.syncResponsiveMode();
        this.window.requestAnimationFrame(() => {
            if (this.mounted && this.isNarrowMode()) {
                worldInfo?.scrollTo({ top: this.mobileListScrollTop, left: 0, behavior: 'auto' });
            }
        });
    }

    private findWorldInfo(): HTMLElement | null {
        return this.document.querySelector<HTMLElement>('#WorldInfo');
    }

    private findWorldPopup(): HTMLElement | null {
        return this.document.querySelector<HTMLElement>('#world_popup');
    }

    private findEntriesList(): HTMLElement | null {
        return this.document.querySelector<HTMLElement>('#world_popup_entries_list');
    }

    private buildLayout(popup: HTMLElement, list: HTMLElement): void {
        const shell = makeElement(this.document, 'div', 'th-modern-wi-native-shell');
        const worldbar = makeElement(this.document, 'div', 'th-modern-wi-worldbar');
        const toolbar = makeElement(this.document, 'div', 'th-modern-wi-toolbar');
        const main = makeElement(this.document, 'div', 'th-modern-wi-native-main');
        const listPane = makeElement(this.document, 'div', 'th-modern-wi-native-list');
        const editorPane = makeElement(this.document, 'div', 'th-modern-wi-native-editor');

        shell.append(worldbar, toolbar, main);
        main.append(listPane, editorPane);
        popup.append(shell);

        const worldControls = popup.querySelector<HTMLElement>('#world_create_button')?.closest<HTMLElement>('.flex-container');
        if (worldControls) {
            moveNode(worldControls, worldbar, this.moved);
        }

        const nativeTools = popup.querySelector<HTMLElement>('#world_info_search')?.closest<HTMLElement>('.flex-container');
        if (nativeTools) {
            moveNode(nativeTools, toolbar, this.moved);
        }

        this.multiButton = createIconButton(this.document, 'menu_button th-modern-wi-multi-toggle', '多选条目', 'fa-regular fa-square-check');
        this.deleteSelectedButton = createIconButton(this.document, 'menu_button th-modern-wi-delete-selected danger', '删除选中条目', 'fa-regular fa-trash-can');
        this.deleteSelectedButton.hidden = true;
        this.multiButton.addEventListener('click', () => this.toggleMultiSelect());
        this.deleteSelectedButton.addEventListener('click', () => void this.deleteSelectedEntries());

        const moreMenu = makeElement(this.document, 'details', 'th-modern-wi-more-menu');
        const moreToggle = makeElement(this.document, 'summary', 'menu_button th-modern-wi-more-toggle');
        moreToggle.title = '更多条目操作';
        moreToggle.setAttribute('aria-label', '更多条目操作');
        moreToggle.innerHTML = '<i class="fa-solid fa-ellipsis" aria-hidden="true"></i>';
        const morePanel = makeElement(this.document, 'div', 'th-modern-wi-more-popover');
        moreMenu.append(moreToggle, morePanel);
        for (const selector of [
            '#OpenAllWIEntries',
            '#CloseAllWIEntries',
            '#world_backfill_memos',
            '#world_apply_current_sorting',
        ]) {
            const node = popup.querySelector<HTMLElement>(selector) ?? toolbar.querySelector<HTMLElement>(selector);
            if (node) {
                moveNode(node, morePanel, this.moved);
            }
        }
        moreMenu.addEventListener('click', event => {
            const action = targetToElement(event.target)?.closest('#OpenAllWIEntries, #CloseAllWIEntries, #world_backfill_memos, #world_apply_current_sorting');
            if (action) {
                moreMenu.open = false;
            }
        });
        this.moreMenu = moreMenu;
        toolbar.append(this.multiButton, this.deleteSelectedButton, moreMenu);

        const titlebarActions = this.findWorldInfo()?.querySelector<HTMLElement>(':scope > .th-modern-drawer-titlebar .th-modern-drawer-actions');
        if (titlebarActions) {
            for (const selector of ['#WI_panel_pin_div', '#WorldInfoheader + .flex-container .notes-link']) {
                const node = this.findWorldInfo()?.querySelector<HTMLElement>(selector);
                if (node) {
                    moveNode(node, titlebarActions, this.moved);
                }
            }
        }

        moveNode(list, listPane, this.moved);
        this.shell = shell;
        this.listPane = listPane;
        this.editorPane = editorPane;
    }

    private bindEvents(): void {
        this.documentClickHandler = event => {
            const target = targetToElement(event.target);
            if (this.moreMenu?.open && target && !this.moreMenu.contains(target)) {
                this.moreMenu.open = false;
            }
            if (getSelectableListEntry(event.target)) {
                this.onEntryClick(event);
            }
        };
        this.documentKeyDownHandler = event => this.onEntryKeyDown(event);
        this.documentChangeHandler = event => {
            const target = targetToElement(event.target);
            if (target?.matches('#world_editor_select')) {
                this.syncSelectedWorld();
            }
        };
        this.document.addEventListener('click', this.documentClickHandler, true);
        this.document.addEventListener('keydown', this.documentKeyDownHandler, true);
        this.document.addEventListener('change', this.documentChangeHandler, true);

        const worldSelect = this.document.querySelector<HTMLSelectElement>('#world_editor_select');
        if (worldSelect) {
            if (typeof this.window.$ !== 'function') {
                throw new Error('宿主页缺少世界书切换所需的 jQuery。');
            }
            this.worldSelectChangeHandler = () => this.syncSelectedWorld();
            this.worldSelect = this.window.$(worldSelect);
            this.worldSelect.on(`change.thModernWorldInfo_${getScriptId()}`, this.worldSelectChangeHandler);
        }

        this.observer = new this.window.MutationObserver(mutations => {
            if (mutations.some(mutation => mutation.addedNodes.length > 0 || mutation.removedNodes.length > 0)) {
                this.scheduleEnhance();
            }
        });
        this.observeCurrentList();
    }

    private observeCurrentList(): void {
        if (!this.observer) {
            return;
        }

        const list = this.findEntriesList();
        if (!list || this.observedList === list) {
            return;
        }

        this.observer.disconnect();
        if (this.listPane) {
            this.observer.observe(this.listPane, { childList: true });
        }
        this.observer.observe(list, { childList: true });
        this.observedList = list;
    }

    private scheduleEnhance(): void {
        if (!this.mounted || this.pendingEnhance) {
            return;
        }

        this.pendingEnhance = this.window.requestAnimationFrame(() => {
            this.pendingEnhance = 0;
            if (!this.mounted) {
                return;
            }
            this.syncSelectedWorld();
            this.observeCurrentList();
            this.enhanceEntries();
            this.restoreSelectionAfterRender();
        });
    }

    private enhanceEntries(): void {
        this.observeCurrentList();
        const list = this.findEntriesList();
        if (!list) {
            return;
        }

        for (const entry of list.querySelectorAll<HTMLElement>(':scope > .world_entry')) {
            ensureEntrySummary(this.document, entry, this.scheduleSummaryUpdate);
            if (this.multiSelect || this.selectedUids.size > 0) {
                const uid = getEntryUid(entry);
                entry.classList.toggle(SELECTED_ROW_CLASS, uid !== undefined && this.selectedUids.has(uid));
            }
        }
    }

    private restoreSelectionAfterRender(): void {
        if (!this.selectedEntry?.isConnected) {
            this.clearSelection();
            this.mobileDetailOpen = false;
            this.syncResponsiveMode();
            if (!this.isNarrowMode()) {
                this.selectFirstEntry();
            }
        }
    }

    private syncSelectedWorld(): void {
        const worldName = getSelectedWorldName(this.document);
        if (worldName === this.selectedWorldName) {
            return;
        }

        this.selectedWorldName = worldName;
        this.worldRevision += 1;
        this.clearSelection();
        this.cancelPendingSummaryUpdates();
        this.selectedUids.clear();
        pendingActiveTabsByUid.clear();
        for (const entry of this.document.querySelectorAll<HTMLElement>('.world_entry')) {
            entry.classList.remove(SELECTED_ROW_CLASS);
        }
        this.updateDeleteSelectedButton();
    }

    private onEntryKeyDown(event: KeyboardEvent): void {
        if (this.deleteBusy || event.repeat || (event.key !== 'Enter' && event.key !== ' ')) {
            return;
        }

        const summary = targetToElement(event.target)?.closest<HTMLElement>('.th-modern-wi-row-summary');
        const entry = summary ? getSelectableListEntry(summary) : null;
        if (!entry) {
            return;
        }

        event.preventDefault();
        event.stopImmediatePropagation();
        event.stopPropagation();

        if (this.multiSelect) {
            this.toggleEntrySelected(entry);
            return;
        }

        this.selectEntry(entry);
    }

    private onEntryClick(event: MouseEvent): void {
        if (this.deleteBusy) {
            return;
        }
        const entry = getSelectableListEntry(event.target);
        if (!entry) {
            return;
        }

        if (this.multiSelect) {
            event.preventDefault();
            event.stopImmediatePropagation();
            event.stopPropagation();
            this.toggleEntrySelected(entry);
            return;
        }

        event.preventDefault();
        event.stopImmediatePropagation();
        event.stopPropagation();
        this.selectEntry(entry);
    }

    private selectFirstEntry(): void {
        if (this.selectedEntry?.isConnected) {
            return;
        }

        const first = this.findEntriesList()?.querySelector<HTMLElement>('.world_entry');
        if (first) {
            this.selectEntry(first);
        }
    }

    private clearSelection(): void {
        this.cancelPendingEditorRetry();
        this.cancelPendingSummaryUpdates(this.selectedEntry);
        this.detachEntryEditor();
        this.selectedEntry?.classList.remove(SELECTED_ENTRY_CLASS);
        this.selectedEntry = undefined;
    }

    private selectEntry(entry: HTMLElement): void {
        if (this.selectedEntry === entry) {
            if (!this.editorPane?.childElementCount) {
                this.ensureEntryEditor(entry);
            }
            this.openMobileDetail();
            return;
        }

        this.clearSelection();
        this.selectedEntry = entry;
        entry.classList.add(SELECTED_ENTRY_CLASS);
        this.ensureEntryEditor(entry);
        this.openMobileDetail();
    }

    private ensureEntryEditor(entry: HTMLElement): void {
        this.cancelPendingEditorRetry();
        ensureEntrySummary(this.document, entry, this.scheduleSummaryUpdate);
        if (setupEntryTabs(this.document, entry, this.scheduleSummaryUpdate)) {
            this.attachEntryEditor(entry);
            return;
        }

        const toggle = entry.querySelector<HTMLElement>(':scope > form.world_entry_form > .inline-drawer > .inline-drawer-header .inline-drawer-toggle');
        const content = entry.querySelector<HTMLElement>(':scope > form.world_entry_form > .inline-drawer > .inline-drawer-content.inline-drawer-outlet');
        if (toggle && !content?.querySelector('.world_entry_edit')) {
            toggle.click();
        }

        let attempts = 0;
        const revision = this.editorRetryRevision;
        const retry = () => {
            if (!this.mounted || this.selectedEntry !== entry || revision !== this.editorRetryRevision) {
                return;
            }
            attempts += 1;
            if (setupEntryTabs(this.document, entry, this.scheduleSummaryUpdate)) {
                this.attachEntryEditor(entry);
                return;
            }
            if (attempts > 20) {
                return;
            }
            this.pendingEditorRetry = this.window.setTimeout(() => {
                this.pendingEditorRetry = 0;
                retry();
            }, 50);
        };
        retry();
    }

    private cancelPendingEditorRetry(): void {
        this.editorRetryRevision += 1;
        if (this.pendingEditorRetry) {
            this.window.clearTimeout(this.pendingEditorRetry);
            this.pendingEditorRetry = 0;
        }
    }

    private cancelPendingSummaryUpdates(entry?: HTMLElement): void {
        if (entry) {
            const frame = this.pendingSummaryUpdates.get(entry);
            if (frame !== undefined) {
                this.window.cancelAnimationFrame(frame);
                this.pendingSummaryUpdates.delete(entry);
            }
            return;
        }

        for (const frame of this.pendingSummaryUpdates.values()) {
            this.window.cancelAnimationFrame(frame);
        }
        this.pendingSummaryUpdates.clear();
    }

    private detachEntryEditor(): void {
        const entry = this.selectedEntry;
        for (const item of this.editorMoved) {
            if (item.node.nodeType === 1) {
                (item.node as HTMLElement).classList.remove('th-modern-wi-active-editor-content');
            }
        }
        restoreMovedNodes(this.editorMoved);
        if (entry) {
            updateEntrySummary(entry);
        }
        this.editorPane?.replaceChildren();
    }

    private attachEntryEditor(entry: HTMLElement): void {
        if (!this.editorPane || this.selectedEntry !== entry) {
            return;
        }

        const content = entry.querySelector<HTMLElement>(':scope > form.world_entry_form > .inline-drawer > .inline-drawer-content.inline-drawer-outlet');
        if (!content || content.closest('.th-modern-wi-native-editor')) {
            return;
        }

        this.detachEntryEditor();

        const backButton = createIconButton(this.document, 'menu_button th-modern-wi-mobile-back', '返回世界书条目列表', 'fa-solid fa-arrow-left');
        backButton.append(makeElement(this.document, 'span', '', '返回条目列表'));
        backButton.addEventListener('click', event => {
            event.preventDefault();
            this.closeMobileDetail();
        });

        const host = makeElement(this.document, 'div', `${entry.className} th-modern-wi-editor-entry-host`);
        for (const attribute of Array.from(entry.attributes)) {
            if (attribute.name !== 'class') {
                host.setAttribute(attribute.name, attribute.value);
            }
        }

        const form = makeElement(this.document, 'form', 'world_entry_form');
        const drawer = makeElement(this.document, 'div', 'inline-drawer');
        const updateSummaryFromHost = () => updateEntrySummary(entry, host);
        host.addEventListener('input', updateSummaryFromHost);
        host.addEventListener('change', updateSummaryFromHost);
        form.append(drawer);
        host.append(form);
        this.editorPane.replaceChildren(backButton, host);

        content.classList.add('th-modern-wi-active-editor-content');
        moveNode(content, drawer, this.editorMoved);
        updateEntrySummary(entry, host);
    }

    private toggleMultiSelect(): void {
        if (this.deleteBusy) {
            return;
        }
        this.multiSelect = !this.multiSelect;
        this.findWorldInfo()?.classList.toggle(MULTI_SELECT_CLASS, this.multiSelect);
        this.multiButton?.classList.toggle('active', this.multiSelect);
        if (!this.multiSelect) {
            this.selectedUids.clear();
            for (const entry of this.document.querySelectorAll<HTMLElement>('.world_entry')) {
                entry.classList.remove(SELECTED_ROW_CLASS);
            }
        }
        this.updateDeleteSelectedButton();
    }

    private toggleEntrySelected(entry: HTMLElement): void {
        const uid = getEntryUid(entry);
        if (uid === undefined) {
            return;
        }

        if (this.selectedUids.has(uid)) {
            this.selectedUids.delete(uid);
            entry.classList.remove(SELECTED_ROW_CLASS);
        } else {
            this.selectedUids.add(uid);
            entry.classList.add(SELECTED_ROW_CLASS);
        }
        this.updateDeleteSelectedButton();
    }

    private updateDeleteSelectedButton(): void {
        if (!this.deleteSelectedButton) {
            return;
        }

        const count = this.selectedUids.size;
        this.deleteSelectedButton.hidden = !this.multiSelect || count === 0;
        this.deleteSelectedButton.title = `删除选中条目 (${count})`;
        this.deleteSelectedButton.setAttribute('aria-label', this.deleteSelectedButton.title);
    }

    private setDeleteBusy(busy: boolean): void {
        this.deleteBusy = busy;
        if (this.shell) {
            this.shell.inert = busy;
            if (busy) {
                this.shell.setAttribute('aria-busy', 'true');
            } else {
                this.shell.removeAttribute('aria-busy');
            }
        }
        if (this.multiButton) {
            this.multiButton.disabled = busy;
        }
        if (this.deleteSelectedButton) {
            this.deleteSelectedButton.disabled = busy;
            if (busy) {
                this.deleteSelectedButton.setAttribute('aria-busy', 'true');
            } else {
                this.deleteSelectedButton.removeAttribute('aria-busy');
            }
        }

        if (busy) {
            const element = this.document.querySelector<HTMLSelectElement>('#world_editor_select');
            if (element) {
                this.lockedWorldSelect = { element, wasDisabled: element.disabled };
                element.disabled = true;
            }
        } else if (this.lockedWorldSelect) {
            this.lockedWorldSelect.element.disabled = this.lockedWorldSelect.wasDisabled;
            this.lockedWorldSelect = undefined;
        }
    }

    private isDeleteContextCurrent(worldName: string, revision: number): boolean {
        return this.mounted && this.worldRevision === revision && getSelectedWorldName(this.document) === worldName;
    }

    private async deleteSelectedEntries(): Promise<void> {
        if (this.deleteBusy) {
            return;
        }
        const selected = Array.from(this.selectedUids);
        if (!selected.length) {
            return;
        }

        const worldName = getSelectedWorldName(this.document);
        if (!worldName) {
            toastr.error('无法确定当前正在编辑的世界书');
            return;
        }
        const worldRevision = this.worldRevision;

        const selectedEntries = selected
            .map(uid => this.document.querySelector<HTMLElement>(`.world_entry[uid="${uid}"]`))
            .filter((entry): entry is HTMLElement => Boolean(entry));
        const names = selectedEntries.map(entry => getEntryTitle(entry)).slice(0, 5).join('、');
        const suffix = selected.length > 5 ? ` 等 ${selected.length} 项` : '';
        const message = `确认删除 ${selected.length} 个世界书条目？\n${names}${suffix}`;
        const confirmed = this.window.confirm(message);
        if (!confirmed) {
            return;
        }
        if (!this.isDeleteContextCurrent(worldName, worldRevision)) {
            return;
        }

        const selectedSnapshot = new Set(selected);
        this.setDeleteBusy(true);

        let originalWorldInfo: unknown;
        let saveStarted = false;
        try {
            originalWorldInfo = await SillyTavern.loadWorldInfo(worldName);
            if (!this.isDeleteContextCurrent(worldName, worldRevision)) {
                return;
            }
            if (!originalWorldInfo) {
                throw new Error(`无法读取世界书“${worldName}”`);
            }
            const updatedWorldInfo = removeWorldInfoEntries(originalWorldInfo, selectedSnapshot, this.window);
            if (!this.isDeleteContextCurrent(worldName, worldRevision)) {
                return;
            }
            saveStarted = true;
            await SillyTavern.saveWorldInfo(worldName, updatedWorldInfo, true);
            if (!this.isDeleteContextCurrent(worldName, worldRevision)) {
                return;
            }
        } catch (error) {
            if (saveStarted && originalWorldInfo) {
                try {
                    await SillyTavern.saveWorldInfo(worldName, originalWorldInfo, true);
                } catch (rollbackError) {
                    console.error('[现代化界面] 恢复世界书缓存失败', rollbackError);
                    toastr.error(`恢复世界书原数据失败：${getErrorMessage(rollbackError)}`);
                }
            }
            console.error('[现代化界面] 世界书批量删除失败', error);
            toastr.error(`删除世界书条目失败：${getErrorMessage(error)}`);
            return;
        } finally {
            this.setDeleteBusy(false);
        }

        if (!this.isDeleteContextCurrent(worldName, worldRevision)) {
            return;
        }
        this.clearSelection();
        this.selectedUids.clear();
        for (const entry of this.document.querySelectorAll<HTMLElement>('.world_entry')) {
            entry.classList.remove(SELECTED_ROW_CLASS);
        }
        this.updateDeleteSelectedButton();
        try {
            await SillyTavern.reloadWorldInfoEditor(worldName, true);
        } catch (error) {
            console.error('[现代化界面] 世界书删除成功，但编辑器刷新失败', error);
            toastr.error('条目已删除，但世界书编辑器刷新失败，请手动刷新');
        }
    }
}

export function mountWorldInfoEditor(store: Store): { destroy: () => void } {
    const hostDocument = getHostDocument();
    const hostWindow = getHostWindow() as HostWindow;
    let controller: NativeWorldInfoEnhancer | undefined;
    let observedWorldInfo: HTMLElement | null = null;
    let scheduledSync = 0;

    const findWorldInfo = () => hostDocument.querySelector<HTMLElement>('#WorldInfo');

    const unmount = (): boolean => {
        const didMount = controller?.destroy() ?? false;
        controller = undefined;
        return didMount;
    };

    const sync = () => {
        scheduledSync = 0;
        const shouldEnable = store.is_active && store.settings.modernWorldInfoEditor;
        const worldInfo = findWorldInfo();
        observeWorldInfo(worldInfo);
        const isOpen = worldInfo?.classList.contains('openDrawer') ?? false;
        worldInfo?.classList.toggle(WORLD_INFO_ENABLED_CLASS, shouldEnable && (isOpen || Boolean(controller)));
        if (shouldEnable && isOpen) {
            controller ??= new NativeWorldInfoEnhancer();
            controller.mount();
        } else if (!shouldEnable && unmount()) {
            refreshOriginalEditor(hostDocument);
        }
    };

    const scheduleSync = () => {
        if (scheduledSync) {
            return;
        }
        scheduledSync = hostWindow.requestAnimationFrame(sync);
    };

    const observer = new hostWindow.MutationObserver(scheduleSync);

    function observeWorldInfo(worldInfo: HTMLElement | null): void {
        if (worldInfo === observedWorldInfo) {
            return;
        }

        observer.disconnect();
        observedWorldInfo = worldInfo;
        if (worldInfo) {
            observer.observe(worldInfo, { attributes: true, attributeFilter: ['class'] });
        }
    }

    const stopWatch = watch(
        () => [store.is_active, store.settings.modernWorldInfoEditor] as const,
        scheduleSync,
        { immediate: true },
    );

    return {
        destroy() {
            stopWatch();
            observer?.disconnect();
            if (scheduledSync) {
                hostWindow.cancelAnimationFrame(scheduledSync);
                scheduledSync = 0;
            }
            findWorldInfo()?.classList.remove(WORLD_INFO_ENABLED_CLASS);
            if (unmount()) {
                refreshOriginalEditor(hostDocument);
            }
        },
    };
}

function refreshOriginalEditor(document: Document): void {
    const worldName = getSelectedWorldName(document);
    if (!worldName) {
        return;
    }

    try {
        SillyTavern.reloadWorldInfoEditor(worldName, true);
    } catch (error) {
        console.error('[现代化界面] 恢复原生世界书编辑器失败', error);
        toastr.error('恢复原生世界书编辑器失败，请手动刷新');
    }
}
