package com.editorhub.engine.gl

/**
 * GLSL ES 1.00 programs.
 *
 * ES 1.00 is deliberate: it is available on every device from minSdk 26 up, and everything the
 * compositor needs (multiple textures, colour matrices, separable blur, blend-equation blend
 * modes) is expressible. ES 3.0 would add nothing here but a version check.
 */
object Shaders {
    /** Full-screen quad in clip space, with the matching texture coordinate. */
    const val VERTEX = """
attribute vec2 aPos;
varying vec2 vUv;
void main() {
    vUv = aPos * 0.5 + 0.5;
    gl_Position = vec4(aPos, 0.0, 1.0);
}
"""

    /**
     * The base pass: transform, grade, and the two colour operations that must happen before
     * any blur (because blurring an ungraded image and grading it afterwards is not the same
     * picture, and every editor grades first).
     */
    const val LAYER = """
precision mediump float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform vec4 uFrame;      // xy = offset, zw = size, all in composition space
uniform vec2 uAnchor;
uniform vec2 uScale;
uniform float uRotation;  // radians
uniform float uOpacity;
uniform float uBrightness;
uniform float uContrast;
uniform float uSaturation;
uniform float uHue;
uniform float uSourceAspect;

vec3 hueShift(vec3 c, float a) {
    const vec3 k = vec3(0.57735);
    float cosA = cos(a);
    return c * cosA + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - cosA);
}

void main() {
    // Undo the layer's transform: the fragment's position in composition space is mapped back
    // into the layer's own box, which is where its texture lives.
    vec2 p = (vUv - uAnchor - uFrame.xy) / max(uScale, vec2(1e-4));
    float s = sin(-uRotation), c = cos(-uRotation);
    p = vec2(p.x * c - p.y * s, p.x * s + p.y * c);
    vec2 uv = p / uFrame.zw + 0.5;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) discard;

    vec3 col = texture2D(uTex, uv).rgb;

    // Grade, in the order a colourist expects: hue, saturation, contrast, brightness.
    col = hueShift(col, uHue);
    float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
    col = mix(vec3(luma), col, 1.0 + uSaturation);
    col = (col - 0.5) * (1.0 + uContrast) + 0.5;
    col += uBrightness;

    gl_FragColor = vec4(clamp(col, 0.0, 1.0), uOpacity);
}
"""

    /** A solid colour or gradient quad, used by shape layers and text backgrounds. */
    const val SOLID = """
precision mediump float;
varying vec2 vUv;
uniform vec4 uColor;
uniform vec4 uColor2;
uniform float uGradient;
void main() {
    vec4 c = mix(uColor, uColor2, uGradient * vUv.y);
    gl_FragColor = vec4(c.rgb, c.a * uColor.a);
}
"""

    /** Separable gaussian: run twice, once per axis, with [uDir] set accordingly. */
    const val BLUR = """
precision mediump float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uDir;
uniform float uRadius;
void main() {
    float r = uRadius * 0.02;
    vec4 sum = vec4(0.0);
    float weights[5];
    weights[0] = 0.2270270270; weights[1] = 0.1945945946; weights[2] = 0.1216216216;
    weights[3] = 0.0540540541; weights[4] = 0.0162162162;
    sum += texture2D(uTex, vUv) * weights[0];
    for (int i = 1; i < 5; i++) {
        vec2 off = uDir * r * float(i);
        sum += texture2D(uTex, vUv + off) * weights[i];
        sum += texture2D(uTex, vUv - off) * weights[i];
    }
    gl_FragColor = sum;
}
"""

    /** One program that implements every single-pass effect, selected by [uMode]. */
    const val EFFECT = """
precision mediump float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform int uMode;      // 1 sharpen 2 glow 3 vignette 4 pixelate 5 invert 6 grain
uniform float uAmount;  // 7 chroma key 8 posterize 9 halftone 10 rgb split
uniform vec2 uTexel;
uniform float uTime;
uniform vec4 uKey;      // chroma-key colour and tolerance

float rand(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

void main() {
    vec2 uv = vUv;
    vec4 src = texture2D(uTex, uv);
    vec3 col = src.rgb;

    if (uMode == 1) {                       // sharpen: unsharp mask against a 5-tap average
        vec3 blur = (texture2D(uTex, uv + vec2(uTexel.x, 0.0)).rgb
                   + texture2D(uTex, uv - vec2(uTexel.x, 0.0)).rgb
                   + texture2D(uTex, uv + vec2(0.0, uTexel.y)).rgb
                   + texture2D(uTex, uv - vec2(0.0, uTexel.y)).rgb) * 0.25;
        col = col + (col - blur) * uAmount * 3.0;
    } else if (uMode == 2) {                // glow: add a bright-pass bloom
        float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
        col += smoothstep(0.55, 1.0, luma) * uAmount * 0.8;
    } else if (uMode == 3) {                // vignette
        float d = distance(uv, vec2(0.5));
        col *= mix(1.0, smoothstep(0.85, 0.25, d), uAmount);
    } else if (uMode == 4) {                // pixelate
        float cells = mix(400.0, 12.0, uAmount);
        vec2 snapped = floor(uv * cells) / cells + 0.5 / cells;
        col = texture2D(uTex, snapped).rgb;
    } else if (uMode == 5) {                // invert
        col = mix(col, 1.0 - col, uAmount);
    } else if (uMode == 6) {                // grain
        col += (rand(uv * 1024.0 + uTime) - 0.5) * uAmount * 0.35;
    } else if (uMode == 7) {                // chroma key
        float d = distance(src.rgb, uKey.rgb);
        if (d < uKey.a) discard;
    } else if (uMode == 8) {                // posterize
        float steps = mix(32.0, 3.0, uAmount);
        col = floor(col * steps + 0.5) / steps;
    } else if (uMode == 9) {                // halftone
        float ang = 0.7854;
        vec2 r = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * uv;
        float cells = 90.0;
        vec2 cell = fract(r * cells) - 0.5;
        float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
        float dot_ = smoothstep(0.5, 0.0, length(cell) + luma * 0.6);
        col = mix(col, vec3(dot_), uAmount);
    } else if (uMode == 10) {               // rgb split
        float k = uAmount * 0.012;
        col.r = texture2D(uTex, uv + vec2(k, 0.0)).r;
        col.b = texture2D(uTex, uv - vec2(k, 0.0)).b;
    }

    gl_FragColor = vec4(clamp(col, 0.0, 1.0), src.a);
}
"""
}
