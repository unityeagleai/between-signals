// Between Signals: live mode. You start in the dark antechamber facing the open door; stepping through starts the song.
// WebXR (thumbsticks) or flat walk (WASD / arrows / drag / touch pads). Spatial audio by timing: the vocal stem is
// heard from his line while he speaks and from her light while she sings, with 0.3 s equal-power crossfades.
(function () {
if (window.BS && window.BS.RENDER) return;
const BS = window.BS, U = BS.U, S = BS.S, renderer = BS.renderer, scene = BS.scene, camera = BS.camera, rig = BS.rig;
const { clamp, sm, lerp } = BS.util;
const HX = 6.0, HZ0 = 8.0, HZ1 = -21.6, AW = 2.6, AZ1 = 14.2, EW = 0.75;
const PRE_T = -2.0, XF = 0.3;
const P = { x: 0, z: 12.6, yaw: 0, pitch: 0.03, eye: 1.6 };
const $ = id => document.getElementById(id);
const capEl = $('cap'), hintEl = $('hint'), statusEl = $('status'), ui = $('ui');
let state = 'idle', songT = PRE_T, clock0 = 0, endAt = 0, started = false, inVR = false, vrPending = false, rigY = 0;
let TIM = null, HAND = [], CAPS = [];
const dbg = window.__bs = { state: 'idle', t: PRE_T, cap: '', capsShown: 0, audio: 'none', mode: 'n/a', errors: [] };

// ------------------------------------------------------------ loading (small things first; the song loads when you choose a mode)
let imgOk = false;
const imgWait = new Promise(r => { const c = () => BS.imgReady ? r() : setTimeout(c, 60); c(); setTimeout(r, 8000); });
Promise.all([BS.loadFeat(), fetch(BS.asset('timing.json')).then(r => r.json()), imgWait]).then(([_, tim]) => {
  BS.buildFeatTex(); TIM = tim; CAPS = tim.captions;
  // handovers: the first window of each run of one voice
  const W = tim.his.map(w => ({ s: w[0], e: w[1], who: 1 })).concat(tim.her.map(w => ({ s: w[0], e: w[1], who: 0 }))).sort((a, b) => a.s - b.s);
  let last = -1; for (const w of W) { if (w.who !== last) HAND.push({ t: w.s, who: w.who }); last = w.who; }
  $('bWalk').disabled = false; $('bVR').disabled = !navigator.xr;
  if (navigator.xr && navigator.xr.isSessionSupported) navigator.xr.isSessionSupported('immersive-vr').then(ok => { $('bVR').disabled = !ok; if (!ok) $('bVR').title = 'No VR headset here'; }).catch(() => {});
  statusEl.textContent = BS.isHeadset ? 'Ready. Tap ENTER VR.' : 'Ready.';
  if (BS.QS.has('autostart')) startFlat();
}).catch(e => { statusEl.textContent = 'Could not load the room: ' + e; console.error(e); });

// 0 = his position, 1 = her position. Before the first handover it is hers (she sings first).
function herWeight(t) {
  let prev = 0, cur = null;
  for (let i = 0; i < HAND.length; i++) { if (HAND[i].t - XF / 2 <= t) { prev = cur ? cur.who : 0; cur = HAND[i]; } else break; }
  if (!cur) return 1;
  const f = sm((t - (cur.t - XF / 2)) / XF), a = prev === 0 ? 1 : 0, b = cur.who === 0 ? 1 : 0;
  return lerp(a, b, f);
}
function captionAt(t) { for (const c of CAPS) if (t >= c[0] && t < c[1]) return c[2]; return ''; }

// ------------------------------------------------------------ audio: two streamed MP3s (no big decode in memory)
let actx = null, inst = null, voc = null, gHis = null, gHer = null, pHis = null, pHer = null, master = null, audioOK = false;
function mkEl(name) { const a = new Audio(); a.crossOrigin = 'anonymous'; a.preload = 'auto'; a.setAttribute('playsinline', ''); a.src = BS.asset('audio/' + name); return a; }
function mkPanner() {
  const p = actx.createPanner(); p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = 3; p.rolloffFactor = 0.6; p.maxDistance = 60;
  return p;
}
function unlockAudio() {
  try {
    if (!actx) {
      const AC = window.AudioContext || window.webkitAudioContext; actx = new AC();
      inst = mkEl('instruments.mp3'); voc = mkEl('vocals.mp3');
      master = actx.createGain(); master.gain.value = 1; master.connect(actx.destination);
      const si = actx.createMediaElementSource(inst), sv = actx.createMediaElementSource(voc);
      const gi = actx.createGain(); gi.gain.value = 0.95; si.connect(gi); gi.connect(master);          // instruments: not positional
      gHis = actx.createGain(); gHer = actx.createGain(); gHis.gain.value = 0; gHer.gain.value = 1;
      pHis = mkPanner(); pHer = mkPanner();
      sv.connect(gHis); gHis.connect(pHis); pHis.connect(master);
      sv.connect(gHer); gHer.connect(pHer); pHer.connect(master);
      for (const el of [inst, voc]) { el.addEventListener('error', () => { dbg.audio = 'error'; console.warn('audio failed to load: ' + el.src); }); }
      audioOK = true; dbg.audio = 'ready';
      // prime both elements inside the click so the later start (at the door) is allowed
      master.gain.value = 0;
      Promise.all([inst, voc].map(el => el.play().then(() => { if (state !== 'song') { el.pause(); el.currentTime = 0; } }).catch(() => {}))).then(() => { master.gain.value = 1; });
    }
    if (actx.state === 'suspended') actx.resume();
  } catch (e) { console.warn('audio unavailable', e); dbg.audio = 'unavailable'; }
}
function startAudio() {
  if (!audioOK) return;
  if (actx.state === 'suspended') actx.resume();
  master.gain.cancelScheduledValues(actx.currentTime); master.gain.value = 1;
  inst.currentTime = 0; voc.currentTime = 0;
  inst.play().catch(e => console.warn('play blocked', e)); voc.play().catch(() => {});
  dbg.audio = 'playing';
}
function stopAudio() { if (!audioOK) return; inst.pause(); voc.pause(); }
let syncT = 0;
function songTime(dt) {
  const now = performance.now() / 1000; let t = now - clock0;
  if (audioOK && !inst.paused && inst.readyState >= 2) {
    const ct = inst.currentTime;
    if (Math.abs(ct - t) > 0.08) { clock0 = now - ct; t = ct; }
    if ((syncT += dt) > 0.5) { syncT = 0; if (!voc.paused && Math.abs(voc.currentTime - ct) > 0.05) voc.currentTime = ct + 0.03; if (voc.paused && ct < S.END - 1) voc.play().catch(() => {}); }
  } else if (audioOK && state === 'song' && inst.readyState < 3 && !inst.ended) {
    clock0 = now - inst.currentTime; t = inst.currentTime;   // buffering: wait with the music
  }
  return t;
}
// her position: the strongest bloom, else the far doorway. His: the head of the line, else where it last was.
const hisPos = new THREE.Vector3(-1.5, 1.8, 6), herPos = new THREE.Vector3(0, 2.6, HZ1 + 0.6), _v = new THREE.Vector3(), _h = new THREE.Vector3(), _e = new THREE.Vector3();
function placeVoice(p, target, head, dt) {
  _v.copy(target).sub(head); let d = _v.length(); if (d < 1e-3) { _v.set(0, 0, -1); d = 1; }
  _v.multiplyScalar(clamp(d, 1.5, 5.0) / d).add(head);       // keep the direction, cap the distance so the voice keeps its level
  const k = Math.min(1, dt * 5);
  const t = actx.currentTime;
  if (p.positionX) { p.positionX.setTargetAtTime(_v.x, t, 0.05); p.positionY.setTargetAtTime(_v.y, t, 0.05); p.positionZ.setTargetAtTime(_v.z, t, 0.05); }
  else p.setPosition(_v.x, _v.y, _v.z);
  return k;
}
function audioTick(t, dt, head, fwd) {
  const B = U.uBlob.value; let best = null;
  for (const b of B) if (b.w > 0.05 && (!best || b.w > best.w)) best = b;
  _e.set(0, 2.6, HZ1 + 0.6); if (best) _e.set(best.x, best.y, best.z);
  herPos.lerp(_e, Math.min(1, dt * 3));
  const lh = U.uLineHead.value; if (lh.w > 0.05) hisPos.lerp(_e.set(lh.x, lh.y, lh.z), Math.min(1, dt * 6));
  const w = state === 'song' ? herWeight(t) : 1; dbg.herW = +w.toFixed(2);
  if (!audioOK) return;
  const now = actx.currentTime;
  gHer.gain.setTargetAtTime(Math.sin(w * Math.PI / 2), now, 0.015); gHis.gain.setTargetAtTime(Math.cos(w * Math.PI / 2), now, 0.015);
  placeVoice(pHer, herPos, head, dt); placeVoice(pHis, hisPos, head, dt);
  const L = actx.listener;
  if (L.positionX) { L.positionX.setTargetAtTime(head.x, now, 0.02); L.positionY.setTargetAtTime(head.y, now, 0.02); L.positionZ.setTargetAtTime(head.z, now, 0.02); L.forwardX.setTargetAtTime(fwd.x, now, 0.02); L.forwardY.setTargetAtTime(fwd.y, now, 0.02); L.forwardZ.setTargetAtTime(fwd.z, now, 0.02); L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0; }
  else if (L.setPosition) { L.setPosition(head.x, head.y, head.z); L.setOrientation(fwd.x, fwd.y, fwd.z, 0, 1, 0); }
}

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
const _q = new THREE.Quaternion(), _fwd = new THREE.Vector3(), _eu = new THREE.Euler();
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
  audioTick(songT, dt, _h, _fwd);
  textTick(songT, dt);
  dbg.state = state; dbg.t = +songT.toFixed(2); dbg.p = [+P.x.toFixed(2), +P.z.toFixed(2)];
  if (audioOK) { dbg.instT = +inst.currentTime.toFixed(2); dbg.vocT = +voc.currentTime.toFixed(2); dbg.ctx = actx.state; }
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
