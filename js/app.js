// Between Signals: live mode. You start in the dark antechamber facing the open door; stepping through starts the song.
// WebXR (thumbsticks) or flat walk (WASD / arrows / drag / touch pads). The song is one file (the master mix), heard from a
// fixed point overhead. v2 (Oct 15): human silhouettes and the living room (gold music symbols on dark teal) are in world.js.
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

function captionAt(t) { for (const c of CAPS) if (t >= c[0] && t < c[1]) return c[2]; return ''; }

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
  const c = state === 'song' ? captionAt(t) : '';
  if (c !== lastCap) { if (c) { capEl.textContent = c; dbg.capsShown++; } capEl.style.opacity = c ? 1 : 0; lastCap = c; dbg.cap = c; }
  if (hintT > 0) { hintT -= dt; if (hintT <= 0) { hintEl.style.opacity = 0; } }
  if (inVR) drawVR(c || (hintT > 0 ? hintTxt : ''), !c);
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
  state = 'song'; clock0 = performance.now() / 1000; songT = 0; BS.resetLines(); startAudio();
  hint('', 0);
}
function resetToStart() {
  stopAudio(); state = 'pre'; songT = PRE_T; BS.resetLines(); P.x = 0; P.z = 12.6; P.yaw = 0; P.pitch = 0.03;
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
