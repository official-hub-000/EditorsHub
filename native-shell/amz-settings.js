/*
 * Settings store for the extra tools — the equivalent of the "Patcher Menu" sheet.
 *
 * Every toggle is a real switch read by the code that it affects. Nothing here is decoration:
 * each key is consumed somewhere in amz-hub.js, amz-tools.js, amz-ai.js or native-shell.js, and
 * the descriptions carry the same specificity as the originals because a setting whose effect
 * cannot be stated is a setting that should not exist.
 *
 * Persistence is localStorage under one key, written synchronously on change so a setting
 * survives the app being killed from the recents list.
 */
(function () {
  'use strict';
  if (window.omsAmzSettings) return;

  var KEY = 'oms.amz.settings.v1';
  var Native = null;
  function native() {
    return (Native = Native || window.EditorsHubNative || window.OpenMotionNative || null);
  }

  /*
   * The catalogue.
   *
   * `group` drives the section headers, `type` drives the control, `default` is what a fresh
   * install gets. `apply` is run whenever the value changes so a switch takes effect without a
   * restart unless it explicitly needs one (`restart: true`).
   */
  var SPECS = [
    // ---------------------------------------------------------------- editor
    { id: 'previewQuality', group: 'Editor', type: 'choice', label: 'Preview Quality',
      options: [['auto', 'Auto'], ['full', 'Full'], ['1/2', '1/2'], ['1/4', '1/4'], ['1/8', '1/8'], ['1/12', '1/12']],
      default: 'auto',
      help: 'Resolution the preview renders at. Export is never affected. Auto picks a scale from the last measured frame time.' },
    { id: 'previewFpsCap', group: 'Editor', type: 'number', label: 'Preview FPS Cap', min: 5, max: 60, default: 60,
      help: 'Maximum frames per second the preview draws. Lower is smoother on slow phones because less work is queued per second.' },
    { id: 'capPreviewFps', group: 'Editor', type: 'bool', label: 'Cap Preview FPS', default: true,
      help: 'Applies Preview FPS Cap. When off, the preview draws as fast as frames arrive.' },
    { id: 'skipLateFrames', group: 'Editor', type: 'bool', label: 'Skip Late Frames', default: true,
      help: 'While playing, a frame already far enough behind the playhead is dropped instead of drawn, so playback catches up rather than showing stale pictures.' },
    { id: 'frameCache', group: 'Editor', type: 'bool', label: 'Frame Cache', default: true,
      help: 'Keeps drawn preview frames in memory so replaying a section is instant the second time. Shows a green line on the ruler where frames are cached.' },
    { id: 'frameCacheMb', group: 'Editor', type: 'number', label: 'Frame Cache Size (MB)', min: 64, max: 1024, default: 192,
      help: 'Memory the frame cache may use. Lower it if the app closes during long previews.' },
    { id: 'lockPreviewButton', group: 'Editor', type: 'bool', label: 'Lock Preview Button', default: true,
      help: 'Shows a lock next to the preview quality control that stops playback while you scrub.' },
    { id: 'confirmLeaveEditor', group: 'Editor', type: 'bool', label: 'Confirm Before Leaving Editor', default: true,
      help: 'Leaving the editor clears cache and undo history, so a confirmation appears first.' },
    { id: 'confirmStyle', group: 'Editor', type: 'choice', label: 'Confirm Style', options: [['dialog', 'Confirm Dialog'], ['doubleback', 'Double Back']], default: 'dialog',
      help: 'How leaving the editor is confirmed: a dialog, or pressing back twice within two seconds.' },
    { id: 'smoothEndAudio', group: 'Editor', type: 'bool', label: 'Smooth End Replay Audio', default: true,
      help: 'Fades preview audio over ~30 ms when playback stops, removing the click. Export audio is untouched.' },
    { id: 'lockCameraWhilePlaying', group: 'Editor', type: 'bool', label: 'Lock Camera View While Playing', default: true,
      help: 'The camera-view button does nothing during playback, so the view cannot switch mid-play.' },
    { id: 'dragSnap', group: 'Editor', type: 'bool', label: 'Preview Drag Snap', default: true,
      help: 'Dragging a layer on the preview snaps its centre and edges to the canvas.' },

    // ------------------------------------------------------------- interface
    { id: 'theme', group: 'Display', type: 'choice', label: 'Theme', options: [['original', 'Original'], ['dark', 'Dark'], ['amoled', 'Amoled']], default: 'original',
      help: 'Original is the light editor chrome. Dark greys the tool screens and dialogs. Amoled is black for OLED panels.' },
    { id: 'iosStyles', group: 'Display', type: 'bool', label: 'iOS Styles', default: false,
      help: 'iOS look for the trim grips and the share button.' },
    { id: 'pillToasts', group: 'Display', type: 'bool', label: 'Pill Toasts', default: true,
      help: 'Rounded pill-shaped messages instead of square ones.' },
    { id: 'hexColor', group: 'Display', type: 'bool', label: 'HEX Color Code', default: true,
      help: 'Shows effect colour values as #RRGGBB instead of three 0–255 numbers.' },
    { id: 'customBackground', group: 'Display', type: 'color', label: 'Custom Background Color', default: '#dd0000',
      help: 'Adds this colour to the background picker in New Project and Composition Settings.' },
    { id: 'animatedThumbs', group: 'Display', type: 'bool', label: 'Animated Effect Thumbnails', default: true,
      help: 'Effect tiles animate instead of showing a still frame.' },
    { id: 'effectPreviewDim', group: 'Display', type: 'bool', label: 'Effect Preview Dim', default: true,
      help: 'Puts a 50% black layer under the text on an effect description page so the title stays readable on bright previews.' },

    // ------------------------------------------------------------- projects
    { id: 'projectSearch', group: 'Home & Projects', type: 'bool', label: 'Project Search Bar', default: true,
      help: 'Shows a search field above the project list.' },
    { id: 'language', group: 'Home & Projects', type: 'choice', label: 'Language',
      options: [['id', 'Bahasa Indonesia'], ['en', 'English'], ['zh', '简体中文'], ['ja', '日本語'], ['ms', 'Bahasa Melayu'], ['th', 'ภาษาไทย'], ['vi', 'Tiếng Việt'], ['fil', 'Filipino'], ['my', 'မြန်မာ'], ['km', 'ខ្មែរ'], ['lo', 'ລາວ'], ['tet', 'Tetun'], ['pt', 'Português'], ['ta', 'தமிழ்'], ['ko', '한국어'], ['tr', 'Türkçe'], ['ru', 'Русский'], ['hi', 'हिन्दी'], ['ar', 'العربية']],
      default: 'en', restart: false,
      help: 'Interface language. Applies immediately.' },
    { id: 'thumbnailFrameOnExport', group: 'Home & Projects', type: 'bool', label: 'Thumbnail Frame on Export', default: false,
      help: 'When a thumbnail frame is set, every video export starts with it as one extra first frame so galleries use it as the cover.' },

    // --------------------------------------------------------------- effects
    { id: 'effectSearchDelay', group: 'Effect Browser', type: 'number', label: 'Effect Search Delay (ms)', min: 50, max: 1000, default: 250,
      help: 'How long the effect list waits after you stop typing before it filters. Lower is faster, higher refreshes less while typing.' },
    { id: 'directEffectChoice', group: 'Effect Browser', type: 'bool', label: 'Direct Effect Choice', default: false,
      help: 'Tapping an effect in the list adds it immediately, without the description page and preset picker.' },

    // ------------------------------------------------------------ performance
    { id: 'autoFillCache', group: 'Performance', type: 'bool', label: 'Auto Fill Frame Cache', default: false,
      help: 'After a project opens and you stop touching the screen, the playhead runs the preview range once to fill the cache, then returns. Needs Frame Cache on.' },
    { id: 'disableTracking', group: 'Performance', type: 'bool', label: 'Disable Ad & Tracking SDKs', default: true, restart: true,
      help: 'This build contains no ad or tracking SDK, so the switch has nothing to disable and is kept only so a ported setting has a home.' },
    { id: 'exportLog', group: 'Performance', type: 'bool', label: 'Export Log', default: false,
      help: 'Writes a per-frame export log to Downloads so a black or broken frame can be traced to the layer that produced it.' },

    // ------------------------------------------------------------------- labs
    { id: 'labsButton', group: 'Labs', type: 'bool', label: 'Labs Floating Button', default: true,
      help: 'Shows the floating button that opens the extra tools on every screen.' },
    { id: 'labsButtonOpacity', group: 'Labs', type: 'number', label: 'Labs Button Opacity (%)', min: 30, max: 100, default: 88,
      help: 'Opacity of the floating labs button.' },
  ];

  var state = {};
  var listeners = [];

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) {}
    var saved = {};
    if (raw) { try { saved = JSON.parse(raw) || {}; } catch (e) { saved = {}; } }
    state = {};
    SPECS.forEach(function (s) {
      state[s.id] = Object.prototype.hasOwnProperty.call(saved, s.id) ? saved[s.id] : s.default;
    });
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
  }

  function get(id) {
    return Object.prototype.hasOwnProperty.call(state, id) ? state[id] : null;
  }

  function set(id, value) {
    var spec = SPECS.filter(function (s) { return s.id === id; })[0];
    if (!spec) return false;
    if (spec.type === 'bool') value = !!value;
    if (spec.type === 'number') {
      value = Math.max(spec.min, Math.min(spec.max, Number(value) || spec.default));
    }
    if (spec.type === 'choice') {
      var ok = spec.options.some(function (o) { return o[0] === value; });
      if (!ok) return false;
    }
    state[id] = value;
    save();
    apply(id);
    listeners.forEach(function (fn) { try { fn(id, value); } catch (e) {} });
    return true;
  }

  function reset() {
    state = {};
    SPECS.forEach(function (s) { state[s.id] = s.default; });
    save();
    SPECS.forEach(function (s) { apply(s.id); });
    listeners.forEach(function (fn) { try { fn('*', null); } catch (e) {} });
  }

  /* --------------------------------------------------------------- effects of a setting */

  function apply(id) {
    try {
      if (id === 'theme' || id === '*') applyTheme();
      if (id === 'labsButton' || id === 'labsButtonOpacity' || id === '*') {
        if (window.omsAmzHub && window.omsAmzHub.syncButton) window.omsAmzHub.syncButton();
      }
      if (id === 'previewQuality' || id === '*') applyPreviewQuality();
      if (id === 'pillToasts' || id === '*') applyPillToasts();
      if (id === 'language' || id === '*') applyLanguage();
      if (id === 'projectSearch' || id === '*') {
        if (window.omsAmzHub && window.omsAmzHub.syncProjectSearch) window.omsAmzHub.syncProjectSearch();
      }
      log('set ' + id + '=' + JSON.stringify(state[id]));
    } catch (e) {
      // A setting that throws must not take the editor down with it.
    }
  }

  function log(message) {
    try {
      var n = native();
      if (n && n.log) n.log('INFO', 'amz: ' + message);
    } catch (e) {}
  }

  /*
   * Theme.
   *
   * Implemented as a document-level attribute plus a small style block, so it re-colours the
   * editor without any component knowing a theme exists. Amoled is dark with true black surfaces;
   * Dark is dark with the standard greys.
   */
  function applyTheme() {
    var theme = get('theme') || 'original';
    document.documentElement.setAttribute('data-amz-theme', theme);
    var el = document.getElementById('amz-theme-style');
    if (!el) {
      el = document.createElement('style');
      el.id = 'amz-theme-style';
      document.head.appendChild(el);
    }
    var dark = theme === 'dark' || theme === 'amoled';
    var black = theme === 'amoled' ? '#000' : '#0d1016';
    var surface = theme === 'amoled' ? '#050506' : '#151a22';
    var line = theme === 'amoled' ? '#1a1a1c' : '#262d38';
    el.textContent = !dark ? '' : (
      /* The editor's own surfaces. These are the names it already uses, so nothing else
         has to change to follow the theme. */
      'html[data-amz-theme] body,' +
      'html[data-amz-theme] .app,' +
      'html[data-amz-theme] #stage,' +
      'html[data-amz-theme] .timelineArea,' +
      'html[data-amz-theme] .transport,' +
      'html[data-amz-theme] #drawer,' +
      'html[data-amz-theme] #home{background:' + black + ' !important;color:#e8edf4 !important;}' +
      'html[data-amz-theme] .projectCard,' +
      'html[data-amz-theme] .mHomeHero,' +
      'html[data-amz-theme] .effectCard,' +
      'html[data-amz-theme] .amActionBtn{background:' + surface + ' !important;border-color:' + line + ' !important;color:#e8edf4 !important;}' +
      'html[data-amz-theme] .miniNote,' +
      'html[data-amz-theme] small{color:#9aa7b8 !important;}' +
      'html[data-amz-theme] input,' +
      'html[data-amz-theme] select,' +
      'html[data-amz-theme] textarea{background:' + surface + ' !important;color:#e8edf4 !important;border-color:' + line + ' !important;}'
    );
  }

  /*
   * Preview quality.
   *
   * The renderer exposes a raster scale. When the setting is a fixed fraction the scale is set
   * directly; on Auto the scale is picked from the measured frame time so a slow device drops
   * resolution instead of frames.
   */
  function applyPreviewQuality() {
    var q = get('previewQuality') || 'auto';
    var scale = q === 'auto' ? null
      : q === 'full' ? 1
      : 1 / Number(String(q).split('/')[1] || 1);
    window.omsAmzPreviewScale = scale;
    if (window.omsAmzHub && window.omsAmzHub.repaint) window.omsAmzHub.repaint();
  }

  function applyPillToasts() {
    var on = get('pillToasts');
    var el = document.getElementById('amz-pill-style');
    if (!el) {
      el = document.createElement('style');
      el.id = 'amz-pill-style';
      document.head.appendChild(el);
    }
    el.textContent = on
      ? '#toast{border-radius:999px !important;padding-left:18px !important;padding-right:18px !important;}'
      : '';
  }

  function applyLanguage() {
    var lang = get('language') || 'en';
    try {
      if (window.omsAmzI18n && window.omsAmzI18n.set) window.omsAmzI18n.set(lang);
      var sel = document.getElementById('langSelect');
      if (sel && sel.value !== lang) sel.value = lang;
      /* Arabic is the one language here that reads right to left. */
      if (window.omsAmzLanguages && window.omsAmzLanguages.applyDirection) {
        window.omsAmzLanguages.applyDirection(lang);
      }
    } catch (e) {}
  }

  var api = {
    SPECS: SPECS,
    get: get,
    set: set,
    reset: reset,
    all: function () { return Object.assign({}, state); },
    byGroup: function () {
      var groups = [];
      var index = {};
      SPECS.forEach(function (s) {
        if (!index[s.group]) { index[s.group] = { name: s.group, items: [] }; groups.push(index[s.group]); }
        index[s.group].items.push(s);
      });
      return groups;
    },
    onChange: function (fn) { if (typeof fn === 'function') listeners.push(fn); },
    applyAll: function () { SPECS.forEach(function (s) { apply(s.id); }); },
    log: log,
  };

  load();
  window.omsAmzSettings = api;

  // Apply after the editor has booted, so the targets exist.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { api.applyAll(); });
  } else {
    setTimeout(function () { api.applyAll(); }, 0);
  }
  setTimeout(function () { api.applyAll(); }, 1500);
})();
