/*
 * AMZ editor skin.
 *
 * Recolors the existing editor to match the After Motion Z (AMZ) editor exactly:
 * the deep-navy surfaces, the plain white playhead (no diamond cap), the brighter
 * teal add-layer ring, blue shape bars with amber text bars, and the dark time
 * pill that rides the playhead. Also restyles the New Project sheet: the
 * PROJECT/ELEMENT toggle with a navy selected segment and teal text, teal-filled
 * ratio pills, taller white dropdown rows, the text-style CREATE PROJECT action,
 * and the circled close button moved to the bottom centre.
 *
 * Pass 2 (from the user's 07:43–07:50 walkthrough screenshots): filled teal
 * export button and underlined title in the top bar, teal selected layer bar,
 * rounded bottom drawers, AMZ tile-style inspector grid, borderless shape
 * picker glyphs, teal add-menu tabs without the underline, the blue-navy
 * Effect Browser, and the light Export & Share sheet (white cards, teal
 * radios, navy Export button with teal text).
 *
 * Pass 3 (from the 07:37–07:42 walkthrough): the New Project sheet corrections
 * — the bottom close is AMZ's plain large ✕ (not the circled one from pass 1),
 * the ratio icons are drawn as corner brackets instead of rectangle outlines,
 * and the project-name field carries a small clear ✕ at its right edge.
 *
 * Pass 4 (same walkthrough, polish): the PROJECT/ELEMENT toggle is wired (it
 * shipped dead — Element mode renames the action to BUAT ELEMEN, defaults the
 * name to "Elemen Baru" and dims the Background row), and the Resolution row
 * carries AMZ's "Composition Size / W × H" sub-line that follows the ratio.
 *
 * Layout and markup are otherwise untouched — editor rules are scoped under
 * #editor and sheet rules under #newModal, and everything still works if the
 * small DOM move at the bottom fails to run (the close button just stays put).
 */
(function () {
  'use strict';
  if (document.getElementById('oms-amz-editor-skin')) return;

  var CSS = [
    /* Surfaces — AMZ deep navy family. */
    '#editor{background:#14172a}',
    '#editor .editorTop{background:#151826;border-bottom:1px solid #23283c}',
    '#editor .editorTitle{color:#eef1f8;font-weight:600}',
    '#editor .editorTitle small{color:#7e8699}',
    '#editor .topIcon{color:#c9cfdd}',
    '#editor .previewArea{background:#10131f;border-bottom:1px solid #23283c}',
    '#editor .viewport{background:#10131f}',
    '#editor .previewTools{background:#151826;border-top:1px solid #23283c}',
    '#editor .previewTools button{color:#9aa3b8}',
    '#editor .previewTools .tc{color:#c6cddd}',
    '#editor .timelineArea{background:#151826}',
    '#editor .bottomTools{background:#12152a;border-top:1px solid #23283c}',
    '#editor .bottomTools button{color:#8f97ad}',
    '#editor .bottomTools button.active{color:#4bffb3}',

    /* Transport rail — muted icons, pure-white play, AMZ spacing. */
    '#editor .transport{background:#151826;border-bottom:1px solid #23283c;height:42px}',
    '#editor .transport button{color:#e2e6ee}',
    '#editor .transport button.active{color:#ffffff;background:#232839}',
    '#editor #playBtn{color:#ffffff !important}',
    '#editor #playBtn.loopActive{color:#4bffb3 !important}',
    '#editor #playBtn.playing.loopActive{color:#4bffb3 !important}',

    /* Time pill — the dark rounded readout that rides the playhead. */
    '#editor .timeRead{background:#0d1020;border:1px solid #2a3048;color:#e8ecf5;border-radius:8px;font-size:10px;font-weight:600}',

    /* Playhead — AMZ uses a plain white hairline, no diamond cap. */
    '#editor .playhead{background:#f4f6fb;width:1px}',
    '#editor .playhead:before{display:none}',

    /* Ruler + track headers. */
    '#editor .ruler{background:#10131f;border-bottom:1px solid #23283c}',
    '#editor .rTick{border-left:1px solid #262c42;color:#6d7690}',
    '#editor .trackHead{background:#181c2e;border-right:1px solid #262c42;border-bottom:1px solid #20263a}',
    '#editor .trackHead.sel{background:#20263c}',
    '#editor .trackLane{border-bottom:1px solid #20263a}',
    '#editor .eye,#editor .lock{color:#78829b}',

    /* Layer bars — AMZ palette: blue shapes, amber text, teal media, and the
       brighter blue selected treatment with a soft radius. */
    '#editor .clip{border-radius:6px;height:24px;top:2px;font-weight:600;color:#0b1220}',
    '#editor .clip.shape{background:#5b8def}',
    '#editor .clip.text{background:#ffc356}',
    '#editor .clip.image{background:#6fd6c9}',
    '#editor .clip.video{background:#4cc8c4}',
    '#editor .clip.audio{background:#ca8cff}',
    '#editor .clip.camera{background:#94a2ff}',
    '#editor .clip.mesh{background:#ff907c}',
    '#editor .clip.sel{outline:2px solid #ffffff;outline-offset:1px}',

    /* Keyframe diamonds — light fill so they read on every bar color. */
    '#editor .kf{background:#f2f5ff;border:1px solid #9db4ff}',

    /* Add-layer FAB — the AMZ teal ring, larger (54px), hovering the timeline. */
    '#editor .plusBtn{width:54px;height:54px;border:2.5px solid #4bffb3;border-radius:50%;background:#151826;color:#4bffb3;font-size:30px;line-height:1;right:14px;bottom:70px}',
    '#editor .plusBtn.open{background:#1b2138}',

    /* Mode badge — blend into the navy instead of the old grey chip. */
    '#editor .axisBadge{background:rgba(13,16,32,.82);border:1px solid #2a3048;color:#8b94ab}',
    '#editor .axisBadge b{color:#4bffb3}',

    /* ------------------------------------------------------------------
       Pass 2 — verified against the user's 07:43–07:50 AMZ walkthrough. */

    /* Top bar: AMZ underlines the project title (rename affordance) and renders
       export as a filled teal-green rounded square with a white glyph. */
    '#editor .editorTitle{text-decoration:underline;text-underline-offset:4px;text-decoration-color:#3f465f}',
    '#editor #openExport{background:#2fd6a4;color:#ffffff;border-radius:10px}',

    /* Selected layer bar: solid AMZ teal with white text, no white outline. */
    '#editor .clip.sel{background:#3fd9c1;color:#ffffff;outline:none}',

    /* Bottom sheets: AMZ rounds the top corners and uses a touch of blue. */
    '#editor .drawer{background:#1e2233;border-top:1px solid #2a3048;border-radius:20px 20px 0 0}',
    '#editor .drawerHead{height:46px;border-bottom:1px solid #262c40}',
    '#editor .drawerHead b{color:#eef1f8;font-size:13px}',
    '#editor .drawerHead button{color:#9aa3b8}',

    /* Inspector grid: AMZ layer-tool tiles — tall, rounded, grey on navy. */
    '#editor .inspectorGrid{gap:8px}',
    '#editor .insBtn{background:#252a41;border-radius:14px;padding:14px 6px;color:#9aa3b8;font-size:10px}',
    '#editor .insBtn span{font-size:22px;color:#c9cfdd}',

    /* Shape picker: AMZ draws bare light-grey glyphs, no tile boxes. */
    '#editor .shapeItem{background:transparent;border:0;border-radius:0;color:#c8cede;font-size:26px}',
    '#editor .shapeItem:hover{border:0;color:#4bffb3}',

    /* Add-menu tabs: teal active label, no underline bar (that pattern lives
       in the Effect Browser instead). */
    '#editor .assetTabs{border-bottom:1px solid #262c40}',
    '#editor .assetTabs button{color:#8d97ae;font-size:10px}',
    '#editor .assetTabs button.active{color:#3ee6b0;border-bottom-color:transparent}',

    /* Effect Browser: AMZ runs it in a lighter blue-navy than the editor. */
    '#editor .effectsBrowserDrawer{background:#242845}',
    '#editor .effectsBrowserDrawer .drawerHead{border-bottom-color:#2e3352}',
    '#editor .effectBrowserHeading b{color:#f0f3fa}',
    '#editor .effectBrowserHeading small{color:#8d97b8}',
    '#editor .effectBrowserNoResults{border-color:#3a4166;color:#9aa3c0}',

    /* Export & Share — AMZ's sheet is light even though the editor is dark:
       white cards, teal ring radios, navy Export button with teal text. */
    '.exportSheet{background:#f4f4f6}',
    '.exportTop{background:#ffffff;border-bottom:1px solid #e6e8ec}',
    '.exportOption{border:0;border-radius:14px;box-shadow:0 1px 4px rgba(20,24,40,.06)}',
    '.exportOption.active{border:0;box-shadow:0 1px 4px rgba(20,24,40,.06)}',
    '.radioDot{border:2px solid #c3c7cf}',
    '.radioRow.active .radioDot{border:5px solid #2fd6a4}',
    '.exportFoot{background:#f4f4f6;border-top:0}',
    '.exportFoot button{background:#23242e;color:#3ee6b0;border-radius:12px;height:48px;font-size:15px}',

    /* ------------------------------------------------------------------
       New Project sheet — AMZ creation dialog. */
    '#newModal .modal{background:#ffffff;border-radius:24px 24px 0 0;padding:22px 18px 18px}',
    /* PROJECT/ELEMENT toggle: light track, navy selected pill, teal selected text. */
    '#newModal .seg{background:#eceef2;border-radius:14px;padding:4px;gap:4px}',
    '#newModal .seg button{height:42px;border-radius:11px;font-size:14px;font-weight:700;color:#6d7078;letter-spacing:.4px}',
    '#newModal .seg button.active{background:#23242e;color:#3ee6b0;font-weight:800}',
    /* Project name: AMZ underline field instead of a boxed input. */
    '#newModal #newName{height:46px !important;border:0 !important;border-bottom:1px solid #dcdfe6 !important;border-radius:0 !important;padding:0 2px !important;font-size:16px;color:#15161a;background:transparent}',
    /* Ratio pills: plain white pills, and the aspect icon is drawn as four dark
       corner brackets (AMZ's crop-mark look) instead of a full rectangle outline.
       Selected pill is a solid teal fill — the brackets flip to dark ink with it. */
    '#newModal .aspect{border:1px solid #e4e6ec;border-radius:12px;padding:9px 4px;color:#3c3f47;background:#fff}',
    '#newModal .aspect.active{background:#3ee6b0;border-color:#3ee6b0;color:#06312a;font-weight:700}',
    '#newModal .aspect .ratioIcon i{border:0;border-radius:0;background:linear-gradient(currentColor,currentColor) left top/8px 1.6px,linear-gradient(currentColor,currentColor) left top/1.6px 8px,linear-gradient(currentColor,currentColor) right top/8px 1.6px,linear-gradient(currentColor,currentColor) right top/1.6px 8px,linear-gradient(currentColor,currentColor) left bottom/8px 1.6px,linear-gradient(currentColor,currentColor) left bottom/1.6px 8px,linear-gradient(currentColor,currentColor) right bottom/8px 1.6px,linear-gradient(currentColor,currentColor) right bottom/1.6px 8px;background-repeat:no-repeat}',
    /* Dropdown rows: taller, rounder, AMZ white cards. */
    '#newModal .settingRow select,#newModal .settingRow input{height:46px;border-radius:11px;border:1px solid #dfe1e7;background:#fff;color:#222}',
    '#newModal .settingRow label{font-size:13.5px;color:#3c3f47}',
    /* Name field: underline input with a small grey ✕ clear button pinned at the
       right edge (the wrapper is added by fixNewModal below). */
    '#amzNameWrap{position:relative}',
    '#amzNameWrap #newName{padding-right:34px !important}',
    '#amzNameClear{position:absolute;right:4px;top:50%;transform:translateY(-50%);width:22px;height:22px;border:1.6px solid #c3c7cf;border-radius:50%;background:transparent;color:#9aa0ac;font-size:12px;line-height:1;display:grid;place-items:center;cursor:pointer;padding:0}',
    /* Resolution row carries AMZ's small grey "Composition Size / W × H" sub-line. */
    '#newModal .amzResSub{display:block;color:#9aa0ac;font-size:11.5px;font-weight:400;margin-top:2px;line-height:1.45}',
    /* Element mode dims the Background row the way AMZ does. */
    '#newModal .settingRow.amzDimmed{opacity:.45;pointer-events:none}',
    /* CREATE PROJECT: AMZ renders it as bold navy text, not a filled button. */
    '#newModal .createBtn{background:transparent;color:#23242e;font-weight:800;font-size:14px;letter-spacing:1.2px;height:48px;margin-top:14px}',
    /* Plain large bottom ✕ — only after the script moves the button down. AMZ
       has no circle around it, just the glyph centred under CREATE PROJECT. */
    '#newModal.amzNp .modalHead{display:none}',
    '#newModal.amzNp #closeNew{position:static;display:block;width:auto;height:auto;margin:4px auto 0;padding:2px 16px;border-radius:0;border:0;background:transparent;color:#15161a;font-size:32px;font-weight:300;line-height:1.2;cursor:pointer}'
  ].join('\n');

  var style = document.createElement('style');
  style.id = 'oms-amz-editor-skin';
  style.textContent = CSS;
  (document.head || document.documentElement).appendChild(style);

  /* Move the New Project close button from the header to the bottom centre, the
     way AMZ places its plain X under CREATE PROJECT, and wrap the name field so
     it gets the small clear button at its right edge. Guarded and idempotent;
     if anything is missing the sheet simply keeps its stock layout. */
  function fixNewModal() {
    var modal = document.getElementById('newModal');
    var close = document.getElementById('closeNew');
    var create = document.getElementById('createProject');
    if (!modal || !close || !create || modal._amzNp) return;
    modal._amzNp = true;
    create.insertAdjacentElement('afterend', close);
    modal.classList.add('amzNp');
    var name = document.getElementById('newName');
    if (name && name.parentNode && !document.getElementById('amzNameWrap')) {
      var wrap = document.createElement('div');
      wrap.id = 'amzNameWrap';
      name.parentNode.insertBefore(wrap, name);
      wrap.appendChild(name);
      var clear = document.createElement('button');
      clear.type = 'button';
      clear.id = 'amzNameClear';
      clear.setAttribute('aria-label', 'Clear name');
      clear.textContent = '×';
      clear.addEventListener('click', function () {
        name.value = '';
        name.focus();
        try { name.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {}
      });
      wrap.appendChild(clear);
    }

    /* The PROJECT/ELEMENT toggle ships in the markup but had no wiring — a dead tap.
       AMZ's Element mode swaps the name and the action label and dims Background. */
    var seg = modal.querySelector('.seg');
    if (seg && !seg._amzSegWired) {
      seg._amzSegWired = true;
      var nameIn = document.getElementById('newName');
      var createB = document.getElementById('createProject');
      var bg = document.getElementById('newBg');
      var bgRow = bg && bg.closest ? bg.closest('.settingRow') : null;
      var DEFAULTS = ['Project Baru', 'Elemen Baru'];
      Array.prototype.forEach.call(seg.querySelectorAll('button'), function (b, i) {
        b.addEventListener('click', function () {
          Array.prototype.forEach.call(seg.querySelectorAll('button'), function (x) { x.classList.remove('active'); });
          b.classList.add('active');
          var element = i === 1;
          if (createB) createB.textContent = element ? 'BUAT ELEMEN' : 'BUAT PROYEK';
          if (nameIn && (nameIn.value === '' || DEFAULTS.indexOf(nameIn.value) >= 0)) {
            nameIn.value = element ? 'Elemen Baru' : 'Project Baru';
          }
          if (bgRow) bgRow.classList.toggle('amzDimmed', element);
          if (bg) bg.disabled = element;
        });
      });
    }

    /* "Composition Size / W × H" under the Resolution label, kept in step with the
       picked ratio and resolution. */
    var resSel = document.getElementById('newRes');
    var resRow = resSel && resSel.closest ? resSel.closest('.settingRow') : null;
    if (resRow && resSel && !document.getElementById('amzResSub') && resRow.querySelector('label')) {
      var sub = document.createElement('small');
      sub.id = 'amzResSub';
      sub.className = 'amzResSub';
      resRow.querySelector('label').appendChild(sub);
      var dimsFor = function (ratio, res) {
        switch (ratio) {
          case '16:9': return [Math.round(res * 16 / 9), res];
          case '9:16': return [res, Math.round(res * 16 / 9)];
          case '4:5': return [res, Math.round(res * 5 / 4)];
          case '1:1': return [res, res];
          case '4:3': return [Math.round(res * 4 / 3), res];
          default: return null;
        }
      };
      var syncSub = function (ratio) {
        var activeA = modal.querySelector('#aspectGrid .aspect.active');
        var r = ratio || (activeA && activeA.dataset ? activeA.dataset.r : '9:16');
        var res = parseInt(resSel.value, 10) || 1080;
        var dims = dimsFor(r, res);
        if (!dims) {
          var cw = document.getElementById('newCustomW'), ch = document.getElementById('newCustomH');
          if (cw && ch && +cw.value && +ch.value) dims = [+cw.value, +ch.value];
        }
        sub.textContent = dims ? 'Composition Size\n' + dims[0] + ' × ' + dims[1] : '';
        sub.style.whiteSpace = 'pre-line';
      };
      var grid = modal.querySelector('#aspectGrid');
      if (grid) grid.addEventListener('click', function (e) {
        var b = e.target && e.target.closest ? e.target.closest('.aspect') : null;
        if (b) syncSub(b.dataset.r);
      });
      resSel.addEventListener('change', function () { syncSub(); });
      syncSub();
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', fixNewModal);
  }
  fixNewModal();
})();
