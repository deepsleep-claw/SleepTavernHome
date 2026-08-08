(function () {
  const script = document.currentScript;
  const root = script && script.previousElementSibling;
  if (!root || root.dataset.ready === '1') {
    return;
  }

  root.dataset.ready = '1';
  const BREAK_MARKER = '\uE000';

  const syncThemeVariables = function () {
    const themeVariables = [
      '--SmartThemeBodyColor',
      '--SmartThemeQuoteColor',
      '--SmartThemeBorderColor',
      '--SmartThemeBlurTintColor',
      '--SmartThemeShadowColor',
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

  const parseEvents = function (source) {
    const parsed = source.content.cloneNode(true);
    parsed.querySelectorAll('simple_thinking').forEach(function (node) {
      node.remove();
    });

    parsed.querySelectorAll('br').forEach(function (node) {
      node.replaceWith(document.createTextNode(BREAK_MARKER));
    });

    const lines = (parsed.textContent || '')
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map(function (line) {
        return line.trim();
      })
      .filter(Boolean);

    const events = [];
    lines.forEach(function (line) {
      const separatorIndex = line.indexOf('|');
      if (separatorIndex === -1) {
        if (events.length > 0) {
          events[events.length - 1].description += '\n' + line;
        } else {
          events.push({ location: '地点未标注', description: line });
        }
        return;
      }

      const location = line.slice(0, separatorIndex).trim() || '地点未标注';
      const description = line.slice(separatorIndex + 1).trim();
      if (description) {
        events.push({ location: location, description: description });
      }
    });

    return events;
  };

  const makeEvent = function (event, index) {
    const article = document.createElement('article');
    article.className = 'dream-paraller-event-ui__event';

    const heading = document.createElement('div');
    heading.className = 'dream-paraller-event-ui__event-heading';

    const indexNode = document.createElement('span');
    indexNode.className = 'dream-paraller-event-ui__event-index';
    indexNode.textContent = String(index + 1).padStart(2, '0');

    const location = document.createElement('span');
    location.className = 'dream-paraller-event-ui__location';
    location.textContent = event.location;

    const description = document.createElement('p');
    description.className = 'dream-paraller-event-ui__description';
    event.description.split(BREAK_MARKER).forEach(function (part) {
      const partNode = document.createElement('span');
      partNode.className = 'dream-paraller-event-ui__description-part';
      partNode.textContent = part || '\u00A0';
      description.appendChild(partNode);
    });

    heading.append(indexNode, location);
    article.append(heading, description);
    return article;
  };

  syncThemeVariables();

  const source = root.querySelector('.dream-paraller-event-ui__source');
  const eventList = root.querySelector('.dream-paraller-event-ui__events');
  const summaryMeta = root.querySelector('.dream-paraller-event-ui__meta');
  const empty = root.querySelector('.dream-paraller-event-ui__empty');
  if (!source || !eventList) {
    return;
  }

  const events = parseEvents(source);
  events.forEach(function (event, index) {
    eventList.appendChild(makeEvent(event, index));
  });

  if (summaryMeta) {
    summaryMeta.textContent = events.length + ' 则';
  }
  if (empty) {
    empty.hidden = events.length > 0;
  }
})();
