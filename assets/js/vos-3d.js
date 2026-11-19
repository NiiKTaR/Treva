import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

/**
 * V.O.S. (Visual Objective System) — Higgs-Field 3D Volumetric Hologram Engine (Three.js HDR)
 *
 * Renders 3 volumetric optical-crystal holographic Pie-Tube layers around a GLSL
 * Higgs Boson Singularity Core with EffectComposer HDR UnrealBloomPass, PMREM
 * RoomEnvironment reflections, inner caustic plasma shaders, orbital boson nodes,
 * and a contextual SmartLife Created Scenes click menu:
 *   - Layer V (Inner Pie Tubes, r=0.92..1.92): Visual hardware color, power & voice equalizer height
 *   - Layer O (Middle Pie Tubes, r=2.12..3.24): Objective smart home device matrix grouped by type
 *   - Layer S (Outer Pie Tubes, r=3.44..4.28): System subsystems & real-time usage telemetry
 */

  const MAX_LOGS = 36;
  const PI = Math.PI;
  const TAU = Math.PI * 2;
  const Y_SEPARATED_V = 1.45;
  const Y_SEPARATED_O = 0.0;
  const Y_SEPARATED_S = -1.45;

  const PARTICLE_COUNT = 880;
  const MAX_ENERGY_LINE_VERTS = 2600;
  const DECAY_TRACK_COUNT = 18;

  const PRESET_SWATCHES = [
    { hex: '#ffffff', label: 'Pure White', r: 255, g: 255, b: 255 },
    { hex: '#ffd27d', label: 'Warm White', r: 255, g: 210, b: 125 },
    { hex: '#ff3b30', label: 'Red', r: 255, g: 59, b: 48 },
    { hex: '#ff9500', label: 'Amber', r: 255, g: 149, b: 0 },
    { hex: '#22c55e', label: 'Emerald', r: 34, g: 197, b: 94 },
    { hex: '#00e5ff', label: 'Holo Cyan', r: 0, g: 229, b: 255 },
    { hex: '#3b82f6', label: 'Deep Blue', r: 59, g: 130, b: 246 },
    { hex: '#a855f7', label: 'Violet', r: 168, g: 85, b: 247 }
  ];

  const CATEGORY_ORDER = {
    light: 1,
    ble_light: 2,
    ir_ac: 3,
    ir_purifier: 4,
    ir_fan: 5,
    ir_audio: 6,
    ir_tv: 7,
    ir_remote: 8,
    vacuum: 9,
    switch: 10,
    cast: 11
  };

  const SYS_ORDER = ['voice', 'lights', 'ir', 'vacuum', 'cast'];
  const USAGE_STORAGE_KEY = 'treva_vos_sys_usage_v1';
  const SCENE_ASSIGN_STORAGE_KEY = 'treva_vos_slice_scenes_v1';
  const HEAT_TAU_SEC = 75;
  const MIN_SLICE_WEIGHT = 0.22;

  const state = {
    smartDevices: [],
    castDevices: [],
    bleDevices: [],
    smartScenes: { homeId: '', homeName: '', scenes: [] },
    smartSceneLinks: [],
    sliceScenes: Object.create(null),
    smartConfig: null,
    serverInfo: null,
    streamStatus: null,
    captureState: { active: false, audioLevel: 0, mode: '' },
    btOutput: { active: false, label: '' },
    castSdk: { active: false, device: '' },
    castScanState: { active: false, foundCount: 0, subnet: '', ssid: '', permission: 'unknown', message: '' },
    ambientSyncActive: false,
    logs: [],
    selectedDeviceId: '',
    openMenuSliceKey: '',
    sliceAssignOpen: false,
    sliceAssignQuery: '',
    hoveredSliceKey: '',
    voiceState: 'idle', // 'idle' | 'connecting' | 'listening' | 'speaking' | 'executing'
    audioLevel: 0,
    userAudioLevel: 0,
    aiAudioLevel: 0,
    fftBins: new Float32Array(24),
    joined: false,
    manualLock: null, // null (auto) | true (pinned flat) | false (pinned separated)
    autoJoinVoice: true,
    cameraPreset: 'iso', // 'iso' | 'side' | 'front'
    soloLayer: 'all', // 'all' | 'v' | 'o' | 's'
    focusedSliceKey: '',
    focusedDeviceIds: [],
    focusedSysKey: '',
    focusLayer: '', // '' | 's' | 'dev'
    focusSource: '', // 'user' | 'voice'
    activeVoiceAction: null,
    focusHoldUntil: 0,
    userOrbitOverride: false,
    sysUsage: null
  };

  const anim = {
    pitchDeg: 40,
    targetPitchDeg: 40,
    yawDeg: 0,
    targetYawDeg: 0,
    camDist: 10.6,
    targetCamDist: 10.6,
    spinAngle: 0,
    targetSpinAngle: 0,
    targetX: 0,
    targetY: 0,
    targetZ: 0,
    goalTargetX: 0,
    goalTargetY: 0,
    goalTargetZ: 0,
    yV: Y_SEPARATED_V,
    yS: Y_SEPARATED_S,
    focusBlend: 0,
    wavePhase: 0,
    clock: 0,
    energyLevel: 0.72,
    burstEnergy: 0,
    popByKey: Object.create(null),
    sysWeightByKey: Object.create(null),
    sysHeightByKey: Object.create(null)
  };

  // Spatial 3D Mouse Helper state
  const pointer = {
    inside: false,
    x: 0,
    y: 0,
    smoothX: 0,
    smoothY: 0,
    helperEnabled: false,
    hitKind: 'none', // 'slice' | 'core' | 'chamber' | 'none'
    slice: null,
    worldPos: [0, 0, 0],
    smoothWorld: [0, 0, 0],
    activeBlend: 0,
    r: 0,
    phiDeg: 0,
    worldY: 0,
    y: 0,
    zone: 'CHAMBER',
    energyGeV: 125.09,
    cardSig: '',
    helperRect: { x: 0, y: 0, w: 0, h: 0, active: false },
    lastDomUpdateAt: 0
  };

  let els = {};
  let gl = null; // Active Three.js WebGL context flag/ref for HUD/telemetry parity

  // Adaptive Three.js WebGL Scene Graph & Performance Tiering (runs on any GPU/CPU)
  let threeRenderer = null;
  let threeComposer = null;
  let threeRenderPass = null;
  let threeBloomPass = null;
  let threeOutputPass = null;
  let threeScene = null;
  let threeCamera = null;
  let threeRaycaster = null;
  let threePieRoot = null;
  let threeCoreGroup = null;
  let threeCorePlasma = null;
  let threeCoreLattice = null;
  let threeCoreShell = null;
  let threeCoreHitMesh = null;
  let threeCoreLight = null;
  let threeFocusLight = null;
  let threeBaseDisc = null;
  let threeEmitterCone = null;
  let threeGimbalRings = [];
  let threeGridPlanesGroup = null;
  let threeGridPlaneMeshes = [];
  let threeParticlePoints = null;
  let threeParticlePosAttr = null;
  let threeParticleColAttr = null;
  let threeEnergyLines = null;
  let threeEnergyPosAttr = null;
  let threeEnergyColAttr = null;
  let threeCursorLines = null;
  let threeCursorPosAttr = null;
  let threeCursorColAttr = null;
  let threePmremTarget = null;
  let threePnlTextures = null;
  let threeCoreTex = null;
  let threeParticleTex = null;
  let threeProjViewMat = null;
  let threeProjViewInvMat = null;
  let threeRayNdc = null;

  let gpuTier = 'medium'; // 'high' | 'medium' | 'low'
  let gpuRendererName = '';
  let activeParticleCount = PARTICLE_COUNT;
  let slowFrameStreak = 0;
  let smoothedFrameMs = 16.7;
  let lastRenderPerfNow = 0;

  let sliceModels = { v: [], o: [], s: [] };
  let topologySig = '';
  let devTopologySig = '';
  let lastSysGeoRebuildAt = 0;
  let lastUsageRenderAt = 0;
  let lastRenderedChipsSig = '';
  let lastStreamSample = { sid: '', bytes: 0, at: 0, kbps: 0 };
  let prevDeviceSnapshot = null;
  let prevStreamActive = false;
  let lastExplicitUsageAt = Object.create(null);
  let lastUsageTickAt = Date.now();
  let lastUsagePersistAt = 0;
  let cachedSysMeta = null;

  // Pre-allocated energy simulation arrays (zero per-frame GC)
  const particles = [];
  const decayTracks = [];
  const particleData = new Float32Array(PARTICLE_COUNT * 8); // x,y,z, r,g,b,a, size (used by 2D fallback & Three.js sync)
  const energyLineData = new Float32Array(MAX_ENERGY_LINE_VERTS * 7); // x,y,z, r,g,b,a
  const particlePosBuf = new Float32Array(PARTICLE_COUNT * 3);
  const particleColBuf = new Float32Array(PARTICLE_COUNT * 3);
  const energyLinePosBuf = new Float32Array(MAX_ENERGY_LINE_VERTS * 3);
  const energyLineColBuf = new Float32Array(MAX_ENERGY_LINE_VERTS * 3);
  const cursorLinePosBuf = new Float32Array(128 * 3);
  const cursorLineColBuf = new Float32Array(128 * 3);
  let energyLineVertCount = 0;
  let cursorLineStartVert = 0;
  let threeEnergyVertCount = 0;
  let threeCursorVertCount = 0;

  let audioCtx = null;
  let micSrc = null;
  let micAnalyser = null;
  let remoteSrc = null;
  let remoteAnalyser = null;
  let micBinBuf = null;
  let remoteBinBuf = null;

  let mainRaf = null;
  let cooldownTimer = null;
  let focusReleaseTimer = null;

  let dragging = false;
  let dragMoved = false;
  let dragStart = { x: 0, y: 0, pitch: 40, yaw: 0 };
  let lastClickKey = '';
  let lastClickAt = 0;

  let currentViewProj = new Float32Array(16);
  let currentInvViewProj = new Float32Array(16);
  let currentCamPos = [0, 6, 8];
  let viewWidth = 640;
  let viewHeight = 575;
  let dpr = 1;
  let hudDpr = 2;

  const PNL_PALETTE = {
    gain: { key: 'gain', sign: '+', label: '+ ON', rgb: [0.06, 0.86, 0.54], hex: '#10b981', pattern: 1 },
    stream: { key: 'stream', sign: '⚡', label: 'LIVE IO', rgb: [0.10, 0.86, 0.98], hex: '#22d3ee', pattern: 2 },
    flat: { key: 'flat', sign: '~', label: '~ STBY', rgb: [0.98, 0.72, 0.16], hex: '#f59e0b', pattern: 3 },
    loss: { key: 'loss', sign: '-', label: '- OFF', rgb: [0.92, 0.24, 0.38], hex: '#f43f5e', pattern: 4 }
  };

  let callbacks = {
    onControlSmart: null,
    onControlCast: null,
    onTriggerScene: null,
    onSaveSliceScenes: null,
    onSyncScenes: null,
    onCloseDrawer: null
  };

  // ---------------------------------------------------------------------------
  // Small DOM & Math Utilities
  // ---------------------------------------------------------------------------

  function drawRoundedRect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w * 0.5, h * 0.5);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
    ctx.lineTo(x + w, y + h - rr);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    ctx.lineTo(x + rr, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
    ctx.lineTo(x, y + rr);
    ctx.quadraticCurveTo(x, y, x + rr, y);
    ctx.closePath();
  }

  function el(id) {
    return document.getElementById(id);
  }

  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function foldName(str) {
    return String(str || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function foldAlnum(str) {
    return String(str || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '');
  }

  function timeNow() {
    return new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  // ---------------------------------------------------------------------------
  // Layer S Real Usage Telemetry Store & Persistence
  // ---------------------------------------------------------------------------

  function createEmptySysUsage() {
    const map = Object.create(null);
    for (const k of SYS_ORDER) {
      map[k] = { count: 0, heat: 0, activeSec: 0, lastUsedAt: 0, lastAction: '' };
    }
    return map;
  }

  const CACHE_MODE_KEY = 'treva_cache_mode_v1';

  function getVosStorage() {
    try {
      const mode = window.localStorage ? window.localStorage.getItem(CACHE_MODE_KEY) : '';
      if (mode === 'session' && window.sessionStorage) return window.sessionStorage;
      return window.localStorage || window.sessionStorage || null;
    } catch (_) {
      return null;
    }
  }

  function loadSysUsage() {
    const out = createEmptySysUsage();
    try {
      const store = getVosStorage();
      const raw = store ? store.getItem(USAGE_STORAGE_KEY) : '';
      if (!raw) return out;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return out;
      const now = Date.now();
      for (const k of SYS_ORDER) {
        const src = parsed[k];
        if (!src || typeof src !== 'object') continue;
        const lastUsedAt = Number(src.lastUsedAt || 0);
        if (lastUsedAt > 0 && (now - lastUsedAt) > 86400000) continue;
        const dtSec = lastUsedAt > 0 ? Math.max(0, (now - lastUsedAt) / 1000) : 0;
        const decayedHeat = Number(src.heat || 0) * Math.exp(-dtSec / HEAT_TAU_SEC);
        out[k] = {
          count: Math.max(0, Math.round(Number(src.count || 0))),
          heat: clamp(decayedHeat, 0, 1.5),
          activeSec: Math.max(0, Number(src.activeSec || 0)),
          lastUsedAt,
          lastAction: String(src.lastAction || '').slice(0, 64)
        };
      }
    } catch (_) {}
    return out;
  }

  function ensureSysUsage() {
    if (!state.sysUsage) {
      state.sysUsage = loadSysUsage();
    }
    return state.sysUsage;
  }

  function saveSysUsage() {
    try {
      const store = getVosStorage();
      if (!store || !state.sysUsage) return;
      const payload = {};
      for (const k of SYS_ORDER) {
        payload[k] = state.sysUsage[k] || { count: 0, heat: 0, activeSec: 0, lastUsedAt: 0, lastAction: '' };
      }
      store.setItem(USAGE_STORAGE_KEY, JSON.stringify(payload));
      lastUsagePersistAt = Date.now();
    } catch (_) {}
  }

  const SLICE_SCENES_STORAGE_KEY = 'treva_vos_slice_scenes_v1';

  function loadLocalSliceScenes() {
    try {
      const store = getVosStorage();
      const raw = store ? store.getItem(SLICE_SCENES_STORAGE_KEY) : '';
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return;
      const next = Object.create(null);
      for (const [k, list] of Object.entries(parsed)) {
        if (!Array.isArray(list)) continue;
        next[k] = list.map((id) => String(id).trim()).filter(Boolean);
      }
      state.sliceScenes = next;
    } catch (_) {}
  }

  function saveLocalSliceScenes() {
    try {
      const store = getVosStorage();
      if (!store || !state.sliceScenes) return;
      const out = {};
      for (const [k, list] of Object.entries(state.sliceScenes)) {
        if (Array.isArray(list)) {
          out[k] = list.map((id) => String(id).trim()).filter(Boolean);
        }
      }
      store.setItem(SLICE_SCENES_STORAGE_KEY, JSON.stringify(out));
    } catch (_) {}
  }

  function clearLocalCache(resetUsageToo = false) {
    try {
      [window.localStorage, window.sessionStorage].forEach((s) => {
        if (!s) return;
        s.removeItem(SLICE_SCENES_STORAGE_KEY);
        if (resetUsageToo) s.removeItem(USAGE_STORAGE_KEY);
      });
    } catch (_) {}
    state.sliceScenes = Object.create(null);
    if (resetUsageToo) {
      state.sysUsage = createEmptySysUsage();
    }
    closeSliceMenu();
    rebuildPieTopology(false);
    renderDeviceNav();
    renderSystemChips(true);
    renderInspector();
  }

  function mergeServerSliceScenes(serverMap) {
    if (!serverMap || typeof serverMap !== 'object') return;
    const next = Object.assign(Object.create(null), state.sliceScenes || {});
    for (const [k, list] of Object.entries(serverMap)) {
      if (Array.isArray(list)) {
        next[k] = list.map((id) => String(id).trim()).filter(Boolean);
      }
    }
    state.sliceScenes = next;
    saveLocalSliceScenes();
  }

  function formatDurationSec(sec) {
    const s = Math.max(0, Math.round(Number(sec || 0)));
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    const remS = s % 60;
    if (m < 60) return remS > 0 ? `${m}m${remS}s` : `${m}m`;
    const h = Math.floor(m / 60);
    const remM = m % 60;
    return remM > 0 ? `${h}h${remM}m` : `${h}h`;
  }

  function computeSharePcts(rawValues) {
    const nums = rawValues.map((v) => Math.max(0, Number(v) || 0));
    const total = nums.reduce((acc, v) => acc + v, 0);
    if (total <= 0) {
      return nums.map((_, idx) => (idx === 0 ? 100 - Math.floor(100 / nums.length) * (nums.length - 1) : Math.floor(100 / nums.length)));
    }
    const exact = nums.map((v) => (v / total) * 100);
    const floors = exact.map((v) => Math.floor(v));
    let rem = 100 - floors.reduce((a, b) => a + b, 0);
    const order = exact
      .map((v, idx) => ({ idx, frac: v - floors[idx] }))
      .sort((a, b) => b.frac - a.frac);
    for (let i = 0; i < order.length && rem > 0; i++, rem--) {
      floors[order[i].idx] += 1;
    }
    return floors;
  }

  function updateStreamRateSample(streamObj, nowMs = Date.now()) {
    const obj = streamObj || {};
    const streaming = Boolean(obj.isStreaming || obj.active);
    const totalBytes = Number(obj.bytesReceived || 0);
    const sid = String(obj.sid || '');
    if (!streaming) {
      lastStreamSample = { sid: '', bytes: 0, at: nowMs, kbps: 0 };
      return;
    }
    if (totalBytes <= 0) {
      lastStreamSample = { sid, bytes: 0, at: nowMs, kbps: 0 };
      return;
    }
    if (!lastStreamSample.at || sid !== lastStreamSample.sid || totalBytes < lastStreamSample.bytes) {
      lastStreamSample = { sid, bytes: totalBytes, at: nowMs, kbps: lastStreamSample.kbps * 0.5 };
      return;
    }
    const dtSec = (nowMs - lastStreamSample.at) / 1000;
    if (dtSec >= 0.4) {
      const deltaBytes = totalBytes - lastStreamSample.bytes;
      const instKbps = deltaBytes > 0 ? ((deltaBytes * 8) / (dtSec * 1000)) : 0;
      const blended = lastStreamSample.kbps > 0 ? lerp(lastStreamSample.kbps, instKbps, 0.55) : instKbps;
      lastStreamSample = {
        sid,
        bytes: totalBytes,
        at: nowMs,
        kbps: clamp(blended, 0, 2000)
      };
    }
  }

  function isSysKeyCurrentlyActive(sysKey) {
    if (sysKey === 'voice') return state.voiceState !== 'idle';
    if (sysKey === 'lights') {
      const wifiOn = (state.smartDevices || []).some((d) => d.category === 'light' && d.power);
      const bleOn = (state.bleDevices || []).some((d) => Boolean(d.power));
      return wifiOn || bleOn;
    }
    if (sysKey === 'ir') {
      return (state.smartDevices || []).some((d) => {
        const cat = String(d.category || '');
        return cat.startsWith('ir_') && cat !== 'ir_hub' && d.power;
      });
    }
    if (sysKey === 'vacuum') {
      return (state.smartDevices || []).some((d) => d.category === 'vacuum' && d.vacuumCleaning);
    }
    if (sysKey === 'cast') {
      const streaming = Boolean(state.streamStatus && (state.streamStatus.isStreaming || state.streamStatus.active));
      const capturing = Boolean(state.captureState && state.captureState.active);
      const bt = Boolean(state.btOutput && state.btOutput.active);
      const sdk = Boolean(state.castSdk && state.castSdk.active);
      const castOn = (state.castDevices || []).some((c) => c.status === 'PLAYING' || c.status === 'BUFFERING' || c.power);
      return streaming || capturing || bt || sdk || castOn;
    }
    return false;
  }

  function tickSystemUsageRuntime(nowMs = Date.now()) {
    const usage = ensureSysUsage();
    const dtSec = clamp((nowMs - lastUsageTickAt) / 1000, 0, 1.5);
    lastUsageTickAt = nowMs;
    if (dtSec <= 0) return;

    const decay = Math.exp(-dtSec / HEAT_TAU_SEC);
    let dirty = false;
    for (const k of SYS_ORDER) {
      const entry = usage[k];
      if (!entry) continue;
      if (entry.heat > 0.0005) {
        entry.heat *= decay;
        if (entry.heat < 0.001) entry.heat = 0;
        dirty = true;
      }
      if (isSysKeyCurrentlyActive(k)) {
        entry.activeSec += dtSec;
        dirty = true;
      }
    }
    if (dirty && (nowMs - lastUsagePersistAt) >= 5000) {
      saveSysUsage();
    }
  }

  function recordSystemUsage(sysKey, detail = '', opts = {}) {
    if (!SYS_ORDER.includes(sysKey)) return;
    const now = Date.now();
    tickSystemUsageRuntime(now);
    const usage = ensureSysUsage();
    const entry = usage[sysKey];

    const isAmbient = Boolean(opts.isAmbientSync);
    const damp = Boolean(opts.damp);
    const countEvent = opts.countEvent !== undefined ? Boolean(opts.countEvent) : !isAmbient;

    if (damp) {
      const factor = Number.isFinite(opts.dampFactor) ? opts.dampFactor : 0.35;
      entry.heat = clamp(entry.heat * factor, 0, 1.5);
    } else {
      const boost = Number.isFinite(opts.boost) ? opts.boost : (isAmbient ? 0.08 : 0.34);
      entry.heat = clamp(entry.heat + boost, 0, 1.5);
    }

    if (countEvent) entry.count += 1;
    entry.lastUsedAt = now;
    if (detail) entry.lastAction = String(detail).slice(0, 64);

    if (!isAmbient && opts.fromExternal !== true) {
      lastExplicitUsageAt[sysKey] = now;
    }

    if (!isAmbient && !damp && gl) {
      triggerEnergyBurst(0.32);
    }

    saveSysUsage();
    const sysMeta = buildSystemSlicesMeta();
    updateSliceDynamicData(getUnifiedDevices(), sysMeta);
    renderSystemChips(true);
    if (state.focusLayer === 's' && state.focusedSysKey === sysKey) {
      renderInspector();
    }
  }

  function resetSystemUsage() {
    state.sysUsage = createEmptySysUsage();
    lastExplicitUsageAt = Object.create(null);
    lastUsageTickAt = Date.now();
    saveSysUsage();
    const sysMeta = buildSystemSlicesMeta();
    updateSliceDynamicData(getUnifiedDevices(), sysMeta);
    renderSystemChips(true);
    if (state.focusLayer === 's') renderInspector();
    pushLog('SYS', 'Reset Layer S real usage counters & heat', 'info');
  }

  function setCaptureAudioLevel(level, active = true) {
    state.captureState = {
      ...state.captureState,
      active: Boolean(active),
      audioLevel: clamp(Number(level) || 0, 0, 1)
    };
  }

  function detectExternalUsageChanges() {
    const devs = getUnifiedDevices();
    const streamActive = Boolean(state.streamStatus && (state.streamStatus.isStreaming || state.streamStatus.active));
    const snap = new Map();
    for (const d of devs) {
      snap.set(d.id, {
        name: d.name || d.id,
        category: d.category || '',
        kind: d._kind || '',
        power: Boolean(d.power),
        brightness: Number(d.brightness ?? 100),
        r: Number(d.r ?? 255),
        g: Number(d.g ?? 255),
        b: Number(d.b ?? 255),
        vacuumCleaning: Boolean(d.vacuumCleaning),
        vacuumMode: String(d.vacuumMode || ''),
        acTemp: d.acTemp ?? null,
        acMode: String(d.acMode || ''),
        acFan: String(d.acFan || ''),
        status: String(d.status || '')
      });
    }

    if (!prevDeviceSnapshot) {
      prevDeviceSnapshot = snap;
      prevStreamActive = streamActive;
      return;
    }

    const now = Date.now();
    const canAutoRecord = (k) => (now - (lastExplicitUsageAt[k] || 0)) >= 1800;

    for (const [id, cur] of snap.entries()) {
      const prev = prevDeviceSnapshot.get(id);
      if (!prev) continue;

      if (cur.category === 'light' || cur.category === 'ble_light') {
        const changed = cur.power !== prev.power || Math.abs(cur.brightness - prev.brightness) >= 2
          || cur.r !== prev.r || cur.g !== prev.g || cur.b !== prev.b;
        if (changed && canAutoRecord('lights')) {
          if (!cur.power && prev.power) {
            recordSystemUsage('lights', `${cur.name} OFF (sync)`, { damp: true, boost: 0, fromExternal: true });
          } else {
            recordSystemUsage('lights', `${cur.name} ${cur.power ? `${cur.brightness}%` : 'updated'} (sync)`, { boost: 0.28, fromExternal: true });
          }
        }
      } else if (cur.category === 'vacuum') {
        const changed = cur.vacuumCleaning !== prev.vacuumCleaning || cur.vacuumMode !== prev.vacuumMode;
        if (changed && canAutoRecord('vacuum')) {
          if (cur.vacuumCleaning) {
            recordSystemUsage('vacuum', `${cur.name} cleaning (sync)`, { boost: 0.42, fromExternal: true });
          } else if (cur.vacuumMode.toLowerCase() === 'chargego') {
            recordSystemUsage('vacuum', `${cur.name} returning (sync)`, { boost: 0.24, fromExternal: true });
          } else {
            recordSystemUsage('vacuum', `${cur.name} docked (sync)`, { damp: true, boost: 0, fromExternal: true });
          }
        }
      } else if (cur.category.startsWith('ir_') && cur.category !== 'ir_hub') {
        const changed = cur.power !== prev.power || cur.acTemp !== prev.acTemp || cur.acMode !== prev.acMode || cur.acFan !== prev.acFan;
        if (changed && canAutoRecord('ir')) {
          recordSystemUsage('ir', `${cur.name} updated (sync)`, { boost: 0.30, fromExternal: true });
        }
      } else if (cur.kind === 'cast') {
        const changed = cur.status !== prev.status || cur.power !== prev.power || Math.abs(cur.brightness - prev.brightness) >= 2;
        if (changed && canAutoRecord('cast')) {
          if (!cur.power && prev.power) {
            recordSystemUsage('cast', `${cur.name} stopped (sync)`, { damp: true, boost: 0, fromExternal: true });
          } else {
            recordSystemUsage('cast', `${cur.name} ${cur.status || 'updated'} (sync)`, { boost: 0.32, fromExternal: true });
          }
        }
      }
    }

    if (!prevStreamActive && streamActive && canAutoRecord('cast')) {
      recordSystemUsage('cast', 'Audio stream active (sync)', { boost: 0.35, fromExternal: true });
    }

    prevDeviceSnapshot = snap;
    prevStreamActive = streamActive;
  }

  function focusSystemSlice(sysKey) {
    if (!sysKey) return;
    state.focusLayer = 's';
    state.focusedSysKey = sysKey;
    const sS = sliceModels.s.find((s) => s.sysKey === sysKey);
    if (sS) {
      spinToSlice(sS, 0, 'user');
      pushLog('SYS', `Focused subsystem: ${sS.sys.name} (${sS.sys.usagePct}% usage, ${sS.sys.sharePct}% share)`, 'info');
    }
    renderSystemChips(true);
    renderInspector();
  }

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function wrapAngleSigned(a) {
    let x = (a + PI) % TAU;
    if (x < 0) x += TAU;
    return x - PI;
  }

  function wrapAngle0Tau(a) {
    let x = a % TAU;
    if (x < 0) x += TAU;
    return x;
  }

  function rgbNormFromDev(dev) {
    if (!dev) return [0.22, 0.74, 0.97];
    if (dev._kind === 'cast') {
      return dev.power ? PNL_PALETTE.stream.rgb : PNL_PALETTE.flat.rgb;
    }
    const cat = String(dev.category || '');
    if (cat === 'light' || cat === 'ble_light') {
      if (!dev.power) return PNL_PALETTE.loss.rgb;
      return [
        clamp((Number(dev.r ?? 255)) / 255, 0.12, 1),
        clamp((Number(dev.g ?? 210)) / 255, 0.12, 1),
        clamp((Number(dev.b ?? 130)) / 255, 0.12, 1)
      ];
    }
    if (cat === 'vacuum') {
      return (dev.vacuumCleaning || dev.power) ? PNL_PALETTE.gain.rgb : PNL_PALETTE.flat.rgb;
    }
    if (cat === 'ir_ac') return dev.power ? PNL_PALETTE.stream.rgb : PNL_PALETTE.loss.rgb;
    if (cat === 'ir_audio') return dev.power ? PNL_PALETTE.gain.rgb : PNL_PALETTE.loss.rgb;
    if (cat === 'ir_tv') return dev.power ? PNL_PALETTE.gain.rgb : PNL_PALETTE.flat.rgb;
    if (cat === 'ir_fan' || cat === 'ir_purifier') return dev.power ? PNL_PALETTE.gain.rgb : PNL_PALETTE.loss.rgb;
    return dev.power ? PNL_PALETTE.gain.rgb : PNL_PALETTE.loss.rgb;
  }

  function rgbCss(c, alpha = 1) {
    const r = Math.round(clamp(c[0], 0, 1) * 255);
    const g = Math.round(clamp(c[1], 0, 1) * 255);
    const b = Math.round(clamp(c[2], 0, 1) * 255);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  function categoryLabel(dev) {
    if (!dev) return 'Device';
    if (dev._kind === 'cast') return 'Cast Sink';
    const map = {
      light: 'Smart Light',
      ble_light: 'BLE Light',
      ir_ac: 'Climate HVAC',
      ir_audio: 'Audio Amp',
      ir_tv: 'Smart TV IR',
      ir_fan: 'Air Fan IR',
      ir_purifier: 'Air Purifier',
      ir_remote: 'IR Blaster',
      vacuum: 'Robot Vacuum',
      switch: 'Power Switch'
    };
    return map[dev.category] || 'Smart Node';
  }

  function protocolLabel(dev) {
    if (!dev) return 'NODE';
    if (dev._kind === 'cast') return 'GOOGLE CAST';
    if (dev.platform === 'ble') return 'BLE MESH';
    if (dev.platform === 'magichome') return dev.ip ? 'MAGIC HOME LAN' : 'MAGIC HOME';
    if (dev.ip) return 'TUYA LAN';
    return 'TUYA CLOUD';
  }

  function getSlicePnlProfile(slice) {
    if (!slice) return PNL_PALETTE.flat;
    if (slice.layer === 's') {
      const sys = slice.sys || {};
      if (sys.pnlKey && PNL_PALETTE[sys.pnlKey]) return PNL_PALETTE[sys.pnlKey];
      if (slice.sysKey === 'voice' || slice.sysKey === 'cast') {
        if ((sys.liveLoad || 0) > 0.16 || sys.active) return PNL_PALETTE.stream;
        if ((sys.usagePct || 0) > 4) return PNL_PALETTE.flat;
        return PNL_PALETTE.loss;
      }
      if (sys.active || (sys.liveLoad || 0) > 0.20) return PNL_PALETTE.gain;
      if ((sys.usagePct || 0) > 5) return PNL_PALETTE.flat;
      return PNL_PALETTE.loss;
    }

    const dev = slice.dev || {};
    if (dev._kind === 'cast') {
      return dev.power ? PNL_PALETTE.stream : PNL_PALETTE.flat;
    }
    const cat = String(dev.category || '');
    if (cat === 'vacuum') {
      if (dev.vacuumCleaning || dev.power) return PNL_PALETTE.gain;
      return PNL_PALETTE.flat;
    }
    if (cat === 'light' || cat === 'ble_light') {
      if (!dev.power) return PNL_PALETTE.loss;
      const bri = Number(dev.brightness ?? 100);
      return bri <= 30 ? PNL_PALETTE.flat : PNL_PALETTE.gain;
    }
    if (cat === 'ir_tv') {
      return dev.power ? PNL_PALETTE.gain : PNL_PALETTE.flat;
    }
    return dev.power ? PNL_PALETTE.gain : PNL_PALETTE.loss;
  }

  function objectivePnlColorForDev(dev) {
    return getSlicePnlProfile({ layer: 'o', dev }).rgb;
  }

  function describeRgbTone(r, g, b) {
    const rn = Number(r ?? 255);
    const gn = Number(g ?? 210);
    const bn = Number(b ?? 130);
    if (rn > 220 && gn > 220 && bn > 220) return 'Cool Daylight';
    if (rn > 210 && gn >= 150 && bn < 150) return 'Warm White';
    if (rn >= gn && rn >= bn) return gn > 130 ? 'Solar Amber' : 'Crimson Tone';
    if (gn >= rn && gn >= bn) return bn > 160 ? 'Aqua Cyan' : 'Emerald Tone';
    if (bn >= rn && bn >= gn) return rn > 150 ? 'Quantum Violet' : 'Deep Azure';
    return 'RGB Spectrum';
  }

  function describePieSector(slice) {
    if (!slice) {
      return {
        pnl: PNL_PALETTE.flat,
        tierTag: 'CHAMBER',
        roleBadge: 'Quantum Field',
        statusPill: '~ IDLE',
        statusLine: 'Standby',
        explainLine: 'Hover any V, O, or S sector to inspect telemetry.'
      };
    }

    const pnl = getSlicePnlProfile(slice);

    if (slice.layer === 's') {
      const sys = slice.sys || {};
      const key = slice.sysKey;
      const roles = {
        voice: {
          badge: 'Realtime Speech & Intent AI',
          explain: 'Controls OpenAI WebRTC speech recognition, intent routing & audio flux.'
        },
        lights: {
          badge: 'Optical Illumination Grid',
          explain: 'Aggregates Wi-Fi Tuya, Magic Home LAN & BLE bulb power/luminance draw.'
        },
        ir: {
          badge: 'Climate, Audio & IR Bus',
          explain: 'Dispatches infrared HVAC, speaker & TV commands plus automation scenes.'
        },
        vacuum: {
          badge: 'Autonomous Robotics Floor Bus',
          explain: 'Tracks cleaning runs, docking state & battery health telemetry.'
        },
        cast: {
          badge: 'Audio Capture & Cast Streamer',
          explain: 'Streams system audio/media to Google Cast & Bluetooth targets.'
        }
      };
      const meta = roles[key] || { badge: 'System Subsystem', explain: 'Live hub telemetry sector.' };
      const statusPill = pnl.key === 'stream'
        ? `⚡ ${sys.usagePct ?? 0}% LIVE`
        : (pnl.key === 'gain' ? `+ ${sys.usagePct ?? 0}% ON`
          : (pnl.key === 'flat' ? `~ ${sys.usagePct ?? 0}% STBY` : `- 0% IDLE`));
      return {
        pnl,
        tierTag: `S // ${sys.sharePct ?? 20}% PIE`,
        roleBadge: meta.badge,
        statusPill,
        statusLine: `${sys.shortMetric || sys.subtitle || 'Idle'}`,
        explainLine: `${meta.explain} (${sys.count || 0} cmds • ${sys.sharePct ?? 20}% ring weight)`
      };
    }

    const d = slice.dev || {};
    const cat = String(d.category || '');
    const layerPrefix = slice.layer === 'v' ? 'V // OPTICAL' : 'O // PNL';
    let roleBadge = categoryLabel(d);
    let statusPill = pnl.label;
    let statusLine = '';
    let explainLine = '';

    if (d._kind === 'cast') {
      roleBadge = slice.layer === 'v' ? 'A/V Media Output Sink' : 'Google Cast Objective';
      statusPill = d.power ? `⚡ CAST ${d.brightness ?? 70}%` : `~ READY`;
      statusLine = d.power ? `Streaming Live • Vol ${d.brightness ?? 70}%` : `Standby Cast Target • Vol ${d.brightness ?? 70}%`;
      explainLine = d.ip
        ? `Cast endpoint at ${d.ip}. Click to inspect or cast captured PC audio.`
        : 'Google Cast media sink ready for WebRTC/HTTP audio stream routing.';
    } else if (cat === 'light' || cat === 'ble_light') {
      const tone = describeRgbTone(d.r, d.g, d.b);
      roleBadge = slice.layer === 'v' ? `Optical RGB (${tone})` : 'Illumination Sector';
      statusPill = d.power ? `+ ON ${d.brightness ?? 100}%` : '- OFF';
      statusLine = d.power
        ? `Illuminated • ${d.brightness ?? 100}% Lum (${tone})`
        : 'Power OFF • Zero Luminance Output';
      explainLine = slice.layer === 'v'
        ? `${protocolLabel(d)} bulb emitter. Double-click wedge to toggle power.`
        : `Objective PnL state: ${d.power ? 'Active Draw (+)' : 'Powered Off (-)'}. Double-click to toggle.`;
    } else if (cat === 'vacuum') {
      const bat = d.battery != null ? `${d.battery}%` : '--%';
      roleBadge = 'Autonomous Floor Robot';
      statusPill = d.vacuumCleaning ? '+ CLEANING' : `~ DOCK ${bat}`;
      statusLine = d.vacuumCleaning ? `Sweeping Floor • Bat ${bat}` : `Docked Standby • Battery ${bat}`;
      explainLine = 'Robotic vacuum navigation & battery telemetry. Use inspector or Voice to clean/dock.';
    } else if (cat === 'ir_ac') {
      roleBadge = 'Climate HVAC Unit';
      statusPill = d.power ? `⚡ ${d.acTemp || 22}°C` : '- OFF';
      statusLine = d.power ? `Cooling ${d.acTemp || 22}°C (${d.acMode || 'cool'})` : 'HVAC Off • IR Standby';
      explainLine = 'Infrared climate controller for room temperature and cooling modes.';
    } else if (cat === 'ir_audio') {
      roleBadge = 'Hi-Fi Audio Amplifier';
      statusPill = d.power ? '+ AUDIO ON' : '- OFF';
      statusLine = d.power ? 'Speaker Amplifier Powered' : 'Speakers Off • IR Blaster Ready';
      explainLine = 'Infrared amplifier sector controllable by voice commands or Deck PowerOff.';
    } else if (cat === 'ir_tv') {
      roleBadge = 'Smart TV Display';
      statusPill = d.power ? '+ TV ON' : '~ IR READY';
      statusLine = d.power ? 'Display Active' : 'Standby IR Control Ready';
      explainLine = 'Living room display infrared sector linked to Tuya IR scenes.';
    } else {
      statusPill = d.power ? '+ ACTIVE' : '- OFF';
      statusLine = d.power ? 'Node Powered On' : 'Node Offline / Standby';
      explainLine = `${protocolLabel(d)} smart node telemetry sector.`;
    }

    return { pnl, tierTag: layerPrefix, roleBadge, statusPill, statusLine, explainLine };
  }

  // ---------------------------------------------------------------------------
  // 4x4 Matrix Math (Column-Major)
  // ---------------------------------------------------------------------------

  function mat4Perspective(fovyRad, aspect, near, far) {
    const f = 1.0 / Math.tan(fovyRad * 0.5);
    const nf = 1 / (near - far);
    const out = new Float32Array(16);
    out[0] = f / Math.max(0.1, aspect);
    out[5] = f;
    out[10] = (far + near) * nf;
    out[11] = -1;
    out[14] = 2 * far * near * nf;
    return out;
  }

  function mat4LookAt(eye, center, up) {
    let zx = eye[0] - center[0];
    let zy = eye[1] - center[1];
    let zz = eye[2] - center[2];
    let len = Math.hypot(zx, zy, zz) || 1;
    zx /= len; zy /= len; zz /= len;

    let xx = up[1] * zz - up[2] * zy;
    let xy = up[2] * zx - up[0] * zz;
    let xz = up[0] * zy - up[1] * zx;
    len = Math.hypot(xx, xy, xz) || 1;
    xx /= len; xy /= len; xz /= len;

    const yx = zy * xz - zz * xy;
    const yy = zz * xx - zx * xz;
    const yz = zx * xy - zy * xx;

    const out = new Float32Array(16);
    out[0] = xx; out[4] = xy; out[8] = xz; out[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
    out[1] = yx; out[5] = yy; out[9] = yz; out[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
    out[2] = zx; out[6] = zy; out[10] = zz; out[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
    out[3] = 0;  out[7] = 0;  out[11] = 0;  out[15] = 1;
    return out;
  }

  function mat4Multiply(a, b) {
    const out = new Float32Array(16);
    for (let c = 0; c < 4; c++) {
      const b0 = b[c * 4], b1 = b[c * 4 + 1], b2 = b[c * 4 + 2], b3 = b[c * 4 + 3];
      out[c * 4] = a[0] * b0 + a[4] * b1 + a[8] * b2 + a[12] * b3;
      out[c * 4 + 1] = a[1] * b0 + a[5] * b1 + a[9] * b2 + a[13] * b3;
      out[c * 4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3;
      out[c * 4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3;
    }
    return out;
  }

  function mat4Invert(m) {
    const inv = new Float32Array(16);
    const m00 = m[0], m01 = m[1], m02 = m[2], m03 = m[3];
    const m10 = m[4], m11 = m[5], m12 = m[6], m13 = m[7];
    const m20 = m[8], m21 = m[9], m22 = m[10], m23 = m[11];
    const m30 = m[12], m31 = m[13], m32 = m[14], m33 = m[15];

    inv[0] = m11 * m22 * m33 - m11 * m23 * m32 - m21 * m12 * m33 + m21 * m13 * m32 + m31 * m12 * m23 - m31 * m13 * m22;
    inv[4] = -m10 * m22 * m33 + m10 * m23 * m32 + m20 * m12 * m33 - m20 * m13 * m32 - m30 * m12 * m23 + m30 * m13 * m22;
    inv[8] = m10 * m21 * m33 - m10 * m23 * m31 - m20 * m11 * m33 + m20 * m13 * m31 + m30 * m11 * m23 - m30 * m13 * m21;
    inv[12] = -m10 * m21 * m32 + m10 * m22 * m31 + m20 * m11 * m32 - m20 * m12 * m31 - m30 * m11 * m22 + m30 * m12 * m21;

    inv[1] = -m01 * m22 * m33 + m01 * m23 * m32 + m21 * m02 * m33 - m21 * m03 * m32 - m31 * m02 * m23 + m31 * m03 * m22;
    inv[5] = m00 * m22 * m33 - m00 * m23 * m32 - m20 * m02 * m33 + m20 * m03 * m32 + m30 * m02 * m23 - m30 * m03 * m22;
    inv[9] = -m00 * m21 * m33 + m00 * m23 * m31 + m20 * m01 * m33 - m20 * m03 * m31 - m30 * m01 * m23 + m30 * m03 * m21;
    inv[13] = m00 * m21 * m32 - m00 * m22 * m31 - m20 * m01 * m32 + m20 * m02 * m31 + m30 * m01 * m22 - m30 * m02 * m21;

    inv[2] = m01 * m12 * m33 - m01 * m13 * m32 - m11 * m02 * m33 + m11 * m03 * m32 + m31 * m02 * m13 - m31 * m03 * m12;
    inv[6] = -m00 * m12 * m33 + m00 * m13 * m32 + m10 * m02 * m33 - m10 * m03 * m32 - m30 * m02 * m13 + m30 * m03 * m12;
    inv[10] = m00 * m11 * m33 - m00 * m13 * m31 - m10 * m01 * m33 + m10 * m03 * m31 + m30 * m01 * m13 - m30 * m03 * m11;
    inv[14] = -m00 * m11 * m32 + m00 * m12 * m31 + m10 * m01 * m32 - m10 * m02 * m31 - m30 * m01 * m12 + m30 * m02 * m11;

    inv[3] = -m01 * m12 * m23 + m01 * m13 * m22 + m11 * m02 * m23 - m11 * m03 * m22 - m21 * m02 * m13 + m21 * m03 * m12;
    inv[7] = m00 * m12 * m23 - m00 * m13 * m22 - m10 * m02 * m23 + m10 * m03 * m22 + m20 * m02 * m13 - m20 * m03 * m12;
    inv[11] = -m00 * m11 * m23 + m00 * m13 * m21 + m10 * m01 * m23 - m10 * m03 * m21 - m20 * m01 * m13 + m20 * m03 * m11;
    inv[15] = m00 * m11 * m22 - m00 * m12 * m21 - m10 * m01 * m22 + m10 * m02 * m21 + m20 * m01 * m12 - m20 * m02 * m11;

    let det = m00 * inv[0] + m01 * inv[4] + m02 * inv[8] + m03 * inv[12];
    if (Math.abs(det) < 1e-8) return new Float32Array(16);
    det = 1.0 / det;
    for (let i = 0; i < 16; i++) inv[i] *= det;
    return inv;
  }

  function makeSliceModelMatrix(spin, popX, popZ, yCenter, heightY) {
    const c = Math.cos(spin);
    const s = Math.sin(spin);
    const out = new Float32Array(16);
    out[0] = c;         out[1] = 0;       out[2] = s;        out[3] = 0;
    out[4] = 0;         out[5] = heightY; out[6] = 0;        out[7] = 0;
    out[8] = -s;        out[9] = 0;       out[10] = c;       out[11] = 0;
    out[12] = c * popX - s * popZ;
    out[13] = yCenter;
    out[14] = s * popX + c * popZ;
    out[15] = 1;
    return out;
  }

  function makeTranslateScaleMatrix(tx, ty, tz, sx, sy, sz) {
    const out = new Float32Array(16);
    out[0] = sx; out[5] = sy; out[10] = sz; out[15] = 1;
    out[12] = tx; out[13] = ty; out[14] = tz;
    return out;
  }

  function slicePointToWorld(lx, ly, lz, spin, popX, popZ, yCenter, heightY) {
    const tx = lx + popX;
    const ty = ly * heightY + yCenter;
    const tz = lz + popZ;
    const c = Math.cos(spin);
    const s = Math.sin(spin);
    return [tx * c - tz * s, ty, tx * s + tz * c];
  }

  function projectWorldPoint(wx, wy, wz, viewProj, w, h) {
    const cx = viewProj[0] * wx + viewProj[4] * wy + viewProj[8] * wz + viewProj[12];
    const cy = viewProj[1] * wx + viewProj[5] * wy + viewProj[9] * wz + viewProj[13];
    const cz = viewProj[2] * wx + viewProj[6] * wy + viewProj[10] * wz + viewProj[14];
    const cw = viewProj[3] * wx + viewProj[7] * wy + viewProj[11] * wz + viewProj[15];
    if (cw <= 0.05) return { x: -999, y: -999, depth: 999, visible: false };
    const nx = cx / cw;
    const ny = cy / cw;
    return {
      x: (nx * 0.5 + 0.5) * w,
      y: (0.5 - ny * 0.5) * h,
      depth: cz / cw,
      visible: Math.abs(nx) < 1.35 && Math.abs(ny) < 1.35
    };
  }

  // ---------------------------------------------------------------------------
  // Adaptive Three.js Holographic Geometries, Textures & Hardware Profiles
  // ---------------------------------------------------------------------------

  const GPU_TIER_CONFIG = {
    high: {
      maxDpr: 2.0,
      curveDivs: 56,
      minArcSegs: 10,
      bevelSegments: 4,
      edgeThreshold: 19,
      particleLimit: PARTICLE_COUNT,
      usePhysicalMat: true,
      usePmrem: true,
      useBloom: true,
      bloomStrength: 0.52,
      bloomRadius: 0.54,
      bloomThreshold: 0.68,
      samples: 4,
      coreSegments: 36
    },
    medium: {
      maxDpr: 1.5,
      curveDivs: 40,
      minArcSegs: 7,
      bevelSegments: 3,
      edgeThreshold: 20,
      particleLimit: 560,
      usePhysicalMat: true,
      usePmrem: true,
      useBloom: true,
      bloomStrength: 0.42,
      bloomRadius: 0.46,
      bloomThreshold: 0.72,
      samples: 0,
      coreSegments: 26
    },
    low: {
      maxDpr: 1.0,
      curveDivs: 20,
      minArcSegs: 5,
      bevelSegments: 1,
      edgeThreshold: 24,
      particleLimit: 240,
      usePhysicalMat: false,
      usePmrem: true,
      useBloom: false,
      bloomStrength: 0,
      bloomRadius: 0,
      bloomThreshold: 1,
      samples: 0,
      coreSegments: 14
    }
  };

  function getTierConfig() {
    return GPU_TIER_CONFIG[gpuTier] || GPU_TIER_CONFIG.medium;
  }

  function detectGraphicsTier(renderer) {
    let rendererStr = '';
    let maxTexUnits = 16;
    let isSoftware = false;
    try {
      const ctx = renderer.getContext();
      if (ctx) {
        maxTexUnits = ctx.getParameter(ctx.MAX_TEXTURE_IMAGE_UNITS) || 16;
        const dbg = ctx.getExtension('WEBGL_debug_renderer_info');
        if (dbg) {
          rendererStr = String(ctx.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || '');
        } else {
          rendererStr = String(ctx.getParameter(ctx.RENDERER) || '');
        }
      }
    } catch (_) {}

    const lowRe = /swiftshader|llvmpipe|software|microsoft basic render|mesa x11|gdi generic|virtualbox|vmware/i;
    const midRe = /intel|uhd|iris|radeon\(tm\) graphics|vega\s*[0-9]|adreno|mali|powervr|apple gpu|angle \(intel/i;
    const cores = typeof navigator !== 'undefined' && navigator.hardwareConcurrency ? navigator.hardwareConcurrency : 4;
    const memGb = typeof navigator !== 'undefined' && navigator.deviceMemory ? navigator.deviceMemory : 8;

    if (lowRe.test(rendererStr) || maxTexUnits <= 8 || cores <= 2 || memGb <= 2) {
      isSoftware = lowRe.test(rendererStr);
      return { tier: 'low', rendererName: rendererStr || 'Software / Low-Spec WebGL', isSoftware };
    }
    if (midRe.test(rendererStr) || cores <= 6 || memGb <= 4) {
      return { tier: 'medium', rendererName: rendererStr || 'Integrated WebGL', isSoftware: false };
    }
    return { tier: 'high', rendererName: rendererStr || 'Dedicated Hardware WebGL', isSoftware: false };
  }

  function createPnlTextures() {
    if (typeof THREE === 'undefined') return null;
    const makeTex = (pattern) => {
      const size = 256;
      const cvs = document.createElement('canvas');
      cvs.width = size;
      cvs.height = size;
      const ctx = cvs.getContext('2d');
      ctx.fillStyle = '#c8d6e5';
      ctx.fillRect(0, 0, size, size);

      if (pattern === 1) {
        // + ON: Crisp glowing circuit chevrons & scanlines
        ctx.fillStyle = '#e8fff5';
        ctx.fillRect(0, 0, size, size);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
        ctx.lineWidth = 3;
        for (let y = 0; y < size; y += 32) {
          ctx.beginPath();
          for (let x = 0; x <= size; x += 32) {
            const py = y + ((x / 32) % 2 === 0 ? 6 : 22);
            if (x === 0) ctx.moveTo(x, py);
            else ctx.lineTo(x, py);
          }
          ctx.stroke();
        }
        ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
        for (let y = 4; y < size; y += 8) ctx.fillRect(0, y, size, 1.5);
      } else if (pattern === 2) {
        // LIVE IO: High-contrast optical wave bars + telemetry ticks
        ctx.fillStyle = '#d9fbff';
        ctx.fillRect(0, 0, size, size);
        for (let i = 0; i < size; i += 24) {
          ctx.fillStyle = i % 48 === 0 ? 'rgba(255,255,255,0.65)' : 'rgba(180,245,255,0.28)';
          ctx.fillRect(0, i, size, 10);
        }
        ctx.strokeStyle = 'rgba(255,255,255,0.45)';
        ctx.lineWidth = 2;
        for (let x = 16; x < size; x += 32) {
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, size);
          ctx.stroke();
        }
      } else if (pattern === 3) {
        // ~ STBY: Precision polar reticle calibration grid
        ctx.fillStyle = '#fef3c7';
        ctx.fillRect(0, 0, size, size);
        ctx.strokeStyle = 'rgba(255,255,255,0.62)';
        ctx.lineWidth = 2;
        for (let i = 0; i < size; i += 32) {
          ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, size); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(size, i); ctx.stroke();
        }
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        for (let x = 16; x < size; x += 32) {
          for (let y = 16; y < size; y += 32) {
            ctx.beginPath(); ctx.arc(x, y, 2.5, 0, TAU); ctx.fill();
          }
        }
      } else {
        // - OFF: Crisp 45-degree diagonal hazard hatch (instant visual contrast)
        ctx.fillStyle = '#9ea8b8';
        ctx.fillRect(0, 0, size, size);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.42)';
        ctx.lineWidth = 10;
        for (let d = -size; d < size * 2; d += 28) {
          ctx.beginPath();
          ctx.moveTo(d, 0);
          ctx.lineTo(d - size, size);
          ctx.stroke();
        }
      }

      const tex = new THREE.CanvasTexture(cvs);
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(0.55, 0.55);
      tex.anisotropy = gpuTier === 'high' ? 4 : 1;
      tex.needsUpdate = true;
      return tex;
    };

    return {
      1: makeTex(1),
      2: makeTex(2),
      3: makeTex(3),
      4: makeTex(4)
    };
  }

  function createCorePlasmaTexture() {
    const size = 256;
    const cvs = document.createElement('canvas');
    cvs.width = size;
    cvs.height = size;
    const ctx = cvs.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, size, size);
    grad.addColorStop(0, '#0ea5e9');
    grad.addColorStop(0.35, '#fbbf24');
    grad.addColorStop(0.7, '#38bdf8');
    grad.addColorStop(1, '#818cf8');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    for (let y = 0; y < size; y += 8) {
      ctx.fillStyle = `rgba(255,255,255,${0.12 + 0.14 * Math.sin(y * 0.25)})`;
      ctx.fillRect(0, y, size, 3);
    }
    const tex = new THREE.CanvasTexture(cvs);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.needsUpdate = true;
    return tex;
  }

  function createParticleSpriteTexture() {
    const size = 64;
    const cvs = document.createElement('canvas');
    cvs.width = size;
    cvs.height = size;
    const ctx = cvs.getContext('2d');
    const half = size * 0.5;
    const g = ctx.createRadialGradient(half, half, 0, half, half, half);
    g.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
    g.addColorStop(0.24, 'rgba(224, 248, 255, 0.85)');
    g.addColorStop(0.58, 'rgba(56, 189, 248, 0.26)');
    g.addColorStop(1, 'rgba(0, 0, 0, 0.0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(cvs);
    tex.needsUpdate = true;
    return tex;
  }

  function createHologramEnvMap(renderer) {
    try {
      const pmrem = new THREE.PMREMGenerator(renderer);
      pmrem.compileEquirectangularShader();
      const envScene = new THREE.Scene();
      envScene.background = new THREE.Color(0x02050f);

      const domeGeo = new THREE.TorusGeometry(6.2, 0.24, 10, 48);
      const domeCyan = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.35, 1.45, 2.2) });
      const ringTop = new THREE.Mesh(domeGeo, domeCyan);
      ringTop.position.set(0, 5.4, 0);
      ringTop.rotation.x = Math.PI * 0.5;
      envScene.add(ringTop);

      const horizonGeo = new THREE.TorusGeometry(8.5, 0.14, 8, 56);
      const horizonMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.18, 0.65, 1.35) });
      const ringHorizon = new THREE.Mesh(horizonGeo, horizonMat);
      ringHorizon.position.set(0, 0.4, 0);
      ringHorizon.rotation.x = Math.PI * 0.5;
      envScene.add(ringHorizon);

      const stripGeo = new THREE.BoxGeometry(6.4, 0.42, 0.42);
      const keyStripMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 2.5, 2.8) });
      const keyStrip = new THREE.Mesh(stripGeo, keyStripMat);
      keyStrip.position.set(3.2, 6.2, 4.8);
      keyStrip.lookAt(0, 0, 0);
      envScene.add(keyStrip);

      const goldSpotGeo = new THREE.SphereGeometry(1.35, 14, 14);
      const goldMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.1, 1.45, 0.32) });
      const goldOrb = new THREE.Mesh(goldSpotGeo, goldMat);
      goldOrb.position.set(-7.2, 4.2, 4.2);
      envScene.add(goldOrb);

      const violetMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.95, 0.45, 2.1) });
      const violetOrb = new THREE.Mesh(goldSpotGeo, violetMat);
      violetOrb.position.set(7.2, -1.8, -5.2);
      envScene.add(violetOrb);

      const rt = pmrem.fromScene(envScene, 0.028);
      domeGeo.dispose();
      domeCyan.dispose();
      horizonGeo.dispose();
      horizonMat.dispose();
      stripGeo.dispose();
      keyStripMat.dispose();
      goldSpotGeo.dispose();
      goldMat.dispose();
      violetMat.dispose();
      pmrem.dispose();
      return rt;
    } catch (_) {
      return null;
    }
  }

  function createBaseFieldMaterial() {
    return new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uEnergy: { value: 0.72 },
        uBurst: { value: 0 },
        uColor: { value: new THREE.Color(0x38bdf8) }
      },
      vertexShader: `
        varying vec3 vPos;
        void main() {
          vPos = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform float uEnergy;
        uniform float uBurst;
        uniform vec3 uColor;
        varying vec3 vPos;
        void main() {
          float r = length(vPos.xz);
          float ang = atan(vPos.z, vPos.x);
          float edgeFade = smoothstep(5.15, 4.15, r) * smoothstep(0.68, 0.92, r);
          float wave = 0.5 + 0.5 * sin(r * 14.0 - uTime * (2.6 + uBurst * 4.0));
          float ring1 = smoothstep(0.025, 0.0, abs(r - 2.02));
          float ring2 = smoothstep(0.028, 0.0, abs(r - 3.34));
          float ring3 = smoothstep(0.035, 0.0, abs(r - 4.46));
          float radar = pow(max(0.0, cos(ang + uTime * 0.75)), 18.0);
          float ticks = smoothstep(0.92, 0.99, cos(ang * 36.0)) * smoothstep(3.9, 4.5, r);
          float a = edgeFade * (0.04 + wave * 0.055 + radar * 0.14 + (ring1 + ring2 + ring3) * 0.34 + ticks * 0.25);
          a *= (0.78 + 0.32 * uEnergy + uBurst * 0.45);
          vec3 col = mix(uColor, vec3(0.95, 0.99, 1.0), (ring3 + radar * 0.35) * 0.5);
          gl_FragColor = vec4(col * (1.15 + uBurst * 0.6), clamp(a, 0.0, 0.72));
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false
    });
  }

  function createEmitterConeMaterial() {
    return new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uEnergy: { value: 0.72 },
        uColor: { value: new THREE.Color(0x38bdf8) }
      },
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vViewPos;
        varying vec3 vNorm;
        void main() {
          vUv = uv;
          vNorm = normalize(normalMatrix * normal);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vViewPos = -mv.xyz;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform float uEnergy;
        uniform vec3 uColor;
        varying vec2 vUv;
        varying vec3 vViewPos;
        varying vec3 vNorm;
        void main() {
          float vert = smoothstep(0.0, 0.18, vUv.y) * pow(1.0 - vUv.y, 1.35);
          float fresnel = 1.0 - abs(dot(normalize(vNorm), normalize(vViewPos)));
          float scan = 0.65 + 0.35 * sin(vUv.y * 46.0 - uTime * 3.2);
          float a = vert * (0.03 + fresnel * 0.08) * scan * (0.75 + uEnergy * 0.35);
          gl_FragColor = vec4(uColor, clamp(a, 0.0, 0.18));
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide
    });
  }

  function createHiggsCoreShaderMaterial() {
    return new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uAudio: { value: 0 },
        uBurst: { value: 0 },
        uColor: { value: new THREE.Color(0x38bdf8) }
      },
      vertexShader: `
        varying vec3 vNormal;
        varying vec3 vViewPos;
        varying vec3 vObjPos;
        void main() {
          vObjPos = position;
          vNormal = normalize(normalMatrix * normal);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vViewPos = -mv.xyz;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform float uAudio;
        uniform float uBurst;
        uniform vec3 uColor;
        varying vec3 vNormal;
        varying vec3 vViewPos;
        varying vec3 vObjPos;
        void main() {
          vec3 n = normalize(vNormal);
          vec3 v = normalize(vViewPos);
          float rim = pow(1.0 - max(0.0, dot(n, v)), 2.35);
          float w1 = sin(vObjPos.y * 19.0 + uTime * 4.2) * cos(vObjPos.x * 17.0 - uTime * 3.1);
          float w2 = sin(vObjPos.z * 23.0 - uTime * 3.6 + w1 * 2.1);
          float filament = pow(clamp(0.5 + 0.5 * w2, 0.0, 1.0), 2.6);
          float swirl = 0.5 + 0.5 * sin((vObjPos.x + vObjPos.z) * 14.0 + uTime * 2.5);
          vec3 deepVoid = uColor * vec3(0.24, 0.36, 0.72);
          vec3 hotArc = mix(uColor * 1.4, vec3(1.0, 0.88, 0.62), filament * 0.72 + rim * 0.55);
          vec3 baseCol = mix(deepVoid, hotArc, clamp(filament * 0.82 + swirl * 0.16 + rim * 0.72, 0.0, 1.0));
          float boost = 0.85 + filament * 0.95 + uAudio * 0.90 + uBurst * 1.35 + rim * 1.30;
          gl_FragColor = vec4(baseCol * boost, 0.94);
        }
      `,
      transparent: true,
      toneMapped: false
    });
  }

  function createSliceInnerPlasmaMaterial(baseColor) {
    return new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: new THREE.Color(baseColor[0], baseColor[1], baseColor[2]) },
        uGlowColor: { value: new THREE.Color(0x38bdf8) },
        uHighlight: { value: 0.0 },
        uAudio: { value: 0.0 },
        uActive: { value: 0.5 },
        uPattern: { value: 1.0 }
      },
      vertexShader: `
        varying vec3 vLocal;
        varying vec3 vNorm;
        varying vec3 vViewDir;
        void main() {
          vLocal = position;
          vNorm = normalize(normalMatrix * normal);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vViewDir = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform vec3 uColor;
        uniform vec3 uGlowColor;
        uniform float uHighlight;
        uniform float uAudio;
        uniform float uActive;
        uniform float uPattern;
        varying vec3 vLocal;
        varying vec3 vNorm;
        varying vec3 vViewDir;
        void main() {
          float r = length(vLocal.xz);
          float rim = pow(1.0 - abs(dot(normalize(vNorm), normalize(vViewDir))), 2.2);
          float pulse = 0.5 + 0.5 * sin(r * 11.5 - uTime * 3.6);
          float wave = 0.5 + 0.5 * sin(vLocal.y * 24.0 + r * 5.0 - uTime * 4.4);
          float stripe = (uPattern > 3.5) ? (0.35 + 0.65 * step(0.0, sin((vLocal.x + vLocal.z) * 18.0))) : 1.0;
          vec3 deepGem = uColor * vec3(0.46, 0.48, 0.54);
          vec3 mixCol = mix(deepGem, uGlowColor, clamp(rim * 0.55 + uHighlight * 0.34, 0.0, 0.78));
          float lum = (0.26 + uActive * 0.34 + uHighlight * 0.44 + uAudio * 0.28) * (0.76 + 0.20 * pulse + 0.14 * wave) * stripe;
          gl_FragColor = vec4(mixCol * lum, 1.0);
        }
      `,
      toneMapped: false
    });
  }

  function buildSliceBevelGeometry(rIn, rOut, a0, a1, isInner = false) {
    const cfg = getTierConfig();
    const span = Math.max(0.02, a1 - a0);
    const arcSegs = clamp(Math.ceil((span / TAU) * cfg.curveDivs), cfg.minArcSegs, isInner ? 28 : 48);
    const shape = new THREE.Shape();

    // Sample in (r * cos(a), -r * sin(a)) so after rotateX(-PI/2), vertices match slicePointToWorld(r cos a, ly, r sin a)
    shape.moveTo(rOut * Math.cos(a0), -rOut * Math.sin(a0));
    for (let i = 1; i <= arcSegs; i++) {
      const a = a0 + (span * i) / arcSegs;
      shape.lineTo(rOut * Math.cos(a), -rOut * Math.sin(a));
    }
    for (let i = arcSegs; i >= 0; i--) {
      const a = a0 + (span * i) / arcSegs;
      shape.lineTo(rIn * Math.cos(a), -rIn * Math.sin(a));
    }
    shape.closePath();

    const depth = isInner ? 0.68 : 0.94;
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth,
      bevelEnabled: !isInner || cfg.bevelSegments > 1,
      bevelThickness: isInner ? 0.018 : 0.036,
      bevelSize: isInner ? 0.014 : 0.024,
      bevelOffset: 0,
      bevelSegments: isInner ? 1 : cfg.bevelSegments,
      curveSegments: arcSegs
    });
    geo.translate(0, 0, -depth * 0.5);
    geo.rotateX(-PI * 0.5);
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    return geo;
  }

  function buildRingCollarGeometry(rIn, rOut) {
    const cfg = getTierConfig();
    const segs = cfg.coreSegments;
    const shape = new THREE.Shape();
    shape.absarc(0, 0, rOut, 0, TAU, false);
    const hole = new THREE.Path();
    hole.absarc(0, 0, rIn, 0, TAU, true);
    shape.holes.push(hole);

    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: 0.94,
      bevelEnabled: true,
      bevelThickness: 0.03,
      bevelSize: 0.018,
      bevelSegments: cfg.bevelSegments,
      curveSegments: segs
    });
    geo.translate(0, 0, -0.47);
    geo.rotateX(-PI * 0.5);
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    return geo;
  }

  function buildFloorGridGeometry() {
    const cfg = getTierConfig();
    const segs = gpuTier === 'low' ? 56 : 84;
    const pts = [];
    const radii = [0.82, 1.42, 2.02, 2.68, 3.34, 3.86, 4.46, 4.72];
    for (const r of radii) {
      for (let i = 0; i < segs; i++) {
        const a0 = (i / segs) * TAU;
        const a1 = ((i + 1) / segs) * TAU;
        pts.push(r * Math.cos(a0), 0, r * Math.sin(a0), r * Math.cos(a1), 0, r * Math.sin(a1));
      }
    }
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * TAU;
      const r0 = (i % 2 === 0) ? 0.82 : 2.02;
      pts.push(r0 * Math.cos(a), 0, r0 * Math.sin(a), 4.46 * Math.cos(a), 0, 4.46 * Math.sin(a));
    }
    for (let i = 0; i < 72; i++) {
      const a = (i / 72) * TAU;
      const tickLen = (i % 6 === 0) ? 0.24 : 0.11;
      pts.push(4.46 * Math.cos(a), 0, 4.46 * Math.sin(a), (4.46 + tickLen) * Math.cos(a), 0, (4.46 + tickLen) * Math.sin(a));
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    return geo;
  }

  // ---------------------------------------------------------------------------
  // Three.js WebGL Engine, Holographic Lighting, H0 Core & Slice Mesh Pool
  // ---------------------------------------------------------------------------

  function disposeObject3D(obj) {
    if (!obj) return;
    obj.traverse((child) => {
      if (child.geometry && typeof child.geometry.dispose === 'function') {
        child.geometry.dispose();
      }
      if (child.material) {
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        for (const m of mats) {
          if (m && typeof m.dispose === 'function') m.dispose();
        }
      }
    });
  }

  function disposeThreeResources() {
    disposeSliceBuffers(sliceModels.v);
    disposeSliceBuffers(sliceModels.o);
    disposeSliceBuffers(sliceModels.s);
    if (threePmremTarget) {
      threePmremTarget.dispose();
      threePmremTarget = null;
    }
    if (threePnlTextures) {
      Object.values(threePnlTextures).forEach((t) => t && t.dispose && t.dispose());
      threePnlTextures = null;
    }
    if (threeCoreTex) {
      threeCoreTex.dispose();
      threeCoreTex = null;
    }
    if (threeParticleTex) {
      threeParticleTex.dispose();
      threeParticleTex = null;
    }
    if (threeComposer) {
      try { threeComposer.dispose(); } catch (_) {}
      threeComposer = null;
    }
    threeRenderPass = null;
    threeBloomPass = null;
    threeOutputPass = null;
    if (threeScene) {
      disposeObject3D(threeScene);
    }
    if (threeRenderer) {
      try { threeRenderer.dispose(); } catch (_) {}
      threeRenderer = null;
    }
    threeScene = null;
    threeCamera = null;
    threeRaycaster = null;
    threePieRoot = null;
    threeCoreGroup = null;
    threeCorePlasma = null;
    threeCoreLattice = null;
    threeCoreShell = null;
    threeCoreHitMesh = null;
    threeCoreLight = null;
    threeFocusLight = null;
    threeBaseDisc = null;
    threeEmitterCone = null;
    threeGimbalRings = [];
    threeGridPlanesGroup = null;
    threeGridPlaneMeshes = [];
    threeParticlePoints = null;
    threeParticlePosAttr = null;
    threeParticleColAttr = null;
    threeEnergyLines = null;
    threeEnergyPosAttr = null;
    threeEnergyColAttr = null;
    threeCursorLines = null;
    threeCursorPosAttr = null;
    threeCursorColAttr = null;
    gl = null;
  }

  function applyAdaptiveGpuTier(nextTier, reason) {
    if (!GPU_TIER_CONFIG[nextTier] || gpuTier === nextTier) return;
    gpuTier = nextTier;
    const cfg = getTierConfig();
    activeParticleCount = cfg.particleLimit;
    if (threeParticlePoints && threeParticlePoints.geometry) {
      threeParticlePoints.geometry.setDrawRange(0, activeParticleCount);
    }
    if (threeScene) {
      threeScene.environment = cfg.usePmrem && threePmremTarget ? threePmremTarget.texture : null;
    }
    if (threeComposer && !cfg.useBloom) {
      try { threeComposer.dispose(); } catch (_) {}
      threeComposer = null;
      threeRenderPass = null;
      threeBloomPass = null;
      threeOutputPass = null;
    } else if (threeBloomPass && cfg.useBloom) {
      threeBloomPass.strength = cfg.bloomStrength;
      threeBloomPass.radius = cfg.bloomRadius;
      threeBloomPass.threshold = cfg.bloomThreshold;
    }
    syncCanvasSize();
    renderSystemChips(true);
    if (reason) {
      pushLog('SYS', `Adaptive GPU scaling -> ${gpuTier.toUpperCase()} (${reason})`, 'info');
    }
  }

  function createSliceMeshObject(layer, rIn, rOut, a0, a1, baseColor, index) {
    if (!threePieRoot || typeof THREE === 'undefined') return null;
    const cfg = getTierConfig();
    const geo = buildSliceBevelGeometry(rIn, rOut, a0, a1, false);
    const edgeGeo = new THREE.EdgesGeometry(geo, cfg.edgeThreshold);

    const baseCol = new THREE.Color(baseColor[0], baseColor[1], baseColor[2]);
    const mat = cfg.usePhysicalMat
      ? new THREE.MeshPhysicalMaterial({
          color: baseCol.clone().multiplyScalar(0.86),
          emissive: baseCol.clone().multiplyScalar(0.11),
          emissiveIntensity: 0.24,
          metalness: 0.08,
          roughness: 0.04,
          transmission: gpuTier === 'high' ? 0.76 : 0.62,
          thickness: 1.18,
          ior: 1.56,
          dispersion: 0.6,
          attenuationColor: baseCol.clone(),
          attenuationDistance: 1.15,
          specularIntensity: 1.2,
          specularColor: new THREE.Color(0xe0f2fe),
          clearcoat: 1.0,
          clearcoatRoughness: 0.03,
          iridescence: 1.0,
          iridescenceIOR: 1.42,
          iridescenceThicknessRange: [140, 560],
          envMapIntensity: 2.35,
          transparent: false,
          opacity: 1.0,
          side: THREE.DoubleSide,
          depthWrite: true
        })
      : new THREE.MeshStandardMaterial({
          color: baseCol.clone().multiplyScalar(0.88),
          emissive: baseCol.clone().multiplyScalar(0.18),
          emissiveIntensity: 0.36,
          metalness: 0.26,
          roughness: 0.12,
          transparent: true,
          opacity: layer === 'v' ? 0.72 : (layer === 'o' ? 0.68 : 0.64),
          side: THREE.DoubleSide,
          depthWrite: true
        });

    const wedgeMesh = new THREE.Mesh(geo, mat);
    wedgeMesh.renderOrder = 3;

    let innerGeo = null;
    let innerMat = null;
    let innerMesh = null;
    if (cfg.usePhysicalMat && (rOut - rIn) > 0.22 && (a1 - a0) > 0.05) {
      innerGeo = buildSliceBevelGeometry(rIn + 0.055, rOut - 0.055, a0 + 0.012, a1 - 0.012, true);
      innerMat = createSliceInnerPlasmaMaterial(baseColor);
      innerMesh = new THREE.Mesh(innerGeo, innerMat);
      innerMesh.renderOrder = 1;
    }

    const edgeMat = new THREE.LineBasicMaterial({
      color: baseCol.clone().lerp(new THREE.Color(0x67e8f9), 0.38),
      transparent: true,
      opacity: 0.34,
      blending: THREE.AdditiveBlending,
      toneMapped: false
    });
    const edgeLines = new THREE.LineSegments(edgeGeo, edgeMat);
    edgeLines.renderOrder = 4;
    wedgeMesh.add(edgeLines);

    const group = new THREE.Group();
    if (innerMesh) group.add(innerMesh);
    group.add(wedgeMesh);
    threePieRoot.add(group);

    return {
      group,
      wedgeMesh,
      material: mat,
      innerMesh,
      innerMaterial: innerMat,
      innerGeometry: innerGeo,
      edgeLines,
      edgeMaterial: edgeMat,
      geometry: geo,
      edgeGeometry: edgeGeo,
      isPhysicalGlass: cfg.usePhysicalMat,
      parity: index % 2 === 0 ? 1.04 : 0.92,
      lastPattern: 0
    };
  }

  function disposeSliceBuffers(list) {
    if (!Array.isArray(list)) return;
    for (const s of list) {
      if (s.mesh) {
        if (s.mesh.group && s.mesh.group.parent) {
          s.mesh.group.parent.remove(s.mesh.group);
        }
        if (s.mesh.geometry) s.mesh.geometry.dispose();
        if (s.mesh.edgeGeometry) s.mesh.edgeGeometry.dispose();
        if (s.mesh.innerGeometry) s.mesh.innerGeometry.dispose();
        if (s.mesh.material) s.mesh.material.dispose();
        if (s.mesh.innerMaterial) s.mesh.innerMaterial.dispose();
        if (s.mesh.edgeMaterial) s.mesh.edgeMaterial.dispose();
        if (s.mesh.wedgeMesh && s.mesh.wedgeMesh.userData) {
          s.mesh.wedgeMesh.userData.vosSlice = null;
        }
        s.mesh = null;
      }
    }
  }

  function initWebGL() {
    if (!els.webglCanvas || typeof THREE === 'undefined') {
      gl = null;
      return false;
    }

    if (threeRenderer) {
      disposeThreeResources();
    }

    const hwCores = typeof navigator !== 'undefined' && navigator.hardwareConcurrency ? navigator.hardwareConcurrency : 4;
    const hwMem = typeof navigator !== 'undefined' && navigator.deviceMemory ? navigator.deviceMemory : 8;
    const preferAA = hwCores > 2 && hwMem > 2;

    let renderer = null;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas: els.webglCanvas,
        alpha: true,
        antialias: preferAA,
        powerPreference: 'high-performance',
        preserveDrawingBuffer: false
      });
    } catch (_) {
      try {
        renderer = new THREE.WebGLRenderer({
          canvas: els.webglCanvas,
          alpha: true,
          antialias: false,
          powerPreference: 'default',
          preserveDrawingBuffer: false
        });
      } catch (__) {
        gl = null;
        return false;
      }
    }

    const rawCtx = renderer.getContext();
    if (!rawCtx) {
      try { renderer.dispose(); } catch (_) {}
      gl = null;
      return false;
    }

    threeRenderer = renderer;
    gl = rawCtx;

    const info = detectGraphicsTier(renderer);
    gpuTier = info.tier;
    gpuRendererName = info.rendererName;
    const cfg = getTierConfig();
    activeParticleCount = cfg.particleLimit;
    slowFrameStreak = 0;
    smoothedFrameMs = 16.7;

    renderer.setClearColor(0x020612, 1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.18;
    renderer.sortObjects = true;

    threeScene = new THREE.Scene();
    threeScene.background = new THREE.Color(0x020612);
    threeScene.fog = new THREE.FogExp2(0x020612, 0.020);
    const aspect = Math.max(0.4, viewWidth / Math.max(1, viewHeight));
    threeCamera = new THREE.PerspectiveCamera(38, aspect, 0.2, 65);
    threeRaycaster = new THREE.Raycaster();
    threeProjViewMat = new THREE.Matrix4();
    threeProjViewInvMat = new THREE.Matrix4();
    threeRayNdc = new THREE.Vector2();

    // Procedural studio + neon PMREM environment reflections for refractive crystal wedges
    if (cfg.usePmrem) {
      threePmremTarget = createHologramEnvMap(renderer);
      if (threePmremTarget) {
        threeScene.environment = threePmremTarget.texture;
      }
    }

    threePnlTextures = createPnlTextures();
    threeCoreTex = createCorePlasmaTexture();
    threeParticleTex = createParticleSpriteTexture();

    // Multi-point dark-studio holographic light rig + dynamic hover/focus accent light
    const hemi = new THREE.HemisphereLight(0x38bdf8, 0x040712, 0.42);
    threeScene.add(hemi);
    const ambient = new THREE.AmbientLight(0x1e3a8a, 0.12);
    threeScene.add(ambient);
    const keyLight = new THREE.DirectionalLight(0xe0f2fe, 1.08);
    keyLight.position.set(5.8, 9.8, 6.4);
    threeScene.add(keyLight);
    const rimLight = new THREE.DirectionalLight(0x818cf8, 0.85);
    rimLight.position.set(-6.8, 4.4, -6.0);
    threeScene.add(rimLight);
    const underFill = new THREE.DirectionalLight(0x0ea5e9, 0.45);
    underFill.position.set(0, -6.5, 3.2);
    threeScene.add(underFill);
    threeFocusLight = new THREE.PointLight(0x38bdf8, 1.35, 7.5, 1.6);
    threeFocusLight.position.set(0, 1.2, 2.5);
    threeScene.add(threeFocusLight);

    // Holographic Interferometry Floor Projection Disc + Volumetric Emitter Cone
    const discGeo = new THREE.PlaneGeometry(10.6, 10.6);
    discGeo.rotateX(-PI * 0.5);
    threeBaseDisc = new THREE.Mesh(discGeo, createBaseFieldMaterial());
    threeBaseDisc.position.set(0, Y_SEPARATED_S - 0.56, 0);
    threeBaseDisc.renderOrder = 0;
    threeScene.add(threeBaseDisc);

    const coneGeo = new THREE.CylinderGeometry(4.65, 0.76, 3.85, 64, 1, true);
    threeEmitterCone = new THREE.Mesh(coneGeo, createEmitterConeMaterial());
    threeEmitterCone.position.set(0, 1.38 + (Y_SEPARATED_S - 0.56), 0);
    threeEmitterCone.renderOrder = 1;
    threeScene.add(threeEmitterCone);

    // 1. Calibration Polar Detector Grid Planes
    threeGridPlanesGroup = new THREE.Group();
    threeGridPlaneMeshes = [];
    const floorGeo = buildFloorGridGeometry();
    for (let i = 0; i < 3; i++) {
      const mat = new THREE.LineBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.16,
        depthWrite: false
      });
      const lines = new THREE.LineSegments(floorGeo, mat);
      lines.renderOrder = 0;
      threeGridPlanesGroup.add(lines);
      threeGridPlaneMeshes.push(lines);
    }
    threeScene.add(threeGridPlanesGroup);

    // 2. Sculpted H0 Higgs Singularity Core (GLSL Plasma) + Containment Collar + 3D Gyroscope Gimbals + Orbit Nodes
    threeCoreGroup = new THREE.Group();

    const sphereGeo = new THREE.SphereGeometry(0.32, cfg.coreSegments, Math.max(14, Math.floor(cfg.coreSegments * 0.75)));
    threeCorePlasma = new THREE.Mesh(sphereGeo, createHiggsCoreShaderMaterial());
    threeCorePlasma.renderOrder = 3;
    threeCoreGroup.add(threeCorePlasma);

    const latticeGeo = new THREE.IcosahedronGeometry(0.42, 1);
    const latticeMat = new THREE.MeshBasicMaterial({
      color: 0xfde047,
      wireframe: true,
      transparent: true,
      opacity: 0.45,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false
    });
    threeCoreLattice = new THREE.Mesh(latticeGeo, latticeMat);
    threeCoreLattice.renderOrder = 4;
    threeCoreGroup.add(threeCoreLattice);

    const collarGeo = buildRingCollarGeometry(0.56, 0.72);
    const collarEdgeGeo = new THREE.EdgesGeometry(collarGeo, 20);
    const collarMat = cfg.usePhysicalMat
      ? new THREE.MeshPhysicalMaterial({
          color: 0x061024,
          emissive: 0x0ea5e9,
          emissiveIntensity: 0.12,
          roughness: 0.04,
          metalness: 0.24,
          transmission: 0.88,
          ior: 1.56,
          thickness: 0.35,
          clearcoat: 1.0,
          clearcoatRoughness: 0.03,
          iridescence: 0.90,
          transparent: true,
          opacity: 0.28,
          side: THREE.DoubleSide,
          depthWrite: false
        })
      : new THREE.MeshStandardMaterial({
          color: 0x061024,
          emissive: 0x0ea5e9,
          emissiveIntensity: 0.16,
          metalness: 0.55,
          roughness: 0.14,
          transparent: true,
          opacity: 0.22,
          side: THREE.DoubleSide,
          depthWrite: false
        });
    threeCoreShell = new THREE.Mesh(collarGeo, collarMat);
    threeCoreShell.renderOrder = 4;
    const collarEdges = new THREE.LineSegments(
      collarEdgeGeo,
      new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.34, blending: THREE.AdditiveBlending, toneMapped: false })
    );
    threeCoreShell.add(collarEdges);
    threeCoreGroup.add(threeCoreShell);

    // 3 Volumetric 3D Boson Gyroscope Gimbal Torus Rings with HDR Orbiting Nodes
    threeGimbalRings = [];
    const gimbalDefs = [
      { r: 0.76, tiltX: 0.58, tiltZ: 0.25, speed: 1.15, hex: 0x5eead4 },
      { r: 0.87, tiltX: -0.66, tiltZ: 0.52, speed: -0.92, hex: 0xfde047 },
      { r: 0.98, tiltX: 1.08, tiltZ: -0.44, speed: 0.74, hex: 0xa5b4fc }
    ];
    const torusSegs = gpuTier === 'low' ? 36 : 64;
    const nodeGeo = new THREE.SphereGeometry(0.036, 10, 10);
    for (const def of gimbalDefs) {
      const gGeo = new THREE.TorusGeometry(def.r, 0.011, 8, torusSegs);
      const gMat = new THREE.MeshBasicMaterial({
        color: def.hex,
        transparent: true,
        opacity: 0.82,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false
      });
      const ring = new THREE.Mesh(gGeo, gMat);
      ring.rotation.set(def.tiltX, 0, def.tiltZ);
      ring.userData = { baseTiltX: def.tiltX, baseTiltZ: def.tiltZ, speed: def.speed };

      const nodeMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
      const n1 = new THREE.Mesh(nodeGeo, nodeMat);
      n1.position.set(def.r, 0, 0);
      const n2 = new THREE.Mesh(nodeGeo, nodeMat);
      n2.position.set(-def.r, 0, 0);
      ring.add(n1, n2);

      threeCoreGroup.add(ring);
      threeGimbalRings.push(ring);
    }

    threeCoreLight = new THREE.PointLight(0x38bdf8, 1.8, 13, 1.4);
    threeCoreGroup.add(threeCoreLight);

    // Invisible exact cylindrical hit volume for Raycaster precision
    const hitGeo = new THREE.CylinderGeometry(0.74, 0.74, 1.0, 18);
    const hitMat = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      depthWrite: false,
      colorWrite: false
    });
    threeCoreHitMesh = new THREE.Mesh(hitGeo, hitMat);
    threeCoreHitMesh.userData.isCoreHit = true;
    threeCoreGroup.add(threeCoreHitMesh);
    threeScene.add(threeCoreGroup);

    // 3. Rotating V / O / S Holographic Pie Tubes Container
    threePieRoot = new THREE.Group();
    threeScene.add(threePieRoot);

    // 4. Soft-Glow Quantum Particle Cloud (THREE.Points with adaptive drawRange)
    const pGeo = new THREE.BufferGeometry();
    threeParticlePosAttr = new THREE.BufferAttribute(particlePosBuf, 3);
    threeParticlePosAttr.setUsage(THREE.DynamicDrawUsage);
    threeParticleColAttr = new THREE.BufferAttribute(particleColBuf, 3);
    threeParticleColAttr.setUsage(THREE.DynamicDrawUsage);
    pGeo.setAttribute('position', threeParticlePosAttr);
    pGeo.setAttribute('color', threeParticleColAttr);
    pGeo.setDrawRange(0, activeParticleCount);

    const pMat = new THREE.PointsMaterial({
      size: 0.16,
      sizeAttenuation: true,
      map: threeParticleTex,
      vertexColors: true,
      transparent: true,
      opacity: 0.92,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    threeParticlePoints = new THREE.Points(pGeo, pMat);
    threeParticlePoints.frustumCulled = false;
    threeParticlePoints.renderOrder = 1;
    threeScene.add(threeParticlePoints);

    // 5. Dynamic Additive Higgs Wave Contours, Decay Tracks & V->O->S Conduits
    const lGeo = new THREE.BufferGeometry();
    threeEnergyPosAttr = new THREE.BufferAttribute(energyLinePosBuf, 3);
    threeEnergyPosAttr.setUsage(THREE.DynamicDrawUsage);
    threeEnergyColAttr = new THREE.BufferAttribute(energyLineColBuf, 3);
    threeEnergyColAttr.setUsage(THREE.DynamicDrawUsage);
    lGeo.setAttribute('position', threeEnergyPosAttr);
    lGeo.setAttribute('color', threeEnergyColAttr);
    lGeo.setDrawRange(0, 0);

    const lMat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 1.0,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    threeEnergyLines = new THREE.LineSegments(lGeo, lMat);
    threeEnergyLines.frustumCulled = false;
    threeEnergyLines.renderOrder = 5;
    threeScene.add(threeEnergyLines);

    // 6. Foreground Cursor Laser Probe Beacon (rendered over pie geometry cleanly)
    const cGeo = new THREE.BufferGeometry();
    threeCursorPosAttr = new THREE.BufferAttribute(cursorLinePosBuf, 3);
    threeCursorPosAttr.setUsage(THREE.DynamicDrawUsage);
    threeCursorColAttr = new THREE.BufferAttribute(cursorLineColBuf, 3);
    threeCursorColAttr.setUsage(THREE.DynamicDrawUsage);
    cGeo.setAttribute('position', threeCursorPosAttr);
    cGeo.setAttribute('color', threeCursorColAttr);
    cGeo.setDrawRange(0, 0);

    const cMat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 1.0,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false
    });
    threeCursorLines = new THREE.LineSegments(cGeo, cMat);
    threeCursorLines.frustumCulled = false;
    threeCursorLines.renderOrder = 12;
    threeScene.add(threeCursorLines);

    // 7. HDR EffectComposer + Selective Optical UnrealBloomPass + ACES OutputPass
    threeComposer = null;
    if (cfg.useBloom) {
      try {
        const wPx = Math.max(200, Math.round(viewWidth * dpr));
        const hPx = Math.max(200, Math.round(viewHeight * dpr));
        const rt = new THREE.WebGLRenderTarget(wPx, hPx, {
          type: THREE.HalfFloatType,
          samples: cfg.samples || 0
        });
        threeComposer = new EffectComposer(renderer, rt);
        threeComposer.setPixelRatio(dpr);
        threeComposer.setSize(viewWidth, viewHeight);
        threeRenderPass = new RenderPass(threeScene, threeCamera);
        threeBloomPass = new UnrealBloomPass(
          new THREE.Vector2(viewWidth, viewHeight),
          cfg.bloomStrength,
          cfg.bloomRadius,
          cfg.bloomThreshold
        );
        threeOutputPass = new OutputPass();
        threeComposer.addPass(threeRenderPass);
        threeComposer.addPass(threeBloomPass);
        threeComposer.addPass(threeOutputPass);
      } catch (_) {
        if (threeComposer) {
          try { threeComposer.dispose(); } catch (__) {}
        }
        threeComposer = null;
        threeRenderPass = null;
        threeBloomPass = null;
        threeOutputPass = null;
      }
    }

    syncCanvasSize();
    return true;
  }

  // ---------------------------------------------------------------------------
  // Volumetric Higgs Particle Field & Decay Collision Simulation
  // ---------------------------------------------------------------------------

  function initEnergyField() {
    particles.length = 0;
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      // Interleave roles evenly so adaptive GPU tier drawRange preserves all visual effects
      const slot = i % 10;
      let kind = 'chamber';
      if (slot >= 5 && slot <= 7) kind = 'jet';
      else if (slot === 8) kind = 'streamer';
      else if (slot === 9) kind = 'cursor';

      const angle = (i * 2.399963) % TAU; // golden-angle distribution
      const rndA = ((Math.sin(i * 12.9898) * 43758.5453) % 1 + 1) % 1;
      const rndB = ((Math.sin(i * 78.233) * 19341.123) % 1 + 1) % 1;
      const rndC = ((Math.sin(i * 45.164) * 91823.71) % 1 + 1) % 1;

      particles.push({
        kind,
        angle,
        r: kind === 'chamber' ? (0.9 + rndA * 3.6) : (kind === 'streamer' ? (0.14 + rndA * 0.55) : rndA * 4.5),
        yFrac: rndB * 2 - 1,
        progress: rndA,
        speed: 0.25 + rndC * 0.85,
        curvature: (rndB - 0.5) * 2.2,
        tilt: (rndC - 0.5) * 0.9,
        size: kind === 'jet' ? (1.4 + rndC * 2.1) : (kind === 'cursor' ? (1.3 + rndA * 1.6) : (0.9 + rndB * 1.6)),
        tone: rndA
      });
    }

    decayTracks.length = 0;
    for (let i = 0; i < DECAY_TRACK_COUNT; i++) {
      const a0 = (i / DECAY_TRACK_COUNT) * TAU + (i % 2) * 0.14;
      const isPhotonPair = (i % 3 === 0);
      decayTracks.push({
        baseAngle: a0,
        elevation: Math.sin(i * 1.9) * 0.72,
        curve: isPhotonPair ? 0.12 * (i % 2 ? 1 : -1) : (0.85 * (i % 2 ? 1 : -1)),
        speed: 0.75 + (i % 5) * 0.22,
        phase: (i * 0.37) % 1,
        isGold: isPhotonPair || (i % 4 === 1)
      });
    }
  }

  function triggerEnergyBurst(intensity = 1.0) {
    anim.burstEnergy = Math.min(2.6, Math.max(anim.burstEnergy, 0) + intensity);
  }

  function pushEnergyLine(x0, y0, z0, x1, y1, z1, r, g, b, a0, a1 = a0) {
    if (threeEnergyVertCount + 2 <= MAX_ENERGY_LINE_VERTS) {
      const p3 = threeEnergyVertCount * 3;
      energyLinePosBuf[p3] = x0;     energyLinePosBuf[p3 + 1] = y0; energyLinePosBuf[p3 + 2] = z0;
      energyLinePosBuf[p3 + 3] = x1; energyLinePosBuf[p3 + 4] = y1; energyLinePosBuf[p3 + 5] = z1;

      energyLineColBuf[p3] = r * a0;     energyLineColBuf[p3 + 1] = g * a0; energyLineColBuf[p3 + 2] = b * a0;
      energyLineColBuf[p3 + 3] = r * a1; energyLineColBuf[p3 + 4] = g * a1; energyLineColBuf[p3 + 5] = b * a1;
      threeEnergyVertCount += 2;
    }

    const idx = energyLineVertCount * 7;
    if (idx + 14 <= energyLineData.length) {
      energyLineData[idx] = x0;     energyLineData[idx + 1] = y0; energyLineData[idx + 2] = z0;
      energyLineData[idx + 3] = r;  energyLineData[idx + 4] = g;  energyLineData[idx + 5] = b;  energyLineData[idx + 6] = a0;
      energyLineData[idx + 7] = x1; energyLineData[idx + 8] = y1; energyLineData[idx + 9] = z1;
      energyLineData[idx + 10] = r; energyLineData[idx + 11] = g; energyLineData[idx + 12] = b; energyLineData[idx + 13] = a1;
      energyLineVertCount += 2;
    }
  }

  function pushCursorLine(x0, y0, z0, x1, y1, z1, r, g, b, a0, a1 = a0) {
    if ((threeCursorVertCount + 2) * 3 <= cursorLinePosBuf.length) {
      const p3 = threeCursorVertCount * 3;
      cursorLinePosBuf[p3] = x0;     cursorLinePosBuf[p3 + 1] = y0; cursorLinePosBuf[p3 + 2] = z0;
      cursorLinePosBuf[p3 + 3] = x1; cursorLinePosBuf[p3 + 4] = y1; cursorLinePosBuf[p3 + 5] = z1;

      cursorLineColBuf[p3] = r * a0;     cursorLineColBuf[p3 + 1] = g * a0; cursorLineColBuf[p3 + 2] = b * a0;
      cursorLineColBuf[p3 + 3] = r * a1; cursorLineColBuf[p3 + 4] = g * a1; cursorLineColBuf[p3 + 5] = b * a1;
      threeCursorVertCount += 2;
    }
    pushEnergyLine(x0, y0, z0, x1, y1, z1, r, g, b, a0, a1);
  }

  function stepEnergyField(dt) {
    const coreY = (anim.yV + anim.yS) * 0.5;
    const flatSpan = Math.max(0.22, Math.abs(anim.yV - anim.yS) * 0.5 + 0.35);
    const energy = anim.energyLevel;
    const burst = anim.burstEnergy;
    const speedMul = 0.75 + energy * 0.95 + burst * 1.4;
    const t = anim.clock;
    const pCount = gl ? activeParticleCount : PARTICLE_COUNT;

    // 1. Update volumetric 3D quantum particles (tiered to match GPU profile)
    for (let i = 0; i < pCount; i++) {
      const p = particles[i];
      let x = 0, y = 0, z = 0;
      let cr = 0.22, cg = 0.85, cb = 1.0, ca = 0.55;
      let sz = p.size * (0.9 + 0.32 * energy + 0.35 * burst);

      if (p.kind === 'chamber') {
        p.angle = (p.angle + dt * (0.28 + 1.15 / Math.max(0.8, p.r)) * p.speed * speedMul) % TAU;
        const waveY = Math.sin(p.angle * 3.0 + t * 2.4 + p.r) * 0.18 * energy;
        const rMod = p.r + Math.sin(t * 1.7 + i) * 0.08;
        x = rMod * Math.cos(p.angle);
        z = rMod * Math.sin(p.angle);
        y = coreY + p.yFrac * flatSpan + waveY;

        if (p.tone < 0.34) { cr = 0.20; cg = 0.86; cb = 1.0; }
        else if (p.tone < 0.64) { cr = 1.0; cg = 0.82; cb = 0.32; }
        else if (p.tone < 0.85) { cr = 0.56; cg = 0.52; cb = 1.0; }
        else { cr = 0.20; cg = 0.92; cb = 0.66; }

        ca = (0.34 + 0.28 * Math.sin(t * 3.0 + i * 0.7)) * clamp(0.65 + energy * 0.4 + burst * 0.45, 0.4, 1.0);
      } else if (p.kind === 'jet') {
        p.progress += dt * (0.32 + p.speed * 0.42) * speedMul;
        if (p.progress >= 1.0) p.progress -= 1.0;
        const pr = p.progress;
        const radius = 0.32 + pr * 4.25;
        const theta = p.angle + anim.spinAngle * 0.4 + pr * pr * p.curvature * 1.4;
        x = radius * Math.cos(theta);
        z = radius * Math.sin(theta);
        y = coreY + p.tilt * Math.sin(pr * PI) * flatSpan * 0.95;

        if (p.tone < 0.48) { cr = 1.0; cg = 0.85; cb = 0.34; }
        else { cr = 0.28; cg = 0.90; cb = 1.0; }
        ca = Math.sin(pr * PI) * (0.58 + 0.40 * clamp(energy + burst, 0, 1.5));
        sz *= (0.75 + 0.55 * (1.0 - pr * 0.5));
      } else if (p.kind === 'streamer') {
        p.progress += dt * (0.35 + p.speed * 0.45) * speedMul;
        if (p.progress >= 1.0) p.progress -= 1.0;
        const pr = p.progress;
        const ang = p.angle + t * (1.6 + energy);
        const rad = p.r * (1.0 - 0.35 * Math.sin(pr * PI));
        x = rad * Math.cos(ang);
        z = rad * Math.sin(ang);
        y = lerp(anim.yS - 0.55, anim.yV + 0.55, pr);

        cr = state.voiceState === 'listening' ? 0.24 : 0.30;
        cg = state.voiceState === 'listening' ? 0.94 : 0.84;
        cb = state.voiceState === 'listening' ? 0.68 : 1.0;
        ca = Math.sin(pr * PI) * 0.72;
      } else {
        p.angle = (p.angle + dt * (2.6 + p.speed * 2.2)) % TAU;
        const blend = pointer.activeBlend;
        if (blend > 0.02) {
          const orbitR = 0.14 + (p.progress * 0.46) * (1.0 + 0.25 * Math.sin(t * 5.0 + i));
          x = pointer.smoothWorld[0] + orbitR * Math.cos(p.angle);
          z = pointer.smoothWorld[2] + orbitR * Math.sin(p.angle);
          y = pointer.smoothWorld[1] + Math.sin(p.angle * 2.0 + t * 4.0) * 0.14;
          cr = 1.0; cg = 0.86; cb = 0.38;
          ca = blend * 0.82;
          sz *= 1.15;
        } else {
          const rPark = 3.8 + p.progress * 0.7;
          x = rPark * Math.cos(p.angle * 0.2 + i);
          z = rPark * Math.sin(p.angle * 0.2 + i);
          y = coreY + p.yFrac * 0.4;
          cr = 0.22; cg = 0.76; cb = 0.98;
          ca = 0.16;
        }
      }

      const alphaC = clamp(ca, 0, 1);
      const p3 = i * 3;
      particlePosBuf[p3] = x;
      particlePosBuf[p3 + 1] = y;
      particlePosBuf[p3 + 2] = z;
      particleColBuf[p3] = cr * alphaC;
      particleColBuf[p3 + 1] = cg * alphaC;
      particleColBuf[p3 + 2] = cb * alphaC;

      const off = i * 8;
      particleData[off] = x;
      particleData[off + 1] = y;
      particleData[off + 2] = z;
      particleData[off + 3] = cr;
      particleData[off + 4] = cg;
      particleData[off + 5] = cb;
      particleData[off + 6] = alphaC;
      particleData[off + 7] = sz;
    }

    if (threeParticlePosAttr && threeParticleColAttr) {
      threeParticlePosAttr.needsUpdate = true;
      threeParticleColAttr.needsUpdate = true;
    }

    // 2. Build dynamic additive 3D energy lines (Higgs wave contours, decay arcs, conduits & cursor probe)
    energyLineVertCount = 0;
    threeEnergyVertCount = 0;
    threeCursorVertCount = 0;

    // 2a. Higgs Potential ("Mexican Hat") dynamic energy wave contours at V, O, S boundaries
    const waveRadii = [1.42, 2.68, 3.86];
    const waveSegs = gpuTier === 'low' ? 36 : 56;
    for (let wIdx = 0; wIdx < waveRadii.length; wIdx++) {
      const wr = waveRadii[wIdx];
      const baseY = wIdx === 0 ? anim.yV - 0.16 : (wIdx === 1 ? -0.16 : anim.yS - 0.16);
      const amp = 0.045 + energy * 0.045 + burst * 0.06;
      for (let s = 0; s < waveSegs; s++) {
        const a0 = (s / waveSegs) * TAU;
        const a1 = ((s + 1) / waveSegs) * TAU;
        const x0 = wr * Math.cos(a0), z0 = wr * Math.sin(a0);
        const x1 = wr * Math.cos(a1), z1 = wr * Math.sin(a1);
        const y0 = baseY + Math.sin(a0 * 6.0 - t * 2.8 + wIdx) * amp;
        const y1 = baseY + Math.sin(a1 * 6.0 - t * 2.8 + wIdx) * amp;
        const col = wIdx === 1 ? [0.52, 0.56, 1.0] : (wIdx === 2 ? [0.22, 0.88, 0.68] : [0.22, 0.84, 1.0]);
        pushEnergyLine(x0, y0, z0, x1, y1, z1, col[0], col[1], col[2], 0.26 + 0.18 * energy);
      }
    }

    // 2b. Helical Higgs Boson Decay Collision Trajectories (H0 -> gamma gamma / 4l)
    const decaySegs = gpuTier === 'low' ? 10 : 14;
    for (let i = 0; i < decayTracks.length; i++) {
      const tr = decayTracks[i];
      const pulseCenter = ((t * tr.speed * (0.7 + 0.6 * energy + burst) + tr.phase) % 1.0);
      let prev = null;
      for (let s = 0; s <= decaySegs; s++) {
        const u = s / decaySegs;
        const rad = 0.24 + u * 4.18;
        const th = tr.baseAngle + anim.spinAngle * 0.35 + u * u * tr.curve;
        const px = rad * Math.cos(th);
        const pz = rad * Math.sin(th);
        const py = coreY + tr.elevation * Math.sin(u * PI) * flatSpan * 0.92;
        const cur = [px, py, pz];
        if (prev) {
          const dPulse = Math.abs(u - pulseCenter);
          const packet = Math.exp(-dPulse * dPulse * 38.0);
          const alpha = (0.09 + 0.12 * energy + packet * (0.48 + 0.36 * burst)) * (1.0 - u * 0.35);
          if (tr.isGold) {
            pushEnergyLine(prev[0], prev[1], prev[2], cur[0], cur[1], cur[2], 1.0, 0.84, 0.32, alpha);
          } else {
            pushEnergyLine(prev[0], prev[1], prev[2], cur[0], cur[1], cur[2], 0.24, 0.88, 1.0, alpha);
          }
        }
        prev = cur;
      }
    }

    // 2c. True 3D Volumetric V -> O -> S Energy Conduits for Active/Hovered/Selected Nodes
    const conduitDevIds = new Set(state.focusedDeviceIds);
    if (state.selectedDeviceId) conduitDevIds.add(state.selectedDeviceId);
    if (pointer.slice && pointer.slice.devId) conduitDevIds.add(pointer.slice.devId);

    for (const devId of conduitDevIds) {
      const sV = sliceModels.v.find((x) => x.devId === devId);
      const sO = sliceModels.o.find((x) => x.devId === devId);
      if (!sO) continue;
      const isVoice = state.focusedDeviceIds.includes(devId);
      const isHov = pointer.slice && pointer.slice.devId === devId;
      const col = isVoice ? [0.22, 0.92, 1.0] : (isHov ? [1.0, 0.85, 0.34] : [0.56, 0.62, 1.0]);
      const baseA = isVoice ? 0.86 : (isHov ? 0.78 : 0.45);

      const pts = [[0, coreY, 0]];
      if (sV && (state.soloLayer === 'all' || state.soloLayer === 'v')) {
        const dV = getSliceLiveTransform(sV);
        const rV = (sV.rIn + sV.rOut) * 0.5 + dV.pop;
        pts.push(slicePointToWorld(rV * Math.cos(sV.aMid), 0, rV * Math.sin(sV.aMid), anim.spinAngle, 0, 0, dV.y, dV.height));
      }
      if (state.soloLayer === 'all' || state.soloLayer === 'o') {
        const dO = getSliceLiveTransform(sO);
        const rO = (sO.rIn + sO.rOut) * 0.5 + dO.pop;
        pts.push(slicePointToWorld(rO * Math.cos(sO.aMid), 0, rO * Math.sin(sO.aMid), anim.spinAngle, 0, 0, dO.y, dO.height));
      }
      const sysKey = sysKeyForTool('', sO.dev);
      const sS = sliceModels.s.find((x) => x.sysKey === sysKey);
      if (sS && (state.soloLayer === 'all' || state.soloLayer === 's')) {
        const dS = getSliceLiveTransform(sS);
        const rS = (sS.rIn + sS.rOut) * 0.5 + dS.pop;
        pts.push(slicePointToWorld(rS * Math.cos(sS.aMid), 0, rS * Math.sin(sS.aMid), anim.spinAngle, 0, 0, dS.y, dS.height));
      }
      for (let j = 0; j < pts.length - 1; j++) {
        pushEnergyLine(pts[j][0], pts[j][1], pts[j][2], pts[j + 1][0], pts[j + 1][1], pts[j + 1][2], col[0], col[1], col[2], baseA);
      }
    }

    // 2d. 3D Cursor Laser Probe Beacon (when Mouse Helper hovers inside chamber)
    cursorLineStartVert = energyLineVertCount;
    if (pointer.activeBlend > 0.03) {
      const px = pointer.smoothWorld[0];
      const py = pointer.smoothWorld[1];
      const pz = pointer.smoothWorld[2];
      const floorY = anim.yS - 0.18;
      const b = pointer.activeBlend;
      const col = pointer.hitKind === 'core' ? [1.0, 0.84, 0.30] : [0.24, 0.92, 1.0];

      pushCursorLine(px, py, pz, px, floorY, pz, col[0], col[1], col[2], 0.62 * b, 0.18 * b);
      pushCursorLine(0, py, 0, px, py, pz, col[0], col[1], col[2], 0.20 * b, 0.72 * b);

      const segs = 22;
      const haloR = 0.24 + 0.05 * Math.sin(t * 7.0);
      for (let s = 0; s < segs; s++) {
        const a0 = (s / segs) * TAU;
        const a1 = ((s + 1) / segs) * TAU;
        pushCursorLine(
          px + haloR * Math.cos(a0), py + 0.03, pz + haloR * Math.sin(a0),
          px + haloR * Math.cos(a1), py + 0.03, pz + haloR * Math.sin(a1),
          1.0, 0.88, 0.42, 0.88 * b
        );
      }
    }

    if (threeEnergyLines && threeEnergyPosAttr && threeEnergyColAttr) {
      threeEnergyLines.geometry.setDrawRange(0, threeEnergyVertCount);
      threeEnergyPosAttr.needsUpdate = true;
      threeEnergyColAttr.needsUpdate = true;
    }
    if (threeCursorLines && threeCursorPosAttr && threeCursorColAttr) {
      threeCursorLines.geometry.setDrawRange(0, threeCursorVertCount);
      threeCursorPosAttr.needsUpdate = true;
      threeCursorColAttr.needsUpdate = true;
    }
  }

  // ---------------------------------------------------------------------------
  // Device Inventory Normalization & Pie-Tube Partitioning
  // ---------------------------------------------------------------------------

  function getUnifiedDevices() {
    const out = [];
    for (const d of state.smartDevices || []) {
      out.push({
        ...d,
        _kind: d.platform === 'ble' ? 'ble' : 'smart',
        _order: CATEGORY_ORDER[d.category] || 8
      });
    }
    for (const b of state.bleDevices || []) {
      if (!out.some((x) => x.id === b.id)) {
        out.push({
          id: b.id || `ble-${b.name}`,
          name: b.name || 'BLE Light',
          platform: 'ble',
          category: 'ble_light',
          online: true,
          power: b.power !== false,
          brightness: b.brightness ?? 100,
          r: b.r ?? 0,
          g: b.g ?? 229,
          b: b.b ?? 255,
          _kind: 'ble',
          _order: CATEGORY_ORDER.ble_light
        });
      }
    }
    for (const c of state.castDevices || []) {
      const playing = c.status === 'PLAYING' || c.status === 'BUFFERING';
      out.push({
        id: c.id,
        name: c.name || c.host || 'Cast Speaker',
        platform: 'google_cast',
        category: 'cast',
        ip: c.host || '',
        ssid: c.ssid || '',
        discoverySource: c.discoverySource || '',
        online: true,
        power: playing,
        brightness: Math.round(((c.volume ?? 0.7) * 100)),
        castStatus: c.status || 'IDLE',
        appName: c.appName || '',
        media: c.media || null,
        r: playing ? 56 : 100,
        g: playing ? 189 : 116,
        b: playing ? 248 : 139,
        _kind: 'cast',
        _order: CATEGORY_ORDER.cast
      });
    }

    out.sort((a, b) => (a._order - b._order) || String(a.name).localeCompare(String(b.name)));
    return out;
  }

  function buildSystemSlicesMeta() {
    tickSystemUsageRuntime(Date.now());
    const usage = ensureSysUsage();
    const tuyaOk = Boolean(state.smartConfig?.tuya?.configured);
    const mhOk = Boolean(state.smartConfig?.magicHome?.configured);
    const aiOk = Boolean(state.smartConfig?.openai?.configured);

    const streamObj = state.streamStatus || {};
    const streaming = Boolean(streamObj.isStreaming || streamObj.active);
    const captureActive = Boolean(state.captureState?.active);
    const captureLvl = captureActive ? clamp(Number(state.captureState?.audioLevel || 0), 0, 1) : 0;
    const mp3Listeners = Number(streamObj.mp3Listeners ?? streamObj.listeners?.mp3 ?? 0);
    const webmListeners = Number(streamObj.webmListeners ?? streamObj.listeners?.webm ?? 0);
    const listenerCount = mp3Listeners + webmListeners;
    const streamKbps = streaming ? Math.round(lastStreamSample.kbps || 0) : 0;

    // 1. OpenAI Voice
    const vState = String(state.voiceState || 'idle');
    const activeVoice = vState !== 'idle';
    let voiceLive = 0;
    if (vState === 'speaking') voiceLive = clamp(0.62 + state.aiAudioLevel * 0.38, 0, 1);
    else if (vState === 'executing') voiceLive = clamp(0.68 + state.audioLevel * 0.32, 0, 1);
    else if (vState === 'listening') voiceLive = clamp(0.24 + state.userAudioLevel * 0.76, 0, 1);
    else if (vState === 'connecting') voiceLive = 0.32;

    // 2. Lights Bus (Wi-Fi + BLE deduplicated)
    const wifiLights = (state.smartDevices || []).filter((d) => d.category === 'light');
    const bleMap = new Map();
    for (const b of (state.bleDevices || [])) {
      const k = String(b.id || b.name || '').toLowerCase();
      if (k) bleMap.set(k, b);
    }
    const allLights = [...wifiLights, ...bleMap.values()];
    const totalLights = allLights.length;
    const onLights = allLights.filter((d) => Boolean(d.power));
    const avgDuty = totalLights > 0
      ? onLights.reduce((acc, d) => acc + clamp((d.brightness ?? 100) / 100, 0.12, 1), 0) / totalLights
      : 0;
    const avgBriOn = onLights.length > 0
      ? Math.round(onLights.reduce((acc, d) => acc + clamp(Number(d.brightness ?? 100), 0, 100), 0) / onLights.length)
      : 0;
    const ambientLive = state.ambientSyncActive && (streaming || captureActive) ? 0.14 : 0;
    const lightsLive = clamp(avgDuty + ambientLive, 0, 1);

    // 3. IR & Scenes
    const irDevs = (state.smartDevices || []).filter((d) => {
      const cat = String(d.category || '');
      return cat.startsWith('ir_') && cat !== 'ir_hub';
    });
    const onIrDevs = irDevs.filter((d) => Boolean(d.power));
    const irLive = irDevs.length > 0 ? clamp((onIrDevs.length / irDevs.length) * 1.4, 0, 0.90) : 0;
    const sceneCount = (state.smartScenes?.scenes || []).length;

    // 4. Robot Vacuum
    const vacDev = (state.smartDevices || []).find((d) => d.category === 'vacuum');
    const vacCleaning = Boolean(vacDev && vacDev.vacuumCleaning);
    const vacReturning = Boolean(
      vacDev && !vacCleaning && String(vacDev.vacuumMode || '').toLowerCase() === 'chargego'
      && usage.vacuum.lastUsedAt > 0 && (Date.now() - usage.vacuum.lastUsedAt) < 180000
    );
    const vacLive = vacCleaning ? 0.94 : (vacReturning ? 0.55 : 0);

    // 5. Cast & Audio
    const playingCasts = (state.castDevices || []).filter((c) => c.status === 'PLAYING' || c.status === 'BUFFERING' || c.power);
    const sdkActive = Boolean(state.castSdk?.active);
    const btActive = Boolean(state.btOutput?.active);
    let castLive = 0;
    if (captureActive) castLive = Math.max(castLive, 0.34 + captureLvl * 0.42);
    if (streaming) castLive = Math.max(castLive, 0.42 + Math.min(0.24, listenerCount * 0.12) + Math.min(0.16, (streamKbps / 320) * 0.16));
    if (playingCasts.length > 0) castLive = Math.max(castLive, 0.48 + Math.min(0.28, playingCasts.length * 0.14));
    if (sdkActive) castLive = Math.max(castLive, 0.54);
    if (btActive) castLive = Math.max(castLive, 0.30 + captureLvl * 0.25);
    castLive = clamp(castLive, 0, 1);

    const buildEntry = (sysKey, name, liveLoad, baseCol, activeCol, extra) => {
      const u = usage[sysKey] || { count: 0, heat: 0, activeSec: 0, lastUsedAt: 0, lastAction: '' };
      const usageScore = clamp(liveLoad * 0.78 + clamp(u.heat, 0, 1.1) * 0.42, 0, 1);
      const usagePct = Math.round(usageScore * 100);
      const countWeight = u.heat > 0.01 ? Math.min(0.18, u.count * 0.02) : 0;
      const targetWeight = MIN_SLICE_WEIGHT + usageScore * 1.55 + countWeight;
      const isHot = liveLoad > 0.04 || u.heat > 0.08;
      const isStreamSys = sysKey === 'voice' || sysKey === 'cast';
      let pnlKey = 'loss';
      if (isStreamSys && (extra.forceActive || liveLoad > 0.16)) pnlKey = 'stream';
      else if (extra.forceActive || liveLoad > 0.20) pnlKey = 'gain';
      else if (usagePct > 5 || extra.forceStandby) pnlKey = 'flat';
      const pnlRgb = PNL_PALETTE[pnlKey].rgb;
      const cMix = clamp(usageScore, 0, 1);
      const accentColor = [
        lerp(baseCol[0], activeCol[0], cMix),
        lerp(baseCol[1], activeCol[1], cMix),
        lerp(baseCol[2], activeCol[2], cMix)
      ];
      const color = [
        lerp(pnlRgb[0], accentColor[0], 0.22),
        lerp(pnlRgb[1], accentColor[1], 0.22),
        lerp(pnlRgb[2], accentColor[2], 0.22)
      ];
      return {
        sysKey,
        name,
        pnlKey,
        active: Boolean(extra.forceActive || liveLoad > 0.04 || u.heat > 0.16),
        liveLoad,
        heat: u.heat,
        count: u.count,
        activeSec: u.activeSec,
        lastUsedAt: u.lastUsedAt,
        lastAction: u.lastAction,
        usageScore,
        usagePct,
        targetWeight,
        sharePct: 20,
        subtitle: extra.subtitle,
        shortMetric: extra.shortMetric(usagePct, u),
        detailMetric: extra.detailMetric(usagePct, u),
        color
      };
    };

    const voiceModeTxt = activeVoice ? vState.toUpperCase() : (aiOk ? 'READY' : 'NO KEY');
    const acDev = onIrDevs.find((d) => d.category === 'ir_ac');
    const castTokens = [];
    if (streaming) castTokens.push(streamKbps > 0 ? `${streamKbps}kbps` : 'LIVE');
    if (playingCasts.length > 0) castTokens.push(`${playingCasts.length} Cast`);
    if (sdkActive) castTokens.push('SDK');
    if (btActive) castTokens.push('BT');
    if (listenerCount > 0) castTokens.push(`${listenerCount}L`);

    const items = [
      buildEntry('voice', 'Voice AI Engine', voiceLive, [0.16, 0.68, 0.88], [0.12, 0.94, 1.0], {
        forceActive: activeVoice,
        forceStandby: aiOk,
        subtitle: activeVoice ? `${vState.toUpperCase()} • ${Math.round(state.audioLevel * 100)}% lvl` : (aiOk ? 'Realtime Ready' : 'Not Configured'),
        shortMetric: (pct, u) => `${voiceModeTxt} • ${u.count} turns • ${formatDurationSec(u.activeSec)}`,
        detailMetric: (pct, u) => `${pct}% load • Audio ${Math.round(state.audioLevel * 100)}% • ${u.count} turns • ${formatDurationSec(u.activeSec)}`
      }),
      buildEntry('lights', 'Lighting Grid', lightsLive, [0.22, 0.80, 0.52], [0.10, 0.94, 0.62], {
        forceActive: onLights.length > 0,
        forceStandby: totalLights > 0 && onLights.length === 0,
        subtitle: `${onLights.length}/${totalLights} ON${onLights.length ? ` • ${avgBriOn}%` : ''}${state.ambientSyncActive ? ' • AMB' : ''}`,
        shortMetric: (pct, u) => `${onLights.length}/${totalLights} ON${onLights.length ? ` • ${avgBriOn}%` : ''} • ${u.count} cmds`,
        detailMetric: (pct, u) => `${pct}% load • ${onLights.length}/${totalLights} lights (${mhOk ? 'LAN+Tuya' : 'Tuya+BLE'}) • ${u.count} cmds`
      }),
      buildEntry('ir', 'HVAC & IR Bus', irLive, [0.58, 0.42, 0.92], [0.12, 0.88, 0.58], {
        forceActive: state.focusedSysKey === 'ir' || onIrDevs.length > 0,
        forceStandby: sceneCount > 0 || irDevs.length > 0,
        subtitle: `${onIrDevs.length}/${irDevs.length} ON • ${sceneCount} scenes`,
        shortMetric: (pct, u) => `${onIrDevs.length}/${irDevs.length} ON • ${u.count} cmds • ${sceneCount} sc`,
        detailMetric: (pct, u) => `${pct}% load • ${acDev ? `AC ${acDev.acTemp || '--'}C` : `${onIrDevs.length} active IR`} • ${sceneCount} scenes • ${u.count} cmds`
      }),
      buildEntry('vacuum', 'Robotics Bus', vacLive, [0.18, 0.72, 0.54], [0.14, 0.95, 0.62], {
        forceActive: vacCleaning || vacReturning,
        forceStandby: Boolean(vacDev),
        subtitle: vacCleaning ? `CLEANING • ${vacDev?.battery ?? '--'}%` : (vacReturning ? `RETURNING • ${vacDev?.battery ?? '--'}%` : `DOCKED • ${vacDev?.battery ?? '--'}%`),
        shortMetric: (pct, u) => `${vacCleaning ? 'CLEAN' : (vacReturning ? 'DOCKING' : 'DOCKED')} • ${vacDev?.battery ?? '--'}% • ${formatDurationSec(u.activeSec)}`,
        detailMetric: (pct, u) => `${pct}% load • ${vacDev?.name || 'Sh7p'} (${vacDev?.vacuumMode || 'idle'}) • Bat ${vacDev?.battery ?? '--'}% • ${u.count} cmds`
      }),
      buildEntry('cast', 'Media Cast Bus', castLive, [0.18, 0.66, 0.88], [0.12, 0.90, 1.0], {
        forceActive: streaming || captureActive || playingCasts.length > 0 || sdkActive || btActive,
        forceStandby: (state.castDevices || []).length > 0,
        subtitle: castTokens.length ? castTokens.join(' • ') : `${(state.castDevices || []).length} Cast Targets`,
        shortMetric: (pct, u) => `${castTokens.length ? castTokens.join(' • ') : `IDLE (${(state.castDevices || []).length})`} • ${u.count} cmds`,
        detailMetric: (pct, u) => `${pct}% load • ${castTokens.length ? castTokens.join(' • ') : 'Standby'} • ${(state.castDevices || []).length} targets • ${formatDurationSec(u.activeSec)}`
      })
    ];

    const shares = computeSharePcts(items.map((x) => x.targetWeight));
    for (let i = 0; i < items.length; i++) {
      items[i].sharePct = shares[i];
    }
    cachedSysMeta = items;
    return items;
  }

  function rebuildSystemPieGeometry(sysMeta, useSmoothed = true) {
    disposeSliceBuffers(sliceModels.s);
    sliceModels.s = [];

    const weights = sysMeta.map((sys) => {
      const sw = anim.sysWeightByKey[sys.sysKey];
      const w = (useSmoothed && Number.isFinite(sw)) ? sw : sys.targetWeight;
      if (!Number.isFinite(anim.sysWeightByKey[sys.sysKey])) {
        anim.sysWeightByKey[sys.sysKey] = sys.targetWeight;
      }
      if (!Number.isFinite(anim.sysHeightByKey[sys.sysKey])) {
        anim.sysHeightByKey[sys.sysKey] = 0.16 + sys.usageScore * 0.48;
      }
      return Math.max(MIN_SLICE_WEIGHT * 0.8, w);
    });

    const totalW = weights.reduce((acc, w) => acc + w, 0) || 1;
    let cursor = -0.15;
    for (let i = 0; i < sysMeta.length; i++) {
      const sys = sysMeta[i];
      const w = weights[i];
      const span = (w / totalW) * TAU;
      const a0 = wrapAngle0Tau(cursor + 0.025);
      const a1 = a0 + Math.max(0.14, span - 0.05);
      const aMid = (a0 + a1) * 0.5;
      cursor += span;

      const sliceObj = {
        key: `s:${sys.sysKey}`,
        layer: 's',
        sysKey: sys.sysKey,
        sys,
        index: i,
        rIn: 3.44,
        rOut: 4.28,
        a0,
        a1,
        aMid,
        currentWeight: w,
        baseColor: sys.color,
        mesh: createSliceMeshObject('s', 3.44, 4.28, a0, a1, sys.color, i)
      };
      if (sliceObj.mesh && sliceObj.mesh.wedgeMesh) {
        sliceObj.mesh.wedgeMesh.userData.vosSlice = sliceObj;
      }
      sliceModels.s.push(sliceObj);
    }
    lastSysGeoRebuildAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
  }

  function rebuildPieTopology(force = false) {
    const devs = getUnifiedDevices();
    const sysMeta = buildSystemSlicesMeta();
    const sig = devs.map((d) => `${d.id}:${d.category}:${d.name}`).join('|');

    if (!force && sig === devTopologySig) {
      updateSliceDynamicData(devs, sysMeta);
      if (sliceModels.s.length !== sysMeta.length) {
        rebuildSystemPieGeometry(sysMeta, !force);
      }
      return;
    }

    devTopologySig = sig;
    topologySig = `${sig}#${sysMeta.map((s) => s.sysKey).join(',')}`;

    disposeSliceBuffers(sliceModels.v);
    disposeSliceBuffers(sliceModels.o);
    sliceModels.v = [];
    sliceModels.o = [];

    if (!state.selectedDeviceId && devs.length > 0) {
      state.selectedDeviceId = devs[0].id;
    }

    // Build Layer V (Inner Ring r=0.92..1.92) and Layer O (Middle Ring r=2.12..3.24)
    const count = Math.max(1, devs.length);
    const gap = Math.min(0.048, (TAU / count) * 0.14);
    const step = TAU / count;

    for (let i = 0; i < devs.length; i++) {
      const dev = devs[i];
      const a0 = i * step + gap * 0.5;
      const a1 = (i + 1) * step - gap * 0.5;
      const aMid = (a0 + a1) * 0.5;
      const col = rgbNormFromDev(dev);

      const vSlice = {
        key: `v:${dev.id}`,
        layer: 'v',
        devId: dev.id,
        dev,
        index: i,
        rIn: 0.92,
        rOut: 1.92,
        a0,
        a1,
        aMid,
        baseColor: col,
        mesh: createSliceMeshObject('v', 0.92, 1.92, a0, a1, col, i)
      };
      if (vSlice.mesh && vSlice.mesh.wedgeMesh) {
        vSlice.mesh.wedgeMesh.userData.vosSlice = vSlice;
      }
      sliceModels.v.push(vSlice);

      const oCol = objectivePnlColorForDev(dev);
      const oSlice = {
        key: `o:${dev.id}`,
        layer: 'o',
        devId: dev.id,
        dev,
        index: i,
        rIn: 2.12,
        rOut: 3.24,
        a0,
        a1,
        aMid,
        baseColor: oCol,
        mesh: createSliceMeshObject('o', 2.12, 3.24, a0, a1, oCol, i)
      };
      if (oSlice.mesh && oSlice.mesh.wedgeMesh) {
        oSlice.mesh.wedgeMesh.userData.vosSlice = oSlice;
      }
      sliceModels.o.push(oSlice);
    }

    // Build Layer S (Outer Ring r=3.44..4.28)
    rebuildSystemPieGeometry(sysMeta, !force);
  }

  function updateSliceDynamicData(devs, sysMeta) {
    const devMap = new Map(devs.map((d) => [d.id, d]));
    const sysMap = new Map(sysMeta.map((s) => [s.sysKey, s]));
    for (const s of sliceModels.v) {
      const d = devMap.get(s.devId);
      if (d) {
        s.dev = d;
        s.baseColor = rgbNormFromDev(d);
      }
    }
    for (const s of sliceModels.o) {
      const d = devMap.get(s.devId);
      if (d) {
        s.dev = d;
        s.baseColor = objectivePnlColorForDev(d);
      }
    }
    for (const s of sliceModels.s) {
      const sys = sysMap.get(s.sysKey);
      if (sys) {
        s.sys = sys;
        s.baseColor = sys.color;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Exact 3D Mathematical Raycasting + Multi-Tier Chamber Plane Probing
  // ---------------------------------------------------------------------------

  function isAngleWithinSector(angle, a0, a1, padA = 0) {
    const span = Math.min(TAU, (a1 - a0) + padA * 2);
    const d = wrapAngle0Tau(angle - (a0 - padA));
    return d <= span + 0.0001;
  }

  function solveCylinderHit(ox, oy, oz, dx, dy, dz, r, halfH, a0, a1, padA = 0) {
    if (r <= 0.001) return Infinity;
    const A = dx * dx + dz * dz;
    if (A < 1e-8) return Infinity;
    const B = 2 * (ox * dx + oz * dz);
    const C = ox * ox + oz * oz - r * r;
    const disc = B * B - 4 * A * C;
    if (disc < 0) return Infinity;
    const sq = Math.sqrt(disc);
    let bestT = Infinity;
    for (const t of [(-B - sq) / (2 * A), (-B + sq) / (2 * A)]) {
      if (t <= 0.02 || t >= bestT) continue;
      const hy = oy + t * dy;
      if (Math.abs(hy) > halfH) continue;
      const hx = ox + t * dx;
      const hz = oz + t * dz;
      if (isAngleWithinSector(Math.atan2(hz, hx), a0, a1, padA)) {
        bestT = t;
      }
    }
    return bestT;
  }

  function solveCutPlaneHit(ox, oy, oz, dx, dy, dz, angle, rIn, rOut, halfH) {
    const nx = -Math.sin(angle);
    const nz = Math.cos(angle);
    const denom = dx * nx + dz * nz;
    if (Math.abs(denom) < 1e-6) return Infinity;
    const t = -(ox * nx + oz * nz) / denom;
    if (t <= 0.02) return Infinity;
    const hy = oy + t * dy;
    if (Math.abs(hy) > halfH) return Infinity;
    const hx = ox + t * dx;
    const hz = oz + t * dz;
    const radialDot = hx * Math.cos(angle) + hz * Math.sin(angle);
    return (radialDot >= rIn && radialDot <= rOut) ? t : Infinity;
  }

  function intersectRayPieWedge(rayOrig, rayDir, slice, liveY, liveH, livePop, padR = 0, padA = 0) {
    const c = Math.cos(anim.spinAngle);
    const s = Math.sin(anim.spinAngle);
    let ox = rayOrig[0] * c + rayOrig[2] * s;
    let oz = -rayOrig[0] * s + rayOrig[2] * c;
    const oy = rayOrig[1] - liveY;

    const dx = rayDir[0] * c + rayDir[2] * s;
    const dz = -rayDir[0] * s + rayDir[2] * c;
    const dy = rayDir[1];

    ox -= Math.cos(slice.aMid) * livePop;
    oz -= Math.sin(slice.aMid) * livePop;

    const rMin = Math.max(0.04, slice.rIn - padR);
    const rMax = slice.rOut + padR;
    const halfH = liveH * 0.5 + (padR > 0 ? 0.04 : 0);
    let minT = Infinity;

    if (Math.abs(dy) > 1e-6) {
      for (const yPlane of [halfH, -halfH]) {
        const t = (yPlane - oy) / dy;
        if (t > 0.02 && t < minT) {
          const hx = ox + t * dx;
          const hz = oz + t * dz;
          const r2 = hx * hx + hz * hz;
          if (r2 >= rMin * rMin && r2 <= rMax * rMax) {
            if (isAngleWithinSector(Math.atan2(hz, hx), slice.a0, slice.a1, padA)) {
              minT = t;
            }
          }
        }
      }
    }

    const tOuter = solveCylinderHit(ox, oy, oz, dx, dy, dz, rMax, halfH, slice.a0, slice.a1, padA);
    if (tOuter < minT) minT = tOuter;
    const tInner = solveCylinderHit(ox, oy, oz, dx, dy, dz, rMin, halfH, slice.a0, slice.a1, padA);
    if (tInner < minT) minT = tInner;

    const tCut0 = solveCutPlaneHit(ox, oy, oz, dx, dy, dz, slice.a0 - padA, rMin, rMax, halfH);
    if (tCut0 < minT) minT = tCut0;
    const tCut1 = solveCutPlaneHit(ox, oy, oz, dx, dy, dz, slice.a1 + padA, rMin, rMax, halfH);
    if (tCut1 < minT) minT = tCut1;

    return minT;
  }

  function intersectRayCore(rayOrig, rayDir) {
    const coreH = Math.max(0.55, Math.abs(anim.yV - anim.yS) + 0.55);
    const halfH = coreH * 0.5;
    const coreMidY = (anim.yV + anim.yS) * 0.5;
    const oy = rayOrig[1] - coreMidY;
    const r = 0.72;
    let best = Infinity;
    if (Math.abs(rayDir[1]) > 1e-6) {
      for (const yp of [halfH, -halfH]) {
        const t = (yp - oy) / rayDir[1];
        if (t > 0.02 && t < best) {
          const hx = rayOrig[0] + t * rayDir[0];
          const hz = rayOrig[2] + t * rayDir[2];
          if (hx * hx + hz * hz <= r * r) best = t;
        }
      }
    }
    const A = rayDir[0] * rayDir[0] + rayDir[2] * rayDir[2];
    if (A > 1e-8) {
      const B = 2 * (rayOrig[0] * rayDir[0] + rayOrig[2] * rayDir[2]);
      const C = rayOrig[0] * rayOrig[0] + rayOrig[2] * rayOrig[2] - r * r;
      const disc = B * B - 4 * A * C;
      if (disc >= 0) {
        const sq = Math.sqrt(disc);
        for (const t of [(-B - sq) / (2 * A), (-B + sq) / (2 * A)]) {
          if (t > 0.02 && t < best && Math.abs(oy + t * rayDir[1]) <= halfH) best = t;
        }
      }
    }
    return best;
  }

  function intersectRayChamberPlanes(rayOrig, rayDir) {
    if (Math.abs(rayDir[1]) < 1e-5) return null;

    const candidates = [];
    if (state.soloLayer === 'v') {
      candidates.push({ y: anim.yV, rMin: 0, rMax: 5.5 });
    } else if (state.soloLayer === 's') {
      candidates.push({ y: anim.yS, rMin: 0, rMax: 5.5 });
    } else if (state.soloLayer === 'o') {
      candidates.push({ y: 0, rMin: 0, rMax: 5.5 });
    } else {
      candidates.push(
        { y: anim.yV, rMin: 0.74, rMax: 2.02 },
        { y: 0, rMin: 2.02, rMax: 3.34 },
        { y: anim.yS, rMin: 3.34, rMax: 4.65 }
      );
    }

    let bestPlane = null;
    let bestT = Infinity;
    for (const c of candidates) {
      const t = (c.y - rayOrig[1]) / rayDir[1];
      if (t <= 0.05 || t >= bestT) continue;
      const hx = rayOrig[0] + t * rayDir[0];
      const hz = rayOrig[2] + t * rayDir[2];
      const r = Math.hypot(hx, hz);
      if (r >= c.rMin && r <= c.rMax) {
        bestT = t;
        bestPlane = { world: [hx, c.y, hz], r, t };
      }
    }

    if (!bestPlane) {
      const t0 = (0 - rayOrig[1]) / rayDir[1];
      if (t0 > 0.05) {
        const hx = rayOrig[0] + t0 * rayDir[0];
        const hz = rayOrig[2] + t0 * rayDir[2];
        const r = Math.hypot(hx, hz);
        if (r <= 5.6) {
          bestPlane = { world: [hx, 0, hz], r, t: t0 };
        }
      }
    }
    return bestPlane;
  }

  function zoneLabelForRadius(r, hitKind, slice) {
    if (hitKind === 'core') return 'HIGGS SINGULARITY CORE';
    if (hitKind === 'slice' && slice) {
      if (slice.layer === 'v') return 'TIER V // VISUAL TUBE';
      if (slice.layer === 'o') return 'TIER O // OBJECTIVE';
      return 'TIER S // SYSTEM BUS';
    }
    if (r < 0.82) return 'CORE CONTAINMENT AXIS';
    if (r < 2.02) return 'TIER V // VISUAL RING';
    if (r < 3.34) return 'TIER O // OBJECTIVE RING';
    if (r < 4.50) return 'TIER S // SYSTEM RING';
    return 'CHAMBER PERIMETER FIELD';
  }

  function syncThreePieTransforms() {
    if (!threePieRoot || !threeCoreGroup) return;
    threePieRoot.rotation.y = -anim.spinAngle;

    const coreMidY = (anim.yV + anim.yS) * 0.5;
    const coreH = Math.max(0.55, Math.abs(anim.yV - anim.yS) * 0.5 + 0.46 + state.audioLevel * 0.34);
    threeCoreGroup.position.set(0, coreMidY, 0);
    if (threeCoreShell) {
      threeCoreShell.scale.set(1, coreH, 1);
      threeCoreShell.rotation.y = anim.spinAngle * 0.5;
    }
    if (threeCoreHitMesh) {
      threeCoreHitMesh.scale.set(1, Math.max(0.68, Math.abs(anim.yV - anim.yS) + 0.45), 1);
    }

    for (const lName of ['s', 'o', 'v']) {
      for (const s of sliceModels[lName]) {
        if (!s.mesh || !s.mesh.group) continue;
        const dyn = getSliceLiveTransform(s);
        const popX = Math.cos(s.aMid) * dyn.pop;
        const popZ = Math.sin(s.aMid) * dyn.pop;
        s.mesh.group.position.set(popX, dyn.y, popZ);
        s.mesh.group.scale.set(1, dyn.height, 1);
      }
    }

    threePieRoot.updateMatrixWorld(true);
    threeCoreGroup.updateMatrixWorld(true);
  }

  function pointerToWorldRay(offsetX, offsetY) {
    const ndcX = (offsetX / Math.max(1, viewWidth)) * 2 - 1;
    const ndcY = 1 - (offsetY / Math.max(1, viewHeight)) * 2;
    if (threeRenderer && threeCamera && threeRaycaster && threeRayNdc) {
      threeCamera.updateMatrixWorld(true);
      threeRayNdc.set(ndcX, ndcY);
      threeRaycaster.setFromCamera(threeRayNdc, threeCamera);
      const ro = threeRaycaster.ray.origin;
      const rd = threeRaycaster.ray.direction;
      return { ndcX, ndcY, origin: [ro.x, ro.y, ro.z], dir: [rd.x, rd.y, rd.z] };
    }
    const m = currentInvViewProj;
    const unproj = (z) => {
      const w = m[3] * ndcX + m[7] * ndcY + m[11] * z + m[15];
      if (Math.abs(w) < 1e-7) return [0, 0, 0];
      return [
        (m[0] * ndcX + m[4] * ndcY + m[8] * z + m[12]) / w,
        (m[1] * ndcX + m[5] * ndcY + m[9] * z + m[13]) / w,
        (m[2] * ndcX + m[6] * ndcY + m[10] * z + m[14]) / w
      ];
    };
    const pNear = unproj(-1);
    const pFar = unproj(1);
    const dx = pFar[0] - pNear[0];
    const dy = pFar[1] - pNear[1];
    const dz = pFar[2] - pNear[2];
    const len = Math.hypot(dx, dy, dz) || 1;
    return { ndcX, ndcY, origin: pNear, dir: [dx / len, dy / len, dz / len] };
  }

  function buildPointerHitMeta(kind, slice, t, worldPos) {
    const r = Math.hypot(worldPos[0], worldPos[2]);
    const phiRel = wrapAngle0Tau(Math.atan2(worldPos[2], worldPos[0]) - anim.spinAngle);
    return {
      kind,
      slice,
      t,
      worldPos,
      r,
      phiDeg: (phiRel * 180) / PI,
      y: worldPos[1],
      zone: zoneLabelForRadius(r, kind, slice)
    };
  }

  function pickAtPointer(offsetX, offsetY) {
    const ray = pointerToWorldRay(offsetX, offsetY);
    let bestHit = null;
    let bestT = Infinity;
    let worldPos = null;
    const visibleLayers = state.soloLayer === 'all' ? ['v', 'o', 's'] : [state.soloLayer];

    if (threeRenderer && threeCamera && threeRaycaster && threeRayNdc && threePieRoot) {
      syncThreePieTransforms();

      const rayTargets = [];
      for (const lName of visibleLayers) {
        for (const s of sliceModels[lName]) {
          if (s.mesh && s.mesh.wedgeMesh) {
            rayTargets.push(s.mesh.wedgeMesh);
          }
        }
      }
      if (threeCoreHitMesh) {
        rayTargets.push(threeCoreHitMesh);
      }

      const hits = threeRaycaster.intersectObjects(rayTargets, false);
      if (hits.length > 0) {
        const hit0 = hits[0];
        bestT = hit0.distance;
        worldPos = [hit0.point.x, hit0.point.y, hit0.point.z];
        if (hit0.object === threeCoreHitMesh || (hit0.object.userData && hit0.object.userData.isCoreHit)) {
          bestHit = { kind: 'core', slice: null, t: bestT };
        } else if (hit0.object.userData && hit0.object.userData.vosSlice) {
          bestHit = { kind: 'slice', slice: hit0.object.userData.vosSlice, t: bestT };
        }
      } else {
        const planeHit = intersectRayChamberPlanes(ray.origin, ray.dir);
        if (planeHit) {
          bestHit = { kind: 'chamber', slice: null, t: planeHit.t };
          worldPos = planeHit.world;
        }
      }
    } else {
      for (const lName of visibleLayers) {
        for (const slice of sliceModels[lName]) {
          const dyn = getSliceLiveTransform(slice);
          const t = intersectRayPieWedge(ray.origin, ray.dir, slice, dyn.y, dyn.height, dyn.pop);
          if (t < bestT) {
            bestT = t;
            bestHit = { kind: 'slice', slice, t };
          }
        }
      }

      const tCore = intersectRayCore(ray.origin, ray.dir);
      if (tCore < bestT) {
        bestT = tCore;
        bestHit = { kind: 'core', slice: null, t: tCore };
      }

      if (bestHit && isFinite(bestT)) {
        worldPos = [
          ray.origin[0] + bestT * ray.dir[0],
          ray.origin[1] + bestT * ray.dir[1],
          ray.origin[2] + bestT * ray.dir[2]
        ];
      } else {
        const planeHit = intersectRayChamberPlanes(ray.origin, ray.dir);
        if (planeHit) {
          bestHit = { kind: 'chamber', slice: null, t: planeHit.t };
          worldPos = planeHit.world;
        }
      }
    }

    if (!bestHit || !worldPos) return null;
    return buildPointerHitMeta(bestHit.kind, bestHit.slice, bestHit.t, worldPos);
  }

  // ---------------------------------------------------------------------------
  // 3D Spatial Mouse Helper Logic & Scientific Card Rendering
  // ---------------------------------------------------------------------------

  function evaluatePointerHover() {
    if (!pointer.inside || dragging) {
      state.hoveredSliceKey = '';
      if (dragging) hideTooltip();
      return;
    }

    const prevKey = state.hoveredSliceKey;
    let hit = pickAtPointer(pointer.x, pointer.y);

    // Sticky rest-footprint hysteresis: prevent a hovered wedge sliding away along its pop vector from dropping hover & oscillating back-and-forth
    if (prevKey && (!hit || hit.kind !== 'slice' || hit.slice?.key !== prevKey)) {
      const prevSlice = findSliceByKey(prevKey);
      const layerVisible = prevSlice && (state.soloLayer === 'all' || state.soloLayer === prevSlice.layer);
      if (layerVisible) {
        const ray = pointerToWorldRay(pointer.x, pointer.y);
        const rest = getSliceRestTransform(prevSlice);
        const tRest = intersectRayPieWedge(ray.origin, ray.dir, prevSlice, rest.y, rest.height, rest.pop, 0.045, 0.015);
        if (Number.isFinite(tRest) && (!hit || hit.kind === 'chamber' || hit.t >= tRest - 0.08)) {
          const wPos = [
            ray.origin[0] + tRest * ray.dir[0],
            ray.origin[1] + tRest * ray.dir[1],
            ray.origin[2] + tRest * ray.dir[2]
          ];
          hit = buildPointerHitMeta('slice', prevSlice, tRest, wPos);
        }
      }
    }

    if (hit) {
      pointer.hitKind = hit.kind;
      pointer.slice = hit.slice;
      pointer.worldPos[0] = hit.worldPos[0];
      pointer.worldPos[1] = hit.worldPos[1];
      pointer.worldPos[2] = hit.worldPos[2];
      pointer.r = hit.r;
      pointer.phiDeg = hit.phiDeg;
      pointer.worldY = hit.y;
      pointer.zone = hit.zone;

      const devBonus = hit.slice?.dev?.power ? 0.42 : (hit.kind === 'core' ? 0.85 : 0.08);
      pointer.energyGeV = 125.09 + devBonus + anim.energyLevel * 0.65 + Math.sin(anim.clock * 3.1) * 0.04;

      if (hit.kind === 'slice' && hit.slice) {
        state.hoveredSliceKey = hit.slice.key;
        if (els.webglCanvas) els.webglCanvas.style.cursor = 'pointer';
      } else if (hit.kind === 'core') {
        state.hoveredSliceKey = '';
        if (els.webglCanvas) els.webglCanvas.style.cursor = 'pointer';
      } else {
        state.hoveredSliceKey = '';
        if (els.webglCanvas) els.webglCanvas.style.cursor = 'crosshair';
      }

      if (pointer.helperEnabled && (hit.kind === 'slice' || hit.kind === 'core')) {
        updateMouseHelperCard(hit);
      } else {
        hideTooltip();
      }
    } else {
      pointer.hitKind = 'none';
      pointer.slice = null;
      state.hoveredSliceKey = '';
      if (els.webglCanvas) els.webglCanvas.style.cursor = 'grab';
      hideTooltip();
    }
  }

  function updateMouseHelperCard(hit) {
    if (!els.tooltip || !els.viewport) return;

    let modeClass = 'vos-tooltip vos-mouse-helper';
    let tierText = hit.zone;
    let protoText = '3D PROBE';
    let swatchStyle = 'background:#38bdf8; box-shadow:0 0 8px #38bdf8;';
    let title = 'Higgs Quantum Chamber';
    let sub = 'Sweeping 3D Detector Field';
    let desc = 'Move across concentric rings V (Hardware), O (Objective PnL), and S (System Bus).';
    let pnlKey = '';
    let pnlPill = '';
    let hintHtml = '<strong>Drag:</strong> Orbit 3D &bull; <strong>Scroll:</strong> Zoom &bull; <strong>Hover:</strong> Probe Wedge';
    let sig = `chamber:${hit.zone}`;

    if (hit.kind === 'core') {
      modeClass += ' is-core';
      tierText = 'SINGULARITY // H0';
      protoText = 'BOSON CORE';
      swatchStyle = 'background:#fbbf24; box-shadow:0 0 10px #fbbf24;';
      title = 'Higgs Singularity Core';
      sub = shouldBeFlatSuperPie() ? '3-Tier Super-Pie Compressed' : '3-Tier Energy Rings Separated';
      desc = 'Central Higgs boson resonance core synchronizing optical hardware, device objectives & system telemetry.';
      pnlKey = 'flat';
      pnlPill = 'CORE H0';
      hintHtml = '<strong>Click Core:</strong> Toggle Super-Pie &bull; <strong>Drag:</strong> Orbit 3D';
      sig = `core:${shouldBeFlatSuperPie() ? 'flat' : 'sep'}`;
    } else if (hit.kind === 'slice' && hit.slice) {
      const sl = hit.slice;
      const info = describePieSector(sl);
      const pnl = info.pnl;
      modeClass += ` is-pnl-${pnl.key}`;
      pnlKey = pnl.key;
      pnlPill = info.statusPill;
      tierText = info.tierTag;
      const cCss = rgbCss(sl.baseColor, 1);
      swatchStyle = `background:${cCss}; box-shadow:0 0 8px ${cCss};`;
      sub = `${info.roleBadge} • ${info.statusLine}`;
      desc = info.explainLine;

      if (sl.layer === 's') {
        const sys = sl.sys || {};
        protoText = sys.active ? 'ACTIVE BUS' : 'IDLE BUS';
        title = sys.name || sl.sysKey;
        hintHtml = `<strong>Click:</strong> Focus Subsystem (${sys.sharePct ?? 20}% Share) &bull; <strong>Drag:</strong> Orbit`;
        sig = `s:${sl.sysKey}:${pnl.key}:${info.statusPill}:${sys.sharePct}`;
      } else {
        const d = sl.dev;
        protoText = protocolLabel(d);
        title = d.name;
        const isLight = d.category === 'light' || d.category === 'ble_light';
        hintHtml = isLight
          ? '<strong>Click:</strong> Inspect Sector &bull; <strong>Double-Click:</strong> Toggle Light'
          : '<strong>Click:</strong> Focus &amp; Inspect Sector &bull; <strong>Drag:</strong> Orbit &bull; <strong>Scroll:</strong> Zoom';
        sig = `${sl.key}:${pnl.key}:${d.power}:${d.brightness}:${d.r},${d.g},${d.b}`;
      }
    } else {
      modeClass += ' is-chamber';
    }

    if (pointer.cardSig !== sig) {
      pointer.cardSig = sig;
      els.tooltip.className = modeClass;
      const pnlBadgeHtml = pnlKey
        ? `<span class="vos-mh-pnl is-${pnlKey}"><i class="vos-pnl-swatch pat-${pnlKey}"></i>${escapeHtml(pnlPill)}</span>`
        : '';
      els.tooltip.innerHTML = `
        <div class="vos-mh-head">
          <span class="vos-mh-tier">${escapeHtml(tierText)}</span>
          <span class="vos-mh-proto">${escapeHtml(protoText)}</span>
        </div>
        <div class="vos-mh-title-row">
          <span class="vos-mh-swatch" style="${swatchStyle}"></span>
          <div class="vos-tt-title">${escapeHtml(title)}</div>
          ${pnlBadgeHtml}
        </div>
        <div class="vos-tt-sub">${escapeHtml(sub)}</div>
        <div class="vos-tt-desc">${escapeHtml(desc)}</div>
        <div class="vos-mh-coords">
          <span><b>r</b> <i data-mh="r">${hit.r.toFixed(2)}m</i></span>
          <span><b>&phi;</b> <i data-mh="phi">${hit.phiDeg.toFixed(0)}&deg;</i></span>
          <span><b>&Phi;</b> <i data-mh="gev">${pointer.energyGeV.toFixed(1)}G</i></span>
        </div>
        <div class="vos-mh-hints">${hintHtml}</div>
      `;
    } else {
      els.tooltip.className = modeClass;
      const rEl = els.tooltip.querySelector('[data-mh="r"]');
      const phiEl = els.tooltip.querySelector('[data-mh="phi"]');
      const gevEl = els.tooltip.querySelector('[data-mh="gev"]');
      if (rEl) rEl.textContent = `${hit.r.toFixed(2)}m`;
      if (phiEl) phiEl.textContent = `${hit.phiDeg.toFixed(0)}°`;
      if (gevEl) gevEl.textContent = `${pointer.energyGeV.toFixed(1)}G`;
    }

    els.tooltip.classList.remove('hidden');

    const cardW = hit.kind === 'chamber' ? 260 : 294;
    const cardH = Math.max(150, els.tooltip.offsetHeight || 176);
    const placeLeft = pointer.x > viewWidth - cardW - 42;
    const left = placeLeft
      ? clamp(pointer.x - cardW - 24, 12, viewWidth - cardW - 12)
      : clamp(pointer.x + 24, 12, viewWidth - cardW - 12);
    const top = clamp(pointer.y - cardH * 0.45, 44, viewHeight - cardH - 52);

    els.tooltip.style.left = `${Math.round(left)}px`;
    els.tooltip.style.top = `${Math.round(top)}px`;
    pointer.helperRect = { x: Math.round(left), y: Math.round(top), w: cardW, h: cardH, active: true };
  }

  function hideTooltip() {
    pointer.helperRect.active = false;
    if (els.tooltip) {
      els.tooltip.classList.add('hidden');
    }
  }

  function updateTelemetryHud(nowMs) {
    if (nowMs - pointer.lastDomUpdateAt < 48) return;
    pointer.lastDomUpdateAt = nowMs;

    if (els.fluxVal) {
      const flux = (0.42 + anim.energyLevel * 1.45 + anim.burstEnergy * 1.8).toFixed(2);
      els.fluxVal.textContent = `${flux} TW`;
    }
    if (els.phaseVal) {
      els.phaseVal.textContent = state.focusedSliceKey
        ? 'LOCKED'
        : (shouldBeFlatSuperPie() ? 'SUPER-PIE' : '3-TIER');
    }
    if (els.purePhaseTag) {
      els.purePhaseTag.textContent = state.openMenuSliceKey
        ? 'SLICE MENU'
        : (state.focusedSliceKey ? 'LOCKED' : (shouldBeFlatSuperPie() ? 'SUPER-PIE' : '3-TIER'));
    }
    if (els.probeStrip && els.probeText) {
      if (dragging) {
        els.probeStrip.classList.add('is-locked');
        els.probeText.textContent = `ORBITING CHAMBER • PITCH ${Math.round(anim.pitchDeg)}° • YAW ${Math.round(anim.yawDeg)}° • DIST ${anim.camDist.toFixed(1)}m`;
      } else if (pointer.inside && pointer.hitKind !== 'none') {
        const locked = pointer.hitKind === 'slice' || pointer.hitKind === 'core';
        els.probeStrip.classList.toggle('is-locked', locked);
        const namePart = pointer.hitKind === 'core'
          ? 'HIGGS CORE'
          : (pointer.slice ? (pointer.slice.layer === 's' ? pointer.slice.sys.name : pointer.slice.dev.name).toUpperCase() : pointer.zone);
        els.probeText.textContent = `PROBE [${namePart}] • r=${pointer.r.toFixed(2)}m • φ=${pointer.phiDeg.toFixed(1)}° • y=${pointer.worldY >= 0 ? '+' : ''}${pointer.worldY.toFixed(2)}m`;
      } else {
        els.probeStrip.classList.remove('is-locked');
        els.probeText.textContent = 'PROBE STANDBY • HOVER 3D PIE FOR POLAR TELEMETRY & MOUSE HELPER';
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Live Audio & Voice State Calculation
  // ---------------------------------------------------------------------------

  function shouldBeFlatSuperPie() {
    if (state.manualLock === true) return true;
    if (state.manualLock === false) return false;
    if (!state.autoJoinVoice) return false;
    return state.voiceState === 'speaking' || state.voiceState === 'executing';
  }

  function updateAudioSpectrum() {
    let uLevel = 0;
    let aLevel = 0;
    const binsOut = state.fftBins;

    if (micAnalyser && micBinBuf) {
      micAnalyser.getByteFrequencyData(micBinBuf);
      let sum = 0;
      for (let i = 0; i < micBinBuf.length; i++) sum += micBinBuf[i];
      uLevel = clamp(sum / (micBinBuf.length * 130), 0, 1);
    }

    if (remoteAnalyser && remoteBinBuf) {
      remoteAnalyser.getByteFrequencyData(remoteBinBuf);
      let sum = 0;
      for (let i = 0; i < remoteBinBuf.length; i++) sum += remoteBinBuf[i];
      aLevel = clamp(sum / (remoteBinBuf.length * 125), 0, 1);
    }

    if (state.voiceState === 'speaking' && aLevel < 0.14) {
      aLevel = 0.34 + 0.16 * Math.sin(anim.wavePhase * 3.1) + 0.08 * Math.cos(anim.wavePhase * 5.7);
    } else if (state.voiceState === 'listening' && uLevel < 0.05) {
      uLevel = 0.08 + 0.04 * Math.sin(anim.wavePhase * 2.2);
    }

    const srcBuf = (state.voiceState === 'speaking' && remoteBinBuf) ? remoteBinBuf : micBinBuf;
    const len = binsOut.length;
    for (let i = 0; i < len; i++) {
      let target = 0;
      if (srcBuf && srcBuf.length > 0) {
        const idx = Math.min(srcBuf.length - 1, Math.floor((i / len) * (srcBuf.length * 0.72)));
        target = clamp(srcBuf[idx] / 210, 0, 1);
      }
      if (target < 0.08 && (state.voiceState === 'listening' || state.voiceState === 'speaking')) {
        target = Math.max(uLevel, aLevel) * (0.45 + 0.55 * Math.abs(Math.sin(anim.wavePhase * 2.3 + i * 0.65)));
      }
      binsOut[i] = lerp(binsOut[i], target, 0.32);
    }

    state.userAudioLevel = uLevel;
    state.aiAudioLevel = aLevel;
    state.audioLevel = Math.max(uLevel, aLevel);

    if (els.voiceEnergyFill) {
      const meterPct = Math.round(clamp(Math.max(0.08, state.audioLevel + anim.burstEnergy * 0.35), 0.06, 1) * 100);
      els.voiceEnergyFill.style.width = `${meterPct}%`;
    }
  }

  function isSliceVoiceFocused(slice) {
    if (!slice) return false;
    if (slice.layer === 's') {
      return state.focusedSysKey !== '' && state.focusedSysKey === slice.sysKey;
    }
    return state.focusedDeviceIds.includes(slice.devId);
  }

  function getSliceBaseTargetPop(slice) {
    const isFocused = slice.key === state.focusedSliceKey || isSliceVoiceFocused(slice);
    const isSel = slice.layer !== 's' && slice.devId === state.selectedDeviceId;
    return isFocused ? 0.56 : (isSel ? 0.26 : 0.0);
  }

  function getSliceTransform(slice, includeHover = true) {
    const binIdx = slice.index % state.fftBins.length;
    const binEnergy = state.fftBins[binIdx] || 0;
    const hovered = includeHover && state.hoveredSliceKey === slice.key;
    const selected = slice.layer !== 's' && state.selectedDeviceId === slice.devId;
    const voiceFocused = isSliceVoiceFocused(slice);
    const pop = includeHover ? (anim.popByKey[slice.key] || 0) : getSliceBaseTargetPop(slice);

    if (slice.layer === 'v') {
      const dev = slice.dev || {};
      const lvl = dev.power ? clamp((dev.brightness ?? 75) / 100, 0.25, 1) : 0.08;
      const baseH = 0.26 + lvl * 0.42;
      const voiceBoost = state.voiceState === 'listening'
        ? binEnergy * 0.52
        : (state.voiceState === 'speaking' ? binEnergy * 0.34 : 0);
      const lift = (hovered ? 0.08 : 0) + (voiceFocused ? 0.14 * anim.focusBlend : 0);
      return {
        y: anim.yV + lift,
        height: baseH + voiceBoost + (voiceFocused ? 0.18 * anim.focusBlend : 0),
        pop: pop * 0.65,
        highlight: (hovered ? 0.85 : 0) + (selected ? 0.55 : 0) + (voiceFocused ? 0.95 : 0)
      };
    }

    if (slice.layer === 'o') {
      const dev = slice.dev || {};
      const baseH = dev.power ? 0.38 : 0.24;
      const voiceBoost = state.voiceState === 'listening'
        ? binEnergy * 0.38
        : (state.voiceState === 'speaking' ? binEnergy * 0.24 : 0);
      const lift = (hovered ? 0.06 : 0) + (voiceFocused ? 0.12 * anim.focusBlend : 0);
      return {
        y: Y_SEPARATED_O + lift,
        height: baseH + voiceBoost + (selected || voiceFocused ? 0.22 : 0),
        pop,
        highlight: (hovered ? 0.88 : 0) + (selected ? 0.65 : 0) + (voiceFocused ? 1.0 : 0)
      };
    }

    const sys = slice.sys || {};
    const sysActive = Boolean(sys.active);
    const usageScore = clamp(Number(sys.usageScore || 0), 0, 1);
    const smoothedH = anim.sysHeightByKey[slice.sysKey];
    const baseH = Number.isFinite(smoothedH) ? smoothedH : (0.16 + usageScore * 0.48);
    let reactivePulse = 0;
    if (slice.sysKey === 'voice' && state.voiceState !== 'idle') {
      reactivePulse = binEnergy * 0.28;
    } else if (slice.sysKey === 'cast' && (state.captureState?.active || state.streamStatus?.isStreaming || state.streamStatus?.active)) {
      reactivePulse = (state.captureState?.audioLevel || 0) * 0.24 + binEnergy * 0.08;
    } else if (slice.sysKey === 'lights' && state.ambientSyncActive && (state.captureState?.active || state.streamStatus?.isStreaming || state.streamStatus?.active)) {
      reactivePulse = (state.captureState?.audioLevel || 0) * 0.14;
    }
    return {
      y: anim.yS + (voiceFocused ? 0.08 * anim.focusBlend : 0),
      height: clamp(baseH + reactivePulse + (voiceFocused ? 0.18 : (hovered ? 0.12 : 0)), 0.14, 0.88),
      pop: pop * 0.75,
      highlight: (hovered ? 0.84 : 0) + clamp(usageScore * 0.72 + (sysActive ? 0.18 : 0), 0, 0.75) + (voiceFocused ? 0.90 : 0)
    };
  }

  function getSliceLiveTransform(slice) {
    return getSliceTransform(slice, true);
  }

  function getSliceRestTransform(slice) {
    return getSliceTransform(slice, false);
  }

  // ---------------------------------------------------------------------------
  // Voice Action & User Spin/Zoom Focusing
  // ---------------------------------------------------------------------------

  function spinToSlice(slice, holdMs = 0, source = 'user') {
    if (!slice) return;
    const camAzimuth = PI * 0.5 - (anim.targetYawDeg * PI) / 180;
    const curMid = slice.aMid + anim.spinAngle;
    const delta = wrapAngleSigned(camAzimuth - curMid);
    anim.targetSpinAngle = anim.spinAngle + delta;
    state.userOrbitOverride = false;
    state.focusedSliceKey = slice.key;
    state.focusSource = source;
    state.focusHoldUntil = holdMs > 0 ? (Date.now() + holdMs) : 0;
    triggerEnergyBurst(0.65);

    if (els.resetFocusBtn) els.resetFocusBtn.classList.remove('hidden');
  }

  function clearZoomFocus() {
    closeSliceMenu();
    state.focusedSliceKey = '';
    state.focusedDeviceIds = [];
    state.focusedSysKey = '';
    state.focusLayer = '';
    state.focusSource = '';
    state.activeVoiceAction = null;
    state.focusHoldUntil = 0;
    state.userOrbitOverride = false;
    anim.goalTargetX = 0;
    anim.goalTargetY = 0;
    anim.goalTargetZ = 0;
    applyCameraPreset(state.cameraPreset, true);
    if (els.resetFocusBtn) els.resetFocusBtn.classList.add('hidden');
    if (els.actionBanner) els.actionBanner.classList.add('hidden');
    renderSystemChips(true);
    renderInspector();
  }

  function findDeviceMatchByTarget(target) {
    const raw = String(target || '').trim();
    if (!raw) return null;
    const devs = getUnifiedDevices();
    const byId = devs.find((d) => d.id === raw);
    if (byId) return byId;

    const alnum = foldAlnum(raw);
    if (!alnum) return null;

    const numMap = { uno: '1', one: '1', dos: '2', two: '2', tres: '3', three: '3' };
    const norm = foldName(raw).replace(/\b(uno|one|dos|two|tres|three)\b/g, (m) => numMap[m] || m);
    const normAlnum = foldAlnum(norm);

    const exact = devs.find((d) => foldAlnum(d.name) === normAlnum);
    if (exact) return exact;

    const lampM = norm.match(/^(?:lamp|light|luz|bulb|foco|lampara)\s*([0-9]+)$/);
    if (lampM) {
      const lampHit = devs.find((d) => foldAlnum(d.name) === `lampara${lampM[1]}`);
      if (lampHit) return lampHit;
    }

    if (/\b(cielo|ceiling|techo|magic home)\b/.test(norm)) {
      const mh = devs.find((d) => d.platform === 'magichome');
      if (mh) return mh;
    }
    if (/\b(aire|ac|air cond|clima|split)\b/.test(norm)) {
      const ac = devs.find((d) => d.category === 'ir_ac');
      if (ac) return ac;
    }
    if (/\b(edifier|parlante|speaker|speakers|audio|loudspeaker)\b/.test(norm)) {
      const aud = devs.find((d) => d.category === 'ir_audio');
      if (aud) return aud;
    }
    if (/\b(vacuum|robot|aspiradora|sh7p)\b/.test(norm)) {
      const vac = devs.find((d) => d.category === 'vacuum');
      if (vac) return vac;
    }
    if (/\b(purifier|purificador|r312)\b/.test(norm)) {
      const pur = devs.find((d) => d.category === 'ir_purifier');
      if (pur) return pur;
    }

    return devs.find((d) => {
      const da = foldAlnum(d.name);
      return da.length >= 3 && (da.includes(normAlnum) || (normAlnum.length >= 4 && normAlnum.includes(da)));
    }) || null;
  }

  function sysKeyForTool(toolName, matchedDev) {
    if (toolName === 'control_smart_light' || toolName === 'control_ble_light') return 'lights';
    if (toolName === 'control_robot_vacuum') return 'vacuum';
    if (toolName === 'control_ir_device' || toolName === 'trigger_tuya_scene') return 'ir';
    if (toolName === 'control_google_cast') return 'cast';
    if (matchedDev) {
      if (matchedDev.category === 'light' || matchedDev.category === 'ble_light') return 'lights';
      if (matchedDev.category === 'vacuum') return 'vacuum';
      if (matchedDev._kind === 'cast') return 'cast';
      if (String(matchedDev.category || '').startsWith('ir_')) return 'ir';
    }
    return 'voice';
  }

  function describeToolSummary(toolName, args = {}) {
    if (toolName === 'control_smart_light' || toolName === 'control_ble_light') {
      const parts = [];
      if (args.power !== undefined) parts.push(args.power ? 'Power ON' : 'Power OFF');
      if (args.brightness !== undefined) parts.push(`${args.brightness}%`);
      if (args.color_hex) parts.push(String(args.color_hex).toUpperCase());
      if (args.preset) parts.push(`FX #${args.preset}`);
      return parts.join(' • ') || 'Light Update';
    }
    if (toolName === 'control_ir_device') {
      const parts = [];
      if (args.command) parts.push(String(args.command));
      else if (args.power !== undefined) parts.push(args.power ? 'PowerOn' : 'PowerOff');
      if (args.ac_temp) parts.push(`${args.ac_temp}°C`);
      if (args.ac_mode) parts.push(String(args.ac_mode));
      return parts.join(' • ') || 'IR Command';
    }
    if (toolName === 'control_robot_vacuum') {
      return String(args.action || 'start_clean').toUpperCase();
    }
    if (toolName === 'trigger_tuya_scene') {
      return `Scene: ${args.scene_name || args.scene_id || 'Trigger'}`;
    }
    if (toolName === 'control_google_cast') {
      return `${args.action || 'status'}${args.volume_pct != null ? ` (${args.volume_pct}%)` : ''}`;
    }
    if (toolName === 'batch_smart_actions') {
      const count = Array.isArray(args.actions) ? args.actions.length : 0;
      return `Multi-Device Scene (${count} steps)`;
    }
    return 'Reading Smart Home State';
  }

  function beginVoiceAction(toolName, args = {}) {
    rebuildPieTopology(false);
    const devs = getUnifiedDevices();
    let targetIds = [];
    let primaryDev = null;

    if (toolName === 'batch_smart_actions' && Array.isArray(args.actions)) {
      for (const act of args.actions) {
        const subTarget = act?.arguments?.target || act?.arguments?.scene_name || '';
        const found = findDeviceMatchByTarget(subTarget);
        if (found && !targetIds.includes(found.id)) {
          targetIds.push(found.id);
          if (!primaryDev) primaryDev = found;
        }
      }
      if (!targetIds.length && args.actions.some((a) => /light/i.test(a?.tool || ''))) {
        targetIds = devs.filter((d) => d.category === 'light').map((d) => d.id);
        primaryDev = devs.find((d) => d.category === 'light') || null;
      }
    } else if ((toolName === 'control_smart_light' || toolName === 'control_ble_light') && /^(all|all_lights|todas|lights|)$/i.test(String(args.target || '').trim())) {
      const lightDevs = devs.filter((d) => d.category === 'light' || d.category === 'ble_light');
      targetIds = lightDevs.map((d) => d.id);
      primaryDev = lightDevs[0] || null;
    } else {
      const lookup = args.target || args.scene_name || (toolName === 'control_robot_vacuum' ? 'Sh7p' : '');
      primaryDev = findDeviceMatchByTarget(lookup);
      if (primaryDev) targetIds = [primaryDev.id];
    }

    const sysKey = sysKeyForTool(toolName, primaryDev);
    state.focusedDeviceIds = targetIds;
    state.focusedSysKey = sysKey;
    state.focusLayer = primaryDev ? 'dev' : 's';
    if (primaryDev) {
      state.selectedDeviceId = primaryDev.id;
    }

    const targetLabel = primaryDev
      ? (targetIds.length > 1 ? `${primaryDev.name} (+${targetIds.length - 1})` : primaryDev.name)
      : (args.target || args.scene_name || (toolName === 'list_smart_home_devices' ? 'All Home Nodes' : toolName));

    const summary = describeToolSummary(toolName, args);
    state.activeVoiceAction = {
      toolName,
      targetLabel,
      summary,
      status: 'running',
      detail: 'Executing live voice command...'
    };

    const focusSlice = primaryDev
      ? sliceModels.o.find((s) => s.devId === primaryDev.id)
      : sliceModels.s.find((s) => s.sysKey === sysKey);
    if (focusSlice) {
      spinToSlice(focusSlice, 6500, 'voice');
    }

    if (toolName === 'batch_smart_actions' && Array.isArray(args.actions)) {
      const seenSys = new Set();
      for (const act of args.actions) {
        const subTool = act?.tool || '';
        const subArgs = act?.arguments || {};
        const subDev = findDeviceMatchByTarget(subArgs.target || subArgs.scene_name || '');
        const subSys = sysKeyForTool(subTool, subDev);
        const isDamp = (subTool === 'control_smart_light' || subTool === 'control_ble_light') && subArgs.power === false;
        if (!seenSys.has(subSys)) {
          seenSys.add(subSys);
          recordSystemUsage(
            subSys,
            `${subTool}${subDev ? `: ${subDev.name}` : ''}`,
            isDamp ? { damp: true, boost: 0 } : { boost: 0.34 }
          );
        } else {
          recordSystemUsage(subSys, `${subTool}`, { countEvent: true, boost: isDamp ? 0 : 0.14 });
        }
      }
      recordSystemUsage('voice', `Batch (${args.actions.length} steps)`, { countEvent: false, boost: 0.18 });
    } else if (sysKey !== 'voice') {
      const isOff = ((toolName === 'control_smart_light' || toolName === 'control_ble_light') && args.power === false)
        || (toolName === 'control_robot_vacuum' && /^(pause|stop)$/i.test(String(args.action || '')))
        || (toolName === 'control_google_cast' && /^(stop)$/i.test(String(args.action || '')));
      recordSystemUsage(
        sysKey,
        `${primaryDev ? primaryDev.name : (args.target || args.scene_name || sysKey)}: ${summary}`,
        isOff ? { damp: true, boost: 0 } : { boost: 0.36 }
      );
      recordSystemUsage('voice', `Tool: ${toolName}`, { countEvent: false, boost: 0.14 });
    } else {
      recordSystemUsage('voice', summary, { boost: 0.24 });
    }

    triggerEnergyBurst(1.1);
    setVoiceState('executing');
    renderActionBanner();
    renderDeviceNav();
    renderInspector();
  }

  function completeVoiceAction(toolName, args = {}, result = {}) {
    const ok = result && result.ok !== false && !result.error;
    const method = result?.method || (result?.matchingScenes ? 'Scene Fallback Ready' : '');
    const detailText = ok
      ? (method ? `Confirmed via ${method}` : 'Action completed')
      : String(result?.error || 'Warning').slice(0, 72);

    if (state.activeVoiceAction) {
      state.activeVoiceAction.status = ok ? 'ok' : 'warn';
      state.activeVoiceAction.detail = detailText;
    }
    triggerEnergyBurst(ok ? 0.9 : 0.45);
    state.focusHoldUntil = Date.now() + 4500;
    if (focusReleaseTimer) clearTimeout(focusReleaseTimer);
    focusReleaseTimer = setTimeout(() => {
      if (state.voiceState !== 'executing' && Date.now() >= state.focusHoldUntil - 50) {
        if (state.focusSource === 'voice') {
          clearZoomFocus();
        } else if (state.activeVoiceAction) {
          state.activeVoiceAction = null;
          state.focusedDeviceIds = [];
          state.focusedSysKey = '';
          renderActionBanner();
        }
      }
    }, 4600);

    renderActionBanner();
    renderInspector();
  }

  function renderActionBanner() {
    if (!els.actionBanner) return;
    if (state.activeVoiceAction) {
      const a = state.activeVoiceAction;
      els.actionBanner.className = `vos-action-banner${a.status === 'warn' ? ' is-warn' : ''}`;
      const prefix = a.status === 'running' ? 'AI EXECUTING' : (a.status === 'ok' ? 'VOICE ACTION OK' : 'VOICE NOTICE');
      els.actionBanner.innerHTML = `
        <span class="vos-action-banner-dot"></span>
        <span>${escapeHtml(prefix)}: ${escapeHtml(a.targetLabel)} &rarr; ${escapeHtml(a.summary)} (${escapeHtml(a.detail)})</span>
      `;
      return;
    }

    if (state.voiceState === 'connecting') {
      els.actionBanner.className = 'vos-action-banner is-listening';
      els.actionBanner.innerHTML = `
        <span class="vos-action-banner-dot"></span>
        <span>CONNECTING VOICE &mdash; Requesting microphone access &amp; establishing live audio session...</span>
      `;
      return;
    }

    if (state.voiceState === 'listening') {
      els.actionBanner.className = 'vos-action-banner is-listening';
      els.actionBanner.innerHTML = `
        <span class="vos-action-banner-dot"></span>
        <span>LISTENING TO YOU &mdash; Higgs Energy Field reacting live to your microphone audio</span>
      `;
      return;
    }

    if (state.voiceState === 'speaking') {
      els.actionBanner.className = 'vos-action-banner';
      els.actionBanner.innerHTML = `
        <span class="vos-action-banner-dot"></span>
        <span>TREVA SPEAKING &mdash; V &bull; O &bull; S converged into Flat 3D Concentric Super-Pie</span>
      `;
      return;
    }

    els.actionBanner.className = 'vos-action-banner hidden';
    els.actionBanner.innerHTML = '';
  }

  // ---------------------------------------------------------------------------
  // State Transitions (Idle <-> Listening <-> AI Speaking Flat Super-Pie)
  // ---------------------------------------------------------------------------

  function applyCameraPreset(preset, forceGoal = false) {
    state.cameraPreset = preset || 'iso';
    state.userOrbitOverride = false;
    if (preset === 'side') {
      anim.targetPitchDeg = 14;
      anim.targetYawDeg = 0;
      anim.targetCamDist = 11.4;
    } else if (preset === 'front') {
      anim.targetPitchDeg = 82;
      anim.targetYawDeg = 0;
      anim.targetCamDist = 9.8;
    } else {
      anim.targetPitchDeg = 41;
      anim.targetYawDeg = 0;
      anim.targetCamDist = 10.6;
    }
    if (forceGoal) {
      anim.goalTargetX = 0;
      anim.goalTargetY = 0;
      anim.goalTargetZ = 0;
    }
  }

  function updateModeBadgeAndClasses() {
    const flat = shouldBeFlatSuperPie();
    state.joined = flat;
    if (els.viewport) {
      els.viewport.classList.toggle('is-joined', flat);
      els.viewport.classList.toggle('is-exploded', !flat);
      els.viewport.classList.toggle('is-talking', state.voiceState === 'speaking' || state.voiceState === 'executing');
      els.viewport.classList.toggle('is-listening', state.voiceState === 'listening');
      els.viewport.dataset.solo = state.soloLayer;
    }
    if (els.modeBadge) {
      if (state.voiceState === 'executing' || state.activeVoiceAction) {
        els.modeBadge.textContent = 'ZOOMING ACTIVE VOICE PIE SLICE';
        els.modeBadge.className = 'badge badge-live';
      } else if (flat) {
        els.modeBadge.textContent = state.voiceState === 'speaking' ? 'AI SPEAKING • FLAT 3D SUPER-PIE' : '3D FLAT SUPER-PIE CONVERGED';
        els.modeBadge.className = 'badge badge-live';
      } else if (state.voiceState === 'listening') {
        els.modeBadge.textContent = 'MIC ACTIVE • HIGGS FIELD REACTIVE';
        els.modeBadge.className = 'badge badge-live';
      } else {
        els.modeBadge.textContent = '3-TIER PIE TUBES SEPARATED';
        els.modeBadge.className = 'badge badge-idle';
      }
    }
    if (els.joinBtn) {
      els.joinBtn.textContent = flat ? 'Separate 3D Pie Tiers' : 'Flatten 3D Super-Pie';
    }
  }

  function setVoiceState(mode) {
    const clean = mode || 'idle';
    const prev = state.voiceState;
    state.voiceState = clean;

    if (prev !== clean) {
      const okLvl = clean === 'speaking' || clean === 'executing' ? 'ok' : 'info';
      pushLog('VOICE', `Agent state -> ${clean.toUpperCase()}`, okLvl);
      if (clean === 'speaking' || clean === 'executing') triggerEnergyBurst(0.75);
      const sysMeta = buildSystemSlicesMeta();
      updateSliceDynamicData(getUnifiedDevices(), sysMeta);
      renderSystemChips(true);
      if (state.focusLayer === 's' && state.focusedSysKey === 'voice') {
        updateSysInspectorLive(sysMeta.find((x) => x.sysKey === 'voice'));
      }
    }

    updateModeBadgeAndClasses();
    renderActionBanner();
  }

  function pulseCommandJoin() {
    triggerEnergyBurst(0.95);
    if (state.voiceState !== 'listening' && state.voiceState !== 'speaking') {
      setVoiceState('executing');
      if (cooldownTimer) clearTimeout(cooldownTimer);
      cooldownTimer = setTimeout(() => {
        if (state.voiceState === 'executing') {
          setVoiceState('idle');
        }
      }, 3200);
    }
  }

  // ---------------------------------------------------------------------------
  // Animation Step + Multi-Pass WebGL Render + HUD Overlay Loop
  // ---------------------------------------------------------------------------

  function stepAnimation(dt) {
    const dtClamp = Math.min(0.05, Math.max(0.004, dt));
    const smooth = 1 - Math.exp(-7.5 * dtClamp);
    const fast = 1 - Math.exp(-12.0 * dtClamp);
    const weightSmooth = 1 - Math.exp(-5.0 * dtClamp);

    anim.clock += dtClamp;
    anim.wavePhase += dtClamp * (state.voiceState === 'listening' || state.voiceState === 'speaking' ? 3.8 : 1.45);
    updateAudioSpectrum();

    const nowMs = Date.now();
    const perfNow = typeof performance !== 'undefined' ? performance.now() : nowMs;
    const sysMeta = buildSystemSlicesMeta();
    const sysMap = new Map(sysMeta.map((x) => [x.sysKey, x]));
    let maxWeightDrift = sliceModels.s.length !== sysMeta.length ? 1 : 0;

    for (const sys of sysMeta) {
      const prevW = Number.isFinite(anim.sysWeightByKey[sys.sysKey]) ? anim.sysWeightByKey[sys.sysKey] : sys.targetWeight;
      const nextW = lerp(prevW, sys.targetWeight, weightSmooth);
      anim.sysWeightByKey[sys.sysKey] = nextW;

      const targetH = 0.16 + sys.usageScore * 0.48;
      const prevH = Number.isFinite(anim.sysHeightByKey[sys.sysKey]) ? anim.sysHeightByKey[sys.sysKey] : targetH;
      anim.sysHeightByKey[sys.sysKey] = lerp(prevH, targetH, fast);
    }

    for (const s of sliceModels.s) {
      const sys = sysMap.get(s.sysKey);
      if (!sys) continue;
      s.sys = sys;
      s.baseColor = sys.color;
      const drift = Math.abs((anim.sysWeightByKey[s.sysKey] || sys.targetWeight) - (s.currentWeight || sys.targetWeight));
      if (drift > maxWeightDrift) maxWeightDrift = drift;
    }

    if ((sliceModels.s.length !== sysMeta.length) || (maxWeightDrift > 0.016 && (perfNow - lastSysGeoRebuildAt) >= 150)) {
      rebuildSystemPieGeometry(sysMeta, true);
    }

    if ((perfNow - lastUsageRenderAt) >= 420) {
      lastUsageRenderAt = perfNow;
      renderSystemChips(false);
      if (state.focusLayer === 's' && state.focusedSysKey) {
        updateSysInspectorLive(sysMap.get(state.focusedSysKey));
      }
    }

    anim.burstEnergy = Math.max(0, anim.burstEnergy - dtClamp * 1.15);
    const activeNodes = (state.smartDevices || []).filter((d) => d.power).length;
    const baseField = 0.65 + clamp(activeNodes / Math.max(1, (state.smartDevices || []).length), 0, 1) * 0.35;
    const hoverGain = pointer.inside && pointer.hitKind !== 'none' ? 0.25 : 0;
    const goalEnergy = baseField + state.audioLevel * 1.15 + hoverGain + anim.burstEnergy;
    anim.energyLevel = lerp(anim.energyLevel, goalEnergy, fast);

    const flat = shouldBeFlatSuperPie();
    const listenBreath = state.voiceState === 'listening' ? (0.14 * Math.sin(anim.wavePhase * 2.0) + state.userAudioLevel * 0.25) : 0;
    anim.yV = lerp(anim.yV, flat ? 0.0 : (Y_SEPARATED_V + listenBreath), smooth);
    anim.yS = lerp(anim.yS, flat ? 0.0 : (Y_SEPARATED_S - listenBreath), smooth);

    if (!dragging && !state.focusedSliceKey && !state.userOrbitOverride && !state.hoveredSliceKey && !state.openMenuSliceKey && pointer.hitKind !== 'core') {
      const idleSpinRate = state.voiceState === 'speaking' ? 0.22 : (state.voiceState === 'listening' ? 0.14 : 0.08);
      anim.targetSpinAngle += dtClamp * idleSpinRate;
    }
    anim.spinAngle = lerp(anim.spinAngle, anim.targetSpinAngle, smooth);

    const allSlices = [...sliceModels.v, ...sliceModels.o, ...sliceModels.s];
    let focusedObj = null;
    for (const s of allSlices) {
      const basePop = getSliceBaseTargetPop(s);
      const isHov = s.key === state.hoveredSliceKey;
      const targetPop = basePop > 0 ? basePop : (isHov ? 0.15 : 0.0);
      anim.popByKey[s.key] = lerp(anim.popByKey[s.key] || 0, targetPop, fast);
      if (s.key === state.focusedSliceKey) focusedObj = s;
    }

    const aspect = Math.max(0.4, viewWidth / Math.max(1, viewHeight));
    const aspectFit = Math.max(1.0, 1.18 / aspect);
    const wantFocus = Boolean(focusedObj) && (!state.userOrbitOverride);
    anim.focusBlend = lerp(anim.focusBlend, wantFocus ? 1.0 : 0.0, smooth);

    if (focusedObj && wantFocus) {
      const pop = anim.popByKey[focusedObj.key] || 0;
      const rMid = (focusedObj.rIn + focusedObj.rOut) * 0.5 + pop;
      const dyn = getSliceLiveTransform(focusedObj);
      const worldP = slicePointToWorld(
        rMid * Math.cos(focusedObj.aMid),
        0,
        rMid * Math.sin(focusedObj.aMid),
        anim.spinAngle,
        0,
        0,
        dyn.y,
        dyn.height
      );
      anim.goalTargetX = worldP[0] * 0.52;
      anim.goalTargetY = worldP[1] * 0.58;
      anim.goalTargetZ = worldP[2] * 0.52;
      const zoomDist = (state.activeVoiceAction ? 7.6 : 8.4) * Math.max(1.0, 1.05 / aspect);
      anim.camDist = lerp(anim.camDist, zoomDist, smooth);
      if (state.cameraPreset === 'iso') {
        anim.pitchDeg = lerp(anim.pitchDeg, 36, smooth);
      } else {
        anim.pitchDeg = lerp(anim.pitchDeg, anim.targetPitchDeg, smooth);
      }
      anim.yawDeg = lerp(anim.yawDeg, anim.targetYawDeg, smooth);
    } else {
      anim.goalTargetX = 0;
      anim.goalTargetY = 0.20;
      anim.goalTargetZ = 0;
      const desiredDist = state.userOrbitOverride ? anim.targetCamDist : anim.targetCamDist * aspectFit;
      anim.camDist = lerp(anim.camDist, desiredDist, smooth);
      anim.pitchDeg = lerp(anim.pitchDeg, anim.targetPitchDeg, smooth);
      anim.yawDeg = lerp(anim.yawDeg, anim.targetYawDeg, smooth);
    }

    anim.targetX = lerp(anim.targetX, anim.goalTargetX, smooth);
    anim.targetY = lerp(anim.targetY, anim.goalTargetY, smooth);
    anim.targetZ = lerp(anim.targetZ, anim.goalTargetZ, smooth);

    const pitchR = (clamp(anim.pitchDeg, 6, 86) * PI) / 180;
    const yawR = (anim.yawDeg * PI) / 180;
    const horiz = anim.camDist * Math.cos(pitchR);
    currentCamPos = [
      anim.targetX + horiz * Math.sin(yawR),
      anim.targetY + anim.camDist * Math.sin(pitchR),
      anim.targetZ + horiz * Math.cos(yawR)
    ];

    if (threeCamera && threeProjViewMat && threeProjViewInvMat) {
      if (Math.abs(threeCamera.aspect - aspect) > 0.0005) {
        threeCamera.aspect = aspect;
        threeCamera.updateProjectionMatrix();
      }
      threeCamera.position.set(currentCamPos[0], currentCamPos[1], currentCamPos[2]);
      threeCamera.lookAt(anim.targetX, anim.targetY, anim.targetZ);
      threeCamera.updateMatrixWorld(true);

      threeProjViewMat.multiplyMatrices(threeCamera.projectionMatrix, threeCamera.matrixWorldInverse);
      currentViewProj.set(threeProjViewMat.elements);
      threeProjViewInvMat.copy(threeProjViewMat).invert();
      currentInvViewProj.set(threeProjViewInvMat.elements);
    } else {
      const proj = mat4Perspective((38 * PI) / 180, aspect, 0.2, 65);
      const view = mat4LookAt(currentCamPos, [anim.targetX, anim.targetY, anim.targetZ], [0, 1, 0]);
      currentViewProj = mat4Multiply(proj, view);
      currentInvViewProj = mat4Invert(currentViewProj);
    }

    // Re-evaluate hover every frame so spinning hologram updates probe live even if cursor stays still
    evaluatePointerHover();

    const wantProbe = pointer.inside && !dragging && pointer.hitKind !== 'none';
    pointer.activeBlend = lerp(pointer.activeBlend, wantProbe ? 1.0 : 0.0, fast);
    pointer.smoothWorld[0] = lerp(pointer.smoothWorld[0], pointer.worldPos[0], fast);
    pointer.smoothWorld[1] = lerp(pointer.smoothWorld[1], pointer.worldPos[1], fast);
    pointer.smoothWorld[2] = lerp(pointer.smoothWorld[2], pointer.worldPos[2], fast);
    pointer.smoothX = lerp(pointer.smoothX, pointer.x, fast);
    pointer.smoothY = lerp(pointer.smoothY, pointer.y, fast);

    stepEnergyField(dtClamp);
  }

  function renderWebGLScene() {
    if (!gl || !threeRenderer || !threeScene || !threeCamera) return false;

    const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (lastRenderPerfNow > 0) {
      const frameDelta = nowMs - lastRenderPerfNow;
      if (frameDelta > 4 && frameDelta < 250) {
        smoothedFrameMs = smoothedFrameMs * 0.90 + frameDelta * 0.10;
        if (smoothedFrameMs > 84 && gpuTier !== 'low') {
          slowFrameStreak += 1;
          if (slowFrameStreak >= 64) {
            slowFrameStreak = 0;
            const nextTier = gpuTier === 'high' ? 'medium' : 'low';
            applyAdaptiveGpuTier(nextTier, `${Math.round(smoothedFrameMs)}ms frame`);
          }
        } else if (smoothedFrameMs < 46) {
          slowFrameStreak = 0;
        }
      }
    }
    lastRenderPerfNow = nowMs;

    const coreHex = state.voiceState === 'listening'
      ? 0x2ee6a3
      : (state.voiceState === 'speaking' || state.voiceState === 'executing' ? 0x38dcff : 0x4da6ff);

    // 1. Calibration Polar Detector Grid Planes
    if (threeGridPlaneMeshes.length > 0) {
      const gridPlanes = shouldBeFlatSuperPie()
        ? [[0, 0.28], [-0.10, 0.11]]
        : [[anim.yV, 0.15], [0, 0.20], [anim.yS, 0.26]];
      for (let i = 0; i < threeGridPlaneMeshes.length; i++) {
        const mesh = threeGridPlaneMeshes[i];
        const cfgPlane = gridPlanes[i];
        if (!cfgPlane) {
          mesh.visible = false;
          continue;
        }
        mesh.visible = true;
        mesh.position.y = cfgPlane[0] - 0.18;
        mesh.rotation.y = -anim.spinAngle * 0.25;
        mesh.material.opacity = cfgPlane[1];
      }
    }

    // 2. Sync live pie-tube positions, scale & spin
    syncThreePieTransforms();

    // 3. Animate Central GLSL H0 Higgs Singularity Core, Lattice, Gimbals, Base Projector & Accent Light
    const coreScale = 0.88 + 0.05 * Math.sin(anim.clock * 4.2) + state.audioLevel * 0.24 + anim.burstEnergy * 0.18;
    if (threeBaseDisc) {
      threeBaseDisc.position.y = anim.yS - 0.56;
      const bu = threeBaseDisc.material && threeBaseDisc.material.uniforms;
      if (bu) {
        bu.uTime.value = anim.clock;
        bu.uEnergy.value = anim.energyLevel;
        bu.uBurst.value = anim.burstEnergy;
        bu.uColor.value.setHex(coreHex);
      }
    }
    if (threeEmitterCone) {
      threeEmitterCone.position.y = 1.38 + (anim.yS - 0.56);
      const cu = threeEmitterCone.material && threeEmitterCone.material.uniforms;
      if (cu) {
        cu.uTime.value = anim.clock;
        cu.uEnergy.value = anim.energyLevel;
        cu.uColor.value.setHex(coreHex);
      }
    }
    if (threeCorePlasma) {
      threeCorePlasma.scale.setScalar(coreScale);
      threeCorePlasma.rotation.y = anim.clock * 0.72;
      threeCorePlasma.rotation.x = Math.sin(anim.clock * 0.4) * 0.22;
      const pu = threeCorePlasma.material && threeCorePlasma.material.uniforms;
      if (pu) {
        pu.uTime.value = anim.clock;
        pu.uAudio.value = state.audioLevel;
        pu.uBurst.value = anim.burstEnergy;
        pu.uColor.value.setHex(coreHex);
      }
    }
    if (threeCoreLattice) {
      threeCoreLattice.scale.setScalar(coreScale * 1.04);
      threeCoreLattice.rotation.set(anim.clock * 0.42, -anim.clock * 0.85, anim.clock * 0.22);
      threeCoreLattice.material.opacity = 0.38 + 0.22 * Math.min(1, anim.energyLevel * 0.5) + anim.burstEnergy * 0.26;
    }
    if (threeCoreShell) {
      threeCoreShell.material.color.setHex(0x061024);
      threeCoreShell.material.emissive.setHex(coreHex);
      threeCoreShell.material.emissiveIntensity = 0.14 + state.audioLevel * 0.24 + anim.burstEnergy * 0.36;
    }
    if (threeCoreLight) {
      threeCoreLight.color.setHex(coreHex);
      threeCoreLight.intensity = 1.85 + anim.energyLevel * 0.75 + anim.burstEnergy * 1.35;
    }
    for (let i = 0; i < threeGimbalRings.length; i++) {
      const ring = threeGimbalRings[i];
      const ud = ring.userData || {};
      const speedMul = 0.8 + 0.55 * anim.energyLevel + 0.75 * anim.burstEnergy;
      ring.rotation.x = (ud.baseTiltX || 0) + Math.sin(anim.clock * 0.52 + i) * 0.16;
      ring.rotation.z = (ud.baseTiltZ || 0) + Math.cos(anim.clock * 0.44 + i) * 0.12;
      ring.rotation.y = anim.clock * (ud.speed || 1) * speedMul;
    }

    // 4. Update volumetric particle size modulation
    if (threeParticlePoints && threeParticlePoints.material) {
      threeParticlePoints.material.size = 0.155 * (0.88 + 0.26 * anim.energyLevel + 0.34 * anim.burstEnergy);
    }

    // 5. Update dual-layer crystal & caustic plasma pie slices + dynamic focus accent light
    let activeTargetSlice = null;
    for (const lName of ['s', 'o', 'v']) {
      const layerFaded = state.soloLayer !== 'all' && state.soloLayer !== lName;
      for (const s of sliceModels[lName]) {
        const m = s.mesh;
        if (!m || !m.material) continue;

        const dyn = getSliceLiveTransform(s);
        const pnl = getSlicePnlProfile(s);
        const c = s.baseColor;
        const hl = layerFaded ? 0 : dyn.highlight;
        const glow = hl > 0.6 ? [0.46, 0.94, 1.0] : pnl.rgb;
        if (hl > 0.68) activeTargetSlice = s;

        if (m.innerMesh && m.innerMaterial && m.innerMaterial.uniforms) {
          m.innerMesh.visible = !layerFaded;
          const iu = m.innerMaterial.uniforms;
          iu.uTime.value = anim.clock;
          iu.uColor.value.setRGB(clamp(c[0], 0, 1), clamp(c[1], 0, 1), clamp(c[2], 0, 1));
          iu.uGlowColor.value.setRGB(glow[0], glow[1], glow[2]);
          iu.uHighlight.value = hl;
          iu.uAudio.value = state.audioLevel;
          iu.uActive.value = (s.layer === 's' ? (s.sys?.active ? 1.0 : 0.28) : (s.dev?.power ? 1.0 : 0.2));
          iu.uPattern.value = pnl.pattern || 1;
        }

        if (!m.isPhysicalGlass && threePnlTextures && m.lastPattern !== pnl.pattern) {
          m.material.map = threePnlTextures[pnl.pattern] || null;
          m.material.needsUpdate = true;
          m.lastPattern = pnl.pattern;
        }

        const pShade = m.parity || 1.0;
        const crystalGain = m.isPhysicalGlass ? (0.72 + hl * 0.24) : (0.76 + hl * 0.24);
        m.material.color.setRGB(
          clamp(c[0] * pShade * crystalGain, 0, 1),
          clamp(c[1] * pShade * crystalGain, 0, 1),
          clamp(c[2] * pShade * crystalGain, 0, 1)
        );
        m.material.emissive.setRGB(
          clamp(c[0] * 0.65 + glow[0] * 0.35, 0, 1),
          clamp(c[1] * 0.65 + glow[1] * 0.35, 0, 1),
          clamp(c[2] * 0.65 + glow[2] * 0.35, 0, 1)
        );
        m.material.emissiveIntensity = layerFaded
          ? 0.02
          : ((m.isPhysicalGlass ? 0.06 : 0.12) + hl * 0.28 + state.audioLevel * 0.12 + anim.burstEnergy * 0.18);

        if (m.isPhysicalGlass) {
          if (layerFaded) {
            m.material.transmission = 0;
            m.material.transparent = true;
            m.material.opacity = 0.08;
            m.material.depthWrite = false;
          } else {
            m.material.transmission = gpuTier === 'high' ? 0.76 : 0.62;
            m.material.transparent = false;
            m.material.opacity = 1.0;
            m.material.depthWrite = true;
          }
        } else {
          const baseA = s.layer === 'v' ? 0.72 : (s.layer === 'o' ? 0.68 : 0.64);
          m.material.opacity = layerFaded ? 0.07 : clamp(baseA + hl * 0.20, 0.12, 0.92);
          m.material.depthWrite = !layerFaded;
        }

        if (m.wedgeMesh) {
          m.wedgeMesh.renderOrder = layerFaded ? 1 : 3;
        }

        if (m.edgeLines && m.edgeMaterial) {
          m.edgeLines.visible = !layerFaded;
          if (!layerFaded) {
            if (hl > 0.65) {
              m.edgeMaterial.color.setRGB(1.35, 1.55, 1.72);
            } else {
              m.edgeMaterial.color.setRGB(
                clamp(c[0] * 0.85 + pnl.rgb[0] * 0.35, 0, 1.2),
                clamp(c[1] * 0.85 + pnl.rgb[1] * 0.35, 0, 1.2),
                clamp(c[2] * 0.85 + pnl.rgb[2] * 0.35, 0, 1.2)
              );
            }
            m.edgeMaterial.opacity = clamp(0.28 + hl * 0.68, 0.22, 0.98);
          }
        }
      }
    }

    if (threeFocusLight) {
      if (activeTargetSlice) {
        const dyn = getSliceLiveTransform(activeTargetSlice);
        const rMid = (activeTargetSlice.rIn + activeTargetSlice.rOut) * 0.5 + dyn.pop;
        const wp = slicePointToWorld(rMid * Math.cos(activeTargetSlice.aMid), 0.75, rMid * Math.sin(activeTargetSlice.aMid), anim.spinAngle, 0, 0, dyn.y, dyn.height);
        threeFocusLight.position.lerp(new THREE.Vector3(wp[0], wp[1], wp[2]), 0.16);
        threeFocusLight.color.setRGB(activeTargetSlice.baseColor[0], activeTargetSlice.baseColor[1], activeTargetSlice.baseColor[2]);
        threeFocusLight.intensity = 2.6 + state.audioLevel * 1.1;
      } else {
        threeFocusLight.position.lerp(new THREE.Vector3(Math.cos(anim.clock * 0.6) * 2.8, 1.6, Math.sin(anim.clock * 0.6) * 2.8), 0.05);
        threeFocusLight.color.setHex(coreHex);
        threeFocusLight.intensity = 1.4;
      }
    }

    if (threeComposer && getTierConfig().useBloom) {
      try {
        threeComposer.render();
      } catch (_) {
        threeRenderer.render(threeScene, threeCamera);
      }
    } else {
      threeRenderer.render(threeScene, threeCamera);
    }
    return true;
  }

  // Fallback 3D wireframe/prism + particle energy renderer on 2D HUD canvas if WebGL is unavailable
  function renderSoftware3DFallback(ctx) {
    const drawList = [];
    for (const lName of ['s', 'o', 'v']) {
      if (state.soloLayer !== 'all' && state.soloLayer !== lName) continue;
      for (const s of sliceModels[lName]) {
        const dyn = getSliceLiveTransform(s);
        const popX = Math.cos(s.aMid) * dyn.pop;
        const popZ = Math.sin(s.aMid) * dyn.pop;
        const rMid = (s.rIn + s.rOut) * 0.5;
        const wp = slicePointToWorld(rMid * Math.cos(s.aMid), 0, rMid * Math.sin(s.aMid), anim.spinAngle, popX, popZ, dyn.y, dyn.height);
        const dist2 = (wp[0] - currentCamPos[0]) ** 2 + (wp[1] - currentCamPos[1]) ** 2 + (wp[2] - currentCamPos[2]) ** 2;
        drawList.push({ s, dyn, popX, popZ, dist2 });
      }
    }
    drawList.sort((a, b) => b.dist2 - a.dist2);

    for (const { s, dyn, popX, popZ } of drawList) {
      const segs = 7;
      const topPts = [];
      const botPts = [];
      for (let i = 0; i <= segs; i++) {
        const a = s.a0 + ((s.a1 - s.a0) * i) / segs;
        const wo = slicePointToWorld(s.rOut * Math.cos(a), 0.5, s.rOut * Math.sin(a), anim.spinAngle, popX, popZ, dyn.y, dyn.height);
        const bo = slicePointToWorld(s.rOut * Math.cos(a), -0.5, s.rOut * Math.sin(a), anim.spinAngle, popX, popZ, dyn.y, dyn.height);
        topPts.push(projectWorldPoint(wo[0], wo[1], wo[2], currentViewProj, viewWidth, viewHeight));
        botPts.push(projectWorldPoint(bo[0], bo[1], bo[2], currentViewProj, viewWidth, viewHeight));
      }
      for (let i = segs; i >= 0; i--) {
        const a = s.a0 + ((s.a1 - s.a0) * i) / segs;
        const wi = slicePointToWorld(s.rIn * Math.cos(a), 0.5, s.rIn * Math.sin(a), anim.spinAngle, popX, popZ, dyn.y, dyn.height);
        const bi = slicePointToWorld(s.rIn * Math.cos(a), -0.5, s.rIn * Math.sin(a), anim.spinAngle, popX, popZ, dyn.y, dyn.height);
        topPts.push(projectWorldPoint(wi[0], wi[1], wi[2], currentViewProj, viewWidth, viewHeight));
        botPts.push(projectWorldPoint(bi[0], bi[1], bi[2], currentViewProj, viewWidth, viewHeight));
      }

      ctx.beginPath();
      topPts.forEach((p, idx) => (idx === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.closePath();
      ctx.fillStyle = rgbCss(s.baseColor, 0.54 + dyn.highlight * 0.25);
      ctx.fill();
      ctx.strokeStyle = dyn.highlight > 0.6 ? '#e0f2fe' : rgbCss(s.baseColor, 0.9);
      ctx.lineWidth = dyn.highlight > 0.6 ? 2 : 1.1;
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(topPts[0].x, topPts[0].y);
      ctx.lineTo(botPts[0].x, botPts[0].y);
      ctx.lineTo(botPts[segs].x, botPts[segs].y);
      ctx.lineTo(topPts[segs].x, topPts[segs].y);
      ctx.closePath();
      ctx.fillStyle = rgbCss(s.baseColor, 0.36);
      ctx.fill();
      ctx.stroke();
    }

    // Software fallback particle dots
    for (let i = 0; i < PARTICLE_COUNT; i += 4) {
      const off = i * 8;
      const p = projectWorldPoint(particleData[off], particleData[off + 1], particleData[off + 2], currentViewProj, viewWidth, viewHeight);
      if (!p.visible) continue;
      ctx.fillStyle = `rgba(${Math.round(particleData[off + 3] * 255)},${Math.round(particleData[off + 4] * 255)},${Math.round(particleData[off + 5] * 255)},${(particleData[off + 6] * 0.7).toFixed(2)})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 1.8, 0, TAU);
      ctx.fill();
    }
  }

  function renderMouseHelperHud(ctx) {
    if (!pointer.inside || dragging || !pointer.helperEnabled || pointer.hitKind === 'none') return;

    const sx = pointer.smoothX;
    const sy = pointer.smoothY;
    const isCore = pointer.hitKind === 'core';
    const isSlice = pointer.hitKind === 'slice';
    const ringCol = isCore ? 'rgba(251, 191, 36, 0.92)' : (isSlice ? 'rgba(56, 229, 255, 0.92)' : 'rgba(56, 189, 248, 0.56)');

    // Project 3D probe surface marker + floor anchor
    const pSurf = projectWorldPoint(pointer.smoothWorld[0], pointer.smoothWorld[1], pointer.smoothWorld[2], currentViewProj, viewWidth, viewHeight);
    const pFloor = projectWorldPoint(pointer.smoothWorld[0], anim.yS - 0.18, pointer.smoothWorld[2], currentViewProj, viewWidth, viewHeight);

    ctx.save();
    if (pSurf.visible && pFloor.visible) {
      ctx.strokeStyle = isCore ? 'rgba(251, 191, 36, 0.45)' : 'rgba(56, 189, 248, 0.38)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(pSurf.x, pSurf.y);
      ctx.lineTo(pFloor.x, pFloor.y);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.beginPath();
      ctx.arc(pFloor.x, pFloor.y, 3.2, 0, TAU);
      ctx.fillStyle = ringCol;
      ctx.fill();
    }

    // Rotating scientific pointer reticle at cursor (sx, sy)
    const rOuter = isSlice || isCore ? 21 : 16;
    const rInner = isSlice || isCore ? 11 : 8;
    const rot = anim.clock * (isSlice || isCore ? 1.8 : 0.85);

    ctx.strokeStyle = ringCol;
    ctx.lineWidth = isSlice || isCore ? 1.6 : 1.1;
    for (let k = 0; k < 4; k++) {
      const a0 = rot + k * (PI * 0.5) + 0.18;
      const a1 = a0 + PI * 0.5 - 0.36;
      ctx.beginPath();
      ctx.arc(sx, sy, rOuter, a0, a1);
      ctx.stroke();
    }

    ctx.strokeStyle = isCore ? 'rgba(253, 224, 71, 0.7)' : 'rgba(186, 230, 253, 0.65)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(sx, sy, rInner, 0, TAU);
    ctx.stroke();

    // 4-way precision crosshairs with clear center gap
    const gap = 5;
    const len = rOuter + 7;
    ctx.beginPath();
    ctx.moveTo(sx - len, sy); ctx.lineTo(sx - gap, sy);
    ctx.moveTo(sx + gap, sy); ctx.lineTo(sx + len, sy);
    ctx.moveTo(sx, sy - len); ctx.lineTo(sx, sy - gap);
    ctx.moveTo(sx, sy + gap); ctx.lineTo(sx, sy + len);
    ctx.stroke();

    ctx.restore();
  }

  function drawCanvasPnlSwatch(ctx, x, y, w, h, pnl) {
    const key = pnl?.key || 'flat';
    const hex = pnl?.hex || '#f59e0b';
    ctx.save();
    drawRoundedRect(ctx, x, y, w, h, 3);
    ctx.clip();

    if (key === 'loss') {
      ctx.fillStyle = '#3b0a18';
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = '#fb7185';
      ctx.lineWidth = 2;
      for (let d = -h; d < w + h; d += 5) {
        ctx.beginPath();
        ctx.moveTo(x + d, y + h);
        ctx.lineTo(x + d + h, y);
        ctx.stroke();
      }
    } else if (key === 'flat') {
      ctx.fillStyle = '#451a03';
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = 1;
      for (let gx = x + 3; gx < x + w; gx += 4) {
        ctx.beginPath(); ctx.moveTo(gx, y); ctx.lineTo(gx, y + h); ctx.stroke();
      }
      for (let gy = y + 4; gy < y + h; gy += 5) {
        ctx.beginPath(); ctx.moveTo(x, gy); ctx.lineTo(x + w, gy); ctx.stroke();
      }
    } else if (key === 'stream') {
      ctx.fillStyle = '#083344';
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = '#22d3ee';
      ctx.lineWidth = 1.4;
      const cxS = x + w * 0.5;
      const cyS = y + h * 0.5;
      for (const rad of [2.5, 5.5, 8.5]) {
        ctx.beginPath();
        ctx.arc(cxS, cyS, rad, 0, TAU);
        ctx.stroke();
      }
    } else {
      ctx.fillStyle = '#064e3b';
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = '#34d399';
      for (let gx = x + 1.5; gx < x + w; gx += 4) {
        ctx.fillRect(gx, y + 2, 2, h - 4);
      }
    }
    ctx.restore();

    ctx.save();
    drawRoundedRect(ctx, x, y, w, h, 3);
    ctx.strokeStyle = hex;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }

  function renderHudOverlay(hasWebGL) {
    if (!els.hudCanvas) return;
    const ctx = els.hudCanvas.getContext('2d');
    if (!ctx) return;

    ctx.setTransform(hudDpr, 0, 0, hudDpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.clearRect(0, 0, viewWidth, viewHeight);

    if (!hasWebGL) {
      renderSoftware3DFallback(ctx);
    }

    // 1. Live Voice & Higgs Acoustic Wave Ripples
    if (state.voiceState !== 'idle' || state.audioLevel > 0.08 || anim.burstEnergy > 0.05) {
      const rippleColor = state.voiceState === 'listening'
        ? [52, 211, 153]
        : (anim.burstEnergy > 0.25 ? [251, 191, 36] : [56, 189, 248]);
      const rings = 3;
      for (let rIdx = 0; rIdx < rings; rIdx++) {
        const phase = ((anim.wavePhase * 0.45 + rIdx / rings) % 1);
        const radius = 0.8 + phase * 3.8 + state.audioLevel * 0.6;
        const alpha = (1 - phase) * (0.18 + state.audioLevel * 0.42 + anim.burstEnergy * 0.24);
        ctx.beginPath();
        const segs = 40;
        let started = false;
        for (let i = 0; i <= segs; i++) {
          const a = (i / segs) * TAU;
          const wy = state.voiceState === 'listening'
            ? Math.sin(anim.wavePhase * 3 + rIdx) * 0.35
            : 0;
          const p = projectWorldPoint(radius * Math.cos(a), wy, radius * Math.sin(a), currentViewProj, viewWidth, viewHeight);
          if (!p.visible) continue;
          if (!started) { ctx.moveTo(p.x, p.y); started = true; }
          else ctx.lineTo(p.x, p.y);
        }
        ctx.closePath();
        ctx.strokeStyle = `rgba(${rippleColor[0]},${rippleColor[1]},${rippleColor[2]},${clamp(alpha, 0, 0.9).toFixed(3)})`;
        ctx.lineWidth = 1.6;
        ctx.stroke();
      }
    }

    // 2. Center Higgs Core Projected Badge (shown when hovering core or voice/execution active)
    const coreProj = projectWorldPoint(0, (anim.yV + anim.yS) * 0.5, 0, currentViewProj, viewWidth, viewHeight);
    if (coreProj.visible && (pointer.hitKind === 'core' || state.voiceState !== 'idle' || Boolean(state.activeVoiceAction))) {
      ctx.save();
      ctx.font = '700 12px "Segoe UI Variable", "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const coreLabel = state.voiceState === 'listening'
        ? 'H0 CORE • LISTENING'
        : (state.voiceState === 'speaking' ? 'H0 CORE • SUPER-PIE'
          : (state.activeVoiceAction ? 'H0 CORE • EXECUTING' : 'H0 HIGGS CORE'));
      const tw = Math.ceil(ctx.measureText(coreLabel).width + 20);
      const cxBox = Math.round(coreProj.x - tw * 0.5);
      const cyBox = Math.round(coreProj.y - 13);
      ctx.fillStyle = 'rgba(4, 10, 24, 0.94)';
      ctx.strokeStyle = state.voiceState === 'listening'
        ? 'rgba(52,211,153,0.9)'
        : (pointer.hitKind === 'core' ? 'rgba(251,191,36,0.98)' : 'rgba(56,189,248,0.85)');
      ctx.lineWidth = 1.4;
      drawRoundedRect(ctx, cxBox, cyBox, tw, 26, 13);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.fillText(coreLabel, Math.round(coreProj.x), cyBox + 13.5);
      ctx.restore();
    }

    // 3. Dashed HUD Projection Trace Connecting Active/Hovered Slices Across V -> O -> S
    const beamDevIds = new Set(state.focusedDeviceIds);
    if (state.selectedDeviceId) beamDevIds.add(state.selectedDeviceId);
    if (pointer.slice && pointer.slice.devId) beamDevIds.add(pointer.slice.devId);

    for (const devId of beamDevIds) {
      const sV = sliceModels.v.find((x) => x.devId === devId);
      const sO = sliceModels.o.find((x) => x.devId === devId);
      const sS = state.focusedSysKey
        ? sliceModels.s.find((x) => x.sysKey === state.focusedSysKey)
        : null;
      if (!sO) continue;

      const pts = [];
      if (coreProj.visible) pts.push(coreProj);
      if (sV && (state.soloLayer === 'all' || state.soloLayer === 'v')) {
        const dV = getSliceLiveTransform(sV);
        const rV = (sV.rIn + sV.rOut) * 0.5 + dV.pop;
        const wV = slicePointToWorld(rV * Math.cos(sV.aMid), 0.5, rV * Math.sin(sV.aMid), anim.spinAngle, 0, 0, dV.y, dV.height);
        const pV = projectWorldPoint(wV[0], wV[1], wV[2], currentViewProj, viewWidth, viewHeight);
        if (pV.visible) pts.push(pV);
      }
      if (state.soloLayer === 'all' || state.soloLayer === 'o') {
        const dO = getSliceLiveTransform(sO);
        const rO = (sO.rIn + sO.rOut) * 0.5 + dO.pop;
        const wO = slicePointToWorld(rO * Math.cos(sO.aMid), 0.5, rO * Math.sin(sO.aMid), anim.spinAngle, 0, 0, dO.y, dO.height);
        const pO = projectWorldPoint(wO[0], wO[1], wO[2], currentViewProj, viewWidth, viewHeight);
        if (pO.visible) pts.push(pO);
      }
      if (sS && (state.soloLayer === 'all' || state.soloLayer === 's')) {
        const dS = getSliceLiveTransform(sS);
        const rS = (sS.rIn + sS.rOut) * 0.5 + dS.pop;
        const wS = slicePointToWorld(rS * Math.cos(sS.aMid), 0.5, rS * Math.sin(sS.aMid), anim.spinAngle, 0, 0, dS.y, dS.height);
        const pS = projectWorldPoint(wS[0], wS[1], wS[2], currentViewProj, viewWidth, viewHeight);
        if (pS.visible) pts.push(pS);
      }

      if (pts.length >= 2) {
        const isVoice = state.focusedDeviceIds.includes(devId);
        const isHoveredDev = pointer.slice && pointer.slice.devId === devId;
        ctx.save();
        ctx.strokeStyle = isVoice ? 'rgba(56, 229, 255, 0.92)' : (isHoveredDev ? 'rgba(251, 191, 36, 0.85)' : 'rgba(167, 139, 250, 0.52)');
        ctx.lineWidth = isVoice || isHoveredDev ? 2.2 : 1.4;
        ctx.setLineDash([6, 4]);
        ctx.lineDashOffset = -anim.wavePhase * 12;
        ctx.beginPath();
        pts.forEach((p, idx) => (idx === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
        ctx.stroke();
        ctx.restore();
      }
    }

    // 4. Projected Descriptive Callout — ONLY for the specific pie part being hovered (never spam all slices)
    const callouts = [];
    if (pointer.inside && pointer.hitKind === 'slice' && state.hoveredSliceKey && !pointer.helperEnabled) {
      const hoveredSlice = [...sliceModels.v, ...sliceModels.o, ...sliceModels.s].find(
        (x) => x.key === state.hoveredSliceKey
      );
      if (hoveredSlice) {
        const dyn = getSliceLiveTransform(hoveredSlice);
        const anchorR = hoveredSlice.rOut + dyn.pop;
        const wAnchor = slicePointToWorld(
          anchorR * Math.cos(hoveredSlice.aMid),
          0.5,
          anchorR * Math.sin(hoveredSlice.aMid),
          anim.spinAngle,
          0,
          0,
          dyn.y,
          dyn.height
        );
        const pAnchor = projectWorldPoint(wAnchor[0], wAnchor[1], wAnchor[2], currentViewProj, viewWidth, viewHeight);
        if (pAnchor.visible) {
          const info = describePieSector(hoveredSlice);
          const isSys = hoveredSlice.layer === 's';
          const sys = hoveredSlice.sys || {};
          callouts.push({
            slice: hoveredSlice,
            pnl: info.pnl,
            statusPill: info.statusPill,
            ax: pAnchor.x,
            ay: pAnchor.y,
            depth: pAnchor.depth,
            priority: 100,
            isSpecial: true,
            isFocused: true,
            title: isSys ? (sys.name || hoveredSlice.sysKey) : (hoveredSlice.dev?.name || 'Sector'),
            descLine: isSys
              ? `S (${sys.sharePct ?? 20}% pie) • ${info.roleBadge}`
              : `${info.roleBadge} • ${info.statusLine}`,
            color: info.pnl.rgb
          });
        }
      }
    }

    callouts.sort((a, b) => b.priority - a.priority);
    const placedBoxes = [];
    const cx = viewWidth * 0.5;
    const cy = viewHeight * 0.52;

    for (const c of callouts) {
      let dirX = c.ax - cx;
      let dirY = c.ay - cy;
      const dist = Math.hypot(dirX, dirY) || 1;
      dirX /= dist;
      dirY /= dist;

      ctx.font = '700 12.5px "Segoe UI Variable", "Segoe UI", system-ui, sans-serif';
      const titleW = ctx.measureText(c.title).width;
      ctx.font = '700 10.5px "Cascadia Code", "Consolas", monospace';
      const pillW = ctx.measureText(c.statusPill).width + 14;
      ctx.font = '600 11px "Segoe UI Variable", "Segoe UI", system-ui, sans-serif';
      const descW = ctx.measureText(c.descLine).width;

      const boxW = Math.round(clamp(Math.max(titleW + pillW + 34, descW + 28), 190, 268));
      const boxH = 40;

      const pushDist = c.isFocused ? 50 : (c.isSpecial ? 36 : 28);
      let bx = Math.round(clamp(c.ax + dirX * pushDist - (dirX < 0 ? boxW : (dirX < 0.25 ? boxW * 0.5 : 0)), 10, viewWidth - boxW - 10));
      let by = Math.round(clamp(c.ay + dirY * pushDist - boxH * 0.5, 48, viewHeight - boxH - 56));

      let collided = true;
      let tries = 0;
      while (collided && tries < 10) {
        collided = false;
        if (bx + boxW > viewWidth - 182 && by < 142) {
          by = 148;
          collided = true;
          tries++;
          continue;
        }
        if (pointer.helperRect && pointer.helperRect.active) {
          const hr = pointer.helperRect;
          if (bx < hr.x + hr.w + 8 && bx + boxW + 8 > hr.x && by < hr.y + hr.h + 8 && by + boxH + 8 > hr.y) {
            by += (by + boxH * 0.5 >= hr.y + hr.h * 0.5 ? 44 : -44);
            by = Math.round(clamp(by, 48, viewHeight - boxH - 56));
            collided = true;
            tries++;
            continue;
          }
        }
        for (const p of placedBoxes) {
          if (bx < p.x + p.w + 6 && bx + boxW + 6 > p.x && by < p.y + p.h + 5 && by + boxH + 5 > p.y) {
            by += (by >= cy ? 44 : -44);
            by = Math.round(clamp(by, 48, viewHeight - boxH - 56));
            collided = true;
            break;
          }
        }
        tries++;
      }

      if (collided && !c.isSpecial) continue;
      placedBoxes.push({ x: bx, y: by, w: boxW, h: boxH });

      const linkX = dirX < 0 ? bx + boxW : bx;
      const linkY = by + Math.round(boxH * 0.5);

      ctx.save();
      ctx.strokeStyle = c.isSpecial ? c.pnl.hex : rgbCss(c.color, 0.72);
      ctx.lineWidth = c.isSpecial ? 1.8 : 1.25;
      ctx.beginPath();
      ctx.moveTo(c.ax, c.ay);
      ctx.lineTo(linkX, linkY);
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(c.ax, c.ay, c.isSpecial ? 4 : 3, 0, TAU);
      ctx.fillStyle = c.isSpecial ? '#ffffff' : c.pnl.hex;
      ctx.fill();

      ctx.fillStyle = c.isFocused ? 'rgba(8, 22, 48, 0.96)' : 'rgba(5, 11, 25, 0.94)';
      ctx.strokeStyle = c.isFocused ? '#38bdf8' : c.pnl.hex;
      ctx.lineWidth = c.isFocused ? 1.8 : 1.2;
      drawRoundedRect(ctx, bx, by, boxW, boxH, 7);
      ctx.fill();
      ctx.stroke();

      // Patterned PnL Swatch Strip inside left edge of every callout card
      drawCanvasPnlSwatch(ctx, bx + 6, by + 6, 9, boxH - 12, c.pnl);

      const textLeft = bx + 20;
      const rightEdge = bx + boxW - 7;

      // Line 1: Bold crisp title + PnL Status Badge on right
      ctx.font = '700 10.5px "Cascadia Code", "Consolas", monospace';
      const pTxtW = Math.ceil(ctx.measureText(c.statusPill).width + 10);
      const pillX = Math.round(rightEdge - pTxtW);
      const pillY = by + 5;
      ctx.fillStyle = c.pnl.key === 'loss'
        ? 'rgba(136, 19, 55, 0.68)'
        : (c.pnl.key === 'flat' ? 'rgba(120, 53, 15, 0.68)'
          : (c.pnl.key === 'stream' ? 'rgba(8, 51, 68, 0.78)' : 'rgba(6, 78, 59, 0.72)'));
      drawRoundedRect(ctx, pillX, pillY, pTxtW, 15, 4);
      ctx.fill();
      ctx.strokeStyle = c.pnl.hex;
      ctx.lineWidth = 0.9;
      ctx.stroke();

      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(c.statusPill, pillX + pTxtW * 0.5, pillY + 8);

      ctx.font = '700 12.5px "Segoe UI Variable", "Segoe UI", system-ui, sans-serif';
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(c.title, textLeft, by + 13, Math.max(40, pillX - textLeft - 5));

      // Line 2: Descriptive Sector Role & State
      ctx.font = '600 11px "Segoe UI Variable", "Segoe UI", system-ui, sans-serif';
      ctx.fillStyle = '#cbd5e1';
      ctx.fillText(c.descLine, textLeft, by + 29, boxW - 28);

      ctx.restore();
    }

    // 4b. Minimal Layer S Bottom Pie Title & Share Labels (non-intrusive holographic rim pills)
    if ((state.soloLayer === 'all' || state.soloLayer === 's') && Array.isArray(sliceModels.s) && sliceModels.s.length) {
      const shortNames = {
        voice: 'Voice AI',
        lights: 'Lighting',
        ir: 'IR & HVAC',
        vacuum: 'Robotics',
        cast: 'Media Cast'
      };
      const sysSorted = [...sliceModels.s].sort((a, b) => (b.sys?.sharePct || 0) - (a.sys?.sharePct || 0));
      for (const sS of sysSorted) {
        const dyn = getSliceLiveTransform(sS);
        const rimR = sS.rOut + dyn.pop + 0.20;
        const wRim = slicePointToWorld(
          rimR * Math.cos(sS.aMid),
          0.35,
          rimR * Math.sin(sS.aMid),
          anim.spinAngle,
          0,
          0,
          dyn.y,
          dyn.height
        );
        const pRim = projectWorldPoint(wRim[0], wRim[1], wRim[2], currentViewProj, viewWidth, viewHeight);
        if (!pRim.visible || pRim.x < 34 || pRim.x > viewWidth - 34 || pRim.y < 54 || pRim.y > viewHeight - 24) continue;

        const sys = sS.sys || {};
        const label = `${shortNames[sS.sysKey] || sys.name || sS.sysKey} ${sys.sharePct ?? 20}%`;
        ctx.font = '600 10.5px "Cascadia Code", "Consolas", monospace';
        const lw = Math.ceil(ctx.measureText(label).width + 20);
        const lh = 20;
        const lx = Math.round(clamp(pRim.x - lw * 0.5, 10, viewWidth - lw - 10));
        const ly = Math.round(clamp(pRim.y + 8, 54, viewHeight - lh - 12));

        let overlaps = false;
        for (const p of placedBoxes) {
          if (lx < p.x + p.w + 4 && lx + lw + 4 > p.x && ly < p.y + p.h + 4 && ly + lh + 4 > p.y) {
            overlaps = true;
            break;
          }
        }
        if (overlaps) continue;
        placedBoxes.push({ x: lx, y: ly, w: lw, h: lh });

        const cCss = rgbCss(sys.color || [0.3, 0.8, 1], sys.active ? 0.96 : 0.78);
        const isSel = state.focusedSysKey === sS.sysKey || state.openMenuSliceKey === sS.key;
        ctx.save();
        ctx.strokeStyle = isSel ? 'rgba(56, 189, 248, 0.92)' : 'rgba(56, 189, 248, 0.34)';
        ctx.lineWidth = isSel ? 1.35 : 0.9;
        ctx.fillStyle = isSel ? 'rgba(8, 22, 48, 0.90)' : 'rgba(4, 10, 24, 0.72)';
        drawRoundedRect(ctx, lx, ly, lw, lh, 10);
        ctx.fill();
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(lx + 9, ly + lh * 0.5, 2.8, 0, TAU);
        ctx.fillStyle = cCss;
        ctx.fill();

        ctx.fillStyle = sys.active ? '#f8fafc' : '#cbd5e1';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, lx + 15, ly + lh * 0.5 + 0.5);
        ctx.restore();
      }
    }

    // 5. Floating Zoomed Pie-Portion Callout Card during active voice action
    if (state.activeVoiceAction && state.focusedSliceKey) {
      const fSlice = [...sliceModels.o, ...sliceModels.v, ...sliceModels.s].find((x) => x.key === state.focusedSliceKey);
      if (fSlice) {
        const dyn = getSliceLiveTransform(fSlice);
        const rOut = fSlice.rOut + dyn.pop;
        const wTip = slicePointToWorld(rOut * Math.cos(fSlice.aMid), 0.5, rOut * Math.sin(fSlice.aMid), anim.spinAngle, 0, 0, dyn.y, dyn.height);
        const pTip = projectWorldPoint(wTip[0], wTip[1], wTip[2], currentViewProj, viewWidth, viewHeight);
        if (pTip.visible) {
          const cardW = 286;
          const cardH = 66;
          const cxCard = Math.round(clamp(pTip.x - cardW * 0.5, 14, viewWidth - cardW - 14));
          const cyCard = Math.round(clamp(pTip.y - 88, 48, viewHeight - cardH - 64));

          ctx.save();
          ctx.strokeStyle = state.activeVoiceAction.status === 'warn' ? '#fbbf24' : '#38bdf8';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(pTip.x, pTip.y);
          ctx.lineTo(cxCard + cardW * 0.5, cyCard + cardH);
          ctx.stroke();

          ctx.fillStyle = 'rgba(4, 12, 30, 0.96)';
          ctx.strokeStyle = state.activeVoiceAction.status === 'warn' ? '#fbbf24' : '#38bdf8';
          ctx.lineWidth = 1.6;
          drawRoundedRect(ctx, cxCard, cyCard, cardW, cardH, 10);
          ctx.fill();
          ctx.stroke();

          ctx.font = '700 11px "Cascadia Code", "Consolas", monospace';
          ctx.fillStyle = state.activeVoiceAction.status === 'warn' ? '#fde68a' : '#38bdf8';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'top';
          ctx.fillText(
            state.activeVoiceAction.status === 'running' ? '● LIVE VOICE ACTION ZOOM' : (state.activeVoiceAction.status === 'ok' ? '✓ VOICE ACTION EXECUTED' : '! VOICE NOTICE'),
            cxCard + 12,
            cyCard + 8
          );

          ctx.font = '700 14px "Segoe UI Variable", "Segoe UI", system-ui, sans-serif';
          ctx.fillStyle = '#ffffff';
          ctx.fillText(
            `${state.activeVoiceAction.targetLabel}: ${state.activeVoiceAction.summary}`,
            cxCard + 12,
            cyCard + 24,
            cardW - 24
          );

          ctx.font = '600 11.5px "Segoe UI Variable", "Segoe UI", system-ui, sans-serif';
          ctx.fillStyle = '#bae6fd';
          ctx.fillText(state.activeVoiceAction.detail, cxCard + 12, cyCard + 44, cardW - 24);
          ctx.restore();
        }
      }
    }

    // 6. 3D Spatial Mouse Helper Reticle & Laser Drop-Line
    renderMouseHelperHud(ctx);
  }

  function startLoop() {
    if (mainRaf) return;
    if (els.section && els.section.classList.contains('hidden')) return;
    let lastTs = performance.now();
    const tick = (now) => {
      if (els.section && els.section.classList.contains('hidden')) {
        mainRaf = null;
        return;
      }
      const dt = (now - lastTs) * 0.001;
      lastTs = now;
      stepAnimation(dt);
      const hasGl = renderWebGLScene();
      renderHudOverlay(hasGl);
      updateTelemetryHud(now);
      mainRaf = requestAnimationFrame(tick);
    };
    mainRaf = requestAnimationFrame(tick);
  }

  function stopLoop() {
    if (!mainRaf) return;
    cancelAnimationFrame(mainRaf);
    mainRaf = null;
  }

  function setOpen(isOpen) {
    const open = Boolean(isOpen);
    if (open) {
      if (!els.viewport || !els.webglCanvas || !els.hudCanvas) return;
      if (!gl && initWebGL()) {
        rebuildPieTopology(true);
      }
      syncCanvasSize();
      requestAnimationFrame(() => syncCanvasSize());
      renderDeviceNav();
      renderSystemChips();
      renderInspector();
      renderActionBanner();
      updateModeBadgeAndClasses();
      startLoop();
      return;
    }

    stopLoop();
    pointer.inside = false;
    pointer.dragging = false;
    pointer.hitKind = 'none';
    pointer.slice = null;
    state.hoveredSliceKey = '';
    if (typeof hideTooltip === 'function') hideTooltip();
  }

  // ---------------------------------------------------------------------------
  // Right-Hand Holo Deck: Device Navigator, Inspector & Execution Terminal
  // ---------------------------------------------------------------------------

  function renderDeviceNav() {
    if (!els.deviceNav) return;
    const devs = getUnifiedDevices();
    if (!devs.length) {
      els.deviceNav.innerHTML = '<div class="vos-empty">Discovering smart devices...</div>';
      return;
    }

    const groups = [
      { label: 'Lights', items: devs.filter((d) => d.category === 'light' || d.category === 'ble_light') },
      { label: 'IR & Home', items: devs.filter((d) => String(d.category || '').startsWith('ir_') || d.category === 'switch') },
      { label: 'Vac / Cast', items: devs.filter((d) => d.category === 'vacuum' || d._kind === 'cast') }
    ].filter((g) => g.items.length > 0);

    els.deviceNav.innerHTML = groups.map((g) => `
      <div class="vos-nav-group">
        <span class="vos-nav-group-lbl">${escapeHtml(g.label)}</span>
        ${g.items.map((d) => {
          const pnl = getSlicePnlProfile({ layer: 'o', dev: d });
          const c = pnl.rgb;
          const sel = d.id === state.selectedDeviceId ? 'is-selected' : '';
          return `
            <button type="button" class="vos-dev-chip is-pnl-${pnl.key} ${sel}" data-nav-id="${escapeHtml(d.id)}" title="${escapeHtml(d.name)} (${escapeHtml(categoryLabel(d))} • ${escapeHtml(pnl.label)})">
              <span class="vos-dev-chip-dot" style="background:${rgbCss(c, 1)}; box-shadow:0 0 6px ${rgbCss(c, 0.85)};"></span>
              <span>${escapeHtml(d.name)}</span>
            </button>
          `;
        }).join('')}
      </div>
    `).join('');

    els.deviceNav.querySelectorAll('.vos-dev-chip').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.navId || '';
        focusDevice(id, true);
      });
    });
  }

  function renderSystemChips(force = false) {
    if (!els.sChips) return;
    const tuyaOk = Boolean(state.smartConfig?.tuya?.configured);
    const mhOk = Boolean(state.smartConfig?.magicHome?.configured);
    const aiOk = Boolean(state.smartConfig?.openai?.configured);
    const totalDevs = getUnifiedDevices().length;
    const onDevs = getUnifiedDevices().filter((d) => d.power).length;
    if (els.oStatsBadge) {
      els.oStatsBadge.textContent = `${totalDevs} DEVICES • ${onDevs} ACTIVE`;
    }

    const sysMeta = cachedSysMeta || buildSystemSlicesMeta();
    const voiceChipText = `OPENAI ${state.voiceState !== 'idle' ? state.voiceState.toUpperCase() : (aiOk ? 'READY' : 'NO KEY')}`;
    const tuyaChipText = `TUYA ${tuyaOk ? 'LINKED' : 'NO KEYS'}`;
    const mhChipText = `MH ${mhOk ? 'LINKED' : 'LAN'}`;
    const glChipText = threeRenderer ? `3JS ${gpuTier.toUpperCase()}` : 'HUD 2D';

    const sig = [
      voiceChipText, tuyaChipText, mhChipText, glChipText,
      state.focusedSysKey || '',
      ...sysMeta.map((s) => `${s.sysKey}:${s.usagePct}:${s.sharePct}:${s.active ? 1 : 0}:${s.shortMetric}`)
    ].join('|');

    if (!force && sig === lastRenderedChipsSig && els.sChips.querySelector('[data-role="sys-metrics"]')) {
      return;
    }
    lastRenderedChipsSig = sig;

    if (!els.sChips.querySelector('[data-role="sys-metrics"]')) {
      els.sChips.innerHTML = `
        <div class="vos-sys-status-row" data-role="sys-status">
          <span class="vos-sys-chip" data-chip="ai"></span>
          <span class="vos-sys-chip" data-chip="tuya"></span>
          <span class="vos-sys-chip" data-chip="mh"></span>
          <span class="vos-sys-chip" data-chip="gl"></span>
          <button type="button" class="vos-sys-reset-btn" title="Reset Layer S real usage counters &amp; heat">Reset</button>
        </div>
        <div class="vos-sys-metrics-grid" data-role="sys-metrics">
          ${SYS_ORDER.map((k) => `
            <button type="button" class="vos-sys-metric" data-sys-key="${k}">
              <div class="vos-sys-m-top">
                <span class="vos-sys-m-dot"></span>
                <span class="vos-sys-m-name"></span>
                <span class="vos-sys-m-share"></span>
                <span class="vos-sys-m-pct"></span>
              </div>
              <div class="vos-sys-m-bar"><div class="vos-sys-m-fill"></div></div>
              <div class="vos-sys-m-sub"></div>
            </button>
          `).join('')}
        </div>
      `;
    }

    const aiChip = els.sChips.querySelector('[data-chip="ai"]');
    if (aiChip) {
      aiChip.className = `vos-sys-chip ${aiOk ? '' : 'warn'}`;
      aiChip.textContent = voiceChipText;
    }
    const tuyaChip = els.sChips.querySelector('[data-chip="tuya"]');
    if (tuyaChip) {
      tuyaChip.className = `vos-sys-chip ${tuyaOk ? '' : 'warn'}`;
      tuyaChip.textContent = tuyaChipText;
    }
    const mhChip = els.sChips.querySelector('[data-chip="mh"]');
    if (mhChip) {
      mhChip.className = `vos-sys-chip ${mhOk ? '' : 'warn'}`;
      mhChip.textContent = mhChipText;
    }
    const glChip = els.sChips.querySelector('[data-chip="gl"]');
    if (glChip) {
      glChip.className = 'vos-sys-chip';
      glChip.textContent = glChipText;
    }

    for (const sys of sysMeta) {
      const btn = els.sChips.querySelector(`.vos-sys-metric[data-sys-key="${sys.sysKey}"]`);
      if (!btn) continue;
      const cCss = rgbCss(sys.color, 1);
      btn.classList.toggle('is-active', Boolean(sys.active));
      btn.classList.toggle('is-focused', state.focusedSysKey === sys.sysKey);
      btn.title = `${sys.name}: ${sys.detailMetric} (${sys.sharePct}% of bottom pie)`;

      const dot = btn.querySelector('.vos-sys-m-dot');
      if (dot) {
        dot.style.background = cCss;
        dot.style.boxShadow = sys.active ? `0 0 8px ${cCss}` : 'none';
      }
      const nameEl = btn.querySelector('.vos-sys-m-name');
      if (nameEl) nameEl.textContent = sys.name;
      const shareEl = btn.querySelector('.vos-sys-m-share');
      if (shareEl) shareEl.textContent = `${sys.sharePct}% pie`;
      const pctEl = btn.querySelector('.vos-sys-m-pct');
      if (pctEl) pctEl.textContent = `${sys.usagePct}%`;
      const fillEl = btn.querySelector('.vos-sys-m-fill');
      if (fillEl) {
        fillEl.style.width = `${clamp(sys.usagePct > 0 ? Math.max(5, sys.usagePct) : 2, 2, 100)}%`;
        fillEl.style.background = cCss;
      }
      const subEl = btn.querySelector('.vos-sys-m-sub');
      if (subEl) subEl.textContent = sys.shortMetric;
    }
  }

  function triggerDeviceControl(dev, payload) {
    if (!dev) return;
    triggerEnergyBurst(0.85);
    if (dev._kind === 'cast') {
      if (callbacks.onControlCast) callbacks.onControlCast(dev.id, payload);
      return;
    }
    if (callbacks.onControlSmart) {
      pushLog('ACTION', `${dev.name} -> ${JSON.stringify(payload)}`, 'ok');
      callbacks.onControlSmart(dev.id, payload);
    }
  }

  function updateSysInspectorLive(sys) {
    if (!els.inspectorBody || !sys) return;
    const panel = els.inspectorBody.querySelector(`[data-sys-insp="${sys.sysKey}"]`);
    if (!panel) return;
    const cCss = rgbCss(sys.color, 1);
    const pctEl = panel.querySelector('[data-f="pct"]');
    const shareEl = panel.querySelector('[data-f="share"]');
    const timeEl = panel.querySelector('[data-f="time"]');
    const cntEl = panel.querySelector('[data-f="count"]');
    const detEl = panel.querySelector('[data-f="detail"]');
    const lastEl = panel.querySelector('[data-f="last"]');
    const fillEl = panel.querySelector('[data-f="fill"]');
    const stateTag = panel.querySelector('[data-f="stateTag"]');
    if (pctEl) pctEl.textContent = `${sys.usagePct}%`;
    if (shareEl) shareEl.textContent = `${sys.sharePct}%`;
    if (timeEl) timeEl.textContent = formatDurationSec(sys.activeSec);
    if (cntEl) cntEl.textContent = String(sys.count);
    if (detEl) detEl.textContent = sys.detailMetric;
    if (lastEl) lastEl.textContent = sys.lastAction || 'No events recorded yet';
    if (stateTag) stateTag.textContent = sys.active ? 'ACTIVE BUS' : 'STANDBY';
    if (fillEl) {
      fillEl.style.width = `${clamp(sys.usagePct > 0 ? Math.max(4, sys.usagePct) : 2, 2, 100)}%`;
      fillEl.style.background = cCss;
    }
  }

  // ---------------------------------------------------------------------------
  // SmartLife Created Scenes Resolver & Contextual Slice Menu (#vosSliceMenu)
  // ---------------------------------------------------------------------------

  let lastMenuScenesSig = '';

  function resolveSceneActionCount(sc, lnk) {
    if (typeof lnk?.actionCount === 'number' && Number.isFinite(lnk.actionCount)) {
      return Math.max(0, lnk.actionCount);
    }
    if (Array.isArray(sc?.actions)) return sc.actions.length;
    return 0;
  }

  function formatSceneActionCount(count) {
    const n = Number(count || 0);
    return n > 0 ? `${n} action${n === 1 ? '' : 's'}` : 'Tap-to-Run';
  }

  function buildNormalizedSceneCatalog() {
    const linkById = new Map();
    for (const lnk of (state.smartSceneLinks || [])) {
      if (lnk && lnk.id) linkById.set(String(lnk.id), lnk);
    }

    const byId = new Map();
    for (const sc of (state.smartScenes?.scenes || [])) {
      if (!sc || !sc.id) continue;
      const id = String(sc.id);
      const lnk = linkById.get(id);
      byId.set(id, {
        id,
        name: String(sc.name || lnk?.name || id),
        homeId: String(sc.homeId || state.smartScenes?.homeId || ''),
        enabled: sc.enabled !== false,
        targetDevice: String(lnk?.targetDevice || sc.targetDevice || ''),
        targetDeviceIds: Array.isArray(lnk?.targetDeviceIds) ? lnk.targetDeviceIds.map(String) : [],
        systemBus: String(lnk?.systemBus || ''),
        phrases: Array.isArray(lnk?.phrases) ? lnk.phrases : [],
        actionCount: resolveSceneActionCount(sc, lnk)
      });
    }

    for (const [id, lnk] of linkById.entries()) {
      if (byId.has(id)) continue;
      byId.set(id, {
        id,
        name: String(lnk.name || id),
        homeId: String(state.smartScenes?.homeId || ''),
        enabled: true,
        targetDevice: String(lnk.targetDevice || ''),
        targetDeviceIds: Array.isArray(lnk.targetDeviceIds) ? lnk.targetDeviceIds.map(String) : [],
        systemBus: String(lnk.systemBus || ''),
        phrases: Array.isArray(lnk.phrases) ? lnk.phrases : [],
        actionCount: resolveSceneActionCount(null, lnk)
      });
    }

    return [...byId.values()].sort((a, b) => {
      const aHas = (a.actionCount || 0) > 0 ? 1 : 0;
      const bHas = (b.actionCount || 0) > 0 ? 1 : 0;
      if (aHas !== bHas) return bHas - aHas;
      return a.name.localeCompare(b.name);
    });
  }

  function getSliceAssignmentKey(slice) {
    if (!slice) return '';
    if (slice.layer === 's' && slice.sysKey) return `sys:${slice.sysKey}`;
    const devId = slice.dev?.id || slice.devId || '';
    return devId ? `dev:${devId}` : '';
  }

  function doesSceneAutoMatchSlice(item, slice) {
    if (!item || !slice || item.enabled === false) return false;
    if (slice.layer === 's') {
      if (slice.sysKey === 'voice') {
        return item.systemBus === 'voice'
          || /\b(voz|voice|hola|buenos|noche|sleep|casa|confort|fireplace|modo|todos|all)\b/.test(foldName(item.name));
      }
      return item.systemBus === slice.sysKey;
    }

    const dev = slice.dev || {};
    const devId = String(dev.id || slice.devId || '');
    const devFold = foldName(dev.name || '');
    const devAlnum = foldAlnum(dev.name || '');
    const scAlnum = foldAlnum(item.name || '');
    const tgtAlnum = foldAlnum(item.targetDevice || '');

    if (devId && item.targetDeviceIds.includes(devId)) return true;
    if (devAlnum && tgtAlnum && (tgtAlnum === devAlnum || (devAlnum.length >= 4 && tgtAlnum.includes(devAlnum)))) {
      return true;
    }
    if (devAlnum && ((devAlnum.length >= 4 && scAlnum.includes(devAlnum))
      || (devFold && foldName(item.name).split(/\s+/).includes(devFold)))) {
      return true;
    }
    if ((dev.category === 'light' || dev.category === 'ble_light') && item.systemBus === 'lights'
      && (!tgtAlnum || tgtAlnum.includes('lightsgroup'))) {
      return true;
    }
    if (dev.category === 'ir_fan' && item.systemBus === 'ir' && tgtAlnum === 'fan') {
      return true;
    }
    if (dev.category === 'cast' && item.systemBus === 'cast' && (!tgtAlnum || tgtAlnum === devAlnum || tgtAlnum.includes('cast'))) {
      return true;
    }
    if ((dev.category === 'ir_hub' || dev.category === 'ir_remote') && item.systemBus === 'ir') {
      return true;
    }
    return false;
  }

  function getScenesForSlice(slice) {
    const catalog = buildNormalizedSceneCatalog();
    const byId = new Map(catalog.map((c) => [c.id, c]));
    const assignKey = getSliceAssignmentKey(slice);
    const rawPinned = assignKey && Array.isArray(state.sliceScenes?.[assignKey])
      ? state.sliceScenes[assignKey]
      : [];

    const out = [];
    const seen = new Set();
    const validPinned = [];

    for (const sid of rawPinned) {
      const id = String(sid || '').trim();
      const item = byId.get(id);
      if (!item || seen.has(id)) continue;
      seen.add(id);
      validPinned.push(id);
      out.push({ ...item, _pinned: true });
    }

    for (const item of catalog) {
      if (seen.has(item.id)) continue;
      if (doesSceneAutoMatchSlice(item, slice)) {
        seen.add(item.id);
        out.push({ ...item, _pinned: false });
      }
    }

    return { assignKey, pinnedIds: validPinned, scenes: out, catalog };
  }

  function getScenesForDevice(dev) {
    if (!dev || !dev.id) return [];
    const slice = findSliceByKey(`o:${dev.id}`) || findSliceByKey(`v:${dev.id}`) || {
      layer: 'o',
      devId: dev.id,
      dev
    };
    return getScenesForSlice(slice).scenes;
  }

  function findSliceByKey(key) {
    if (!key) return null;
    return [...sliceModels.o, ...sliceModels.v, ...sliceModels.s].find((s) => s.key === key) || null;
  }

  function positionSliceMenu(slice) {
    if (!els.sliceMenu || !slice) return;
    const menuW = Math.min(364, Math.max(250, viewWidth - 28));
    const estH = Math.min(470, viewHeight - 86);

    if (viewWidth < 740) {
      els.sliceMenu.style.left = `${Math.round((viewWidth - menuW) * 0.5)}px`;
      els.sliceMenu.style.top = `${Math.round(clamp(viewHeight - estH - 16, 58, Math.max(60, viewHeight - 240)))}px`;
      return;
    }

    const dyn = getSliceLiveTransform(slice);
    const midR = (slice.rIn + slice.rOut) * 0.5 + dyn.pop;
    const w = slicePointToWorld(
      midR * Math.cos(slice.aMid),
      0.5,
      midR * Math.sin(slice.aMid),
      anim.spinAngle,
      0,
      0,
      dyn.y,
      dyn.height
    );
    const proj = projectWorldPoint(w[0], w[1], w[2], currentViewProj, viewWidth, viewHeight);
    if (!proj.visible) {
      els.sliceMenu.style.left = `${Math.max(18, viewWidth - menuW - 22)}px`;
      els.sliceMenu.style.top = '64px';
      return;
    }

    const putRight = proj.x < viewWidth * 0.52;
    const left = putRight
      ? Math.min(viewWidth - menuW - 16, Math.round(proj.x + 38))
      : Math.max(16, Math.round(proj.x - menuW - 38));
    const top = Math.round(clamp(proj.y - 115, 62, Math.max(64, viewHeight - estH - 16)));
    els.sliceMenu.style.left = `${left}px`;
    els.sliceMenu.style.top = `${top}px`;
  }

  function closeSliceMenu() {
    state.openMenuSliceKey = '';
    state.sliceAssignOpen = false;
    lastMenuScenesSig = '';
    if (els.sliceMenu) els.sliceMenu.classList.add('hidden');
    if (els.smAssignPanel) els.smAssignPanel.classList.add('hidden');
    if (els.smAssignToggleBtn) els.smAssignToggleBtn.classList.remove('active');
  }

  function buildCastBusQuickHtml() {
    const castDevs = state.castDevices || [];
    const scan = state.castScanState || {};
    const scanStatusLine = scan.active
      ? `<div class="vos-insp-row" style="padding:4px 6px;border-radius:6px;background:rgba(56,189,248,0.12);"><span class="vos-insp-hex">${escapeHtml(scan.message || 'Scanning local Wi-Fi for Cast devices...')}</span></div>`
      : (scan.message && (castDevs.length === 0 || scan.permission === 'denied' || scan.permission === 'prompt' || scan.ssid))
        ? `<div class="vos-insp-row" style="padding:3px 6px;"><span class="vos-insp-hex">${escapeHtml(scan.message)}</span></div>`
        : '';
    const devRows = castDevs.length > 0
      ? castDevs.map((cd) => {
          const st = String(cd.status || 'IDLE').toUpperCase();
          const cdPlaying = st === 'PLAYING' || st === 'BUFFERING';
          return `
            <div class="vos-insp-row" style="justify-content:space-between;gap:6px;padding:4px 6px;border-radius:8px;background:rgba(15,23,42,0.45);">
              <span class="vos-insp-hex" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
                <strong>${escapeHtml(cd.name || cd.host || 'Cast')}</strong> &bull; ${escapeHtml(st)}
              </span>
              <span style="display:flex;gap:4px;flex-shrink:0;">
                <button type="button" class="btn btn-xs ${cdPlaying ? 'btn-danger' : 'btn-primary'} vos-bus-cast-btn" data-id="${escapeHtml(cd.id)}" data-stream="${cdPlaying ? 'stop' : 'start'}">${cdPlaying ? 'Stop' : 'Cast Now'}</button>
                <button type="button" class="btn btn-xs btn-secondary vos-bus-open-btn" data-id="${escapeHtml(cd.id)}">Open</button>
              </span>
            </div>
          `;
        }).join('')
      : `<div class="vos-empty" style="padding:6px;">${
          scan.active
            ? 'Auto-scanning local Wi-Fi for Google Cast devices...'
            : 'No Cast targets discovered yet. Click Auto-Connect Wi-Fi Cast to scan your local network.'
        }</div>`;

    return `
      <div class="vos-insp-row" style="justify-content:flex-start;flex-wrap:wrap;gap:6px;margin-top:6px;">
        <button type="button" class="btn btn-sm btn-primary vos-bus-auto-btn">${scan.active ? 'Scanning Wi-Fi...' : 'Auto-Connect Wi-Fi Cast'}</button>
        <button type="button" class="btn btn-sm btn-secondary vos-bus-pair-btn">Pair Wi-Fi Cast</button>
      </div>
      ${scanStatusLine}
      <div style="display:flex;flex-direction:column;gap:4px;margin-top:4px;">
        ${devRows}
      </div>
    `;
  }

  function bindCastBusQuickEvents(container) {
    if (!container) return;
    const autoBtn = container.querySelector('.vos-bus-auto-btn');
    if (autoBtn) {
      autoBtn.addEventListener('click', () => {
        if (callbacks.onControlCast) callbacks.onControlCast('all', { cast_auto_connect: true, wake: true });
      });
    }
    const pairBtn = container.querySelector('.vos-bus-pair-btn');
    if (pairBtn) {
      pairBtn.addEventListener('click', () => {
        if (callbacks.onControlCast) callbacks.onControlCast('sdk', { pair_sdk: true });
      });
    }
    container.querySelectorAll('.vos-bus-cast-btn').forEach((b) => {
      b.addEventListener('click', () => {
        if (callbacks.onControlCast) callbacks.onControlCast(b.dataset.id, { cast_stream: b.dataset.stream });
      });
    });
    container.querySelectorAll('.vos-bus-open-btn').forEach((b) => {
      b.addEventListener('click', () => {
        const sO = findSliceByKey(`o:${b.dataset.id}`) || findSliceByKey(`v:${b.dataset.id}`);
        if (sO) openSliceMenu(sO);
        else focusDevice(b.dataset.id, true);
      });
    });
  }

  function buildCastDeviceControlsHtml(dev, idPrefix) {
    const volId = `vos${idPrefix}CastVolRange`;
    const queryId = `vos${idPrefix}CastQueryInput`;
    const m = dev.media && (dev.media.mediaSessionId !== undefined || dev.media.title) ? dev.media : null;
    const mState = m ? String(m.playerState || '').toUpperCase() : '';
    const mPlaying = mState === 'PLAYING' || mState === 'BUFFERING';
    const hasActiveAppOrMedia = Boolean(m || dev.appName);
    return `
      <div class="vos-insp-row">
        <span class="vos-insp-hex">${m ? `${escapeHtml(dev.appName || 'CAST')} &bull; ${escapeHtml(mState)}` : (dev.appName ? `${escapeHtml(dev.appName)} OPEN` : (dev.power ? 'CASTING AUDIO/VIDEO' : 'CAST READY'))} &bull; Vol ${dev.brightness ?? 0}%</span>
      </div>
      ${m ? `<div class="vos-insp-row"><span class="vos-insp-hex">${escapeHtml(m.title || 'Playing')}${m.artist ? ` — ${escapeHtml(m.artist)}` : ''}</span></div>` : ''}
      <div class="vos-insp-row" style="justify-content:flex-start;flex-wrap:wrap;gap:6px;">
        <button type="button" class="btn btn-sm ${dev.power ? 'btn-danger' : 'btn-primary'} vos-cast-stream-btn" data-cast-stream="${dev.power ? 'stop' : 'start'}">${dev.power ? 'Stop Casting' : 'Cast Audio / Screen'}</button>
        <button type="button" class="btn btn-sm btn-secondary vos-cast-wake-btn" data-cast-wake="1">Wake / Connect</button>
        <button type="button" class="btn btn-sm btn-secondary vos-cast-media-btn" data-action="sync_status">Sync</button>
      </div>
      <div class="vos-insp-row" style="gap:6px;">
        <input type="text" id="${queryId}" class="text-input" placeholder="Song, album, artist or YouTube..." style="flex:1;min-width:110px;padding:4px 8px;font-size:0.75rem;" />
        <button type="button" class="btn btn-sm btn-primary vos-cast-play-query-btn">Play</button>
      </div>
      <div class="vos-insp-row">
        <label class="vos-insp-lbl">Vol <input type="range" id="${volId}" min="0" max="100" value="${dev.brightness ?? 50}" /></label>
      </div>
      <div class="vos-insp-row" style="justify-content:flex-start;flex-wrap:wrap;gap:5px;">
        ${hasActiveAppOrMedia ? `
          <button type="button" class="btn btn-sm btn-secondary vos-cast-media-btn" data-action="previous">Prev</button>
          <button type="button" class="btn btn-sm btn-secondary vos-cast-media-btn" data-action="rewind" data-seconds="10">-10s</button>
          <button type="button" class="btn btn-sm btn-primary vos-cast-media-btn" data-action="${mPlaying ? 'pause' : 'play'}">${mPlaying ? 'Pause' : 'Play'}</button>
          <button type="button" class="btn btn-sm btn-secondary vos-cast-media-btn" data-action="fast_forward" data-seconds="10">+10s</button>
          <button type="button" class="btn btn-sm btn-secondary vos-cast-media-btn" data-action="next">Next</button>
          <button type="button" class="btn btn-sm btn-danger vos-cast-media-btn" data-action="stop_media">Stop</button>
        ` : ''}
        <button type="button" class="btn btn-sm btn-secondary vos-cast-media-btn" data-action="play_preset" data-preset="country_night">Country Night</button>
        <button type="button" class="btn btn-sm btn-secondary vos-cast-media-btn" data-action="play_preset" data-preset="rain">Rain</button>
      </div>
    `;
  }

  function bindCastDeviceControls(container, dev, idPrefix) {
    if (!container || !dev) return;
    const volR = container.querySelector(`#vos${idPrefix}CastVolRange`);
    if (volR) {
      volR.addEventListener('change', () => triggerDeviceControl(dev, { volume: Number(volR.value) }));
    }
    const streamBtn = container.querySelector('.vos-cast-stream-btn');
    if (streamBtn) {
      streamBtn.addEventListener('click', () => triggerDeviceControl(dev, { cast_stream: streamBtn.dataset.castStream }));
    }
    const wakeBtn = container.querySelector('.vos-cast-wake-btn');
    if (wakeBtn) {
      wakeBtn.addEventListener('click', () => triggerDeviceControl(dev, { cast_auto_connect: true, wake: true }));
    }
    const queryInp = container.querySelector(`#vos${idPrefix}CastQueryInput`);
    const playQueryBtn = container.querySelector('.vos-cast-play-query-btn');
    const submitQuery = () => {
      const q = queryInp ? queryInp.value.trim() : '';
      if (!q) return;
      triggerDeviceControl(dev, { media_action: 'play_web_media', query: q });
    };
    if (playQueryBtn) {
      playQueryBtn.addEventListener('click', submitQuery);
    }
    if (queryInp) {
      queryInp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          submitQuery();
        }
      });
    }
    container.querySelectorAll('.vos-cast-media-btn').forEach((b) => {
      b.addEventListener('click', () => triggerDeviceControl(dev, {
        media_action: b.dataset.action,
        seconds: b.dataset.seconds ? Number(b.dataset.seconds) : null,
        preset: b.dataset.preset || undefined
      }));
    });
  }

  function openSliceMenu(sliceOrKey) {
    const slice = typeof sliceOrKey === 'string' ? findSliceByKey(sliceOrKey) : sliceOrKey;
    if (!slice || !els.sliceMenu) return;
    if (typeof callbacks.onCloseDrawer === 'function') callbacks.onCloseDrawer();
    state.openMenuSliceKey = slice.key;
    state.sliceAssignOpen = false;
    state.sliceAssignQuery = '';
    lastMenuScenesSig = '';
    if (els.smAssignSearch) els.smAssignSearch.value = '';
    renderSliceMenu();
    els.sliceMenu.classList.remove('hidden');
    positionSliceMenu(slice);
    if (slice.dev && slice.dev._kind === 'cast' && callbacks.onControlCast) {
      callbacks.onControlCast(slice.dev.id, { media_action: 'sync_status', silent: true });
    }
  }

  async function executeSceneFromUi(scene, btnEl, badgeSelector = '.vos-sm-scene-run') {
    if (!scene || !callbacks.onTriggerScene) {
      pushLog('SCENE', `Scene "${scene?.name || ''}" handler unavailable`, 'warn');
      return;
    }
    const badge = btnEl ? btnEl.querySelector(badgeSelector) : null;
    if (btnEl) {
      btnEl.disabled = true;
      btnEl.classList.remove('is-done');
      btnEl.classList.add('is-running');
    }
    if (badge) badge.textContent = 'RUNNING...';
    triggerEnergyBurst(1.1);
    try {
      const res = await callbacks.onTriggerScene(scene, btnEl);
      if (res && res.ok === false) {
        throw new Error(res.error || 'Scene failed');
      }
      if (btnEl) {
        btnEl.classList.remove('is-running');
        btnEl.classList.add('is-done');
      }
      if (badge) badge.textContent = 'ENABLED';
      setTimeout(() => {
        if (btnEl) btnEl.classList.remove('is-done');
        if (badge && document.body.contains(badge)) {
          badge.textContent = badgeSelector === '.vos-sm-scene-run' ? 'ENABLE' : 'RUN';
        }
        if (state.openMenuSliceKey) renderSliceMenu();
        renderInspector();
      }, 1450);
    } catch (_) {
      if (btnEl) btnEl.classList.remove('is-running', 'is-done');
      if (badge) badge.textContent = 'RETRY';
    } finally {
      if (btnEl) btnEl.disabled = false;
    }
  }

  function persistSliceSceneAssignment(assignKey, nextIds) {
    if (!assignKey) return;
    if (!state.sliceScenes || typeof state.sliceScenes !== 'object') {
      state.sliceScenes = Object.create(null);
    }
    state.sliceScenes[assignKey] = [...nextIds];
    saveLocalSliceScenes();
    if (callbacks.onSaveSliceScenes) {
      callbacks.onSaveSliceScenes(assignKey, [...nextIds]);
    }
  }

  function renderSliceMenuAssignOptions(slice, resolved) {
    if (!els.smAssignPanel || !els.smAssignOptions) return;
    els.smAssignPanel.classList.toggle('hidden', !state.sliceAssignOpen);
    if (els.smAssignToggleBtn) {
      els.smAssignToggleBtn.classList.toggle('active', state.sliceAssignOpen);
      els.smAssignToggleBtn.textContent = state.sliceAssignOpen ? 'Done' : '+ Assign';
    }
    if (!state.sliceAssignOpen) return;

    const q = foldName(state.sliceAssignQuery || '');
    const pinnedSet = new Set(resolved.pinnedIds);
    const filtered = resolved.catalog.filter((item) => {
      if (!q) return true;
      return foldName(`${item.name} ${item.targetDevice} ${item.systemBus}`).includes(q);
    });

    if (!filtered.length) {
      els.smAssignOptions.innerHTML = '<div class="vos-empty">No SmartLife created scenes match your filter.</div>';
      return;
    }

    els.smAssignOptions.innerHTML = filtered.slice(0, 60).map((item) => {
      const assigned = pinnedSet.has(item.id);
      return `
        <button type="button" class="vos-sm-assign-opt ${assigned ? 'is-assigned' : ''}" data-scene-id="${escapeHtml(item.id)}">
          <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
            ${escapeHtml(item.name)}${item.targetDevice ? ` · <span style="opacity:.7">${escapeHtml(item.targetDevice)}</span>` : ''}${!item.enabled ? ' (Disabled)' : ''}
          </span>
          <span>${assigned ? 'Pinned ✓' : '+ Pin'}</span>
        </button>
      `;
    }).join('');

    els.smAssignOptions.querySelectorAll('.vos-sm-assign-opt').forEach((optBtn) => {
      optBtn.addEventListener('click', () => {
        const sid = String(optBtn.dataset.sceneId || '');
        if (!sid || !resolved.assignKey) return;
        const next = new Set(resolved.pinnedIds);
        if (next.has(sid)) next.delete(sid);
        else next.add(sid);
        persistSliceSceneAssignment(resolved.assignKey, [...next]);
        lastMenuScenesSig = '';
        renderSliceMenu();
      });
    });
  }

  function renderSliceMenu() {
    if (!els.sliceMenu || !state.openMenuSliceKey) return;
    const slice = findSliceByKey(state.openMenuSliceKey);
    if (!slice) {
      closeSliceMenu();
      return;
    }

    const info = describePieSector(slice);
    const pnl = info.pnl;
    els.sliceMenu.style.setProperty('--sm-accent', pnl.hex || '#38bdf8');

    const isSys = slice.layer === 's';
    const dev = slice.dev || {};
    const sys = slice.sys || {};
    const orbCss = isSys
      ? rgbCss(sys.color || pnl.rgb, 1)
      : rgbCss(rgbNormFromDev(dev), 1);

    if (els.smOrb) {
      els.smOrb.style.background = `radial-gradient(circle at 35% 35%, #fff, ${orbCss} 65%, #0f172a)`;
      els.smOrb.style.boxShadow = `0 0 14px ${orbCss}`;
    }
    if (els.smTitle) {
      els.smTitle.textContent = isSys ? (sys.name || slice.sysKey) : (dev.name || 'Sector');
    }
    if (els.smMeta) {
      els.smMeta.textContent = `${info.tierTag} • ${info.roleBadge}`;
    }
    if (els.smBadge) {
      els.smBadge.textContent = info.statusPill;
      els.smBadge.style.borderColor = pnl.hex;
      els.smBadge.style.color = '#f8fafc';
    }

    const editingCtrl = Boolean(
      els.smControls
      && document.activeElement
      && els.smControls.contains(document.activeElement)
      && ['vosSmBriRange', 'vosSmCastVolRange', 'vosSmCastQueryInput'].includes(document.activeElement.id)
    );

    if (els.smControls && !editingCtrl) {
      if (isSys) {
        const fillCss = rgbCss(sys.color || pnl.rgb, 1);
        els.smControls.innerHTML = `
          <div class="vos-sys-m-bar" style="height:6px;">
            <div class="vos-sys-m-fill" style="width:${clamp(sys.usagePct > 0 ? Math.max(4, sys.usagePct) : 2, 2, 100)}%; background:${fillCss};"></div>
          </div>
          <div class="vos-insp-sys-stats">
            <span><b>Usage</b> <i>${sys.usagePct ?? 0}%</i></span>
            <span><b>Pie Share</b> <i>${sys.sharePct ?? 20}%</i></span>
            <span><b>Active</b> <i>${formatDurationSec(sys.activeSec)}</i></span>
            <span><b>Events</b> <i>${sys.count ?? 0}</i></span>
          </div>
          <div class="vos-insp-sys-last" style="margin:0;">
            ${escapeHtml(sys.detailMetric || sys.subtitle || 'Standby')}
          </div>
          ${slice.sysKey === 'cast' ? buildCastBusQuickHtml() : ''}
        `;
        if (slice.sysKey === 'cast') {
          bindCastBusQuickEvents(els.smControls);
        }
      } else {
        const isLight = dev.category === 'light' || dev.category === 'ble_light';
        const isIr = String(dev.category || '').startsWith('ir_');
        if (isLight) {
          els.smControls.innerHTML = `
            <div class="vos-insp-row">
              <button type="button" class="btn btn-sm ${dev.power ? 'btn-danger' : 'btn-primary'}" id="vosSmPowerBtn">
                ${dev.power ? 'Turn Light OFF' : 'Turn Light ON'}
              </button>
              <span class="vos-insp-hex">${dev.power ? `ON • ${dev.brightness ?? 100}%` : 'POWER OFF'}</span>
            </div>
            <div class="vos-insp-slider-wrap">
              <span>Brightness</span>
              <input type="range" min="5" max="100" value="${Number(dev.brightness ?? 100)}" id="vosSmBriRange" />
            </div>
            <div class="vos-swatch-row">
              ${PRESET_SWATCHES.map((sw) => `
                <button type="button" class="vos-swatch-btn" title="${sw.label}" data-r="${sw.r}" data-g="${sw.g}" data-b="${sw.b}" style="background:${sw.hex}"></button>
              `).join('')}
            </div>
          `;
          const pwrBtn = el('vosSmPowerBtn');
          if (pwrBtn) pwrBtn.addEventListener('click', () => triggerDeviceControl(dev, { power: !dev.power }));
          const briEl = el('vosSmBriRange');
          if (briEl) briEl.addEventListener('change', () => triggerDeviceControl(dev, { brightness: Number(briEl.value) }));
          els.smControls.querySelectorAll('.vos-swatch-btn').forEach((b) => {
            b.addEventListener('click', () => triggerDeviceControl(dev, { power: true, r: Number(b.dataset.r), g: Number(b.dataset.g), b: Number(b.dataset.b) }));
          });
        } else if (isIr) {
          els.smControls.innerHTML = `
            <div class="vos-sm-ir-notice">
              <span>Direct IR Drivers</span>
              <b>Disabled &bull; Use SmartLife Created Scenes</b>
            </div>
          `;
        } else if (dev.category === 'vacuum') {
          els.smControls.innerHTML = `
            <div class="vos-insp-row">
              <div style="display:flex;gap:6px;flex-wrap:wrap;">
                <button type="button" class="btn btn-sm btn-primary" data-vac="start_clean">Clean</button>
                <button type="button" class="btn btn-sm btn-secondary" data-vac="dock">Dock</button>
                <button type="button" class="btn btn-sm btn-secondary" data-vac="pause">Pause</button>
              </div>
              <span class="vos-insp-hex">Bat ${dev.battery != null ? `${dev.battery}%` : '--'}</span>
            </div>
          `;
          els.smControls.querySelectorAll('[data-vac]').forEach((b) => {
            b.addEventListener('click', () => triggerDeviceControl(dev, { vacuum_action: b.dataset.vac }));
          });
        } else if (dev._kind === 'cast') {
          els.smControls.innerHTML = buildCastDeviceControlsHtml(dev, 'Sm');
          bindCastDeviceControls(els.smControls, dev, 'Sm');
        } else {
          els.smControls.innerHTML = '';
        }
      }
    }

    const resolved = getScenesForSlice(slice);
    const sig = `${resolved.assignKey}|${resolved.scenes.map((s) => `${s.id}:${s._pinned ? 1 : 0}:${s.enabled ? 1 : 0}:${s.actionCount || 0}`).join(',')}`;
    const hasBusyMenuBtn = Boolean(
      els.smSceneList && els.smSceneList.querySelector('.vos-sm-scene-btn.is-running, .vos-sm-scene-btn.is-done')
    );
    if (els.smSceneList && !hasBusyMenuBtn && sig !== lastMenuScenesSig) {
      lastMenuScenesSig = sig;
      if (!resolved.scenes.length) {
        els.smSceneList.innerHTML = '<div class="vos-empty" style="padding:10px;">No SmartLife created scenes linked yet. Click <b>+ Assign</b> above to pin routines to this slice.</div>';
      } else {
        els.smSceneList.innerHTML = resolved.scenes.map((sc) => `
          <button type="button" class="vos-sm-scene-btn" data-scene-id="${escapeHtml(sc.id)}" title="Click to enable SmartLife Tap-to-Run scene">
            <span class="vos-sm-scene-main">
              <span class="vos-sm-scene-name">${escapeHtml(sc.name)}</span>
              <span class="vos-sm-scene-desc">${sc._pinned ? 'Pinned Routine' : 'Auto-Matched'} &bull; ${formatSceneActionCount(sc.actionCount)}${sc.targetDevice ? ` &bull; ${escapeHtml(sc.targetDevice)}` : ''}</span>
            </span>
            <span class="vos-sm-scene-run">ENABLE</span>
          </button>
        `).join('');

        const scById = new Map(resolved.scenes.map((s) => [s.id, s]));
        els.smSceneList.querySelectorAll('.vos-sm-scene-btn').forEach((btn) => {
          btn.addEventListener('click', () => {
            const sc = scById.get(btn.dataset.sceneId);
            if (sc) executeSceneFromUi(sc, btn, '.vos-sm-scene-run');
          });
        });
      }
    }

    renderSliceMenuAssignOptions(slice, resolved);
  }

  function renderInspector() {
    if (!els.inspectorBody) return;
    if (
      els.inspectorBody.querySelector('.vos-insp-scene-btn.is-running, .vos-insp-scene-btn.is-done')
      || (document.activeElement && els.inspectorBody.contains(document.activeElement) && ['vosInspBriRange', 'vosInspCastVolRange', 'vosInspCastQueryInput'].includes(document.activeElement.id))
    ) {
      return;
    }

    if (state.focusLayer === 's' && state.focusedSysKey) {
      const sysMeta = cachedSysMeta || buildSystemSlicesMeta();
      const sys = sysMeta.find((s) => s.sysKey === state.focusedSysKey);
      if (sys) {
        const orbCss = rgbCss(sys.color, 1);
        els.inspectorBody.innerHTML = `
          <div class="vos-insp-sys-card" data-sys-insp="${escapeHtml(sys.sysKey)}">
            <div class="vos-insp-head">
              <div class="vos-insp-orb" style="background:radial-gradient(circle at 35% 35%, #fff, ${orbCss} 65%, #0f172a); box-shadow:0 0 18px ${orbCss};"></div>
              <div class="vos-insp-meta">
                <div class="vos-insp-name">${escapeHtml(sys.name)}</div>
                <div class="vos-insp-tags">
                  <span class="vos-obj-cat">LAYER S</span>
                  <span class="vos-obj-proto" data-f="stateTag">${sys.active ? 'ACTIVE BUS' : 'STANDBY'}</span>
                  <span class="vos-insp-ip"><span data-f="share">${sys.sharePct}%</span> PIE SHARE</span>
                </div>
              </div>
            </div>
            <div class="vos-sys-m-bar vos-insp-sys-bar">
              <div class="vos-sys-m-fill" data-f="fill" style="width:${clamp(sys.usagePct > 0 ? Math.max(4, sys.usagePct) : 2, 2, 100)}%; background:${orbCss};"></div>
            </div>
            <div class="vos-insp-sys-stats">
              <span><b>Usage</b> <i data-f="pct">${sys.usagePct}%</i></span>
              <span><b>Share</b> <i data-f="share">${sys.sharePct}%</i></span>
              <span><b>Active</b> <i data-f="time">${formatDurationSec(sys.activeSec)}</i></span>
              <span><b>Events</b> <i data-f="count">${sys.count}</i></span>
            </div>
            <div class="vos-insp-sys-detail" data-f="detail">${escapeHtml(sys.detailMetric)}</div>
            <div class="vos-insp-sys-last">Last: <span data-f="last">${escapeHtml(sys.lastAction || 'No events recorded yet')}</span></div>
            ${sys.sysKey === 'cast' ? buildCastBusQuickHtml() : ''}
            <div class="vos-insp-row">
              <button type="button" class="btn btn-sm btn-secondary" id="vosInspBackDevBtn">&larr; Device View</button>
              <button type="button" class="btn btn-sm btn-secondary" id="vosInspResetSysBtn">Reset Usage</button>
            </div>
          </div>
        `;
        if (sys.sysKey === 'cast') {
          bindCastBusQuickEvents(els.inspectorBody);
        }
        const backBtn = el('vosInspBackDevBtn');
        if (backBtn) {
          backBtn.addEventListener('click', () => {
            state.focusLayer = 'dev';
            state.focusedSysKey = '';
            const selDev = getUnifiedDevices().find((d) => d.id === state.selectedDeviceId);
            if (selDev) focusDevice(selDev.id, true);
            else {
              renderSystemChips(true);
              renderInspector();
            }
          });
        }
        const resetBtn = el('vosInspResetSysBtn');
        if (resetBtn) {
          resetBtn.addEventListener('click', () => resetSystemUsage());
        }
        return;
      }
    }

    const devs = getUnifiedDevices();
    const dev = devs.find((d) => d.id === state.selectedDeviceId) || devs[0];
    if (!dev) {
      els.inspectorBody.innerHTML = '<div class="vos-empty">No devices registered yet. Scan LAN or sync Smart Life / Tuya keys.</div>';
      return;
    }

    state.selectedDeviceId = dev.id;
    const normC = rgbNormFromDev(dev);
    const orbCss = rgbCss(normC, 1);
    const cat = categoryLabel(dev);
    const proto = dev.discoverySource === 'browser_lan'
      ? (dev.ssid ? `Wi-Fi LAN • ${dev.ssid}` : 'Wi-Fi LAN')
      : (dev.ip ? 'Local LAN' : (dev.platform === 'tuya' ? 'Tuya Cloud' : (dev._kind === 'cast' ? 'Google Cast' : 'BLE')));
    const isLight = dev.category === 'light' || dev.category === 'ble_light';
    const isIr = String(dev.category || '').startsWith('ir_');

    let actionsHtml = '';
    if (isLight) {
      actionsHtml = `
        <div class="vos-insp-row">
          <button type="button" class="btn btn-sm ${dev.power ? 'btn-danger' : 'btn-primary'}" id="vosInspPowerBtn">
            ${dev.power ? 'Turn Light OFF' : 'Turn Light ON'}
          </button>
          <span class="vos-insp-hex">${dev.power ? `ON • ${dev.brightness ?? 100}%` : 'POWER OFF'}</span>
        </div>
        <div class="vos-insp-slider-wrap">
          <span>Brightness</span>
          <input type="range" min="5" max="100" value="${Number(dev.brightness ?? 100)}" id="vosInspBriRange" />
        </div>
        <div class="vos-swatch-row">
          ${PRESET_SWATCHES.map((sw) => `
            <button type="button" class="vos-swatch-btn" title="${sw.label}" data-r="${sw.r}" data-g="${sw.g}" data-b="${sw.b}" style="background:${sw.hex}"></button>
          `).join('')}
        </div>
      `;
    } else if (isIr) {
      const matched = getScenesForDevice(dev).slice(0, 6);
      actionsHtml = `
        <div class="vos-sm-ir-notice" style="margin-top:6px;">
          <span>IR Drivers Disabled</span>
          <b>SmartLife Created Scenes</b>
        </div>
        ${matched.length ? `
          <div class="vos-sm-scene-list" style="margin-top:6px;max-height:170px;">
            ${matched.map((sc) => `
              <button type="button" class="vos-sm-scene-btn vos-insp-scene-btn" data-scene-id="${escapeHtml(sc.id)}">
                <span class="vos-sm-scene-main">
                  <span class="vos-sm-scene-name">${escapeHtml(sc.name)}</span>
                  <span class="vos-sm-scene-desc">${sc._pinned ? 'Pinned Routine' : 'Auto-Matched'} &bull; ${formatSceneActionCount(sc.actionCount)}</span>
                </span>
                <span class="vos-sm-scene-run">ENABLE</span>
              </button>
            `).join('')}
          </div>
        ` : `<div class="vos-empty" style="margin-top:6px;">No scenes linked yet. Click below to assign SmartLife created scenes.</div>`}
        <div class="vos-insp-row" style="margin-top:6px;">
          <button type="button" class="btn btn-sm btn-primary" id="vosInspOpenMenuBtn">Open Slice Scenes Menu</button>
        </div>
      `;
    } else if (dev.category === 'vacuum') {
      actionsHtml = `
        <div class="vos-insp-row">
          <button type="button" class="btn btn-sm btn-secondary" id="vosInspDockBtn">Return to Dock</button>
          <span class="vos-insp-hex">Battery: ${dev.battery != null ? `${dev.battery}%` : '—'}</span>
        </div>
      `;
    } else if (dev._kind === 'cast') {
      actionsHtml = buildCastDeviceControlsHtml(dev, 'Insp');
    }

    els.inspectorBody.innerHTML = `
      <div class="vos-insp-head">
        <div class="vos-insp-orb" style="background:radial-gradient(circle at 35% 35%, #fff, ${orbCss} 65%, #0f172a); box-shadow:0 0 18px ${orbCss};"></div>
        <div class="vos-insp-meta">
          <div class="vos-insp-name">${escapeHtml(dev.name)}</div>
          <div class="vos-insp-tags">
            <span class="vos-obj-cat">${escapeHtml(cat)}</span>
            <span class="vos-obj-proto">${escapeHtml(proto)}</span>
            ${dev.ip ? `<span class="vos-insp-ip">${escapeHtml(dev.ip)}</span>` : ''}
          </div>
        </div>
      </div>
      ${actionsHtml}
    `;

    const pwrBtn = el('vosInspPowerBtn');
    if (pwrBtn) pwrBtn.addEventListener('click', () => triggerDeviceControl(dev, { power: !dev.power }));
    const briEl = el('vosInspBriRange');
    if (briEl) briEl.addEventListener('change', () => triggerDeviceControl(dev, { brightness: Number(briEl.value) }));
    els.inspectorBody.querySelectorAll('.vos-swatch-btn').forEach((b) => {
      b.addEventListener('click', () => triggerDeviceControl(dev, { power: true, r: Number(b.dataset.r), g: Number(b.dataset.g), b: Number(b.dataset.b) }));
    });
    const inspSceneList = getScenesForDevice(dev);
    const inspSceneMap = new Map(inspSceneList.map((s) => [s.id, s]));
    els.inspectorBody.querySelectorAll('.vos-insp-scene-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const sc = inspSceneMap.get(btn.dataset.sceneId);
        if (sc) executeSceneFromUi(sc, btn, '.vos-sm-scene-run');
      });
    });
    const openMenuBtn = el('vosInspOpenMenuBtn');
    if (openMenuBtn) {
      openMenuBtn.addEventListener('click', () => {
        const sO = findSliceByKey(`o:${dev.id}`) || findSliceByKey(`v:${dev.id}`);
        if (sO) openSliceMenu(sO);
      });
    }
    const dockBtn = el('vosInspDockBtn');
    if (dockBtn) dockBtn.addEventListener('click', () => triggerDeviceControl(dev, { vacuum_action: 'dock' }));
    if (dev._kind === 'cast') {
      bindCastDeviceControls(els.inspectorBody, dev, 'Insp');
    }
  }

  function renderLogs() {
    if (!els.sLogs) return;
    if (!state.logs.length) {
      els.sLogs.innerHTML = '<div class="vos-log-line"><span class="vos-log-tag">[SYS]</span> Waiting for voice or smart home events...</div>';
      return;
    }
    els.sLogs.innerHTML = state.logs.map((entry) => `
      <div class="vos-log-line ${entry.level}">
        <span class="vos-log-ts">${escapeHtml(entry.ts)}</span>
        <span class="vos-log-tag">[${escapeHtml(entry.tag)}]</span>
        <span>${escapeHtml(entry.text)}</span>
      </div>
    `).join('');
  }

  function pushLog(tag, text, level = 'info') {
    state.logs.unshift({
      ts: timeNow(),
      tag: String(tag || 'SYS').toUpperCase(),
      text: String(text || ''),
      level: level === 'ok' || level === 'warn' || level === 'error' ? level : 'info'
    });
    if (state.logs.length > MAX_LOGS) state.logs.length = MAX_LOGS;
    renderLogs();
  }

  // ---------------------------------------------------------------------------
  // Audio Attachments (Mic Input when YOU Talk + Remote WebRTC when AI Talks)
  // ---------------------------------------------------------------------------

  function ensureAudioContext() {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      audioCtx = new AC();
    }
    if (audioCtx.state === 'suspended' && typeof audioCtx.resume === 'function') {
      audioCtx.resume().catch(() => {});
    }
    return audioCtx;
  }

  function attachMediaStream(stream) {
    if (micSrc) { try { micSrc.disconnect(); } catch (_) {} micSrc = null; }
    if (micAnalyser) { try { micAnalyser.disconnect(); } catch (_) {} micAnalyser = null; }
    micBinBuf = null;
    if (!stream) return;
    try {
      const ctx = ensureAudioContext();
      if (!ctx) return;
      micSrc = ctx.createMediaStreamSource(stream);
      micAnalyser = ctx.createAnalyser();
      micAnalyser.fftSize = 128;
      micSrc.connect(micAnalyser);
      micBinBuf = new Uint8Array(micAnalyser.frequencyBinCount);
    } catch (_) {}
  }

  function attachRemoteAudioStream(stream) {
    if (remoteSrc) { try { remoteSrc.disconnect(); } catch (_) {} remoteSrc = null; }
    if (remoteAnalyser) { try { remoteAnalyser.disconnect(); } catch (_) {} remoteAnalyser = null; }
    remoteBinBuf = null;
    if (!stream) return;
    try {
      const ctx = ensureAudioContext();
      if (!ctx) return;
      remoteSrc = ctx.createMediaStreamSource(stream);
      remoteAnalyser = ctx.createAnalyser();
      remoteAnalyser.fftSize = 128;
      remoteSrc.connect(remoteAnalyser);
      remoteBinBuf = new Uint8Array(remoteAnalyser.frequencyBinCount);
    } catch (_) {}
  }

  function detachAudio() {
    if (micSrc) { try { micSrc.disconnect(); } catch (_) {} micSrc = null; }
    if (micAnalyser) { try { micAnalyser.disconnect(); } catch (_) {} micAnalyser = null; }
    if (remoteSrc) { try { remoteSrc.disconnect(); } catch (_) {} remoteSrc = null; }
    if (remoteAnalyser) { try { remoteAnalyser.disconnect(); } catch (_) {} remoteAnalyser = null; }
    micBinBuf = null;
    remoteBinBuf = null;
    state.audioLevel = 0;
    state.userAudioLevel = 0;
    state.aiAudioLevel = 0;
    state.fftBins.fill(0);
    if (els.voiceEnergyFill) els.voiceEnergyFill.style.width = '4%';
    if (audioCtx) {
      const toClose = audioCtx;
      audioCtx = null;
      try {
        const p = toClose.close();
        if (p && typeof p.catch === 'function') p.catch(() => {});
      } catch (_) {}
    }
  }

  // ---------------------------------------------------------------------------
  // Resize & Pointer Event Wiring (Exact 3D Picking + Orbit + Mouse Helper)
  // ---------------------------------------------------------------------------

  function syncCanvasSize() {
    if (!els.viewport || !els.webglCanvas || !els.hudCanvas) return;
    const rect = els.viewport.getBoundingClientRect();
    viewWidth = Math.max(200, Math.round(rect.width));
    viewHeight = Math.max(200, Math.round(rect.height));
    const nativeDpr = window.devicePixelRatio || 1;
    const cfg = getTierConfig();
    dpr = clamp(nativeDpr, 1.0, cfg.maxDpr);
    hudDpr = clamp(Math.max(nativeDpr, 1.5), 1.5, gpuTier === 'low' ? 2 : 3);

    if (threeRenderer && threeCamera) {
      threeRenderer.setPixelRatio(dpr);
      threeRenderer.setSize(viewWidth, viewHeight, false);
      threeCamera.aspect = Math.max(0.4, viewWidth / Math.max(1, viewHeight));
      threeCamera.updateProjectionMatrix();
      if (threeComposer) {
        threeComposer.setPixelRatio(dpr);
        threeComposer.setSize(viewWidth, viewHeight);
      }
      if (threeBloomPass) {
        threeBloomPass.setSize(viewWidth, viewHeight);
      }
    } else {
      const pw = Math.round(viewWidth * dpr);
      const ph = Math.round(viewHeight * dpr);
      if (els.webglCanvas.width !== pw || els.webglCanvas.height !== ph) {
        els.webglCanvas.width = pw;
        els.webglCanvas.height = ph;
      }
    }

    const hw = Math.round(viewWidth * hudDpr);
    const hh = Math.round(viewHeight * hudDpr);
    if (els.hudCanvas.width !== hw || els.hudCanvas.height !== hh) {
      els.hudCanvas.width = hw;
      els.hudCanvas.height = hh;
    }
  }

  function focusDevice(devId, withZoom = true) {
    if (!devId) return;
    state.selectedDeviceId = devId;
    state.focusLayer = 'dev';
    if (!state.activeVoiceAction) {
      state.focusedSysKey = '';
    }
    const sO = sliceModels.o.find((x) => x.devId === devId) || sliceModels.v.find((x) => x.devId === devId);
    if (sO && withZoom) {
      state.focusedDeviceIds = [devId];
      spinToSlice(sO, 0, 'user');
    }
    renderDeviceNav();
    renderSystemChips(true);
    renderInspector();
  }

  function toggleManualJoin() {
    const flat = shouldBeFlatSuperPie();
    state.manualLock = flat ? false : true;
    triggerEnergyBurst(0.95);
    updateModeBadgeAndClasses();
    pushLog('HUD', `3D Super-Pie ${state.manualLock ? 'FLATTENED (Nested)' : 'SEPARATED (3-Tier)'}`, 'info');
  }

  function init(opts = {}) {
    if (opts.onControlSmart) callbacks.onControlSmart = opts.onControlSmart;
    if (opts.onControlCast) callbacks.onControlCast = opts.onControlCast;
    if (opts.onTriggerScene) callbacks.onTriggerScene = opts.onTriggerScene;
    if (opts.onSaveSliceScenes) callbacks.onSaveSliceScenes = opts.onSaveSliceScenes;
    if (opts.onSyncScenes) callbacks.onSyncScenes = opts.onSyncScenes;
    if (opts.onCloseDrawer) callbacks.onCloseDrawer = opts.onCloseDrawer;

    els = {
      section: el('vosSection'),
      viewport: el('vosViewport'),
      webglCanvas: el('vosWebglCanvas'),
      hudCanvas: el('vosHudCanvas'),
      oStatsBadge: el('vosObjectiveStats'),
      deviceNav: el('vosDeviceNav'),
      sChips: el('vosSystemChips'),
      sLogs: el('vosSystemLogs'),
      inspectorBody: el('vosInspectorBody'),
      tooltip: el('vosTooltip'),
      actionBanner: el('vosActionBanner'),
      modeBadge: el('vosModeBadge'),
      purePhaseTag: el('vosPurePhaseTag'),
      sliceMenu: el('vosSliceMenu'),
      smOrb: el('vosSmOrb'),
      smTitle: el('vosSmTitle'),
      smMeta: el('vosSmMeta'),
      smBadge: el('vosSmBadge'),
      smCloseBtn: el('vosSmCloseBtn'),
      smControls: el('vosSmControls'),
      smSyncBtn: el('vosSmSyncBtn'),
      smAssignToggleBtn: el('vosSmAssignToggleBtn'),
      smSceneList: el('vosSmSceneList'),
      smAssignPanel: el('vosSmAssignPanel'),
      smAssignSearch: el('vosSmAssignSearch'),
      smAssignOptions: el('vosSmAssignOptions'),
      joinBtn: el('vosJoinToggleBtn'),
      resetFocusBtn: el('vosResetFocusBtn'),
      helperToggleBtn: el('vosHelperToggleBtn'),
      burstBtn: el('vosBurstBtn'),
      fluxVal: el('vosFluxVal'),
      phaseVal: el('vosPhaseVal'),
      probeStrip: el('vosProbeStrip'),
      probeText: el('vosProbeText'),
      autoJoinChk: el('vosAutoJoinVoiceChk'),
      voiceEnergyFill: el('vosVoiceEnergyFill'),
      presetBtns: document.querySelectorAll('.vos-preset-btn'),
      soloBtns: document.querySelectorAll('.vos-solo-btn')
    };

    if (!els.viewport || !els.webglCanvas || !els.hudCanvas) return;

    ensureSysUsage();
    loadLocalSliceScenes();
    initEnergyField();
    syncCanvasSize();
    initWebGL();

    if (els.sliceMenu) {
      ['pointerdown', 'pointerup', 'click', 'wheel'].forEach((evt) => {
        els.sliceMenu.addEventListener(evt, (ev) => ev.stopPropagation());
      });
    }
    if (els.smCloseBtn) {
      els.smCloseBtn.addEventListener('click', () => closeSliceMenu());
    }
    if (els.smSyncBtn) {
      els.smSyncBtn.addEventListener('click', () => {
        if (callbacks.onSyncScenes) callbacks.onSyncScenes(els.smSyncBtn);
      });
    }
    if (els.smAssignToggleBtn) {
      els.smAssignToggleBtn.addEventListener('click', () => {
        state.sliceAssignOpen = !state.sliceAssignOpen;
        const sl = findSliceByKey(state.openMenuSliceKey);
        if (sl) {
          renderSliceMenuAssignOptions(sl, getScenesForSlice(sl));
          if (state.sliceAssignOpen && els.smAssignSearch) {
            els.smAssignSearch.focus();
          }
        }
      });
    }
    if (els.smAssignSearch) {
      els.smAssignSearch.addEventListener('input', () => {
        state.sliceAssignQuery = els.smAssignSearch.value || '';
        const sl = findSliceByKey(state.openMenuSliceKey);
        if (sl) renderSliceMenuAssignOptions(sl, getScenesForSlice(sl));
      });
    }
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && state.openMenuSliceKey) {
        closeSliceMenu();
      }
    });

    if (els.sChips) {
      els.sChips.addEventListener('click', (e) => {
        const resetBtn = e.target.closest('.vos-sys-reset-btn');
        if (resetBtn) {
          resetSystemUsage();
          return;
        }
        const metricBtn = e.target.closest('.vos-sys-metric');
        if (metricBtn && metricBtn.dataset.sysKey) {
          focusSystemSlice(metricBtn.dataset.sysKey);
        }
      });
    }

    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(() => syncCanvasSize()).observe(els.viewport);
    }
    window.addEventListener('resize', syncCanvasSize);

    els.webglCanvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      disposeThreeResources();
      renderSystemChips(true);
    });
    els.webglCanvas.addEventListener('webglcontextrestored', () => {
      initWebGL();
      rebuildPieTopology(true);
      renderSystemChips(true);
    });

    if (els.joinBtn) els.joinBtn.addEventListener('click', toggleManualJoin);
    if (els.resetFocusBtn) els.resetFocusBtn.addEventListener('click', clearZoomFocus);

    if (els.helperToggleBtn) {
      els.helperToggleBtn.classList.toggle('active', pointer.helperEnabled);
      els.helperToggleBtn.addEventListener('click', () => {
        pointer.helperEnabled = !pointer.helperEnabled;
        els.helperToggleBtn.classList.toggle('active', pointer.helperEnabled);
        if (!pointer.helperEnabled) hideTooltip();
        pushLog('HUD', `3D Mouse Helper ${pointer.helperEnabled ? 'ENABLED' : 'HIDDEN'}`, 'info');
      });
    }

    if (els.burstBtn) {
      els.burstBtn.addEventListener('click', () => {
        triggerEnergyBurst(1.45);
        pushLog('HIGGS', 'Triggered H0 -> γγ collision energy surge', 'ok');
      });
    }

    if (els.autoJoinChk) {
      els.autoJoinChk.checked = state.autoJoinVoice;
      els.autoJoinChk.addEventListener('change', () => {
        state.autoJoinVoice = Boolean(els.autoJoinChk.checked);
        pushLog('HUD', `Auto-Flat on AI Talk ${state.autoJoinVoice ? 'ENABLED' : 'DISABLED'}`, 'info');
      });
    }

    els.presetBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const preset = btn.dataset.preset || 'iso';
        els.presetBtns.forEach((b) => b.classList.toggle('active', b === btn));
        applyCameraPreset(preset, true);
      });
    });

    els.soloBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        state.soloLayer = btn.dataset.solo || 'all';
        els.soloBtns.forEach((b) => b.classList.toggle('active', b === btn));
        updateModeBadgeAndClasses();
      });
    });

    els.viewport.addEventListener('pointerdown', (e) => {
      if (e.target && e.target.closest && e.target.closest('#vosSliceMenu, .vos-pure-topbar, .vos-header, .vos-action-banner, button, input, select')) {
        return;
      }
      dragging = true;
      dragMoved = false;
      dragStart = { x: e.clientX, y: e.clientY, pitch: anim.pitchDeg, yaw: anim.yawDeg };
      els.viewport.classList.add('is-dragging');
      hideTooltip();
    });

    els.viewport.addEventListener('pointerenter', (e) => {
      const rect = els.viewport.getBoundingClientRect();
      pointer.inside = true;
      pointer.x = e.clientX - rect.left;
      pointer.y = e.clientY - rect.top;
      pointer.smoothX = pointer.x;
      pointer.smoothY = pointer.y;
    });

    window.addEventListener('pointermove', (e) => {
      if (dragging) {
        const dx = e.clientX - dragStart.x;
        const dy = e.clientY - dragStart.y;
        if (Math.hypot(dx, dy) > 4) {
          dragMoved = true;
          state.userOrbitOverride = true;
        }
        anim.targetPitchDeg = clamp(dragStart.pitch + dy * 0.28, 6, 86);
        anim.targetYawDeg = clamp(dragStart.yaw - dx * 0.35, -175, 175);
        anim.pitchDeg = anim.targetPitchDeg;
        anim.yawDeg = anim.targetYawDeg;
        hideTooltip();
        return;
      }

      const rect = els.viewport.getBoundingClientRect();
      const ox = e.clientX - rect.left;
      const oy = e.clientY - rect.top;
      const overOverlay = Boolean(e.target && e.target.closest && e.target.closest('#vosSliceMenu, .vos-pure-topbar, .vos-header, .vos-action-banner'));
      const inBounds = !overOverlay && ox >= 0 && oy >= 0 && ox <= rect.width && oy <= rect.height
        && els.viewport.contains(e.target);

      if (!inBounds) {
        if (pointer.inside) {
          pointer.inside = false;
          pointer.hitKind = 'none';
          pointer.slice = null;
          state.hoveredSliceKey = '';
          hideTooltip();
        }
        return;
      }

      pointer.inside = true;
      pointer.x = ox;
      pointer.y = oy;
      evaluatePointerHover();
    });

    window.addEventListener('pointerup', (e) => {
      if (!dragging) return;
      dragging = false;
      els.viewport.classList.remove('is-dragging');
      if (dragMoved) return;

      const rect = els.viewport.getBoundingClientRect();
      const ox = e.clientX - rect.left;
      const oy = e.clientY - rect.top;
      if (ox < 0 || oy < 0 || ox > rect.width || oy > rect.height) return;

      const hit = pickAtPointer(ox, oy);
      if (!hit || hit.kind === 'chamber') {
        if (state.openMenuSliceKey) closeSliceMenu();
        if (state.focusedSliceKey) clearZoomFocus();
        return;
      }
      if (hit.kind === 'core') {
        closeSliceMenu();
        toggleManualJoin();
        return;
      }

      const slice = hit.slice;
      if (!slice) return;
      if (slice.layer === 's') {
        focusSystemSlice(slice.sysKey);
        openSliceMenu(slice);
        return;
      }

      focusDevice(slice.devId, true);
      openSliceMenu(slice);
    });

    els.viewport.addEventListener('pointerleave', () => {
      pointer.inside = false;
      pointer.hitKind = 'none';
      pointer.slice = null;
      state.hoveredSliceKey = '';
      hideTooltip();
    });

    els.viewport.addEventListener('wheel', (e) => {
      if (e.target && e.target.closest && e.target.closest('#vosSliceMenu, .vos-header')) return;
      e.preventDefault();
      state.userOrbitOverride = true;
      anim.targetCamDist = clamp(anim.targetCamDist + e.deltaY * 0.008, 6.2, 16.5);
    }, { passive: false });

    rebuildPieTopology(true);
    renderDeviceNav();
    renderSystemChips();
    renderInspector();
    renderLogs();
    updateModeBadgeAndClasses();
    const engineSummary = threeRenderer
      ? `Three.js ${gpuTier.toUpperCase()} profile (${gpuRendererName || 'WebGL'})`
      : 'Projected 3D HUD Fallback';
    pushLog('SYS', `V.O.S. 3D Engine online (${engineSummary})`, 'ok');
    if (!els.section || !els.section.classList.contains('hidden')) {
      startLoop();
    }
  }

  function updateState(patch = {}) {
    if (Array.isArray(patch.smartDevices)) state.smartDevices = patch.smartDevices;
    if (Array.isArray(patch.castDevices)) state.castDevices = patch.castDevices;
    if (Array.isArray(patch.bleDevices)) state.bleDevices = patch.bleDevices;
    if (patch.smartScenes) state.smartScenes = patch.smartScenes;
    if (Array.isArray(patch.smartSceneLinks)) state.smartSceneLinks = patch.smartSceneLinks;
    if (patch.sliceScenes && typeof patch.sliceScenes === 'object') mergeServerSliceScenes(patch.sliceScenes);
    if (patch.smartConfig) state.smartConfig = patch.smartConfig;
    if (patch.serverInfo) state.serverInfo = patch.serverInfo;
    if ('streamStatus' in patch) {
      state.streamStatus = patch.streamStatus;
      updateStreamRateSample(patch.streamStatus, Date.now());
    }
    if (patch.captureState && typeof patch.captureState === 'object') {
      state.captureState = {
        active: Boolean(patch.captureState.active),
        audioLevel: clamp(Number(patch.captureState.audioLevel || 0), 0, 1),
        mode: String(patch.captureState.mode || '')
      };
    }
    if (patch.btOutput && typeof patch.btOutput === 'object') {
      state.btOutput = {
        active: Boolean(patch.btOutput.active),
        label: String(patch.btOutput.label || '')
      };
    }
    if (patch.castSdk && typeof patch.castSdk === 'object') {
      state.castSdk = {
        active: Boolean(patch.castSdk.active),
        device: String(patch.castSdk.device || '')
      };
    }
    if (patch.castScanState && typeof patch.castScanState === 'object') {
      state.castScanState = {
        active: Boolean(patch.castScanState.active),
        foundCount: Number(patch.castScanState.foundCount || 0),
        subnet: String(patch.castScanState.subnet || ''),
        ssid: String(patch.castScanState.ssid || ''),
        permission: String(patch.castScanState.permission || 'unknown'),
        message: String(patch.castScanState.message || '')
      };
    }
    if ('ambientSyncActive' in patch) {
      state.ambientSyncActive = Boolean(patch.ambientSyncActive);
    }

    detectExternalUsageChanges();
    rebuildPieTopology(false);
    renderDeviceNav();
    renderSystemChips(true);
    renderInspector();
    if (state.openMenuSliceKey) renderSliceMenu();
  }

  window.TrevaVos = {
    init,
    setOpen,
    syncCanvasSize,
    updateState,
    setVoiceState,
    pulseCommandJoin,
    triggerEnergyBurst,
    attachMediaStream,
    attachRemoteAudioStream,
    detachAudio,
    beginVoiceAction,
    completeVoiceAction,
    focusDevice,
    focusSystemSlice,
    clearZoomFocus,
    openSliceMenu,
    closeSliceMenu,
    getScenesForDevice,
    recordSystemUsage,
    resetSystemUsage,
    clearLocalCache,
    setCaptureAudioLevel,
    pushLog
  };

  window.dispatchEvent(new CustomEvent('treva:vos-ready'));
