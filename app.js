const $ = (id) => document.getElementById(id);

const STORAGE = 'sloth-sound-spa:v1';

const CHANNELS = [
  { id: 'forest', name: 'Forest hush', desc: 'Soft filtered noise + distant air. Non-invasive.', color: 'rgba(123,211,137,.9)' },
  { id: 'rain', name: 'Rain veil', desc: 'Gentle rain texture (no sharp transients).', color: 'rgba(106,167,255,.9)' },
  { id: 'wave', name: 'Slow waves', desc: 'Low swell, like breathing water.', color: 'rgba(155,216,255,.9)' },
  { id: 'hammock', name: 'Hammock hum', desc: 'Warm chord bed. Cozy, not dramatic.', color: 'rgba(210,193,255,.9)' },
  { id: 'crackle', name: 'Tiny crackle', desc: 'Subtle vinyl/fire texture. Optional.', color: 'rgba(255,200,135,.9)' },
];

const PRESETS = [
  { id: 'hammock-night', name: 'Hammock Night', mix: { forest: 40, rain: 0, wave: 15, hammock: 35, crackle: 10 }, master: 45 },
  { id: 'tea-rain', name: 'Tea & Rain', mix: { forest: 15, rain: 45, wave: 0, hammock: 25, crackle: 15 }, master: 45 },
  { id: 'shoreline', name: 'Shoreline', mix: { forest: 0, rain: 10, wave: 55, hammock: 25, crackle: 10 }, master: 45 },
  { id: 'quiet-focus', name: 'Quiet Focus', mix: { forest: 50, rain: 10, wave: 0, hammock: 15, crackle: 0 }, master: 45 },
];

function clamp(n,min,max){ return Math.max(min, Math.min(max, n)); }
function pad2(n){ return String(n).padStart(2,'0'); }
function fmtSec(sec){
  if(sec <= 0) return 'off';
  const m = Math.floor(sec/60);
  const s = sec%60;
  return `${pad2(m)}:${pad2(s)}`;
}

function defaultState(){
  const mix = {};
  for(const c of CHANNELS) mix[c.id] = 0;
  // default: hammock-night
  Object.assign(mix, PRESETS[0].mix);
  return {
    master: 50,
    mix,
    sleepMin: 0,
    fadeSec: 30,
    visuals: 'on',
    autoStart: false,
    audioStarted: false,
  };
}

function load(){
  try{
    const raw = localStorage.getItem(STORAGE);
    if(!raw) return defaultState();
    const j = JSON.parse(raw);
    return {
      ...defaultState(),
      ...j,
      mix: { ...defaultState().mix, ...(j.mix||{}) },
    };
  } catch {
    return defaultState();
  }
}

let state = load();
function save(){ localStorage.setItem(STORAGE, JSON.stringify(state)); }

// URL hash preset encoding: #m=forest:40,rain:10,...;master=45
function parseHash(){
  const h = (location.hash || '').replace(/^#/, '');
  if(!h) return null;
  const params = new URLSearchParams(h);
  const m = params.get('m');
  const master = params.get('master');
  if(!m && !master) return null;

  const mix = {};
  for(const c of CHANNELS) mix[c.id] = 0;
  if(m){
    for(const part of m.split(',')){
      const [k,v] = part.split(':');
      if(!k) continue;
      if(Object.prototype.hasOwnProperty.call(mix, k)){
        mix[k] = clamp(parseInt(v||'0',10), 0, 100);
      }
    }
  }
  return {
    mix,
    master: master ? clamp(parseInt(master,10),0,100) : null,
  };
}

function applyHashIfPresent(){
  const parsed = parseHash();
  if(!parsed) return;
  state.mix = parsed.mix;
  if(parsed.master != null) state.master = parsed.master;
  save();
}

applyHashIfPresent();

// Audio engine
let audio = {
  ctx: null,
  master: null,
  analyser: null,
  nodes: {},
  started: false,
};

function ensureAudio(){
  if(audio.started) return;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if(!Ctx){
    alert('WebAudio not supported in this browser.');
    return;
  }
  const ctx = new Ctx();
  const master = ctx.createGain();
  master.gain.value = state.master/100;

  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;

  master.connect(analyser);
  analyser.connect(ctx.destination);

  audio = { ctx, master, analyser, nodes: {}, started: true };

  // create each channel as its own gain feeding master
  for(const ch of CHANNELS){
    audio.nodes[ch.id] = buildChannel(ctx, ch.id);
    audio.nodes[ch.id].gain.gain.value = (state.mix[ch.id]||0)/100;
    audio.nodes[ch.id].gain.connect(master);
  }

  state.audioStarted = true;
  save();

  $('btnPower').setAttribute('aria-pressed', 'true');
  $('btnPower').textContent = 'Audio: On';
}

function stopAudio(){
  if(!audio.started) return;
  try{
    for(const k of Object.keys(audio.nodes)){
      const n = audio.nodes[k];
      try{ n.stop(); } catch{}
    }
    audio.ctx.close?.().catch(()=>{});
  } catch{}
  audio = { ctx:null, master:null, analyser:null, nodes:{}, started:false };

  $('btnPower').setAttribute('aria-pressed', 'false');
  $('btnPower').textContent = 'Start audio';
}

function buildChannel(ctx, id){
  const gain = ctx.createGain();
  gain.gain.value = 0;

  if(id === 'forest'){
    const noise = pinkishNoise(ctx);
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = 900;

    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.06;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 120;
    lfo.connect(lfoG); lfoG.connect(filt.frequency);

    noise.connect(filt); filt.connect(gain);
    lfo.start(); noise.start();

    return {
      gain,
      stop(){ noise.stop(); lfo.stop(); },
    };
  }

  if(id === 'rain'){
    const noise = pinkishNoise(ctx);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1500;
    bp.Q.value = 0.6;

    // amplitude flutter
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.8;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 0.12;
    lfo.connect(lfoG);
    lfoG.connect(gain.gain);

    noise.connect(bp); bp.connect(gain);
    lfo.start(); noise.start();

    return { gain, stop(){ noise.stop(); lfo.stop(); } };
  }

  if(id === 'wave'){
    // slow filtered noise + slow amplitude cycle
    const noise = pinkishNoise(ctx);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 520;
    lp.Q.value = 0.7;

    const amp = ctx.createGain();
    amp.gain.value = 0.35;

    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.08;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 0.22;
    lfo.connect(lfoG);
    lfoG.connect(amp.gain);

    noise.connect(lp); lp.connect(amp); amp.connect(gain);
    lfo.start(); noise.start();

    return { gain, stop(){ noise.stop(); lfo.stop(); } };
  }

  if(id === 'hammock'){
    // warm chord bed: two detuned oscillators + lowpass
    const o1 = ctx.createOscillator();
    const o2 = ctx.createOscillator();
    o1.type = 'sine';
    o2.type = 'triangle';
    o1.frequency.value = 110;
    o2.frequency.value = 165;

    const g1 = ctx.createGain(); g1.gain.value = 0.55;
    const g2 = ctx.createGain(); g2.gain.value = 0.30;

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 780;

    // slow drift
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.05;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 18;
    lfo.connect(lfoG);
    lfoG.connect(o2.frequency);

    o1.connect(g1); o2.connect(g2);
    g1.connect(lp); g2.connect(lp);
    lp.connect(gain);

    lfo.start(); o1.start(); o2.start();

    return { gain, stop(){ o1.stop(); o2.stop(); lfo.stop(); } };
  }

  // crackle
  const noise = whiteNoise(ctx);
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 3000;

  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 5200;
  bp.Q.value = 6;

  // random crackle gating
  const gate = ctx.createGain();
  gate.gain.value = 0.0;

  noise.connect(hp); hp.connect(bp); bp.connect(gate); gate.connect(gain);
  noise.start();

  const interval = setInterval(() => {
    if(!audio.started) return;
    const t = audio.ctx.currentTime;
    const v = Math.random() < 0.2 ? 0.18 : 0.0;
    try{
      gate.gain.cancelScheduledValues(t);
      gate.gain.setValueAtTime(gate.gain.value, t);
      gate.gain.linearRampToValueAtTime(v, t + 0.01);
      gate.gain.linearRampToValueAtTime(0.0, t + 0.08);
    } catch{}
  }, 120);

  return {
    gain,
    stop(){ clearInterval(interval); noise.stop(); }
  };
}

function whiteNoise(ctx){
  const bufferSize = 2 * ctx.sampleRate;
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const out = buffer.getChannelData(0);
  for(let i=0;i<bufferSize;i++) out[i] = (Math.random()*2-1);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.loop = true;
  return src;
}

function pinkishNoise(ctx){
  // quick-and-good: white noise into lowpass for a pink-ish feel
  const src = whiteNoise(ctx);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 1200;
  src.connect(lp);

  const out = ctx.createGain();
  out.gain.value = 1;
  lp.connect(out);

  // return a BufferSource-like wrapper with start/stop and connect
  return {
    start: (...a)=>src.start(...a),
    stop: (...a)=>src.stop(...a),
    connect: (dest)=>out.connect(dest)
  };
}

// UI
function renderChannels(){
  const host = $('channels');
  host.innerHTML = '';

  for(const ch of CHANNELS){
    const el = document.createElement('div');
    el.className = 'channel';

    const left = document.createElement('div');
    left.innerHTML = `<div class="channelName">${escapeHtml(ch.name)}</div><div class="channelDesc">${escapeHtml(ch.desc)}</div>`;

    const sliderWrap = document.createElement('div');
    sliderWrap.className = 'slider';
    sliderWrap.innerHTML = `
      <div class="sliderRow">
        <span class="mini muted">Level</span>
        <span class="mini" id="val-${ch.id}">${state.mix[ch.id]||0}%</span>
      </div>
      <input data-ch="${ch.id}" type="range" min="0" max="100" value="${state.mix[ch.id]||0}" />
    `;

    const right = document.createElement('div');
    right.innerHTML = `
      <button class="btn ghost" type="button" data-solo="${ch.id}">Solo</button>
      <button class="btn ghost" type="button" data-mute="${ch.id}">Mute</button>
    `;
    right.style.display = 'flex';
    right.style.gap = '10px';
    right.style.justifyContent = 'flex-end';

    el.appendChild(left);
    el.appendChild(sliderWrap);
    el.appendChild(right);
    host.appendChild(el);
  }

  // listeners
  host.querySelectorAll('input[type="range"][data-ch]').forEach(r => {
    r.addEventListener('input', () => {
      const id = r.dataset.ch;
      const v = clamp(parseInt(r.value,10),0,100);
      state.mix[id] = v;
      save();
      const val = document.getElementById(`val-${id}`);
      if(val) val.textContent = `${v}%`;
      if(audio.started){
        audio.nodes[id].gain.gain.value = v/100;
      }
    });
  });

  host.querySelectorAll('button[data-solo]').forEach(b => {
    b.addEventListener('click', () => {
      const id = b.dataset.solo;
      for(const ch of CHANNELS){
        const v = (ch.id === id) ? 60 : 0;
        state.mix[ch.id] = v;
      }
      save();
      hydrateUI();
    });
  });

  host.querySelectorAll('button[data-mute]').forEach(b => {
    b.addEventListener('click', () => {
      const id = b.dataset.mute;
      state.mix[id] = 0;
      save();
      hydrateUI();
    });
  });
}

function renderPresets(){
  const row = $('presetRow');
  row.innerHTML = '';
  for(const p of PRESETS){
    const el = document.createElement('div');
    el.className = 'preset';
    el.textContent = p.name;
    el.addEventListener('click', () => {
      state.master = p.master;
      state.mix = { ...state.mix, ...p.mix };
      save();
      hydrateUI();
    });
    row.appendChild(el);
  }
}

function hydrateUI(){
  $('master').value = String(state.master);
  // channels
  document.querySelectorAll('input[type="range"][data-ch]').forEach(r => {
    const id = r.dataset.ch;
    r.value = String(state.mix[id]||0);
    const val = document.getElementById(`val-${id}`);
    if(val) val.textContent = `${state.mix[id]||0}%`;
  });

  $('sleep').value = String(state.sleepMin);
  $('fade').value = String(state.fadeSec);
  $('visuals').value = String(state.visuals);
  $('autoStart').checked = !!state.autoStart;

  if(audio.started){
    audio.master.gain.value = state.master/100;
    for(const ch of CHANNELS){
      audio.nodes[ch.id].gain.gain.value = (state.mix[ch.id]||0)/100;
    }
  }
}

function escapeHtml(s){
  return String(s)
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'",'&#39;');
}

// Sleep timer
let timer = { endsAt: null, tick: null, fading: false };

function clearTimerUI(){
  $('timer').textContent = 'off';
  $('btnCancel').disabled = true;
}

function setTimer(min){
  state.sleepMin = min;
  save();
  if(min <= 0){
    if(timer.tick) clearInterval(timer.tick);
    timer = { endsAt:null, tick:null, fading:false };
    clearTimerUI();
    return;
  }
  ensureAudio();
  const now = Date.now();
  timer.endsAt = now + min*60*1000;
  $('btnCancel').disabled = false;

  if(timer.tick) clearInterval(timer.tick);
  timer.tick = setInterval(() => {
    const left = Math.max(0, Math.floor((timer.endsAt - Date.now())/1000));
    $('timer').textContent = fmtSec(left);
    if(left <= 0){
      clearInterval(timer.tick);
      timer.tick = null;
      fadeOutAndStop();
    }
  }, 250);
}

function fadeOutAndStop(){
  if(!audio.started) return;
  if(timer.fading) return;
  timer.fading = true;

  const fadeSec = clamp(parseInt(state.fadeSec||30,10), 5, 120);
  const t0 = audio.ctx.currentTime;
  try{
    audio.master.gain.cancelScheduledValues(t0);
    audio.master.gain.setValueAtTime(audio.master.gain.value, t0);
    audio.master.gain.linearRampToValueAtTime(0.0001, t0 + fadeSec);
  } catch{}

  setTimeout(() => {
    stopAudio();
    // restore master slider state (visual)
    timer = { endsAt:null, tick:null, fading:false };
    state.sleepMin = 0;
    save();
    $('sleep').value = '0';
    clearTimerUI();
    hydrateUI();
  }, fadeSec*1000 + 300);
}

// Visuals
let vizRaf = null;
function startViz(){
  if(vizRaf) return;
  const canvas = $('viz');
  const ctx = canvas.getContext('2d');

  const draw = () => {
    vizRaf = requestAnimationFrame(draw);
    const mode = state.visuals;
    ctx.clearRect(0,0,canvas.width,canvas.height);
    if(mode === 'off') return;

    // background glow
    ctx.fillStyle = 'rgba(255,255,255,0.03)';
    ctx.fillRect(0,0,canvas.width,canvas.height);

    const t = performance.now()/1000;

    // if audio isn't started, still draw a gentle breathing curve
    const breath = 0.5 + 0.5*Math.sin(t*0.7);

    let energy = breath;
    if(audio.started && audio.analyser){
      const arr = new Uint8Array(audio.analyser.frequencyBinCount);
      audio.analyser.getByteFrequencyData(arr);
      let sum = 0;
      for(let i=0;i<64;i++) sum += arr[i];
      energy = Math.min(1, (sum/64)/140);
    }

    const lines = (mode === 'reduced') ? 2 : 4;
    for(let i=0;i<lines;i++){
      const yMid = canvas.height*(0.35 + i*0.14);
      const amp = (18 + i*9) * (0.25 + energy);
      const speed = 0.25 + i*0.06;
      ctx.beginPath();
      for(let x=0;x<=canvas.width;x+=12){
        const y = yMid + Math.sin((x/120) + t*speed + i)*amp;
        if(x===0) ctx.moveTo(x,y);
        else ctx.lineTo(x,y);
      }
      ctx.strokeStyle = i%2===0 ? 'rgba(123,211,137,0.55)' : 'rgba(106,167,255,0.55)';
      ctx.lineWidth = 3;
      ctx.stroke();
    }

    // sloth dot
    ctx.fillStyle = 'rgba(242,247,255,0.65)';
    ctx.beginPath();
    ctx.arc(canvas.width*(0.12 + energy*0.76), canvas.height*0.82, 6, 0, Math.PI*2);
    ctx.fill();
  };

  draw();
}

function stopViz(){
  if(!vizRaf) return;
  cancelAnimationFrame(vizRaf);
  vizRaf = null;
}

// Share
function buildShareLink(){
  const parts = [];
  for(const c of CHANNELS){
    parts.push(`${c.id}:${clamp(state.mix[c.id]||0,0,100)}`);
  }
  const params = new URLSearchParams();
  params.set('m', parts.join(','));
  params.set('master', String(clamp(state.master,0,100)));
  return `${location.origin}${location.pathname}#${params.toString()}`;
}

function openShare(){
  const link = buildShareLink();
  $('shareLink').value = link;
  const d = $('shareDialog');
  if(typeof d.showModal === 'function') d.showModal();
}

async function copyShare(){
  const txt = $('shareLink').value;
  try{
    await navigator.clipboard.writeText(txt);
    $('btnCopy').textContent = 'Copied';
    setTimeout(()=> $('btnCopy').textContent = 'Copy', 1200);
  } catch {
    $('btnCopy').textContent = 'Select + copy';
    $('shareLink').focus();
    $('shareLink').select();
    setTimeout(()=> $('btnCopy').textContent = 'Copy', 1600);
  }
}

// Wire
renderChannels();
renderPresets();
hydrateUI();
startViz();

$('btnPower').addEventListener('click', async () => {
  if(audio.started){
    stopAudio();
    return;
  }
  ensureAudio();
});

$('master').addEventListener('input', () => {
  state.master = clamp(parseInt($('master').value,10), 0, 100);
  save();
  if(audio.started) audio.master.gain.value = state.master/100;
});

$('sleep').addEventListener('change', () => setTimer(clamp(parseInt($('sleep').value,10), 0, 120)));
$('fade').addEventListener('change', () => { state.fadeSec = clamp(parseInt($('fade').value,10), 5, 120); save(); });
$('visuals').addEventListener('change', () => { state.visuals = $('visuals').value; save(); });
$('autoStart').addEventListener('change', () => { state.autoStart = $('autoStart').checked; save(); });

$('btnCancel').addEventListener('click', () => {
  setTimer(0);
});

$('btnShare').addEventListener('click', openShare);
$('btnCopy').addEventListener('click', copyShare);

// First-gesture auto-start support
window.addEventListener('pointerdown', () => {
  if(state.autoStart && !audio.started && state.audioStarted){
    ensureAudio();
  }
}, { once: true });

// If sleep timer is set from previous session, re-arm (soft)
if(state.sleepMin > 0){
  // don't auto-start audio; just reset UI to off to avoid surprise
  state.sleepMin = 0;
  save();
}
clearTimerUI();

// Reduced motion
if(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches){
  state.visuals = 'reduced';
  save();
  hydrateUI();
}

// Keyboard shortcuts: space toggles audio, s share

document.addEventListener('keydown', (e) => {
  if(e.target && ['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)) return;
  if(e.code === 'Space'){
    e.preventDefault();
    $('btnPower').click();
  }
  if((e.key||'').toLowerCase() === 's'){
    openShare();
  }
});
