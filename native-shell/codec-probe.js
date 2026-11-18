/*
 * EditorsHub — what is this device really encoding with?
 *
 * The editor exports through WebCodecs. On Android that is expected to sit on the platform
 * encoder, but WebCodecs does not have to say whether the encoder it picked is hardware. This
 * probe answers it three ways and reports the answer where it can be read:
 *
 *   1. NativeCodecs.codecInfo()  — the platform's own encoder list, hardware flagged
 *   2. WebCodecs isConfigSupported — whether the browser will take the configuration at all
 *   3. The export preset the editor would use, checked against the hardware ceiling
 *
 * It draws nothing and changes nothing. It reports.
 */
(function () {
  'use strict';

  if (window.__omsCodecProbe) return;
  window.__omsCodecProbe = true;

  var Native = window.EditorsHubNative || window.OpenMotionNative;

  function nativeInfo() {
    try {
      if (Native && typeof Native.codecInfo === 'function') {
        return JSON.parse(Native.codecInfo());
      }
    } catch (e) {
      return { error: String(e && e.message ? e.message : e) };
    }
    return { error: 'no native bridge' };
  }

  function webCodecsSupport(width, height, fps) {
    if (typeof VideoEncoder === 'undefined' || !VideoEncoder.isConfigSupported) {
      return Promise.resolve({ supported: false, reason: 'VideoEncoder unavailable' });
    }
    var config = {
      codec: 'avc1.42001f',
      width: width,
      height: height,
      bitrate: 12000000,
      framerate: fps,
      avc: { format: 'annexb' },
    };
    return VideoEncoder.isConfigSupported(config)
      .then(function (r) { return { supported: !!r.supported, config: config }; })
      .catch(function (e) {
        return { supported: false, reason: String(e && e.message ? e.message : e) };
      });
  }

  /**
   * Runs the probe and returns a plain report.
   *
   * The interesting comparison is [native hardware ceiling] versus [what WebCodecs accepts]: if
   * the hardware encoder advertises 4K but WebCodecs refuses 4K, the export is not using it.
   */
  function run() {
    var native = nativeInfo();
    var width = native.hardwareMaxWidth || 1920;
    var height = native.hardwareMaxHeight || 1080;
    var fps = native.hardwareMaxFps || 30;

    return webCodecsSupport(1080, 1920, 30).then(function (fullHd) {
      return webCodecsSupport(width, height, fps).then(function (max) {
        var report = {
          native: native,
          webcodecs: { fullHd: fullHd, atNativeMax: max },
          verdict: verdict(native, fullHd),
        };
        log(report);
        return report;
      });
    });
  }

  function verdict(native, fullHd) {
    if (native.error) return 'unknown: ' + native.error;
    if (!native.encoders || !native.encoders.length) return 'no H.264 encoder on this device';
    if (!native.hasHardwareH264) return 'software encoder only';
    if (!fullHd.supported) return 'hardware encoder present, but WebCodecs refused 1080p';
    return 'hardware encoder present and WebCodecs accepts 1080p';
  }

  function log(report) {
    try {
      if (Native && Native.log) {
        Native.log('INFO', 'codec probe: ' + report.verdict);
        Native.log('INFO', 'codec detail: ' + JSON.stringify(report.native));
      }
    } catch (e) {}
  }

  /** Shows the report as a toast, for the case where nobody is reading a log. */
  function announce() {
    return run().then(function (report) {
      try {
        if (Native && Native.toast) Native.toast(report.verdict);
      } catch (e) {}
      return report;
    });
  }

  window.omsCodecs = {
    run: run,
    announce: announce,
    native: nativeInfo,
  };
})();
