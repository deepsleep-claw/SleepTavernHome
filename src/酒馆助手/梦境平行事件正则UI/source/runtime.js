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

    const indexNode = document.createElement('span');
    indexNode.className = 'dream-paraller-event-ui__event-index';
    indexNode.textContent = String(index + 1).padStart(2, '0');

    const eventMain = document.createElement('div');
    eventMain.className = 'dream-paraller-event-ui__event-main';

    const location = document.createElement('span');
    location.className = 'dream-paraller-event-ui__location';

    const locationText = document.createElement('span');
    locationText.className = 'dream-paraller-event-ui__location-text';
    locationText.textContent = event.location;
    location.appendChild(locationText);

    const description = document.createElement('p');
    description.className = 'dream-paraller-event-ui__description';
    event.description.split(BREAK_MARKER).forEach(function (part) {
      const partNode = document.createElement('span');
      partNode.className = 'dream-paraller-event-ui__description-part';
      partNode.textContent = part || '\u00A0';
      description.appendChild(partNode);
    });

    eventMain.append(location, description);
    article.append(indexNode, eventMain);
    return article;
  };

  const makeStars = function (container) {
    const fragment = document.createDocumentFragment();
    for (let index = 0; index < 56; index += 1) {
      const star = document.createElement('span');
      star.className = 'dream-paraller-event-ui__star';
      star.style.left = ((index * 47 + 7 + (index % 4) * 9) % 98) + '%';
      star.style.top = ((index * 67 + 5 + (index % 7) * 5) % 96) + '%';
      star.style.setProperty('--dream-paraller-star-size', 1.5 + (index % 4) * 0.65 + 'px');
      star.style.setProperty('--dream-paraller-star-dim', 0.1 + (index % 3) * 0.06);
      star.style.setProperty('--dream-paraller-star-mid', 0.38 + (index % 4) * 0.07);
      star.style.setProperty('--dream-paraller-star-bright', 0.68 + (index % 4) * 0.07);
      star.style.setProperty('--dream-paraller-star-speed', 4.6 + (index % 8) * 0.82 + 's');
      star.style.setProperty('--dream-paraller-star-delay', -(index % 11) * 0.71 + 's');
      star.style.setProperty('--dream-paraller-drift-speed', 15 + (index % 7) * 2.3 + 's');
      star.style.setProperty('--dream-paraller-drift-delay', -(index % 9) * 1.4 + 's');
      fragment.appendChild(star);
    }
    container.appendChild(fragment);
  };

  syncThemeVariables();

  const source = root.querySelector('.dream-paraller-event-ui__source');
  const eventList = root.querySelector('.dream-paraller-event-ui__events');
  const summaryMeta = root.querySelector('.dream-paraller-event-ui__meta');
  const empty = root.querySelector('.dream-paraller-event-ui__empty');
  const stars = root.querySelector('.dream-paraller-event-ui__stars');
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
  if (stars) {
    makeStars(stars);
  }
})();
