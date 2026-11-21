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
    '#editor .transport button{color:#9aa3b8}',
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
    /* Ratio pills: selected one is a solid teal fill with dark ink. */
    '#newModal .aspect{border:1px solid #dcdfe6;border-radius:12px;padding:9px 4px;color:#3c3f47;background:#fff}',
    '#newModal .aspect.active{background:#3ee6b0;border-color:#3ee6b0;color:#06312a;font-weight:700}',
    /* Dropdown rows: taller, rounder, AMZ white cards. */
    '#newModal .settingRow select,#newModal .settingRow input{height:46px;border-radius:11px;border:1px solid #dfe1e7;background:#fff;color:#222}',
    '#newModal .settingRow label{font-size:13.5px;color:#3c3f47}',
    /* CREATE PROJECT: AMZ renders it as bold navy text, not a filled button. */
    '#newModal .createBtn{background:transparent;color:#23242e;font-weight:800;font-size:14px;letter-spacing:1.2px;height:48px;margin-top:14px}',
    /* Circled bottom close — only after the script moves the button down. */
    '#newModal.amzNp .modalHead{display:none}',
    '#newModal.amzNp #closeNew{position:static;display:grid;place-items:center;width:44px;height:44px;margin:14px auto 2px;border-radius:50%;border:0;background:rgba(0,0,0,.07);color:#15161a;font-size:20px;line-height:1}'
  ].join('\n');

  var style = document.createElement('style');
  style.id = 'oms-amz-editor-skin';
  style.textContent = CSS;
  (document.head || document.documentElement).appendChild(style);

  /* Move the New Project close button from the header to the bottom centre, the
     way AMZ places its circled X under CREATE PROJECT. Guarded and idempotent;
     if anything is missing the sheet simply keeps its stock layout. */
  function fixNewModal() {
    var modal = document.getElementById('newModal');
    var close = document.getElementById('closeNew');
    var create = document.getElementById('createProject');
    if (!modal || !close || !create || modal._amzNp) return;
    modal._amzNp = true;
    create.insertAdjacentElement('afterend', close);
    modal.classList.add('amzNp');
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', fixNewModal);
  }
  fixNewModal();
})();
