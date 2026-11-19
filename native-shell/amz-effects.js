/*
 * Extra effects, shader-backed.
 *
 * Every effect here is a real fragment shader that runs through the renderer's existing
 * native effect pipeline. Nothing is added to the catalogue unless it draws: an entry that
 * appears in the browser but renders nothing is worse than no entry, because it looks like
 * a feature and silently does nothing.
 *
 * The contract, from OMSNativeEffects: a body receives `q` (normalised coordinates in the
 * layer's content box) and `fetch(q)` (the incoming pixels), and writes `outColor`. All
 * scalar parameters arrive as `p_<id>` uniforms. Time arrives as `uTime` and the render
 * scale as `uRasterScale`.
 *
 * Registration goes through OMSNativeEffects.register, which adds the id to the renderable
 * sets as part of registering it. That is the same door the built-in effects came through,
 * so these get the GPU path, the export path and the effect browser for free.
 */
(function () {
  'use strict';
  if (window.omsAmzEffects) return;

  function log(m) {
    try {
      var n = window.EditorsHubNative || window.OpenMotionNative;
      if (n && n.log) n.log('INFO', 'amz-effects: ' + m);
    } catch (e) {}
  }
  function notify(m) {
    if (window.omsAmzHub) window.omsAmzHub.notify(m);
    else if (window.toast) window.toast(m);
  }

  /* ------------------------------------------------------------------ parameter helpers */

  function scalar(id, label, def, min, max, scale, group) {
    return { id: id, label: label, type: 'SCALAR', default: def, min: min, max: max, step: 0.01, displayScale: scale == null ? 100 : scale, group: group || '' };
  }
  function bool(id, label, def, group) {
    return { id: id, label: label, type: 'BOOL', default: def, min: 0, max: 1, step: 1, group: group || '' };
  }
  function rgb(prefix, group) {
    return ['r', 'g', 'b'].map(function (c, i) {
      return { id: prefix + c, label: prefix.toUpperCase() + ' ' + ['R', 'G', 'B'][i], type: 'SCALAR', default: i === 0 ? 1 : 0, min: -1, max: 2, step: 0.01, displayScale: 100, group: group || '' };
    });
  }

  /* ----------------------------------------------------------------------- the effects */

  var EFFECTS = [];

  /**
   * @param id     stable id; also the shader's registry key
   * @param name   label in the browser
   * @param cat    category chip
   * @param params parameter list
   * @param body   GLSL body; may be an array of two bodies for a two-pass effect
   * @param extra  extra shared GLSL for this effect only
   */
  function effect(id, name, cat, params, body, extra) {
    EFFECTS.push({ id: id, name: name, category: cat, params: params, body: body, extra: extra || '' });
  }

  /* --- Colour ------------------------------------------------------------------- */

  effect('amz_sepia', 'Sepia', 'Warna', [
    scalar('amount', 'Amount', 0.7, 0, 1, 100),
    scalar('tone', 'Warmth', 0, -1, 1, 100),
  ], `vec4 c=fetch(q);float l=dot(c.rgb,vec3(.299,.587,.114));
vec3 s=vec3(l*1.07+.12,l*.94+.04,l*.74-.02);s+=vec3(p_tone*.12,p_tone*.04,-p_tone*.08);
outColor=vec4(mix(c.rgb,clamp(s,0.,1.),p_amount),c.a);`);

  effect('amz_threshold', 'Threshold', 'Warna', [
    scalar('level', 'Level', 0.5, 0, 1, 100),
    scalar('softness', 'Softness', 0.02, 0, 0.5, 100),
    bool('color', 'Keep Color', 0),
  ], `vec4 c=fetch(q);float l=dot(c.rgb,vec3(.299,.587,.114));
float k=smoothstep(p_level-p_softness,max(.0001,p_level+p_softness),l);
vec3 base=p_color>.5?c.rgb:vec3(1.);
outColor=vec4(base*k,c.a);`);

  effect('amz_posterize', 'Posterize', 'Warna', [
    scalar('steps', 'Steps', 5, 2, 32, 1),
    scalar('amount', 'Amount', 1, 0, 1, 100),
  ], `vec4 c=fetch(q);float n=max(2.,floor(p_steps+.5));
vec3 v=floor(c.rgb*n+.5)/n;outColor=vec4(mix(c.rgb,v,p_amount),c.a);`);

  effect('amz_duotone', 'Duotone', 'Warna', rgb('shadow').concat(rgb('light')).concat([
    scalar('amount', 'Amount', 1, 0, 1, 100),
    scalar('balance', 'Balance', 0.5, 0, 1, 100),
  ]), `vec4 c=fetch(q);float l=dot(c.rgb,vec3(.299,.587,.114));
l=clamp(l*p_balance*2.,0.,1.);
vec3 s=vec3(p_shadowr,p_shadowg,p_shadowb),hi=vec3(p_lightr,p_lightg,p_lightb);
outColor=vec4(mix(c.rgb,mix(s,hi,l),p_amount),c.a);`);

  effect('amz_invert', 'Invert', 'Warna', [
    scalar('amount', 'Amount', 1, 0, 1, 100),
    bool('lumaOnly', 'Luma Only', 0),
  ], `vec4 c=fetch(q);float l=dot(c.rgb,vec3(.299,.587,.114));
vec3 v=p_lumaOnly>.5?vec3(1.-l):1.-c.rgb;outColor=vec4(mix(c.rgb,v,p_amount),c.a);`);

  effect('amz_color_grade', 'Color Grade', 'Warna', [
    scalar('lift', 'Lift', 0, -0.5, 0.5, 100),
    scalar('gamma', 'Gamma', 1, 0.2, 3, 100),
    scalar('gain', 'Gain', 1, 0, 2, 100),
    scalar('temperature', 'Temperature', 0, -1, 1, 100),
    scalar('tint', 'Tint', 0, -1, 1, 100),
  ], `vec4 c=fetch(q);vec3 v=c.rgb;
v=v*(1.+p_temperature*vec3(.16,.02,-.12))+p_tint*vec3(.04,-.06,.04);
v=pow(max(vec3(0.),v),vec3(1./max(.05,p_gamma)));
v=v*p_gain+p_lift;outColor=vec4(clamp(v,0.,1.),c.a);`);

  /* --- Detail ------------------------------------------------------------------- */

  effect('amz_sharpen', 'Sharpen', 'Detail', [
    scalar('amount', 'Amount', 0.6, 0, 2, 100),
    scalar('radius', 'Radius', 1.2, 0.2, 8, 100),
    bool('lumaOnly', 'Luma Only', 1),
  ], `vec4 c=fetch(q);vec2 px=vec2(p_radius)/max(uContentSize,vec2(1.));
vec4 blurred=(fetch(q+vec2(px.x,0.))+fetch(q-vec2(px.x,0.))+fetch(q+vec2(0.,px.y))+fetch(q-vec2(0.,px.y)))*.25;
vec3 d=c.rgb-blurred.rgb;
vec3 v=p_lumaOnly>.5?c.rgb+vec3(dot(d,vec3(.299,.587,.114)))*p_amount*2.:c.rgb+d*p_amount*2.;
outColor=vec4(clamp(v,0.,1.),c.a);`);

  effect('amz_clarity', 'Clarity', 'Detail', [
    scalar('amount', 'Amount', 0.4, 0, 2, 100),
    scalar('radius', 'Radius', 6, 1, 40, 100),
  ], `vec4 c=fetch(q);vec2 px=vec2(p_radius)/max(uContentSize,vec2(1.));
vec4 b=(fetch(q+vec2(px.x,0.))+fetch(q-vec2(px.x,0.))+fetch(q+vec2(0.,px.y))+fetch(q-vec2(0.,px.y)))*.25;
vec3 mid=c.rgb+(c.rgb-b.rgb)*p_amount*1.6;outColor=vec4(clamp(mid,0.,1.),c.a);`);

  effect('amz_film_grain', 'Film Grain', 'Detail', [
    scalar('amount', 'Amount', 0.18, 0, 1, 100),
    scalar('size', 'Grain Size', 1.5, 0.5, 6, 100),
    bool('animate', 'Animate', 1),
    bool('mono', 'Monochrome', 1),
  ], `vec4 c=fetch(q);vec2 p=floor(metric(q)*max(uContentSize,vec2(1.))/max(.1,p_size));
float t=p_animate>.5?floor(uTime*24.):0.;
float n=hash(p+vec2(t*13.7,t*7.1))- .5;
vec3 g=p_mono>.5?vec3(n):vec3(hash(p+t*3.1)-.5,hash(p+t*5.3+7.)-.5,hash(p+t*9.7+3.)-.5);
outColor=vec4(clamp(c.rgb+g*p_amount,0.,1.),c.a);`);

  effect('amz_vignette_soft', 'Soft Vignette', 'Detail', [
    scalar('amount', 'Amount', 0.5, 0, 1, 100),
    scalar('radius', 'Radius', 0.75, 0.1, 1.5, 100),
    scalar('softness', 'Softness', 0.6, 0.02, 1.5, 100),
  ], `vec4 c=fetch(q);vec2 d=(q-.5)*vec2(uContentSize.x/max(1.,uContentSize.y),1.);
float r=length(d)/max(.0001,p_radius);
float v=1.-smoothstep(p_radius*1.35-p_softness,max(.0001,p_radius*1.35),r)*p_amount;
outColor=vec4(c.rgb*clamp(v,0.,1.),c.a);`);

  /* --- Blur & focus --------------------------------------------------------------- */

  effect('amz_tilt_shift', 'Tilt Shift', 'Blur', [
    scalar('focus', 'Focus Band', 0.5, 0, 1, 100),
    scalar('width', 'Band Width', 0.2, 0.01, 1, 100),
    scalar('amount', 'Blur Amount', 0.5, 0, 1, 100),
    scalar('angle', 'Angle', 0, 0, 360, 1),
  ], `vec4 c=fetch(q);float a=p_angle*PI/180.;vec2 n=vec2(-sin(a),cos(a));
float d=abs(dot(metric(q-.5-vec2(0.,(p_focus-.5)*2.)),n))/max(.0001,length(metric(vec2(1.))*.5));
float band=smoothstep(p_width*.5,max(.0001,p_width*.5+p_width),d);
vec4 sum=vec4(0.);float count=0.;float r=p_amount*8.;
for(int i=0;i<24;i++){float t=float(i)/23.;float ang=t*6.2831853;vec2 o=unmetric(vec2(cos(ang),sin(ang))*r*band/max(uContentSize,vec2(1.)));
sum+=fetch(q+o);count+=1.;}
outColor=vec4((sum/count).rgb,c.a);`);

  effect('amz_radial_blur_zoom', 'Radial Zoom', 'Blur', [
    scalar('amount', 'Amount', 0.3, 0, 1, 100),
    scalar('centerX', 'Center X', 0.5, 0, 1, 100),
    scalar('centerY', 'Center Y', 0.5, 0, 1, 100),
  ], `vec4 c=fetch(q);vec2 center=vec2(p_centerX,p_centerY);
vec4 sum=vec4(0.);float count=0.;
for(int i=0;i<20;i++){float t=float(i)/19.;float s=1.-t*p_amount*.28;
sum+=fetch(center+(q-center)*s);count+=1.;}
outColor=vec4((sum/count).rgb,c.a);`);

  effect('amz_glow_soft', 'Soft Glow', 'Blur', [
    scalar('amount', 'Amount', 0.5, 0, 2, 100),
    scalar('radius', 'Radius', 0.035, 0.002, 0.2, 100),
    scalar('threshold', 'Threshold', 0.55, 0, 1, 100),
  ], `vec4 c=fetch(q);vec4 sum=vec4(0.);float count=0.;
for(int i=0;i<20;i++){float t=float(i)/19.;float ang=t*6.2831853;
vec2 o=unmetric(vec2(cos(ang),sin(ang))*p_radius*metric(vec2(1.)));
vec4 s=fetch(q+o);float l=dot(s.rgb,vec3(.299,.587,.114));
sum+=s*step(p_threshold,l);count+=1.;}
vec3 g=(sum/count).rgb;outColor=vec4(clamp(c.rgb+g*p_amount,0.,1.),c.a);`);

  /* --- Distortion ---------------------------------------------------------------- */

  effect('amz_pinch', 'Pinch / Punch', 'Distorsi', [
    scalar('centerX', 'Center X', 0.5, 0, 1, 100),
    scalar('centerY', 'Center Y', 0.5, 0, 1, 100),
    scalar('amount', 'Amount', 0.4, -1, 1, 100),
    scalar('radius', 'Radius', 0.4, 0.01, 1.5, 100),
  ], `vec4 c=fetch(q);vec2 center=vec2(p_centerX,p_centerY);
vec2 d=metric(q-center);float r=length(d)/max(.0001,p_radius);
float k=1.+p_amount*pow(max(0.,1.-min(1.,r)),2.)*1.5;
outColor=fetch(center+unmetric(d/max(.0001,k)));`);

  effect('amz_twirl', 'Twirl', 'Distorsi', [
    scalar('centerX', 'Center X', 0.5, 0, 1, 100),
    scalar('centerY', 'Center Y', 0.5, 0, 1, 100),
    scalar('angle', 'Angle', 120, -720, 720, 1),
    scalar('radius', 'Radius', 0.45, 0.01, 1.5, 100),
  ], `vec4 c=fetch(q);vec2 center=vec2(p_centerX,p_centerY);
vec2 d=metric(q-center);float r=length(d);float falloff=max(0.,1.-min(1.,r/max(.0001,p_radius)));
float a=-p_angle*PI/180.*falloff*falloff;
outColor=fetch(center+unmetric(rotation(a)*d));`);

  effect('amz_ripple', 'Ripple', 'Distorsi', [
    scalar('centerX', 'Center X', 0.5, 0, 1, 100),
    scalar('centerY', 'Center Y', 0.5, 0, 1, 100),
    scalar('amplitude', 'Amplitude', 0.02, 0, 0.15, 100),
    scalar('frequency', 'Frequency', 12, 1, 60, 1),
    scalar('speed', 'Speed', 1, -4, 4, 100),
  ], `vec4 c=fetch(q);vec2 center=vec2(p_centerX,p_centerY);
vec2 d=q-center;float r=length(metric(d));
float wave=sin(r*p_frequency*6.2831853-uTime*p_speed*6.2831853)*p_amplitude;
outColor=fetch(q+normalize(d+vec2(.00001))*(wave/max(vec2(1.),uContentSize)));`);

  effect('amz_kaleidoscope', 'Kaleidoscope', 'Distorsi', [
    scalar('segments', 'Segments', 6, 2, 24, 1),
    scalar('angle', 'Angle', 0, 0, 360, 1),
    scalar('centerX', 'Center X', 0.5, 0, 1, 100),
    scalar('centerY', 'Center Y', 0.5, 0, 1, 100),
  ], `vec4 c=fetch(q);vec2 center=vec2(p_centerX,p_centerY);
vec2 d=metric(q-center);float a=atan(d.y,d.x)+p_angle*PI/180.;
float n=max(2.,floor(p_segments+.5));float seg=6.2831853/n;
a=abs(mod(a,seg)-seg*.5);
float r=length(d);outColor=fetch(center+unmetric(vec2(cos(a),sin(a))*r));`);

  effect('amz_mirror', 'Mirror', 'Distorsi', [
    scalar('axis', 'Axis', 0, 0, 1, 1),
    scalar('position', 'Position', 0.5, 0, 1, 100),
    bool('flip', 'Flip Side', 0),
  ], `vec4 c=fetch(q);vec2 v=q;
if(p_axis<.5){v.x=p_position-abs(q.x-p_position);if(p_flip>.5)v.x=1.-v.x;}
else{v.y=p_position-abs(q.y-p_position);if(p_flip>.5)v.y=1.-v.y;}
outColor=fetch(v);`);

  /* --- Stylise -------------------------------------------------------------------- */

  effect('amz_edge_detect', 'Edge Detect', 'Stilisasi', [
    scalar('amount', 'Amount', 1, 0, 2, 100),
    bool('invert', 'Invert', 0),
    bool('overlay', 'Overlay on Image', 0),
  ], `vec4 c=fetch(q);vec2 px=1.5/max(uContentSize,vec2(1.));
float tl=dot(fetch(q+vec2(-px.x,px.y)).rgb,vec3(.299,.587,.114));
float tc=dot(fetch(q+vec2(0.,px.y)).rgb,vec3(.299,.587,.114));
float tr=dot(fetch(q+vec2(px.x,px.y)).rgb,vec3(.299,.587,.114));
float ml=dot(fetch(q+vec2(-px.x,0.)).rgb,vec3(.299,.587,.114));
float mr=dot(fetch(q+vec2(px.x,0.)).rgb,vec3(.299,.587,.114));
float bl=dot(fetch(q+vec2(-px.x,-px.y)).rgb,vec3(.299,.587,.114));
float bc=dot(fetch(q+vec2(0.,-px.y)).rgb,vec3(.299,.587,.114));
float br=dot(fetch(q+vec2(px.x,-px.y)).rgb,vec3(.299,.587,.114));
float gx=(-tl+tr-2.*ml+2.*mr-bl+br),gy=(tl+2.*tc+tr-bl-2.*bc-br);
float e=clamp(length(vec2(gx,gy))*p_amount,0.,1.);
if(p_invert>.5)e=1.-e;
vec3 v=p_overlay>.5?mix(c.rgb,vec3(e),.7):vec3(e);
outColor=vec4(v,c.a);`);

  effect('amz_halftone', 'Halftone', 'Stilisasi', [
    scalar('size', 'Dot Size', 5, 1.5, 24, 1),
    scalar('angle', 'Screen Angle', 30, 0, 90, 1),
    scalar('amount', 'Amount', 1, 0, 1, 100),
  ], `vec4 c=fetch(q);float l=dot(c.rgb,vec3(.299,.587,.114));
vec2 p=metric(q)*max(uContentSize,vec2(1.))/max(.5,p_size);
float a=p_angle*PI/180.;vec2 rp=rotation(a)*p;
vec2 cell=fract(rp)-.5;float d=length(cell);
float radius=.5*sqrt(clamp(1.-l,0.,1.));
float k=smoothstep(radius,radius+.08,d);
outColor=vec4(mix(c.rgb,vec3(k),p_amount),c.a);`);

  effect('amz_pixelate', 'Pixelate', 'Stilisasi', [
    scalar('size', 'Block Size', 12, 2, 120, 1),
    scalar('amount', 'Amount', 1, 0, 1, 100),
  ], `vec4 c=fetch(q);vec2 px=max(vec2(2.),vec2(floor(p_size+.5)));
vec2 snapped=floor(q*max(uContentSize,vec2(1.))/px)*px/max(uContentSize,vec2(1.))+(px*.5/max(uContentSize,vec2(1.)));
vec4 p=fetch(snapped);outColor=vec4(mix(c.rgb,p.rgb,p_amount),c.a);`);

  effect('amz_scanlines', 'Scanlines', 'Stilisasi', [
    scalar('density', 'Density', 240, 40, 1200, 1),
    scalar('amount', 'Amount', 0.35, 0, 1, 100),
    scalar('speed', 'Roll Speed', 0, -4, 4, 100),
  ], `vec4 c=fetch(q);float y=q.y*max(uContentSize.y,1.);
float line=sin((y*p_density/max(1.,uContentSize.y)-uTime*p_speed)*6.2831853);
float m=1.-(line*.5+.5)*p_amount;
outColor=vec4(c.rgb*clamp(m,0.,1.),c.a);`);

  effect('amz_old_film', 'Old Film', 'Stilisasi', [
    scalar('amount', 'Amount', 0.6, 0, 1, 100),
    scalar('flicker', 'Flicker', 0.15, 0, 1, 100),
    scalar('scratches', 'Scratches', 0.3, 0, 1, 100),
    scalar('jitter', 'Jitter', 0.4, 0, 2, 100),
  ], `vec4 c=fetch(q);float t=floor(uTime*18.);
vec2 jitter=vec2(hash(vec2(t,1.1))-.5,hash(vec2(t,7.3))-.5)*p_jitter/uContentSize;
vec4 s=fetch(q+jitter);
vec3 v=s.rgb*mix(vec3(1.),vec3(1.08,.98,.86),p_amount);
float l=dot(v,vec3(.299,.587,.114));
v=vec3(l*(1.+.9*p_amount*.4))+ (v-l)*mix(1.,.6,p_amount);
float flick=1.+(hash(vec2(t,3.7))-.5)*p_flicker;
v*=flick;
float scratch=step(.9995-p_scratches*.02,hash(vec2(floor(q.x*160.),t)));
v+=scratch*(1.-p_amount*.4);
float grain=(hash(floor(metric(q)*max(uContentSize,vec2(1.))*1.2)+t)-.5)*.06*p_amount;
outColor=vec4(clamp(v+grain,0.,1.),s.a);`);

  effect('amz_vhs', 'VHS', 'Stilisasi', [
    scalar('amount', 'Amount', 0.7, 0, 1, 100),
    scalar('wobble', 'Wobble', 0.4, 0, 2, 100),
    scalar('chroma', 'Chroma Shift', 0.5, 0, 2, 100),
  ], `vec4 c=fetch(q);float t=uTime;
float wob=sin(q.y*30.+t*3.1)*.0015*p_wobble+sin(q.y*7.3-t*1.7)*.003*p_wobble;
vec2 v=q+vec2(wob,0.);
float shift=.0025*p_chroma;
vec4 r=fetch(v+vec2(shift,0.)),g=fetch(v),b=fetch(v-vec2(shift,0.));
vec3 col=vec3(r.r,g.g,b.b);
float band=step(.5,hash(vec2(floor(q.y*140.-t*30.),t)));
col+=band*.05*p_amount;
float l=dot(col,vec3(.299,.587,.114));col=mix(col,vec3(l)*vec3(1.02,.99,.95),p_amount*.4);
outColor=vec4(clamp(col,0.,1.),c.a);`);

  /* ---------------------------------------------------------------- registration */

  var registered = [];
  var failed = [];

  var installed = false;

  /*
   * The core is a single IIFE, so OMS_EFFECT_CATALOG and OMS_EFFECT_BY_ID are private locals -
   * window.OMS_EFFECT_CATALOG is always undefined. That check is what made the device report
   * "omsNativeEffects or OMS_EFFECT_CATALOG missing" while omsNativeEffects was in fact present.
   *
   * The parts that matter are reachable: omsNativeEffects.register() puts a shader in the
   * renderer, and omsNativeEffects.supported tells us what the GPU accepted. So registration
   * is driven by that, and the visible catalogue is discovered from the panel's spec lookup.
   */
  function catalogue() {
    /* Reach the live map through anything the core exposes. omsEffectsPanel resolves an id to
       a spec through omsEffectSpec, which closes over the real map. */
    try {
      var panel = window.omsEffectsPanel;
      if (panel && typeof panel.read === 'function') return panel;
    } catch (e) {}
    return null;
  }

  function specKnown(id) {
    try {
      var sup = window.omsNativeEffects && window.omsNativeEffects.supported;
      if (sup && typeof sup.has === 'function' && sup.has(id)) return true;
    } catch (e) {}
    return false;
  }

  function install() {
    if (installed) return true;
    var native = window.omsNativeEffects;
    if (!native || typeof native.register !== 'function') return false;

    EFFECTS.forEach(function (spec) {
      if (specKnown(spec.id)) { registered.push(spec.id); return; }
      try {
        var frozen = Object.freeze({
          id: spec.id,
          name: spec.name,
          category: spec.category,
          renderKind: 'SHADER',
          description: 'Efek shader tambahan untuk EditorsHub.',
          params: spec.params,
        });
        native.register(spec.id, spec.body, spec.extra);
        /* Best effort: if the private map ever becomes reachable, keep it consistent. This is
           guarded because it is normally not reachable and must not decide success. */
        try {
          if (window.OMS_EFFECT_BY_ID && typeof window.OMS_EFFECT_BY_ID.set === 'function') {
            window.OMS_EFFECT_BY_ID.set(spec.id, frozen);
          }
          if (window.OMS_EFFECT_CATALOG) {
            window.OMS_EFFECT_CATALOG = Object.freeze([].concat(window.OMS_EFFECT_CATALOG, [frozen]));
          }
        } catch (e) {}
        registered.push(spec.id);
      } catch (e) {
        failed.push(spec.id + ': ' + e.message);
        log('failed to register ' + spec.id + ': ' + e.message);
      }
    });

    installed = registered.length > 0;
    try {
      if (window.omsAmzBridge && window.omsAmzBridge.report) {
        window.omsAmzBridge.report('effects', installed, registered.length + ' registered' + (failed.length ? ', ' + failed.length + ' failed' : ''));
      }
    } catch (e) {}
    if (registered.length) {
      log(registered.length + ' effects registered' + (failed.length ? ', ' + failed.length + ' failed' : ''));
      try { if (window.ui && window.ui.rebuildAll) window.ui.rebuildAll(); } catch (e) {}
    }
    return installed;
  }

  /**
   * Adds every effect to a layer's stack. Used by the sheet so an effect can be applied
   * without hunting for it in the browser.
   */
  function applyTo(layer, id) {
    if (!layer) return notify('Select a layer first');
    if (!window.omsEffectInstance) return notify('Effects are not ready yet');
    try {
      if (window.history && window.history.push) window.history.push();
      layer.effectStack = layer.effectStack || [];
      var inst = window.omsEffectInstance(id, {});
      if (!inst) return notify('That effect is not available');
      layer.effectStack.push(inst);
      if (window.omsAmzBridge) window.omsAmzBridge.refresh();
      if (window.ui && window.ui.rebuildAll) window.ui.rebuildAll();
      notify('Added ' + (labelOf(id) || id));
      return inst;
    } catch (e) {
      notify('Could not add that effect: ' + e.message);
    }
  }

  function labelOf(id) {
    for (var i = 0; i < EFFECTS.length; i++) if (EFFECTS[i].id === id) return EFFECTS[i].name;
    return null;
  }

  var listeners = [];
  function onChange(fn) { if (typeof fn === 'function') listeners.push(fn); }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { install(); });
  } else {
    install();
  }
  var tries = 0;
  var timer = setInterval(function () {
    tries++;
    if (install()) { clearInterval(timer); if (window.omsAmzBridge) window.omsAmzBridge.report('effects', true); }
    else if (tries > 80) { clearInterval(timer); if (window.omsAmzBridge) window.omsAmzBridge.gaveUp('effects', 'omsNativeEffects or OMS_EFFECT_CATALOG missing'); }
  }, 500);

  window.omsAmzEffects = {
    EFFECTS: EFFECTS,
    install: install,
    applyTo: applyTo,
    labelOf: labelOf,
    registered: registered,
    failed: failed,
    onChange: onChange,
  };
})();
