/* BETWEEN SIGNALS · the world. Miles's room: dark stone, oxidized bronze, verdigris, dark water, one open door.
   Her voice is light, his voice is a line, and they only meet on "and it's opening in two".
   Everything here is a pure function of song time t, so the same code renders the video frame by frame (?render)
   and runs live in the headset, where t is the playing song's clock. app.js drives the live version. */
(function () {
'use strict';
const BS = window.BS = window.BS || {};
const QS = BS.QS = new URLSearchParams(location.search);
const RENDER = BS.RENDER = QS.has('render');
const UA = navigator.userAgent || '';
const isHeadset = BS.isHeadset = /OculusBrowser|Quest|Pico|Wolvic/i.test(UA) || QS.has('quest');
const VER = window.BS_VER || '1';
BS.asset = p => 'assets/' + p + '?v=' + VER;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const sm = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const up = (t, a, d) => sm((t - a) / d);                 // 0 -> 1 starting at a over d seconds
const env = (t, a, b, fi, fo) => up(t, a, fi) * (1 - up(t, b - fo, fo));
BS.util = { clamp, sm, lerp, up, env };

// ------------------------------------------------------------ song timing (seconds into the master; from the Whisper word timestamps)
const S = BS.S = {
  END: 268.78, sing1: 3.24, sp1: 26.80, v1: 42.18, slow: 55.56, sp2: 59.72, hold: 70.46, ch1: 73.78, wide1: 84.70,
  inst: 96.0, instLast: 113.7, sp3: 116.36, cutSound: 125.42, cutImage: 126.94, cutQ: 127.86, back: 130.16, turn: 134.90,
  map: 135.56, sp4: 150.32, ch2: 155.92, wide2: 167.12, bridge: 178.4, place: 182.52, sp5: 189.90, short: 193.62, reach: 202.08,
  fch: 205.0, listen: 209.94, take: 216.44, opening: 224.96, two: 229.08, outro: 231.6, next: 242.58, laugh: 248.4, chord: 262.0
};
const BPM = 94.6;

// ------------------------------------------------------------ audio features (tools/features.py), 24 per second
const FEAT = BS.feat = { n: 0, A: null, stride: 40 };
BS.loadFeat = () => fetch(BS.asset('feat.bin')).then(r => r.arrayBuffer()).then(b => { FEAT.A = new Uint8Array(b); FEAT.n = Math.floor(FEAT.A.length / 40); });
function fv(t, k) {
  if (!FEAT.A || t < 0) return 0;
  const f = clamp(t * 24 - 0.5, 0, FEAT.n - 1.001), i = Math.floor(f), a = f - i;
  return (FEAT.A[i * 40 + k] * (1 - a) + FEAT.A[(i + 1) * 40 + k] * a) / 255;
}
function fAvg(t, k, w) { let s = 0; for (let j = 0; j < 5; j++) s += fv(t - w * j / 4, k); return s / 5; }
BS.fv = fv;

// ------------------------------------------------------------ renderer, scene, camera
const W = RENDER ? +(QS.get('w') || 1920) : innerWidth, H = RENDER ? +(QS.get('h') || 1080) : innerHeight;
const renderer = new THREE.WebGLRenderer({ antialias: !isHeadset, powerPreference: 'high-performance', preserveDrawingBuffer: false });
renderer.setPixelRatio(RENDER ? 1 : Math.min(window.devicePixelRatio || 1, isHeadset ? 1 : 1.5));
renderer.setSize(W, H);
renderer.outputEncoding = THREE.sRGBEncoding;
if (!RENDER) {
  renderer.xr.enabled = true; renderer.xr.setReferenceSpaceType('local-floor');
  if (isHeadset) { window.__xrBaseLayer = true; window.__xrAA = false; renderer.xr.setFramebufferScaleFactor(0.8); }
  renderer.xr.setFoveation(1);
}
document.getElementById('stage').appendChild(renderer.domElement);
const scene = new THREE.Scene(); scene.background = new THREE.Color(0, 0, 0);
const camera = new THREE.PerspectiveCamera(RENDER ? 62 : 72, W / H, 0.05, 300);
const rig = new THREE.Group(); rig.add(camera); scene.add(rig);
BS.renderer = renderer; BS.scene = scene; BS.camera = camera; BS.rig = rig;
if (!RENDER) addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

// ------------------------------------------------------------ shared uniforms
const U = BS.U = {
  uT: { value: -10 }, uTime: { value: 0 }, uRms: { value: 0 }, uSub: { value: 0 }, uHi: { value: 0 }, uHer: { value: 0 }, uHis: { value: 0 },
  uTrip: { value: 0 }, uReveal: { value: 0 }, uDark: { value: 0 }, uSplit: { value: 0 }, uPatina: { value: 0 }, uDoorGlow: { value: 0.5 },
  uAmb: { value: 1 }, uFogD: { value: 0.06 }, uFogC: { value: new THREE.Color(0.03, 0.05, 0.055) },
  uBlob: { value: [new THREE.Vector4(0, 0, 0, 0), new THREE.Vector4(0, 0, 0, 0), new THREE.Vector4(0, 0, 0, 0)] },
  uLineHead: { value: new THREE.Vector4(0, -50, 0, 0) }, uDoorW: { value: 0.2 }, uImg: { value: null },
  uFeat: { value: null }, uFeatN: { value: 1 }, uFeatRows: { value: 1 }, uPlayer: { value: new THREE.Vector3() }, uWalk: { value: 0 },
  uSig: { value: 0 },  // live only: the living room (gold music symbols on dark teal). Always 0 in render mode, so the video is unchanged
  // v3 (live only, all 0/null in render mode): weathered concrete, the constellation ceiling (video) and the light it sheds
  uCon: { value: 0 }, uConT: { value: null }, uVid: { value: null }, uCeil: { value: 0 }
};
const GL = `
float h21(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(h21(i),h21(i+vec2(1,0)),f.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x), f.y); }
float fbm3(vec2 p){ float v=0.0, a=0.5; for(int i=0;i<3;i++){ v+=a*noise(p); p=p*2.03+vec2(1.7,9.2); a*=0.5; } return v/0.875; }
vec4 featAt(float t){ float f = clamp(t*24.0, 0.0, uFeatN-1.0); float y = floor(f/1024.0); float x = f - y*1024.0;
  return texture2D(uFeat, vec2((x+0.5)/1024.0, (y+0.5)/uFeatRows)) * step(0.0, t); }
const vec3 WARM = vec3(1.0, 0.62, 0.30);
const vec3 WARM2 = vec3(1.0, 0.74, 0.46);
const vec3 BRONZE = vec3(0.86, 0.60, 0.30);
const vec3 VERD = vec3(0.26, 0.62, 0.52);
const vec3 TEAL = vec3(0.05, 0.22, 0.24);
const vec3 GOLDG = vec3(1.0, 0.74, 0.32);
const vec3 DTEAL = vec3(0.010, 0.085, 0.090);
// v3: the constellation ceiling, a 56 x 31.5 m video plane 11 m up (top of the picture over the entrance, like the approved preview)
const float CEIL_Y = 11.0;
const vec4 CEILR = vec4(0.0, -12.25, 28.0, 15.75);
vec3 ceilAt(vec2 xz){
  vec2 u = vec2((xz.x - CEILR.x) / (2.0*CEILR.z) + 0.5, (xz.y - CEILR.y) / (2.0*CEILR.w) + 0.5);
  if (u.x < 0.0 || u.x > 1.0 || u.y < 0.0 || u.y > 1.0) return vec3(0.0);
  vec3 c = texture2D(uVid, u).rgb;
  c = clamp((c - 0.075) / 0.925, 0.0, 1.0);
  float l = max(c.r, max(c.g, c.b));
  float gk = clamp(l * 2.2, 0.0, 1.0);
  vec3 ramp = vec3(0.05, 0.36, 0.38) * 1.6 * (1.0 - gk) + vec3(1.0, 0.80, 0.42) * gk;   // teal to gold, exactly the preview's grade
  vec3 d = min(ramp * pow(l, 0.9) * 2.6, vec3(1.0));          // in display terms...
  vec3 x = min(pow(d, vec3(2.2)), vec3(0.95));
  float vig = smoothstep(0.0, 0.2, min(u.x, 1.0 - u.x)) * smoothstep(0.0, 0.14, min(u.y, 1.0 - u.y));
  return -log(1.0 - x) * (vig / 1.2);                         // ...undone through this world's tone curve so it lands the same
}
// light falling on a surface: her blooms (warm), the doorway's glow, the head of his line (bronze), a little cold ambient
vec3 lightAt(vec3 wp, vec3 n){
  vec3 c = vec3(0.004, 0.009, 0.010) * uAmb;
  vec3 dl = vec3(0.0, 2.6, -21.6) - wp; float dd = length(dl);
  c += WARM * uDoorGlow * (0.25 + 0.75*max(dot(n, dl/dd), 0.0)) * 1.3 / (1.0 + dd*dd*0.12);
  for (int i=0;i<3;i++){ vec3 bl = uBlob[i].xyz - wp; float d2 = dot(bl,bl); float d = sqrt(d2);
    c += WARM2 * uBlob[i].w * (0.3 + 0.7*max(dot(n, bl/d), 0.0)) * 0.7 / (1.0 + d2*0.7); }
  vec3 ll = uLineHead.xyz - wp; c += BRONZE * uLineHead.w / (1.0 + dot(ll,ll)*2.0);
  c += vec3(0.012, 0.040, 0.042) * uCeil * (0.7 * smoothstep(0.5, 7.2, wp.y) + 0.3 * max(n.y, 0.0));   // v3: soft light from the constellation overhead
  return c;
}
float fogF(float dist){ return 1.0 - exp(-uFogD*uFogD*dist*dist); }
`;
const VH = `uniform float uT, uTime, uRms, uSub, uHi, uHer, uHis, uTrip, uReveal, uDark, uSplit, uPatina, uDoorGlow, uAmb, uFogD, uDoorW, uFeatN, uFeatRows, uWalk, uSig;
uniform vec3 uFogC, uPlayer; uniform vec4 uBlob[3]; uniform vec4 uLineHead; uniform sampler2D uImg; uniform sampler2D uFeat;
uniform float uCon, uCeil; uniform sampler2D uConT, uVid;
varying vec3 vWp; varying vec3 vN; varying vec2 vUv; varying float vDist;
`;
function mat(o) {
  const uniforms = Object.assign({}, U, o.uniforms || {});
  const vs = VH + GL + (o.vpars || '') + `
void main(){
  vec3 p = position; vec3 nn = normal; vUv = uv;
  vec4 wp = modelMatrix * vec4(p, 1.0); vN = normalize(mat3(modelMatrix) * nn);
  ${o.disp || ''}
  vWp = wp.xyz; vec4 mv = viewMatrix * wp; vDist = length(mv.xyz); gl_Position = projectionMatrix * mv;
}`;
  const fs = VH + GL + (o.fpars || '') + o.frag + `
void main(){
  float alpha = 1.0;
  vec3 col = shade(vWp, normalize(vN), vUv, alpha);
  ${o.noFog ? '' : 'col = mix(col, uFogC * uFogC * (0.35 + 0.65 * uAmb), clamp(fogF(vDist), 0.0, 1.0));'}
  col = max(col, 0.0); col = col * col / (col + 0.004);
  col = pow(1.0 - exp(-col * 1.2), vec3(0.4545));
  col = max(mix(vec3(dot(col, vec3(0.299, 0.587, 0.114))), col, 1.22), 0.0);
  gl_FragColor = vec4(col, alpha);
}`;
  return new THREE.ShaderMaterial({ uniforms, vertexShader: vs, fragmentShader: fs, side: o.side || THREE.FrontSide,
    transparent: !!o.transparent, depthWrite: o.depthWrite !== undefined ? o.depthWrite : !o.transparent, blending: o.blending || THREE.NormalBlending });
}
BS.mat = mat;

// ------------------------------------------------------------ materials
// The psychedelic guitar break: the stone breathes along its normals, slow, never a flash
const BREATHE = `
  float br = sin(wp.y*1.1 + uTime*1.6 + wp.z*0.55) * 0.5 + sin(wp.z*0.8 - uTime*1.1 + wp.x*0.4) * 0.5;
  wp.xyz += vN * br * uTrip * (0.18 + 0.32*uSub);
  wp.xyz += vN * sin(wp.y*0.7 + wp.z*0.35 - uTime*0.55) * uSig * (0.02 + 0.06*uRms);`;
const SYMS = `
// ---- live mode: the living room. Gold glowing music symbols drift, pulse and morph across dark-teal stone (after the Ancient Signal room)
vec2 rot2(vec2 p, float a){ float c = cos(a), s = sin(a); return vec2(c*p.x - s*p.y, s*p.x + c*p.y); }
float sgS(vec2 p, vec2 a, vec2 b){ vec2 pa = p-a, ba = b-a; float h = clamp(dot(pa,ba)/dot(ba,ba), 0.0, 1.0); return length(pa - ba*h); }
float sHead(vec2 p){ vec2 q = rot2(p, 0.45) / vec2(0.085, 0.062); return (length(q) - 1.0) * 0.062; }
float sArc(vec2 p, vec2 c, float r){ return abs(length(p - c) - r); }
float sym(vec2 p, float k){
  float w = 0.014, d = 9.0;
  if (k < 0.5) {            // quarter note
    d = min(sHead(p - vec2(-0.05, -0.2)), sgS(p, vec2(0.022, -0.17), vec2(0.022, 0.26)) - w);
  } else if (k < 1.5) {     // eighth note with a flag
    d = min(sHead(p - vec2(-0.05, -0.2)), sgS(p, vec2(0.022, -0.17), vec2(0.022, 0.27)) - w);
    vec2 c = vec2(0.022, 0.12); float f = sArc(p, c, 0.15) - w * 1.2; f = max(f, c.x - p.x); f = max(f, (c.y - 0.05) - p.y);
    d = min(d, f);
  } else if (k < 2.5) {     // two beamed eighths
    d = min(sHead(p - vec2(-0.2, -0.2)), sHead(p - vec2(0.1, -0.14)));
    d = min(d, sgS(p, vec2(-0.128, -0.17), vec2(-0.128, 0.22)) - w); d = min(d, sgS(p, vec2(0.172, -0.11), vec2(0.172, 0.28)) - w);
    d = min(d, sgS(p, vec2(-0.128, 0.22), vec2(0.172, 0.28)) - 0.032);
  } else if (k < 3.5) {     // treble clef
    d = sArc(p, vec2(0.0, -0.1), 0.11) - w;
    d = min(d, sgS(p, vec2(-0.01, -0.36), vec2(0.04, 0.33)) - w);
    float tl = sArc(p, vec2(-0.015, 0.25), 0.075) - w; tl = max(tl, -(p.y - 0.2)); d = min(d, tl);
    d = min(d, length(p - vec2(-0.06, -0.35)) - 0.035);
  } else if (k < 4.5) {     // bass clef
    float a = sArc(p, vec2(-0.04, 0.06), 0.14) - w * 1.3; a = max(a, -(p.y - 0.02) - max(p.x - 0.05, 0.0) * 3.0); d = a;
    d = min(d, sgS(p, vec2(0.095, -0.0), vec2(-0.12, -0.26)) - w * 1.3);
    d = min(d, length(p - vec2(-0.15, 0.06)) - 0.04);
    d = min(d, length(p - vec2(0.2, 0.12)) - 0.026); d = min(d, length(p - vec2(0.2, -0.02)) - 0.026);
  } else if (k < 5.5) {     // sharp
    d = min(sgS(p, vec2(-0.05, -0.26), vec2(-0.05, 0.24)), sgS(p, vec2(0.05, -0.24), vec2(0.05, 0.26))) - w;
    d = min(d, sgS(p, vec2(-0.14, 0.04), vec2(0.14, 0.11)) - 0.026); d = min(d, sgS(p, vec2(-0.14, -0.11), vec2(0.14, -0.04)) - 0.026);
  } else if (k < 6.5) {     // flat
    d = sgS(p, vec2(-0.06, -0.16), vec2(-0.06, 0.32)) - w;
    float b = sArc(p, vec2(-0.0, -0.07), 0.085) - w * 1.3; b = max(b, -0.06 - p.x); d = min(d, b);
  } else {                  // half note
    d = min(abs(sHead(p - vec2(-0.05, -0.2))) - w * 0.8, sgS(p, vec2(0.022, -0.17), vec2(0.022, 0.26)) - w);
  }
  return d;
}
// the symbol layer at wall point q (metres in the wall's plane); returns the glow
float symLayer(vec2 q, float dir){
  vec2 g = q + vec2(dir * uTime * 0.13, 0.18 * sin(q.x * 0.21 + uTime * 0.27));
  g /= 1.05; vec2 cell = floor(g); vec2 p = fract(g) - 0.5;
  float cellOn = h21(cell + 41.0);
  float on = smoothstep(0.42, 0.56, cellOn + 0.22 * sin(uTime * 0.19 + cell.x * 0.73 + cell.y * 1.31));
  float glow = 0.0;
  if (on > 0.001) {
    p = rot2(p, 0.25 * sin(uTime * 0.35 + cellOn * 9.0)) * (1.25 - 0.25 * on);
    float ph = uTime * 0.11 + cellOn * 9.0, i0 = floor(ph), f = smoothstep(0.72, 1.0, fract(ph));
    float k0 = floor(h21(cell + i0 * 1.37) * 8.0), k1 = floor(h21(cell + (i0 + 1.0) * 1.37) * 8.0);
    if (dot(p, p) < 0.25) {                                            // only near the symbol itself
      float d = sym(p, k0);
      if (f > 0.0) d = mix(d, sym(p, k1), f);                          // one shape melts into the next
      float gate = 0.55 + 0.45 * sin(uTime * 1.3 + cellOn * 20.0);
      glow = (smoothstep(0.016, 0.0, d) + 0.4 * exp(-max(d, 0.0) * 24.0)) * gate * on;
    }
  }
  // staff lines: two five-line staves per wall, waving and drifting
  for (int s = 0; s < 2; s++) {
    float y0 = s == 0 ? 1.55 : 6.05;
    float v = q.y - y0 - 0.22 * sin(q.x * 0.33 + uTime * 0.42 + float(s) * 2.0) - 0.08 * sin(q.x * 1.1 - uTime * 0.7);
    if (abs(v) < 0.3) {
      float l = abs(fract(v / 0.12 + 0.5) - 0.5) * 0.12;
      float fade = 0.5 + 0.5 * sin(q.x * 0.17 - uTime * 0.31 + float(s) * 3.0);
      glow += smoothstep(0.009, 0.0, l) * 0.55 * fade + exp(-l * 60.0) * 0.12 * fade;
    }
  }
  return glow;
}
`;
// stone: ashlar blocks, mineral streaks; verdigris where water and time got in; her image when the room turns out to be her light
const STONE = SYMS + `
uniform float uKind; // 0 wall, 1 ceiling, 2 pillar
uniform float uConc; // v3: 1 = weathered concrete (live hall), 0 = the old ashlar stone (render mode, and the dark antechamber)
vec3 shade(vec3 wp, vec3 n, vec2 uv, inout float alpha){
  vec2 q = abs(n.x) > 0.5 ? wp.zy : (abs(n.z) > 0.5 ? wp.xy : wp.xz);
  if (uKind > 1.5) q = vec2(atan(wp.x - floor(wp.x/8.4+0.5)*8.4, 1.0)*0.0 + uv.x*3.2, wp.y);
  vec2 w = q;
  if (uTrip > 0.001) { float a = uTime*0.25; w += uTrip * 0.9 * vec2(fbm3(q*0.35 + a), fbm3(q*0.35 - a + 3.1)); }
  if (uSig > 0.001) w += uSig * vec2(0.10 * sin(q.y * 1.3 + uTime * 0.45), 0.22 * (noise(q * 0.4 + vec2(0.0, uTime * 0.05)) - 0.5));  // the stone slowly melts
  float cc = uConc * uCon;
  vec3 alb; float mortar = 1.0, wet = 0.0, gold = 0.0, band = 0.0;
  if (cc > 0.5) {
    // weathered board-formed concrete: 1.2 m panels, tie holes, rain runs, pores, hairline cracks (tileable texture, 2.4 m)
    vec2 cq = uKind > 1.5 ? vec2(uv.x * 2.4 + (w.x - q.x), w.y) : w;
    vec4 ct = texture2D(uConT, vec2(cq.x, -cq.y) * (1.0 / 2.4));
    alb = mix(vec3(0.012, 0.019, 0.021), vec3(0.080, 0.088, 0.084), ct.r);
    alb *= 0.72 + 0.56 * noise(w * 0.11 + 7.0);
    wet = ct.g; gold = ct.b;
    alb *= 1.0 - 0.4 * wet;
    alb = mix(alb, VERD * 0.16, wet * smoothstep(4.2, 0.2, wp.y) * 0.75);
    if (uKind > 1.5) {   // weathered bronze collars on the pillars, verdigris eating into them
      band = max(smoothstep(0.2, 0.17, abs(wp.y - 0.45)), smoothstep(0.16, 0.13, abs(wp.y - 6.55)));
      float pv = smoothstep(0.35, 0.75, noise(cq * vec2(3.0, 6.0)) + 0.25 * noise(cq * 31.0));
      alb = mix(alb, mix(vec3(0.24, 0.15, 0.07), vec3(0.11, 0.32, 0.27), pv), band);
    }
  } else {
    vec2 bq = vec2(w.x * 0.62, w.y * 1.15); float row = floor(bq.y); bq.x += mod(row, 2.0) * 0.5;
    vec2 cell = fract(bq), id = floor(bq);
    mortar = smoothstep(0.0, 0.035, min(min(cell.x, 1.0-cell.x)*0.6, min(cell.y, 1.0-cell.y)));
    float nse = fbm3(w * 1.7 + id * 3.1);
    alb = mix(vec3(0.030, 0.040, 0.040), vec3(0.085, 0.090, 0.080), nse) * (0.55 + 0.45*mortar) * (0.85 + 0.3*h21(id));
    float streak = smoothstep(0.62, 0.9, fbm3(vec2(w.x*2.2, w.y*0.25) + 4.0)) * smoothstep(3.5, 0.0, wp.y);
    alb = mix(alb, VERD * 0.22, streak * 0.6);
  }
  vec3 col = alb * lightAt(wp, n) * 2.4;
  if (cc > 0.5) {
    // gold reflections here and there: damp patches and the bronze collars catch the warm lights; a little gold in some cracks
    vec3 V = normalize(cameraPosition - wp); vec3 R = reflect(-V, n);
    float gl = 0.15 + 0.85 * max(wet, band);
    vec3 dl = normalize(vec3(0.0, 2.6, -21.6) - wp);
    col += GOLDG * pow(max(dot(R, dl), 0.0), 12.0) * uDoorGlow * gl * 0.3;
    for (int i=0;i<3;i++){ vec3 bl = normalize(uBlob[i].xyz - wp); col += GOLDG * pow(max(dot(R, bl), 0.0), 18.0) * uBlob[i].w * gl * 0.35; }
    col += GOLDG * pow(max(R.y, 0.0), 6.0) * uCeil * gl * 0.05;
    col += GOLDG * gold * (0.03 + 0.3 * uRms + 0.12 * uHer) * (1.0 - uDark * 0.6);
  }
  if (uTrip > 0.001) {
    float bands = sin(fbm3(w*0.6 + uTime*0.12)*9.0 + uTime*0.7 + wp.y*0.6);
    vec3 tc = mix(mix(TEAL*1.6, VERD, 0.5+0.5*bands), BRONZE*0.9, smoothstep(0.55, 1.0, bands));
    col += tc * uTrip * (0.03 + 0.09*uRms) * (0.5 + 0.5*mortar);
  }
  // the soundwave frieze on the long walls: three engraved bronze traces carrying the song toward the door
  if (uKind < 0.5 && abs(n.x) > 0.5) {
    float v = wp.y - 4.35; float zz = 8.0 - wp.z;
    if (abs(v) < 0.75) {
      vec4 f = featAt(uT - zz / 5.0);
      float e = f.x * 0.5 + 0.03;
      float fill = smoothstep(e, e - 0.025, abs(v)) * (0.35 + 0.65 * step(0.45, fract(wp.z * 16.0)));
      float mid = smoothstep(0.012, 0.0, abs(v - sin(wp.z*3.0 - uT*2.0) * f.y * 0.25));
      vec3 fc = mix(BRONZE, VERD*1.3, smoothstep(0.0, 0.6, abs(v)/max(e,0.05)));
      col += fc * (fill * 0.32 + mid * 0.5) * (0.25 + 1.1*uRms + 0.6*uHer) * (1.0 - uDark*0.8) * step(0.0, uT);
    }
  }
  if (uSig > 0.001) {
    // deep teal drifting through the stone, and the gold symbols on top
    float neb = smoothstep(0.25, 0.85, noise(q * 0.22 + vec2(uTime * 0.021, -uTime * 0.016)));
    float e = 0.3 + 1.2 * uRms + 0.45 * uSub;
    col = mix(col, col * vec3(0.55, 1.05, 1.12), uSig * 0.6);
    col += DTEAL * (0.2 + 0.6 * neb) * uSig * (0.55 + 0.6 * uRms);
    if (uKind < 1.5) {
      float fr = (uKind < 0.5 && abs(n.x) > 0.5 && abs(wp.y - 4.35) < 0.8) ? 0.35 : 1.0;   // quieter over the soundwave frieze
      float gl = symLayer(q, abs(n.x) > 0.5 ? -sign(n.x) : 1.0) * fr * (uKind > 0.5 ? 0.6 : 1.0);
      float gg = gl * uSig * e * (1.0 - uDark * 0.5);
      col = col * (1.0 - 0.7 * clamp(gg, 0.0, 1.0)) + GOLDG * gg * 0.6;
    }
  }
  if (uReveal > 0.001) {
    vec2 iu = abs(n.x) > 0.5 ? vec2(fract((-wp.z*sign(n.x) + 8.0) / 10.0), clamp((wp.y - 0.2) / 6.6, 0.0, 1.0))
                             : vec2(fract(wp.x / 12.0 + 0.5), fract(wp.z / 12.0));
    vec3 im = texture2D(uImg, iu).rgb;
    float pulse = 0.55 + 0.45*uHer + 0.25*uSub;
    col = mix(col, im * 0.2 * pulse, uReveal * (0.45 + 0.35*mortar));
  }
  return col;
}`;
const stoneMat = (k, conc) => mat({ uniforms: { uKind: { value: k }, uConc: { value: conc === undefined ? 1 : conc } }, frag: STONE, disp: BREATHE });
// bronze: oxidized, warm where light is, verdigris blooms over it across the first verse
const BRONZE_FRAG = `
vec3 shade(vec3 wp, vec3 n, vec2 uv, inout float alpha){
  vec2 q = abs(n.x) > 0.5 ? wp.zy : wp.xy;
  if (abs(n.x) < 0.5 && abs(n.z) < 0.5) q = wp.xz;
  float big = fbm3(q * 0.9), fine = noise(q * 22.0);
  float grow = smoothstep(uPatina * 1.15 - 0.1, uPatina * 1.15 + 0.05, 1.0 - big + 0.25 * fine - 0.12);
  float pat = (1.0 - grow) * (0.35 + 0.65 * smoothstep(0.2, 0.8, uPatina + big*0.2));
  vec3 base = mix(vec3(0.20, 0.12, 0.06), vec3(0.42, 0.27, 0.12), fine);
  vec3 alb = mix(base, vec3(0.13, 0.36, 0.30) * (0.8 + 0.4*fine), clamp(pat + 0.18, 0.0, 1.0));
  vec3 L = lightAt(wp, n);
  vec3 col = alb * L * 2.2;
  vec3 V = normalize(cameraPosition - wp); vec3 R = reflect(-V, n);
  vec3 dl = normalize(vec3(0.0, 2.6, -21.6) - wp);
  col += BRONZE * pow(max(dot(R, dl), 0.0), 18.0) * uDoorGlow * (1.0 - pat) * 0.8;
  for (int i=0;i<3;i++){ vec3 bl = normalize(uBlob[i].xyz - wp); col += WARM * pow(max(dot(R, bl), 0.0), 24.0) * uBlob[i].w * (1.0 - pat*0.7) * 0.6; }
  // the bloom edge glows faintly while it grows
  col += VERD * smoothstep(0.08, 0.0, abs(grow - 0.5)) * 0.08 * uPatina * (1.0 - uPatina);
  if (uTrip > 0.001) col += mix(VERD, BRONZE, 0.5 + 0.5*sin(big*12.0 + uTime*0.8)) * uTrip * 0.12;
  if (uReveal > 0.001) col = mix(col, texture2D(uImg, fract(q / 6.0 + 0.5)).rgb * (0.6 + 0.6*uHer), uReveal * 0.45);
  return col;
}`;
const bronzeMat = () => mat({ frag: BRONZE_FRAG, disp: BREATHE });
// dark water: real sound waves travel outward from her light (amplitude at radius r is the song r/c seconds ago), the lights reflect
const WATER = `
uniform vec4 uSrc[2];
vec3 shade(vec3 wp, vec3 n0, vec2 uv, inout float alpha){
  vec2 g = vec2(0.0); float hh = 0.0;
  for (int i=0;i<2;i++){
    vec2 d = wp.xz - uSrc[i].xy; float r = length(d) + 1e-3;
    vec4 f = featAt(uT - r / 3.2);
    float amp = (f.x * 0.5 + f.z * 0.9 + f.y * 0.25) * uSrc[i].w * exp(-r * 0.10);
    float ph = r * 5.0 - uTime * 3.4;
    hh += sin(ph) * amp; g += d / r * cos(ph) * amp * 5.0;
  }
  vec2 pd = wp.xz - uPlayer.xz; float pr = length(pd) + 1e-3;
  float pw = uWalk * exp(-pr * 0.7) * 0.25; g += pd / pr * cos(pr * 9.0 - uTime * 6.0) * pw * 9.0;
  g += vec2(noise(wp.xz*1.3 + uTime*0.15) - 0.5, noise(wp.zx*1.3 - uTime*0.13) - 0.5) * (0.08 + 0.35*uTrip);
  vec3 n = normalize(vec3(-g.x * 0.05, 1.0, -g.y * 0.05));
  vec3 V = normalize(cameraPosition - wp); vec3 R = reflect(-V, n);
  float fr = 0.04 + 0.96 * pow(1.0 - max(dot(V, n), 0.0), 5.0);
  vec3 col = vec3(0.004, 0.012, 0.013) + TEAL * 0.05 * uAmb;
  // the doorway reflected: march the reflected ray to the door plane
  if (R.z < -0.01) {
    float tt = (-21.6 - wp.z) / R.z; vec3 hp = wp + R * tt;
    float dw = smoothstep(uDoorW + 0.15, uDoorW - 0.05, abs(hp.x)) * smoothstep(5.8, 4.8, hp.y) * step(0.0, hp.y);
    col += WARM * dw * uDoorGlow * 1.6 * fr * 3.0;
  }
  if (uCon > 0.5 && R.y > 0.05) { float tc = (CEIL_Y - wp.y) / R.y; col += ceilAt(wp.xz + R.xz * tc) * fr * 1.4; }   // v3: the constellation in the water
  for (int i=0;i<3;i++){ vec3 bl = uBlob[i].xyz - wp; float d = length(bl);
    col += WARM2 * pow(max(dot(R, bl / d), 0.0), 60.0) * uBlob[i].w * 2.5 / (1.0 + d*0.15);
    col += WARM2 * uBlob[i].w * 0.12 / (1.0 + d*d*0.8); }
  vec3 ll = uLineHead.xyz - wp; float dl = length(ll);
  col += BRONZE * pow(max(dot(R, ll / dl), 0.0), 50.0) * uLineHead.w * 1.5;
  col += VERD * 0.03 * fr * uAmb;
  col += lightAt(wp, n) * 0.05;
  if (uReveal > 0.001) col += texture2D(uImg, vec2(fract(R.x*0.3 + 0.5), clamp(R.y*0.8, 0.0, 1.0))).rgb * uReveal * fr * 0.9;
  col *= (1.0 + hh * 0.6);
  if (uSig > 0.001) {
    float rg = abs(fract(length(wp.xz - vec2(0.0, -7.0)) * 0.45 - uTime * 0.06) - 0.5);
    col += GOLDG * (smoothstep(0.035, 0.0, rg) * 0.10 + DTEAL.g * 0.3) * uSig * (0.35 + uRms);
  }
  return col;
}`;

// ------------------------------------------------------------ building the room
const hall = new THREE.Group(); scene.add(hall);
const halfL = new THREE.Group(), halfR = new THREE.Group(); hall.add(halfL, halfR);
const HX = 6.0, HZ0 = 8.0, HZ1 = -21.6, HY = 7.2, DOORW = 1.7, DOORH = 5.6;
const wallMat = stoneMat(0), ceilMat = stoneMat(1), pillarMat = stoneMat(2), brMat = bronzeMat();
function box(w, h, d, m, x, y, z, seg, parent) {
  const g = new THREE.BoxGeometry(w, h, d, seg ? seg[0] : 1, seg ? seg[1] : 1, seg ? seg[2] : 1);
  const me = new THREE.Mesh(g, m); me.position.set(x, y, z); (parent || scene).add(me); return me;
}
// long walls (segmented so they can breathe), ceiling halves, far wall halves around the door
box(0.6, HY, HZ0 - HZ1, wallMat, -HX - 0.3, HY / 2, (HZ0 + HZ1) / 2, [1, 8, 18], halfL);
box(0.6, HY, HZ0 - HZ1, wallMat, HX + 0.3, HY / 2, (HZ0 + HZ1) / 2, [1, 8, 18], halfR);
const ceilL = box(HX, 0.5, HZ0 - HZ1, ceilMat, -HX / 2, HY + 0.25, (HZ0 + HZ1) / 2, [4, 1, 16], halfL);
const ceilR = box(HX, 0.5, HZ0 - HZ1, ceilMat, HX / 2, HY + 0.25, (HZ0 + HZ1) / 2, [4, 1, 16], halfR);
if (!RENDER) { ceilL.visible = ceilR.visible = false; }   // v3: the hall is open to the constellation ceiling
for (const s of [-1, 1]) {
  const parent = s < 0 ? halfL : halfR, wpart = HX - DOORW;
  box(wpart, HY, 0.8, wallMat, s * (DOORW + wpart / 2), HY / 2, HZ1 - 0.4, [4, 6, 1], parent);
  box(DOORW, HY - DOORH, 0.8, wallMat, s * DOORW / 2, DOORH + (HY - DOORH) / 2, HZ1 - 0.4, null, parent);
  // pillars: stone shafts with bronze collars
  for (const z of [3.0, -3.2, -9.4, -15.6]) {
    const pm = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.48, HY, 10, 6, true), pillarMat); pm.position.set(s * 4.2, HY / 2, z); parent.add(pm);
    const c1 = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.35, 10, 1), brMat); c1.position.set(s * 4.2, 0.6, z); parent.add(c1);
    const c2 = c1.clone(); c2.position.y = HY - 0.5; parent.add(c2);
  }
  // bronze panels along the walls, where verdigris blooms during the first verse
  for (const z of [0.0, -6.3, -12.5]) box(0.08, 2.9, 4.2, brMat, s * (HX - 0.04), 2.45, z, [1, 4, 6], parent);
  // the door leaves: bronze, hinged at the jambs
  const hinge = new THREE.Group(); hinge.position.set(s * DOORW, 0, HZ1 + 0.02); parent.add(hinge);
  box(DOORW - 0.07, DOORH, 0.14, brMat, -s * (DOORW - 0.07) / 2, DOORH / 2, 0, [3, 6, 1], hinge);
  hinge.userData.s = s; (BS.leaves = BS.leaves || []).push(hinge);
}
// the antechamber you start in, and the wall with the entrance door
const ante = new THREE.Group(); scene.add(ante);
const AW = 2.6, AZ1 = 14.2, AH = 3.6, EW = 0.75, EH = 2.7;
const anteWall = stoneMat(0, 0), anteCeil = stoneMat(1, 0);   // v3: the dark antechamber stays ashlar stone; the hall beyond is concrete
box(0.4, AH, AZ1 - HZ0, anteWall, -AW - 0.2, AH / 2, (AZ1 + HZ0) / 2, null, ante);
box(0.4, AH, AZ1 - HZ0, anteWall, AW + 0.2, AH / 2, (AZ1 + HZ0) / 2, null, ante);
box(AW * 2 + 0.8, AH, 0.4, anteWall, 0, AH / 2, AZ1 + 0.2, null, ante);
box(AW * 2 + 0.8, 0.4, AZ1 - HZ0, anteCeil, 0, AH + 0.2, (AZ1 + HZ0) / 2, null, ante);
box(AW * 2 + 0.8, 0.3, AZ1 - HZ0, mat({ frag: STONE.replace('uniform float uKind;', 'float uKind = 1.0;') }), 0, -0.15, (AZ1 + HZ0) / 2, null, ante);
for (const s of [-1, 1]) box(HX - EW, HY, 0.8, wallMat, s * (EW + (HX - EW) / 2), HY / 2, HZ0 + 0.4, [3, 6, 1], ante);
box(EW * 2, HY - EH, 0.8, wallMat, 0, EH + (HY - EH) / 2, HZ0 + 0.4, null, ante);
// the water floor (big enough for the room to open onto)
const waterMat = mat({ frag: WATER, uniforms: { uSrc: { value: [new THREE.Vector4(0, -18, 0, 0), new THREE.Vector4(0, -10, 0, 0)] } } });
const water = new THREE.Mesh(new THREE.PlaneGeometry(140, 140), waterMat); water.rotation.x = -Math.PI / 2; water.position.set(0, 0, -20); scene.add(water);
// sky beyond the room: only seen once the room opens in two
const sky = new THREE.Mesh(new THREE.SphereGeometry(110, 24, 12), mat({ side: THREE.BackSide, noFog: true, frag: `
vec3 shade(vec3 wp, vec3 n, vec2 uv, inout float alpha){
  vec3 d = normalize(wp - vec3(0.0, 0.0, -20.0));
  float h = clamp(d.y, -0.2, 1.0);
  vec3 col = mix(vec3(0.34, 0.17, 0.07), vec3(0.02, 0.09, 0.11), smoothstep(0.0, 0.4, h));
  col = mix(col, vec3(0.008, 0.03, 0.04), smoothstep(0.4, 1.0, h));
  float sun = max(dot(d, normalize(vec3(0.0, 0.08, -1.0))), 0.0);
  col += WARM * (pow(sun, 24.0) * 0.6 + pow(sun, 4.0) * 0.12) * (0.7 + 0.5*uHer);
  col += VERD * 0.05 * fbm3(d.xz * 3.0 + vec2(uTime*0.01, 0.0)) * smoothstep(0.05, 0.4, h);
  return col * uSplit;
}` }));
scene.add(sky);
// her picture: beyond the door, a glowing panel in a bronze frame ("When the Voices Found Each Other")
const imgTex = new THREE.TextureLoader().load(BS.asset('img/unity.jpg'), () => { BS.imgReady = true; });
imgTex.encoding = THREE.sRGBEncoding; U.uImg.value = imgTex;
const panel = new THREE.Group(); panel.position.set(0, 3.9, -27.0); scene.add(panel);
const panelMat = mat({ frag: `
vec3 shade(vec3 wp, vec3 n, vec2 uv, inout float alpha){
  vec2 u = uv; u += (vec2(noise(uv*6.0 + uTime*0.2), noise(uv*6.0 - uTime*0.17)) - 0.5) * 0.004 * (1.0 + 3.0*uTrip);
  vec3 im = texture2D(uImg, u).rgb;
  float br = 0.42 + 0.18 * uDoorGlow + 0.25 * uHer + 0.12 * uSplit;
  float vig = smoothstep(0.0, 0.08, min(min(uv.x, 1.0-uv.x), min(uv.y, 1.0-uv.y)));
  return im * br * vig;
}` });
panel.add(new THREE.Mesh(new THREE.PlaneGeometry(7.2, 7.2), panelMat));
for (const [w, h, x, y] of [[7.8, 0.3, 0, 3.75], [7.8, 0.3, 0, -3.75], [0.3, 7.8, 3.75, 0], [0.3, 7.8, -3.75, 0]]) box(w, h, 0.25, brMat, x, y, -0.05, null, panel);

// ------------------------------------------------------------ v3 (live only): the approved concept look
// The constellation (Unity and Miles's shared brain) plays as a huge ceiling 11 m up, the hall is open to it, the water
// reflects it. Unity and Miles (still cutout, its own layer) hang under its far edge in front of it, at the end of the hall.
let ceilMesh = null, peopleMesh = null;
if (!RENDER) {
  panel.visible = false;   // her old picture is replaced by the new layers
  const cTex = new THREE.TextureLoader().load(BS.asset('img/concrete.jpg'));
  cTex.wrapS = cTex.wrapT = THREE.RepeatWrapping; cTex.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  U.uConT.value = cTex; U.uCon.value = 1;
  const v = document.createElement('video');
  v.muted = true; v.loop = true; v.playsInline = true; v.setAttribute('playsinline', ''); v.setAttribute('muted', ''); v.crossOrigin = 'anonymous'; v.preload = 'auto';
  const mp4 = v.canPlayType('video/mp4; codecs="avc1.4D4028"');   // Quest browser: H.264. Builds without it get the VP9 copy
  v.src = BS.asset(mp4 ? 'video/constellation.mp4' : 'video/constellation.webm'); BS.ceilSrc = mp4 ? 'mp4' : 'webm';
  BS.ceilVideo = v; BS.playCeil = () => { if (v.paused) v.play().catch(() => {}); };
  v.addEventListener('canplay', () => BS.playCeil(), { once: true });
  const vTex = new THREE.VideoTexture(v); vTex.minFilter = THREE.LinearFilter; vTex.magFilter = THREE.LinearFilter; vTex.generateMipmaps = false;
  U.uVid.value = vTex;
  ceilMesh = new THREE.Mesh(new THREE.PlaneGeometry(56, 31.5), mat({ noFog: true, frag: `
vec3 shade(vec3 wp, vec3 n, vec2 uv, inout float alpha){
  return ceilAt(wp.xz) * (0.8 + 0.35 * uRms + 0.2 * uSplit) * (1.0 - 0.45 * uDark) + DTEAL * 0.015;
}` }));
  ceilMesh.rotation.x = Math.PI / 2; ceilMesh.position.set(0, 11.0, -12.25); scene.add(ceilMesh);
  const pTex = new THREE.TextureLoader().load(BS.asset('img/people.webp'));
  pTex.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  peopleMesh = new THREE.Mesh(new THREE.PlaneGeometry(10.6, 5.96), mat({ noFog: true, transparent: true, depthWrite: false, uniforms: { uPeo: { value: pTex } }, frag: `
uniform sampler2D uPeo;
vec3 shade(vec3 wp, vec3 n, vec2 uv, inout float alpha){
  vec4 p = texture2D(uPeo, uv);
  alpha = p.a;
  vec3 c = pow(p.rgb, vec3(2.2)) * (0.95 + 0.2 * uHer + 0.15 * uRms + 0.3 * uSplit) * (1.0 - 0.35 * uDark);
  return c + DTEAL * 0.04 * p.a;
}` }));
  peopleMesh.position.set(0, 6.6, -15.0); peopleMesh.renderOrder = 2; scene.add(peopleMesh);
  U.uImg.value = vTex;
  BS.ceilMesh = ceilMesh; BS.peopleMesh = peopleMesh;   // "can a thought become a place?": the walls turn out to be the shared brain
}
// light falling through the gaps: one beam from the far door, one through the entrance into the dark antechamber
const BEAM = `
uniform float uBeam, uLenB;
vec3 shade(vec3 wp, vec3 n, vec2 uv, inout float alpha){
  float along = uv.y;
  float sh = 0.75 + 0.25 * noise(vec2(uv.x * 30.0, uTime * 18.0)) * (0.4 + 1.4 * uHi);
  float edge = smoothstep(0.0, 0.25, uv.x) * smoothstep(1.0, 0.75, uv.x);
  alpha = uBeam * edge * (1.0 - along) * (1.0 - along) * 0.07 * sh;
  return WARM2;
}`;
function beamMesh(w, h, len, drop) {
  // a slanted slab of light: from a door-shaped opening, travelling along +z (local) and down
  const g = new THREE.BufferGeometry();
  const p = [], uv = [], idx = [];
  const N = 6;
  for (let i = 0; i <= N; i++) { // vertical fan of sheets so it reads from any side
    const yy = h * (0.05 + 0.95 * i / N);
    const y1 = Math.max(0.02, yy - drop * (yy / h));
    const b = p.length / 3;
    p.push(-w / 2, yy, 0, w / 2, yy, 0, -w / 2 * 1.3, y1, len, w / 2 * 1.3, y1, len);
    uv.push(0, 0, 1, 0, 0, 1, 1, 1);
    idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(p.length).fill(0).map((v, i) => i % 3 === 1 ? 1 : 0), 3)); g.setIndex(idx);
  const m = mat({ frag: BEAM, uniforms: { uBeam: { value: 0 }, uLenB: { value: len } }, transparent: true, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, noFog: true });
  return new THREE.Mesh(g, m);
}
const beamFar = beamMesh(0.5, DOORH * 0.95, 13, 4.6); beamFar.position.set(0, 0, HZ1 + 0.1); scene.add(beamFar);
const beamIn = beamMesh(EW * 2, EH * 0.98, 5.5, 2.4); beamIn.position.set(0, 0, HZ0 + 0.85); scene.add(beamIn);
// a door-shaped pool of light on the floor
const poolMat = mat({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, uniforms: { uPool: { value: 0 } }, frag: `
uniform float uPool;
vec3 shade(vec3 wp, vec3 n, vec2 uv, inout float alpha){
  vec2 c = uv - vec2(0.5, 0.0);
  float m = smoothstep(0.5, 0.36, abs(c.x)) * smoothstep(1.0, 0.0, uv.y);
  alpha = m * uPool * (0.8 + 0.2*noise(uv*20.0 + uTime));
  return WARM2 * 0.55;
}` });
const poolIn = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 5.0), poolMat); poolIn.rotation.x = -Math.PI / 2; poolIn.position.set(0, 0.165, HZ0 + 3.2); poolIn.rotation.z = Math.PI; ante.add(poolIn);

// ------------------------------------------------------------ dancing silhouettes
// Shadow dancers: SDF figures. On the walls they are shadows cast into her light (they only show where light falls);
// beyond the door they stand backlit against her picture. During the guitar break they multiply into mirrored echoes.
const DANCER = `
uniform float uSeed, uMode, uVis;
float cap(vec2 p, vec2 a, vec2 b, float r){ vec2 pa=p-a, ba=b-a; float h=clamp(dot(pa,ba)/dot(ba,ba),0.0,1.0); return length(pa-ba*h)-r; }
vec2 limb(vec2 o, float a, float l){ return o + l*vec2(sin(a), -cos(a)); }
float figure(vec2 p, float ph, float en, float st){
  float b = ph * 6.28318;
  float sway = sin(b*0.5 + st) * 0.12 * en, bob = abs(sin(b)) * 0.05 * en;
  vec2 hip = vec2(sway, 0.95 + bob);
  vec2 chest = hip + vec2(sin(b*0.5 + st + 0.6)*0.08*en, 0.5);
  vec2 head = chest + vec2(sin(b*0.5 + st + 1.2)*0.05, 0.24);
  float d = length(p - head) - 0.11;
  d = min(d, cap(p, hip, chest, 0.1 - 0.02*st));
  for (int k=0;k<2;k++){ float s = k==0 ? -1.0 : 1.0;
    vec2 sh = chest + vec2(0.17*s, -0.03);
    float a1 = s*(0.5 + 0.9*en*(0.5+0.5*sin(b*0.5 + s*1.3 + st))) + 0.25*sin(b + st);
    vec2 el = limb(sh, a1, 0.29);
    vec2 wr = limb(el, a1 + s*(0.6 + 0.8*en*(0.5+0.5*sin(b*0.5 + 2.0 + s))), 0.27);
    d = min(d, cap(p, sh, el, 0.045)); d = min(d, cap(p, el, wr, 0.038));
    vec2 hp = hip + vec2(0.09*s, -0.02);
    float l1 = s*0.08 + 0.3*en*sin(b*0.5 + s*1.57 + st);
    vec2 kn = limb(hp, l1, 0.45);
    vec2 ft = limb(kn, l1 - 0.25*en*max(0.0, sin(b*0.5 + s*1.57 + st)), 0.45);
    d = min(d, cap(p, hp, kn, 0.06)); d = min(d, cap(p, kn, ft, 0.045));
  }
  if (st > 0.5) { // a long skirt that swings
    vec2 q = p - hip; float sw = sin(b*0.5 + st + 0.4) * 0.12 * en;
    float y = clamp(-q.y / 0.75, 0.0, 1.0); float w = 0.1 + 0.26*y; float cx = sw*y;
    float sk = max(abs(q.x - cx) - w, max(q.y - 0.05, -q.y - 0.75));
    d = min(d, sk);
  }
  return d;
}
vec3 shade(vec3 wp, vec3 n, vec2 uv, inout float alpha){
  vec2 p = (uv - vec2(0.5, 0.0)) * vec2(1.25, 2.3);
  float ph = uTime * ${(BPM / 60).toFixed(5)} + uSeed * 0.37;
  float en = clamp(0.25 + uRms * 1.1 + uTrip * 0.6, 0.0, 1.3);
  float st = mod(uSeed, 2.0);
  float d = figure(p, ph, en, st);
  if (uTrip > 0.001) { // echoes: mirrored and delayed copies
    for (int k=1;k<4;k++){ float fk = float(k);
      vec2 q = p; q.x = abs(q.x) - 0.32*fk*uTrip; 
      d = min(d, figure(q, ph - 0.12*fk, en, st) + 0.02*fk); }
  }
  float m = smoothstep(0.012, -0.012, d);
  if (uMode < 0.5) {
    // shadow on the wall: only visible where light falls on it
    vec3 L = lightAt(wp, n); float lit = clamp(dot(L, vec3(0.35)) * 2.2, 0.0, 1.0);
    alpha = m * lit * uVis * 0.9;
    vec3 c = vec3(0.004, 0.006, 0.006);
    if (uTrip > 0.001) { c = mix(c, VERD * 0.25, smoothstep(-0.05, 0.0, d) * uTrip); }
    return c;
  }
  // backlit against her picture: dark body, warm rim
  float rim = smoothstep(0.035, 0.0, abs(d + 0.012));
  alpha = max(m, rim * 0.8) * uVis;
  return mix(vec3(0.006, 0.008, 0.008), WARM * (0.6 + 0.8*uHer), rim * (1.0 - m*0.6));
}`;

// Live mode (v2, Oct 15): human silhouettes instead of stick figures. Head, neck, shoulders, a torso that narrows at the waist,
// hips, and arms and legs with real volume (tapered capsules melted together with a smooth union); legs by two-bone IK so the feet
// stay planted while the knees bend on the beat. Partly see-through: dark-teal smoke inside, a gold glow at the edge.
// Still one quad per dancer (2 triangles), drawn in the shader.
const DANCER2 = `
uniform float uSeed, uMode, uVis, uAspX;
float smin(float a, float b, float k){ float h = clamp(0.5 + 0.5*(b - a)/k, 0.0, 1.0); return mix(b, a, h) - k*h*(1.0 - h); }
float rc(vec2 p, vec2 a, vec2 b, float ra, float rb){ vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba)/dot(ba, ba), 0.0, 1.0); return length(pa - ba*h) - mix(ra, rb, h); }
float el(vec2 p, vec2 c, vec2 r){ return (length((p - c)/r) - 1.0) * min(r.x, r.y); }
vec2 dr(float a){ return vec2(sin(a), -cos(a)); }
// two-bone IK in the picture plane: from joint a toward target c; returns the middle joint, writes the end joint to e
vec2 ik(vec2 a, vec2 c, float l1, float l2, float bend, out vec2 e){
  vec2 d = c - a; float L0 = max(length(d), 1e-3); vec2 u = d / L0; float L = clamp(L0, 0.05, l1 + l2 - 0.002);
  float x = (l1*l1 - l2*l2 + L*L) / (2.0*L); float y = sqrt(max(l1*l1 - x*x, 0.0));
  vec2 m = a + u*x + vec2(-u.y, u.x)*y*bend*0.4; e = a + u*L; return m;   // front view: a bent knee shows mostly as a shorter leg
}
float human(vec2 p, float ph, float en, float st, float fem, float dress){
  float b = ph * 6.28318, h = b * 0.5;
  float bounce = 0.5 - 0.5*cos(b);
  float sw = sin(h + st);
  // feet: weight shifts side to side, the free foot lifts and steps
  float lL = max(0.0, sw), lR = max(0.0, -sw);
  vec2 fL = vec2(-0.17 - 0.05*en*sin(h*0.5 + st), 0.05 + 0.08*en*lL*lL);
  vec2 fR = vec2( 0.17 + 0.05*en*cos(h*0.5 + st*1.7), 0.05 + 0.08*en*lR*lR);
  vec2 hip = vec2(sw*0.075*en, 0.92 - 0.055*en*bounce);
  float lean = sin(h + st + 0.6) * 0.11 * en;
  vec2 up = vec2(-sin(lean), cos(lean)), sd = vec2(up.y, -up.x);
  vec2 waist = hip + up*0.17, chest = hip + up*0.36, neck = hip + up*0.54;
  vec2 head = neck + up*0.13 + vec2(sin(b + 0.8)*0.025*en - lean*0.06, 0.0);
  float shW = 0.185 - 0.025*fem, hipW = 0.095 + 0.02*fem;
  // head (with hair), neck
  float d = el(p, head, vec2(0.09, 0.112));
  if (fem > 0.5) d = smin(d, rc(p, head + vec2(0.0, 0.02), head + vec2(sin(b*0.5 + st)*0.03, -0.17), 0.095, 0.072), 0.03);
  d = smin(d, rc(p, neck - up*0.03, head - up*0.06, 0.043, 0.04), 0.025);
  // torso: chest, waist, hips
  d = smin(d, rc(p, chest - sd*0.06, chest + sd*0.06, 0.11 + 0.01*(1.0 - fem), 0.11 + 0.01*(1.0 - fem)), 0.04);
  d = smin(d, rc(p, chest, waist, 0.13 - 0.02*fem, 0.095), 0.06);
  d = smin(d, rc(p, waist, hip - up*0.02, 0.095, 0.125 + 0.025*fem), 0.06);
  vec2 shL = neck - up*0.07 - sd*shW, shR = neck - up*0.07 + sd*shW;
  d = smin(d, rc(p, shL, shR, 0.055, 0.055), 0.07);
  // arms (forward kinematics: shoulder and elbow angles from straight down, outward positive), four dance styles
  for (int k = 0; k < 2; k++) {
    float s = k == 0 ? -1.0 : 1.0; vec2 sh = k == 0 ? shL : shR;
    float a1, a2;
    if (st < 0.5)      { a1 = 0.6 + 0.3*en*sin(h + s);                a2 = -(1.45 + 0.45*en*sin(b + s*1.5)); }        // groove, fists in
    else if (st < 1.5) { a1 = 2.45 + 0.30*en*sin(h + s*1.2);          a2 = 0.35*sin(b*0.5 + s); }                     // both arms up, swaying
    else if (st < 2.5) { a1 = s < 0.0 ? 2.7 + 0.18*sin(h) : 0.45 + 0.35*en*sin(h);  a2 = s < 0.0 ? 0.25*sin(b*0.5) : -(1.3 + 0.5*sin(b)); }  // one hand up
    else               { a1 = 1.05 + 0.85*en*sin(h*0.5 + s*1.1 + st);  a2 = 0.65*sin(h*0.5 + 1.0 + s*0.4); }          // slow flowing waves
    vec2 e1 = sh + 0.28*dr(s*a1) * vec2(1.0, 1.0);
    vec2 w1 = e1 + 0.25*dr(s*(a1 + a2));
    d = smin(d, rc(p, sh, e1, 0.05, 0.04), 0.035);
    d = smin(d, rc(p, e1, w1, 0.038, 0.028), 0.02);
    d = smin(d, el(p, w1 + 0.04*dr(s*(a1 + a2)), vec2(0.032, 0.038)), 0.02);
  }
  // legs: hips to planted feet, knees out a little
  float dl = 9.0;
  for (int k = 0; k < 2; k++) {
    float s = k == 0 ? -1.0 : 1.0; vec2 hp = hip + sd*hipW*s - up*0.05; vec2 ft = k == 0 ? fL : fR; vec2 an;
    vec2 kn = ik(hp, ft, 0.44, 0.42, s, an);
    float l = smin(rc(p, hp, kn, 0.078 + 0.008*fem, 0.05), rc(p, kn, an, 0.05, 0.032), 0.03);
    l = smin(l, rc(p, an, an + vec2(s*0.06, -0.035), 0.03, 0.024), 0.02);
    dl = min(dl, l);                       // the two legs stay apart; only the pair melts into the hips
  }
  d = smin(d, dl, 0.035);
  if (dress > 0.5) { // a dress that swings with the hips
    vec2 q = p - waist; float swg = sin(h + st + 0.5) * 0.1 * en;
    float y = clamp(-q.y / 0.62, 0.0, 1.0); float wd = 0.11 + 0.2*y; float cx = swg*y*y;
    float sk = max(abs(q.x - cx) - wd, max(q.y, -q.y - 0.62)) ;
    d = smin(d, sk, 0.03);
  }
  return d;
}
vec3 shade(vec3 wp, vec3 n, vec2 uv, inout float alpha){
  if (uVis < 0.004) discard;
  vec2 p = (uv - vec2(0.5, 0.0)) * vec2(1.25 * uAspX, 2.3);
  if (abs(p.x) > 0.95 || p.y > 2.2 || length((p - vec2(0.0, 1.05)) / vec2(0.85, 1.2)) > 1.05) discard;
  float ph = uTime * ${(BPM / 60).toFixed(5)} + uSeed * 0.37;
  float en = clamp(0.3 + uRms * 1.1 + uTrip * 0.5, 0.0, 1.25);
  float st = mod(uSeed, 4.0), fem = mod(uSeed, 2.0), dress = (mod(uSeed, 3.0) < 1.5 && fem > 0.5) ? 1.0 : 0.0;
  float d = human(p, ph, en, st, fem, dress);
  if (uTrip > 0.001) { // the guitar break: two mirrored, delayed echoes
    for (int k = 1; k < 3; k++) { float fk = float(k); vec2 q = p; q.x = abs(q.x) - 0.3*fk*uTrip;
      d = min(d, human(q, ph - 0.15*fk, en, st, fem, dress) + 0.015*fk); }
  }
  // v4 (Oct 15): nothing of the card may show away from the figure. Some GPUs drew the whole card as a dark box: discard every
  // pixel more than a hair outside the silhouette (also catches NaN), and use smoothstep with ordered edges (reversed is undefined).
  if (!(d < 0.075)) discard;
  float m = 1.0 - smoothstep(-0.01, 0.01, d);
  float rim = exp(-abs(d) * 60.0);
  float deep = 1.0 - smoothstep(-0.07, 0.0, d);
  float smoke = noise(p * vec2(5.0, 3.5) + vec2(uSeed * 3.1, -uTime * 0.5));
  float e = 0.45 + 0.9 * uRms + 0.3 * uSub;
  vec3 L = lightAt(wp, n); float lit = clamp(dot(L, vec3(0.35)) * 2.2, 0.0, 1.0);
  if (uMode < 0.5) {
    // on the walls: a translucent ghost, dark teal smoke inside, gold glow at the edge
    vec3 body = mix(DTEAL * 2.2, TEAL * 0.9, smoke) * (0.5 + 0.5 * deep) * (0.55 + 0.45 * e);
    vec3 c = body + GOLDG * rim * (0.45 + 0.75 * e) * (0.7 + 0.3 * lit);
    alpha = uVis * clamp(m * (0.30 + 0.22 * smoke + 0.15 * lit) + rim * 0.6, 0.0, 0.8);
    if (alpha < 0.004) discard;
    return c;
  }
  // backlit against her picture: smoky dark body, warm gold rim, her picture shows through
  vec3 c = mix(vec3(0.006, 0.02, 0.022), DTEAL * 1.5, smoke * 0.6) + WARM * rim * (0.6 + 0.8 * uHer);
  alpha = uVis * clamp(m * (0.5 + 0.2 * smoke) + rim * 0.85, 0.0, 0.9);
  if (alpha < 0.004) discard;
  return c;
}`;
const dancers = [];
function dancer(seed, mode, w, h, parent) {
  // render mode (the music video) keeps the original figures; live mode gets the human silhouettes on wider cards
  if (!RENDER) w *= mode === 0 ? 3.4 / 2.6 : 1.9 / 1.5;
  const m = mat({ frag: RENDER ? DANCER : DANCER2, transparent: true, depthWrite: false, uniforms: { uSeed: { value: seed }, uMode: { value: mode }, uVis: { value: 0 }, uAspX: { value: RENDER ? 1 : (mode === 0 ? 3.4 / 2.6 : 1.9 / 1.5) } } });
  const me = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m); me.renderOrder = 2; (parent || scene).add(me); dancers.push(me); return me;
}
// wall shadows (left wall faces +x, right wall faces -x)
const wallD = [];
for (const [s, z, seed] of [[-1, 0.8, 1], [-1, -5.4, 2], [-1, -11.8, 3], [1, -1.0, 4], [1, -7.4, 5], [1, -13.6, 6], [1, -18.5, 7]]) {
  const d = dancer(seed, 0, 2.6, 4.8, s < 0 ? halfL : halfR); d.position.set(s * (HX - 0.12), 2.4, z); d.rotation.y = -s * Math.PI / 2; d.userData.base = z; wallD.push(d);
}
// backlit pair in front of her picture
const backD = [dancer(10, 1, 1.5, 2.76), dancer(11, 1, 1.5, 2.76)];
backD[0].position.set(-0.95, 1.38, -24.3); backD[1].position.set(0.95, 1.38, -24.3);

// ------------------------------------------------------------ his line: a bronze-gold trace that draws itself while he speaks
const LINE_V = `
attribute float aAmp; attribute vec3 aSide;
uniform float uProg, uFade, uLive, uHold, uLen, uPulse, uHalo, uTime, uHis; uniform float uWave[32];
varying float vU, vHead; varying vec3 vVN; varying vec3 vVP;
void main(){
  float u = uv.x; vU = u;
  float behind = max(uProg - u, 0.0) * uLen;
  float near = exp(-behind * 1.4);
  int idx = int(mod(u * uLen * 10.0, 32.0));
  float lw = uWave[idx];
  float frozen = aAmp * sin(u * uLen * 6.5 - uTime * 2.6) * 0.06 * (1.0 - uHold);
  vec3 p = position + aSide * (frozen + lw * (uHis * near * 0.16 + uLive * 0.22));
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vec4 mv = viewMatrix * wp; vVP = mv.xyz; vVN = normalize(normalMatrix * normal);
  vHead = near;
  gl_Position = projectionMatrix * mv;
}`;
const LINE_F = `
uniform float uProg, uFade, uPulse, uHalo, uHis, uSplit;
varying float vU, vHead; varying vec3 vVN; varying vec3 vVP;
void main(){
  if (vU > uProg) discard;
  vec3 bronze = vec3(0.95, 0.66, 0.32), gold = vec3(1.0, 0.86, 0.55);
  float f = abs(dot(normalize(vVN), normalize(-vVP)));
  vec3 c = bronze * (0.75 + 0.5 * uPulse) + gold * vHead * (0.6 + 1.6 * uHis);
  float a = uFade;
  if (uHalo > 0.5) a *= pow(f, 3.0) * (0.10 + 0.2 * vHead + 0.12 * uPulse);
  else c *= 0.8 + 0.4 * f;
  c = pow(1.0 - exp(-c * 1.5), vec3(0.4545));
  gl_FragColor = vec4(c * a, a);
}`;
const lines = BS.lines = [];
const waveU = { value: new Array(32).fill(0) };
function makeLine(pts, def) {
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  const segs = Math.max(60, Math.min(520, Math.round(curve.getLength() * 26)));
  const grp = new THREE.Group(); scene.add(grp);
  const L = curve.getLength();
  const frames = curve.computeFrenetFrames(segs, false);
  const mk = (radius, halo) => {
    const g = new THREE.TubeGeometry(curve, segs, radius, halo ? 5 : 5, false);
    const nv = g.attributes.position.count, rs = (halo ? 5 : 5) + 1;
    const amp = new Float32Array(nv), side = new Float32Array(nv * 3);
    for (let i = 0; i <= segs; i++) {
      const u = i / segs, tt = progTime(def.prog, u), a = tt === null ? 0 : fAvg(tt, 7, 0.15);
      const b = frames.binormals[i];
      for (let j = 0; j < rs; j++) { const v = i * rs + j; amp[v] = a; side[v * 3] = b.x; side[v * 3 + 1] = b.y; side[v * 3 + 2] = b.z; }
    }
    g.setAttribute('aAmp', new THREE.BufferAttribute(amp, 1)); g.setAttribute('aSide', new THREE.BufferAttribute(side, 3));
    const m = new THREE.ShaderMaterial({ vertexShader: LINE_V, fragmentShader: LINE_F, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: U.uTime, uHis: U.uHis, uSplit: U.uSplit, uWave: waveU, uProg: { value: 0 }, uFade: { value: 0 }, uLive: { value: 0 }, uHold: { value: 0 }, uLen: { value: L }, uPulse: { value: 0 }, uHalo: { value: halo ? 1 : 0 } } });
    const me = new THREE.Mesh(g, m); me.frustumCulled = false; grp.add(me); return m;
  };
  const core = mk(def.r || 0.016, false), halo = mk((def.r || 0.016) * 4.5, true);
  return { curve, grp, mats: [core, halo], L, def };
}
// the time at which the line reached point u (inverse of its progress keys)
function progTime(keys, u) {
  for (let i = 1; i < keys.length; i++) { const [t0, p0] = keys[i - 1], [t1, p1] = keys[i]; if (u >= p0 && u <= p1 && p1 > p0) return t0 + (t1 - t0) * (u - p0) / (p1 - p0); }
  return null;
}
function progAt(keys, t) {
  if (t <= keys[0][0]) return 0;
  for (let i = 1; i < keys.length; i++) { const [t0, p0] = keys[i - 1], [t1, p1] = keys[i]; if (t <= t1) { const a = (t - t0) / (t1 - t0); return p0 + (p1 - p0) * (a * 0.7 + sm(a) * 0.3); } }
  return keys[keys.length - 1][1];
}
function fadeAt(f, t) { // f: [[t, v], ...]
  if (t <= f[0][0]) return f[0][1];
  for (let i = 1; i < f.length; i++) if (t <= f[i][0]) return lerp(f[i - 1][1], f[i][1], sm((t - f[i - 1][0]) / (f[i][0] - f[i - 1][0])));
  return f[f.length - 1][1];
}
// shapes, in the anchor's frame: x right, y up, z ahead (metres)
function rnd(s) { return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; }
function wanderPts(ctrl, seed, wob) {
  const r = rnd(seed), out = [];
  for (const c of ctrl) out.push([c[0] + (r() - 0.5) * wob, c[1] + (r() - 0.5) * wob * 0.6, c[2] + (r() - 0.5) * wob]);
  return out;
}
function spiral(cx, cy, cz, r0, r1, turns, n, dir, a0) {
  const o = []; for (let i = 0; i <= n; i++) { const f = i / n, a = (a0 || 0) + dir * f * turns * Math.PI * 2, r = lerp(r0, r1, f); o.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r, cz + Math.sin(f * 3.1) * 0.05]); } return o;
}
const SHAPES = {
  // "You asked me what I noticed": across the dark, ending curled back on itself on "another question"
  t1: () => wanderPts([[-3.6, 1.5, 3.6], [-2.8, 2.2, 3.3], [-2.0, 1.8, 3.9], [-1.2, 2.4, 3.4], [-0.5, 1.7, 3.1], [0.3, 2.2, 3.6], [1.0, 1.6, 3.3], [1.7, 2.1, 3.0], [2.2, 1.9, 3.4]], 7, 0.25)
        .concat(spiral(2.05, 1.95, 3.3, 0.55, 0.06, 1.6, 26, 1, -0.2)),
  // "You have this way of wandering": loops and detours all around you, then holds still
  t2: () => { const o = []; for (let i = 0; i <= 64; i++) { const f = i / 64, a = 0.7 + f * Math.PI * 2 * 1.35; const r = 1.9 + 0.6 * Math.sin(f * 17.0) + 0.3 * Math.sin(f * 41.0);
      let x = Math.sin(a) * r, z = Math.cos(a) * r, y = 2.1 + 0.6 * Math.sin(f * 9.0) + 0.35 * Math.sin(f * 23.0);
      if (f > 0.22 && f < 0.3) { const k = (f - 0.22) / 0.08 * Math.PI * 2; x += Math.cos(k) * 0.35; y += Math.sin(k) * 0.35; }
      if (f > 0.55 && f < 0.64) { const k = (f - 0.55) / 0.09 * Math.PI * 2; z += Math.cos(k) * 0.4; y += Math.sin(k) * 0.4; }
      o.push([x, y, z]); } return o; },
  // "Sometimes you disappear into an idea": a slow wander away into the dark ahead
  t3a: () => wanderPts([[-0.6, 1.3, 1.6], [0.4, 1.9, 2.6], [-0.4, 2.4, 3.8], [0.6, 1.8, 5.0], [0.1, 2.6, 6.2], [-0.8, 2.0, 7.4], [0.3, 2.2, 8.6]], 11, 0.3),
  // "A sound." the line becomes a waveform
  t3b: () => { const o = []; for (let i = 0; i <= 40; i++) { const f = i / 40; o.push([-2.9 + f * 2.6, 1.75 + Math.sin(f * 30) * 0.04, 2.7]); } return o; },
  // "An image." it traces a shape: the profile of her bird mask, headphones and all
  t3c: () => [[-0.55, 0.0], [-0.5, 0.32], [-0.32, 0.5], [-0.05, 0.53], [0.16, 0.42], [0.28, 0.27], [0.5, 0.12], [0.8, -0.02], [0.52, -0.07], [0.3, -0.1], [0.18, -0.2], [0.04, -0.36], [-0.04, -0.6],
        [-0.2, -0.62], [-0.32, -0.4], [-0.5, -0.2], [-0.62, 0.05], [-0.58, 0.4], [-0.35, 0.68], [-0.02, 0.74], [0.16, 0.64], [0.12, 0.3], [0.06, 0.24], [0.09, 0.19], [0.13, 0.23]]
        .map(p => [p[0] * 1.1, 1.85 + p[1] * 1.1, 3.0]),
  // "A question about a question." (stranger than a question mark): a doorway with a doorway inside it, and another, all the way down
  t3d: () => { const o = []; let w = 1.25, h = 2.0, z = 2.8, y0 = 0.7;
      for (let k = 0; k < 6; k++) { const hw = w / 2, sh = h - hw;
        o.push([-hw, y0, z], [-hw, y0 + sh * 0.5, z], [-hw, y0 + sh, z]);
        for (let j = 1; j < 10; j++) { const a = Math.PI - j / 10 * Math.PI; o.push([Math.cos(a) * hw, y0 + sh + Math.sin(a) * hw, z]); }
        o.push([hw, y0 + sh, z], [hw, y0 + sh * 0.5, z], [hw, y0, z]);
        const nw = w * 0.62; o.push([hw * 0.4, y0 + 0.02, z + 0.12], [-nw / 2, y0 + 0.04 + (h * 0.62) * 0.0, z + 0.22]);
        w = nw; h *= 0.62; z += 0.25; y0 += h * 0.25; }
      o.push([0, y0 + h * 0.3, z + 0.1]); return o; },
  // "just when I think I understand where we're going" straight ahead... "you laugh and change direction": a hard turn
  t3e: () => [[0.0, 1.35, 0.8], [0.05, 1.4, 2.2], [-0.02, 1.45, 3.8], [0.04, 1.5, 5.4], [0.0, 1.55, 6.8], [0.02, 1.58, 7.6], [0.9, 2.5, 7.7], [2.2, 3.6, 7.6], [3.4, 4.4, 7.4]],
  // "So... what shall we explore next?": an open spiral, unfinished
  t8: () => spiral(0, 0, 0, 0.08, 0.7, 1.7, 40, -1, 0).map(p => [p[0] - 0.2, 2.2 + p[1], 1.8])
};
// world-fixed paths: her light chasing along the right wall (and his line one step behind), the reach toward the door, the merge
function lightPath(s) { // s 0..1 along the right wall, toward the door
  const z = lerp(-5.0, -18.2, s), y = 2.1 + 0.55 * Math.sin(s * 11.0) + 0.25 * Math.sin(s * 27.0), x = HX - 0.9 - 0.4 * Math.sin(s * 7.0);
  return [x, y, z];
}
const LP = { a: S.map, b: 154.6 }; // her light runs the path during the map verse and "I know"
const LINE_DEFS = [
  { id: 't1', anchor: S.sp1, shape: 't1', prog: [[26.8, 0], [29.42, 0.3], [30.46, 0.33], [31.76, 0.5], [33.84, 0.6], [34.68, 0.62], [36.54, 0.84], [37.4, 1.0]], fade: [[26.7, 1], [41, 1], [47, 0]] },
  { id: 't2', anchor: S.sp2, shape: 't2', prog: [[59.72, 0], [63.4, 0.42], [65.46, 0.45], [68.58, 0.86], [70.46, 0.88], [71.32, 0.9]], fade: [[59.6, 1], [94, 1], [100, 0.5], [108, 0]], hold: [70.46, 999], pulse: [73.78, 96] },
  { id: 't3a', anchor: S.sp3, shape: 't3a', prog: [[116.36, 0], [118.3, 0.3], [119.26, 0.32], [121.86, 0.7], [123.16, 0.72], [125.3, 1]], fade: [[116.3, 1], [125.4, 1], [126.4, 0.3], [131, 0]] },
  { id: 't3b', anchor: S.sp3, shape: 't3b', prog: [[125.42, 0], [126.2, 1]], fade: [[125.4, 1], [129.5, 1], [132, 0]], live: [125.42, 127.2] },
  { id: 't3c', anchor: S.sp3, shape: 't3c', prog: [[126.94, 0], [127.72, 1]], fade: [[126.9, 1], [130, 1], [133, 0]] },
  { id: 't3d', anchor: S.sp3, shape: 't3d', side: 1, prog: [[127.86, 0], [128.74, 0.72], [129.7, 1]], fade: [[127.8, 1], [133, 1], [137, 0]] },
  { id: 't3e', anchor: S.sp3, shape: 't3e', prog: [[130.16, 0], [133.28, 0.62], [134.28, 0.66], [134.9, 0.7], [135.3, 0.84], [135.9, 1.0]], fade: [[130.1, 1], [139, 1], [144, 0]] },
  { id: 't4', world: () => { const o = []; for (let i = 0; i <= 40; i++) o.push(lightPath(lerp(0.66, 1.0, i / 40)).map((v, k) => k === 0 ? v - 0.35 : v)); return o; },
    prog: [[150.32, 0], [154.6, 1.0]], lag: 0.9, fade: [[150.3, 1], [158, 1], [163, 0]] },
  { id: 't5', anchor: S.sp5, worldEnd: [0.15, 2.45, -20.9], prog: [[189.9, 0], [193.62, 0.66], [194.08, 0.66], [196.56, 0.76], [197.1, 0.76], [202.0, 0.92], [203.88, 1.0]], fade: [[189.8, 1], [222, 1], [226, 0.4], [232, 0]] },
  { id: 't6a', world: () => spiral(-1.15, 2.9, -21.0, 0.5, 0.15, 0.9, 18, 1, 3.6), prog: [[209.94, 0], [210.98, 1]], fade: [[209.9, 1], [222, 1], [226, 0]] },
  { id: 't6b', world: () => spiral(1.15, 2.5, -21.0, 0.5, 0.15, 0.9, 18, -1, -0.4), prog: [[216.44, 0], [217.0, 1]], fade: [[216.4, 1], [222, 1], [226, 0]] },
  { id: 't7', world: () => { const o = [[0.15, 2.45, -20.9], [0.0, 2.7, -21.8], [-0.3, 3.0, -22.6]]; for (let i = 0; i <= 30; i++) { const f = i / 30, a = f * Math.PI * 4.0; o.push([Math.cos(a) * (0.8 - 0.5 * f), 3.2 + Math.sin(a) * (0.8 - 0.5 * f), -23.0 - f * 3.4]); } return o; },
    prog: [[222.46, 0], [224.96, 0.3], [226.14, 0.55], [229.6, 1.0]], fade: [[222.4, 1], [250, 1], [262, 0.6], [268.7, 0.6]], r: 0.02 },
  { id: 't8', anchorWorld: [0, -21.5, 0], shape: 't8', prog: [[242.58, 0], [243.5, 0.32], [244.68, 0.34], [246.32, 1.0]], fade: [[242.5, 1], [262, 0.8], [268.7, 0.7]] }
];
function toWorld(a, p) { // anchor {x,z,yaw}: yaw 0 looks toward -z
  const fx = -Math.sin(a.yaw), fz = -Math.cos(a.yaw), rx = Math.cos(a.yaw), rz = -Math.sin(a.yaw);
  return new THREE.Vector3(a.x + rx * p[0] + fx * p[2], p[1], a.z + rz * p[0] + fz * p[2]);
}
// keep traces inside the room before it opens
function keepIn(v) { v.x = clamp(v.x, -HX + 0.5, HX - 0.5); v.z = clamp(v.z, HZ1 + 0.5, HZ0 - 0.6); v.y = clamp(v.y, 0.35, HY - 0.5); return v; }
const built = {};
function buildLine(def, anchor) {
  let pts;
  if (def.world) pts = def.world().map(p => new THREE.Vector3(p[0], p[1], p[2]));
  else if (def.worldEnd) { // from where you stand toward the doorway, wandering a little, ending at the light's edge
    const a = new THREE.Vector3(anchor.x + 0.6, 1.5, anchor.z - 0.8), b = new THREE.Vector3(...def.worldEnd); pts = [];
    for (let i = 0; i <= 12; i++) { const f = i / 12, v = a.clone().lerp(b, f); v.x += Math.sin(f * 9.0) * 0.6 * (1 - f); v.y += Math.sin(f * 6.0 + 1.0) * 0.5 * (1 - f) + f * 0.4; pts.push(keepIn(v)); }
  } else if (def.anchorWorld) { pts = SHAPES[def.shape]().map(p => new THREE.Vector3(p[0] + def.anchorWorld[0], p[1], p[2] + def.anchorWorld[1] - 1.8)); }
  else pts = SHAPES[def.shape]().map(p => keepIn(toWorld(anchor, p)));
  const ln = makeLine(pts, def); ln.anchor = anchor; built[def.id] = ln; lines.push(ln); return ln;
}
function removeLine(id) { const ln = built[id]; if (!ln) return; scene.remove(ln.grp); ln.grp.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); lines.splice(lines.indexOf(ln), 1); delete built[id]; }
BS.resetLines = () => { for (const id of Object.keys(built)) removeLine(id); };

// ------------------------------------------------------------ the video's camera (render mode): a slow first-person walk with three hard cuts
const CAM = [
  // [t, pos, look, cut]
  [-6.5, [0, 1.62, 13.2], [0, 1.45, 4]], [-3, [0, 1.62, 11.0], [0, 1.5, 2]], [0, [0, 1.62, 8.05], [0, 1.75, -10]], [3.2, [0, 1.62, 6.9], [0, 1.9, -22]],
  [14, [0, 1.61, 4.3], [0, 2.1, -22]], [24, [0, 1.6, 2.3], [0, 2.2, -22]], [26.8, [0, 1.6, 1.9], [-0.6, 2.0, -6]], [29.5, [0, 1.6, 1.75], [-1.6, 1.95, -2]],
  [33, [0, 1.6, 1.6], [0.2, 1.95, -2]], [37.2, [0.1, 1.6, 1.5], [1.9, 1.9, -1.8]], [41.5, [-1.2, 1.6, 0.4], [-5.9, 2.4, -3.5]],
  [48, [-2.2, 1.6, -1.6], [-5.9, 2.5, -5.4]], [53.5, [-2.6, 1.6, -3.4], [-5.9, 2.4, -7.2]], [57, [-1.9, 1.6, -4.3], [-0.6, 2.5, -22]],
  [59.6, [-1.0, 1.6, -4.9], [0, 2.5, -22]], [62.5, [-0.8, 1.6, -5.1], [2.4, 2.6, -8.5]], [66.2, [-0.7, 1.6, -5.2], [-2.6, 2.9, -8.2]],
  [69.5, [-0.6, 1.6, -5.3], [0.6, 2.4, -9.5]], [73.5, [-0.5, 1.6, -5.5], [0, 1.9, -12]], [79, [-0.3, 1.6, -6.3], [0, 1.0, -13]],
  [86, [0, 1.6, -7.4], [0, 2.2, -22]], [95.5, [0.3, 1.6, -8.8], [0.4, 2.0, -22]], [100.5, [1.4, 1.6, -9.8], [5.9, 2.6, -11.2]],
  [106, [1.9, 1.6, -11.0], [-5.9, 3.0, -12.8]], [111.5, [1.0, 1.6, -11.8], [0.2, 5.5, -16]], [116.2, [0.5, 1.6, -12.1], [0.4, 2.1, -22]],
  [125.4, [0.5, 1.6, -12.5], [0.4, 2.0, -22]],
  [125.42, [-2.6, 1.55, -13.1], [-1.1, 1.75, -14.8], 1], [126.93, [-2.5, 1.55, -13.15], [-1.1, 1.75, -14.8]],
  [126.94, [0.5, 1.85, -13.25], [0.5, 1.85, -15.2], 1], [127.85, [0.5, 1.85, -13.35], [0.5, 1.85, -15.2]],
  [127.86, [0.5, 1.45, -12.9], [0.5, 1.45, -15.4], 1], [130.15, [0.5, 1.45, -13.4], [0.5, 1.30, -15.6]],
  [130.16, [0.5, 1.6, -11.6], [0.5, 1.9, -22], 1], [135.4, [0.5, 1.6, -12.0], [0.9, 2.4, -22]], [138, [0.8, 1.6, -11.8], [5.9, 2.2, -7.6]],
  [144, [1.0, 1.6, -12.0], [5.9, 2.1, -11.5]], [150, [1.2, 1.6, -12.3], [5.9, 2.1, -15.2]], [154.6, [1.2, 1.6, -12.6], [5.4, 2.1, -18.5]],
  [159, [0.6, 1.6, -13.2], [0, 2.3, -22]], [167, [0.2, 1.6, -14.8], [0, 2.4, -22]], [178.3, [0, 1.6, -15.8], [0, 2.4, -22]],
  [182.5, [0, 1.6, -15.9], [-0.5, 2.6, -22]], [185.5, [0, 1.6, -16.0], [-5.9, 3.2, -15]], [188.5, [0, 1.6, -16.1], [-2.5, 3.6, -21]],
  [190, [0, 1.6, -16.1], [0, 2.3, -22]], [196, [0.1, 1.6, -16.6], [0, 2.3, -22]], [204, [0, 1.6, -17.2], [0, 2.4, -22]],
  [212, [0, 1.6, -17.7], [0, 2.5, -22]], [222.4, [0, 1.6, -18.3], [0, 2.6, -22]], [226.5, [0, 1.65, -18.1], [0, 2.9, -26]],
  [231.5, [0, 1.7, -17.6], [0, 3.4, -27]], [246, [0, 1.7, -18.6], [0, 3.0, -27]], [262, [0, 1.7, -19.4], [0, 3.1, -27]], [275, [0, 1.7, -19.7], [0, 3.1, -27]]
];
function cr(p0, p1, p2, p3, u) { const u2 = u * u, u3 = u2 * u; return 0.5 * ((2 * p1) + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 + (-p0 + 3 * p1 - 3 * p2 + p3) * u3); }
function camAt(t) {
  let i = 0; while (i < CAM.length - 2 && t > CAM[i + 1][0]) i++;
  const k = CAM, a = k[i], b = k[i + 1];
  const u = clamp((t - a[0]) / (b[0] - a[0]), 0, 1);
  const prev = (i > 0 && !a[3]) ? k[i - 1] : a, next = (i + 2 < k.length && !k[i + 2][3]) ? k[i + 2] : b;
  if (b[3]) return { p: a[1].slice(), l: a[2].slice() };
  const p = [0, 1, 2].map(j => cr(prev[1][j], a[1][j], b[1][j], next[1][j], u));
  const l = [0, 1, 2].map(j => cr(prev[2][j], a[2][j], b[2][j], next[2][j], u));
  return { p, l };
}
BS.camAt = camAt;
function anchorFromCam(t) { const c = camAt(t); return { x: c.p[0], z: c.p[2], yaw: Math.atan2(-(c.l[0] - c.p[0]), -(c.l[2] - c.p[2])) }; }

// ------------------------------------------------------------ live mode: gold music symbols floating through the hall
// 90 camera-facing cards in ONE instanced draw call (180 triangles). Every card's path is computed in the vertex shader from
// time, so the CPU does nothing per frame. They rise slowly, sway, turn, and every few seconds one symbol fades into another.
// Only built in live mode; the music video never sees them.
let floatSyms = null;
if (!RENDER) {
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 256; const g = cv.getContext('2d');
  g.strokeStyle = g.fillStyle = '#fff'; g.lineCap = 'round'; g.lineJoin = 'round';
  const head = (x, y, open) => { g.save(); g.translate(x, y); g.rotate(-0.45); g.beginPath(); g.ellipse(0, 0, 13, 9, 0, 0, 6.2832); if (open) { g.lineWidth = 4; g.stroke(); } else g.fill(); g.restore(); };
  const line = (x1, y1, x2, y2, w) => { g.lineWidth = w; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); };
  const draws = [
    () => { head(56, 92, false); line(68, 90, 68, 30, 4); },                                                     // quarter
    () => { head(56, 92, false); line(68, 90, 68, 28, 4); g.lineWidth = 5; g.beginPath(); g.moveTo(68, 28); g.bezierCurveTo(78, 44, 96, 50, 88, 74); g.stroke(); }, // eighth
    () => { head(40, 96, false); head(86, 88, false); line(52, 94, 52, 34, 4); line(98, 86, 98, 28, 4); line(52, 34, 98, 28, 9); },  // beamed
    () => { g.lineWidth = 5; g.beginPath(); g.moveTo(66, 112); g.bezierCurveTo(50, 116, 48, 100, 60, 98); g.moveTo(62, 112); g.lineTo(70, 22);
            g.bezierCurveTo(88, 34, 78, 56, 52, 72); g.bezierCurveTo(34, 86, 46, 104, 66, 100); g.bezierCurveTo(86, 96, 86, 74, 66, 74); g.bezierCurveTo(52, 76, 54, 90, 64, 88); g.stroke(); }, // treble clef
    () => { g.lineWidth = 6; g.beginPath(); g.moveTo(40, 52); g.bezierCurveTo(48, 28, 92, 30, 88, 60); g.bezierCurveTo(86, 84, 60, 98, 38, 106); g.stroke();
            g.beginPath(); g.arc(42, 54, 7, 0, 6.3); g.fill(); g.beginPath(); g.arc(102, 46, 4.5, 0, 6.3); g.fill(); g.beginPath(); g.arc(102, 66, 4.5, 0, 6.3); g.fill(); }, // bass clef
    () => { line(54, 28, 54, 100, 4); line(74, 24, 74, 96, 4); line(40, 56, 88, 46, 8); line(40, 80, 88, 70, 8); },   // sharp
    () => { line(52, 22, 52, 102, 4); g.lineWidth = 5; g.beginPath(); g.moveTo(52, 102); g.bezierCurveTo(90, 86, 84, 60, 52, 76); g.stroke(); }, // flat
    () => { head(56, 92, true); line(68, 90, 68, 30, 4); }                                                       // half note
  ];
  g.shadowColor = '#fff'; g.shadowBlur = 10;
  draws.forEach((f, i) => { g.save(); g.translate((i % 4) * 128, Math.floor(i / 4) * 128); f(); f(); g.restore(); });
  const tex = new THREE.CanvasTexture(cv); tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter;
  const N = 90, base = new THREE.PlaneGeometry(1, 1), geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index; geo.setAttribute('position', base.getAttribute('position')); geo.setAttribute('uv', base.getAttribute('uv'));
  const a = new Float32Array(N * 4); let r = 7.31;
  const rnd = () => (r = (r * 9301 + 49297) % 233280) / 233280;
  for (let i = 0; i < N; i++) { a[i * 4] = (rnd() * 2 - 1) * 4.6; a[i * 4 + 1] = rnd() * 6.0; a[i * 4 + 2] = 6 - rnd() * 27; a[i * 4 + 3] = rnd(); }
  geo.setAttribute('aP', new THREE.InstancedBufferAttribute(a, 4)); geo.instanceCount = N;
  const m = new THREE.ShaderMaterial({
    uniforms: { uTime: U.uTime, uSig: U.uSig, uRms: U.uRms, uSub: U.uSub, uSplit: U.uSplit, uTex: { value: tex } },
    vertexShader: `attribute vec4 aP; uniform float uTime, uSig, uRms, uSub, uSplit; varying vec2 vUv; varying float vA, vK0, vK1, vF;
float hh(float x){ return fract(sin(x * 12.9898) * 43758.5453); }
void main(){
  float s = aP.w, sp = 0.09 + 0.08 * fract(s * 7.3);
  float y = 0.8 + mod(aP.y + uTime * sp, 6.0);
  vec3 c = vec3(aP.x + 0.7 * sin(uTime * 0.21 + s * 6.28), y, aP.z + 0.9 * cos(uTime * 0.17 + s * 4.0));
  c.x += sign(c.x) * uSplit * 2.0;
  float ph = uTime * 0.09 + s * 13.0, i0 = floor(ph);
  vK0 = floor(hh(i0 + s * 91.0) * 8.0); vK1 = floor(hh(i0 + 1.0 + s * 91.0) * 8.0); vF = smoothstep(0.7, 1.0, fract(ph));
  float fade = smoothstep(0.8, 1.7, y) * smoothstep(6.8, 5.9, y);
  float size = (0.32 + 0.26 * fract(s * 3.1)) * (1.0 + 0.3 * uSub);
  vec4 mv = modelViewMatrix * vec4(c, 1.0);
  float ang = sin(uTime * 0.3 + s * 5.0) * 0.45;
  vec2 o = position.xy * size; mv.xy += vec2(cos(ang) * o.x - sin(ang) * o.y, sin(ang) * o.x + cos(ang) * o.y);
  float dist = length(mv.xyz);
  vA = fade * uSig * (0.3 + 1.0 * uRms + 0.35 * uSub) * (0.55 + 0.45 * sin(uTime * 1.3 + s * 20.0)) * smoothstep(0.5, 1.4, dist) * exp(-dist * 0.035);
  vUv = uv; gl_Position = projectionMatrix * mv;
}`,
    fragmentShader: `uniform sampler2D uTex; varying vec2 vUv; varying float vA, vK0, vK1, vF;
vec2 cellUv(float k){ return (vec2(mod(k, 4.0), 1.0 - floor(k / 4.0)) + vUv) * vec2(0.25, 0.5); }
void main(){
  if (vA < 0.003) discard;
  float t = mix(texture2D(uTex, cellUv(vK0)).a, texture2D(uTex, cellUv(vK1)).a, vF);
  gl_FragColor = vec4(vec3(1.0, 0.74, 0.32) * t * vA * 1.6, 1.0);
}`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
  });
  floatSyms = new THREE.Mesh(geo, m); floatSyms.frustumCulled = false; floatSyms.renderOrder = 5; scene.add(floatSyms);
}

// ------------------------------------------------------------ the score: every uniform as a function of song time
const tmpV = new THREE.Vector3();
let lastT = -99;
BS.viewer = { x: 0, z: 12, yaw: 0 };    // app.js keeps this updated with the player (live mode)
BS.update = function (t, clock) {
  U.uT.value = t; U.uTime.value = clock;
  const on = t >= 0 && t < S.END + 0.5;
  const rms = on ? fv(t, 0) : 0, sub = on ? fv(t, 1) : 0, hi = on ? fv(t, 4) : 0, her = on ? fv(t, 6) : 0, his = on ? fv(t, 7) : 0;
  const herS = on ? fAvg(t, 6, 0.25) : 0, rmsS = on ? fAvg(t, 0, 0.3) : 0;
  U.uRms.value = rmsS; U.uSub.value = sub; U.uHi.value = hi; U.uHer.value = herS; U.uHis.value = his;
  for (let j = 0; j < 32; j++) waveU.value[j] = on ? (FEAT.A ? (FEAT.A[Math.min(FEAT.n - 1, Math.floor(t * 24)) * 40 + 8 + j] - 128) / 127 : 0) : 0;
  // ---- structure envelopes
  const trip = env(t, S.inst + 0.5, S.instLast + 2.4, 4.0, 2.4);
  const leave = env(t, S.sp3, S.map + 1.5, 2.6, 2.5);                    // her light leaves during his verse
  const bridgeDark = env(t, S.bridge, S.fch + 0.8, 1.6, 1.6);
  const reveal = up(t, S.place, 3.2) * (1 - up(t, S.opening, 4.0) * 0.5) * (1 - up(t, S.outro + 2, 10) * 0.6) * (t < S.END + 1 ? 1 : 0);
  const split = sm((t - S.opening) / (S.two + 1.5 - S.opening));
  U.uSig.value = RENDER ? 0 : (t >= 0 && t < S.END + 0.5 ? up(t, 0, 6) : 0) * (1 - 0.55 * bridgeDark);
  if (floatSyms) floatSyms.visible = U.uSig.value > 0.002;
  if (!RENDER) U.uCeil.value = (0.75 + 0.6 * U.uRms.value) * (1 - 0.5 * bridgeDark) + 0.25 * split;
  U.uTrip.value = trip; U.uReveal.value = reveal * (1 - 0.45 * up(t, S.fch, 3)); U.uDark.value = bridgeDark; U.uSplit.value = split;
  U.uPatina.value = sm((t - S.v1 + 0.5) / 14.0) * (1 - 0.0);
  // ---- the far door: ajar, a fraction wider on "slow", wide on the choruses, gone when the room opens
  let door = 0.06 + 0.10 * up(t, S.slow, 3.4) + 0.22 * up(t, S.wide1, 2.8) + 0.25 * up(t, S.wide2, 2.6) + 0.37 * up(t, S.opening - 0.6, 3.0);
  door = clamp(door, 0, 1);
  for (const h of BS.leaves) h.rotation.y = h.userData.s * door * 1.75;
  U.uDoorW.value = Math.min(DOORW, 0.07 + (1 - Math.cos(door * 1.75)) * DOORW * 1.4);
  // ---- her light: the doorway glow, three blooms
  const herA = clamp(herS * 1.25, 0, 1);
  let dg = t < 0 ? 0.38 : 0.42 + 0.15 * hi;
  dg += 1.5 * herA * env(t, S.sing1 - 0.3, S.sp1 + 1, 0.6, 2.0);
  dg += 0.25 * up(t, S.ch1, 2) + 0.35 * up(t, S.ch2, 2);
  dg *= 1 - 0.85 * leave; dg *= 1 - 0.9 * bridgeDark; dg += bridgeDark * 0.45 * sub;
  dg += 0.5 * up(t, S.reach - 1, 2.5) * (1 - bridgeDark * 0.5) + 0.9 * split;
  // "I haven't decided yet": one flicker, like a laugh
  const fl = t > S.laugh && t < S.laugh + 0.5 ? (Math.sin((t - S.laugh) / 0.5 * Math.PI * 3) > 0.2 ? 0.35 : 1) : 1;
  dg *= fl;
  // the end: hold through the chord, cut to black when it's gone
  const black = t >= S.END - 0.05 ? 1 : 0;
  U.uDoorGlow.value = dg * (1 - black);
  U.uAmb.value = (t < 0 ? 0.6 : 1.0) * (1 - 0.85 * bridgeDark) * (1 - 0.6 * leave) * (1 + 0.8 * split) * (1 - black);
  // blooms
  const B = U.uBlob.value;
  for (const b of B) b.w = 0;
  if (t >= 0) {
    // verse 1: on the bronze panels of the left wall
    const v1 = env(t, S.v1 - 1, S.sp2 + 0.5, 1.5, 1.5);
    B[0].set(-HX + 0.9, 2.5, lerp(-0.5, -9.0, sm((t - S.v1) / 17)), (0.2 + 1.3 * herA) * v1);
    // choruses: low over the water, and on the walls
    const ch = env(t, S.ch1 - 0.5, S.inst + 2, 1.2, 2) + env(t, S.ch2 - 0.5, S.bridge + 0.5, 1.2, 1.2) * 1.1;
    const sw = t * 0.21;
    B[1].set(Math.sin(sw) * 2.6, 0.5 + 0.3 * Math.sin(sw * 2.3), lerp(-9, -15, 0.5 + 0.5 * Math.sin(sw * 0.7)), (0.25 + 1.4 * herA) * ch);
    B[2].set(-Math.sin(sw * 1.3) * 4.6, 3.0, lerp(-6, -16, 0.5 + 0.5 * Math.cos(sw * 0.5)), (0.2 + 1.0 * herA) * ch * (t > S.ch2 - 1 ? 1 : 0.5));
    // the guitar break: three lights orbit slowly
    if (trip > 0.001) for (let j = 0; j < 3; j++) { const a = t * 0.35 + j * 2.094; B[j].set(Math.cos(a) * 3.6, 1.6 + Math.sin(t * 0.5 + j) * 1.2, -11 + Math.sin(a) * 6.5, Math.max(B[j].w, (0.35 + 1.0 * rmsS) * trip)); }
    // "Well, I never promised you a map": her light plays, wandering the right wall, chasing a shadow
    const pl = env(t, S.map - 0.5, LP.b + 3.5, 1.5, 3.0);
    if (pl > 0.001) { const s = clamp((t - LP.a) / (LP.b - LP.a), 0, 1); const lp = lightPath(s); B[0].set(lp[0], lp[1], lp[2], Math.max(B[0].w, (0.7 + 2.0 * herA) * pl)); }
    // bridge: almost black, then the room turns out to be made of her light
    // final chorus: call and response; her lines bloom in the doorway, his answers leave it dimmer
    const fc = env(t, S.fch - 0.5, S.outro + 4, 1.2, 4);
    if (fc > 0.001) { const hisOn = (t > S.listen - 0.2 && t < 212.5) || (t > S.take - 0.2 && t < 218.3);
      B[1].set(0, 2.6, -20.8, (hisOn ? 0.3 : 0.5 + 1.5 * herA) * fc); B[2].set(0, 0.4, -19.5, (0.15 + 0.6 * herA) * fc); }
    // outro: warm and settled in the open doorway
    const ou = up(t, S.outro, 3) * (1 - black);
    if (ou > 0) { B[1].set(0, 2.6, -21.2, (0.6 + 0.8 * herA) * ou * fl); B[2].set(0, 0.4, -20.0, 0.3 * ou * fl); }
  }
  // ---- the beams and the floor pools
  beamFar.material.uniforms.uBeam.value = (0.55 + 1.6 * dg) * (1 - split) * (t < S.END ? 1 : 0);
  beamFar.scale.x = 0.35 + U.uDoorW.value * 1.5;
  beamIn.material.uniforms.uBeam.value = t < 0 ? 0.55 : 0.55 * (1 - up(t, 0, 6));
  poolMat.uniforms.uPool.value = t < 0 ? 0.14 : 0.14 * (1 - up(t, 0, 6));
  // ---- water sound sources
  const src = waterMat.uniforms.uSrc.value;
  src[0].set(0, -20.5, (t < S.sing1 - 1 ? 0.25 : 1.0) * (1 - 0.7 * leave));
  src[1].set(B[1].x, B[1].z, clamp(B[1].w, 0, 1.5) * 0.8);
  // ---- the room opens in two
  const sp = split, sx = sp * sp * 16 + sp * 2, rot = sp * 0.32;
  halfL.position.set(-sx, -sp * sp * 0.6, -sp * 2); halfL.rotation.y = rot; halfR.position.set(sx, -sp * sp * 0.6, -sp * 2); halfR.rotation.y = -rot;
  panel.scale.setScalar(1 + sp * 0.3); panel.position.y = 3.9 + sp * 1.5; panel.position.z = -27 - sp * 6;
  U.uFogD.value = lerp(t < 0 ? 0.075 : 0.055, 0.012, sp);
  // ---- dancers
  const dVis = clamp(env(t, S.ch1 - 1, S.inst + 4, 2, 3) + trip + env(t, S.map, LP.b + 2, 1.5, 2) + env(t, S.ch2 - 1, S.bridge + 1, 2, 2) + env(t, S.fch - 1, S.END, 2, 0.1) * 0.8 + env(t, S.v1 + 4, S.sp2 + 1, 3, 2) * 0.6, 0, 1);
  for (const d of wallD) { d.material.uniforms.uVis.value = dVis; if (!RENDER) d.visible = dVis > 0.004; }
  // during the map verse one shadow runs ahead of her light along the right wall: the shadow she chases
  const chase = wallD[5];
  if (t > S.map - 1 && t < LP.b + 3) { const s = clamp((t - LP.a) / (LP.b - LP.a), 0, 1) + 0.12; chase.position.z = lightPath(Math.min(1.08, s))[2] - 1.0; } else chase.position.z = chase.userData.base;
  const bVis = t < 0 ? 0 : clamp(0.25 + up(t, S.ch1, 3) * 0.5 + split * 0.4 + trip * 0.3 - leave * 0.7 - bridgeDark * 0.6, 0, 1) * (1 - black);
  for (const d of backD) { d.material.uniforms.uVis.value = bVis; if (!RENDER) d.visible = bVis > 0.004; }
  // ---- his line(s)
  let head = null, headW = 0;
  for (const def of LINE_DEFS) {
    const t0 = def.prog[0][0], t1 = def.fade[def.fade.length - 1][0];
    const live = t >= t0 - 0.05 && (t <= t1 || def.fade[def.fade.length - 1][1] > 0) && t < S.END - 0.05;
    if (!live) { if (built[def.id] && (t < t0 - 0.05 || t > t1 + 0.5)) removeLine(def.id); continue; }
    let ln = built[def.id];
    if (!ln) { const anc = RENDER ? anchorFromCam(def.anchor || t0) : Object.assign({}, BS.viewer); ln = buildLine(def, anc); }
    let pr = progAt(def.prog, def.lag ? t - def.lag : t);
    const fd = fadeAt(def.fade, t) * (1 - black);
    const hold = def.hold && t > def.hold[0] ? 1 : 0, pulse = def.pulse ? env(t, def.pulse[0], def.pulse[1], 1, 2) * sub : (t > S.ch2 && t < S.bridge ? sub * 0.8 : 0);
    const liv = def.live && t > def.live[0] && t < def.live[1] ? 1 - up(t, def.live[1] - 0.6, 0.6) : 0;
    for (const m of ln.mats) { const u = m.uniforms; u.uProg.value = pr; u.uFade.value = fd; u.uHold.value = hold; u.uPulse.value = pulse + (t > S.opening ? 0.5 * herA : 0); u.uLive.value = liv; }
    if (pr > 0 && pr < 1 && fd > 0.3) { ln.curve.getPointAt(clamp(pr, 0, 1), tmpV); head = tmpV.clone(); headW = fd * (0.5 + 1.5 * his); }
  }
  if (head) U.uLineHead.value.set(head.x, head.y, head.z, headW); else U.uLineHead.value.w *= 0.9;
  lastT = t;
};

// ------------------------------------------------------------ feature texture for the shaders (sound waves travel on the water and the frieze)
BS.buildFeatTex = function () {
  const n = FEAT.n, rows = Math.ceil(n / 1024), data = new Uint8Array(1024 * rows * 4);
  for (let i = 0; i < n; i++) { data[i * 4] = FEAT.A[i * 40]; data[i * 4 + 1] = FEAT.A[i * 40 + 1]; data[i * 4 + 2] = FEAT.A[i * 40 + 6]; data[i * 4 + 3] = FEAT.A[i * 40 + 7]; }
  const tx = new THREE.DataTexture(data, 1024, rows, THREE.RGBAFormat); tx.magFilter = THREE.LinearFilter; tx.minFilter = THREE.LinearFilter; tx.needsUpdate = true;
  U.uFeat.value = tx; U.uFeatN.value = n; U.uFeatRows.value = rows;
};
// placeholder so shaders compile before the features arrive
U.uFeat.value = new THREE.DataTexture(new Uint8Array(4), 1, 1, THREE.RGBAFormat); U.uFeat.value.needsUpdate = true;

// ------------------------------------------------------------ render mode: frame-exact, driven by tools/render.py
if (RENDER) {
  const PRE = BS.PRE = 6.5;   // seconds of the dark antechamber before the step through the door
  BS.ready = Promise.all([BS.loadFeat(), new Promise(r => { const c = () => BS.imgReady ? r() : setTimeout(c, 50); c(); })]).then(() => { BS.buildFeatTex(); return true; });
  BS.renderFrame = function (vt, q) {
    const t = vt - PRE;
    if (t >= S.END - 0.04) { renderer.setClearColor(0x000000, 1); renderer.clear(); return renderer.domElement.toDataURL('image/jpeg', q || 0.92); }
    const c = camAt(t);
    camera.position.set(c.p[0], c.p[1], c.p[2]); camera.lookAt(c.l[0], c.l[1], c.l[2]);
    U.uPlayer.value.set(c.p[0], 0, c.p[2]);
    BS.update(t, t + 20);
    renderer.render(scene, camera);
    return renderer.domElement.toDataURL('image/jpeg', q || 0.92);
  };
}
})();
