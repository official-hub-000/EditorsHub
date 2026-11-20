/*
 * The user manual: every feature of the app as a numbered entry, readable from the
 * About dialog and from the Labs menu.
 *
 * The numbers are the point. Each entry carries a serial (01, 02, …) that never
 * changes once assigned, so "entry 36 reads wrong" is a complete bug report. New
 * entries are appended; existing numbers are never reused.
 *
 * The sheet is built with the hub's own sheet engine, so it inherits the app theme,
 * the close animation and the back handling of every other sheet.
 */
(function () {
  'use strict';
  if (window.omsAmzManual) return;

  /* ------------------------------------------------------------------ content */

  /* [title, body] — body is plain, honest prose: what it does and where it lives. */
  var SECTIONS = [
    { title: 'Getting started', items: [
      ['What this app is', 'EditorsHub is a motion-design and video editor that runs entirely on the phone. Projects, layers, effects, preview and export all work offline; nothing is uploaded anywhere.'],
      ['Installing updates', 'The app checks for new builds and can update itself. After an update, open Labs → Diagnostics and check the Build line — the code in it is the exact version running, and quoting it in a report removes all guesswork.'],
      ['Language', 'The interface runs in English or Indonesian. Switch it from the home screen or Settings; the change is instant and remembered.'],
      ['Where saved files live', 'Everything you save lands in the public media folders under EditorsHub: pictures in Pictures/EditorsHub, videos in Movies/EditorsHub, audio in Music/EditorsHub. They appear in the gallery and file manager like any other media.'],
    ]},
    { title: 'The home screen', items: [
      ['Home tabs', 'Tutorials, Projects and Templates sit at the top. Tutorials are guides, Templates are starting points, Projects is everything you have made.'],
      ['Project search', 'The field above the project list filters by name as you type. Turn it off in Settings → Home & Projects if you never use it.'],
      ['The + button', 'Starts a new project: you pick the resolution, aspect ratio and background, then land in the editor.'],
      ['Bottom navigation', 'Switches between the app’s main sections. The active destination is tinted in the accent colour.'],
      ['The wordmark opens About', 'Tapping the logo at the top opens About: what the app is, credits and licences — and the button that opens this manual.'],
      ['The Labs floating button', 'The small flask button floats over every screen and opens the extra tools. Hide it or fade it in Settings → Labs.'],
    ]},
    { title: 'Projects', items: [
      ['Creating a project', 'The + button asks for size, aspect and background colour. All three can be changed later in Composition Settings, so a wrong start costs nothing.'],
      ['Importing media', 'Inside a project, the add control brings in video, images and audio from the phone. Imported files are copied into the project, so deleting the original does not break the edit.'],
      ['Managing projects', 'Project cards on the home screen open on a tap; their menu renames, duplicates and deletes. Deleting is permanent — the project file is removed, not archived.'],
      ['Project thumbnails', 'Each card shows a frame from the project so the list is scannable. The frame updates when the project is saved.'],
    ]},
    { title: 'The editor', items: [
      ['The preview', 'The canvas in the centre shows the current frame. Pinch zooms, and dragging a layer moves it directly. Preview Drag Snap (Settings → Editor) snaps layer edges and centres to the canvas.'],
      ['Playback', 'The play button under the preview runs the timeline; drag the playhead to scrub. Preview FPS Cap and Preview Quality (Settings → Editor) trade sharpness for smoothness on slower phones.'],
      ['Preview quality', 'Auto drops the preview resolution when frames run late and restores it when they do not. Export always renders at full quality regardless of this setting.'],
      ['Frame cache', 'Played sections are kept in memory and marked on the ruler, so replaying a section is instant. The cache size is set in Settings → Editor.'],
      ['Layers', 'Everything visible is a layer: video, image, text, shape, audio. Layers stack in order; the list adds, reorders, locks and deletes them.'],
      ['Move & Transform', 'The layer’s position, scale and rotation, editable on the canvas by dragging or numerically in the panel.'],
      ['Keyframes', 'Any animated property gets its motion from keyframes: values at times, with easing between them. Add a key at the playhead, move in time, change the value.'],
      ['Trim and split', 'Layer ends drag to shorten; split cuts a layer at the playhead into two independent layers.'],
      ['Effects', 'The effect browser lists everything, searchable, with presets. Tapping adds the effect to the selected layer; every parameter is adjustable afterwards.'],
      ['Text and fonts', 'Text layers carry their own font, size, spacing and colour. Bundled fonts work offline; imported fonts follow the project.'],
      ['Shapes and the vector pen', 'Shape layers are drawn and edited as vectors, so they stay sharp at any scale. The pen tool places and edits individual points.'],
      ['Colour and fill', 'Layers and backgrounds take solid or gradient fills. A custom colour can be added to the background picker in Settings → Display.'],
      ['Audio layers', 'Music and sound sit in the layer stack like anything else, with trim, volume and fade. Preview audio fades out cleanly when playback stops.'],
      ['Camera view', 'The stage can be viewed through a movable camera for pan-and-zoom shots. The view locks during playback so it cannot switch mid-play.'],
      ['Undo and redo', 'Every edit is undoable back to the point the project was opened. Leaving the editor clears the history, which is why the leave confirmation exists.'],
    ]},
    { title: 'Export and files', items: [
      ['Exporting video', 'The export sheet in the editor writes the finished MP4 with the resolution and frame rate you choose. The exported file lands in Movies/EditorsHub and can be shared from the gallery.'],
      ['Export log', 'Settings → Performance → Export Log echoes the exporter’s own messages, so a failed export can be read back instead of guessed at.'],
      ['Add to project', 'Most Labs results offer “Add to project” next to “Save” — the result is imported into the open project directly, skipping the save-and-reimport round trip.'],
      ['Project Doctor', 'Labs → Project Doctor checks the open project for missing media, empty layers and bad timings before you spend time on an export.'],
    ]},
    { title: 'Labs tools', items: [
      ['Codec Evaluation', 'Reports what this phone can decode and encode and whether the encoder loaded. Run it first when any other tool fails — its report says why.', 'codec'],
      ['Depth Map Generator', 'Builds a depth map (near = bright) from a still or a whole clip. Stills write a PNG; clips write an MP4. The map is an estimate from luminance and contrast, good enough to drive parallax.', 'depth'],
      ['Background Remover', 'Cuts the subject out of a frame to a transparent PNG, or processes a whole clip to MP4. MP4 cannot hold transparency, so removed areas are black in clip mode.', 'matt'],
      ['AI Upscale', 'Enlarges a still 2×, 3× or 4× with edge-aware sharpening, or upscales a whole clip to MP4. Sizes the phone cannot hold are stepped down automatically — or attempted anyway when Ignore Safe Size Limits is on.', 'upscale'],
      ['TikTok Anti Compress', 'Removes the blocking and mosquito noise a low-bitrate upload leaves behind, then re-sharpens real edges. Works on a frame and writes a PNG.', 'anticompress'],
      ['Twixtor', 'Re-times a clip by synthesising the frames in between from measured motion, so slow motion stays smooth instead of stepping.', 'twistor'],
      ['Dead Frame Remover', 'Finds the frames where nothing changes — the dead air in a recording — and lists where they are so they can be cut.', 'deadframe'],
      ['Stabilizer', 'Measures the shake between frames and writes a stabilised frame plus the offset values, so the motion can be keyed back out.', 'stabilizer'],
      ['Audio Converter', 'Changes a track’s sample rate or channel count and writes a WAV.', 'audioconv'],
      ['AI Frame Interpolation', 'Doubles the frame rate by generating the in-between frames from measured motion — the same engine Twixtor uses, aimed at frame rate rather than speed.', 'rife'],
      ['Denoise (image)', 'Removes sensor grain from a still by discarding high-frequency detail below a threshold; edges, which span many frequencies, survive.', 'denoise'],
      ['Reverse Video', 'Plays a clip backwards and writes a new MP4, with the option to reverse the audio with it.', 'reverse'],
      ['Convert Video', 'Rewrites a media file as MP4, WebM, WAV, PNG or JPEG — the tool for making an odd file usable elsewhere.', 'convert'],
      ['Depth 3D Photo', 'Shades a still as a relief surface from its depth map, giving a flat picture visible depth.', 'labs3d'],
      ['Beat Maker', 'Finds the hits in a track by measuring the audio, and keys a layer to them.', 'beatmaker'],
      ['Audio Keys', 'Keys a layer from how loud each hit was, so motion follows the music.', 'audiokeys'],
      ['Vectorscope', 'Chroma and luma of the current frame, measured live from the preview — the instrument for checking colour work.', 'vectorscope'],
      ['Image Sequence', 'Plays a folder of numbered frames back as one image layer.', 'sequence'],
      ['Diagnostics', 'Lists which extra modules loaded on this phone and which did not, plus the exact build id. The first stop when anything misbehaves.', 'diagnostics'],
    ]},
    { title: 'Whole-clip processing', items: [
      ['Clip mode vs frame mode', 'Depth Map, Background Remover and AI Upscale offer a mode selector when the source is a video: “Process the whole clip” writes an MP4, “First frame only” writes a PNG. Clip mode is the default.'],
      ['Frame rate of Labs videos', 'Settings → Labs → Labs Video FPS sets the frame rate of the MP4s the tools write: 12–60 fps. Lower encodes faster; higher keeps fast motion smoother.'],
      ['Clip length limit', 'Settings → Labs → Labs Clip Length Limit caps how many seconds one run processes (5–120, default 20). Longer clips are processed up to the limit. Raise it if the phone copes; lower it if runs stall.'],
      ['Audio in Labs videos', 'Settings → Labs → Keep Audio in Labs Videos carries the source sound into processed clips. Turn it off for silent output or if a run fails during the audio step.'],
      ['Safe size limits', 'Upscale refuses sizes the device cannot hold (a 1080p clip at 4× would be 7680×4320). Settings → Labs → Ignore Safe Size Limits removes the refusal for people who want to try anyway — if the run stops, turn it back off.'],
    ]},
    { title: 'Settings and personalisation', items: [
      ['Themes', 'Settings → Display → Theme offers nine looks: Original, Dark, Amoled, Midnight, Nord, Forest, Plum, Light and Sepia. The change is instant and remembered.'],
      ['Pill toasts and HEX colours', 'Settings → Display: rounded message pills instead of square ones, and colour values shown as #RRGGBB instead of three numbers.'],
      ['Performance switches', 'Settings → Editor and Performance hold the knobs that matter on a slow phone: preview quality, FPS cap, frame cache size and auto-fill.'],
      ['The Labs button', 'Settings → Labs → Labs Floating Button hides the flask button entirely; the opacity slider just fades it.'],
    ]},
    { title: 'Help and troubleshooting', items: [
      ['Diagnostics and reports', 'Labs → Diagnostics shows the build id and which modules loaded. A screenshot of it is the single most useful thing to attach to a report.'],
      ['“The video came out silent”', 'The Keep Audio in Labs Videos setting was off, or the device offered no audio encoder. Turn the setting on and run again.'],
      ['“Upscale stopped with a size message”', 'The target size exceeded what the phone can hold. The tool already steps down to the largest feasible size; to force the attempt, enable Ignore Safe Size Limits.'],
      ['“The app feels slow”', 'Lower Preview Quality to 1/4, keep Preview FPS Cap at 30, and let Frame Cache fill. Preview sharpness never affects export quality.'],
      ['Asking for changes', 'Every entry in this manual carries a serial number. Quoting it — “change entry 36” — says exactly which feature is meant, with no ambiguity.'],
    ]},
  ];

  /* Assign serials once, in order. Tool serials are recorded so the Labs menu can
     wear the same numbers. */
  var SERIALS = {};
  var ENTRIES = [];
  (function () {
    var n = 0;
    SECTIONS.forEach(function (sec) {
      sec.items.forEach(function (it) {
        n += 1;
        var serial = (n < 10 ? '0' : '') + n;
        ENTRIES.push({ serial: serial, section: sec.title, title: it[0], body: it[1] });
        if (it[2]) SERIALS[it[2]] = serial;
      });
    });
  })();

  /* -------------------------------------------------------------------- sheet */

  var CSS = [
    '.omsManualSearch{position:sticky;top:0;z-index:2;padding:2px 0 10px;background:inherit}',
    '.omsManualSearch input{width:100%;height:40px;padding:0 12px;border:1px solid #2a3550;border-radius:11px;background:#0d1524;color:#eef2f9;font-size:14px;outline:none}',
    '.omsManualSearch input:focus{border-color:#3fe0b0}',
    '.omsManualGroup{margin:14px 0 6px;font-size:11px;font-weight:800;letter-spacing:.09em;text-transform:uppercase;color:#3fe0b0}',
    '.omsManualRow{display:grid;grid-template-columns:44px 1fr;gap:10px;padding:9px 4px;border-bottom:1px solid rgba(120,140,170,.12)}',
    '.omsManualNum{font:800 13px/1.4 ui-monospace,monospace;color:#3fe0b0;padding-top:2px}',
    '.omsManualRow b{display:block;font-size:14px;color:#eef2f9;margin-bottom:2px}',
    '.omsManualRow p{margin:0;font-size:12.5px;line-height:1.5;color:#9aa8bd}',
    '.omsManualFoot{margin:14px 0 4px;font-size:11px;line-height:1.5;color:#66748a}',
    '.omsManualBtn{display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;margin:6px 0 10px;padding:12px 14px;border:1px solid rgba(63,224,176,.4);border-radius:13px;background:rgba(63,224,176,.08);color:#bff0e2;font-size:14px;font-weight:700;cursor:pointer}',
    '.omsManualBtn:active{filter:brightness(1.25)}',
  ].join('\n');

  function injectStyles() {
    if (document.getElementById('oms-manual-style')) return;
    var s = document.createElement('style');
    s.id = 'oms-manual-style';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function openManual() {
    var hub = window.omsAmzHub;
    if (!hub || !hub.sheet) return;
    injectStyles();
    hub.sheet({
      title: 'User manual',
      subtitle: ENTRIES.length + ' numbered entries',
      wide: true,
      build: function (body) {
        var searchWrap = el('div', 'omsManualSearch');
        var search = document.createElement('input');
        search.type = 'search';
        search.placeholder = 'Search the manual…';
        searchWrap.appendChild(search);
        body.appendChild(searchWrap);

        var list = el('div');
        body.appendChild(list);
        var nodes = [];
        var lastSection = null;
        ENTRIES.forEach(function (en) {
          if (en.section !== lastSection) {
            lastSection = en.section;
            var g = el('div', 'omsManualGroup', en.section);
            list.appendChild(g);
            nodes.push({ node: g, hay: null });
          }
          var row = el('div', 'omsManualRow');
          var num = el('div', 'omsManualNum', en.serial);
          var txt = el('div');
          txt.appendChild(el('b', null, en.title));
          txt.appendChild(el('p', null, en.body));
          row.appendChild(num);
          row.appendChild(txt);
          list.appendChild(row);
          nodes.push({ node: row, hay: (en.serial + ' ' + en.section + ' ' + en.title + ' ' + en.body).toLowerCase() });
        });
        var foot = el('p', 'omsManualFoot',
          'Quote an entry’s number when asking for a change — “change entry 36” names exactly one feature. Numbers are never reused.');
        list.appendChild(foot);

        search.addEventListener('input', function () {
          var q = search.value.trim().toLowerCase();
          nodes.forEach(function (n) {
            if (n.hay === null) { n.node.style.display = q ? 'none' : ''; return; }
            n.node.style.display = (!q || n.hay.indexOf(q) !== -1) ? '' : 'none';
          });
          /* Show a group header again if any visible row follows it. */
          var groups = list.querySelectorAll('.omsManualGroup');
          groups.forEach(function (g) {
            if (!q) { g.style.display = ''; return; }
            var sib = g.nextElementSibling;
            while (sib && sib.classList.contains('omsManualRow')) {
              if (sib.style.display !== 'none') { g.style.display = ''; return; }
              sib = sib.nextElementSibling;
            }
            g.style.display = 'none';
          });
        });
      },
      footer: [{ label: 'Close' }],
    });
  }

  /* ----------------------------------------------------------- entry points */

  /* A button inside the About dialog. The dialog is built fresh on every open and
     its owner object is frozen, so the reliable hook is a MutationObserver that
     decorates the dialog the moment it appears. */
  function decorateAbout(dialog) {
    if (dialog.querySelector('.omsManualBtn')) return;
    injectStyles();
    var tools = dialog.querySelector('.omsCreditsTools');
    if (!tools) return;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'omsManualBtn';
    btn.innerHTML = '<span>User manual — every feature, numbered</span><span aria-hidden="true">&#8250;</span>';
    btn.addEventListener('click', function () {
      /* The About dialog is a MODAL <dialog>: it sits in the browser's top layer,
         above anything appended to document.body — including the manual sheet, which
         would open behind it and look like nothing happened. Close About first. */
      if (window.omsCredits && window.omsCredits.close) window.omsCredits.close();
      else if (dialog.close) dialog.close();
      openManual();
    });
    tools.insertBefore(btn, tools.firstChild);
  }

  var observer = null;
  function watchForAbout() {
    if (observer) return;
    observer = new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        var added = muts[i].addedNodes;
        for (var j = 0; j < added.length; j++) {
          var n = added[j];
          if (n && n.nodeType === 1) {
            if (n.id === 'omsCreditsDialog') decorateAbout(n);
            else if (n.querySelector) {
              var d = n.querySelector('#omsCreditsDialog');
              if (d) decorateAbout(d);
            }
          }
        }
      }
    });
    observer.observe(document.body, { childList: true });
    /* The dialog may already be open when this script arrives. */
    var existing = document.getElementById('omsCreditsDialog');
    if (existing) decorateAbout(existing);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', watchForAbout);
  } else {
    watchForAbout();
  }

  window.omsAmzManual = {
    open: openManual,
    ENTRIES: ENTRIES,
    SERIALS: SERIALS,
  };
})();
