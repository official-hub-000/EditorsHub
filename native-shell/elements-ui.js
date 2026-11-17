/*
 * The Elements screen.
 *
 * Opened from the New Project sheet's ELEMENTS tab and from the editor's Elements drawer.
 * It lists saved elements, inserts one into the open project, exports one to a file, and
 * saves the selected layer as a new element. Full screen, black, one job per row.
 */
(function () {
  'use strict';

  var STYLE_ID = 'omsElementsStyle';

  function installStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
      '#omsElementsView{position:fixed;inset:0;z-index:2147483300;display:flex;',
      'flex-direction:column;background:#000;color:#e7ecf3;',
      'font:400 13px/1.5 system-ui,sans-serif;',
      'padding:calc(10px + env(safe-area-inset-top,0px)) 12px ',
      'calc(10px + env(safe-area-inset-bottom,0px))}',
      '#omsElementsHead{flex:0 0 auto;display:flex;align-items:center;gap:10px;',
      'padding:2px 2px 12px;border-bottom:1px solid #1c1f27}',
      '#omsElementsHead b{flex:1 1 auto;font:800 17px/1.3 system-ui,sans-serif}',
      '#omsElementsHead button{appearance:none;border:1px solid #2b3140;',
      'background:#14171e;color:#c9d2e0;font:700 12px/1 system-ui,sans-serif;',
      'padding:10px 14px;border-radius:10px}',
      '#omsElementsList{flex:1 1 auto;min-height:0;overflow:auto;',
      '-webkit-overflow-scrolling:touch;padding:12px 2px}',
      '.omsElRow{display:flex;align-items:center;gap:10px;padding:12px;',
      'border:1px solid #20242e;border-radius:13px;background:#0c0e13;margin-bottom:9px}',
      '.omsElMeta{flex:1 1 auto;min-width:0}',
      '.omsElMeta b{display:block;font:700 13.5px/1.35 system-ui,sans-serif;',
      'white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.omsElMeta span{display:block;margin-top:3px;font-size:11px;color:#6d7788}',
      '.omsElRow button{appearance:none;border:1px solid #2b3140;background:#171b24;',
      'color:#cbd4e0;font:700 11px/1 system-ui,sans-serif;padding:9px 11px;',
      'border-radius:9px;min-width:56px}',
      '.omsElRow button.use{background:#39ddcf;border-color:#39ddcf;color:#04120f}',
      '.omsElRow button.del{color:#ff8fa3;border-color:#3a2430}',
      '#omsElementsEmpty{padding:34px 16px;text-align:center;color:#6d7788;font-size:12.5px}',
      '#omsElementsFoot{flex:0 0 auto;padding-top:10px;border-top:1px solid #1c1f27}',
      '#omsElementsFoot button{width:100%;appearance:none;border:1px solid #39ddcf;',
      'background:#39ddcf;color:#04120f;font:800 13px/1 system-ui,sans-serif;',
      'padding:15px;border-radius:13px}',
      '#omsElementsFoot button:disabled{background:#14171e;border-color:#242a35;',
      'color:#5b6474}',
    ].join('');
    document.head.appendChild(style);
  }

  function fmtAge(ms) {
    var mins = Math.round((Date.now() - ms) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + 'm ago';
    var hours = Math.round(mins / 60);
    if (hours < 24) return hours + 'h ago';
    return Math.round(hours / 24) + 'd ago';
  }

  function toast(message) {
    if (typeof window.toast === 'function') window.toast(message);
  }

  function view() {
    installStyle();
    var old = document.getElementById('omsElementsView');
    if (old) old.remove();

    var root = document.createElement('div');
    root.id = 'omsElementsView';

    var head = document.createElement('div');
    head.id = 'omsElementsHead';
    var title = document.createElement('b');
    title.textContent = 'Elements';
    var close = document.createElement('button');
    close.type = 'button';
    close.textContent = 'Close';
    close.addEventListener('click', function () { root.remove(); });
    head.appendChild(title);
    head.appendChild(close);

    var listEl = document.createElement('div');
    listEl.id = 'omsElementsList';

    var foot = document.createElement('div');
    foot.id = 'omsElementsFoot';
    var saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.textContent = 'Save selected layer as element';
    foot.appendChild(saveBtn);

    root.appendChild(head);
    root.appendChild(listEl);
    root.appendChild(foot);
    document.body.appendChild(root);

    function refresh() {
      listEl.innerHTML = '';
      window.omsElements.list().then(function (items) {
        if (!items.length) {
          var empty = document.createElement('div');
          empty.id = 'omsElementsEmpty';
          empty.textContent = 'No elements yet. Select a layer in a project, then use ' +
            'Save selected layer as element.';
          listEl.appendChild(empty);
        }
        items.forEach(function (item) {
          var row = document.createElement('div');
          row.className = 'omsElRow';

          var meta = document.createElement('div');
          meta.className = 'omsElMeta';
          var name = document.createElement('b');
          name.textContent = item.name || 'Element';
          var sub = document.createElement('span');
          sub.textContent = (item.kind || 'layer') + ' · ' +
            (item.width || '?') + '×' + (item.height || '?') + ' · ' +
            Math.round((item.duration || 0) * 10) / 10 + 's · ' +
            fmtAge(item.savedAt || Date.now());
          meta.appendChild(name);
          meta.appendChild(sub);

          var use = document.createElement('button');
          use.type = 'button';
          use.className = 'use';
          use.textContent = 'Use';
          use.addEventListener('click', function () {
            try {
              window.omsElements.insert(item);
              toast('Element added');
              root.remove();
            } catch (e) {
              toast(e && e.message ? e.message : 'Could not add that element');
            }
          });

          var share = document.createElement('button');
          share.type = 'button';
          share.textContent = 'Export';
          share.addEventListener('click', function () {
            if (window.omsElements.download(item)) toast('Element exported');
            else toast('Could not export that element');
          });

          var del = document.createElement('button');
          del.type = 'button';
          del.className = 'del';
          del.textContent = 'Delete';
          del.addEventListener('click', function () {
            var ask = window.omsConfirm
              ? window.omsConfirm('Delete "' + (item.name || 'element') + '"?',
                { acceptLabel: 'Delete', cancelLabel: 'Keep' })
              : Promise.resolve(true);
            ask.then(function (yes) {
              if (!yes) return;
              window.omsElements.remove(item.id).then(refresh);
            });
          });

          row.appendChild(meta);
          row.appendChild(use);
          row.appendChild(share);
          row.appendChild(del);
          listEl.appendChild(row);
        });
      }).catch(function (e) {
        listEl.textContent = '';
        var fail = document.createElement('div');
        fail.id = 'omsElementsEmpty';
        fail.textContent = (e && e.message) || 'Could not read saved elements.';
        listEl.appendChild(fail);
      });
    }

    saveBtn.addEventListener('click', function () {
      var element;
      try {
        element = window.omsElements.capture();
      } catch (e) {
        toast(e && e.message ? e.message : 'Select a layer first');
        return;
      }
      var rename = window.__omsDialog
        ? window.__omsDialog({
            title: 'Save as element',
            message: 'Name this element so you can find it later.',
            input: element.name,
            acceptLabel: 'Save',
            cancelLabel: 'Cancel',
          })
        : Promise.resolve(element.name);
      rename.then(function (name) {
        if (name === false || name === null) return;
        element.name = String(name || element.name).slice(0, 60);
        window.omsElements.put(element).then(function () {
          toast('Element saved');
          refresh();
        }).catch(function (e) {
          toast((e && e.message) || 'Could not save that element');
        });
      });
    });

    listEl.style.minHeight = '0';
    refresh();
    return root;
  }

  window.omsElementsUI = { open: view };
})();
