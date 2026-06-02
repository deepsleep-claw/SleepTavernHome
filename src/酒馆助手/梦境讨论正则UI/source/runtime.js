(function () {
  const script = document.currentScript;
  const root = script && script.previousElementSibling;
  if (!root || root.dataset.ready === '1') {
    return;
  }

  root.dataset.ready = '1';

  const syncThemeVariables = function () {
    const themeVariables = [
      '--SmartThemeBodyColor',
      '--SmartThemeQuoteColor',
      '--SmartThemeBorderColor',
      '--SmartThemeBlurTintColor',
    ];

    try {
      const parentDocument = window.parent && window.parent.document ? window.parent.document : null;
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
          const value = parentDocument.defaultView.getComputedStyle(candidate).getPropertyValue(variable).trim();
          if (value) {
            root.style.setProperty(variable, value);
            return;
          }
        }
      });
    } catch (_error) {
      // Keep CSS fallbacks when the rendered HTML cannot inspect the parent page.
    }
  };

  syncThemeVariables();

  const source = root.querySelector('.dream-big-discuss-ui__source');
  const grid = root.querySelector('.dream-big-discuss-ui__grid');
  const summaryMeta = root.querySelector('.dream-big-discuss-ui__summary-meta');
  if (!source || !grid) {
    return;
  }

  const parsed = source.content.cloneNode(true);
  const qNodes = Array.from(parsed.querySelectorAll('q'));
  qNodes.forEach(node => node.remove());

  const discuss = (parsed.textContent || '').trim();
  const note = root.querySelector('.dream-big-discuss-ui__note');
  if (discuss && note) {
    note.hidden = false;
    note.textContent = discuss;
  }

  if (summaryMeta) {
    summaryMeta.textContent = qNodes.length + ' 问';
  }

  const lineBreak = String.fromCharCode(10);

  const escapeAttribute = function (text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  };

  const formatDreamAnswer = function (question, answer) {
    return '<dream_answer q="' + escapeAttribute(question) + '">' + lineBreak + answer.trim() + lineBreak + '</dream_answer>';
  };

  const getTavernDocument = function () {
    try {
      return window.parent && window.parent.document ? window.parent.document : document;
    } catch (_error) {
      return document;
    }
  };

  const findInput = function (doc) {
    const selectors = [
      '#send_textarea',
      'textarea#send_textarea',
      'textarea[name=send_textarea]',
      'textarea[placeholder*=Send]',
      'textarea',
    ];
    for (const selector of selectors) {
      const target = doc.querySelector(selector);
      if (target) {
        return target;
      }
    }
    return null;
  };

  const fireInputEvents = function (target, doc, text) {
    try {
      target.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    } catch (_error) {
      target.dispatchEvent(new Event('input', { bubbles: true }));
    }
    target.dispatchEvent(new Event('change', { bubbles: true }));
    if (doc.defaultView && doc.defaultView.$) {
      doc.defaultView.$(target).trigger('input').trigger('change');
    }
  };

  const appendToTavernInput = function (text) {
    const value = String(text || '').trim();
    if (!value) {
      return;
    }

    const doc = getTavernDocument();
    const target = findInput(doc);
    if (!target) {
      console.warn('[梦境大讨论正则UI] 未找到 SillyTavern 输入框');
      return;
    }

    target.focus();

    if (target.isContentEditable) {
      const current = target.textContent || '';
      target.textContent = current + (current.trim() ? lineBreak : '') + value;
      fireInputEvents(target, doc, value);
      return;
    }

    if ('value' in target) {
      const current = target.value || '';
      const addition = current.trim() && !current.endsWith(lineBreak) ? lineBreak + value : value;
      target.value = current + addition;
      if ('selectionStart' in target) {
        target.selectionStart = target.selectionEnd = target.value.length;
      }
      fireInputEvents(target, doc, value);
    }
  };

  const makeQuestionButton = function (question) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'dream-big-discuss-ui__question';
    button.textContent = question;
    button.title = '点击添加空回答标签到输入框';
    button.addEventListener('click', function () {
      appendToTavernInput(formatDreamAnswer(question, ''));
    });
    return button;
  };

  const makeAnswerButton = function (question, answer, index) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'dream-big-discuss-ui__answer';
    button.title = '点击添加该回答到输入框';
    button.addEventListener('click', function () {
      appendToTavernInput(formatDreamAnswer(question, answer));
    });

    const answerIndex = document.createElement('span');
    answerIndex.className = 'dream-big-discuss-ui__answer-index';
    answerIndex.textContent = String(index + 1);

    const answerText = document.createElement('span');
    answerText.className = 'dream-big-discuss-ui__answer-text';
    answerText.textContent = answer;

    button.append(answerIndex, answerText);
    return button;
  };

  const makeCustomForm = function (question) {
    const form = document.createElement('form');
    form.className = 'dream-big-discuss-ui__custom-form';

    const input = document.createElement('input');
    input.className = 'dream-big-discuss-ui__input';
    input.type = 'text';
    input.placeholder = '自定义回答';
    input.addEventListener('keydown', event => event.stopPropagation());

    const confirm = document.createElement('button');
    confirm.className = 'dream-big-discuss-ui__confirm';
    confirm.type = 'submit';
    confirm.textContent = '确认';

    form.append(input, confirm);
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      const value = input.value.trim();
      if (!value) {
        input.focus();
        return;
      }
      appendToTavernInput(formatDreamAnswer(question, value));
      input.value = '';
      input.focus();
    });

    return form;
  };

  const makeCard = function (question, answers) {
    const card = document.createElement('section');
    card.className = 'dream-big-discuss-ui__card';
    card.appendChild(makeQuestionButton(question));

    const answerList = document.createElement('div');
    answerList.className = 'dream-big-discuss-ui__answers';
    answers.forEach(function (answer, index) {
      answerList.appendChild(makeAnswerButton(question, answer, index));
    });

    card.append(answerList, makeCustomForm(question));
    return card;
  };

  qNodes.forEach(function (qNode, index) {
    const question = (qNode.getAttribute('content') || '问题 ' + (index + 1)).trim();
    const answers = Array.from(qNode.querySelectorAll('a'))
      .map(node => (node.textContent || '').trim())
      .filter(Boolean);
    grid.appendChild(makeCard(question, answers));
  });
})();
