/*
 * EditorsHub -- Node Video project import.
 *
 * WHAT A NODE VIDEO PROJECT IS
 *
 * Node Video saves a project as a .zip: a description of the timeline (layers, their
 * times, transforms, speed changes, interpolation and settings) plus the media those
 * layers point at. There is no published specification and the internal file names have
 * changed between app versions, so this reader does not assume one fixed name. It looks
 * for every .json member in the archive, scores them as a timeline description, and
 * parses the best candidate with a tolerant reader that understands the shapes these
 * files use in practice:
 *
 *   nodes / layers / clips / tracks / tracks[i].clips   the layer list, in several dialects
 *   speed / rate / timeScale / playbackRate             speed change
 *   interpolate / interpolation / frameInterpolation    frame interpolation
 *
 * Anything it cannot map is listed in the import report rather than silently dropped, so
 * a project that half-imports says exactly which parts need a manual touch.
 *
 * WHAT IT DOES NOT DO
 *
 * It does not decode Node Video's effect graphs, LUTs, particle presets or its custom
 * "node" compositing network -- those are Node Video's own renderer, not data. A project
 * using them imports with its layers, timing, speed and interpolation intact and reports
 * the effects it could not bring across.
 *
 * Frame interpolation in Node Video is a render-time quality setting. Here it is recorded
 * as a project flag and surfaced in the project settings, so the intent survives the
 * import even where the exporter cannot synthesise new frames.
 */
(function () {
  'use strict';

  var MAX_ZIP = 1024 * 1024 * 1024;      // 1 GB archive
  var MAX_EXPANDED = 2048 * 1024 * 1024; // 2 GB after decompression
  var MAX_ENTRY = 512 * 1024 * 1024;

  /* ---------------------------------------------------------------- zip ----- */

  var crcTable = null;
  function crc32(bytes) {
    if (!crcTable) {
      crcTable = new Uint32Array(256);
      for (var i = 0; i < 256; i++) {
        var v = i;
        for (var k = 0; k < 8; k++) v = v & 1 ? 0xedb88320 ^ (v >>> 1) : v >>> 1;
        crcTable[i] = v >>> 0;
      }
    }
    var crc = 0xffffffff;
    for (var j = 0; j < bytes.length; j++) crc = crcTable[(crc ^ bytes[j]) & 255] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  /** Reads the central directory of a .zip and returns its file entries. */
  function indexZip(bytes) {
    if (!bytes || bytes.length < 22) throw new Error('That file is empty');
    if (bytes.length > MAX_ZIP) throw new Error('That package is too large');
    var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    function fits(at, n) { return at >= 0 && at + n <= bytes.length; }

    var end = -1;
    for (var at = bytes.length - 22; at >= Math.max(0, bytes.length - 65557); at--) {
      if (view.getUint32(at, true) === 0x06054b50 && at + 22 + view.getUint16(at + 20, true) === bytes.length) {
        end = at;
        break;
      }
    }
    if (end < 0) throw new Error('That is not a .zip package');
    if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true)) {
      throw new Error('Multi-part archives are not supported');
    }
    var count = view.getUint16(end + 10, true);
    var centralSize = view.getUint32(end + 12, true);
    var offset = view.getUint32(end + 16, true);
    if (!count || count > 20000) throw new Error('That package is empty or damaged');
    if (offset + centralSize !== end) throw new Error('That package is damaged');

    var entries = [];
    var names = new Set();
    var decoder = new TextDecoder('utf-8');
    var expanded = 0;
    var pos = offset;
    for (var i = 0; i < count; i++) {
      if (!fits(pos, 46) || view.getUint32(pos, true) !== 0x02014b50) {
        throw new Error('That package is damaged');
      }
      var flags = view.getUint16(pos + 8, true);
      var method = view.getUint16(pos + 10, true);
      var crc = view.getUint32(pos + 16, true);
      var compressed = view.getUint32(pos + 20, true);
      var size = view.getUint32(pos + 24, true);
      var nameLength = view.getUint16(pos + 28, true);
      var extra = view.getUint16(pos + 30, true);
      var comment = view.getUint16(pos + 32, true);
      var local = view.getUint32(pos + 42, true);
      if (flags & 1) throw new Error('Password-protected packages are not supported');
      if (method !== 0 && method !== 8) throw new Error('That package uses an unsupported compression');
      if (size === 0xffffffff || compressed === 0xffffffff || local === 0xffffffff) {
        throw new Error('Packages over 4 GB are not supported');
      }
      if (!fits(pos + 46, nameLength + extra + comment)) throw new Error('That package is damaged');
      var name = decoder.decode(bytes.subarray(pos + 46, pos + 46 + nameLength));
      if (!name || name.includes('\u0000') || name.split(/[\\/]/).some(function (p) { return p === '..'; })) {
        throw new Error('That package contains an unsafe file name');
      }
      if (names.has(name)) throw new Error('That package lists the same file twice');
      names.add(name);
      {
        if (!fits(local, 30) || view.getUint32(local, true) !== 0x04034b50) {
          throw new Error('That package is damaged');
        }
        var localName = view.getUint16(local + 26, true);
        var dataStart = local + 30 + localName + view.getUint16(local + 28, true);
        if (!fits(dataStart, compressed)) throw new Error('That package is damaged');
        expanded += size;
        if (size > MAX_ENTRY || expanded > MAX_EXPANDED) {
          throw new Error('That package is too large once unpacked');
        }
        if (!name.endsWith('/')) {
          entries.push({ name: name, method: method, crc: crc, size: size, compressed: compressed, start: dataStart });
        }
      }
      pos += 46 + nameLength + extra + comment;
    }
    return entries;
  }

  function readStream(stream, limit) {
    var reader = stream.getReader();
    var chunks = [];
    var length = 0;
    return (function pump() {
      return reader.read().then(function (part) {
        if (part.done) {
          var out = new Uint8Array(length);
          var at = 0;
          chunks.forEach(function (c) { out.set(c, at); at += c.length; });
          return out;
        }
        length += part.value.byteLength;
        if (length > limit) {
          try { reader.cancel(); } catch (e) { /* ignore */ }
          throw new Error('That package is too large once unpacked');
        }
        chunks.push(part.value);
        return pump();
      });
    })();
  }

  /*
   * A raw-deflate decoder, used only when the WebView has no DecompressionStream.
   *
   * The browser route was the whole of the import path, and it is not guaranteed: a
   * WebView older than Chrome 80 has no DecompressionStream, and a device that refuses
   * 'deflate-raw' throws on construction. Every Node Video project zip is deflate-compressed,
   * so on those devices every import ended at "That package could not be read" -- the error
   * the user saw three times. RFC 1951 is small enough to carry, so it is carried: the
   * browser decoder is still preferred, this is the floor.
   */
  var LEN_BASE = [3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258];
  var LEN_EXTRA = [0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0];
  var DIST_BASE = [1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577];
  var DIST_EXTRA = [0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13];
  // Code lengths arrive in this order, not numerically.
  var CLC_ORDER = [16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15];

  function huffman(lengths) {
    var maxBits = 0, i;
    for (i = 0; i < lengths.length; i++) if (lengths[i] > maxBits) maxBits = lengths[i];
    var counts = new Uint16Array(maxBits + 1);
    for (i = 0; i < lengths.length; i++) if (lengths[i]) counts[lengths[i]]++;
    var offsets = new Uint16Array(maxBits + 1), total = 0;
    for (i = 1; i <= maxBits; i++) { offsets[i] = total; total += counts[i]; }
    var symbols = new Uint16Array(total);
    for (i = 0; i < lengths.length; i++) {
      if (lengths[i]) symbols[offsets[lengths[i]]++] = i;
    }
    return { counts: counts, symbols: symbols, maxBits: maxBits };
  }

  function inflateRaw(source, expected) {
    var pos = 0, bitBuf = 0, bitCount = 0;
    var out = new Uint8Array(Math.max(64, expected || 1024));
    var outLength = 0;
    function need(size) {
      if (outLength + size <= out.length) return;
      var next = new Uint8Array(Math.max(out.length * 2, outLength + size + 64));
      next.set(out.subarray(0, outLength));
      out = next;
    }
    function bits(count) {
      while (bitCount < count) {
        if (pos >= source.length) throw new Error('That package is damaged');
        bitBuf |= source[pos++] << bitCount;
        bitCount += 8;
      }
      var value = bitBuf & ((1 << count) - 1);
      bitBuf >>>= count;
      bitCount -= count;
      return value;
    }
    function decode(table) {
      var code = 0, first = 0, index = 0;
      for (var len = 1; len <= table.maxBits; len++) {
        code |= bits(1);
        var count = table.counts[len];
        if (code - first < count) return table.symbols[index + (code - first)];
        index += count;
        first = (first + count) << 1;
        code <<= 1;
      }
      throw new Error('That package is damaged');
    }
    function fixedTables() {
      var lit = new Uint8Array(288), i;
      for (i = 0; i < 144; i++) lit[i] = 8;
      for (; i < 256; i++) lit[i] = 9;
      for (; i < 280; i++) lit[i] = 7;
      for (; i < 288; i++) lit[i] = 8;
      var dist = new Uint8Array(30);
      for (i = 0; i < 30; i++) dist[i] = 5;
      return { lit: huffman(lit), dist: huffman(dist) };
    }
    var last = 0, fixed = null;
    while (!last) {
      last = bits(1);
      var type = bits(2);
      if (type === 0) {
        // Stored block: the bit stream is byte aligned first.
        bitBuf = 0; bitCount = 0;
        if (pos + 4 > source.length) throw new Error('That package is damaged');
        var length = source[pos] | (source[pos + 1] << 8);
        pos += 4;
        if (pos + length > source.length) throw new Error('That package is damaged');
        need(length);
        out.set(source.subarray(pos, pos + length), outLength);
        outLength += length;
        pos += length;
        continue;
      }
      var litTable, distTable;
      if (type === 1) {
        if (!fixed) fixed = fixedTables();
        litTable = fixed.lit; distTable = fixed.dist;
      } else if (type === 2) {
        var hlit = bits(5) + 257, hdist = bits(5) + 1, hclen = bits(4) + 4;
        var clc = new Uint8Array(19), i;
        for (i = 0; i < hclen; i++) clc[CLC_ORDER[i]] = bits(3);
        var clTable = huffman(clc);
        var lengths = new Uint8Array(hlit + hdist), at = 0;
        while (at < hlit + hdist) {
          var symbol = decode(clTable);
          if (symbol < 16) { lengths[at++] = symbol; continue; }
          var repeat, value = 0;
          if (symbol === 16) {
            if (!at) throw new Error('That package is damaged');
            value = lengths[at - 1]; repeat = 3 + bits(2);
          } else if (symbol === 17) { repeat = 3 + bits(3); }
          else { repeat = 11 + bits(7); }
          if (at + repeat > hlit + hdist) throw new Error('That package is damaged');
          while (repeat--) lengths[at++] = value;
        }
        litTable = huffman(lengths.subarray(0, hlit));
        distTable = huffman(lengths.subarray(hlit));
      } else {
        throw new Error('That package uses an unsupported compression');
      }
      for (;;) {
        var sym = decode(litTable);
        if (sym < 256) {
          need(1);
          out[outLength++] = sym;
          continue;
        }
        if (sym === 256) break;
        sym -= 257;
        if (sym >= 29) throw new Error('That package is damaged');
        var runLength = LEN_BASE[sym] + bits(LEN_EXTRA[sym]);
        var distSym = decode(distTable);
        if (distSym >= 30) throw new Error('That package is damaged');
        var distance = DIST_BASE[distSym] + bits(DIST_EXTRA[distSym]);
        if (distance > outLength) throw new Error('That package is damaged');
        need(runLength);
        for (var k = 0; k < runLength; k++, outLength++) out[outLength] = out[outLength - distance];
      }
    }
    return out.slice(0, outLength);
  }

  /** Decompresses one entry to a Uint8Array. */
  function readEntry(bytes, entry) {
    var raw = bytes.subarray(entry.start, entry.start + entry.compressed);
    var work;
    if (entry.method === 8) {
      // Browser decoder first: it runs natively and is faster on large media. The carried
      // decoder is the fallback, not the other way round.
      var inflater = null;
      if (typeof DecompressionStream === 'function') {
        try { inflater = new DecompressionStream('deflate-raw'); } catch (e) { inflater = null; }
      }
      if (inflater) {
        work = readStream(new Blob([raw]).stream().pipeThrough(inflater), entry.size + 1)
          .catch(function () { return Promise.resolve().then(function () { return inflateRaw(raw, entry.size); }); });
      } else {
        work = Promise.resolve().then(function () { return inflateRaw(raw, entry.size); });
      }
    } else {
      work = Promise.resolve(raw);
    }
    return work.then(function (out) {
      if (crc32(out) !== entry.crc) {
        throw new Error('"' + entry.name + '" is damaged inside the package');
      }
      return out;
    });
  }

  /* ------------------------------------------------------------- reader ----- */

  var MEDIA_EXT = /\.(mp4|m4v|mov|webm|mkv|mp3|m4a|aac|wav|ogg|flac|png|jpe?g|webp|gif|bmp|avif|heic)$/i;

  function mimeFor(name) {
    var ext = String(name).toLowerCase().split('.').pop();
    return ({
      mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm',
      mkv: 'video/x-matroska', mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac',
      wav: 'audio/wav', ogg: 'audio/ogg', flac: 'audio/flac', png: 'image/png',
      jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
      bmp: 'image/bmp', avif: 'image/avif', heic: 'image/heic',
    })[ext] || 'application/octet-stream';
  }

  function num(value, fallback) {
    var n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  /** Time values may be seconds, milliseconds or microseconds. Guess by magnitude. */
  function seconds(value) {
    var n = num(value, NaN);
    if (!Number.isFinite(n)) return NaN;
    var abs = Math.abs(n);
    if (abs >= 1e7) return n / 1e6;  // microseconds
    if (abs >= 1e5) return n / 1e3;  // milliseconds
    return n;
  }

  /** First array found under any of the usual names, at the top level or one down. */
  function findLayerArray(doc, depth) {
    depth = depth || 0;
    if (!doc || typeof doc !== 'object' || depth > 2) return null;
    var keys = ['layers', 'nodes', 'clips', 'tracks', 'items', 'elements', 'children', 'segments', 'videoTracks', 'list'];
    for (var i = 0; i < keys.length; i++) {
      var candidate = doc[keys[i]];
      if (Array.isArray(candidate) && candidate.length) {
        // `tracks` may hold track objects that each own a clip list.
        if (keys[i] === 'tracks' && candidate.every(function (t) { return t && Array.isArray(t.clips); })) {
          var flat = [];
          candidate.forEach(function (t) { t.clips.forEach(function (c) { flat.push(Object.assign({}, c, { _track: t })); }); });
          return flat;
        }
        return candidate;
      }
    }
    var nested = ['timeline', 'composition', 'project', 'sequence', 'scene', 'data', 'content', 'root', 'graph'];
    for (var j = 0; j < nested.length; j++) {
      var found = findLayerArray(doc[nested[j]], depth + 1);
      if (found) return found;
    }
    if (Array.isArray(doc)) return doc;
    for (var key in doc) {
      if (!Object.prototype.hasOwnProperty.call(doc, key)) continue;
      var value = doc[key];
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        var deep = findLayerArray(value, depth + 1);
        if (deep) return deep;
      }
    }
    return null;
  }

  /** Scores a JSON document as a timeline description. Higher is a better candidate. */
  function score(doc) {
    var layers = findLayerArray(doc);
    if (!layers) return 0;
    var total = 10 + Math.min(20, layers.length);
    var probe = JSON.stringify(doc).slice(0, 20000);
    ['speed', 'duration', 'start', 'interpolat', 'frame', 'fps', 'type', 'width', 'height'].forEach(function (key) {
      if (probe.indexOf('"' + key) !== -1) total += 3;
    });
    return total;
  }

  function pickMedia(entry) {
    if (!MEDIA_EXT.test(entry.name)) return false;
    if (/(^|\/)(thumb|thumbnail|preview|cover|poster|icon)\b/i.test(entry.name)) return false;
    return true;
  }

  function baseName(name) {
    return String(name || '').split('/').pop();
  }

  /** Matches a layer's media reference against the archive by name or by path suffix. */
  function matchMedia(ref, media) {
    if (!ref || typeof ref !== 'string') return null;
    var want = baseName(ref).toLowerCase();
    if (!want) return null;
    for (var i = 0; i < media.length; i++) {
      if (baseName(media[i].entry.name).toLowerCase() === want) return media[i];
    }
    var tail = ref.toLowerCase();
    for (var j = 0; j < media.length; j++) {
      if (media[j].entry.name.toLowerCase().endsWith(tail)) return media[j];
    }
    return null;
  }

  function layerKind(raw, mediaHit) {
    var declared = String(raw.type || raw.kind || raw.layerType || raw.mediaType || raw.category || '').toLowerCase();
    if (/text|caption|title|subtitle/.test(declared)) return 'text';
    if (/audio|sound|music|voice/.test(declared)) return 'audio';
    if (/video|movie|film|clip|footage/.test(declared)) return 'video';
    if (/image|photo|picture|still|png|jpe?g/.test(declared)) return 'image';
    if (/shape|rect|circle|ellipse|polygon|solid|color|colour/.test(declared)) return 'shape';
    if (/group|folder|composition|precomp|nest/.test(declared)) return 'group';
    if (mediaHit) {
      var mime = mimeFor(mediaHit.entry.name);
      if (mime.indexOf('video/') === 0) return 'video';
      if (mime.indexOf('audio/') === 0) return 'audio';
      if (mime.indexOf('image/') === 0) return 'image';
    }
    if (raw.text || raw.content || raw.value && typeof raw.value === 'string') return 'text';
    return 'shape';
  }

  function speedOf(raw) {
    var candidates = [
      raw.speed, raw.rate, raw.timeScale, raw.timeStretch, raw.playbackRate,
      raw.playbackSpeed, raw.speedFactor, raw.playRate,
      raw.transform && raw.transform.speed,
      raw.timing && raw.timing.speed,
      raw.time && raw.time.speed,
    ];
    for (var i = 0; i < candidates.length; i++) {
      var n = num(candidates[i], NaN);
      if (Number.isFinite(n) && n > 0) return n;
    }
    return 1;
  }

  function interpolationOf(raw) {
    var value = raw.interpolation ?? raw.interpolate ?? raw.frameInterpolation ??
      raw.frameInterpolationMode ?? raw.opticalFlow ?? (raw.timing && raw.timing.interpolation) ??
      (raw.render && raw.render.interpolation);
    if (value === true) return 'optical-flow';
    if (value === false || value == null) return null;
    if (typeof value === 'number') return value > 0 ? 'optical-flow' : null;
    var text = String(value).toLowerCase();
    if (!text || text === 'none' || text === 'off' || text === 'false' || text === '0') return null;
    if (/flow|optical|smooth|blend/.test(text)) return 'optical-flow';
    return text;
  }

  function textOf(raw) {
    var value = raw.text ?? raw.content ?? raw.value ?? raw.caption ?? raw.string ??
      (raw.textLayer && raw.textLayer.text) ?? (raw.style && raw.style.text);
    return typeof value === 'string' ? value : '';
  }

  function colourOf(raw) {
    var value = raw.color ?? raw.colour ?? raw.fill ?? (raw.style && raw.style.color);
    if (typeof value !== 'string') return null;
    if (/^#[0-9a-f]{3,8}$/i.test(value)) return value.slice(0, 7);
    return null;
  }

  /**
   * Converts one Node Video layer into the editor's layer-option shape.
   *
   * Only keys the editor understands are produced; anything else is counted as an
   * unmapped feature so the report can name it.
   */
  function convertLayer(raw, ctx) {
    var report = ctx.report;
    var mediaHit = matchMedia(raw.file || raw.src || raw.path || raw.uri || raw.mediaName ||
      raw.filename || raw.media || raw.source, ctx.media);
    var kind = layerKind(raw, mediaHit);
    var start = seconds(raw.start ?? raw.startTime ?? raw.from ?? raw.in ?? raw.offset ??
      (raw.time && raw.time.start));
    var duration = seconds(raw.duration ?? raw.length ?? raw.endTime ?? raw.span ??
      (raw.time && raw.time.duration));
    if (!Number.isFinite(start)) start = 0;
    start = Math.max(0, start);
    if (!Number.isFinite(duration) || duration <= 0) duration = 2;

    var speed = speedOf(raw);
    var options = {
      name: String(raw.name || raw.title || raw.label || baseName(mediaHit && mediaHit.entry.name) || 'Layer').slice(0, 60),
      start: start,
      duration: duration,
    };

    if (mediaHit) options.dataUrl = mediaHit.url;
    if (raw.assetId) options.assetId = raw.assetId;

    var colour = colourOf(raw);
    if (kind === 'text') {
      options.text = textOf(raw) || 'Text';
      if (colour) options.color = colour;
      var size = num(raw.fontSize ?? raw.size ?? (raw.style && raw.style.fontSize), NaN);
      if (Number.isFinite(size) && size > 0) options.fontSize = size;
    } else if (kind === 'shape' && colour) {
      options.color = colour;
    }

    // Node Video's own renderer features that have no data equivalent here.
    ['effects', 'filters', 'nodes', 'shaders', 'gradient', 'particles', 'lut', 'mask',
      'blend', 'chroma', 'keyframes', 'curves'].forEach(function (key) {
      var value = raw[key];
      if (value && (Array.isArray(value) ? value.length : true)) report.unmapped[key] = (report.unmapped[key] || 0) + 1;
    });

    var interpolation = interpolationOf(raw);
    if (interpolation) {
      report.interpolation += 1;
      ctx.project_interpolation = ctx.project_interpolation || interpolation;
    }
    if (Math.abs(speed - 1) > 0.001) report.speed += 1;

    return { kind: kind, options: options, speed: speed, interpolation: interpolation };
  }

  /* ------------------------------------------------------------- import ----- */

  function toast(message) {
    if (typeof window.toast === 'function') window.toast(message);
  }

  /**
   * Makes sure there is an open project to import into.
   *
   * `model.reset()` clears the project, so creating one is: reset, then build it. The
   * earlier version checked for a project after resetting, which is why importing from
   * the home screen (no project open) failed on the first thing it touched.
   */
  function ensureProject(project) {
    var model = window.model;
    if (!model) throw new Error('The editor is still starting');
    if (!model.project) {
      model.reset();
      model.project = model.defaultProject(
        (project && project.name) || 'Imported project',
        (project && project.ratio) || '9:16',
        1080,
        (project && project.fps) || 30,
        Math.max(1, (project && project.duration) || 10),
        '#000000'
      );
      model.project.width = (project && project.width) || model.project.width;
      model.project.height = (project && project.height) || model.project.height;
      model.resetEditorCamera();
      model.mode3d = false;
      model.cameraView = true;
    }
    return model;
  }

  function applyImported(_model, project, plan) {
    var model = ensureProject(project);
    var history = window.__omsHistory;
    try {
      var existing = model.project;
      if (project) {
        // Keep the imported dimensions: every layer position depends on them.
        existing.width = project.width || existing.width;
        existing.height = project.height || existing.height;
        if (project.fps) existing.fps = Math.min(120, Math.max(1, project.fps));
        existing.duration = Math.max(1, project.duration || existing.duration);
        existing.name = project.name || existing.name;
        existing.bg = project.bg || existing.bg;
      }
      model.time = 0;
      if (history && history.clear) history.clear();

      plan.layers.forEach(function (row) {
        var layer = model.addLayer(row.kind, row.options);
        if (!layer) return;
        if (Math.abs(row.speed - 1) > 0.001) {
          // The stored length is kept exactly as the package states it. Node Video does
          // not say whether its duration is the timeline length or the source length, and
          // guessing would silently stretch every slowed clip to the wrong length; a
          // speed change that keeps the clip length is the one reading that is never
          // surprising. The clip can be lengthened by dragging its edge afterwards.
          layer.playbackRate = Math.min(4, Math.max(0.1, row.speed));
        }
        if (row.interpolation) layer.omsInterpolation = row.interpolation;
      });

      model.ensureProjectDuration(plan.duration || model.project.duration);
      window.ui.rebuildAll();
      window.ui.authorizeEditorOpen();
      window.ui.showEditor();
      if (history && history.push) history.push();
      try { window.__omsTimeline && window.__omsTimeline.rebuild(); } catch (e) { /* optional */ }
      try { window.__omsRenderer && window.__omsRenderer.resize(); } catch (e) { /* optional */ }
      if (window.persistentStore && window.persistentStore.saveCurrent) {
        window.persistentStore.saveCurrent().catch(function () { /* not fatal */ });
      }
    } catch (error) {
      console.error('Node Video import failed while building the project', error);
      throw error;
    }
  }

  /**
   * Reads a .zip File and returns a promise for the import report.
   *
   * The report is plain data and is also shown in the UI, so a partial import always
   * says what happened instead of failing silently.
   */
  function importFile(file) {
    if (!file || !file.size) return Promise.reject(new Error('That file is empty'));
    var name = String(file.name || 'Node Video project').replace(/\.zip$/i, '');

    return file.arrayBuffer().then(function (buffer) {
      var bytes = new Uint8Array(buffer);
      var entries = indexZip(bytes);
      var jsonEntries = entries.filter(function (e) { return /\.json$/i.test(e.name) && e.size < 32 * 1024 * 1024; });
      var mediaEntries = entries.filter(pickMedia);
      if (!jsonEntries.length) {
        throw new Error('That .zip holds no project description — is it a Node Video export?');
      }

      // Read every JSON member and keep the best-scoring one as the timeline.
      return Promise.all(jsonEntries.slice(0, 40).map(function (entry) {
        return readEntry(bytes, entry).then(function (data) {
          try {
            var text = new TextDecoder('utf-8').decode(data);
            return { entry: entry, doc: JSON.parse(text) };
          } catch (e) {
            return null;
          }
        }, function () { return null; });
      })).then(function (docs) {
        var best = null;
        var bestScore = 0;
        docs.forEach(function (row) {
          if (!row) return;
          var s = score(row.doc);
          if (s > bestScore) { bestScore = s; best = row; }
        });
        if (!best) throw new Error('No readable project description inside that package');

        var report = {
          layers: 0, media: 0, missing: [], speed: 0, interpolation: 0, unmapped: {},
          source: best.entry.name, name: name,
        };
        var ctx = { report: report, media: [], project_interpolation: null };

        // Unpack the media the timeline references, plus anything else it may need.
        return Promise.all(mediaEntries.slice(0, 200).map(function (entry) {
          return readEntry(bytes, entry).then(function (data) {
            var blob = new Blob([data], { type: mimeFor(entry.name) });
            var url = window.mediaAssets && window.mediaAssets.attachBlob
              ? window.mediaAssets.attachBlob('nv_' + entry.name.replace(/[^\w.-]/g, '_'), blob)
              : URL.createObjectURL(blob);
            return { entry: entry, url: url, size: entry.size };
          }, function () { return null; });
        })).then(function (media) {
          ctx.media = media.filter(Boolean);
          report.media = ctx.media.length;

          var rawLayers = findLayerArray(best.doc) || [];
          var plan = { layers: [], duration: 0 };
          rawLayers.forEach(function (raw) {
            if (!raw || typeof raw !== 'object') return;
            var row = convertLayer(raw, ctx);
            if (!row) return;
            plan.layers.push(row);
            plan.duration = Math.max(plan.duration, row.options.start + row.options.duration);
          });
          if (!plan.layers.length) {
            throw new Error('That project has no layers this editor can read');
          }
          report.layers = plan.layers.length;

          // Media in the package that no layer referenced: keep it visible in the report
          // instead of hiding the difference.
          var used = plan.layers.filter(function (r) { return r.options.dataUrl; }).length;
          plan.layers.forEach(function (row, index) {
            var raw = rawLayers[index];
            var declared = raw && (raw.file || raw.src || raw.path || raw.uri || raw.mediaName || raw.filename);
            if (declared && !row.options.dataUrl) report.missing.push(String(declared).slice(0, 80));
          });
          report.usedMedia = used;

          var project = {
            name: name,
            fps: num(best.doc.fps ?? (best.doc.project && best.doc.project.fps) ??
              (best.doc.timeline && best.doc.timeline.fps), 30),
            duration: Math.max(1, num(best.doc.duration ?? (best.doc.project && best.doc.project.duration) ??
              (best.doc.timeline && best.doc.timeline.duration), plan.duration || 10)),
            width: num(best.doc.width ?? (best.doc.project && best.doc.project.width) ??
              (best.doc.canvas && best.doc.canvas.width), 0),
            height: num(best.doc.height ?? (best.doc.project && best.doc.project.height) ??
              (best.doc.canvas && best.doc.canvas.height), 0),
          };
          if (project.width && project.height) {
            project.ratio = project.width >= project.height ? (project.width / project.height >= 1.7 ? '16:9' : '1:1') : '9:16';
          }
          applyImported(window.model, project.width && project.height ? project : null, plan);
          report.project = { width: window.model.project.width, height: window.model.project.height, fps: window.model.project.fps };
          return report;
        });
      });
    });
  }

  /* --------------------------------------------------------------- export --- */

  /**
   * Writes the open project back out in the same layout this reader understands.
   *
   * This is the honest half of interoperability: our own .zip imports into Node Video
   * only as far as Node Video accepts a timeline description, so the export writes a
   * documented, plain JSON layout and names it accordingly rather than pretending to be
   * Node Video's private format.
   */
  function exportProject() {
    var model = window.model;
    if (!model || !model.project) return Promise.reject(new Error('Open a project first'));
    var clean = model.serialize({ includeMedia: false });
    var layers = model.layers.map(function (layer, index) {
      var row = {
        name: layer.name,
        type: layer.type,
        start: layer.start,
        duration: layer.duration,
        speed: layer.playbackRate || 1,
        interpolation: layer.omsInterpolation || 'none',
      };
      if (layer.type === 'text') row.text = layer.text;
      if (['image', 'video', 'audio'].includes(layer.type)) {
        // Names the media by the position it occupies, so the reader can match it back
        // without depending on the asset id that only makes sense inside this install.
        row.file = 'media/' + index + '_' + String(layer.name || layer.type).replace(/[^\w.-]+/g, '_');
      }
      return row;
    });
    var doc = {
      format: 'editorshub-nodevideo-timeline',
      version: 1,
      exportedAt: new Date().toISOString(),
      width: clean.project.width,
      height: clean.project.height,
      fps: clean.project.fps,
      duration: clean.project.duration,
      name: clean.project.name,
      layers: layers,
    };

    // Media goes in alongside the timeline, otherwise a "backup" reopens with holes.
    var budget = 300 * 1024 * 1024;
    var mediaFiles = [];
    var mediaLayers = model.layers.filter(function (layer) {
      return ['image', 'video', 'audio'].includes(layer.type) && layer.dataUrl;
    });
    return mediaLayers.reduce(function (chain, layer) {
      return chain.then(function () {
        var name = layers[model.layers.indexOf(layer)].file;
        var source = layer.dataUrl;
        // A blob: URL has to be fetched; a data: URL is decoded in place. Both are how the
        // editor itself reaches media bytes, so this needs no new storage.
        var read;
        if (source.indexOf('data:') === 0) {
          try { read = Promise.resolve(dataUrlToBytes(source)); }
          catch (e) { read = Promise.resolve(null); }
        } else if (typeof fetch === 'function') {
          read = fetch(source).then(function (response) { return response.arrayBuffer(); })
            .then(function (buffer) { return new Uint8Array(buffer); });
        } else {
          read = Promise.resolve(null);
        }
        return read.then(function (bytes) {
          if (!bytes || !bytes.length) {
            doc.skippedMedia = (doc.skippedMedia || 0) + 1;
            return;
          }
          if (bytes.length > budget) {
            doc.skippedMedia = (doc.skippedMedia || 0) + 1;
            return;
          }
          budget -= bytes.length;
          mediaFiles.push({ name: name, bytes: bytes });
        }).catch(function () {
          doc.skippedMedia = (doc.skippedMedia || 0) + 1;
        });
      });
    }, Promise.resolve()).then(function () {
      var text = JSON.stringify(doc, null, 2);
      var files = [{ name: 'project.json', text: text }].concat(mediaFiles);
      return pack(files).then(function (blob) {
        var safe = String(clean.project.name || 'project').replace(/[^\w\- ]+/g, '').trim().slice(0, 40) || 'project';
        var fileName = safe + '.nodevideo.zip';
        if (window.omsNativeShell && window.omsNativeShell.saveBlobAs) {
          return window.omsNativeShell.saveBlobAs(blob, fileName, 'application/zip');
        }
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        a.click();
        setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
        return true;
      });
    });
  }

  /** Decodes a data: URL into bytes without a network round trip. */
  function dataUrlToBytes(url) {
    var comma = url.indexOf(',');
    var header = url.slice(0, comma);
    var payload = url.slice(comma + 1);
    if (header.indexOf('base64') === -1) {
      return new TextEncoder().encode(decodeURIComponent(payload));
    }
    var binary = atob(payload);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  /* ------------------------------------------------------------- packer ----- */

  /**
   * Writes a store-only .zip (no compression).
   *
   * Storing rather than deflating is deliberate: media is already compressed, and a stored
   * archive needs no Compressor, so the export path cannot fail on a WebView that lacks
   * one. The result opens in Files, in Node Video's archive picker, and reads back through
   * the parse path above.
   */
  function pack(files) {
    var encoder = new TextEncoder();
    var rows = files.map(function (file) {
      var data = file.bytes instanceof Uint8Array ? file.bytes : encoder.encode(String(file.text || ''));
      return { name: file.name, data: data, crc: crc32(data) };
    });
    var localSize = rows.reduce(function (total, row) {
      return total + 30 + encoder.encode(row.name).length + row.data.length;
    }, 0);
    var centralSize = rows.reduce(function (total, row) {
      return total + 46 + encoder.encode(row.name).length;
    }, 0);
    var out = new Uint8Array(localSize + centralSize + 22);
    var view = new DataView(out.buffer);
    var at = 0;
    var offsets = [];

    rows.forEach(function (row) {
      var nameBytes = encoder.encode(row.name);
      offsets.push(at);
      view.setUint32(at, 0x04034b50, true);
      view.setUint16(at + 4, 20, true);
      view.setUint16(at + 6, 0x0800, true);
      view.setUint16(at + 8, 0, true);
      view.setUint16(at + 10, 0, true);
      view.setUint16(at + 12, 0, true);
      view.setUint32(at + 14, row.crc, true);
      view.setUint32(at + 18, row.data.length, true);
      view.setUint32(at + 22, row.data.length, true);
      view.setUint16(at + 26, nameBytes.length, true);
      view.setUint16(at + 28, 0, true);
      out.set(nameBytes, at + 30);
      out.set(row.data, at + 30 + nameBytes.length);
      at += 30 + nameBytes.length + row.data.length;
    });

    var centralStart = at;
    rows.forEach(function (row, index) {
      var nameBytes = encoder.encode(row.name);
      view.setUint32(at, 0x02014b50, true);
      view.setUint16(at + 4, 20, true);
      view.setUint16(at + 6, 20, true);
      view.setUint16(at + 8, 0x0800, true);
      view.setUint16(at + 10, 0, true);
      view.setUint16(at + 12, 0, true);
      view.setUint16(at + 14, 0, true);
      view.setUint32(at + 16, row.crc, true);
      view.setUint32(at + 20, row.data.length, true);
      view.setUint32(at + 24, row.data.length, true);
      view.setUint16(at + 28, nameBytes.length, true);
      view.setUint16(at + 30, 0, true);
      view.setUint16(at + 32, 0, true);
      view.setUint16(at + 34, 0, true);
      view.setUint16(at + 36, 0, true);
      view.setUint32(at + 38, 0, true);
      view.setUint32(at + 42, offsets[index], true);
      out.set(nameBytes, at + 46);
      at += 46 + nameBytes.length;
    });

    view.setUint32(at, 0x06054b50, true);
    view.setUint16(at + 4, 0, true);
    view.setUint16(at + 6, 0, true);
    view.setUint16(at + 8, rows.length, true);
    view.setUint16(at + 10, rows.length, true);
    view.setUint32(at + 12, at - centralStart, true);
    view.setUint32(at + 16, centralStart, true);
    view.setUint16(at + 20, 0, true);
    return Promise.resolve(new Blob([out], { type: 'application/zip' }));
  }

  window.omsNodeVideo = {
    importFile: importFile,
    exportProject: exportProject,
    // Exposed for the self-test and for the Elements screen, which reuses the reader.
    _indexZip: indexZip,
    _readEntry: readEntry,
    _findLayerArray: findLayerArray,
    _convertLayer: convertLayer,
    _pack: pack,
  };
})();
