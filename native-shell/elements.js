/*
 * EditorsHub element library.
 *
 * An Element is not a project. In Alight Motion it is a saved piece of a composition --
 * a set of layers with their animations, colours and settings -- that can be dropped into
 * any other project, and exported to a file to share.
 *
 * The bundled editor has no such concept: it stores whole projects and nothing smaller.
 * This module adds one, on top of things that already exist:
 *
 *   - storage:  IndexedDB, in its own database so it can never disturb a project
 *   - capture:  the model's own layer serialisation, which is what a project save uses
 *   - insert:   the model's own addLayer(), one call per stored layer
 *   - export:   a plain .omsElement.json file, written through the native save path
 *
 * Because it reuses the editor's serialisation rather than inventing a format, an element
 * captured today restores correctly as long as projects do.
 */
(function () {
  'use strict';

  var DB_NAME = 'editorshub-elements';
  var DB_VERSION = 1;
  var STORE = 'elements';
  var dbPromise = null;

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      if (!('indexedDB' in window)) {
        reject(new Error('This device cannot store elements'));
        return;
      }
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'id' });
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('Could not open storage')); };
    });
    return dbPromise;
  }

  function tx(mode, run) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(STORE, mode);
        var store = t.objectStore(STORE);
        var out;
        try {
          out = run(store);
        } catch (e) {
          reject(e);
          return;
        }
        t.oncomplete = function () { resolve(out && out.result !== undefined ? out.result : out); };
        t.onerror = function () { reject(t.error || new Error('Storage error')); };
        t.onabort = function () { reject(t.error || new Error('Storage aborted')); };
      });
    });
  }

  function list() {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(STORE, 'readonly');
        var req = t.objectStore(STORE).getAll();
        req.onsuccess = function () {
          var items = (req.result || []).sort(function (a, b) {
            return (b.savedAt || 0) - (a.savedAt || 0);
          });
          resolve(items);
        };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function remove(id) {
    return tx('readwrite', function (store) { return store.delete(id); });
  }

  function put(element) {
    return tx('readwrite', function (store) { return store.put(element); });
  }

  /**
   * Captures the selected layer as a reusable element.
   *
   * The layer is serialised through the editor's own `cleanLayer`, which is the same path
   * a project save takes, so nested groups, keyframes, effects and media references are
   * all handled identically. Media is captured as a data URL when the layer has one, so an
   * element keeps working after the project it came from is deleted.
   */
  function captureFromSelection() {
    var model = window.model;
    if (!model || !model.selectedLayer) {
      throw new Error('Open a project first');
    }
    var layer = model.selectedLayer();
    if (!layer) throw new Error('Select a layer to save as an element');

    var serialised;
    if (typeof model.cleanLayer === 'function') {
      serialised = model.cleanLayer(layer, { includeMedia: true, captureMedia: true });
    } else {
      serialised = JSON.parse(JSON.stringify(layer));
    }

    // A element is stored relative to its own start, so it can be dropped at any time.
    var baseStart = +serialised.start || 0;
    var layers = [serialised].map(function (l) {
      var copy = JSON.parse(JSON.stringify(l));
      copy.start = Math.max(0, (+copy.start || 0) - baseStart);
      return copy;
    });

    return {
      id: 'el_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7),
      name: (layer.name || 'Element').slice(0, 60),
      kind: layer.type || 'layer',
      width: (model.project && model.project.width) || 1080,
      height: (model.project && model.project.height) || 1920,
      fps: (model.project && model.project.fps) || 30,
      duration: Math.max(0.2, +layer.duration || 2),
      savedAt: Date.now(),
      layers: layers,
    };
  }

  /** Inserts an element's layers into the open project at the playhead. */
  function insert(element) {
    var model = window.model;
    if (!model || !model.project) throw new Error('Open a project first');
    if (!element || !Array.isArray(element.layers) || !element.layers.length) {
      throw new Error('That element is empty');
    }
    var at = Math.max(0, +model.time || 0);
    var added = 0;
    element.layers.forEach(function (stored) {
      var options = Object.assign({}, stored);
      delete options.id;
      options.start = at + Math.max(0, +stored.start || 0);
      try {
        model.addLayer(stored.type || 'shape', options);
        added += 1;
      } catch (e) {
        // A layer type this build does not support: skip it rather than lose the rest.
      }
    });
    if (!added) throw new Error('None of that element could be placed here');
    if (window.ui) {
      try { window.ui.rebuildAll(); } catch (e) { /* optional */ }
      try { window.ui.openInspectorRoot(); } catch (e) { /* optional */ }
    }
    try { window.__omsHistory && window.__omsHistory.push(); } catch (e) { /* optional */ }
    return added;
  }

  function download(element) {
    var payload = {
      format: 'editorshub-element',
      version: 1,
      element: element,
    };
    var text = JSON.stringify(payload, null, 2);
    var name = (element.name || 'element').replace(/[^\w\- ]+/g, '').trim().slice(0, 40) ||
      'element';
    try {
      var blob = new Blob([text], { type: 'application/json' });
      var native = window.EditorsHubNative || window.OpenMotionNative;
      if (native && native.saveBlob) {
        // The native save path takes a base64 payload through the shell's download shim.
        if (window.download) {
          window.download(blob, name + '.omsElement.json');
          return true;
        }
      }
      if (window.download) {
        window.download(blob, name + '.omsElement.json');
        return true;
      }
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = name + '.omsElement.json';
      a.click();
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
      return true;
    } catch (e) {
      return false;
    }
  }

  window.omsElements = {
    list: list,
    put: put,
    remove: remove,
    capture: captureFromSelection,
    insert: insert,
    download: download,
  };
})();
