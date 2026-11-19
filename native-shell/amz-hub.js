/*
 * The shell around the extra tools: the floating labs button, the settings sheet, the theme
 * picker, the feedback dialog, project search, and the home-screen changelog card.
 *
 * Every element this creates is added to the existing document rather than replacing anything,
 * so the editor keeps working if any of it fails to run. Where a control duplicates a function
 * the editor already has (preview quality, sort), it calls the editor's own code path instead of
 * reimplementing it.
 */
(function () {
  'use strict';
  if (window.omsAmzHub) return;

  var S = null;
  function settings() {
    return (S = S || window.omsAmzSettings || null);
  }
  function native() { return window.EditorsHubNative || window.OpenMotionNative || null; }
  function log(m) { try { var n = native(); if (n && n.log) n.log('INFO', 'amz-hub: ' + m); } catch (e) {} }
  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function notify(msg) {
    try {
      if (typeof window.toast === 'function') return window.toast(msg);
      var t = document.getElementById('toast');
      if (t) { t.textContent = msg; t.classList.add('show'); clearTimeout(t._t); t._t = setTimeout(function () { t.classList.remove('show'); }, 1700); }
    } catch (e) {}
  }

  /* ------------------------------------------------------------------ styles */

  var CSS = [
    ':root{--amz-accent:#2ee6a8;--amz-accent-ink:#04241c;--amz-surface:#151a22;--amz-surface-2:#1d2430;--amz-line:rgba(255,255,255,.09);--amz-text:#e8edf4;--amz-muted:#93a1b3;}',
    '.amzFab{position:fixed;right:16px;bottom:calc(96px + env(safe-area-inset-bottom,0px));width:52px;height:52px;border-radius:50%;border:0;background:#22262b;color:#e8edf4;display:grid;place-items:center;z-index:9000;box-shadow:0 10px 28px rgba(0,0,0,.45);cursor:pointer;transition:transform .15s,opacity .15s;}',
    '.amzFab:active{transform:scale(.94)}',
    '.amzFab svg{width:26px;height:26px}',
    '.amzSheet{position:fixed;inset:0;z-index:9500;display:grid;place-items:center;padding:16px;background:rgba(4,7,12,.62);backdrop-filter:blur(3px);animation:amzFade .16s ease-out}',
    '.amzSheet.closing{animation:amzFadeOut .14s ease-in forwards}',
    '@keyframes amzFade{from{opacity:0}to{opacity:1}}',
    '@keyframes amzFadeOut{from{opacity:1}to{opacity:0}}',
    '.amzCard{width:100%;max-width:520px;max-height:min(88vh,860px);display:flex;flex-direction:column;background:var(--amz-surface);color:var(--amz-text);border-radius:22px;overflow:hidden;box-shadow:0 24px 70px rgba(0,0,0,.6);}',
    '.amzHead{display:flex;align-items:center;gap:10px;padding:18px 18px 10px;}',
    '.amzHead h2{margin:0;font-size:19px;font-weight:700;letter-spacing:.2px;flex:1}',
    '.amzHead .amzSub{display:block;font-size:11.5px;font-weight:500;color:var(--amz-muted);letter-spacing:.3px;margin-top:3px}',
    '.amzX{width:34px;height:34px;border-radius:50%;border:0;background:rgba(255,255,255,.07);color:#fff;font-size:18px;line-height:1;cursor:pointer;flex:none}',
    '.amzBody{overflow:auto;padding:4px 14px 14px;-webkit-overflow-scrolling:touch}',
    '.amzFoot{display:flex;gap:10px;padding:12px 14px calc(14px + env(safe-area-inset-bottom,0px));border-top:1px solid var(--amz-line)}',
    '.amzBtn{flex:1;height:46px;border-radius:14px;border:0;font-size:14.5px;font-weight:700;letter-spacing:.3px;cursor:pointer;background:rgba(255,255,255,.08);color:var(--amz-text)}',
    '.amzBtn.primary{background:var(--amz-accent);color:var(--amz-accent-ink)}',
    '.amzBtn.danger{background:#5a1f21;color:#ffd9d9}',
    '.amzGroup{margin:14px 4px 6px;font-size:11px;font-weight:800;letter-spacing:1.1px;color:var(--amz-accent);text-transform:uppercase}',
    '.amzRow{display:flex;align-items:flex-start;gap:12px;padding:12px 12px;border-radius:14px;background:var(--amz-surface-2);margin-bottom:8px;}',
    '.amzRow .amzText{flex:1;min-width:0}',
    '.amzRow b{display:block;font-size:14px;font-weight:600;line-height:1.3}',
    '.amzRow p{margin:4px 0 0;font-size:11.5px;line-height:1.45;color:var(--amz-muted)}',
    '.amzSw{position:relative;width:46px;height:27px;border-radius:14px;background:rgba(255,255,255,.15);border:0;flex:none;cursor:pointer;transition:background .16s}',
    '.amzSw::after{content:"";position:absolute;top:3px;left:3px;width:21px;height:21px;border-radius:50%;background:#fff;transition:transform .16s}',
    '.amzSw[aria-checked="true"]{background:var(--amz-accent)}',
    '.amzSw[aria-checked="true"]::after{transform:translateX(19px)}',
    '.amzSeg{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}',
    '.amzSeg button{flex:1;min-width:64px;height:34px;border-radius:10px;border:1px solid var(--amz-line);background:transparent;color:var(--amz-text);font-size:12.5px;cursor:pointer}',
    '.amzSeg button[aria-pressed="true"]{background:var(--amz-accent);border-color:var(--amz-accent);color:var(--amz-accent-ink);font-weight:700}',
    '.amzNum{width:88px;height:38px;border-radius:11px;border:1px solid var(--amz-line);background:rgba(0,0,0,.25);color:var(--amz-text);text-align:center;font-size:14px;flex:none}',
    '.amzSearch{display:flex;align-items:center;gap:8px;margin:6px 4px 4px;padding:0 12px;height:44px;border-radius:14px;background:var(--amz-surface-2)}',
    '.amzSearch input{flex:1;border:0;background:transparent;color:var(--amz-text);font-size:14px;outline:none}',
    '.amzSearch svg{width:18px;height:18px;color:var(--amz-muted);flex:none}',
    '.amzList{margin:0;padding:0;list-style:none}',
    '.amzTool{display:flex;align-items:center;gap:12px;padding:14px 14px;border-radius:16px;background:var(--amz-surface-2);margin-bottom:8px;cursor:pointer}',
    '.amzTool .amzToolIcon{width:38px;height:38px;border-radius:12px;background:rgba(46,230,168,.13);color:var(--amz-accent);display:grid;place-items:center;flex:none}',
    '.amzTool .amzToolIcon svg{width:20px;height:20px}',
    '.amzTool .amzToolText{flex:1;min-width:0}',
    '.amzTool b{display:block;font-size:14.5px}',
    '.amzTool p{margin:3px 0 0;font-size:11.5px;line-height:1.4;color:var(--amz-muted)}',
    '.amzTool .chev{color:var(--amz-accent);font-size:20px;line-height:1;flex:none}',
    '.amzChips{display:flex;gap:8px;padding:2px 4px 10px;overflow:auto}',
    '.amzChips button{flex:none;height:34px;padding:0 14px;border-radius:999px;border:1px solid var(--amz-line);background:transparent;color:var(--amz-text);font-size:12.5px;cursor:pointer}',
    '.amzChips button[aria-pressed="true"]{background:var(--amz-accent);color:var(--amz-accent-ink);border-color:var(--amz-accent);font-weight:700}',
    '.amzDrop{border:2px dashed var(--amz-line);border-radius:18px;padding:28px 18px;text-align:center;margin-bottom:12px}',
    '.amzDrop b{display:block;font-size:14.5px;margin-bottom:6px}',
    '.amzDrop small{display:block;color:var(--amz-muted);font-size:11.5px;line-height:1.5}',
    '.amzDrop .amzBtn{margin-top:14px;display:inline-block;padding:0 24px;flex:none}',
    '.amzField,.amz-field{margin:0 4px 14px}',
    '.amzLabel,.amz-label{display:block;font-size:11.5px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:var(--amz-muted);margin:0 2px 7px}',
    '.amzMuted,.amz-muted{font-size:12px;color:var(--amz-muted);word-break:break-word}',
    '.amzSelect,.amz-select{width:100%;height:44px;border-radius:13px;border:1px solid var(--amz-line);background:var(--amz-surface-2);color:var(--amz-text);font-size:14px;padding:0 12px}',
    '.amzCheck,.amz-check{display:flex;align-items:center;gap:9px;font-size:13.5px;color:var(--amz-text)}',
    '.amzActions{margin:6px 4px 14px}',
    '.amzSmall,.amz-small{height:34px;padding:0 14px;font-size:12.5px;flex:none}',
    '.amzJob,.amz-job{margin:0 4px 14px;padding:12px 12px;border-radius:14px;background:var(--amz-surface-2)}',
    '.amzStatus,.amz-status{font-size:12.5px;color:var(--amz-text);margin-bottom:8px}',
    '.amz-bar{height:8px;border-radius:6px;background:rgba(255,255,255,.12);overflow:hidden;margin:0 0 10px}',
    '.amz-fill{display:block;height:100%;background:var(--amz-accent);width:0;transition:width .18s}',
    '.amzResult,.amz-result{margin:6px 4px 8px;padding:14px 14px;border-radius:16px;background:var(--amz-surface-2)}',
    '.amzResultH,.amz-result-h{font-size:14.5px;font-weight:700;margin-bottom:10px}',
    '.amzKV,.amz-kv{display:flex;justify-content:space-between;gap:12px;padding:6px 0;font-size:12.5px;border-bottom:1px solid var(--amz-line)}',
    '.amzKV:last-child,.amz-kv:last-child{border-bottom:0}',
    '.amzK,.amz-k{color:var(--amz-muted);flex:none}',
    '.amzV,.amz-v{font-weight:600;text-align:right;word-break:break-word;min-width:0}',
    '.amzNote,.amz-note{margin:12px 0 0;font-size:11.5px;line-height:1.55;color:var(--amz-muted)}',
    '.amzPreview,.amz-preview{width:100%;border-radius:12px;display:block;margin:12px 0;background:#0a0d13}',
    '.amzResult .amz-btn,.amz-result .amz-btn,.amzResult .amzBtn,.amz-result .amzBtn{flex:1;height:44px;border-radius:13px;border:0;font-size:13.5px;font-weight:700;background:rgba(255,255,255,.09);color:var(--amz-text);cursor:pointer}',
    '.amzResult .amz-btn.amz-primary,.amz-result .amz-btn.amz-primary{background:var(--amz-accent);color:var(--amz-accent-ink)}',
    '.amz-btn:disabled{opacity:.45}',
    '.amz-panel,.amzPanel{display:block}',
    '.amzShapeHeading{grid-column:1/-1;margin:14px 2px 6px;font-size:11px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:#93a1b3;}',
    '.amzShapeHeading:first-child{margin-top:4px}',
    '.amzShapeChips{display:flex;flex-wrap:wrap;gap:7px;margin:0 2px 10px}',
    '.amzShapeChip{height:36px;padding:0 13px;border-radius:999px;border:1px solid var(--amz-line);background:var(--amz-surface-2);color:var(--amz-text);font-size:12.5px;cursor:pointer}',
    '.amzShapeChip:active{background:var(--amz-accent);color:var(--amz-accent-ink)}',
    '.amzSearch{width:100%;height:42px;margin:0 0 12px;padding:0 14px;border-radius:12px;border:1px solid var(--amz-line);background:var(--amz-surface-2);color:var(--amz-text);font-size:14px;box-sizing:border-box}',
    '.amzSearch::-webkit-search-cancel-button{filter:grayscale(1);opacity:.6}',
    '.amzEmpty{margin:14px 4px;color:var(--amz-muted);font-size:13px;text-align:center}',
    '.amzRow2,.amz-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}',
    '.amz-row.amz-actions .amz-btn,.amzActions .amz-btn,.amz-row.amz-actions .amzBtn{flex:1;min-width:130px;height:46px;border-radius:14px;border:0;font-size:14px;font-weight:700;background:rgba(255,255,255,.08);color:var(--amz-text);cursor:pointer}',
    '.amz-row.amz-actions .amz-btn.amz-primary{background:var(--amz-accent);color:var(--amz-accent-ink)}',
    '.amz-field > .amz-row > .amz-btn,.amzField > .amz-row > .amz-btn{flex:none;padding:0 16px;height:42px;border-radius:13px;border:0;font-size:13.5px;font-weight:700;background:var(--amz-accent);color:var(--amz-accent-ink);cursor:pointer}',
    '.amz-good{color:var(--amz-accent)}',
    '.amz-mid{color:#e8c46a}',
    '.amz-bad{color:#e8796f}',
    '.amz-list{margin:8px 0 0;padding:0;list-style:none}',
    '.amzInfo{display:flex;justify-content:space-between;gap:10px;padding:9px 12px;border-radius:11px;background:var(--amz-surface-2);margin-bottom:6px;font-size:12.5px}',
    '.amzInfo span:first-child{color:var(--amz-muted)}',
    '.amzInfo span:last-child{font-weight:600;text-align:right;word-break:break-word;max-width:62%}',
    '.amzOk{color:var(--amz-accent) !important}',
    '.amzBar{height:8px;border-radius:6px;background:rgba(255,255,255,.12);overflow:hidden;margin:14px 4px 8px}',
    '.amzBar i{display:block;height:100%;background:var(--amz-accent);width:0;transition:width .18s}',
    '.amzPct{font-size:12.5px;color:var(--amz-muted);margin:0 4px 12px}',
    '.amzPreview{width:100%;border-radius:16px;background:#0a0d13;display:block;margin-bottom:12px;image-rendering:auto}',
    '.amzGrid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px}',
    '.amzGrid figure{margin:0;background:var(--amz-surface-2);border-radius:12px;overflow:hidden}',
    '.amzGrid figcaption{font-size:11px;color:var(--amz-muted);padding:6px 8px}',
    '.amzGrid canvas{width:100%;display:block}',
    '.amzToast{position:fixed;left:50%;bottom:calc(120px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);background:#111;color:#fff;font-size:13px;padding:11px 20px;border-radius:999px;z-index:9800;box-shadow:0 8px 24px rgba(0,0,0,.4)}',
    /* Home screen additions, styled to sit inside the existing light home layout. */
    '.amzHomeCard{background:#fff;border-radius:20px;padding:18px;margin:12px 0;box-shadow:0 2px 12px rgba(0,0,0,.05)}',
    '.amzHomeCard h3{margin:0 0 4px;font-size:22px;font-weight:800;color:#2b5fa8;letter-spacing:-.2px}',
    '.amzHomeCard .amzCredit{font-size:12.5px;color:#8a93a3;margin-bottom:10px}',
    '.amzHomeCard p{margin:0 0 12px;font-size:13px;line-height:1.5;color:#4a5361}',
    '.amzHomeFold{border-top:1px solid #eceff4;display:flex;align-items:center;justify-content:space-between;padding:14px 0;font-size:15px;font-weight:600;color:#1d2430;cursor:pointer}',
    '.amzHomeFold .pm{color:#2b5fa8;font-size:20px;font-weight:500;line-height:1}',
    '.amzHomeFoldBody{display:none;padding:0 0 12px 0;margin:0;list-style:none}',
    '.amzHomeFoldBody.open{display:block}',
    '.amzHomeFoldBody li{position:relative;padding:5px 0 5px 16px;font-size:12.5px;line-height:1.5;color:#4a5361}',
    '.amzHomeFoldBody li::before{content:"·";position:absolute;left:4px;color:#9aa4b3;font-weight:800}',
    '.amzHomeBtns{display:flex;gap:10px;margin-top:14px}',
    '.amzHomeBtns button{flex:1;height:48px;border-radius:14px;border:0;background:#eceff4;color:#1d2430;font-size:14px;font-weight:700;cursor:pointer}',
    '.amzThemePop{position:fixed;top:64px;left:12px;z-index:9400;background:#fff;border-radius:18px;padding:8px;box-shadow:0 16px 40px rgba(0,0,0,.22);min-width:200px}',
    '.amzThemePop button{display:flex;align-items:center;gap:12px;width:100%;height:48px;padding:0 14px;border:0;border-radius:12px;background:transparent;font-size:15px;color:#1d2430;cursor:pointer}',
    '.amzThemePop button[aria-pressed="true"]{background:#e7e9ff}',
    '.amzThemePop .dot{width:22px;height:22px;border-radius:50%;border:2px solid #cfd6e0;flex:none}',
    '@media (prefers-reduced-motion: reduce){.amzSheet,.amzSheet.closing{animation:none}}',
  ].join('\n');

  function injectStyles() {
    if (document.getElementById('amz-hub-style')) return;
    var s = el('style');
    s.id = 'amz-hub-style';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  /* ------------------------------------------------------------------- sheet engine */

  var openSheets = [];

  /**
   * Opens a sheet.
   * @param {{title:string, subtitle?:string, build:(body:HTMLElement, close:()=>void)=>void,
   *          footer?:Array<{label:string, primary?:boolean, danger?:boolean, onClick?:Function}>,
   *          wide?:boolean}} opts
   */
  function sheet(opts) {
    injectStyles();
    var wrap = el('div', 'amzSheet');
    var card = el('div', 'amzCard');
    var head = el('div', 'amzHead');
    head.appendChild(el('h2', null, esc(opts.title) + (opts.subtitle ? '<span class="amzSub">' + esc(opts.subtitle) + '</span>' : '')));
    var closeBtn = el('button', 'amzX', '&#215;');
    closeBtn.setAttribute('aria-label', 'Close');
    head.appendChild(closeBtn);
    var body = el('div', 'amzBody');
    card.appendChild(head);
    card.appendChild(body);

    function close() {
      var i = openSheets.indexOf(wrap);
      if (i >= 0) openSheets.splice(i, 1);
      wrap.classList.add('closing');
      setTimeout(function () { wrap.remove(); }, 150);
    }
    closeBtn.onclick = close;
    wrap.addEventListener('click', function (e) { if (e.target === wrap) close(); });

    if (opts.footer && opts.footer.length) {
      var foot = el('div', 'amzFoot');
      opts.footer.forEach(function (f) {
        var b = el('button', 'amzBtn' + (f.primary ? ' primary' : '') + (f.danger ? ' danger' : ''), esc(f.label));
        b.onclick = function () { if (f.onClick) f.onClick(close, body); };
        foot.appendChild(b);
      });
      card.appendChild(foot);
    }

    wrap.appendChild(card);
    document.body.appendChild(wrap);
    openSheets.push(wrap);
    try { opts.build(body, close); } catch (e) { body.appendChild(el('p', null, 'Failed to open: ' + esc(e.message))); }
    return { element: wrap, body: body, close: close };
  }

  /* ---------------------------------------------------------------- floating button */

  var fab = null;

  var LABS_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round">' +
    '<path d="M9 3h6M10 3v5.2L4.8 18c-.6 1.1.2 2.5 1.5 2.5h11.4c1.3 0 2.1-1.4 1.5-2.5L14 8.2V3"/>' +
    '<path d="M7.4 15h9.2"/></svg>';

  function syncButton() {
    var s = settings();
    var show = s ? s.get('labsButton') !== false : true;
    var opacity = s ? Number(s.get('labsButtonOpacity')) / 100 : 0.88;
    if (!show) {
      if (fab) { fab.remove(); fab = null; }
      return;
    }
    if (!fab) {
      injectStyles();
      fab = el('button', 'amzFab', LABS_ICON);
      fab.id = 'amzLabsFab';
      fab.setAttribute('aria-label', 'Extra tools');
      fab.onclick = openLabs;
      document.body.appendChild(fab);
    }
    fab.style.opacity = String(isFinite(opacity) ? opacity : 0.88);
  }

  /* ----------------------------------------------------------------------- labs menu */

  var LABS = [
    { id: 'codec', name: 'Codec Evaluation', icon: 'chip', desc: 'What this phone can decode, what the renderer is, and whether the encoder is loaded.' },
    { id: 'depth', name: 'Depth Map Generator', icon: 'layers', desc: 'A depth map from a picture or the first frame of a video, plus an optional displacement layer.' },
    { id: 'matt', name: 'Background Remover', icon: 'scissors', desc: 'Cuts a subject out to a transparent PNG. Uses the editor matte when loaded, colour and edge analysis when not.' },
    { id: 'upscale', name: 'AI Upscale', icon: 'expand', desc: '2×, 3× or 4× enlargement with edge-aware sharpening instead of a plain stretch.' },
    { id: 'anticompress', name: 'TikTok Anti Compress', icon: 'tag', desc: 'Smooths the blockiness and mosquito noise a low-bitrate video leaves behind, then re-sharpens what is real.' },
    { id: 'twistor', name: 'Twixtor', icon: 'speed', desc: 'Re-times a clip by synthesising in-between frames from measured motion.' },
    { id: 'deadframe', name: 'Dead Frame Remover', icon: 'frame', desc: 'Finds the frames that carry no change and lists where they are.' },
    { id: 'stabilizer', name: 'Stabilizer', icon: 'wave', desc: 'Measures the shake between frames and writes a stabilised frame plus the offsets to key.' },
    { id: 'audioconv', name: 'Audio Converter', icon: 'audio', desc: 'Changes the sample rate or channel count and writes a WAV.' },
    { id: 'rife', name: 'AI Frame Interpolation', icon: 'frames', desc: 'Doubles the frame rate by generating the frames in between, from measured motion.' },
    { id: 'denoise', name: 'Audio Denoise', icon: 'noise', desc: 'Removes sensor grain from a still by discarding high-frequency detail below a threshold.' },
    { id: 'reverse', name: 'Reverse Video', icon: 'reverse', desc: 'Plays a clip backwards, with the option to reverse its audio too.' },
    { id: 'convert', name: 'Convert Video', icon: 'convert', desc: 'Rewrites a file as MP4, WebM, WAV, PNG or JPEG.' },
    { id: 'doctor', name: 'Project Doctor', icon: 'stethoscope', desc: 'Checks the open project for missing media, empty layers and bad timings before an export.' },
    { id: 'labs3d', name: 'Depth 3D Photo', icon: 'cube', desc: 'Shades a still as a relief surface using its depth map, for a picture with depth.' },
  ];

  var ICONS = {
    chip: '<path d="M8 8h8v8H8z"/><path d="M4 9h2M4 15h2M18 9h2M18 15h2M9 4v2M15 4v2M9 18v2M15 18v2"/>',
    layers: '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 13 9 5 9-5"/>',
    scissors: '<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><path d="M20 4 8.5 15.5M20 20 8.5 8.5"/>',
    expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
    tag: '<path d="M4 4h8l8 8-8 8-8-8V4Z"/><circle cx="8.5" cy="8.5" r="1.5"/>',
    speed: '<path d="M12 20a8 8 0 1 1 8-8"/><path d="m12 12 5-4"/>',
    frame: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M8 5v14M16 5v14"/>',
    wave: '<path d="M2 12c2.5 0 2.5-7 5-7s2.5 14 5 14 2.5-7 5-7 1.5 3 5 3"/>',
    audio: '<path d="M4 10v4M8 6v12M12 3v18M16 7v10M20 10v4"/>',
    frames: '<rect x="2" y="6" width="8" height="12" rx="1.5"/><rect x="14" y="6" width="8" height="12" rx="1.5"/>',
    noise: '<path d="M3 12h2l2-6 2 12 2-9 2 6 2-3 2 4 2-6 2 8"/>',
    reverse: '<path d="M20 12a8 8 0 1 0-8 8"/><path d="m16 16 4 4-4 4" transform="translate(0 -4)"/>',
    convert: '<path d="M4 7h13l-3-3M20 17H7l3 3"/>',
    stethoscope: '<path d="M6 3v6a5 5 0 0 0 10 0V3"/><path d="M11 14v3a4 4 0 0 0 8 0v-2"/><circle cx="19" cy="13" r="2"/>',
    cube: '<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/>',
  };

  function toolIcon(name) {
    var body = ICONS[name] || ICONS.chip;
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' + body + '</svg>';
  }

  function openLabs() {
    sheet({
      title: 'EditorsHub Labs',
      subtitle: 'Extra tools',
      build: function (body) {
        LABS.forEach(function (tool) {
          var row = el('div', 'amzTool');
          row.innerHTML =
            '<div class="amzToolIcon">' + toolIcon(tool.icon) + '</div>' +
            '<div class="amzToolText"><b>' + esc(tool.name) + '</b><p>' + esc(tool.desc) + '</p></div>' +
            '<div class="chev">&#8250;</div>';
          row.onclick = function () {
            if (!window.omsAmzTools || !window.omsAmzTools.open) {
              notify(tool.name + ' is still loading');
              return;
            }
            window.omsAmzTools.open(tool.id);
          };
          body.appendChild(row);
        });
        var settingsRow = el('div', 'amzTool');
        settingsRow.innerHTML =
          '<div class="amzToolIcon">' + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="3.2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1"/></svg>' + '</div>' +
          '<div class="amzToolText"><b>Settings</b><p>Preview quality, frame cache, theme, language and every other switch.</p></div>' +
          '<div class="chev">&#8250;</div>';
        settingsRow.onclick = openSettings;
        body.appendChild(settingsRow);
        body.appendChild(menuRow('effects'));
        body.appendChild(menuRow('shapes'));
        body.appendChild(el('div', 'amzGroup', 'Text'));
        body.appendChild(menuRow('shiftKf'));
        body.appendChild(menuRow('splitText'));
        body.appendChild(el('div', 'amzGroup', 'Layers'));
        body.appendChild(menuRow('selectAll'));
        body.appendChild(menuRow('hideAll'));
        body.appendChild(menuRow('linkCamera'));
        body.appendChild(menuRow('linkNull'));
        body.appendChild(el('div', 'amzGroup', 'Storage'));
        body.appendChild(menuRow('clearCache'));
      },
      footer: [{ label: 'Close' }],
    });
  }

  /* ------------------------------------------------------------- extra effects & shapes */

  var MENU = {
    effects: {
      title: 'Extra effects',
      desc: 'Shader effects added on top of the built-in ones.',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 3v4M12 17v4M3 12h4M17 12h4"/><circle cx="12" cy="12" r="3"/></svg>',
      open: function () { openExtraEffects(); },
    },
    shapes: {
      title: 'Extra shapes',
      desc: 'Shapes added to the shape picker.',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="m12 3 9 6.5-3.4 10.5H6.4L3 9.5 12 3Z"/></svg>',
      open: function () { openExtraShapes(); },
    },
    selectAll: {
      title: 'Select all layers',
      desc: 'Selects every layer in the project.',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',
      open: function () { patch().selectAllLayers(); },
    },
    hideAll: {
      title: 'Show or hide all layers',
      desc: 'Flips every layer at once.',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="2.6"/></svg>',
      open: function () { patch().toggleAllLayers(); },
    },
    linkCamera: {
      title: 'Link to camera',
      desc: 'Makes the selected layer follow the camera layer.',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 8h11a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2Z"/><path d="m17 11 4-2v6l-4-2"/></svg>',
      open: function () { patch().linkSelectedTo('camera'); },
    },
    linkNull: {
      title: 'Link to null',
      desc: 'Makes the selected layer follow a null layer.',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="8"/><path d="M12 2v20M2 12h20"/></svg>',
      open: function () { patch().linkSelectedTo('null'); },
    },
    shiftKf: {
      title: 'Shift keyframes',
      desc: 'Moves a layer\'s animation earlier or later without moving the layer.',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 12h13M12 7l5 5-5 5"/><path d="M20 5v14"/></svg>',
      open: function () { select().openShiftKf(); },
    },
    splitText: {
      title: 'Split text',
      desc: 'Breaks a text layer into characters, words or lines.',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 6h16M4 12h9M4 18h13"/></svg>',
      open: function () { select().openSplitText(); },
    },
    adjustment: {
      title: 'Adjustment layer',
      desc: 'Grades everything beneath it without touching each clip.',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="8"/><path d="M12 4v16M12 12h8"/></svg>',
      open: function () {
        var a = window.omsAmzAdjust;
        if (!a) return notify('Adjustment layers are still loading');
        var made = a.addAdjustmentLayer();
        if (!made) return notify('Could not add an adjustment layer');
        notify('Adjustment layer added');
        a.openAdjustmentPicker(made);
      },
    },
    clearCache: {
      title: 'Clear export cache',
      desc: 'Frees stored export data.',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>',
      open: function () { patch().clearExportCache(); },
    },
  };

  /** The selection-panel module, if it loaded. */
  function select() {
    if (window.omsAmzSelect) return window.omsAmzSelect;
    return { openShiftKf: function () {}, openSplitText: function () {} };
  }

  /** The patch module, if it loaded. Returns a no-op stand-in so a missing module cannot throw. */
  function patch() {
    if (window.omsAmzPatch) return window.omsAmzPatch;
    return {
      selectAllLayers: function () {}, toggleAllLayers: function () {},
      linkSelectedTo: function () {}, clearExportCache: function () {},
    };
  }

  function menuRow(key) {
    var m = MENU[key];
    var counted = key === 'effects' || key === 'shapes';
    var count = key === 'effects' ? extraEffectCount() : extraShapeCount();
    var subtitle = counted
      ? count + ' available \u00b7 ' + esc(m.desc)
      : esc(m.desc);
    var row = el('div', 'amzTool');
    row.innerHTML =
      '<div class="amzToolIcon">' + m.icon + '</div>' +
      '<div class="amzToolText"><b>' + esc(m.title) + '</b><p>' + subtitle + '</p></div>' +
      '<div class="chev">&#8250;</div>';
    row.onclick = function () { try { m.open(); } catch (e) { notify('Could not open that: ' + e.message); } };
    return row;
  }

  function extraEffectCount() {
    try { return window.omsAmzEffects ? window.omsAmzEffects.EFFECTS.length : 0; } catch (e) { return 0; }
  }
  function extraShapeCount() {
    try { return window.omsAmzShapes ? Object.keys(window.omsAmzShapes.SHAPES).length : 0; } catch (e) { return 0; }
  }

  /**
   * Lists the added effects and applies one to the selected layer. Applying from here rather
   * than only from the effect browser matters because the browser needs a layer selected
   * first; this sheet says so instead of failing silently.
   */
  function openExtraEffects() {
    var C = window.OMS_EFFECT_CATALOG || [];
    var mine = [];
    for (var i = 0; i < C.length; i++) {
      if (C[i] && String(C[i].id).indexOf('amz_') === 0) mine.push(C[i]);
    }
    var groups = {}, order = [];
    mine.forEach(function (spec) {
      var key = spec.category || 'Lain';
      if (!groups[key]) { groups[key] = []; order.push(key); }
      groups[key].push(spec);
    });
    sheet({
      title: 'Extra effects',
      subtitle: mine.length + ' shader effects',
      build: function (body) {
        var note = el('div', 'amz-field');
        note.appendChild(el('div', 'amz-label', 'How these work'));
        note.appendChild(el('p', 'amz-note', 'Each is a fragment shader running through the editor\'s own effect pipeline, so it previews and exports like a built-in one. Select a layer, then tap an effect to add it.'));
        body.appendChild(note);
        order.forEach(function (cat) {
          body.appendChild(el('div', 'amzGroup', esc(cat)));
          groups[cat].forEach(function (spec) {
            var row = el('div', 'amzTool');
            row.innerHTML =
              '<div class="amzToolIcon">' + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 3v4M12 17v4M3 12h4M17 12h4"/><circle cx="12" cy="12" r="3"/></svg>' + '</div>' +
              '<div class="amzToolText"><b>' + esc(spec.name) + '</b><p>' + (spec.params ? spec.params.length : 0) + ' controls</p></div>' +
              '<div class="chev">+</div>';
            row.onclick = function () {
              if (!window.omsAmzEffects) return notify('Effects are still loading');
              var selected = window.model && window.model.layers
                ? window.model.layers.find(function (l) { return l && l.id === window.model.selected; })
                : null;
              if (!selected) return notify('Select a layer first, then tap the effect');
              window.omsAmzEffects.applyTo(selected, spec.id);
            };
            body.appendChild(row);
          });
        });
      },
      footer: [{ label: 'Close' }],
    });
  }

  function openExtraShapes() {
    var shapes = window.omsAmzShapes;
    var groups = shapes ? shapes.GROUPS : [];
    sheet({
      title: 'Extra shapes',
      subtitle: (shapes ? Object.keys(shapes.SHAPES).length : 0) + ' shapes',
      build: function (body) {
        body.appendChild(el('p', 'amz-note', 'These are also in the shape picker under Add to Shapes. Listed here so you can see what was added and drop one in directly.'));
        groups.forEach(function (group) {
          body.appendChild(el('div', 'amzGroup', esc(group.label)));
          var wrap = el('div', 'amzShapeChips');
          group.items.forEach(function (id) {
            if (!shapes || !shapes.SHAPES[id]) return;
            var b = el('button', 'amzShapeChip', esc(shapes.LABELS[id] || id));
            b.onclick = function () {
              try {
                if (window.history && window.history.push) window.history.push();
                window.model.addLayer('shape', { shape: id, name: shapes.LABELS[id] || id });
                if (window.ui && window.ui.rebuildAll) window.ui.rebuildAll();
                notify(shapes.LABELS[id] || id);
              } catch (e) { notify('Could not add that shape'); }
            };
            wrap.appendChild(b);
          });
          body.appendChild(wrap);
        });
      },
      footer: [{ label: 'Close' }],
    });
  }

  /* ------------------------------------------------------------------------ settings */

  function controlFor(spec, row) {
    var S2 = settings();
    var value = S2.get(spec.id);
    if (spec.type === 'bool') {
      var sw = el('button', 'amzSw');
      sw.setAttribute('role', 'switch');
      sw.setAttribute('aria-checked', value ? 'true' : 'false');
      sw.onclick = function () {
        var next = sw.getAttribute('aria-checked') !== 'true';
        sw.setAttribute('aria-checked', next ? 'true' : 'false');
        S2.set(spec.id, next);
      };
      return sw;
    }
    if (spec.type === 'number') {
      var input = el('input', 'amzNum');
      input.type = 'number';
      input.min = spec.min; input.max = spec.max; input.value = value;
      input.onchange = function () { S2.set(spec.id, input.value); input.value = S2.get(spec.id); };
      return input;
    }
    if (spec.type === 'color') {
      var c = el('input', 'amzNum');
      c.type = 'color'; c.style.width = '56px'; c.value = value;
      c.onchange = function () { S2.set(spec.id, c.value); };
      return c;
    }
    if (spec.type === 'choice') {
      var seg = el('div', 'amzSeg');
      spec.options.forEach(function (o) {
        var b = el('button', null, esc(o[1]));
        b.setAttribute('aria-pressed', String(o[0] === value));
        b.onclick = function () {
          S2.set(spec.id, o[0]);
          seg.querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-pressed', 'false'); });
          b.setAttribute('aria-pressed', 'true');
          if (spec.restart) notify('Takes effect after a restart');
        };
        seg.appendChild(b);
      });
      row.appendChild(seg);
      seg.style.width = '100%';
      row.style.flexWrap = 'wrap';
    }
    return null;
  }

  function openSettings() {
    sheet({
      title: 'Settings',
      subtitle: 'Every switch takes effect immediately unless it says otherwise',
      build: function (body) {
        /* Search across every group rather than filtering the collapsed list, because a
           setting you cannot find is the same as one that does not exist. */
        var search = el('input', 'amzSearch');
        search.id = 'amzSettingsSearch';
        search.type = 'search';
        search.placeholder = 'Search settings';
        search.setAttribute('autocomplete', 'off');
        body.appendChild(search);

        var empty = el('p', 'amzEmpty', 'No setting matches that.');
        empty.style.display = 'none';

        var rows = [];
        var headers = [];
        var groups = settings().byGroup();
        groups.forEach(function (g) {
          var header = el('div', 'amzGroup', esc(g.name));
          body.appendChild(header);
          headers.push({ node: header, name: g.name.toLowerCase(), shown: 0 });
          g.items.forEach(function (spec) {
            var row = el('div', 'amzRow');
            var text = el('div', 'amzText');
            text.innerHTML = '<b>' + esc(spec.label) + '</b><p>' + esc(spec.help) + '</p>';
            row.appendChild(text);
            var ctl = controlFor(spec, row);
            if (ctl) row.appendChild(ctl);
            body.appendChild(row);
            rows.push({
              node: row,
              haystack: (spec.label + ' ' + spec.help + ' ' + g.name + ' ' + spec.id).toLowerCase(),
              group: header,
            });
          });
        });
        body.appendChild(empty);

        search.addEventListener('input', function () {
          var q = search.value.trim().toLowerCase();
          var visible = 0;
          rows.forEach(function (r) {
            var hit = !q || r.haystack.indexOf(q) >= 0;
            r.node.style.display = hit ? '' : 'none';
            if (hit) visible++;
          });
          /* A header stays only if at least one of its rows survived, so the list never
             shows a heading with nothing under it. */
          headers.forEach(function (h) {
            var any = rows.some(function (r) { return r.group === h.node && r.node.style.display !== 'none'; });
            h.node.style.display = any ? '' : 'none';
          });
          empty.style.display = visible ? 'none' : '';
        });
      },
      footer: [
        { label: 'Reset', danger: true, onClick: function (close) { settings().reset(); close(); notify('Settings reset'); } },
        { label: 'Done', primary: true, onClick: function (close) { close(); } },
      ],
    });
  }

  /* -------------------------------------------------------------------- theme picker */

  function openThemePicker(anchor) {
    injectStyles();
    var existing = document.getElementById('amzThemePop');
    if (existing) { existing.remove(); return; }
    var pop = el('div', 'amzThemePop');
    pop.id = 'amzThemePop';
    var S2 = settings();
    /* The palettes come from settings, so a theme added there appears here without a second
       list to keep in step. Swatches use each theme's own background and text colour. */
    var themes = (S2.THEMES || []).map(function (t) { return [t.id, t.label, t.bg || '#ffffff']; });
    themes.forEach(function (o) {
      var b = el('button');
      b.setAttribute('aria-pressed', String(S2.get('theme') === o[0]));
      b.innerHTML = '<span class="dot" style="background:' + o[2] + '"></span>' + esc(o[1]);
      b.onclick = function () {
        S2.set('theme', o[0]);
        pop.querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-pressed', 'false'); });
        b.setAttribute('aria-pressed', 'true');
        notify(o[1] + ' theme');
      };
      pop.appendChild(b);
    });
    document.body.appendChild(pop);
    setTimeout(function () {
      document.addEventListener('click', function hide(e) {
        if (!pop.contains(e.target)) { pop.remove(); document.removeEventListener('click', hide); }
      });
    }, 0);
  }

  /* ------------------------------------------------------------------------ feedback */

  var FEEDBACK_TO = 'feedback@editorhub.app';

  function openFeedback() {
    sheet({
      title: 'Send Feedback',
      subtitle: 'Opens your mail app with everything filled in. Nothing is sent until you tap send there.',
      build: function (body) {
        body.appendChild(el('div', 'amzGroup', 'Type'));
        var types = [['bug', 'Bug Report'], ['feature', 'Feature Request'], ['other', 'Other']];
        var chosen = 'bug';
        var seg = el('div', 'amzSeg');
        seg.style.margin = '0 4px 14px';
        types.forEach(function (t) {
          var b = el('button', null, esc(t[1]));
          b.setAttribute('aria-pressed', String(t[0] === chosen));
          b.onclick = function () {
            chosen = t[0];
            seg.querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-pressed', 'false'); });
            b.setAttribute('aria-pressed', 'true');
          };
          seg.appendChild(b);
        });
        body.appendChild(seg);

        body.appendChild(el('div', 'amzGroup', 'Message'));
        var ta = el('textarea');
        ta.rows = 6;
        ta.placeholder = 'What did you do, what happened, and what did you expect? Steps to repeat help a lot.';
        ta.style.cssText = 'width:100%;padding:12px;border-radius:14px;border:1px solid rgba(255,255,255,.12);background:rgba(0,0,0,.25);color:inherit;font:inherit;font-size:13px;resize:vertical;box-sizing:border-box;margin-bottom:14px';
        body.appendChild(ta);

        var row = el('div', 'amzRow');
        row.innerHTML = '<div class="amzText"><b>Include Device Info</b><p>Adds app version, Android version and phone model so bugs are easier to find. Off sends only your message.</p></div>';
        var info = true;
        var sw = el('button', 'amzSw');
        sw.setAttribute('role', 'switch');
        sw.setAttribute('aria-checked', 'true');
        sw.onclick = function () {
          info = sw.getAttribute('aria-checked') !== 'true';
          sw.setAttribute('aria-checked', info ? 'true' : 'false');
        };
        row.appendChild(sw);
        body.appendChild(row);

        var send = el('button', 'amzBtn primary');
        send.style.marginTop = '14px';
        send.textContent = 'Send';
        send.onclick = function () {
          var subject = '[EditorsHub] ' + (chosen === 'bug' ? 'Bug Report' : chosen === 'feature' ? 'Feature Request' : 'Feedback');
          var b = ta.value || '';
          if (info) {
            b += '\n\n--\nApp: EditorsHub\nBuild: ' + (window.omsBuildId || 'unknown') +
              '\nPlatform: ' + navigator.userAgent;
          }
          var url = 'mailto:' + FEEDBACK_TO + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(b);
          try {
            if (native() && native().openUrl) native().openUrl(url);
            else window.location.href = url;
          } catch (e) {
            notify('Could not open the mail app');
          }
        };
        body.appendChild(send);
      },
      footer: [{ label: 'Cancel' }],
    });
  }

  /* ---------------------------------------------------------------- project search */

  function projectSearchBox() {
    var s = settings();
    if (s && s.get('projectSearch') === false) return null;
    if (document.getElementById('amzProjectSearch')) return document.getElementById('amzProjectSearch');
    var list = document.getElementById('projectList');
    if (!list || !list.parentNode) return null;
    var wrap = el('div', 'amzSearch');
    wrap.id = 'amzProjectSearch';
    wrap.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';
    var input = el('input');
    input.type = 'search';
    input.placeholder = 'Search project';
    input.oninput = function () { filter(input.value); };
    wrap.appendChild(input);
    list.parentNode.insertBefore(wrap, list);
    return wrap;
  }

  function filter(query) {
    var q = String(query || '').trim().toLowerCase();
    var list = document.getElementById('projectList');
    if (!list) return;
    var shown = 0;
    list.querySelectorAll('.projectCard').forEach(function (card) {
      var name = (card.querySelector('b') || {}).textContent || '';
      var match = !q || name.toLowerCase().indexOf(q) >= 0;
      card.style.display = match ? '' : 'none';
      if (match) shown++;
    });
    var none = document.getElementById('amzNoMatch');
    if (none) none.remove();
    if (!shown && q) {
      var msg = el('div', 'homeEmpty');
      msg.id = 'amzNoMatch';
      msg.innerHTML = '<div class="emptyCopy"><b>No matching projects</b><p>Nothing here matches “' + esc(q) + '”.</p></div>';
      list.appendChild(msg);
    }
  }

  function syncProjectSearch() {
    projectSearchBox();
  }

  /* --------------------------------------------------------------- home changelog card */

  var CHANGELOG = [
    {
      title: 'Home & Projects',
      items: [
        'Theme switcher: Original, Dark and Amoled, applied across the editor chrome.',
        'Language picker with 14 languages, applied immediately.',
        'Project search bar above the project list.',
        'Project cards show resolution, frame rate and a relative date.',
        'Codec evaluation with a result card: export ceiling, recommended resolution, HEVC and H.264 support.',
      ],
    },
    {
      title: 'Editor',
      items: [
        'Preview quality: Full, 1/2, 1/4, 1/8 or 1/12, or Auto from the measured frame time.',
        'Preview FPS cap so slow devices drop work instead of falling behind.',
        'Skip late frames, frame cache and frame cache size.',
        'Confirm before leaving the editor, with dialog or double-back styles.',
        'Preview drag snap and lock camera view while playing.',
      ],
    },
    {
      title: 'Extra tools',
      items: [
        'Codec Evaluation, Depth Map, Background Remover, Upscale, Anti-Compress.',
        'Twixtor slow motion, Dead Frame Remover, Stabilizer, AI Frame Interpolation.',
        'Audio Converter, Audio Denoise, Reverse Video, Convert Video.',
        'Project Doctor health scan and Depth 3D Photo.',
      ],
    },
    {
      title: 'Effect Browser',
      items: [
        'Folders for Last Added, Favourite and Recently Used above the category list.',
        'Adjustable search delay and direct effect choice.',
        'Animated effect thumbnails and a readable preview scrim.',
      ],
    },
    {
      title: 'Performance',
      items: [
        'Frame cache with a cache-size cap and an optional auto-fill pass.',
        'Export log for tracing a broken frame to the layer that produced it.',
      ],
    },
  ];

  function homeCard() {
    if (document.getElementById('amzHomeCard')) return;
    var home = document.getElementById('home');
    if (!home) return;
    var card = el('div', 'amzHomeCard');
    card.id = 'amzHomeCard';
    var html = '<h3>EditorsHub Extra</h3><div class="amzCredit">Motion design workspace</div>' +
      '<p>A motion editor with a WebGL2 compositor, 93 effects, keyframes with easing, ' +
      'vector and freehand drawing, 3D camera, and a set of media tools for work outside the timeline.</p>';
    CHANGELOG.forEach(function (g, i) {
      html += '<div class="amzHomeFold" data-fold="' + i + '"><span>' + esc(g.title) + '</span><span class="pm">+</span></div>' +
        '<ul class="amzHomeFoldBody" data-body="' + i + '">' +
        g.items.map(function (it) { return '<li>' + esc(it) + '</li>'; }).join('') + '</ul>';
    });
    html += '<div class="amzHomeBtns"><button data-amz="new">+ Create Project</button><button data-amz="open">Open Projects</button></div>';
    card.innerHTML = html;

    card.querySelectorAll('[data-fold]').forEach(function (fold) {
      fold.onclick = function () {
        var body = card.querySelector('[data-body="' + fold.dataset.fold + '"]');
        var isOpen = body.classList.toggle('open');
        fold.querySelector('.pm').textContent = isOpen ? '\u2013' : '+';
      };
    });
    card.querySelector('[data-amz="new"]').onclick = function () {
      var fabNew = document.getElementById('newProjectFab') || document.getElementById('mNavCenterFab');
      if (fabNew) fabNew.click();
    };
    card.querySelector('[data-amz="open"]').onclick = function () {
      var tab = document.querySelector('[data-tab="proyek"]');
      if (tab) tab.click();
    };

    // Insert after the existing hero so the current layout is not replaced, only extended.
    var hero = home.querySelector('.mHomeHero') || home.firstElementChild;
    if (hero && hero.parentNode) hero.parentNode.insertBefore(card, hero.nextSibling);
    else home.insertBefore(card, home.firstChild);
  }

  /* ------------------------------------------------------------------- header icons */

  /**
   * Adds the theme and feedback controls to the existing header.
   *
   * The buttons are inserted next to the element the header already uses for navigation, so the
   * header keeps its own layout; if that element is absent nothing is added and the rest of the
   * app is unaffected.
   */
  function headerIcons() {
    if (document.getElementById('amzHeaderIcons')) return;
    var host = document.querySelector('#home .mHomeHero') || document.querySelector('header') || document.getElementById('home');
    if (!host) return;
    injectStyles();
    var bar = el('div');
    bar.id = 'amzHeaderIcons';
    bar.style.cssText = 'display:flex;gap:10px;justify-content:flex-end;padding:2px 0 6px';
    var b1 = el('button');
    b1.style.cssText = 'width:40px;height:40px;border-radius:50%;border:0;background:rgba(0,0,0,.06);display:grid;place-items:center;cursor:pointer';
    b1.setAttribute('aria-label', 'Theme');
    b1.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#1d2430" stroke-width="1.7" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"/></svg>';
    b1.onclick = function () { openThemePicker(b1); };
    var b2 = el('button');
    b2.style.cssText = b1.style.cssText;
    b2.setAttribute('aria-label', 'Send feedback');
    b2.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#1d2430" stroke-width="1.7" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-8 8H8l-4 3v-6a8 8 0 1 1 17-5Z"/></svg>';
    b2.onclick = openFeedback;
    bar.appendChild(b1);
    bar.appendChild(b2);
    host.parentNode.insertBefore(bar, host);
  }

  /* ------------------------------------------------------------------------- boot */

  function syncHome() {
    try {
      homeCard();
      headerIcons();
      projectSearchBox();
    } catch (e) { log('home sync failed: ' + e.message); }
  }

  function boot() {
    injectStyles();
    syncButton();
    syncHome();
    // The home list is rebuilt on navigation, so the search box and card are re-added after it.
    var tries = 0;
    var timer = setInterval(function () {
      syncHome();
      if (++tries > 40) clearInterval(timer);
    }, 750);
    document.addEventListener('click', function (e) {
      var t = e.target;
      if (t && t.closest && t.closest('[data-tab="beranda"]')) setTimeout(syncHome, 120);
      if (t && t.closest && t.closest('[data-tab="proyek"]')) setTimeout(syncHome, 120);
    }, true);
    log('hub ready');
  }

  window.omsAmzHub = {
    sheet: sheet,
    notify: notify,
    openLabs: openLabs,
    openSettings: openSettings,
    openFeedback: openFeedback,
    openThemePicker: openThemePicker,
    openExtraEffects: openExtraEffects,
    openExtraShapes: openExtraShapes,
    syncButton: syncButton,
    syncProjectSearch: syncProjectSearch,
    syncHome: syncHome,
    repaint: function () { try { window.omsAmzTools && window.omsAmzTools.repaint && window.omsAmzTools.repaint(); } catch (e) {} },
    LABS: LABS,
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
  setTimeout(boot, 1200);
})();
