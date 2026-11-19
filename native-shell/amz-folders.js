/*
 * Folders for the effect browser.
 *
 * The browser draws one long list grouped only by category chips, which is fine at 93 effects and
 * becomes a scroll-hunt as the catalogue grows. This adds collapsible folders on top of the same
 * list - nothing is rebuilt, nothing is duplicated: the cards keep their ids and their handlers,
 * and a folder is a wrapper element that shows or hides the cards it owns.
 *
 * Because the browser re-renders its HTML on open, the fold is applied afterwards by observing
 * the drawer body. A folder's open state lives in this module, so reopening keeps the layout you
 * left rather than collapsing everything.
 */
(function () {
  'use strict';
  if (window.omsAmzFolders) return;

  /* Folder definitions, in display order. An effect matches the first folder whose test passes,
     so the list stays a partition: every effect is in exactly one folder. */
  var FOLDERS = [
    {
      id: 'particles', label: 'Particles', glyph: '\u2748',
      test: function (spec) { return /particul|particle/i.test(String(spec.id)); },
    },
    {
      id: 'distort', label: 'Distortion', glyph: '\u224b',
      test: function (spec) { return spec.category === 'Distorsi'; },
    },
    {
      id: 'colour', label: 'Colour', glyph: '\u25c9',
      test: function (spec) { return spec.category === 'Warna'; },
    },
    {
      id: 'blur', label: 'Blur', glyph: '\u25cc',
      test: function (spec) { return spec.category === 'Blur'; },
    },
    {
      id: 'style', label: 'Style and texture', glyph: '\u25c7',
      test: function (spec) { return spec.category === 'Stilisasi' || spec.category === 'Detail'; },
    },
    {
      id: 'move', label: 'Motion', glyph: '\u21dd',
      test: function (spec) { return spec.category === 'Gerak'; },
    },
    {
      id: 'generated', label: 'Generators', glyph: '\u2723',
      test: function (spec) { return spec.category === 'Generator' || spec.category === 'Simulasi'; },
    },
    {
      id: 'other', label: 'Other', glyph: '\u00b7',
      test: function () { return true; },
    },
  ];

  var openState = {};
  var installed = false;

  function notify(m) {
    try {
      if (window.omsAmzHub && window.omsAmzHub.notify) return window.omsAmzHub.notify(m);
      if (window.toast) return window.toast(m);
    } catch (e) {}
  }

  function folderFor(spec) {
    for (var i = 0; i < FOLDERS.length; i++) {
      try { if (FOLDERS[i].test(spec)) return FOLDERS[i]; } catch (e) {}
    }
    return null;
  }

  function isOpen(id) {
    return openState[id] === true;
  }

  /**
   * Groups the cards currently in the browser into folders.
   *
   * Cards are matched by the id the browser already put on them (`data-effect-library`), and
   * moved - not copied - into their folder, so every existing click handler keeps working.
   */
  function applyFolders() {
    var list = document.getElementById('effectLibraryList') || document.querySelector('.effectLibraryList');
    if (!list) return false;
    if (list.getAttribute('data-amz-folded') === '1') return true;

    var cards = list.querySelectorAll('[data-effect-library]');
    if (!cards.length) return false;

    var catalog = window.OMS_EFFECT_CATALOG || [];
    var byId = {};
    for (var i = 0; i < catalog.length; i++) byId[catalog[i].id] = catalog[i];

    /* Bucket the cards by folder in document order. */
    var buckets = {}, order = [];
    Array.prototype.forEach.call(cards, function (card) {
      var spec = byId[card.getAttribute('data-effect-library')] || { id: card.getAttribute('data-effect-library') };
      var f = folderFor(spec) || { id: 'other', label: 'Other', glyph: '\u00b7' };
      if (!buckets[f.id]) { buckets[f.id] = { folder: f, cards: [] }; order.push(f.id); }
      buckets[f.id].cards.push(card);
    });

    /* Place folders in the declared order, then anything unmatched at the end. */
    var rank = {};
    FOLDERS.forEach(function (f, idx) { rank[f.id] = idx; });
    order.sort(function (a, b) {
      var ra = rank[a] === undefined ? 999 : rank[a];
      var rb = rank[b] === undefined ? 999 : rank[b];
      return ra - rb;
    });

    var holder = document.createElement('div');
    holder.className = 'amzFolders';

    order.forEach(function (id) {
      var bucket = buckets[id];
      var f = bucket.folder;
      var open = isOpen(f.id);

      var section = document.createElement('section');
      section.className = 'amzFolder' + (open ? ' open' : '');
      section.setAttribute('data-amz-folder', f.id);

      var head = document.createElement('button');
      head.type = 'button';
      head.className = 'amzFolderHead';
      head.innerHTML =
        '<span class="amzFolderGlyph">' + f.glyph + '</span>' +
        '<span class="amzFolderName">' + f.label + '</span>' +
        '<span class="amzFolderCount">' + bucket.cards.length + '</span>' +
        '<span class="amzFolderChev">\u203a</span>';
      head.setAttribute('aria-expanded', String(open));

      var panel = document.createElement('div');
      panel.className = 'amzFolderBody';
      /* The cards keep their own class so the browser's filtering still finds them. */
      bucket.cards.forEach(function (card) {
        /* Effects added by this project sit in their real category next to the built-ins, and
           carry a marker so they are still identifiable. Keeping them in a separate "new"
           folder would hide a blur effect from the Blur folder, which is the opposite of a
           browser. */
        var id = card.getAttribute('data-effect-library') || '';
        if (id.indexOf('amz_') === 0 && !card.querySelector('.amzCardMark')) {
          var mark = document.createElement('span');
          mark.className = 'amzCardMark';
          mark.textContent = '+';
          mark.title = 'Added in EditorsHub';
          card.appendChild(mark);
        }
        panel.appendChild(card);
      });

      head.addEventListener('click', function () {
        var now = section.classList.toggle('open');
        openState[f.id] = now;
        head.setAttribute('aria-expanded', String(now));
      });

      section.appendChild(head);
      section.appendChild(panel);
      holder.appendChild(section);
    });

    list.appendChild(holder);
    list.setAttribute('data-amz-folded', '1');
    return true;
  }

  /**
   * The browser applies its own search and category filter by toggling card display. A folder
   * whose cards are all hidden would otherwise sit there as a heading with empty space under
   * it, so the folder hides too, and the count updates to what actually matches.
   */
  function bindFilterSync() {
    var list = document.getElementById('effectLibraryList') || document.querySelector('.effectLibraryList');
    if (!list) return false;
    if (list.getAttribute('data-amz-filesync') === '1') return true;

    var observer = new MutationObserver(function () {
      var sections = list.querySelectorAll('.amzFolder');
      Array.prototype.forEach.call(sections, function (section) {
        var cards = section.querySelectorAll('[data-effect-library]');
        var shown = 0;
        Array.prototype.forEach.call(cards, function (card) {
          if (card.style.display !== 'none') shown++;
        });
        section.style.display = shown ? '' : 'none';
        var counter = section.querySelector('.amzFolderCount');
        if (counter) counter.textContent = String(shown);
        /* An open folder with matches shows them even if it was collapsed, so search results
           are never hidden behind a closed folder. */
        if (shown) section.classList.add('open');
      });
    });
    observer.observe(list, { subtree: true, attributes: true, attributeFilter: ['style'] });
    list.setAttribute('data-amz-filesync', '1');
    return true;
  }

  /** Watches the drawer for the browser opening, then folds whatever it rendered. */
  function watchBrowser() {
    var observer = new MutationObserver(function () {
      if (!document.querySelector('[data-effect-library]')) return;
      if (applyFolders()) bindFilterSync();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    /* Also try immediately in case the browser is already open. */
    if (applyFolders()) bindFilterSync();
    return true;
  }

  /* Folder chrome. Deliberately quiet - it sits inside the effect browser, which already has
     its own visual language, so it borrows the drawer's colours rather than introducing new
     ones. */
  function injectStyles() {
    if (document.getElementById('amz-folder-style')) return;
    var style = document.createElement('style');
    style.id = 'amz-folder-style';
    style.textContent =
      '.amzFolders{display:flex;flex-direction:column;gap:2px;margin-top:10px}' +
      '.amzFolder{border:1px solid rgba(255,255,255,.07);border-radius:12px;overflow:hidden;background:rgba(255,255,255,.02)}' +
      '.amzFolderHead{display:flex;align-items:center;gap:9px;width:100%;padding:12px 13px;background:none;border:0;color:inherit;font:inherit;cursor:pointer;text-align:left}' +
      '.amzFolderGlyph{width:18px;text-align:center;opacity:.75;font-size:14px}' +
      '.amzFolderName{flex:1;font-weight:600;font-size:13px}' +
      '.amzFolderCount{font-size:11.5px;opacity:.55;font-variant-numeric:tabular-nums}' +
      '.amzFolderChev{transition:transform .18s ease;opacity:.5;font-size:15px;line-height:1}' +
      '.amzFolder.open .amzFolderChev{transform:rotate(90deg)}' +
      '.amzFolderBody{display:none;padding:0 6px 8px;flex-wrap:wrap;gap:8px}' +
      '.amzFolder.open .amzFolderBody{display:flex}' +
      '.amzFolderBody .effectLibraryCard{flex:0 0 auto}' +
      '.amzCardMark{position:absolute;top:5px;right:6px;width:15px;height:15px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;background:rgba(255,255,255,.16)}';
    document.head.appendChild(style);
  }

  function install() {
    if (installed) return true;
    if (!document.body) return false;
    installed = true;
    injectStyles();
    watchBrowser();
    return true;
  }

  window.omsAmzFolders = {
    FOLDERS: FOLDERS,
    install: install,
    applyFolders: applyFolders,
    folderFor: folderFor,
    isOpen: isOpen,
    get installed() { return installed; },
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install);
  } else {
    install();
  }
  var tries = 0;
  var timer = setInterval(function () {
    tries++;
    if (install() || tries > 80) clearInterval(timer);
  }, 500);
})();
