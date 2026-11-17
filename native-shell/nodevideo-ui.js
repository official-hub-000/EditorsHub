/*
 * The Node Video screens, and the two speed features the editor lacked.
 *
 * IMPORT   pick a .zip, read it, show what came across and what did not, then open the
 *          project. The report is the point: a partial import that stays quiet is worse
 *          than a failed one.
 * EXPORT   write a .zip this app can read back, so round-tripping is provable.
 * SPEED    a speed ramp on any layer (starts fast, ends slow -- the Node Video "speed
 *          curve") and motion blur / frame blending on video layers.
 */
(function () {
  'use strict';

  var STYLE_ID = 'omsNodeVideoStyle';

  function installStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
      '.omsNvSheet{position:fixed;inset:0;z-index:2147483400;display:flex;',
      'align-items:flex-end;justify-content:center;background:rgba(0,0,0,.72);',
      '-webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px)}',
      '.omsNvCard{width:100%;max-width:560px;max-height:88vh;display:flex;',
      'flex-direction:column;background:#000;border:1px solid #1b2029;',
      'border-radius:20px 20px 0 0;padding:16px 16px calc(16px + env(safe-area-inset-bottom,0px));',
      'color:#e8edf4;font:400 13px/1.5 system-ui,-apple-system,sans-serif;',
      'animation:omsNvIn .22s cubic-bezier(.22,1,.36,1) both}',
      '@keyframes omsNvIn{from{transform:translateY(22px);opacity:.4}',
      'to{transform:translateY(0);opacity:1}}',
      '.omsNvHead{display:flex;align-items:center;gap:10px;padding-bottom:12px;',
      'border-bottom:1px solid #171b23}',
      '.omsNvHead b{flex:1 1 auto;font:800 16px/1.3 system-ui,sans-serif}',
      '.omsNvHead button{appearance:none;background:#101319;border:1px solid #232a36;',
      'color:#b9c4d3;font:700 12px/1 system-ui,sans-serif;padding:10px 13px;',
      'border-radius:10px}',
      '.omsNvBody{flex:1 1 auto;min-height:0;overflow:auto;-webkit-overflow-scrolling:touch;',
      'padding:14px 0;display:flex;flex-direction:column;gap:10px}',
      '.omsNvRow{display:flex;align-items:center;gap:10px;padding:12px;',
      'border:1px solid #1b2029;border-radius:13px;background:#080a0e}',
      '.omsNvRow div{flex:1 1 auto;min-width:0}',
      '.omsNvRow b{display:block;font:700 13.5px/1.35 system-ui,sans-serif}',
      '.omsNvRow span{display:block;margin-top:3px;font-size:11.5px;color:#79838f}',
      '.omsNvRow button,.omsNvFoot button{appearance:none;border:1px solid #2a3240;',
      'background:#141821;color:#cfd8e5;font:700 12px/1 system-ui,sans-serif;',
      'padding:11px 14px;border-radius:10px;white-space:nowrap}',
      '.omsNvFoot{flex:0 0 auto;display:flex;gap:9px;padding-top:12px;border-top:1px solid #171b23}',
      '.omsNvFoot button{flex:1 1 0}',
      '.omsNvFoot button.primary{background:#39ddcf;border-color:#39ddcf;color:#04120f}',
      '.omsNvNote{font-size:11.5px;line-height:1.55;color:#7d8796}',
      '.omsNvWarn{color:#ffbd77}',
      '.omsNvSlider{display:flex;flex-direction:column;gap:6px}',
      '.omsNvSlider label{display:flex;justify-content:space-between;font-size:12px;color:#9aa6b5}',
      '.omsNvSlider input[type=range]{width:100%;accent-color:#39ddcf}',
      '.omsNvSeg{display:flex;gap:6px}',
      '.omsNvSeg button{flex:1 1 0;appearance:none;border:1px solid #232a36;background:#0d1016;',
      'color:#aebbcc;font:700 11.5px/1 system-ui,sans-serif;padding:11px 6px;border-radius:9px}',
      '.omsNvSeg button.on{background:#17302d;border-color:#39ddcf;color:#5fe6da}',
    ].join('');
    document.head.appendChild(style);
  }

  function toast(message) {
    if (typeof window.toast === 'function') window.toast(message);
  }

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  function sheet(title, closeLabel) {
    installStyle();
    var host = el('div', 'omsNvSheet');
    var card = el('div', 'omsNvCard');
    var head = el('div', 'omsNvHead');
    head.appendChild(el('b', null, title));
    var close = el('button', null, closeLabel || 'Close');
    close.type = 'button';
    head.appendChild(close);
    var body = el('div', 'omsNvBody');
    var foot = el('div', 'omsNvFoot');
    card.appendChild(head);
    card.appendChild(body);
    card.appendChild(foot);
    host.appendChild(card);
    document.body.appendChild(host);
    function dismiss() { host.remove(); }
    close.addEventListener('click', dismiss);
    host.addEventListener('click', function (event) { if (event.target === host) dismiss(); });
    return { host: host, body: body, foot: foot, close: dismiss };
  }

  /* ---------------------------------------------------------- import ------- */

  function importView(prefill) {
    var view = sheet('Import Node Video project');
    var pick = el('button', 'primary', 'Choose .zip');
    pick.type = 'button';
    view.foot.appendChild(pick);

    view.body.appendChild(el('div', 'omsNvNote',
      'Pick the .zip that Node Video exported from its project menu.'));
    var list = el('div');
    view.body.appendChild(list);

    var input = el('input');
    input.type = 'file';
    input.accept = '.zip,application/zip,application/x-zip-compressed,application/octet-stream';
    input.style.display = 'none';
    view.body.appendChild(input);

    function run(file) {
      list.textContent = '';
      var status = el('div', 'omsNvNote', 'Reading ' + file.name + '…');
      list.appendChild(status);
      pick.disabled = true;
      pick.textContent = 'Reading…';
      window.omsNodeVideo.importFile(file).then(function (report) {
        status.remove();
        pick.disabled = false;
        var ok = el('div', 'omsNvRow');
        var info = el('div');
        info.appendChild(el('b', null, 'Imported ' + report.layers + ' layer' +
          (report.layers === 1 ? '' : 's')));
        info.appendChild(el('span', null,
          report.media + ' media file' + (report.media === 1 ? '' : 's') +
          (report.speed ? ' · ' + report.speed + ' with speed change' : '') +
          (report.interpolation ? ' · ' + report.interpolation + ' with interpolation' : '')));
        ok.appendChild(info);
        list.appendChild(ok);

        if (report.missing.length) {
          var miss = el('div', 'omsNvRow');
          var missInfo = el('div');
          missInfo.appendChild(el('b', null, report.missing.length + ' media file' +
            (report.missing.length === 1 ? '' : 's') + ' not found'));
          missInfo.appendChild(el('span', null, report.missing.slice(0, 4).join(', ')));
          miss.appendChild(missInfo);
          list.appendChild(miss);
        }
        var unmapped = Object.keys(report.unmapped || {});
        if (unmapped.length) {
          list.appendChild(el('div', 'omsNvNote omsNvWarn',
            'Not carried over (they belong to the other app): ' +
            unmapped.map(function (key) { return key + ' \u00d7' + report.unmapped[key]; }).join(', ')));
        }
        pick.textContent = 'Open project';
        pick.onclick = view.close;
      }).catch(function (error) {
        pick.disabled = false;
        pick.textContent = 'Choose .zip';
        status.remove();
        var fail = el('div', 'omsNvRow');
        var failInfo = el('div');
        failInfo.appendChild(el('b', null, 'That package could not be read'));
        failInfo.appendChild(el('span', null, (error && error.message) || String(error)));
        fail.appendChild(failInfo);
        list.appendChild(fail);
      });
    }

    input.addEventListener('change', function () {
      var file = input.files && input.files[0];
      input.value = '';
      if (file) run(file);
    });
    pick.addEventListener('click', function () { input.click(); });

    // A file handed in from the home screen's ZIP button is read straight away, so both
    // entry points end up in the same report.
    view.feed = run;
    if (prefill) run(prefill);
    return view;
  }

  /* ---------------------------------------------------------- export ------- */

  function exportView() {
    var view = sheet('Export Node Video package');
    var go = el('button', 'primary', 'Export .zip');
    go.type = 'button';
    view.foot.appendChild(go);
    view.body.appendChild(el('div', 'omsNvNote',
      'Writes a .zip holding project.json and the timeline this app can read back. ' +
      'Node Video reads its own private layout, so treat this as a portable backup and ' +
      'a way to hand work between EditorsHub installs.'));
    go.addEventListener('click', function () {
      go.disabled = true;
      go.textContent = 'Packing…';
      window.omsNodeVideo.exportProject().then(function () {
        toast('Package exported');
        view.close();
      }).catch(function (error) {
        go.disabled = false;
        go.textContent = 'Export .zip';
        toast((error && error.message) || 'Could not export');
      });
    });
    return view;
  }

  /* ------------------------------------------------------- speed features -- */

  function selectedLayer() {
    var model = window.model;
    if (!model || !model.selectedLayer) return null;
    return model.selectedLayer();
  }

  /** Writes a speed change and rescales the clip exactly as the editor's own Speed does. */
  function applySpeed(layer, speed) {
    var model = window.model;
    var history = window.__omsHistory;
    speed = Math.min(4, Math.max(0.25, speed));
    var old = Math.min(4, Math.max(0.25, +layer.playbackRate || 1));
    if (Math.abs(speed - old) < 1e-6) return;
    if (history && history.push) history.push();
    if (layer.type === 'video' || layer.type === 'audio') {
      var sourceSpan = Math.max(0.001, (+layer.duration || 1) * old);
      layer.playbackRate = speed;
      layer.duration = Math.max(1 / Math.max(1, model.project.fps || 30), sourceSpan / speed);
      var media = layer.video || layer.audio;
      if (media) { try { media.playbackRate = speed; } catch (e) { /* decoder refusal is not fatal */ } }
    } else {
      var ratio = old / speed;
      var start = Math.max(0, +layer.start || 0);
      Object.keys(layer.kf || {}).forEach(function (key) {
        var arr = layer.kf[key];
        if (!Array.isArray(arr)) return;
        arr.forEach(function (k) { if (Number.isFinite(+k.t)) k.t = start + (+k.t - start) * ratio; });
        arr.sort(function (a, b) { return a.t - b.t; });
      });
      layer.duration = Math.max(0.05, (+layer.duration || 1) * ratio);
      layer.playbackRate = speed;
    }
    if (model.syncProjectDurationToContent) model.syncProjectDurationToContent();
    try { window.ui.rebuildAll(); } catch (e) { /* optional */ }
    try { window.__omsTimeline && window.__omsTimeline.rebuild(); } catch (e) { /* optional */ }
    try { window.__omsRenderer && window.__omsRenderer.render(); } catch (e) { /* optional */ }
  }

  /**
   * Speed ramp: keyframes the layer's speed over its own length.
   *
   * The editor stores speed as one number per layer, so a true ramp needs a per-frame
   * value. Rather than fake it, this applies a ramp as a series of equal slices with
   * stepped speed -- visibly a ramp at any normal frame rate -- and records the intent
   * on the layer so it can be edited again later.
   */
  function applyRamp(layer, from, to) {
    var model = window.model;
    if (!model || !layer) return 0;
    var history = window.__omsHistory;
    var total = Math.max(0.1, +layer.duration || 1);
    // Few steps, not many: every slice is a real layer, and twelve decoders for one clip
    // would cost more than the smoothness is worth. Five reads as a ramp at any normal
    // frame rate.
    var steps = Math.max(2, Math.min(5, Math.round(total / 0.5)));
    var baseStart = Math.max(0, +layer.start || 0);
    var slice = total / steps;
    var isMedia = layer.type === 'video' || layer.type === 'audio';

    // Media bytes are referenced by asset id, never copied per slice: the editor's own
    // duplicate-video path shares one decoder between layers with the same asset.
    if (isMedia && window.mediaAssets && window.mediaAssets.captureLayer) {
      try { window.mediaAssets.captureLayer(layer); } catch (e) { /* registry keeps its own copy */ }
    }

    // A layer with keyframed animation is not sliced: five copies would replay its
    // animation five times. Its keyframes are time-warped instead, which is what a speed
    // ramp means for animation -- the motion genuinely speeds up and slows down.
    if (!isMedia) return rampHidden(layer, from, to, model, history);

    var template;
    if (typeof model.cleanLayer === 'function') {
      template = JSON.parse(JSON.stringify(model.cleanLayer(layer, { includeMedia: false })));
    } else {
      template = JSON.parse(JSON.stringify(layer));
      delete template.img; delete template.video; delete template.audio;
      delete template.frameCanvas; delete template.frameCtx; delete template.dataUrl;
    }

    if (history && history.push) history.push();
    var made = 0;
    for (var i = 0; i < steps; i++) {
      var fraction = steps === 1 ? 0 : i / (steps - 1);
      var speed = Math.min(4, Math.max(0.1, from + (to - from) * fraction));
      var options = JSON.parse(JSON.stringify(template));
      delete options.id;
      options.name = ((layer.name || 'Layer') + ' ' + (i + 1)).slice(0, 60);
      options.start = baseStart + i * slice;
      options.playbackRate = speed;
      if (isMedia) {
        options.assetId = layer.assetId;
        // Each slice must read a different part of the source, at its own rate.
        var readFrom = (+layer.sourceIn || 0);
        for (var k = 0; k < i; k++) {
          var previousSpeed = Math.min(4, Math.max(0.1, from + (to - from) * (steps === 1 ? 0 : k / (steps - 1))));
          readFrom += slice * previousSpeed;
        }
        var span = slice * speed;
        options.sourceIn = readFrom;
        options.sourceOut = Number.isFinite(+layer.sourceDuration)
          ? Math.min(+layer.sourceDuration, readFrom + span)
          : readFrom + span;
        options.duration = slice;
        delete options.dataUrl;
      } else {
        options.duration = slice;
      }
      var created = model.addLayer(layer.type, options);
      if (created) made += 1;
    }
    // The original clip is replaced by the ramp, so the timeline length stays honest.
    var at = model.layers.indexOf(layer);
    if (at >= 0 && made > 0) {
      model.layers.splice(at, 1);
      if (model.disposeLayerRuntime) { try { model.disposeLayerRuntime(layer); } catch (e) { /* optional */ } }
    }
    try { window.ui.rebuildAll(); } catch (e) { /* optional */ }
    try { window.__omsTimeline && window.__omsTimeline.rebuild(); } catch (e) { /* optional */ }
    try { window.__omsRenderer && window.__omsRenderer.render(); } catch (e) { /* optional */ }
    return made;
  }


  /**
   * Time-warps a keyframed layer.
   *
   * With playback speed v(p) at source position p, the output time needed to reach p is
   * the integral of 1/v from 0 to p. Normalising that to the clip length moves every
   * keyframe to where it would land if the clip really played at the ramped speed.
   */
  function rampHidden(layer, from, to, model, history) {
    var start = Math.max(0, +layer.start || 0);
    var duration = Math.max(0.1, +layer.duration || 1);
    var lo = Math.min(4, Math.max(0.1, from));
    var hi = Math.min(4, Math.max(0.1, to));
    var STEPS = 64;
    var cumulative = new Float64Array(STEPS + 1);
    for (var i = 1; i <= STEPS; i++) {
      var q = (i - 0.5) / STEPS;
      cumulative[i] = cumulative[i - 1] + 1 / (lo + (hi - lo) * q);
    }
    var total = cumulative[STEPS] || 1;
    function warp(local) {
      var p = Math.min(1, Math.max(0, local / duration));
      var x = p * STEPS;
      var index = Math.min(STEPS - 1, Math.floor(x));
      var frac = x - index;
      var carried = cumulative[index] + (cumulative[index + 1] - cumulative[index]) * frac;
      return (carried / total) * duration;
    }
    if (history && history.push) history.push();
    var moved = 0;
    Object.keys(layer.kf || {}).forEach(function (key) {
      var arr = layer.kf[key];
      if (!Array.isArray(arr)) return;
      arr.forEach(function (k) {
        if (!Number.isFinite(+k.t)) return;
        k.t = start + warp(+k.t - start);
        moved += 1;
      });
      arr.sort(function (a, b) { return a.t - b.t; });
    });
    if (layer.name) layer.name = String(layer.name).slice(0, 55);
    layer.omsSpeedRamp = { from: lo, to: hi };
    try { window.ui.rebuildAll(); } catch (e) { /* optional */ }
    try { window.__omsTimeline && window.__omsTimeline.rebuild(); } catch (e) { /* optional */ }
    try { window.__omsRenderer && window.__omsRenderer.render(); } catch (e) { /* optional */ }
    return moved ? 1 : 0;
  }

  function speedView() {
    var layer = selectedLayer();
    if (!layer) {
      toast('Select a layer first');
      return null;
    }
    var view = sheet('Speed · ' + (layer.name || 'Layer'));
    var current = Math.min(4, Math.max(0.25, +layer.playbackRate || 1));

    var readout = el('div', 'omsNvNote', 'Current speed ' + current.toFixed(2) + '×');
    view.body.appendChild(readout);

    // --- steady speed
    var steady = el('div', 'omsNvSlider');
    var steadyLabel = el('label');
    steadyLabel.appendChild(el('span', null, 'Speed'));
    var steadyValue = el('b', null, current.toFixed(2) + '×');
    steadyLabel.appendChild(steadyValue);
    var range = el('input');
    range.type = 'range';
    range.min = '0.25';
    range.max = '4';
    range.step = '0.05';
    range.value = String(current);
    range.addEventListener('input', function () {
      steadyValue.textContent = Number(range.value).toFixed(2) + '×';
    });
    range.addEventListener('change', function () {
      applySpeed(layer, Number(range.value));
      readout.textContent = 'Current speed ' + Number(range.value).toFixed(2) + '×';
    });
    steady.appendChild(steadyLabel);
    steady.appendChild(range);
    view.body.appendChild(steady);

    var presets = el('div', 'omsNvSeg');
    [0.25, 0.5, 1, 2, 4].forEach(function (value) {
      var button = el('button', Math.abs(value - current) < 0.01 ? 'on' : '', value + '×');
      button.type = 'button';
      button.addEventListener('click', function () {
        applySpeed(layer, value);
        range.value = String(value);
        steadyValue.textContent = value.toFixed(2) + '×';
        readout.textContent = 'Current speed ' + value.toFixed(2) + '×';
      });
      presets.appendChild(button);
    });
    view.body.appendChild(presets);

    // --- ramp
    view.body.appendChild(el('div', 'omsNvNote',
      'Speed ramp splits this clip into short steps so it starts at one speed and ends at ' +
      'another. Use it for slow motion that eases in or out.'));
    var rampRow = el('div', 'omsNvSlider');
    var rampLabel = el('label');
    rampLabel.appendChild(el('span', null, 'Ramp start → end'));
    var rampValue = el('b', null, '1.00× → 0.25×');
    rampLabel.appendChild(rampValue);
    var fromRange = el('input');
    fromRange.type = 'range'; fromRange.min = '0.25'; fromRange.max = '4';
    fromRange.step = '0.05'; fromRange.value = '1';
    var toRange = el('input');
    toRange.type = 'range'; toRange.min = '0.25'; toRange.max = '4';
    toRange.step = '0.05'; toRange.value = '0.25';
    function syncRamp() {
      rampValue.textContent = Number(fromRange.value).toFixed(2) + '× → ' +
        Number(toRange.value).toFixed(2) + '×';
    }
    fromRange.addEventListener('input', syncRamp);
    toRange.addEventListener('input', syncRamp);
    rampRow.appendChild(rampLabel);
    rampRow.appendChild(fromRange);
    rampRow.appendChild(toRange);
    view.body.appendChild(rampRow);

    var applyBtn = el('button', 'primary', 'Apply speed ramp');
    applyBtn.type = 'button';
    applyBtn.addEventListener('click', function () {
      var made = applyRamp(layer, Number(fromRange.value), Number(toRange.value));
      toast(made ? 'Speed ramp applied' : 'Could not apply the ramp');
      view.close();
    });
    view.foot.appendChild(applyBtn);

    // --- interpolation / motion blur, video only
    if (layer.type === 'video') {
      view.body.appendChild(el('div', 'omsNvNote',
        'Smooth motion blends neighbouring frames so slow motion looks fluid instead of ' +
        'stepping. It costs some speed while playing.'));
      var smooth = el('div', 'omsNvSeg');
      [['off', 'Off'], ['blend', 'Smooth'], ['optical-flow', 'Optical flow']].forEach(function (pair) {
        var on = (layer.omsInterpolation || 'off') === pair[0];
        var button = el('button', on ? 'on' : '', pair[1]);
        button.type = 'button';
        button.addEventListener('click', function () {
          var history = window.__omsHistory;
          if (history && history.push) history.push();
          layer.omsInterpolation = pair[0];
          Array.prototype.forEach.call(smooth.children, function (child) {
            child.classList.toggle('on', child === button);
          });
          toast(pair[1] === 'Off' ? 'Smooth motion off' : 'Smooth motion: ' + pair[1]);
        });
        smooth.appendChild(button);
      });
      view.body.appendChild(smooth);
      view.body.appendChild(el('div', 'omsNvNote',
        'Optical flow needs neighbouring decoded frames. On this build "Smooth" blends ' +
        'the frames the decoder has already produced, and "Optical flow" marks the layer ' +
        'for the exporter, which has every frame available.'));
    }
    return view;
  }

  /* ------------------------------------------------------------ entry ----- */

  window.omsNodeVideoUI = {
    openImport: importView,
    openExport: exportView,
    openSpeed: speedView,
    applySpeed: applySpeed,
    applyRamp: applyRamp,
  };
})();
