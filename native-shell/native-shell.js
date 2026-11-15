/*
 * Open Motion — Android native shell adapter.
 *
 * Injected into the bundled editor document after load. The upstream application is
 * written for a browser tab, so this file bridges the handful of browser-only paths
 * (downloads, share sheet, install banner, fullscreen, wake lock, Android Back) onto
 * the native hosts exposed by NativeBridge.kt.
 *
 * Nothing here changes the editor's visuals or behaviour: it only replaces platform
 * plumbing. Keep it dependency free and defensive.
 */
(function () {
  'use strict';

  if (window.__omsNativeShellLoaded) return;
  window.__omsNativeShellLoaded = true;

  var Native = window.OpenMotionNative;
  var isNative = !!Native;

  function log() {
    try {
      if (Native && Native.log) Native.log('INFO', Array.prototype.join.call(arguments, ' '));
    } catch (e) {
      /* ignore */
    }
  }

  function toast(message) {
    try {
      if (Native && Native.toast) Native.toast(String(message || ''));
      else if (window.toast) window.toast(String(message || ''));
    } catch (e) {
      /* ignore */
    }
  }

  function blobToBase64(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        var result = String(reader.result || '');
        resolve(result.slice(result.indexOf(',') + 1));
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  function base64ToBlob(base64, mime) {
    var binary = atob(base64 || '');
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime || 'application/octet-stream' });
  }

  /* ------------------------------------------------------------------ bridge */

  var shell = (window.omsNativeShell = window.omsNativeShell || {});

  shell.isNative = isNative;
  shell.platform = 'android';

  shell.blobToBase64 = blobToBase64;
  shell.base64ToBlob = base64ToBlob;

  shell.device = function () {
    try {
      return JSON.parse((Native && Native.deviceInfo()) || '{}');
    } catch (e) {
      return {};
    }
  };

  /**
   * Save an artefact produced by the editor (video, PNG frame, JSON/XML bundle).
   * Uses the Storage Access Framework when available, otherwise the app export folder.
   */
  shell.saveBlob = function (blob, filename, mime) {
    if (!blob || !blob.size) return Promise.reject(new Error('empty blob'));
    var type = mime || blob.type || 'application/octet-stream';
    return blobToBase64(blob).then(function (base64) {
      try {
        Native.saveDocumentBase64(base64, filename, type);
        return filename;
      } catch (e) {
        try {
          Native.saveBase64(base64, filename);
        } catch (inner) {
          /* ignore */
        }
        return filename;
      }
    });
  };

  /** Open the Android share sheet with an exported artefact. */
  shell.shareBlob = function (blob, filename, mime) {
    if (!blob || !blob.size) return Promise.reject(new Error('empty blob'));
    var type = mime || blob.type || 'application/octet-stream';
    return blobToBase64(blob).then(function (base64) {
      try {
        Native.shareBase64(base64, filename, type);
      } catch (e) {
        log('share failed', e);
      }
    });
  };

  shell.keepScreenAwake = function (enabled) {
    try {
      if (Native) Native.setKeepScreenOn(!!enabled);
    } catch (e) {
      /* ignore */
    }
  };

  shell.setImmersive = function (enabled) {
    try {
      if (Native) Native.setImmersive(!!enabled);
    } catch (e) {
      /* ignore */
    }
  };

  shell.pickDocument = function (accept) {
    try {
      Native.pickDocument(accept || '');
    } catch (e) {
      /* ignore */
    }
  };

  shell.listExports = function () {
    try {
      return JSON.parse((Native && Native.listExports()) || '[]');
    } catch (e) {
      return [];
    }
  };

  /* -------------------------------------------------- browser API shims */

  /*
   * Downloads. WebView cannot write to the Downloads folder, and the editor funnels every
   * export through an anchor with a `download` attribute or a `download(blob, name)`
   * helper. Intercept both and hand the bytes to the native layer.
   */
  document.addEventListener(
    'click',
    function (event) {
      var anchor = event.target && event.target.closest ? event.target.closest('a[download]') : null;
      if (!anchor) return;
      var href = anchor.getAttribute('href') || '';
      if (!href || href.indexOf('data:') === 0) return;
      event.preventDefault();
      event.stopPropagation();
      var name = anchor.getAttribute('download') || 'OpenMotion-' + Date.now();
      fetch(href)
        .then(function (response) {
          return response.blob();
        })
        .then(function (blob) {
          return shell.saveBlob(blob, name, blob.type);
        })
        .then(function () {
          toast('Tersimpan: ' + name);
        })
        .catch(function () {
          toast('Gagal menyimpan berkas');
        });
    },
    true
  );

  /* Install surface: the app is already installed. */
  function hideInstallSurface() {
    try {
      document.documentElement.classList.add('omsStandalone', 'omsNativeShell');
      var installBtn = document.getElementById('homeInstallBtn');
      if (installBtn) installBtn.style.display = 'none';
      var banner = document.getElementById('mPwaInstallNotification');
      if (banner) banner.classList.add('hidden');
    } catch (e) {
      /* ignore */
    }
  }
  hideInstallSurface();
  document.addEventListener('DOMContentLoaded', hideInstallSurface);
  [300, 900, 2000, 4000].forEach(function (delay) {
    setTimeout(hideInstallSurface, delay);
  });

  /* Share sheet instead of navigator.share (WebView's implementation is unreliable). */
  if (window.omsExportResultPreview) {
    var preview = window.omsExportResultPreview;
    preview.share = function () {
      var blob = preview.blob;
      var filename = preview.filename || 'open-motion-export.mp4';
      if (!blob || !blob.size) {
        toast('Belum ada hasil ekspor');
        return Promise.resolve();
      }
      return shell.shareBlob(blob, filename, blob.type);
    };
  }

  /* Keep the display awake during export through the native window flag. */
  if (window.omsWakeLock) {
    var lock = window.omsWakeLock;
    var nativeRequest = lock.request ? lock.request.bind(lock) : null;
    var nativeRelease = lock.release ? lock.release.bind(lock) : null;
    lock.request = function (reason) {
      shell.keepScreenAwake(true);
      return nativeRequest ? nativeRequest(reason) : undefined;
    };
    lock.release = function (reason) {
      var stillActive = lock.isActive ? lock.isActive() : false;
      if (!stillActive) shell.keepScreenAwake(false);
      return nativeRelease ? nativeRelease(reason) : undefined;
    };
  }

  /* Fullscreen preview: hide the Android system bars instead of the browser's. */
  var stage = document.getElementById('exportResultStage');
  if (stage) {
    var observer = new MutationObserver(function () {
      var pseudo = stage.classList.contains('omsPseudoFullscreen');
      shell.setImmersive(pseudo);
    });
    observer.observe(stage, { attributes: true, attributeFilter: ['class'] });
  }

  /* ------------------------------------------------------ back + imports */

  shell.onBack = function () {
    try {
      return !!(window.omsAppBackRouter && window.omsAppBackRouter.handleInternalBack());
    } catch (e) {
      return false;
    }
  };

  /**
   * A document shared into the app from a file manager, another app, or the in-app
   * "import" button. Project bundles (.json) and Alight Motion XML both go through the
   * editor's own import inputs, so parsing/validation stays upstream.
   *
   * The upstream handlers are assigned as `input.onchange = ...` and read
   * `event.target.files[0]`, so we feed a real FileList when the engine allows it and
   * otherwise call the handler with a shimmed target.
   */
  var pendingDocuments = [];

  function feedInput(input, file) {
    if (!input) return false;
    try {
      if (typeof DataTransfer === 'function') {
        var transfer = new DataTransfer();
        transfer.items.add(file);
        input.files = transfer.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
    } catch (e) {
      /* fall through to the shim below */
    }
    try {
      Object.defineProperty(input, 'files', {
        configurable: true,
        value: [file]
      });
      var handler = input.onchange;
      if (typeof handler === 'function') {
        handler.call(input, { target: input, type: 'change' });
        return true;
      }
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    } catch (e) {
      log('document feed failed', e && e.message);
      return false;
    }
  }

  function deliverDocument(doc) {
    var blob = base64ToBlob(doc.base64, doc.mime);
    var file = new File([blob], doc.name || 'import', { type: doc.mime || '' });
    shell.incomingFile = file;

    var looksProject =
      /\.(json|xml)$/i.test(file.name) ||
      (doc.mime || '').indexOf('json') >= 0 ||
      (doc.mime || '').indexOf('xml') >= 0;

    var input = document.getElementById(looksProject ? 'projectInput' : 'mediaInput');
    if (!input) input = document.getElementById('projectInput') || document.getElementById('mediaInput');
    return feedInput(input, file);
  }

  /** Waits for the editor to finish booting before handing it a document. */
  function flushDocuments(attempt) {
    attempt = attempt || 0;
    if (!pendingDocuments.length) return;
    var ready = !!(window.ui || window.model) && !!document.getElementById('projectInput');
    if (!ready && attempt < 40) {
      setTimeout(function () {
        flushDocuments(attempt + 1);
      }, 250);
      return;
    }
    var queue = pendingDocuments.splice(0, pendingDocuments.length);
    queue.forEach(function (doc) {
      if (!deliverDocument(doc)) {
        log('could not import', doc && doc.name);
      }
    });
  }

  shell.onDocument = function (doc) {
    if (!doc || !doc.base64) return;
    pendingDocuments.push(doc);
    flushDocuments(0);
  };

  /* PWA service worker is pointless inside the APK (assets already local). */
  if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
    navigator.serviceWorker.getRegistrations().then(function (registrations) {
      registrations.forEach(function (registration) {
        registration.unregister().catch(function () {});
      });
    }).catch(function () {});
  }

  window.dispatchEvent(new Event('omsnative:ready'));
  log('native shell ready');
})();
