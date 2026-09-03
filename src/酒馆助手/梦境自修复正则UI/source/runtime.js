(function () {
  const script = document.currentScript;
  const root = script && script.previousElementSibling;
  if (!root || root.dataset.ready === '1') {
    return;
  }

  root.dataset.ready = '1';

  const ACTION_EVENT = 'dream-self-repair:action';
  const RESULT_EVENT = 'dream-self-repair:result';
  const STATE_REQUEST_EVENT = 'dream-self-repair:state-request';
  const STATE_EVENT = 'dream-self-repair:state';
  const PATCHED_HEADLINE = '梦魇已除，今夜正好……';
  const CLEAN_HEADLINE = '美梦当时，尚无纰漏……';

  const source = root.querySelector('.dream-self-repair-ui__source');
  const headline = root.querySelector('.dream-self-repair-ui__headline');
  const reviewText = root.querySelector('.dream-self-repair-ui__review-text');
  const changes = root.querySelector('.dream-self-repair-ui__changes');
  const patchList = root.querySelector('.dream-self-repair-ui__patch-list');
  const result = root.querySelector('.dream-self-repair-ui__result');
  const resultText = root.querySelector('.dream-self-repair-ui__result-text');
  const repatchButton = root.querySelector('.dream-self-repair-ui__button--repatch');
  const reverseButton = root.querySelector('.dream-self-repair-ui__button--reverse');
  if (
    !source ||
    !headline ||
    !reviewText ||
    !changes ||
    !patchList ||
    !result ||
    !resultText ||
    !repatchButton ||
    !reverseButton
  ) {
    return;
  }

  const sourceText = source.value || source.textContent || '';
  const requestPrefix = 'dsr-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
  let requestSequence = 0;
  let activeRequestId = '';
  let stateRequestId = '';
  let connectionTimer;
  let actionTimer;
  let isBusy = false;
  let hasPatch = false;
  let hasActiveRecords = false;

  const getHost = function () {
    try {
      const hostDocument = window.parent && window.parent.document ? window.parent.document : null;
      const hostWindow = hostDocument && hostDocument.defaultView;
      return hostDocument && hostWindow ? { document: hostDocument, window: hostWindow } : null;
    } catch (_error) {
      return null;
    }
  };

  const host = getHost();

  const syncThemeVariables = function () {
    if (!host) {
      return;
    }
    const variables = [
      '--SmartThemeBodyColor',
      '--SmartThemeBorderColor',
      '--SmartThemeBlurTintColor',
      '--SmartThemeShadowColor',
    ];
    const candidates = [
      host.document.documentElement,
      host.document.body,
      host.document.querySelector('#sheld'),
      host.document.querySelector('#chat'),
    ].filter(Boolean);

    variables.forEach(function (variable) {
      for (const candidate of candidates) {
        const value = host.window.getComputedStyle(candidate).getPropertyValue(variable).trim();
        if (value) {
          root.style.setProperty(variable, value);
          return;
        }
      }
    });
  };

  const extractTag = function (content, tag) {
    const matched = content.match(new RegExp('<' + tag + '\\b[^>]*>([\\s\\S]*?)<\\/' + tag + '>', 'i'));
    return matched ? matched[1] : '';
  };

  const parsePatchText = function (patchText) {
    const normalized = String(patchText || '')
      .replace(/\r\n?/g, '\n')
      .replace(/^\n+|\n+$/g, '');
    if (!normalized.trim()) {
      return [];
    }

    return normalized
      .split(/\n[ \t]*\n(?=FIND:[ \t]*)/)
      .map(function (block, index) {
        const matched = block.match(/^FIND:[ \t]*([\s\S]*?)\nREPLACE:[ \t]?([\s\S]*)$/);
        return matched ? { find: matched[1], replace: matched[2], index: index } : null;
      })
      .filter(Boolean);
  };

  const makePatchRow = function (kind, label, text) {
    const row = document.createElement('div');
    row.className = 'dream-self-repair-ui__patch-row dream-self-repair-ui__patch-row--' + kind;

    const labelNode = document.createElement('span');
    labelNode.className = 'dream-self-repair-ui__patch-label';
    labelNode.textContent = label;

    const code = document.createElement('pre');
    code.className = 'dream-self-repair-ui__patch-code';
    code.textContent = text || (kind === 'replace' ? '∅（删除匹配内容）' : '');
    row.append(labelNode, code);
    return row;
  };

  const updateButtons = function () {
    repatchButton.disabled = isBusy || !hasPatch;
    reverseButton.disabled = isBusy || !hasActiveRecords;
  };

  const renderSource = function () {
    const review = extractTag(sourceText, 'review').trim();
    const patchText = extractTag(sourceText, 'patch');
    const patches = parsePatchText(patchText);

    hasPatch = patches.length > 0;
    root.dataset.hasPatch = hasPatch ? '1' : '0';
    headline.textContent = hasPatch ? PATCHED_HEADLINE : CLEAN_HEADLINE;
    reviewText.textContent = review || (hasPatch ? '已完成正文自检与修正。' : '本轮梦境未发现需要修正的内容。');
    changes.hidden = !hasPatch;

    patches.forEach(function (patch) {
      const card = document.createElement('article');
      card.className = 'dream-self-repair-ui__patch-card';
      card.append(makePatchRow('find', '原文', patch.find), makePatchRow('replace', '修正', patch.replace));
      patchList.appendChild(card);
    });

    updateButtons();
    return patchText;
  };

  const patchText = renderSource();

  const getMessageId = function () {
    const names = [
      window.name,
      window.frameElement && window.frameElement.id,
      window.frameElement && window.frameElement.getAttribute('name'),
    ].filter(Boolean);
    for (const name of names) {
      const matched = String(name).match(/^TH-message--(\d+)--/);
      if (matched) {
        return Number(matched[1]);
      }
    }

    try {
      const message = window.frameElement && window.frameElement.closest('.mes[mesid]');
      const messageId = message && Number(message.getAttribute('mesid'));
      return Number.isInteger(messageId) ? messageId : null;
    } catch (_error) {
      return null;
    }
  };

  const messageId = getMessageId();

  const setResult = function (message, tone) {
    resultText.textContent = message || '';
    result.dataset.tone = tone || 'info';
  };

  const setBusy = function (busy) {
    isBusy = busy;
    root.dataset.busy = busy ? '1' : '0';
    updateButtons();
  };

  const applyState = function (state) {
    const value = state || {};
    root.dataset.status = value.status || 'idle';
    hasActiveRecords = (value.active_count || 0) > 0;
    updateButtons();

    if (!value.last_result) {
      setResult(hasPatch ? '尚无可用的修复记录' : '未发现需要修正的内容', 'info');
      return;
    }

    const last = value.last_result;
    const skipped = last.skipped_count ? ' · 跳过 ' + last.skipped_count + ' 项' : '';
    if (last.action === 'reverse') {
      setResult('已还原 ' + last.success_count + ' 项' + skipped, last.success_count ? 'info' : 'error');
    } else {
      setResult('已应用 ' + last.success_count + ' 项' + skipped, last.success_count ? 'info' : 'error');
    }
  };

  const dispatch = function (eventName, detail) {
    if (!host) {
      return false;
    }
    host.document.dispatchEvent(new host.window.CustomEvent(eventName, { detail: detail }));
    return true;
  };

  const nextRequestId = function () {
    requestSequence += 1;
    return requestPrefix + '-' + requestSequence;
  };

  const onState = function (event) {
    const detail = event.detail || {};
    if (detail.request_id !== stateRequestId || detail.message_id !== messageId) {
      return;
    }
    clearTimeout(connectionTimer);
    applyState(detail.state);
  };

  const onResult = function (event) {
    const detail = event.detail || {};
    if (detail.request_id !== activeRequestId || detail.message_id !== messageId) {
      return;
    }
    clearTimeout(actionTimer);
    setBusy(false);
    if (detail.state) {
      applyState(detail.state);
    } else {
      setResult(detail.message || (detail.ok ? '操作完成' : '操作失败'), detail.ok ? 'info' : 'error');
    }
  };

  const requestAction = function (action) {
    if (!host || messageId === null) {
      setResult('无法连接梦境自修复脚本或识别当前楼层', 'error');
      return;
    }
    if (action === 'repatch' && !hasPatch) {
      setResult('当前自检块没有可用的 Patch', 'error');
      return;
    }
    if (action === 'reverse' && !hasActiveRecords) {
      setResult('当前没有可反 Patch 的成功记录', 'error');
      return;
    }

    activeRequestId = nextRequestId();
    setBusy(true);
    setResult(action === 'repatch' ? '正在重新 Patch…' : '正在反 Patch…', 'info');
    dispatch(ACTION_EVENT, {
      request_id: activeRequestId,
      message_id: messageId,
      action: action,
      patch_text: action === 'repatch' ? patchText : undefined,
    });
    actionTimer = setTimeout(function () {
      setBusy(false);
      setResult('脚本未返回操作结果，请确认梦境自修复脚本已启用', 'error');
    }, 6000);
  };

  syncThemeVariables();
  repatchButton.addEventListener('click', function () {
    requestAction('repatch');
  });
  reverseButton.addEventListener('click', function () {
    requestAction('reverse');
  });

  if (!host || messageId === null) {
    setResult('无法访问酒馆页面或识别当前楼层', 'error');
    setBusy(false);
    return;
  }

  host.document.addEventListener(STATE_EVENT, onState);
  host.document.addEventListener(RESULT_EVENT, onResult);
  stateRequestId = nextRequestId();
  connectionTimer = setTimeout(function () {
    hasActiveRecords = false;
    updateButtons();
    setResult('梦境自修复脚本未连接', 'error');
  }, 1800);
  dispatch(STATE_REQUEST_EVENT, { request_id: stateRequestId, message_id: messageId });

  window.addEventListener('pagehide', function () {
    clearTimeout(connectionTimer);
    clearTimeout(actionTimer);
    host.document.removeEventListener(STATE_EVENT, onState);
    host.document.removeEventListener(RESULT_EVENT, onResult);
  });
})();
