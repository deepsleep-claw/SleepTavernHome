(function () {
  const script = document.currentScript;
  const root = script && script.previousElementSibling;
  if (!root || root.dataset.ready === '1') {
    return;
  }

  root.dataset.ready = '1';

  const THEMES = [
    { id: 'tavern', label: '酒馆皮肤' },
    { id: 'white', label: '白色' },
    { id: 'light-yellow', label: '淡黄色' },
    { id: 'light-blue', label: '淡蓝色' },
    { id: 'light-pink', label: '淡粉色' },
    { id: 'dark-blue', label: '暗蓝色' },
    { id: 'dark-purple', label: '暗紫色' },
  ];
  const MODES = [
    { id: 'direct-send', label: '直接发送' },
    { id: 'append-input', label: '追加到输入框' },
  ];
  const DEFAULT_SETTINGS = { theme: 'tavern', inputMode: 'append-input' };
  const SETTINGS_EVENT = 'dream_option:settings_changed';

  const getHostWindow = function () {
    try {
      return window.parent && window.parent !== window ? window.parent : window;
    } catch (_error) {
      return window;
    }
  };

  const hostWindow = getHostWindow();

  const getCallable = function (name) {
    const candidates = [window, hostWindow];
    for (const candidate of candidates) {
      try {
        if (candidate && typeof candidate[name] === 'function') {
          return candidate[name].bind(candidate);
        }
      } catch (_error) {
        // Continue with the next runtime surface.
      }
    }
    return null;
  };

  const normalizeSettings = function (value) {
    const themeIds = THEMES.map(function (theme) {
      return theme.id;
    });
    const modeIds = MODES.map(function (mode) {
      return mode.id;
    });
    return {
      theme: value && themeIds.includes(value.theme) ? value.theme : DEFAULT_SETTINGS.theme,
      inputMode: value && modeIds.includes(value.inputMode) ? value.inputMode : DEFAULT_SETTINGS.inputMode,
    };
  };

  const getChatId = function () {
    try {
      const sillyTavern = hostWindow.SillyTavern;
      const chatId =
        sillyTavern && typeof sillyTavern.getCurrentChatId === 'function' ? sillyTavern.getCurrentChatId() : '';
      return chatId || 'default';
    } catch (_error) {
      return 'default';
    }
  };

  const getStorage = function () {
    try {
      return hostWindow.localStorage;
    } catch (_error) {
      return null;
    }
  };

  const getStorageKey = function () {
    return 'dream_option.settings:' + getChatId();
  };

  const readStoredSettings = function () {
    const getVariables = getCallable('getVariables');
    if (getVariables) {
      try {
        const variables = getVariables({ type: 'chat' });
        if (variables && variables.dream_option) {
          return normalizeSettings({
            theme: variables.dream_option.skin,
            inputMode: variables.dream_option.input_mode,
          });
        }
      } catch (error) {
        console.warn('[梦境选项框正则UI] 读取聊天变量失败，使用本地设置', error);
      }
    }

    const storage = getStorage();
    if (storage) {
      try {
        return normalizeSettings(JSON.parse(storage.getItem(getStorageKey()) || 'null'));
      } catch (_error) {
        // Ignore malformed fallback data.
      }
    }
    return normalizeSettings(DEFAULT_SETTINGS);
  };

  const writeStoredSettings = function (settings) {
    const normalized = normalizeSettings(settings);
    const updateVariablesWith = getCallable('updateVariablesWith');
    if (updateVariablesWith) {
      try {
        Promise.resolve(
          updateVariablesWith(
            function (variables) {
              const nextVariables = variables || {};
              nextVariables.dream_option = Object.assign({}, nextVariables.dream_option, {
                skin: normalized.theme,
                input_mode: normalized.inputMode,
              });
              return nextVariables;
            },
            { type: 'chat' },
          ),
        ).catch(function (error) {
          console.warn('[梦境选项框正则UI] 保存聊天变量失败', error);
        });
      } catch (error) {
        console.warn('[梦境选项框正则UI] 保存聊天变量失败', error);
      }
    }

    const storage = getStorage();
    if (storage) {
      try {
        storage.setItem(getStorageKey(), JSON.stringify(normalized));
      } catch (_error) {
        // Chat variables remain the preferred persistence layer.
      }
    }

    try {
      const CustomEventConstructor = hostWindow.CustomEvent || CustomEvent;
      hostWindow.dispatchEvent(new CustomEventConstructor(SETTINGS_EVENT, { detail: normalized }));
    } catch (_error) {
      // A single option box still works without cross-floor synchronization.
    }
  };

  const syncThemeVariables = function () {
    const themeVariables = [
      '--SmartThemeBodyColor',
      '--SmartThemeEmColor',
      '--SmartThemeBorderColor',
      '--SmartThemeBlurTintColor',
      '--SmartThemeShadowColor',
    ];

    try {
      const parentDocument = hostWindow.document;
      if (!parentDocument || parentDocument === document) {
        return;
      }
      const candidates = [
        parentDocument.documentElement,
        parentDocument.body,
        parentDocument.querySelector('#sheld'),
        parentDocument.querySelector('#chat'),
      ].filter(Boolean);

      themeVariables.forEach(function (variable) {
        for (const candidate of candidates) {
          const value = hostWindow.getComputedStyle(candidate).getPropertyValue(variable).trim();
          if (value) {
            root.style.setProperty(variable, value);
            return;
          }
        }
      });
    } catch (_error) {
      // Keep CSS fallbacks outside SillyTavern.
    }
  };

  const parseOptions = function (source) {
    const parsed = source.content.cloneNode(true);
    const legacyOptions = Array.from(parsed.querySelectorAll('option'));
    if (legacyOptions.length > 0) {
      return legacyOptions
        .map(function (option) {
          return (option.textContent || '').trim();
        })
        .filter(Boolean);
    }

    return (parsed.textContent || '')
      .split('|')
      .map(function (option) {
        return option.trim();
      })
      .filter(Boolean);
  };

  const getTavernDocument = function () {
    try {
      return hostWindow.document || document;
    } catch (_error) {
      return document;
    }
  };

  const findInput = function (doc) {
    const selectors = ['#send_textarea', 'textarea[name=send_textarea]', 'textarea[placeholder*=Send]', 'textarea'];
    for (const selector of selectors) {
      const target = doc.querySelector(selector);
      if (target) {
        return target;
      }
    }
    return null;
  };

  const fireInputEvents = function (target, doc, text) {
    const view = doc.defaultView || window;
    try {
      target.dispatchEvent(new view.InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    } catch (_error) {
      target.dispatchEvent(new view.Event('input', { bubbles: true }));
    }
    target.dispatchEvent(new view.Event('change', { bubbles: true }));
    if (view.$) {
      view.$(target).trigger('input').trigger('change');
    }
  };

  const appendToInput = function (text) {
    const value = String(text || '').trim();
    const doc = getTavernDocument();
    const target = findInput(doc);
    if (!value || !target) {
      return false;
    }

    target.focus();
    if (target.isContentEditable) {
      const current = target.textContent || '';
      target.textContent = current + (current.trim() ? '\n' : '') + value;
    } else if ('value' in target) {
      const current = target.value || '';
      target.value = current + (current.trim() ? '\n' : '') + value;
      if ('selectionStart' in target) {
        target.selectionStart = target.selectionEnd = target.value.length;
      }
    } else {
      return false;
    }

    fireInputEvents(target, doc, value);
    return true;
  };

  const showWarning = function (message) {
    try {
      const toastr = window.toastr || hostWindow.toastr;
      if (toastr && typeof toastr.warning === 'function') {
        toastr.warning(message);
        return;
      }
    } catch (_error) {
      // Fall through to the console.
    }
    console.warn('[梦境选项框正则UI] ' + message);
  };

  const sendDirectly = async function (text) {
    const createChatMessages = getCallable('createChatMessages');
    const triggerSlash = getCallable('triggerSlash');
    if (createChatMessages && triggerSlash) {
      await createChatMessages([{ role: 'user', message: text }]);
      await triggerSlash('/trigger');
      return true;
    }

    if (!appendToInput(text)) {
      return false;
    }
    const doc = getTavernDocument();
    const sendButton = doc.querySelector('#send_but, [data-testid=send-button]');
    if (!sendButton || sendButton.disabled) {
      return false;
    }
    sendButton.click();
    return true;
  };

  const source = root.querySelector('.dream-option-ui__source');
  const optionList = root.querySelector('.dream-option-ui__list');
  const count = root.querySelector('.dream-option-ui__count');
  const empty = root.querySelector('.dream-option-ui__empty');
  const settingsPanel = root.querySelector('.dream-option-ui__settings');
  const settingsToggle = root.querySelector('.dream-option-ui__settings-toggle');
  const themeList = root.querySelector('.dream-option-ui__theme-list');
  const modeList = root.querySelector('.dream-option-ui__mode-list');
  if (!source || !optionList || !settingsPanel || !settingsToggle || !themeList || !modeList) {
    return;
  }

  let settings = readStoredSettings();

  const updateSettingsControls = function () {
    root.dataset.theme = settings.theme;
    themeList.querySelectorAll('[data-theme]').forEach(function (button) {
      const active = button.dataset.theme === settings.theme;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    modeList.querySelectorAll('[data-mode]').forEach(function (button) {
      const active = button.dataset.mode === settings.inputMode;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  };

  const setSettings = function (nextSettings, persist) {
    settings = normalizeSettings(nextSettings);
    updateSettingsControls();
    if (persist) {
      writeStoredSettings(settings);
    }
  };

  THEMES.forEach(function (theme) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'dream-option-ui__theme';
    button.dataset.theme = theme.id;
    button.setAttribute('aria-pressed', 'false');
    button.title = theme.label;

    const swatch = document.createElement('span');
    swatch.className = 'dream-option-ui__swatch dream-option-ui__swatch--' + theme.id;
    swatch.setAttribute('aria-hidden', 'true');

    const label = document.createElement('span');
    label.textContent = theme.label;
    button.append(swatch, label);
    button.addEventListener('click', function () {
      setSettings({ theme: theme.id, inputMode: settings.inputMode }, true);
    });
    themeList.appendChild(button);
  });

  MODES.forEach(function (mode) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'dream-option-ui__mode';
    button.dataset.mode = mode.id;
    button.setAttribute('aria-pressed', 'false');
    button.textContent = mode.label;
    button.addEventListener('click', function () {
      setSettings({ theme: settings.theme, inputMode: mode.id }, true);
    });
    modeList.appendChild(button);
  });

  settingsToggle.addEventListener('click', function () {
    const expanded = settingsToggle.getAttribute('aria-expanded') === 'true';
    settingsToggle.setAttribute('aria-expanded', String(!expanded));
    settingsPanel.hidden = expanded;
    root.classList.toggle('is-settings-open', !expanded);
  });

  const options = parseOptions(source);
  options.forEach(function (content, index) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'dream-option-ui__option';
    button.setAttribute('role', 'listitem');

    const indexNode = document.createElement('span');
    indexNode.className = 'dream-option-ui__option-index';
    indexNode.textContent = String(index + 1);

    const textNode = document.createElement('span');
    textNode.className = 'dream-option-ui__option-text';
    textNode.textContent = content;
    button.append(indexNode, textNode);

    button.addEventListener('click', async function () {
      if (button.classList.contains('is-pending')) {
        return;
      }
      button.classList.add('is-pending');
      try {
        const handled = settings.inputMode === 'direct-send' ? await sendDirectly(content) : appendToInput(content);
        if (!handled) {
          showWarning(settings.inputMode === 'direct-send' ? '无法发送该选项' : '找不到输入栏');
        }
      } catch (error) {
        console.error('[梦境选项框正则UI] 处理选项失败', error);
        showWarning('处理选项时发生错误');
      } finally {
        button.classList.remove('is-pending');
      }
    });

    optionList.appendChild(button);
  });

  if (count) {
    count.textContent = options.length + ' 项';
  }
  if (empty) {
    empty.hidden = options.length > 0;
  }

  const handleSettingsChanged = function (event) {
    setSettings(event.detail, false);
  };
  try {
    hostWindow.addEventListener(SETTINGS_EVENT, handleSettingsChanged);
    window.addEventListener(
      'pagehide',
      function () {
        hostWindow.removeEventListener(SETTINGS_EVENT, handleSettingsChanged);
      },
      { once: true },
    );
  } catch (_error) {
    // Cross-floor synchronization is optional outside SillyTavern.
  }

  syncThemeVariables();
  updateSettingsControls();
})();
