// Between Signals: live mode. You start in the dark antechamber facing the open door; stepping through starts the song.
// WebXR (thumbsticks) or flat walk (WASD / arrows / drag / touch pads). The song is one file (the master mix), heard from a
// fixed point overhead. v2 (Oct 15): human silhouettes and the living room (gold music symbols on dark teal) are in world.js.
// v3 (Oct 15): the approved concept look. No captions: every lyric line is one gold ribbon that sways like a soundwave in
// front of you as it's sung (lyrics.json, aligned to the transcript). Constellation ceiling, concrete, cutout are in world.js.
(function () {
if (window.BS && window.BS.RENDER) return;
const BS = window.BS, U = BS.U, S = BS.S, renderer = BS.renderer, scene = BS.scene, camera = BS.camera, rig = BS.rig;
const { clamp, sm, lerp } = BS.util;
const HX = 6.0, HZ0 = 8.0, HZ1 = -21.6, AW = 2.6, AZ1 = 14.2, EW = 0.75;
const PRE_T = -2.0;
const P = { x: 0, z: 12.6, yaw: 0, pitch: 0.03, eye: 1.6 };
const $ = id => document.getElementById(id);
const capEl = $('cap'), hintEl = $('hint'), statusEl = $('status'), ui = $('ui');
let state = 'idle', songT = PRE_T, clock0 = 0, endAt = 0, started = false, inVR = false, vrPending = false, rigY = 0;
let TIM = null, CAPS = [];
const dbg = window.__bs = { state: 'idle', t: PRE_T, cap: '', capsShown: 0, audio: 'none', mode: 'n/a', errors: [] };

// ------------------------------------------------------------ loading (small things first; the song loads when you choose a mode)
let imgOk = false;
const imgWait = new Promise(r => { const c = () => BS.imgReady ? r() : setTimeout(c, 60); c(); setTimeout(r, 8000); });
Promise.all([BS.loadFeat(), fetch(BS.asset('timing.json')).then(r => r.json()), imgWait]).then(([_, tim]) => {
  BS.buildFeatTex(); TIM = tim; CAPS = tim.captions;
  $('bWalk').disabled = false; $('bVR').disabled = !navigator.xr;
  if (navigator.xr && navigator.xr.isSessionSupported) navigator.xr.isSessionSupported('immersive-vr').then(ok => { $('bVR').disabled = !ok; if (!ok) $('bVR').title = 'No VR headset here'; }).catch(() => {});
  statusEl.textContent = BS.isHeadset ? 'Ready. Tap ENTER VR.' : 'Ready.';
  if (BS.QS.has('autostart')) startFlat();
}).catch(e => { statusEl.textContent = 'Could not load the room: ' + e; console.error(e); });

function captionAt(t) { for (const c of CAPS) if (t >= c[0] && t < c[1]) return c[2]; return ''; }   // (v3: not shown any more)

// ------------------------------------------------------------ audio: ONE file, the full master mix, heard from a fixed point overhead
// v1 played two tracks (vocals + instruments) and re-seeked the vocals whenever they drifted 50 ms from the instruments;
// every re-seek dropped the voice for a moment, and the voice also swung between two moving HRTF panners. Now there is one
// element, one fixed panner straight above you that never moves, and nothing ever seeks the audio while the song plays:
// the visuals follow the music's clock, never the other way round. The whole file is downloaded once (blob) so the
// song can't stall on the network halfway through.
const SONG = 'audio/between_signals.mp3';
let actx = null, song = null, master = null, panner = null, audioOK = false, blobReady = false, blobUrl = null;
const aud = dbg.aud = { waiting: 0, stalled: 0, seeks: 0, resumes: 0, src: 'none' };
function fetchSong() {
  fetch(BS.asset(SONG)).then(r => { if (!r.ok) throw new Error(r.status); return r.blob(); }).then(b => {
    blobUrl = URL.createObjectURL(b); blobReady = true; aud.src = 'blob';
    if (song && song.paused && state !== 'song') { song.src = blobUrl; song.load(); }
  }).catch(e => { console.warn('song download failed, streaming instead', e); blobReady = true; aud.src = 'stream'; });
}
function unlockAudio() {
  try {
    if (!actx) {
      const AC = window.AudioContext || window.webkitAudioContext; actx = new AC({ latencyHint: 'playback' });
      song = new Audio(); song.crossOrigin = 'anonymous'; song.preload = 'metadata'; song.setAttribute('playsinline', ''); song.src = BS.asset(SONG); aud.src = 'stream';
      song.addEventListener('error', () => { dbg.audio = 'error'; console.warn('audio failed to load: ' + song.src); });
      song.addEventListener('waiting', () => { aud.waiting++; });
      song.addEventListener('stalled', () => { if (state === 'song') aud.stalled++; });
      song.addEventListener('seeking', () => { if (state === 'song' && song.currentTime > 0.5) aud.seeks++; });
      const src = actx.createMediaElementSource(song);
      // overhead: straight up and a touch forward, in the listener's own frame. Listener and panner are set once and never move,
      // so turning or walking can't pan the music around.
      panner = actx.createPanner(); panner.panningModel = 'HRTF'; panner.distanceModel = 'linear'; panner.refDistance = 1; panner.maxDistance = 10000; panner.rolloffFactor = 0;
      if (panner.positionX) { panner.positionX.value = 0; panner.positionY.value = 2.6; panner.positionZ.value = -0.9; } else panner.setPosition(0, 2.6, -0.9);
      const L = actx.listener;
      if (L.positionX) { L.positionX.value = 0; L.positionY.value = 0; L.positionZ.value = 0; L.forwardX.value = 0; L.forwardY.value = 0; L.forwardZ.value = -1; L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0; }
      else { L.setPosition(0, 0, 0); L.setOrientation(0, 0, -1, 0, 1, 0); }
      master = actx.createGain(); master.gain.value = 1.15;
      src.connect(panner); panner.connect(master); master.connect(actx.destination);
      actx.addEventListener('statechange', () => { if (actx.state !== 'running' && state === 'song') { aud.resumes++; actx.resume().catch(() => {}); } });
      audioOK = true; dbg.audio = 'ready';
      // prime the element inside the tap so the start at the door is allowed (muted, rewound before the song)
      song.muted = true;
      song.play().then(() => { if (state !== 'song') { song.pause(); song.currentTime = 0; } song.muted = false; }).catch(() => { song.muted = false; });
      fetchSong();
    }
    if (actx.state !== 'running') actx.resume().catch(() => {});
  } catch (e) { console.warn('audio unavailable', e); dbg.audio = 'unavailable'; }
}
function startAudio() {
  if (!audioOK) return;
  if (actx.state !== 'running') actx.resume().catch(() => {});
  if (blobUrl && song.src !== blobUrl) song.src = blobUrl;
  song.muted = false; song.currentTime = 0;
  song.play().catch(e => console.warn('play blocked', e));
  dbg.audio = 'playing';
}
// headless tests only (?test): jump the song to a time to photograph a section
if (BS.QS && BS.QS.has('test')) BS.testSeek = t => { if (audioOK) song.currentTime = t; };
if (BS.QS && BS.QS.has('test')) BS.testPose = (x, z, yaw, pitch) => { P.x = x; P.z = z; P.yaw = yaw; P.pitch = pitch; };
function stopAudio() { if (audioOK) song.pause(); }
// the song's clock: the audio element is the master. Visuals ease to it and never push it.
let lastCT = -1, lastCTAt = 0, ctxCheck = 0;
function songTime(dt) {
  const now = performance.now() / 1000; let t = now - clock0;
  if (audioOK && !song.paused && song.readyState >= 2) {
    const ct = song.currentTime;
    if (ct !== lastCT) { lastCT = ct; lastCTAt = now; }
    if (Math.abs(ct - t) > 0.08) { clock0 = now - ct; t = ct; }
  } else if (audioOK && state === 'song' && !song.ended && song.readyState < 3) {
    clock0 = now - song.currentTime; t = song.currentTime;   // buffering: the room waits with the music
  }
  if ((ctxCheck += dt) > 1 && audioOK && state === 'song') { ctxCheck = 0; if (actx.state !== 'running') { aud.resumes++; actx.resume().catch(() => {}); } if (song.paused && !song.ended && t < S.END - 1) song.play().catch(() => {}); }
  return t;
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && actx && state === 'song' && actx.state !== 'running') actx.resume().catch(() => {}); });

// ------------------------------------------------------------ captions + hints: DOM on screen, a panel under your gaze in VR
const cv = document.createElement('canvas'); cv.width = 1024; cv.height = 256; const cx = cv.getContext('2d');
const capTex = new THREE.CanvasTexture(cv); capTex.encoding = THREE.sRGBEncoding;
const capMesh = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.4), new THREE.MeshBasicMaterial({ map: capTex, transparent: true, depthTest: false, depthWrite: false, fog: false, toneMapped: false }));
capMesh.renderOrder = 999; capMesh.position.set(0, -0.42, -1.5); capMesh.rotation.x = -0.18; capMesh.visible = false; camera.add(capMesh);
let vrText = '', vrSmall = false;
function drawVR(txt, small) {
  if (txt === vrText && small === vrSmall) return; vrText = txt; vrSmall = small; cx.clearRect(0, 0, 1024, 256);
  if (txt) {
    cx.textAlign = 'center'; cx.textBaseline = 'middle'; cx.font = (small ? '44px' : '68px') + ' Georgia, serif';
    const words = txt.split(' '), lines = []; let ln = '';
    for (const w of words) { const tr = ln ? ln + ' ' + w : w; if (cx.measureText(tr).width > 960 && ln) { lines.push(ln); ln = w; } else ln = tr; } lines.push(ln);
    const lh = small ? 54 : 80, y0 = 128 - (lines.length - 1) * lh / 2;
    cx.shadowColor = 'rgba(0,0,0,0.95)'; cx.shadowBlur = 18; cx.fillStyle = small ? '#a9c2b6' : '#f6e2bb';
    lines.forEach((l, i) => { cx.fillText(l, 512, y0 + i * lh); cx.fillText(l, 512, y0 + i * lh); });
  }
  capTex.needsUpdate = true; capMesh.visible = inVR && !!txt;
}
let hintTxt = '', hintT = 0, lastCap = '';
function hint(txt, secs) { hintTxt = txt; hintT = secs || 6; hintEl.textContent = txt; hintEl.style.opacity = txt ? 1 : 0; }
function textTick(t, dt) {
  // v3: no captions on screen or under your gaze; the words live in the room as ribbons (below). Hints still show.
  if (hintT > 0) { hintT -= dt; if (hintT <= 0) { hintEl.style.opacity = 0; } }
  if (inVR) drawVR(hintT > 0 ? hintTxt : '', true);
  ribbonTick(t, dt);
}

// ------------------------------------------------------------ lyric ribbons
// One connected gold ribbon per line, ~3 m in front of you and curved around you so the ends stay as close as the middle.
// Words light up as they're sung; the ribbon sways gently (amplitude follows the music, kept small so it stays readable)
// and drifts up and away when the next line comes. Her lines sit a little higher (semibold), his a little lower (italic).
let LYR = [];
fetch(BS.asset('lyrics.json')).then(r => r.json()).then(j => { LYR = j; dbg.lyrics = j.length; }).catch(e => console.warn('lyrics', e));
if (document.fonts && document.fonts.load) { document.fonts.load('600 100px BSRibbonU'); document.fonts.load('italic 400 100px BSRibbonM'); }
const RB_W = 4096, RB_H = 256, RB_PX = 0.00102, RB_R = 3.0, RB_NW = 24;
const RIB_VS = `uniform float uTime, uAmp, uW, uH, uR, uLam;
varying vec2 vUv;
void main(){
  vUv = uv;
  float X = position.x * uW, Y = position.y * uH;
  float k = 6.2831853 / uLam;
  Y += sin(X * k - uTime * 1.5) * uAmp + sin(X * k * 2.3 + uTime * 1.1) * uAmp * 0.22;
  float dz = sin(X * k * 0.7 - uTime * 1.2 + 1.3) * uAmp * 0.8;
  float th = X / uR;
  vec3 p = vec3(sin(th) * (uR + dz), Y, uR - cos(th) * (uR + dz));
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;
const RIB_FS = `uniform sampler2D uTex; uniform float uWx[${RB_NW}], uWa[${RB_NW}]; uniform float uFade, uStaff, uK, uRms;
varying vec2 vUv;
// v4 (Oct 15): crisp gold letters with a THIN dark edge instead of the wide glow, so the words stay readable over the very
// bright screen at the end. Colour still adds light (as before); alpha darkens what is behind the letters and their thin edge
// (blend: ONE, ONE_MINUS_SRC_ALPHA). R = letters, G = thin edge mask (letters dilated a few px), B = staff lines.
void main(){
  vec4 tx = texture2D(uTex, vUv);
  float a = 0.0;
  for (int i = 0; i < ${RB_NW}; i++) { if (vUv.x >= uWx[i]) a = uWa[i]; }
  vec3 core = mix(vec3(1.0, 0.86, 0.52), vec3(0.98, 0.83, 0.56), uK);
  vec3 gold = mix(vec3(1.0, 0.72, 0.30), vec3(0.92, 0.64, 0.36), uK);
  vec3 col = core * tx.r * a + gold * tx.g * a * 0.08 + gold * tx.b * uStaff * (0.22 + 0.35 * uRms);
  float dark = max(tx.g * 0.8, tx.r * 0.92) * a;
  gl_FragColor = vec4(col * uFade, dark * uFade);
}`;
const ribbons = [];
for (let i = 0; i < 4; i++) {
  const cv2 = document.createElement('canvas'); cv2.width = RB_W; cv2.height = RB_H;
  const tex = new THREE.CanvasTexture(cv2); tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  tex.minFilter = THREE.LinearMipmapLinearFilter; tex.generateMipmaps = true;
  const uni = { uTex: { value: tex }, uTime: { value: 0 }, uAmp: { value: 0.03 }, uW: { value: 1 }, uH: { value: RB_H * RB_PX }, uR: { value: RB_R }, uLam: { value: 2.3 },
    uWx: { value: new Array(RB_NW).fill(2) }, uWa: { value: new Array(RB_NW).fill(0) }, uFade: { value: 0 }, uStaff: { value: 0 }, uK: { value: 0 }, uRms: { value: 0 } };
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, 128, 1), new THREE.ShaderMaterial({ uniforms: uni, vertexShader: RIB_VS, fragmentShader: RIB_FS,
    transparent: true, depthWrite: false, depthTest: true, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor, side: THREE.DoubleSide }));
  m.frustumCulled = false; m.renderOrder = 50; m.visible = false; scene.add(m);
  ribbons.push({ cv: cv2, cx: cv2.getContext('2d'), tex, uni, m, li: -1, wx: [], born: 0, dying: -1, ax: 0, az: 0, ay: 0, yaw: 0, lift: 0 });
}
function drawRibbon(r, L) {
  const c = r.cx; c.clearRect(0, 0, RB_W, RB_H);
  let fs = 118; const fam = L.s === 'm' ? 'italic 400 %px BSRibbonM, Georgia, serif' : '600 %px BSRibbonU, Georgia, serif';
  const words = L.text.split(' ');
  let ws, sp, tw;
  for (;;) {
    c.font = fam.replace('%', fs); sp = c.measureText(' ').width; ws = words.map(w => c.measureText(w).width);
    tw = ws.reduce((a, b) => a + b, 0) + sp * (words.length - 1);
    if (tw < RB_W - 200 || fs < 60) break; fs -= 6;
  }
  const x0 = (RB_W - tw) / 2, base = RB_H / 2 + fs * 0.33;
  const xs = []; let x = x0; for (let i = 0; i < words.length; i++) { xs.push(x); x += ws[i] + sp; }
  c.globalCompositeOperation = 'lighter'; c.textBaseline = 'alphabetic';
  // G: thin edge mask, the letters grown by a few px and barely softened (v4: was a 22 px glow that bloomed into a blob on bright light)
  c.save(); c.shadowColor = 'rgb(0,255,0)'; c.shadowBlur = 3; c.shadowOffsetX = 10000; c.fillStyle = 'rgb(0,255,0)'; c.strokeStyle = 'rgb(0,255,0)';
  c.lineWidth = Math.max(8, Math.round(fs * 0.1)); c.lineJoin = 'round';
  words.forEach((w, i) => { c.strokeText(w, xs[i] - 10000, base); c.fillText(w, xs[i] - 10000, base); }); c.restore();
  // B: two thin staff lines framing the words, fading out at the ends
  const gx0 = x0 - 120, gx1 = x0 + tw + 120, g = c.createLinearGradient(gx0, 0, gx1, 0);
  g.addColorStop(0, 'rgba(0,0,255,0)'); g.addColorStop(0.12, 'rgba(0,0,255,1)'); g.addColorStop(0.88, 'rgba(0,0,255,1)'); g.addColorStop(1, 'rgba(0,0,255,0)');
  c.fillStyle = g; c.fillRect(gx0, base - fs * 1.02, gx1 - gx0, 3); c.fillRect(gx0, base + fs * 0.36, gx1 - gx0, 3);
  // R: crisp letters
  c.fillStyle = 'rgb(255,0,0)'; words.forEach((w, i) => c.fillText(w, xs[i], base));
  r.tex.needsUpdate = true;
  r.wx = xs.map(v => v / RB_W);
  const wxu = r.uni.uWx.value; for (let i = 0; i < RB_NW; i++) wxu[i] = i < r.wx.length ? (i === 0 ? 0 : r.wx[i] - sp * 0.5 / RB_W) : 2;
  // only the used width becomes geometry, so the curve hugs the words
  r.u0 = Math.max(0, (x0 - 140) / RB_W); r.u1 = Math.min(1, (x0 + tw + 140) / RB_W);
  const gm = r.m.geometry, uv = gm.attributes.uv, pos = gm.attributes.position;
  for (let i = 0; i < uv.count; i++) { const fx = pos.getX(i) + 0.5; uv.setX(i, r.u0 + (r.u1 - r.u0) * fx); }
  uv.needsUpdate = true;
  r.uni.uW.value = (r.u1 - r.u0) * RB_W * RB_PX;
  r.uni.uK.value = L.s === 'm' ? 1 : 0;
}
const _rh = new THREE.Vector3();
function placeRibbon(r, snap, dt) {
  camera.getWorldPosition(_rh);
  const L = LYR[r.li], dy = L.s === 'm' ? -0.02 : 0.30;
  if (snap) { r.yaw = BS.viewer.yaw; r.ax = _rh.x; r.az = _rh.z; r.ay = _rh.y + dy; }
  else if (r.dying < 0) {
    let d = BS.viewer.yaw - r.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
    if (Math.abs(d) > 0.3) r.yaw += (d - Math.sign(d) * 0.3) * Math.min(1, dt * 2.0);   // lazy follow: stays put for small head turns
    const k = Math.min(1, dt * 1.6); r.ax += (_rh.x - r.ax) * k; r.az += (_rh.z - r.az) * k; r.ay += (_rh.y + dy - r.ay) * k;
  }
  const R = RB_R + r.lift * 0.6;
  r.m.position.set(r.ax - Math.sin(r.yaw) * R, r.ay + r.lift * 0.45, r.az - Math.cos(r.yaw) * R);
  r.m.rotation.set(0, r.yaw, 0);
  r.uni.uR.value = R;
}
if (BS.QS && BS.QS.has('test')) BS.ribbons = ribbons;
let nextLine = 0;
function ribbonsReset() { for (const r of ribbons) { r.m.visible = false; r.li = -1; r.dying = -1; } nextLine = 0; }
function ribbonTick(t, dt) {
  const now = performance.now() / 1000;
  if (state !== 'song' || !LYR.length) { if (ribbons.some(r => r.li >= 0)) ribbonsReset(); return; }
  if (nextLine > 0 && t < LYR[nextLine - 1].w[0] - 1.0) {   // jumped back (restart/seek): rewind
    for (const r of ribbons) { r.m.visible = false; r.li = -1; r.dying = -1; }
    nextLine = 0; while (nextLine < LYR.length && LYR[nextLine].w[0] - 0.45 <= t && LYR[nextLine].end + 1.0 < t) nextLine++;
  }
  while (nextLine < LYR.length && t >= LYR[nextLine].w[0] - 0.45) {
    const L = LYR[nextLine];
    if (t < L.end + 1.0) {
      // the previous line of the same voice drifts up and away
      for (const r of ribbons) if (r.li >= 0 && r.dying < 0 && LYR[r.li].s === L.s) r.dying = now;
      let r = ribbons.find(q => q.li < 0) || ribbons.reduce((a, b) => (a.dying >= 0 && (b.dying < 0 || a.dying < b.dying)) ? a : b);
      r.li = nextLine; r.dying = -1; r.born = now; r.lift = 0; drawRibbon(r, L); placeRibbon(r, true, dt); r.m.visible = true;
      dbg.cap = L.text; dbg.capsShown++;
    }
    nextLine++;
  }
  const rms = U.uRms.value;
  for (const r of ribbons) {
    if (r.li < 0) continue;
    const L = LYR[r.li];
    if (r.dying < 0 && t > L.end + 2.2) r.dying = now;
    let fade = clamp((t - (L.w[0] - 0.45)) / 0.45, 0, 1);
    if (r.dying >= 0) { const k = (now - r.dying) / 1.1; r.lift = k * k * 0.5 + k * 0.25; fade *= clamp(1 - k, 0, 1); if (k >= 1) { r.li = -1; r.m.visible = false; continue; } }
    const wa = r.uni.uWa.value;
    for (let i = 0; i < RB_NW; i++) wa[i] = i < L.w.length ? sm(clamp((t - L.w[i] + 0.12) / 0.3, 0, 1)) : 0;
    r.uni.uFade.value = fade; r.uni.uStaff.value = fade; r.uni.uRms.value = rms;
    r.uni.uTime.value = now; r.uni.uAmp.value = 0.018 + 0.05 * clamp(rms, 0, 1);
    placeRibbon(r, false, dt);
  }
}

// ------------------------------------------------------------ input
const keys = {};
addEventListener('keydown', e => { keys[e.code] = true; if (started && !inVR) unlockAudio(); });
addEventListener('keyup', e => { keys[e.code] = false; });
const cvs = renderer.domElement; let drag = null;
cvs.addEventListener('mousedown', e => { drag = { x: e.clientX, y: e.clientY }; unlockAudio(); });
addEventListener('mouseup', () => { drag = null; });
addEventListener('mousemove', e => { if (!drag || inVR) return; P.yaw -= (e.clientX - drag.x) * 0.004; P.pitch = clamp(P.pitch - (e.clientY - drag.y) * 0.004, -1.2, 1.2); drag.x = e.clientX; drag.y = e.clientY; });
const pads = $('pads'), stick = { id: null, x0: 0, y0: 0, mx: 0, my: 0 }, look = { id: null, x: 0, y: 0 };
const isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
$('padL').addEventListener('touchstart', e => { const t = e.changedTouches[0]; stick.id = t.identifier; stick.x0 = t.clientX; stick.y0 = t.clientY; unlockAudio(); e.preventDefault(); }, { passive: false });
$('padR').addEventListener('touchstart', e => { const t = e.changedTouches[0]; look.id = t.identifier; look.x = t.clientX; look.y = t.clientY; unlockAudio(); e.preventDefault(); }, { passive: false });
addEventListener('touchmove', e => {
  for (const t of e.changedTouches) {
    if (t.identifier === stick.id) { let dx = t.clientX - stick.x0, dy = t.clientY - stick.y0; const L = Math.hypot(dx, dy), M = 55; if (L > M) { dx *= M / L; dy *= M / L; } stick.mx = dx / M; stick.my = dy / M; }
    if (t.identifier === look.id) { P.yaw -= (t.clientX - look.x) * 0.006; P.pitch = clamp(P.pitch - (t.clientY - look.y) * 0.005, -1.2, 1.2); look.x = t.clientX; look.y = t.clientY; }
  }
}, { passive: true });
addEventListener('touchend', e => { for (const t of e.changedTouches) { if (t.identifier === stick.id) { stick.id = null; stick.mx = stick.my = 0; } if (t.identifier === look.id) look.id = null; } });
let snapReady = true;
function readXR() {
  const s = renderer.xr.getSession(); if (!s) return [0, 0];
  let mx = 0, my = 0;
  for (const src of s.inputSources) {
    const gp = src.gamepad; if (!gp) continue; const ax = gp.axes || [];
    const x = ax.length >= 4 ? ax[2] : (ax[0] || 0), y = ax.length >= 4 ? ax[3] : (ax[1] || 0);
    if (src.handedness === 'left' || (src.handedness !== 'right' && s.inputSources.length === 1)) { if (Math.abs(x) > 0.15) mx = x; if (Math.abs(y) > 0.15) my = y; }
    if (src.handedness === 'right') {
      if (Math.abs(x) > 0.7 && snapReady) { snapReady = false; P.yaw -= Math.sign(x) * Math.PI / 6; }
      if (Math.abs(x) < 0.3) snapReady = true;
      if (Math.abs(y) > 0.6 && !mx && !my) my = y * 0.8;   // right stick forward/back also walks
    }
  }
  return [mx, my];
}

// ------------------------------------------------------------ where you can walk
const PILLARS = []; for (const s of [-1, 1]) for (const z of [3.0, -3.2, -9.4, -15.6]) PILLARS.push([s * 4.2, z]);
function walkable(x, z) {
  const open = U.uSplit.value > 0.35;
  if (open && z < HZ0 - 0.4) return Math.abs(x) < 22 && z > -48;
  if (z >= 9.1) return Math.abs(x) <= AW - 0.3 && z <= AZ1 - 0.3;           // antechamber
  if (z >= 7.6) return Math.abs(x) <= EW - 0.25;                             // the entrance door
  if (z >= HZ1 + 0.6) return Math.abs(x) <= HX - 0.4;                        // the hall
  return false;
}
function move(dx, dz) {
  const nx = P.x + dx, nz = P.z + dz;
  if (walkable(nx, nz)) { P.x = nx; P.z = nz; } else if (walkable(nx, P.z)) P.x = nx; else if (walkable(P.x, nz)) P.z = nz;
  if (U.uSplit.value < 0.2) for (const [px, pz] of PILLARS) { const ddx = P.x - px, ddz = P.z - pz, d = Math.hypot(ddx, ddz), r = 0.8; if (d < r && d > 1e-4) { P.x = px + ddx / d * r; P.z = pz + ddz / d * r; } }
}

// ------------------------------------------------------------ the song's life: before the door, during, after
function startSong() {
  state = 'song'; clock0 = performance.now() / 1000; songT = 0; BS.resetLines(); ribbonsReset(); startAudio();
  hint('', 0);
}
function resetToStart() {
  stopAudio(); state = 'pre'; songT = PRE_T; BS.resetLines(); ribbonsReset(); P.x = 0; P.z = 12.6; P.yaw = 0; P.pitch = 0.03;
  hint('Walk through the door to hear it again', 8);
}

// ------------------------------------------------------------ frame
let last = performance.now(), walkS = 0, fpsAcc = 0, fpsN = 0;
const _h = new THREE.Vector3(), _q = new THREE.Quaternion(), _fwd = new THREE.Vector3(), _eu = new THREE.Euler();
function frame() {
  const now = performance.now(); let dt = (now - last) / 1000; last = now; if (dt > 0.1) dt = 0.1;
  fpsAcc += dt; fpsN++; if (fpsAcc > 1) { dbg.fps = +(fpsN / fpsAcc).toFixed(1); fpsAcc = 0; fpsN = 0; }
  let mx = 0, my = 0;
  if (inVR) [mx, my] = readXR();
  else {
    if (keys.KeyW || keys.ArrowUp) my -= 1; if (keys.KeyS || keys.ArrowDown) my += 1;
    if (keys.KeyA) mx -= 1; if (keys.KeyD) mx += 1;
    if (keys.ArrowLeft) P.yaw += 1.8 * dt; if (keys.ArrowRight) P.yaw -= 1.8 * dt;
    if (stick.id !== null) { mx = stick.mx; my = stick.my; }
  }
  let headYaw = P.yaw;
  if (inVR) { camera.getWorldQuaternion(_q); _eu.setFromQuaternion(_q, 'YXZ'); headYaw = _eu.y; }
  const L = Math.hypot(mx, my); if (L > 1) { mx /= L; my /= L; }
  const sp = inVR ? 1.5 : 2.2, ox = P.x, oz = P.z;
  if (mx || my) { const s = Math.sin(headYaw), c = Math.cos(headYaw); move((mx * c + my * s) * sp * dt, (-mx * s + my * c) * sp * dt); }
  const moved = Math.hypot(P.x - ox, P.z - oz) / Math.max(dt, 1e-3);
  walkS += (clamp(moved / 2, 0, 1) - walkS) * Math.min(1, dt * 4); U.uWalk.value = walkS;
  if (inVR) { rig.position.set(P.x, rigY, P.z); rig.rotation.set(0, P.yaw, 0); }
  else { rig.position.set(P.x, 0, P.z); rig.rotation.set(0, 0, 0); camera.position.set(0, P.eye, 0); camera.rotation.set(P.pitch, P.yaw, 0, 'YXZ'); }
  rig.updateMatrixWorld(true);
  camera.getWorldPosition(_h); camera.getWorldQuaternion(_q); _fwd.set(0, 0, -1).applyQuaternion(_q);
  U.uPlayer.value.set(_h.x, 0, _h.z);
  BS.viewer.x = _h.x; BS.viewer.z = _h.z; BS.viewer.yaw = headYaw;
  // the door starts the song
  if (state === 'pre' && (P.z < HZ0 - 0.1 || _h.z < HZ0 - 0.1)) startSong();
  if (state === 'song') {
    songT = songTime(dt);
    if (songT >= S.END) { state = 'end'; endAt = now; stopAudio(); }
  } else if (state === 'end') { songT = S.END + 0.2; if (now - endAt > 4000) resetToStart(); }
  else songT = PRE_T;
  BS.update(songT, now / 1000);
  textTick(songT, dt);
  dbg.state = state; dbg.t = +songT.toFixed(2); dbg.p = [+P.x.toFixed(2), +P.z.toFixed(2)];
  if (audioOK) { dbg.songT = +song.currentTime.toFixed(2); dbg.ctx = actx.state; dbg.paused = song.paused; }
  renderer.render(scene, camera);
}
BS.liveFrame = frame;

// ------------------------------------------------------------ modes
function begin(mode) {
  dbg.mode = mode; ui.style.display = 'none'; started = true; if (state === 'idle') state = 'pre';
  if (BS.playCeil) BS.playCeil();
  if (mode === 'flat' && isTouch) pads.style.display = 'block';
  last = performance.now();
  hint(mode === 'vr' ? 'Walk through the open door ahead' : 'Walk through the open door ahead  ·  W A S D or arrows, drag to look', 9);
}
function startFlat() { unlockAudio(); begin('flat'); renderer.setAnimationLoop(frame); }
async function enterVR() {
  if (!navigator.xr || vrPending || inVR) return;
  unlockAudio(); vrPending = true; statusEl.textContent = 'Starting VR… if the headset asks, choose Allow.';
  let session = null;
  try {
    renderer.setAnimationLoop(null);
    session = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor'] });
    session.addEventListener('select', () => unlockAudio());
    let space = 'local-floor';
    try { await session.requestReferenceSpace('local-floor'); } catch (e) { space = 'local'; }
    rigY = space === 'local' ? 1.6 : 0;   // plain 'local' space starts at the head, so lift the rig to eye height
    renderer.xr.setReferenceSpaceType(space);
    await renderer.xr.setSession(session);
    inVR = true; vrPending = false; camera.position.set(0, 0, 0); camera.rotation.set(0, 0, 0);
    session.addEventListener('end', () => { inVR = false; capMesh.visible = false; vrText = '~'; if (started) { ui.style.display = 'none'; renderer.setAnimationLoop(frame); } });
    try { if (session.updateTargetFrameRate && session.supportedFrameRates && Array.from(session.supportedFrameRates).indexOf(72) >= 0) session.updateTargetFrameRate(72).catch(() => {}); } catch (e) {}
    begin('vr'); renderer.setAnimationLoop(frame);
  } catch (e) {
    vrPending = false; try { if (session) await session.end(); } catch (er) {}
    statusEl.textContent = 'VR could not start (' + (e && e.message ? e.message : e) + '). WALK IN still works.';
    if (started) renderer.setAnimationLoop(frame);
  }
}
$('bWalk').addEventListener('click', startFlat);
$('bVR').addEventListener('click', enterVR);
// first paint of the dark room behind the title
BS.update(PRE_T, 0); rig.position.set(P.x, 0, P.z); camera.position.set(0, P.eye, 0); camera.rotation.set(P.pitch, 0, 0, 'YXZ');
try { renderer.render(scene, camera); } catch (e) { console.error(e); }
})();
