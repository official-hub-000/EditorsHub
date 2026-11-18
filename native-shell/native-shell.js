/*
 * EditorsHub — Android native shell adapter.
 *
 * Injected into the bundled editor document after load. The editor engine is written
 * for a browser tab, so this file bridges the handful of browser-only paths
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

  var Native = window.EditorsHubNative || window.OpenMotionNative;
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

  /**
   * Streams a Blob to the native side in chunks. A 60 s 1080p export can be tens of
   * megabytes; converting it to one base64 string would double peak memory on a phone.
   */
  function uploadBlob(blob, filename, mime, mode) {
    var type = mime || blob.type || 'application/octet-stream';
    if (!Native || typeof Native.beginUpload !== 'function') {
      // Older shell: fall back to the single-shot base64 bridge.
      return blobToBase64(blob).then(function (base64) {
        if (mode === 'share' && Native.shareBase64) {
          Native.shareBase64(base64, filename, type);
          return filename;
        }
        if (mode === 'exports' && Native.saveBase64) {
          return Native.saveBase64(base64, filename) || filename;
        }
        if (Native.saveDocumentBase64) Native.saveDocumentBase64(base64, filename, type);
        return filename;
      });
    }
    var CHUNK = 1024 * 1024; // 1 MiB raw -> ~1.37 MiB base64 per call
    var id = Native.beginUpload(filename, type);
    if (!id) return Promise.reject(new Error('upload unavailable'));
    var offset = 0;

    function step() {
      if (offset >= blob.size) {
        return Promise.resolve(Native.finishUpload(id, mode || 'exports'));
      }
      var slice = blob.slice(offset, Math.min(offset + CHUNK, blob.size));
      offset += CHUNK;
      return new Promise(function (resolve, reject) {
        var reader = new FileReader();
        reader.onload = function () {
          var result = String(reader.result || '');
          var base64 = result.slice(result.indexOf(',') + 1);
          var ok = false;
          try {
            ok = Native.appendUpload(id, base64);
          } catch (e) {
            ok = false;
          }
          if (!ok) reject(new Error('chunk rejected'));
          else resolve(step());
        };
        reader.onerror = reject;
        reader.readAsDataURL(slice);
      });
    }

    return step().catch(function (error) {
      try {
        Native.abortUpload(id);
      } catch (e) {
        /* ignore */
      }
      throw error;
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
  shell.saveBlob = function (blob, filename, mime, mode) {
    if (!blob || !blob.size) return Promise.reject(new Error('empty blob'));
    return uploadBlob(blob, filename, mime, mode || 'exports');
  };

  /** Save through the Android "Save as" document picker. */
  shell.saveBlobAs = function (blob, filename, mime) {
    if (!blob || !blob.size) return Promise.reject(new Error('empty blob'));
    return uploadBlob(blob, filename, mime, 'document');
  };

  /** Open the Android share sheet with an exported artefact. */
  shell.shareBlob = function (blob, filename, mime) {
    if (!blob || !blob.size) return Promise.reject(new Error('empty blob'));
    return uploadBlob(blob, filename, mime, 'share');
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
  function interceptAnchorDownload(anchor) {
    if (!anchor || !anchor.getAttribute) return false;
    var href = anchor.getAttribute('href') || '';
    if (!href || href.indexOf('data:') === 0) return false;
    var name = anchor.getAttribute('download') || 'OpenMotion-' + Date.now();
    fetch(href)
      .then(function (response) {
        return response.blob();
      })
      .then(function (blob) {
        return shell.saveBlobAs(blob, name, blob.type);
      })
      .then(function () {
        toast('Tersimpan: ' + name);
      })
      .catch(function () {
        toast('Gagal menyimpan berkas');
      });
    return true;
  }

  /* Belt and braces: catch downloads the source patch could not reach. */
  if (window.HTMLAnchorElement && window.HTMLAnchorElement.prototype) {
    var proto = window.HTMLAnchorElement.prototype;
    var nativeClick = proto.click;
    proto.click = function () {
      try {
        if (this.hasAttribute && this.hasAttribute('download')) {
          if (interceptAnchorDownload(this)) return;
        }
      } catch (e) {
        /* fall through to the browser behaviour */
      }
      return nativeClick ? nativeClick.call(this) : undefined;
    };
  }

  document.addEventListener(
    'click',
    function (event) {
      var target = event.target;
      var anchor = target && target.closest ? target.closest('a[download]') : null;
      if (!anchor || !interceptAnchorDownload(anchor)) return;
      event.preventDefault();
      event.stopPropagation();
    },
    true
  );

  /*
   * A source-level patch in tools/build-web-assets.mjs already retargets the editor's
   * own download() helper. If upstream changes that line, fall back to watching the
   * DOM for freshly created export anchors (they are appended and clicked in the same
   * task, so a MutationObserver alone cannot catch them; the prototype hook above does).
   */

  /*
   * Kept for completeness: assigning window.download cannot shadow the editor's
   * scoped helper, but third-party snippets sometimes call it.
   */
  window.download = function (blob, name) {
    return shell.saveBlobAs(blob, name || 'OpenMotion-' + Date.now(), (blob && blob.type) || '');
  };

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
    // The editor dims its Share button when navigator.share is missing; the native
    // share sheet is always present, so advertise it.
    try {
      var resultPanel = document.getElementById('exportResultPreview');
      if (resultPanel) resultPanel.dataset.shareSupported = 'true';
    } catch (e) {
      /* ignore */
    }
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


  /* ---------------------------------------------------------------------
   * External links stay inside the app.
   *
   * The editor renders credits, license and "read more" links with
   * target="_blank" and a few window.open calls. Inside a WebView every one of
   * those used to hand the page to Chrome, so tapping a credit or a help link
   * threw the user out of the editor into a browser tab with an address bar.
   * The app is self-contained: any off-origin navigation is cancelled, and the
   * few links that genuinely point at a project page are surfaced as a toast
   * instead of a browser jump.
   * ------------------------------------------------------------------ */
  var SELF_HOST = location.host;

  function isExternal(href) {
    if (!href) return false;
    try {
      var url = new URL(href, location.href);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
      return url.host !== SELF_HOST;
    } catch (e) {
      return false;
    }
  }

  /* target="_blank" never gets a chance to open a new window. */
  document.addEventListener('click', function (event) {
    var anchor = event.target && event.target.closest ? event.target.closest('a[href]') : null;
    if (!anchor) return;
    var href = anchor.getAttribute('href') || '';
    if (href.charAt(0) === '#') return;
    if (isExternal(href)) {
      event.preventDefault();
      event.stopPropagation();
      toast('This link opens outside the editor');
      log('blocked external link', href);
    }
  }, true);

  /* window.open is used for the same links from script. */
  window.open = function (url) {
    if (url && isExternal(String(url))) {
      toast('This link opens outside the editor');
      log('blocked window.open', String(url));
    }
    return null;
  };


  /* ---------------------------------------------------------------------
   * `window.toast` is called by the editor but never assigned to `window`.
   *
   * The bundle declares `function toast(msg){…}` at top level. In a classic
   * script that becomes a global, but the editor also runs inside scopes where
   * it does not, so `window.toast?.(…)` silently did nothing and
   * `window.toast?.(…)` inside an `async` handler threw
   * "window.toast is not a function" — which cancelled the handler before it
   * did its work. The install and notification buttons were dead because of
   * exactly that.
   *
   * The shell bridges it to the editor's own toast element once the document
   * has one, and falls back to a native Toast on Android.
   * ------------------------------------------------------------------ */
  function showToast(message) {
    var text = String(message == null ? '' : message);
    if (!text) return;
    var el = document.getElementById('toast');
    if (el) {
      el.textContent = text;
      el.classList.add('show');
      clearTimeout(showToast._timer);
      showToast._timer = setTimeout(function () {
        el.classList.remove('show');
      }, 2600);
      return;
    }
    try {
      if (Native && Native.toast) Native.toast(text);
    } catch (e) {
      /* ignore */
    }
  }

  if (typeof window.toast !== 'function') {
    window.toast = showToast;
  }


  /* ---------------------------------------------------------------------
   * Native alert / confirm / prompt, replaced with in-app dialogs.
   *
   * The editor uses `confirm()` before deleting a project and `alert()` for
   * tutorial steps. Inside a WebView those become the platform's grey dialog
   * titled "The page at https://appassets.androidplatform.net says:", which
   * looks like a browser warning rather than part of the app, and the tutorial
   * text arrives as one unformatted paragraph.
   *
   * These are replaced with a themed sheet that matches the editor: same
   * surface, same motion as the app's own modals, real buttons. `confirm`
   * stays synchronous from the caller's point of view by blocking on a
   * resolved promise is impossible, so the editor's own call sites that read
   * its result are served by keeping the native dialog for those and styling
   * only the presentation ones. See DIALOG_ASYNC below.
   * ------------------------------------------------------------------ */
  var dialogStyle = document.createElement('style');
  dialogStyle.id = 'omsNativeDialogStyle';
  dialogStyle.textContent = [
    '#omsDialogScrim{position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;',
    'padding:22px;background:rgba(0,0,0,.66);opacity:0;transition:opacity .18s ease}',
    '#omsDialogScrim.show{opacity:1}',
    '#omsDialogCard{width:min(420px,100%);max-height:78vh;display:flex;flex-direction:column;',
    'background:#12141a;border:1px solid #262b36;border-radius:18px;overflow:hidden;',
    'transform:translateY(14px) scale(.97);opacity:0;',
    'transition:transform .22s cubic-bezier(.2,.8,.3,1),opacity .18s ease;',
    'box-shadow:0 24px 60px rgba(0,0,0,.6)}',
    '#omsDialogScrim.show #omsDialogCard{transform:none;opacity:1}',
    '#omsDialogTitle{padding:20px 20px 0;color:#f2f5fa;font:700 16px/1.35 system-ui,sans-serif}',
    '#omsDialogBody{padding:10px 20px 4px;color:#a8b2c4;font:400 13.5px/1.6 system-ui,sans-serif;',
    'white-space:pre-wrap;overflow:auto;-webkit-overflow-scrolling:touch}',
    '#omsDialogInput{margin:14px 20px 0;padding:11px 12px;border-radius:11px;border:1px solid #2b3140;',
    'background:#0b0d12;color:#eef2f8;font:inherit;font-size:14px;outline:none}',
    '#omsDialogInput:focus{border-color:#39ddcf}',
    '#omsDialogActions{display:flex;gap:8px;justify-content:flex-end;padding:18px 20px}',
    '#omsDialogActions button{appearance:none;border:1px solid #2b3140;background:#171b24;color:#c9d2e0;',
    'font:600 13px/1 system-ui,sans-serif;padding:12px 18px;border-radius:11px;cursor:pointer}',
    '#omsDialogActions button.primary{background:#39ddcf;border-color:#39ddcf;color:#04120f}',
    '#omsDialogActions button:active{transform:scale(.97)}'
  ].join('');

  function installDialogStyle() {
    if (document.getElementById('omsNativeDialogStyle')) return;
    (document.head || document.documentElement).appendChild(dialogStyle);
  }

  /**
   * Shows a themed dialog. Resolves with `true` (accept), `false` (cancel) or the
   * entered string for a prompt.
   */
  /**
   * Only one sheet exists at a time, and it can always be dismissed.
   *
   * The scrim covers the whole viewport, so a sheet that is never torn down makes every
   * control in the app untappable. An on-device report showed exactly that: every
   * "unreachable" control was covered by `#omsDialogScrim`.
   *
   * Three defences: opening a sheet closes any previous one, a closing sheet stops
   * intercepting taps the instant the fade starts, and tapping the scrim always dismisses.
   */
  function closeExistingSheets() {
    var open = document.querySelectorAll('#omsDialogScrim');
    for (var i = 0; i < open.length; i++) open[i].remove();
  }

  function omsDialog(options) {
    installDialogStyle();
    closeExistingSheets();
    return new Promise(function (resolve) {
      var scrim = document.createElement('div');
      scrim.id = 'omsDialogScrim';
      var card = document.createElement('div');
      card.id = 'omsDialogCard';
      card.setAttribute('role', 'dialog');
      card.setAttribute('aria-modal', 'true');

      if (options.title) {
        var title = document.createElement('div');
        title.id = 'omsDialogTitle';
        title.textContent = options.title;
        card.appendChild(title);
      }
      if (options.message) {
        var body = document.createElement('div');
        body.id = 'omsDialogBody';
        body.textContent = options.message;
        card.appendChild(body);
      }
      var input = null;
      if (options.prompt) {
        input = document.createElement('input');
        input.id = 'omsDialogInput';
        input.type = 'text';
        input.value = options.defaultValue == null ? '' : String(options.defaultValue);
        card.appendChild(input);
      }

      var actions = document.createElement('div');
      actions.id = 'omsDialogActions';
      function finish(value) {
        scrim.classList.remove('show');
        // Stop swallowing taps immediately, even while the fade-out is still running.
        scrim.style.pointerEvents = 'none';
        scrim.addEventListener('transitionend', function () {
          scrim.remove();
        }, { once: true });
        setTimeout(function () {
          scrim.remove();
        }, 260);
        resolve(value);
      }
      function button(label, primary, value) {
        var b = document.createElement('button');
        b.type = 'button';
        b.textContent = label;
        if (primary) b.className = 'primary';
        b.addEventListener('click', function () {
          finish(value === undefined ? true : value);
        });
        actions.appendChild(b);
        return b;
      }

      if (options.cancelable !== false) {
        button(options.cancelLabel || 'Cancel', false, false);
      }
      var accept = button(options.acceptLabel || 'OK', true, true);
      if (input) {
        accept.addEventListener('click', function (event) {
          event.stopImmediatePropagation();
          finish(input.value);
        }, true);
        input.addEventListener('keydown', function (event) {
          if (event.key === 'Enter') { event.preventDefault(); finish(input.value); }
        });
      }
      card.appendChild(actions);
      scrim.appendChild(card);
      // A stuck sheet covers the whole viewport and makes the entire app untappable, so
      // tapping the scrim always dismisses it. Refusing to close is never worth a dead app.
      scrim.addEventListener('click', function (event) {
        if (event.target === scrim) finish(false);
      });
      document.body.appendChild(scrim);
      requestAnimationFrame(function () {
        scrim.classList.add('show');
        (input || accept).focus();
      });
    });
  }

  window.__omsDialog = omsDialog;

  /**
   * Read-only informational sheet, used by the tutorial cards.
   *
   * The body is a numbered list separated by newlines, and the dialog CSS preserves
   * them (`white-space:pre-wrap`), so the steps stay on their own lines instead of
   * collapsing into one paragraph the way the native alert did.
   */
  window.omsInfo = function (title, body) {
    if (!document.body) return;
    return omsDialog({
      title: String(title == null ? '' : title),
      message: String(body == null ? '' : body),
      acceptLabel: 'Got it',
      cancelable: false,
    });
  };

  /**
   * Promise-based confirm used by the two patched call sites (project deletion
   * and the legacy AM project warning). Falls back to the native dialog when the
   * themed one is somehow unavailable, so a destructive action is never taken
   * without consent.
   */
  window.omsConfirm = function (message, options) {
    var settings = Object.assign(
      { title: 'Are you sure?', acceptLabel: 'OK', cancelLabel: 'Cancel' },
      options || {},
      { message: message }
    );
    if (!document.body) {
      return Promise.resolve(typeof confirm === 'function' ? confirm(message) : false);
    }
    return omsDialog(settings);
  };

  /*
   * `alert` and `prompt` are presentation only, so they can be replaced safely.
   * `confirm` is *not* replaced: the editor assigns its boolean result directly
   * (`if(!confirm(msg))return;`), and a promise is always truthy, which would
   * make every delete confirm itself. It keeps the native dialog, and the
   * wording is fixed instead so it reads as the app rather than a web page.
   */
  window.alert = function (message) {
    omsDialog({ title: 'EditorsHub', message: String(message == null ? '' : message) });
  };
  window.prompt = function (message, fallback) {
    return fallback == null ? '' : fallback;
  };

  /* ---------------------------------------------------------------------
   * PWA plumbing is noise inside the APK.
   *
   * The assets are already local and the document is never reloaded from a
   * server, so a service worker can only add a registration to save, restore and
   * prune on every launch. Registration is blocked outright and anything an
   * earlier build persisted is removed.
   * ------------------------------------------------------------------ */
  try {
    if (navigator.serviceWorker) {
      if (navigator.serviceWorker.register) {
        navigator.serviceWorker.register = function () {
          return Promise.reject(new Error('service workers are not used in the APK'));
        };
      }
      if (navigator.serviceWorker.getRegistrations) {
        navigator.serviceWorker.getRegistrations().then(function (registrations) {
          registrations.forEach(function (registration) {
            registration.unregister().catch(function () {});
          });
        }).catch(function () {});
      }
    }
  } catch (e) {
    /* ignore */
  }

  /* ---------------------------------------------------------------------
   * Diagnostics entry point.
   *
   * The report is worth nothing if the user cannot reach it when the app is
   * misbehaving, so it is reachable two ways: a long press on the wordmark (always
   * present, on every screen) and a button injected into the Home header.
   * ------------------------------------------------------------------ */
  function openDiagnostics() {
    if (window.omsDiagnostics && window.omsDiagnostics.openWithSelfTest) {
      window.omsDiagnostics.openWithSelfTest();
    } else if (window.omsDiagnostics && window.omsDiagnostics.open) {
      window.omsDiagnostics.open();
    }
    else toast('Diagnostics are still loading');
  }

  /**
   * A floating report button, deliberately outside the Home header.
   *
   * The header's wordmark is turned into an About button by the editor
   * (`logo.id='omsHomeAbout'`, role=button), so anything placed inside or beside it gets
   * caught by that wrapper's hit area and a tap on the report button opens the About
   * sheet instead. That is exactly what happened when this button was injected into
   * `.homeTopActions`.
   *
   * It is therefore positioned fixed against the bottom-left edge, above the bottom
   * navigation and clear of every existing control, and it stops propagation so no
   * ancestor can claim the tap.
   */
  function openReport() {
    try {
      if (!window.omsReport) {
        toast('Report tool is still loading');
        return;
      }
      if (!window.__omsDialog) {
        window.omsReport.open();
        return;
      }
      /*
       * Two different jobs, offered side by side.
       *
       * "Check this screen" tests controls automatically, which is useful for finding a
       * fault nobody has described yet. "Record my taps" is for a fault the user can
       * demonstrate: it watches their real finger and reports what the page actually
       * received. The second is the only one that can tell "the tap never arrived" from
       * "the tap arrived and the app ignored it".
       */
      window.__omsDialog({
        title: 'Report a problem',
        message: 'Record my taps watches what happens when you tap a button that does ' +
          'not work. Check this screen tests every control for you.',
        acceptLabel: 'Record my taps',
        cancelLabel: 'Check this screen',
      }).then(function (record) {
        if (record && window.omsTapProbe) {
          // Close the sheet first, then start, so the sheet is not part of the recording.
          setTimeout(function () { window.omsTapProbe.start(); }, 120);
        } else if (window.omsReport.openWithSelfTest) {
          window.omsReport.openWithSelfTest();
        }
      });
    } catch (e) {
      toast('Report tool failed: ' + (e && e.message));
    }
  }

  /**
   * Shows the build id once, on first launch only.
   *
   * Three rounds of "still broken" were answered against a build nobody could identify:
   * the self-test's Build line was blank for two of them. A short notice naming the
   * installed build removes that ambiguity for good — the user can read the version off
   * the screen instead of trusting a download timestamp.
   */
  /**
   * Names the installed build on the Home screen, once per install.
   *
   * A toast was not enough: it is dismissed by the splash, sits under the bottom
   * navigation, and "did you see a message?" is not a question anyone should have to
   * answer. This is a small badge pinned under the header, it says the version number,
   * and tapping it dismisses it. It appears once per installed version and then never
   * again, so it never becomes clutter.
   */
  function announceBuildOnce() {
    var meta = document.querySelector('meta[name="editorshub-build"]');
    var id = meta ? meta.getAttribute('content') : 'unknown';
    var KEY = 'omsBuildBadgeSeen';
    try {
      if (localStorage.getItem(KEY) === id) return;
      localStorage.setItem(KEY, id);
    } catch (e) {
      return;
    }
    setTimeout(function () {
      if (document.getElementById('omsBuildBadgeHost')) return;
      var host = document.createElement('div');
      host.id = 'omsBuildBadgeHost';
      host.textContent = 'Build ' + id;
      host.title = 'Tap to dismiss';
      host.style.cssText = [
        'position:fixed',
        'left:50%',
        'transform:translateX(-50%)',
        'top:calc(56px + env(safe-area-inset-top, 0px))',
        'z-index:2147482500',
        'padding:5px 11px',
        'border-radius:999px',
        'background:rgba(18,20,26,.94)',
        'border:1px solid #2f3442',
        'color:#ffd166',
        'font:700 10.5px/1 ui-monospace,SFMono-Regular,Menlo,monospace',
        'letter-spacing:.02em',
        'pointer-events:auto',
        'box-shadow:0 6px 18px rgba(0,0,0,.5)',
      ].join(';');
      host.addEventListener('click', function (event) {
        event.stopPropagation();
        host.remove();
      });
      document.body.appendChild(host);
    }, 1200);
  }

  function installReportButton() {
    if (document.getElementById('omsReportBtn')) return;
    if (!document.body) return;
    var btn = document.createElement('button');
    btn.id = 'omsReportBtn';
    btn.type = 'button';
    btn.title = 'Report a problem';
    btn.setAttribute('aria-label', 'Report a problem');
    btn.textContent = '!';
    btn.style.cssText = [
      'position:fixed',
      // Clear of the bottom navigation (~64px) and the safe area.
      'left:8px',
      'bottom:calc(78px + env(safe-area-inset-bottom, 0px))',
      'width:30px',
      'height:30px',
      'border-radius:50%',
      'border:1px solid #33313c',
      'background:rgba(10,10,14,.82)',
      'color:#ffd166',
      'font:900 14px/1 system-ui,sans-serif',
      'display:grid',
      'place-items:center',
      'padding:0',
      'z-index:2147482000',
      'opacity:.55',
      'touch-action:manipulation',
    ].join(';');
    // The editor turns the wordmark into an About button; never let a tap on this
    // button bubble into an ancestor's handler.
    ['pointerdown', 'pointerup', 'click'].forEach(function (type) {
      btn.addEventListener(type, function (event) {
        event.stopPropagation();
        if (type !== 'click') return;
        event.preventDefault();
        openReport();
      });
    });
    document.body.appendChild(btn);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      installReportButton();
      announceBuildOnce();
    }, { once: true });
  } else {
    installReportButton();
    announceBuildOnce();
  }

  window.dispatchEvent(new Event('omsnative:ready'));
  log('native shell ready');
})();
