(() => {
  'use strict';

  const urlParams = new URLSearchParams(window.location.search);
  const STREAM_SID = (urlParams.get('sid') || 'live').replace(/[^a-zA-Z0-9_-]/g, '') || 'live';

  // Core Capture & Stream State
  let streamMode = 'audio'; // 'audio' | 'video'
  let isCapturing = false;
  let displayStream = null;
  let mediaRecorder = null;
  let webmGen = 0;
  let keyframeCycling = false;
  let audioCtx = null;
  let audioSourceNode = null;
  let workletNode = null;
  let scriptProcessor = null;
  let btDestNode = null;
  let mp3Worker = null;
  let mp3SampleRate = 44100;
  let analyser = null;
  let animFrameId = null;
  let wakeLockSentinel = null;
  let lastCaptureAudioLevel = 0;
  let lastVosAudioPushAt = 0;

  // Bluetooth Audio Output State
  let btSinkId = '';
  let btSinkLabel = '';
  let btRoutingActive = false;

  // Devices & Config State
  let devices = [];
  let smartDevices = [];
  let smartScenes = { homeId: '', homeName: '', scenes: [] };
  let smartSceneLinks = [];
  let sliceSceneMap = {};
  let showSceneVoiceLinks = false;
  let bleDevices = [];
  let smartConfig = null;
  let serverInfo = null;
  let pollTimer = null;

  // DOM Diff & Slider Interaction Locks
  let interactionLockUntil = 0;
  let lastDevicesSig = '';
  let lastSmartSig = '';

  // Ambient Light Sync State
  let ambientCanvas = null;
  let ambientCtx = null;
  let lastAmbientSend = 0;
  let lastAmbientCloudSend = 0;
  let lastAmbientRgb = { r: -1, g: -1, b: -1 };

  // Ordered upload FIFO queues
  const uploadQueues = {
    mp3: { items: [], busy: false, uploadedCount: 0 },
    webm: { items: [], busy: false, uploadedCount: 0 }
  };
  const SAVED_SECRET_MASK = '••••••••';
  const CACHE_MODE_KEY = 'treva_cache_mode_v1';
  const LOCAL_VAULT_KEY = 'treva_local_vault_v1';
  const TAB_VAULT_KEY = 'treva_tab_vault_v1';
  let hydratePromise = null;

  function getLocalCacheMode() {
    try {
      return window.localStorage && window.localStorage.getItem(CACHE_MODE_KEY) === 'session'
        ? 'session'
        : 'browser';
    } catch (_) {
      return 'browser';
    }
  }

  function readLocalVault() {
    const mode = getLocalCacheMode();
    try {
      const store = mode === 'session' ? window.sessionStorage : window.localStorage;
      const raw = store ? store.getItem(mode === 'session' ? TAB_VAULT_KEY : LOCAL_VAULT_KEY) : '';
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (_) {
      return null;
    }
  }

  function hasMeaningfulVault(v) {
    if (!v || typeof v !== 'object') return false;
    const cfg = v.smartConfig || {};
    const t = cfg.tuya || {};
    const m = cfg.magicHome || {};
    const o = cfg.openai || {};
    if (String(t.accessId || '').trim() || String(t.accessSecret || '').trim()) return true;
    if (String(m.email || '').trim() || String(m.password || '').trim() || String(m.token || '').trim()) return true;
    if (String(o.apiKey || '').trim()) return true;
    if (v.smartDevices && (Array.isArray(v.smartDevices) ? v.smartDevices.length > 0 : Object.keys(v.smartDevices).length > 0)) return true;
    if (v.devices && (Array.isArray(v.devices) ? v.devices.length > 0 : Object.keys(v.devices).length > 0)) return true;
    if (v.smartScenes && Array.isArray(v.smartScenes.scenes) && v.smartScenes.scenes.length > 0) return true;
    return false;
  }

  function writeLocalVault(vault) {
    if (!vault || typeof vault !== 'object') return;
    const mode = getLocalCacheMode();
    try {
      const serialized = JSON.stringify(vault);
      if (mode === 'session') {
        if (window.sessionStorage) window.sessionStorage.setItem(TAB_VAULT_KEY, serialized);
        if (window.localStorage) window.localStorage.removeItem(LOCAL_VAULT_KEY);
      } else {
        if (window.localStorage) window.localStorage.setItem(LOCAL_VAULT_KEY, serialized);
        if (window.sessionStorage) window.sessionStorage.removeItem(TAB_VAULT_KEY);
      }
    } catch (_) {}
  }

  function clearLocalVaultStorage() {
    try {
      if (window.localStorage) {
        window.localStorage.removeItem(LOCAL_VAULT_KEY);
        window.localStorage.removeItem('treva_vos_slice_scenes_v1');
      }
      if (window.sessionStorage) {
        window.sessionStorage.removeItem(TAB_VAULT_KEY);
        window.sessionStorage.removeItem('treva_vos_slice_scenes_v1');
      }
    } catch (_) {}
  }

  function setLocalCacheMode(mode) {
    const next = mode === 'session' ? 'session' : 'browser';
    const currentVault = readLocalVault();
    try {
      if (window.localStorage) window.localStorage.setItem(CACHE_MODE_KEY, next);
    } catch (_) {}
    if (currentVault) {
      writeLocalVault(currentVault);
    }
    if (next === 'session') {
      try {
        if (window.localStorage) {
          const existingSlices = window.localStorage.getItem('treva_vos_slice_scenes_v1');
          if (existingSlices && window.sessionStorage) {
            window.sessionStorage.setItem('treva_vos_slice_scenes_v1', existingSlices);
          }
          window.localStorage.removeItem(LOCAL_VAULT_KEY);
          window.localStorage.removeItem('treva_vos_slice_scenes_v1');
          window.localStorage.removeItem('treva_vos_sys_usage_v1');
        }
      } catch (_) {}
    }
    updateLocalSessionStatusUi();
  }

  function persistSessionVaultFromResponse(data) {
    if (!data || !data.sessionVault || typeof data.sessionVault !== 'object') return;
    writeLocalVault(data.sessionVault);
    updateLocalSessionStatusUi();
  }

  function updateLocalSessionStatusUi() {
    const mode = getLocalCacheMode();
    if (localCacheModeSelect) {
      localCacheModeSelect.value = mode;
    }
    if (!localSessionStatusPill) return;
    const totalDevs = (smartDevices ? smartDevices.length : 0) + (devices ? devices.length : 0);
    const hasAuth = Boolean(
      (smartConfig && smartConfig.tuya && smartConfig.tuya.configured) ||
      (smartConfig && smartConfig.magicHome && smartConfig.magicHome.configured) ||
      (smartConfig && smartConfig.openai && smartConfig.openai.hasSessionKey) ||
      totalDevs > 0
    );
    const modeTag = mode === 'session' ? 'Tab Session' : 'Browser Cache';
    localSessionStatusPill.classList.toggle('is-active', hasAuth);
    localSessionStatusPill.textContent = hasAuth
      ? `${modeTag} • ${totalDevs} device(s)`
      : `Empty ${modeTag}`;
  }

  async function hydrateServerSession(vault, silent = true) {
    if (!hasMeaningfulVault(vault)) return null;
    if (hydratePromise) return hydratePromise;
    hydratePromise = (async () => {
      try {
        const res = await fetch(apiUrl('session_hydrate'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          cache: 'no-store',
          body: JSON.stringify({ vault })
        });
        const data = await res.json();
        if (!res.ok || data.error) {
          throw new Error(data.error || 'Session hydration failed');
        }
        persistSessionVaultFromResponse(data);
        return data;
      } catch (err) {
        if (!silent) showToast(err.message || 'Could not restore local session', 'error');
        return null;
      } finally {
        hydratePromise = null;
      }
    })();
    return hydratePromise;
  }

  async function clearLocalSession() {
    try {
      const res = await fetch(apiUrl('session_clear'), {
        method: 'POST',
        cache: 'no-store'
      });
      const data = await res.json().catch(() => ({}));
      clearLocalVaultStorage();
      devices = [];
      smartDevices = [];
      smartScenes = { homeId: '', homeName: '', scenes: [] };
      smartSceneLinks = [];
      sliceSceneMap = {};
      if (data.smartConfig) {
        smartConfig = data.smartConfig;
      }
      if (tuyaAccessSecretInput) tuyaAccessSecretInput.value = '';
      if (tuyaAccessIdInput) tuyaAccessIdInput.value = '';
      if (tuyaUidInput) tuyaUidInput.value = '';
      if (mhEmailInput) mhEmailInput.value = '';
      if (mhPasswordInput) mhPasswordInput.value = '';
      if (mhTokenInput) mhTokenInput.value = '';
      if (openAiKeyInput) openAiKeyInput.value = '';
      populateSmartConfigForm();
      renderDevices(true);
      renderSmartDevices(true);
      renderSmartScenes();
      if (window.TrevaVos && typeof window.TrevaVos.clearLocalCache === 'function') {
        window.TrevaVos.clearLocalCache(false);
      }
      syncVosState();
      updateLocalSessionStatusUi();
      showToast('Cleared local session keys, IDs, and devices from this browser.', 'info');
    } catch (err) {
      showToast(err.message || 'Failed to clear local session', 'error');
    }
  }

  // Chrome Cast SDK state
  let castFrameworkReady = false;
  let activeCastSession = null;
  let remotePlayer = null;
  let remotePlayerController = null;
  let userStoppedSdkCast = false;
  let sdkRecoverTimer = null;
  let sdkLastRecoverAt = 0;
  let sdkRecoverCount = 0;
  let sdkActiveMode = 'audio';
  let captureStarting = false;
  let heartbeatTimer = null;

  // DOM Elements
  const serverDot = document.getElementById('serverDot');
  const serverStatusText = document.getElementById('serverStatusText');
  const insecureContextBanner = document.getElementById('insecureContextBanner');

  const captureStateBadge = document.getElementById('captureStateBadge');
  const modeAudioBtn = document.getElementById('modeAudioBtn');
  const modeVideoBtn = document.getElementById('modeVideoBtn');

  const screenPreview = document.getElementById('screenPreview');
  const audioVisualizer = document.getElementById('audioVisualizer');
  const previewPlaceholder = document.getElementById('previewPlaceholder');
  const trackBadges = document.getElementById('trackBadges');
  const videoTrackPill = document.getElementById('videoTrackPill');
  const audioTrackPill = document.getElementById('audioTrackPill');
  const noAudioWarning = document.getElementById('noAudioWarning');

  const btOutputStatus = document.getElementById('btOutputStatus');
  const selectBtAudioBtn = document.getElementById('selectBtAudioBtn');
  const stopBtAudioBtn = document.getElementById('stopBtAudioBtn');
  const btAudioSink = document.getElementById('btAudioSink');

  const startCaptureBtn = document.getElementById('startCaptureBtn');
  const startMicCaptureBtn = document.getElementById('startMicCaptureBtn');
  const stopCaptureBtn = document.getElementById('stopCaptureBtn');
  const telemetryBytes = document.getElementById('telemetryBytes');
  const telemetryListeners = document.getElementById('telemetryListeners');
  const copyMp3UrlBtn = document.getElementById('copyMp3UrlBtn');
  const copyWebmUrlBtn = document.getElementById('copyWebmUrlBtn');

  const localScanControls = document.getElementById('localScanControls');
  const refreshDevicesBtn = document.getElementById('refreshDevicesBtn');
  const addManualDeviceBtn = document.getElementById('addManualDeviceBtn');
  const manualDeviceForm = document.getElementById('manualDeviceForm');
  const manualNameInput = document.getElementById('manualNameInput');
  const manualHostInput = document.getElementById('manualHostInput');
  const manualKindSelect = document.getElementById('manualKindSelect');
  const manualPortInput = document.getElementById('manualPortInput');
  const devicesList = document.getElementById('devicesList');

  const browserCastSdkBtn = document.getElementById('browserCastSdkBtn');
  const castSdkHint = document.getElementById('castSdkHint');
  const sdkSessionBox = document.getElementById('sdkSessionBox');
  const sdkDeviceName = document.getElementById('sdkDeviceName');
  const sdkStreamTypeTag = document.getElementById('sdkStreamTypeTag');
  const sdkStopBtn = document.getElementById('sdkStopBtn');
  const sdkMuteBtn = document.getElementById('sdkMuteBtn');
  const sdkVolumeSlider = document.getElementById('sdkVolumeSlider');
  const sdkVolumePct = document.getElementById('sdkVolumePct');

  // Section 3: Smart Devices
  const ambientSyncCheckbox = document.getElementById('ambientSyncCheckbox');
  const scanSmartWifiBtn = document.getElementById('scanSmartWifiBtn');
  const syncSmartCloudBtn = document.getElementById('syncSmartCloudBtn');
  const pairBleLightBtn = document.getElementById('pairBleLightBtn');
  const addSmartManualBtn = document.getElementById('addSmartManualBtn');
  const openSmartKeysBtn = document.getElementById('openSmartKeysBtn');

  const smartManualForm = document.getElementById('smartManualForm');
  const smartManualPlatform = document.getElementById('smartManualPlatform');
  const smartManualName = document.getElementById('smartManualName');
  const smartManualIp = document.getElementById('smartManualIp');
  const smartTuyaExtraRow = document.getElementById('smartTuyaExtraRow');
  const smartMhSaveRow = document.getElementById('smartMhSaveRow');
  const smartManualDevId = document.getElementById('smartManualDevId');
  const smartManualLocalKey = document.getElementById('smartManualLocalKey');
  const smartManualMac = document.getElementById('smartManualMac');
  const smartManualVersion = document.getElementById('smartManualVersion');
  const smartManualCategory = document.getElementById('smartManualCategory');
  const smartDevicesGrid = document.getElementById('smartDevicesGrid');
  const smartCastHubSection = document.getElementById('smartCastHubSection');
  const smartCastHubMeta = document.getElementById('smartCastHubMeta');
  const smartTabScanCastBtn = document.getElementById('smartTabScanCastBtn');
  const smartCastHubList = document.getElementById('smartCastHubList');

  // Smart Keys Modal
  const smartKeysModal = document.getElementById('smartKeysModal');
  const closeSmartKeysBtn = document.getElementById('closeSmartKeysBtn');
  const smartKeysForm = document.getElementById('smartKeysForm');
  const localCacheModeSelect = document.getElementById('localCacheModeSelect');
  const localSessionStatusPill = document.getElementById('localSessionStatusPill');
  const clearLocalSessionBtn = document.getElementById('clearLocalSessionBtn');
  const clearSessionOpenAiBtn = document.getElementById('clearSessionOpenAiBtn');
  const tuyaAccessIdInput = document.getElementById('tuyaAccessIdInput');
  const tuyaAccessSecretInput = document.getElementById('tuyaAccessSecretInput');
  const tuyaSecretSavedTag = document.getElementById('tuyaSecretSavedTag');
  const tuyaRegionSelect = document.getElementById('tuyaRegionSelect');
  const tuyaUidInput = document.getElementById('tuyaUidInput');
  const mhEmailInput = document.getElementById('mhEmailInput');
  const mhPasswordInput = document.getElementById('mhPasswordInput');
  const mhPasswordSavedTag = document.getElementById('mhPasswordSavedTag');
  const mhTokenInput = document.getElementById('mhTokenInput');
  const mhTokenSavedTag = document.getElementById('mhTokenSavedTag');
  const mhRegionSelect = document.getElementById('mhRegionSelect');
  const nestCastModalStatusPill = document.getElementById('nestCastModalStatusPill');
  const modalScanCastBtn = document.getElementById('modalScanCastBtn');
  const modalSelectBtBtn = document.getElementById('modalSelectBtBtn');
  const googleNestProjectIdInput = document.getElementById('googleNestProjectIdInput');
  const googleNestClientIdInput = document.getElementById('googleNestClientIdInput');
  const googleNestClientSecretInput = document.getElementById('googleNestClientSecretInput');
  const googleNestRefreshTokenInput = document.getElementById('googleNestRefreshTokenInput');
  const openAiKeyInput = document.getElementById('openAiKeyInput');
  const openAiKeySavedTag = document.getElementById('openAiKeySavedTag');
  const openAiVoiceModalSelect = document.getElementById('openAiVoiceModalSelect');

  // Smart Scenes Strip
  const smartScenesSection = document.getElementById('smartScenesSection');
  const smartScenesMeta = document.getElementById('smartScenesMeta');
  const smartScenesFilter = document.getElementById('smartScenesFilter');
  const syncSmartScenesBtn = document.getElementById('syncSmartScenesBtn');
  const smartScenesStrip = document.getElementById('smartScenesStrip');
  const toggleSceneVoiceLinksBtn = document.getElementById('toggleSceneVoiceLinksBtn');
  const sceneVoiceLinksPanel = document.getElementById('sceneVoiceLinksPanel');

  // OpenAI Voice Agent
  const aiVoiceOrb = document.getElementById('aiVoiceOrb');
  const aiStateBadge = document.getElementById('aiStateBadge');
  const aiModelSelect = document.getElementById('aiModelSelect');
  const aiVoiceSelect = document.getElementById('aiVoiceSelect');
  const aiMuteBtn = document.getElementById('aiMuteBtn');
  const aiVoiceToggleBtn = document.getElementById('aiVoiceToggleBtn');
  const aiQuickChips = document.getElementById('aiQuickChips');
  const aiTextForm = document.getElementById('aiTextForm');
  const aiTextInput = document.getElementById('aiTextInput');
  const aiSpeakFallbackChk = document.getElementById('aiSpeakFallbackChk');
  const aiPttBtn = document.getElementById('aiPttBtn');
  const aiSendBtn = document.getElementById('aiSendBtn');
  const aiLogFeed = document.getElementById('aiLogFeed');
  const aiRemoteAudio = document.getElementById('aiRemoteAudio');

  // Single-Viewport Cockpit Tabs & Voice Log Toggle
  const cockpitShell = document.querySelector('.cockpit-shell');
  const cockpitTabBtns = document.querySelectorAll('.cockpit-tab-btn');
  const cockpitPanes = document.querySelectorAll('.cockpit-pane');
  const dockSmartCount = document.getElementById('dockSmartCount');
  const dockCastDot = document.getElementById('dockCastDot');
  const aiToggleLogBtn = document.getElementById('aiToggleLogBtn');

  // V.O.S. Full-Screen Launcher, Pure Mode & Synchronized Voice Controls
  const vosPureDot = document.getElementById('vosPureDot');
  const togglePureControlsBtn = document.getElementById('togglePureControlsBtn');
  const togglePureVoiceBtn = document.getElementById('togglePureVoiceBtn');
  const togglePureDrawerBtn = document.getElementById('togglePureDrawerBtn');
  const drawerKeysBtn = document.getElementById('drawerKeysBtn');
  const drawerQrBtn = document.getElementById('drawerQrBtn');
  const drawerCloseBtn = document.getElementById('drawerCloseBtn');
  const vosSection = document.getElementById('vosSection');
  const openVosFullscreenBtn = document.getElementById('openVosFullscreenBtn');
  const vosExitFullscreenBtn = document.getElementById('vosExitFullscreenBtn');
  const vosVoiceStatusBadge = document.getElementById('vosVoiceStatusBadge');
  const vosMuteBtn = document.getElementById('vosMuteBtn');
  const vosReconnectVoiceBtn = document.getElementById('vosReconnectVoiceBtn');
  const vosToastContainer = document.getElementById('vosToastContainer');

  // QR Modal
  const openQrModalBtn = document.getElementById('openQrModalBtn');
  const closeQrModalBtn = document.getElementById('closeQrModalBtn');
  const qrModal = document.getElementById('qrModal');
  const lanAdapterGroup = document.getElementById('lanAdapterGroup');
  const networkInterfaceSelect = document.getElementById('networkInterfaceSelect');
  const qrContainer = document.getElementById('qrContainer');
  const shareUrlCode = document.getElementById('shareUrlCode');
  const qrHelpText = document.getElementById('qrHelpText');
  const toastContainer = document.getElementById('toastContainer');

  const LAN_BRIDGE_STORAGE_KEY = 'treva_lan_bridge_url_v1';
  let localLanBridgeBase = '';
  const LAN_BRIDGE_ACTIONS = new Set([
    'discover',
    'manual_device',
    'remove_device',
    'cast_start',
    'cast_stop',
    'cast_volume',
    'cast_sync',
    'cast_sync_all',
    'cast_media',
    'smart_scan_wifi',
    'set_lan_ip',
    'agent_chat',
    'realtime_tool'
  ]);

  function normalizeBridgeBase(raw) {
    const trimmed = String(raw || '').trim();
    if (!trimmed) return '';
    let url = trimmed.replace(/\/+(?:index\.php|api\.php)?$/i, '');
    if (!/^https?:\/\//i.test(url)) {
      url = 'http://' + url;
    }
    if (!/\/treva$/i.test(url)) {
      url += '/Treva';
    }
    return url + '/';
  }

  async function probeLocalLanBridge() {
    const candidates = [];
    try {
      const saved = window.localStorage ? window.localStorage.getItem(LAN_BRIDGE_STORAGE_KEY) : '';
      if (saved) candidates.push(normalizeBridgeBase(saved));
    } catch (_) {}
    candidates.push('http://localhost/Treva/', 'http://127.0.0.1/Treva/');

    const unique = Array.from(new Set(candidates.filter(Boolean)));
    for (const base of unique) {
      try {
        const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timer = ctrl ? setTimeout(() => ctrl.abort(), 1800) : null;
        const res = await fetch(`${base}api.php?action=info&sid=${encodeURIComponent(STREAM_SID)}`, {
          cache: 'no-store',
          signal: ctrl ? ctrl.signal : undefined
        });
        if (timer) clearTimeout(timer);
        if (!res.ok) continue;
        const info = await res.json();
        if (info && info.isLocalEnvironment) {
          localLanBridgeBase = base;
          return info;
        }
      } catch (_) {}
    }
    return null;
  }

  function apiUrl(action, extra = '') {
    const base = (localLanBridgeBase && LAN_BRIDGE_ACTIONS.has(action)) ? localLanBridgeBase : '';
    return `${base}api.php?action=${encodeURIComponent(action)}&sid=${encodeURIComponent(STREAM_SID)}${extra}`;
  }

  function showToast(message, type = 'info') {
    const targetContainer = (vosFullscreenOpen && vosToastContainer) ? vosToastContainer : toastContainer;
    if (!targetContainer) return;
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = message;
    targetContainer.appendChild(el);
    setTimeout(() => el.remove(), 4200);
  }

  function formatBytes(bytes) {
    if (!bytes || bytes < 1024) return `${bytes || 0} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function rgbToHex(r, g, b) {
    const toHex = (n) => Math.max(0, Math.min(255, Math.round(n || 0))).toString(16).padStart(2, '0');
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  }

  function hexToRgb(hex) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '');
    return m
      ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) }
      : { r: 255, g: 255, b: 255 };
  }

  function hslToRgb(h, s, l) {
    const k = (n) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return {
      r: Math.round(255 * f(0)),
      g: Math.round(255 * f(8)),
      b: Math.round(255 * f(4))
    };
  }

  function lockDomRefresh(ms = 2600) {
    interactionLockUntil = Math.max(interactionLockUntil, Date.now() + ms);
  }

  // Track user interaction inside dynamic grids so background polling never interrupts slider drags
  [devicesList, smartDevicesGrid].forEach((container) => {
    container.addEventListener('pointerdown', (e) => {
      if (e.target.closest('input, select, button')) lockDomRefresh(3200);
    });
    container.addEventListener('touchstart', (e) => {
      if (e.target.closest('input, select, button')) lockDomRefresh(3200);
    }, { passive: true });
    container.addEventListener('focusin', (e) => {
      if (e.target.closest('input, select')) lockDomRefresh(4000);
    });
  });

  function renderQr(url) {
    if (!url || typeof window.qrcode !== 'function') return;
    try {
      const qr = window.qrcode(0, 'M');
      qr.addData(url);
      qr.make();
      qrContainer.innerHTML = qr.createSvgTag(4, 2);
      shareUrlCode.textContent = url;
    } catch (_) {
      shareUrlCode.textContent = url;
    }
  }

  async function requestWakeLock() {
    if (!('wakeLock' in navigator) || wakeLockSentinel) return;
    try {
      wakeLockSentinel = await navigator.wakeLock.request('screen');
      wakeLockSentinel.addEventListener('release', () => {
        wakeLockSentinel = null;
      });
    } catch (_) {}
  }

  function releaseWakeLock() {
    if (wakeLockSentinel) {
      wakeLockSentinel.release().catch(() => {});
      wakeLockSentinel = null;
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && isCapturing) {
      requestWakeLock();
      if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume().catch(() => {});
      }
    }
  });

  // ===========================================================================
  // SERVER INFO & BACKGROUND STATE POLLING
  // ===========================================================================
  async function loadServerInfo() {
    try {
      const res = await fetch(apiUrl('info'), { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Server error');

      if (!data.isLocalEnvironment) {
        const bridgeInfo = await probeLocalLanBridge();
        if (bridgeInfo) {
          data.isLocalEnvironment = true;
          data.isLocalBridge = true;
          data.interfaces = bridgeInfo.interfaces || [];
          data.selectedLanIp = bridgeInfo.selectedLanIp || '';
          if (Array.isArray(bridgeInfo.devices) && bridgeInfo.devices.length > 0) {
            data.devices = bridgeInfo.devices;
          }
        }
      }

      serverInfo = data;
      serverDot.classList.add('online');
      if (vosPureDot) vosPureDot.classList.remove('offline');
      serverStatusText.textContent = data.isLocalBridge
        ? 'PHP Hosting + Local Cast Bridge'
        : (data.isLocalEnvironment ? 'PHP Local LAN Ready' : 'PHP Hosting Ready');

      if (data.isLocalEnvironment && Array.isArray(data.interfaces) && data.interfaces.length > 0) {
        lanAdapterGroup.classList.remove('hidden');
        networkInterfaceSelect.innerHTML = '';
        data.interfaces.forEach((iface) => {
          const opt = document.createElement('option');
          opt.value = iface.address;
          opt.textContent = `${iface.name}${iface.isVirtual ? ' (Virtual)' : ''}`;
          if (iface.address === data.selectedLanIp) opt.selected = true;
          networkInterfaceSelect.appendChild(opt);
        });
      } else {
        lanAdapterGroup.classList.add('hidden');
      }

      const shareUrl = data.isLocalEnvironment ? data.uiUrl : window.location.href;
      renderQr(shareUrl);
      if (qrHelpText) {
        qrHelpText.textContent = data.isLocalEnvironment
          ? 'Scan on your phone (same Wi-Fi) to open Treva Cast & control Cast / Smart lights.'
          : 'Scan to open this hosted Treva Cast URL on another device.';
      }

      const isDisplayMediaSupported =
        navigator.mediaDevices && typeof navigator.mediaDevices.getDisplayMedia === 'function';
      if (!window.isSecureContext) {
        insecureContextBanner.querySelector('strong').textContent = 'HTTPS Required for Screen Capture:';
        insecureContextBanner.querySelector('span').innerHTML =
          'Browsers only allow screen &amp; system audio capture on <strong>HTTPS</strong> or <code>localhost</code>. Open this app via HTTPS, or control devices remotely.';
        insecureContextBanner.classList.remove('hidden');
      } else if (!isDisplayMediaSupported) {
        insecureContextBanner.querySelector('strong').textContent = 'Mobile Browser Screen Share Notice:';
        insecureContextBanner.querySelector('span').innerHTML =
          'This mobile browser does not expose <code>getDisplayMedia</code> screen capture. Capture from a Desktop/Android Chrome tab or use this device as a Remote Control.';
        insecureContextBanner.classList.remove('hidden');
      }

      if (data.streamStatus) updateTelemetry(data.streamStatus);
      let activePayload = data;
      if (!data.sessionHydrated) {
        const localVault = readLocalVault();
        if (hasMeaningfulVault(localVault)) {
          const restored = await hydrateServerSession(localVault, true);
          if (restored && restored.ok) {
            activePayload = { ...data, ...restored };
            if (data.isLocalBridge && Array.isArray(data.devices) && data.devices.length > 0) {
              activePayload.devices = data.devices;
            }
          }
        }
      }

      if (activePayload.smartConfig) {
        smartConfig = activePayload.smartConfig;
        populateSmartConfigForm();
      }
      if (Array.isArray(activePayload.sceneLinks)) {
        smartSceneLinks = activePayload.sceneLinks;
      }
      if (activePayload.sliceScenes && typeof activePayload.sliceScenes === 'object') {
        sliceSceneMap = activePayload.sliceScenes;
      }
      if (activePayload.smartScenes) {
        smartScenes = activePayload.smartScenes;
        renderSmartScenes();
      }
      if (Array.isArray(activePayload.smartDevices)) {
        smartDevices = activePayload.smartDevices;
        renderSmartDevices(true);
      }

      if (data.isLocalEnvironment) {
        localScanControls.classList.remove('hidden');
        scanSmartWifiBtn.classList.remove('hidden');
        devices = activePayload.devices || [];
        renderDevices(true);
        if (!devices || devices.length === 0) {
          discoverLocalDevices(true);
        }
      } else {
        localScanControls.classList.add('hidden');
        scanSmartWifiBtn.classList.add('hidden');
        renderRemoteHostingNotice();
      }
      updateLocalSessionStatusUi();
      syncVosState(data.streamStatus || null);
      if (smartConfig && smartConfig.tuya && smartConfig.tuya.configured) {
        syncSmartScenes(true);
      }
    } catch (err) {
      serverDot.classList.remove('online');
      if (vosPureDot) vosPureDot.classList.add('offline');
      serverStatusText.textContent = 'Connection Error';
      console.error('Info error:', err);
    }
  }

  async function discoverLocalDevices(silent = false) {
    try {
      if (!silent) showToast('Scanning Wi-Fi for Google Nest & Cast devices...');
      const res = await fetch(apiUrl('discover'), { cache: 'no-store' });
      const data = await res.json();
      if (data.remoteHosting) {
        renderRemoteHostingNotice();
        return;
      }
      if (Array.isArray(data.devices)) {
        devices = data.devices;
        renderDevices(true);
        persistSessionVaultFromResponse(data);
        syncVosState();
      }
    } catch (err) {
      if (!silent) showToast('LAN scan failed: ' + err.message, 'error');
    }
  }

  function startStatePolling() {
    if (pollTimer) clearInterval(pollTimer);
    // Refresh live YouTube Music / YouTube / Cast media status from Chromecast & Nest devices
    if (!startStatePolling.mediaTimer) {
      startStatePolling.mediaTimer = setInterval(async () => {
        if (document.hidden || !serverInfo || !serverInfo.isLocalEnvironment) return;
        if (Date.now() < interactionLockUntil) return;
        try {
          const res = await fetch(apiUrl('cast_sync_all', '&fast=1'), { cache: 'no-store' });
          if (!res.ok) return;
          const data = await res.json();
          if (Array.isArray(data.devices) && data.devices.length && Date.now() >= interactionLockUntil) {
            devices = data.devices;
            renderDevices(false);
            syncVosState();
          }
        } catch (_) {}
      }, 7000);
    }
    pollTimer = setInterval(async () => {
      if (hydratePromise) return;
      try {
        const res = await fetch(apiUrl('state'), { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        serverDot.classList.add('online');
        if (vosPureDot) vosPureDot.classList.remove('offline');
        if (data.streamStatus) updateTelemetry(data.streamStatus);

        if (data.sessionHydrated === false) {
          const localVault = readLocalVault();
          if (hasMeaningfulVault(localVault)) {
            const restored = await hydrateServerSession(localVault, true);
            if (restored && restored.ok) {
              if (restored.smartConfig) {
                smartConfig = restored.smartConfig;
                populateSmartConfigForm();
              }
              applySyncedScenesData(restored);
              if (Array.isArray(restored.devices)) {
                devices = restored.devices;
                renderDevices(true);
              }
              return;
            }
          }
        }

        if (Date.now() < interactionLockUntil) return;

        let changed = false;
        if (serverInfo && serverInfo.isLocalEnvironment && !serverInfo.isLocalBridge && Array.isArray(data.devices)) {
          devices = data.devices;
          renderDevices(false);
          changed = true;
        }
        if (Array.isArray(data.smartDevices)) {
          smartDevices = data.smartDevices;
          renderSmartDevices(false);
          changed = true;
        }
        if (changed || data.streamStatus) syncVosState(data.streamStatus || null);
      } catch (_) {
        serverDot.classList.remove('online');
        if (vosPureDot) vosPureDot.classList.add('offline');
      }
    }, 1500);
  }

  let lastVosStreamStatus = null;
  function syncVosState(streamStatus = null) {
    if (streamStatus) {
      lastVosStreamStatus = {
        ...streamStatus,
        listeners: {
          mp3: streamStatus.mp3Listeners || 0,
          webm: streamStatus.webmListeners || 0
        }
      };
    }
    if (window.TrevaVos) {
      window.TrevaVos.updateState({
        smartDevices,
        castDevices: devices,
        bleDevices,
        smartScenes,
        smartSceneLinks,
        sliceScenes: sliceSceneMap,
        smartConfig,
        serverInfo,
        streamStatus: lastVosStreamStatus,
        captureState: {
          active: Boolean(isCapturing),
          audioLevel: lastCaptureAudioLevel,
          mode: streamMode
        },
        btOutput: {
          active: Boolean(btRoutingActive),
          label: btSinkLabel
        },
        castSdk: {
          active: Boolean(activeCastSession),
          device: activeCastSession && activeCastSession.getCastDevice
            ? ((activeCastSession.getCastDevice() && activeCastSession.getCastDevice().friendlyName) || 'Google Cast')
            : ''
        },
        ambientSyncActive: Boolean(ambientSyncCheckbox && ambientSyncCheckbox.checked)
      });
    }
    if (typeof scheduleRealtimeInstructionSync === 'function') {
      scheduleRealtimeInstructionSync();
    }
  }

  function updateTelemetry(status) {
    if (!status) return;
    telemetryBytes.textContent = formatBytes(status.bytesReceived || 0);
    const totalListeners = (status.mp3Listeners || 0) + (status.webmListeners || 0);
    telemetryListeners.textContent = `${totalListeners} (${status.mp3Listeners || 0} Audio, ${status.webmListeners || 0} Video)`;

    if (isCapturing || status.isStreaming) {
      const modeLabel = (isCapturing ? streamMode : status.streamMode || 'audio').toUpperCase();
      captureStateBadge.textContent = `LIVE (${modeLabel})`;
      captureStateBadge.className = 'badge badge-live';
    } else {
      captureStateBadge.textContent = 'STANDBY';
      captureStateBadge.className = 'badge badge-idle';
    }
    if (dockCastDot) {
      dockCastDot.classList.toggle('hidden', !(isCapturing || status.isStreaming || activeCastSession));
    }
    syncVosState(status);
  }

  function setStreamMode(mode, silent = false) {
    streamMode = mode === 'video' ? 'video' : 'audio';
    modeAudioBtn.classList.toggle('active', streamMode === 'audio');
    modeVideoBtn.classList.toggle('active', streamMode === 'video');

    if (isCapturing && displayStream) {
      if (streamMode === 'video') {
        if (displayStream.getVideoTracks().length > 0) {
          startWebmRecorder(displayStream);
        } else if (!silent) {
          showToast('Mic-only capture has no screen track. Stop capture and click "Start Screen & Sound Capture" for video.', 'info');
          return;
        }
      } else {
        stopWebmRecorder();
      }
      if (!silent) {
        showToast(`Stream format set to ${streamMode === 'audio' ? 'Sound Only (MP3)' : 'Screen + Sound (WebM + MP3)'}`);
      }
    }
  }

  modeAudioBtn.addEventListener('click', () => setStreamMode('audio'));
  modeVideoBtn.addEventListener('click', () => setStreamMode('video'));

  // ===========================================================================
  // ORDERED BINARY CHUNK UPLOAD QUEUE (With Timeouts & Sample-Rate Tracking)
  // ===========================================================================
  function enqueueChunk(fmt, uint8OrBlob, isInit = false, gen = 0) {
    if (!isCapturing) return;
    const queue = uploadQueues[fmt];

    if (fmt === 'webm') {
      if (gen !== webmGen) return;
      // Never splice middle clusters out of a WebM stream — cycle clean keyframe instead
      if (queue.items.length > 18 && !keyframeCycling) {
        queue.items = [];
        cycleMediaRecorderForKeyframe();
        return;
      }
    } else if (queue.items.length > 22) {
      // MP3 frames are independent, trim excess backlog to preserve low latency
      queue.items.splice(0, queue.items.length - 8);
    }

    queue.items.push({ body: uint8OrBlob, isInit, gen });
    drainQueue(fmt);
  }

  async function postChunkWithTimeout(url, body, timeoutMs = 8000) {
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
    try {
      return await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body,
        signal: ctrl ? ctrl.signal : undefined
      });
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function drainQueue(fmt) {
    const queue = uploadQueues[fmt];
    if (queue.busy || queue.items.length === 0) return;
    queue.busy = true;

    try {
      while (queue.items.length > 0 && isCapturing) {
        const item = queue.items.shift();
        if (fmt === 'webm' && item.gen !== webmGen) continue;

        const srPart = fmt === 'mp3' ? `&sr=${mp3SampleRate}` : '';
        const url = apiUrl('push', `&fmt=${fmt}&init=${item.isInit ? 1 : 0}${srPart}`);

        let res = null;
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            res = await postChunkWithTimeout(url, item.body, 8000);
            if (res && res.ok) break;
          } catch (_) {
            if (attempt === 0) await new Promise((r) => setTimeout(r, 120));
          }
        }

        if (!res || !res.ok) {
          if (fmt === 'webm' && !keyframeCycling) {
            queue.items = [];
            cycleMediaRecorderForKeyframe();
            break;
          }
          continue;
        }

        queue.uploadedCount = (queue.uploadedCount || 0) + 1;

        if (fmt === 'webm') {
          const json = await res.json().catch(() => null);
          if (json && json.keyframeReset && !keyframeCycling) {
            cycleMediaRecorderForKeyframe();
          }
        }
      }
    } finally {
      queue.busy = false;
      if (queue.items.length > 0 && isCapturing) {
        drainQueue(fmt);
      }
    }
  }

  async function waitForUploadedChunk(fmt, timeoutMs = 2800) {
    const start = Date.now();
    const queue = uploadQueues[fmt];
    while ((Date.now() - start) < timeoutMs && isCapturing) {
      if (queue && queue.uploadedCount > 0) return true;
      await new Promise((r) => setTimeout(r, 80));
    }
    return Boolean(queue && queue.uploadedCount > 0);
  }

  // ===========================================================================
  // IN-BROWSER AUDIOWORKLET MP3 + WEBM CAPTURE (Zero Server Executables)
  // ===========================================================================
  function sendStreamHeartbeat() {
    if (!isCapturing) return;
    fetch(apiUrl('stream_heartbeat'), { method: 'POST', keepalive: true }).catch(() => {});
  }

  function startHeartbeat() {
    stopHeartbeat();
    heartbeatTimer = setInterval(sendStreamHeartbeat, 8000);
  }

  function stopHeartbeat() {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && isCapturing) {
      if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume().catch(() => {});
      }
      sendStreamHeartbeat();
    }
  });

  async function startBrowserCapture(sourceType = 'display') {
    if (isCapturing) return true;
    if (captureStarting) return false;

    const isMic = sourceType === 'mic';
    if (isMic) {
      if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
        showToast('Microphone capture requires HTTPS or localhost in this browser.', 'error');
        return false;
      }
    } else if (!navigator.mediaDevices || typeof navigator.mediaDevices.getDisplayMedia !== 'function') {
      showToast('Screen capture requires HTTPS or localhost in this browser. Try Mic / Audio Only instead.', 'error');
      return false;
    }

    captureStarting = true;
    try {
      let stream;
      if (isMic) {
        setStreamMode('audio', true);
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
            channelCount: 2
          },
          video: false
        });
      } else {
        const constraints = {
          video:
            streamMode === 'audio'
              ? { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 10, max: 15 } }
              : { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 24, max: 30 } },
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
            channelCount: 2
          },
          systemAudio: 'include',
          selfBrowserSurface: 'exclude',
          surfaceSwitching: 'include'
        };
        stream = await navigator.mediaDevices.getDisplayMedia(constraints);
      }

      displayStream = stream;
      isCapturing = true;
      userStoppedSdkCast = false;
      sdkRecoverCount = 0;
      uploadQueues.mp3.items = [];
      uploadQueues.mp3.uploadedCount = 0;
      uploadQueues.webm.items = [];
      uploadQueues.webm.uploadedCount = 0;
      requestWakeLock();
      startHeartbeat();

      await fetch(apiUrl('stream_start'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: streamMode })
      });

      const videoTracks = stream.getVideoTracks();
      const audioTracks = stream.getAudioTracks();

      screenPreview.srcObject = videoTracks.length > 0 ? stream : null;
      if (videoTracks.length > 0) {
        previewPlaceholder.classList.add('hidden');
      } else {
        previewPlaceholder.classList.add('hidden');
      }
      trackBadges.classList.remove('hidden');

      videoTrackPill.textContent = videoTracks.length > 0 ? 'Video: Active' : 'Video: Off (Audio Mode)';
      videoTrackPill.className = `track-pill ${videoTracks.length > 0 ? 'ok' : 'idle'}`;

      if (audioTracks.length > 0) {
        audioTrackPill.textContent = isMic ? 'Mic / Line Audio: Active' : 'System Audio: Active';
        audioTrackPill.className = 'track-pill ok';
        noAudioWarning.classList.add('hidden');
        await startAudioPipeline(stream);
      } else {
        audioTrackPill.textContent = 'System Audio: Missing!';
        audioTrackPill.className = 'track-pill warn';
        noAudioWarning.classList.remove('hidden');
        showToast('Warning: No system audio track detected. Enable "Also share system audio" in the prompt.', 'error');
      }

      const handleTrackEnded = () => {
        if (!isCapturing || !displayStream) return;
        const allEnded = displayStream.getTracks().every((t) => t.readyState === 'ended');
        const videoEndedInVideoMode = streamMode === 'video' && videoTracks.every((t) => t.readyState === 'ended');
        if (allEnded || videoEndedInVideoMode) {
          stopCapture();
        }
      };
      stream.getTracks().forEach((t) => t.addEventListener('ended', handleTrackEnded));

      if (streamMode === 'video' && videoTracks.length > 0) {
        startWebmRecorder(stream);
      }

      startCaptureBtn.classList.add('hidden');
      if (startMicCaptureBtn) startMicCaptureBtn.classList.add('hidden');
      stopCaptureBtn.classList.remove('hidden');
      captureStateBadge.textContent = `LIVE (${streamMode.toUpperCase()})`;
      captureStateBadge.className = 'badge badge-live';

      if (window.TrevaVos) {
        if (typeof window.TrevaVos.recordSystemUsage === 'function') {
          window.TrevaVos.recordSystemUsage(
            'cast',
            isMic ? 'Mic Capture Started' : `Screen Capture (${streamMode})`,
            { boost: 0.42 }
          );
        }
        syncVosState();
      }

      showToast(
        isMic ? 'Live Mic / Audio capture & MP3 encoder started!' : 'Live screen & AudioWorklet MP3 encoder started!',
        'success'
      );
      return true;
    } catch (err) {
      if (err.name !== 'NotAllowedError') {
        showToast(`Could not start capture: ${err.message}`, 'error');
      }
      return false;
    } finally {
      captureStarting = false;
    }
  }

  async function startAudioPipeline(stream) {
    stopAudioPipeline();
    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length === 0) return;

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    try {
      audioCtx = new AudioContextClass({ sampleRate: 44100, latencyHint: 'playback' });
    } catch (_) {
      audioCtx = new AudioContextClass();
    }

    if (audioCtx.state === 'suspended') {
      await audioCtx.resume().catch(() => {});
    }
    audioCtx.onstatechange = () => {
      if (isCapturing && audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume().catch(() => {});
      }
    };

    mp3SampleRate = audioCtx.sampleRate || 44100;

    mp3Worker = new Worker('assets/js/mp3-worker.js');
    mp3Worker.postMessage({ type: 'init', sampleRate: mp3SampleRate, bitrate: 192 });
    mp3Worker.onmessage = (e) => {
      if (e.data && e.data.type === 'mp3' && e.data.data) {
        enqueueChunk('mp3', new Uint8Array(e.data.data), false, 0);
      }
    };

    const audioStream = new MediaStream(audioTracks);
    audioSourceNode = audioCtx.createMediaStreamSource(audioStream);

    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 128;
    audioSourceNode.connect(analyser);

    const silentOut = audioCtx.createGain();
    silentOut.gain.value = 0;

    let workletActive = false;
    if (audioCtx.audioWorklet && typeof window.AudioWorkletNode === 'function') {
      try {
        await audioCtx.audioWorklet.addModule('assets/js/pcm-worklet.js');
        workletNode = new AudioWorkletNode(audioCtx, 'treva-pcm-processor', {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [2]
        });
        workletNode.port.onmessage = (e) => {
          if (!isCapturing || !mp3Worker || !e.data) return;
          const { left, right } = e.data;
          mp3Worker.postMessage({ type: 'pcm', left, right }, [left, right]);
        };
        audioSourceNode.connect(workletNode);
        workletNode.connect(silentOut);
        silentOut.connect(audioCtx.destination);
        workletActive = true;
      } catch (err) {
        console.warn('AudioWorklet fallback to ScriptProcessor:', err);
      }
    }

    if (!workletActive) {
      scriptProcessor = audioCtx.createScriptProcessor(4096, 2, 2);
      audioSourceNode.connect(scriptProcessor);
      scriptProcessor.connect(silentOut);
      silentOut.connect(audioCtx.destination);
      scriptProcessor.onaudioprocess = (event) => {
        if (!isCapturing || !mp3Worker) return;
        const input = event.inputBuffer;
        const left = new Float32Array(input.getChannelData(0));
        const right =
          input.numberOfChannels > 1 ? new Float32Array(input.getChannelData(1)) : new Float32Array(left);
        mp3Worker.postMessage(
          { type: 'pcm', left: left.buffer, right: right.buffer },
          [left.buffer, right.buffer]
        );
      };
    }

    if (btRoutingActive && btSinkId) {
      await applyBtAudioRoute();
    }

    drawVisualizer();
  }

  function drawVisualizer() {
    if (!analyser) return;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    const ctx = audioVisualizer.getContext('2d');

    function frame() {
      if (!analyser) return;
      animFrameId = requestAnimationFrame(frame);
      analyser.getByteFrequencyData(dataArray);
      const width = audioVisualizer.width;
      const height = audioVisualizer.height;
      ctx.clearRect(0, 0, width, height);

      const barWidth = (width / bufferLength) * 1.4;
      let x = 0;
      let energySum = 0;
      for (let i = 0; i < bufferLength; i++) {
        const v = dataArray[i] / 255;
        energySum += v;
        const barHeight = Math.max(3, v * (height - 16));
        const grad = ctx.createLinearGradient(0, height, 0, height - barHeight);
        grad.addColorStop(0, 'rgba(99, 102, 241, 0.85)');
        grad.addColorStop(1, 'rgba(16, 185, 129, 0.95)');
        ctx.fillStyle = grad;
        ctx.fillRect(x, height - barHeight, barWidth - 2, barHeight);
        x += barWidth;
      }

      lastCaptureAudioLevel = Math.max(0, Math.min(1, (energySum / Math.max(1, bufferLength)) * 1.65));
      const nowAudioPush = Date.now();
      if (window.TrevaVos && typeof window.TrevaVos.setCaptureAudioLevel === 'function' && (nowAudioPush - lastVosAudioPushAt) >= 140) {
        lastVosAudioPushAt = nowAudioPush;
        window.TrevaVos.setCaptureAudioLevel(lastCaptureAudioLevel, isCapturing);
      }

      if (ambientSyncCheckbox && ambientSyncCheckbox.checked && isCapturing) {
        maybeSyncAmbientLights(dataArray);
      }
    }
    frame();
  }

  function stopAudioPipeline() {
    if (animFrameId) {
      cancelAnimationFrame(animFrameId);
      animFrameId = null;
    }
    analyser = null;
    if (btDestNode) {
      try {
        btDestNode.disconnect();
      } catch (_) {}
      btDestNode = null;
    }
    try {
      btAudioSink.pause();
      btAudioSink.srcObject = null;
    } catch (_) {}

    if (workletNode) {
      try {
        workletNode.port.onmessage = null;
        workletNode.disconnect();
      } catch (_) {}
      workletNode = null;
    }
    if (scriptProcessor) {
      try {
        scriptProcessor.onaudioprocess = null;
        scriptProcessor.disconnect();
      } catch (_) {}
      scriptProcessor = null;
    }
    if (audioSourceNode) {
      try {
        audioSourceNode.disconnect();
      } catch (_) {}
      audioSourceNode = null;
    }
    if (mp3Worker) {
      try {
        mp3Worker.postMessage({ type: 'stop' });
        mp3Worker.terminate();
      } catch (_) {}
      mp3Worker = null;
    }
    if (audioCtx) {
      try {
        audioCtx.onstatechange = null;
        audioCtx.close();
      } catch (_) {}
      audioCtx = null;
    }
    const ctx = audioVisualizer.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, audioVisualizer.width, audioVisualizer.height);
  }

  function pickWebmMimeType(hasAudio = true) {
    const types = hasAudio
      ? [
          'video/webm;codecs=vp8,opus',
          'video/webm;codecs=h264,opus',
          'video/webm;codecs=vp9,opus',
          'video/webm'
        ]
      : [
          'video/webm;codecs=vp8',
          'video/webm;codecs=h264',
          'video/webm;codecs=vp9',
          'video/webm'
        ];
    for (const t of types) {
      if (window.MediaRecorder && MediaRecorder.isTypeSupported(t)) return t;
    }
    return '';
  }

  function startWebmRecorder(stream) {
    stopWebmRecorder();
    if (!window.MediaRecorder || !stream || stream.getVideoTracks().length === 0) return;
    const hasAudio = stream.getAudioTracks().length > 0;
    const mimeType = pickWebmMimeType(hasAudio);
    const options = mimeType ? { mimeType } : {};
    options.videoBitsPerSecond = 2000000;
    if (hasAudio) options.audioBitsPerSecond = 128000;

    const myGen = ++webmGen;
    let firstOfGen = true;
    let recorder;
    try {
      recorder = new MediaRecorder(stream, options);
    } catch (_) {
      recorder = new MediaRecorder(stream);
    }
    mediaRecorder = recorder;

    recorder.ondataavailable = (e) => {
      if (!isCapturing || myGen !== webmGen) return;
      if (e.data && e.data.size > 0) {
        const isInit = firstOfGen;
        firstOfGen = false;
        enqueueChunk('webm', e.data, isInit, myGen);
      }
    };
    recorder.onerror = (ev) => {
      console.warn('WebM MediaRecorder error:', ev && ev.error ? ev.error : ev);
    };

    recorder.start(250);
  }

  function stopWebmRecorder() {
    webmGen++;
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      try {
        mediaRecorder.ondataavailable = null;
        mediaRecorder.stop();
      } catch (_) {}
    }
    mediaRecorder = null;
  }

  function cycleMediaRecorderForKeyframe() {
    if (!isCapturing || streamMode !== 'video' || !displayStream || keyframeCycling) return;
    keyframeCycling = true;
    uploadQueues.webm.items = [];
    startWebmRecorder(displayStream);
    setTimeout(() => {
      keyframeCycling = false;
    }, 650);
  }

  async function stopCapture() {
    isCapturing = false;
    userStoppedSdkCast = true;
    stopHeartbeat();
    if (sdkRecoverTimer) {
      clearTimeout(sdkRecoverTimer);
      sdkRecoverTimer = null;
    }
    uploadQueues.mp3.items = [];
    uploadQueues.mp3.uploadedCount = 0;
    uploadQueues.webm.items = [];
    uploadQueues.webm.uploadedCount = 0;
    releaseWakeLock();

    stopWebmRecorder();
    stopAudioPipeline();

    if (displayStream) {
      displayStream.getTracks().forEach((t) => t.stop());
      displayStream = null;
    }

    screenPreview.srcObject = null;
    previewPlaceholder.classList.remove('hidden');
    trackBadges.classList.add('hidden');
    noAudioWarning.classList.add('hidden');

    startCaptureBtn.classList.remove('hidden');
    if (startMicCaptureBtn) startMicCaptureBtn.classList.remove('hidden');
    stopCaptureBtn.classList.add('hidden');
    captureStateBadge.textContent = 'STANDBY';
    captureStateBadge.className = 'badge badge-idle';

    lastCaptureAudioLevel = 0;
    if (window.TrevaVos) {
      if (typeof window.TrevaVos.setCaptureAudioLevel === 'function') {
        window.TrevaVos.setCaptureAudioLevel(0, false);
      }
      if (typeof window.TrevaVos.recordSystemUsage === 'function') {
        window.TrevaVos.recordSystemUsage('cast', 'Capture Stopped', { damp: true, boost: 0 });
      }
      syncVosState();
    }

    await fetch(apiUrl('stream_stop'), { method: 'POST', keepalive: true }).catch(() => {});
  }

  startCaptureBtn.addEventListener('click', () => startBrowserCapture('display'));
  if (startMicCaptureBtn) {
    startMicCaptureBtn.addEventListener('click', () => startBrowserCapture('mic'));
  }
  stopCaptureBtn.addEventListener('click', () => stopCapture());

  // ===========================================================================
  // BLUETOOTH / DIRECT AUDIO OUTPUT ROUTING (Zero-Buffering Speaker Fallback)
  // ===========================================================================
  async function applyBtAudioRoute() {
    if (!isCapturing || !audioCtx || !audioSourceNode || !btSinkId || !btRoutingActive) return;
    try {
      if (!btDestNode) {
        btDestNode = audioCtx.createMediaStreamDestination();
        audioSourceNode.connect(btDestNode);
      }
      btAudioSink.srcObject = btDestNode.stream;
      btAudioSink.muted = false;
      btAudioSink.volume = 1.0;
      if (typeof btAudioSink.setSinkId === 'function') {
        await btAudioSink.setSinkId(btSinkId);
      }
      await btAudioSink.play();
      btOutputStatus.textContent = `Routing live audio to: ${btSinkLabel}`;
      stopBtAudioBtn.classList.remove('hidden');
      if (window.TrevaVos) {
        if (typeof window.TrevaVos.recordSystemUsage === 'function') {
          window.TrevaVos.recordSystemUsage('cast', `BT Audio -> ${btSinkLabel}`, { boost: 0.24, countEvent: false });
        }
        syncVosState();
      }
    } catch (err) {
      showToast(`Bluetooth audio routing failed: ${err.message}`, 'error');
    }
  }

  function showAudioOutputPickerModal(outputs) {
    return new Promise((resolve) => {
      const backdrop = document.createElement('div');
      backdrop.className = 'modal-backdrop';
      const buttonsHtml = outputs
        .map(
          (d, idx) =>
            `<button type="button" class="btn btn-secondary" data-idx="${idx}" style="justify-content:flex-start;text-align:left;">${escapeHtml(
              d.label || `Audio Output ${idx + 1}`
            )}</button>`
        )
        .join('');

      backdrop.innerHTML = `
        <div class="modal-card" style="max-width:440px;">
          <div class="modal-header">
            <h3>Select Bluetooth / Audio Output</h3>
            <button type="button" class="icon-close-btn" id="btPickClose">&times;</button>
          </div>
          <p class="help-hint" style="margin-bottom:12px;">Choose your paired Bluetooth Google Nest or speaker (avoid Default to prevent echo).</p>
          <div style="display:flex;flex-direction:column;gap:8px;max-height:280px;overflow-y:auto;">${buttonsHtml}</div>
        </div>
      `;
      document.body.appendChild(backdrop);

      const finish = (choice) => {
        backdrop.remove();
        resolve(choice);
      };

      backdrop.querySelector('#btPickClose').addEventListener('click', () => finish(null));
      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) finish(null);
      });
      backdrop.querySelectorAll('button[data-idx]').forEach((btn) => {
        btn.addEventListener('click', () => finish(outputs[Number(btn.dataset.idx)]));
      });
    });
  }

  selectBtAudioBtn.addEventListener('click', async () => {
    if (typeof btAudioSink.setSinkId !== 'function') {
      showToast('This browser does not support setSinkId audio output routing.', 'error');
      return;
    }

    try {
      let picked = null;
      if (navigator.mediaDevices && typeof navigator.mediaDevices.selectAudioOutput === 'function') {
        picked = await navigator.mediaDevices.selectAudioOutput();
      } else if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
        let allDevs = await navigator.mediaDevices.enumerateDevices();
        let outputs = allDevs.filter((d) => d.kind === 'audiooutput');
        if (!outputs.some((d) => d.label)) {
          // One-time mic prompt unlocks OS output device labels in Chromium
          try {
            const temp = await navigator.mediaDevices.getUserMedia({ audio: true });
            temp.getTracks().forEach((t) => t.stop());
            allDevs = await navigator.mediaDevices.enumerateDevices();
            outputs = allDevs.filter((d) => d.kind === 'audiooutput');
          } catch (_) {}
        }
        if (outputs.length === 0) {
          showToast('No audio output devices found. Pair your Bluetooth speaker in OS settings first.', 'error');
          return;
        }
        picked = await showAudioOutputPickerModal(outputs);
      }

      if (!picked || !picked.deviceId) return;
      btSinkId = picked.deviceId;
      btSinkLabel = picked.label || 'Bluetooth / External Speaker';
      btRoutingActive = true;
      btOutputStatus.textContent = isCapturing
        ? `Routing live audio to: ${btSinkLabel}`
        : `Selected Bluetooth output: ${btSinkLabel} (starts automatically on Capture)`;
      stopBtAudioBtn.classList.remove('hidden');

      if (picked.deviceId === 'default') {
        showToast('Warning: Default output selected; pick your Bluetooth speaker to avoid echo.', 'info');
      } else {
        showToast(`Bluetooth output set to ${btSinkLabel}`, 'success');
      }

      if (isCapturing) {
        await applyBtAudioRoute();
      }
      if (window.TrevaVos) {
        if (typeof window.TrevaVos.recordSystemUsage === 'function') {
          window.TrevaVos.recordSystemUsage('cast', `BT Output: ${btSinkLabel}`, { boost: 0.34 });
        }
        syncVosState();
      }
    } catch (err) {
      if (err && err.name !== 'NotAllowedError' && err.name !== 'AbortError') {
        showToast(`Bluetooth output error: ${err.message}`, 'error');
      }
    }
  });

  stopBtAudioBtn.addEventListener('click', () => {
    btRoutingActive = false;
    btSinkId = '';
    btSinkLabel = '';
    try {
      btAudioSink.pause();
      btAudioSink.srcObject = null;
    } catch (_) {}
    if (btDestNode) {
      try {
        btDestNode.disconnect();
      } catch (_) {}
      btDestNode = null;
    }
    stopBtAudioBtn.classList.add('hidden');
    btOutputStatus.textContent = 'Route captured sound directly to a Bluetooth-paired Google Nest or speaker';
    if (window.TrevaVos) {
      if (typeof window.TrevaVos.recordSystemUsage === 'function') {
        window.TrevaVos.recordSystemUsage('cast', 'BT Audio Stopped', { damp: true, boost: 0 });
      }
      syncVosState();
    }
    showToast('Bluetooth audio routing stopped');
  });

  // ===========================================================================
  // LOCAL WIFI GOOGLE NEST / CAST LIST (Diffed Rendering)
  // ===========================================================================
  function renderRemoteHostingNotice() {
    const savedBridge = (window.localStorage && window.localStorage.getItem(LAN_BRIDGE_STORAGE_KEY)) || 'http://localhost/Treva';
    const html = `
      <div class="empty-devices">
        <p><strong>Remote Hosting Mode (No Local LAN Bridge Detected)</strong></p>
        <span class="empty-sub">Google Nest &amp; Chromecast only listen on your local home Wi-Fi (port 8009 / mDNS). Start XAMPP locally (<code>http://localhost/Treva</code>) or enter your PC's LAN bridge URL below to list and control them from this hosted page:</span>
        <div class="cast-cmd-row" style="margin-top:10px;max-width:420px;margin-left:auto;margin-right:auto;">
          <input type="text" class="lan-bridge-input" value="${escapeHtml(savedBridge)}" placeholder="http://localhost/Treva or http://192.168.100.24/Treva" />
          <button type="button" class="btn btn-primary btn-xs lan-bridge-connect-btn">Connect LAN Bridge</button>
        </div>
      </div>
    `;
    [devicesList, nestCastDevicesList].forEach((container) => {
      if (!container) return;
      container.innerHTML = html;
      const btn = container.querySelector('.lan-bridge-connect-btn');
      const inp = container.querySelector('.lan-bridge-input');
      if (btn && inp) {
        btn.addEventListener('click', async () => {
          const val = inp.value.trim();
          if (!val) return;
          try {
            if (window.localStorage) window.localStorage.setItem(LAN_BRIDGE_STORAGE_KEY, val);
          } catch (_) {}
          showToast('Probing local LAN Cast bridge...', 'info');
          await loadServerInfo();
          if (localLanBridgeBase) {
            showToast('Connected to Local LAN Cast Bridge (' + localLanBridgeBase + ')', 'success');
          } else {
            showToast('Could not reach local XAMPP bridge at ' + val + '. Make sure Apache is running.', 'error');
          }
        });
      }
    });
  }

  const expandedCastCmdDevs = new Set();

  function updateSmartAndCastCounters() {
    const wifiLen = Array.isArray(smartDevices) ? smartDevices.length : 0;
    const bleLen = Array.isArray(bleDevices) ? bleDevices.length : 0;
    const castLen = Array.isArray(devices) ? devices.length : 0;
    if (dockSmartCount) {
      dockSmartCount.textContent = String(wifiLen + bleLen + castLen);
    }
    if (smartCastHubMeta) {
      if (castLen === 0) {
        smartCastHubMeta.textContent = 'Zero-Key LAN Ready';
      } else {
        const activeCount = (devices || []).filter((d) =>
          ['PLAYING', 'BUFFERING', 'PAUSED', 'ACTIVE'].includes(String(d.status || '').toUpperCase())
        ).length;
        smartCastHubMeta.textContent = activeCount > 0
          ? `${castLen} device(s) • ${activeCount} active`
          : `${castLen} device(s) online`;
      }
    }
    if (nestCastModalStatusPill) {
      nestCastModalStatusPill.textContent = castLen > 0
        ? `Cast V2 LAN Active • ${castLen} device(s)`
        : 'Cast V2 LAN Ready';
    }
  }

  function renderCastCommandDrawer(dev) {
    const id = escapeHtml(dev.id);
    const isExpanded = expandedCastCmdDevs.has(dev.id);
    const isDisplay = dev.kind === 'display' || /chromecast|tv|hub/i.test(String(dev.model || dev.variant || ''));
    return `
      <div class="cast-cmd-drawer ${isExpanded ? '' : 'hidden'}" data-cmd-drawer="${id}">
        <div class="cast-cmd-row">
          <input type="text" class="cast-web-query-input" data-id="${id}" placeholder="Ask gpt-6-luna to find &amp; play (e.g. Latest Wiz Khalifa album)..." />
          <button type="button" class="btn btn-primary btn-xs cast-web-query-btn" data-id="${id}">Find &amp; Play</button>
        </div>
        <div class="cast-cmd-row">
          <input type="text" class="cast-tts-input" data-id="${id}" placeholder="Speak / announce on ${escapeHtml(dev.name)}..." />
          <button type="button" class="btn btn-secondary btn-xs cast-tts-send-btn" data-id="${id}">Speak</button>
        </div>
        <div class="cast-cmd-group">
          <span class="cast-cmd-label">Relaxing Sounds (1-Click):</span>
          <div class="cast-preset-chips">
            <button type="button" class="cast-preset-chip" data-id="${id}" data-preset="country_night">Country Night</button>
            <button type="button" class="cast-preset-chip" data-id="${id}" data-preset="rain">Rain</button>
            <button type="button" class="cast-preset-chip" data-id="${id}" data-preset="ocean">Ocean</button>
            <button type="button" class="cast-preset-chip" data-id="${id}" data-preset="thunderstorm">Thunder</button>
            <button type="button" class="cast-preset-chip" data-id="${id}" data-preset="fireplace">Fireplace</button>
            <button type="button" class="cast-preset-chip" data-id="${id}" data-preset="forest">Forest</button>
            <button type="button" class="cast-preset-chip" data-id="${id}" data-preset="white_noise">White Noise</button>
          </div>
        </div>
        <div class="cast-cmd-group">
          <span class="cast-cmd-label">${isDisplay ? 'Launch TV / Hub App:' : 'Launch Cast App:'}</span>
          <div class="cast-preset-chips">
            <button type="button" class="cast-app-chip" data-id="${id}" data-app="youtube">YouTube</button>
            <button type="button" class="cast-app-chip" data-id="${id}" data-app="youtube_music">YT Music</button>
            <button type="button" class="cast-app-chip" data-id="${id}" data-app="spotify">Spotify</button>
            ${isDisplay ? `<button type="button" class="cast-app-chip" data-id="${id}" data-app="netflix">Netflix</button>` : ''}
            <button type="button" class="cast-app-chip" data-id="${id}" data-app="backdrop">Idle / Backdrop</button>
          </div>
        </div>
        <div class="cast-cmd-row">
          <input type="url" class="cast-url-input" data-id="${id}" placeholder="Direct MP3 / AAC / MP4 / HLS stream URL..." />
          <button type="button" class="btn btn-secondary btn-xs cast-url-send-btn" data-id="${id}">Play URL</button>
        </div>
      </div>
    `;
  }

  function bindCastContainerEvents(container) {
    if (!container) return;

    container.querySelectorAll('.cast-start-btn').forEach((btn) => {
      btn.addEventListener('click', () => handleLocalCastStart(btn.dataset.id));
    });

    container.querySelectorAll('.cast-cmd-toggle-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        if (expandedCastCmdDevs.has(id)) {
          expandedCastCmdDevs.delete(id);
        } else {
          expandedCastCmdDevs.add(id);
        }
        document.querySelectorAll(`[data-cmd-drawer="${CSS.escape(id)}"]`).forEach((el) => {
          el.classList.toggle('hidden', !expandedCastCmdDevs.has(id));
        });
        document.querySelectorAll(`.cast-cmd-toggle-btn[data-id="${CSS.escape(id)}"]`).forEach((b) => {
          b.textContent = expandedCastCmdDevs.has(id) ? 'Commands ▴' : 'Commands ▾';
        });
      });
    });

    container.querySelectorAll('.cast-media-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        lockDomRefresh(1800);
        handleCastMediaAction(btn.dataset.id, btn.dataset.action, btn.dataset.seconds ? Number(btn.dataset.seconds) : null);
      });
    });

    container.querySelectorAll('.cast-media-bar[data-seek-id]').forEach((bar) => {
      bar.addEventListener('click', (e) => {
        const dur = Number(bar.dataset.dur) || 0;
        if (dur <= 0) return;
        const rect = bar.getBoundingClientRect();
        const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / (rect.width || 1)));
        const targetSec = Math.round(ratio * dur);
        lockDomRefresh(1800);
        handleCastMediaAction(bar.dataset.seekId, 'seek', null, { position_seconds: targetSec });
      });
    });

    container.querySelectorAll('.cast-web-query-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        const inp = btn.parentElement.querySelector('.cast-web-query-input');
        const query = inp ? inp.value.trim() : '';
        if (!query) {
          showToast('Type an album, song, artist, or video to search & play (e.g. "latest Wiz Khalifa album").', 'info');
          return;
        }
        if (inp) inp.value = '';
        handleCastMediaAction(id, 'play_web_media', null, { query });
      });
    });

    container.querySelectorAll('.cast-web-query-input').forEach((inp) => {
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const btn = inp.parentElement.querySelector('.cast-web-query-btn');
          if (btn) btn.click();
        }
      });
    });

    container.querySelectorAll('.cast-tts-send-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        const inp = btn.parentElement.querySelector('.cast-tts-input');
        const text = inp ? inp.value.trim() : '';
        if (!text) {
          showToast('Type a message to speak on this device first.', 'info');
          return;
        }
        if (inp) inp.value = '';
        handleCastMediaAction(id, 'announce', null, { text });
      });
    });

    container.querySelectorAll('.cast-tts-input').forEach((inp) => {
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const btn = inp.parentElement.querySelector('.cast-tts-send-btn');
          if (btn) btn.click();
        }
      });
    });

    container.querySelectorAll('.cast-preset-chip').forEach((btn) => {
      btn.addEventListener('click', () => {
        handleCastMediaAction(btn.dataset.id, 'play_preset', null, { preset: btn.dataset.preset });
      });
    });

    container.querySelectorAll('.cast-app-chip').forEach((btn) => {
      btn.addEventListener('click', () => {
        handleCastMediaAction(btn.dataset.id, 'launch_app', null, { app: btn.dataset.app });
      });
    });

    container.querySelectorAll('.cast-url-send-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        const inp = btn.parentElement.querySelector('.cast-url-input');
        const url = inp ? inp.value.trim() : '';
        if (!url) {
          showToast('Paste an audio/video stream URL first.', 'info');
          return;
        }
        handleCastMediaAction(id, 'play_url', null, { url });
      });
    });

    container.querySelectorAll('.cast-stop-btn').forEach((btn) => {
      btn.addEventListener('click', () => handleLocalCastStop(btn.dataset.id));
    });

    container.querySelectorAll('.cast-sync-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          const res = await fetch(apiUrl('cast_sync'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ deviceId: btn.dataset.id })
          });
          const data = await res.json();
          if (data.device) {
            const idx = devices.findIndex((d) => d.id === data.device.id);
            if (idx !== -1) devices[idx] = data.device;
            renderDevices(true);
            syncVosState();
            showToast(`Synced ${data.device.name}`);
          }
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });

    container.querySelectorAll('.remove-dev-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const res = await fetch(apiUrl('remove_device'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deviceId: btn.dataset.id })
        });
        const data = await res.json();
        if (Array.isArray(data.devices)) {
          devices = data.devices;
          renderDevices(true);
          persistSessionVaultFromResponse(data);
          syncVosState();
        }
      });
    });

    container.querySelectorAll('.volume-slider').forEach((slider) => {
      const pctLabel = slider.parentElement.querySelector('.volume-pct');
      slider.addEventListener('input', () => {
        lockDomRefresh(3000);
        if (pctLabel) pctLabel.textContent = `${slider.value}%`;
      });
      slider.addEventListener('change', async () => {
        lockDomRefresh(2000);
        const level = Number(slider.value) / 100;
        const dev = devices.find((d) => d.id === slider.dataset.id);
        if (dev) {
          dev.volume = level;
          dev.muted = false;
        }
        await fetch(apiUrl('cast_volume'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deviceId: slider.dataset.id, level, muted: false })
        }).catch(() => {});
        renderDevices(true);
        if (window.TrevaVos) {
          if (typeof window.TrevaVos.recordSystemUsage === 'function') {
            window.TrevaVos.recordSystemUsage('cast', `${dev ? dev.name : 'Cast'} vol ${slider.value}%`, { boost: 0.24 });
          }
          syncVosState();
        }
      });
    });

    container.querySelectorAll('.mute-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const currentlyMuted = btn.dataset.muted === 'true';
        const res = await fetch(apiUrl('cast_volume'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deviceId: btn.dataset.id, muted: !currentlyMuted })
        }).catch(() => null);
        if (res && res.ok) {
          const data = await res.json().catch(() => null);
          if (data && data.device) {
            const idx = devices.findIndex((d) => d.id === data.device.id);
            if (idx !== -1) devices[idx] = data.device;
            renderDevices(true);
            if (window.TrevaVos) {
              if (typeof window.TrevaVos.recordSystemUsage === 'function') {
                window.TrevaVos.recordSystemUsage(
                  'cast',
                  `${data.device.name || 'Cast'} ${currentlyMuted ? 'unmuted' : 'muted'}`,
                  { boost: 0.22 }
                );
              }
              syncVosState();
            }
          }
        }
      });
    });
  }

  function renderDevices(force = false) {
    updateSmartAndCastCounters();
    if (serverInfo && !serverInfo.isLocalEnvironment) {
      renderRemoteHostingNotice();
      return;
    }

    const sig = JSON.stringify(
      (devices || []).map((d) => [
        d.id, d.name, d.host, d.port, d.kind, d.model || '', d.status, d.volume, d.muted, d.appName || '',
        d.media ? [d.media.mediaSessionId, d.media.playerState, d.media.title, d.media.artist, Math.round((d.media.currentTime || 0) / 4)] : null
      ])
    );
    if (!force && sig === lastDevicesSig) return;
    lastDevicesSig = sig;

    const targetContainers = [devicesList, smartCastHubList].filter(Boolean);

    if (!devices || devices.length === 0) {
      const emptyHtml = `
        <div class="empty-devices">
          <p>No Google Nest or Chromecast devices discovered yet.</p>
          <span class="empty-sub">Click <strong>Scan Nest / Cast</strong> or <strong>Scan Wi-Fi</strong> above, use <strong>+ Add IP</strong>, or use <strong>Select Bluetooth Speaker Output</strong>.</span>
        </div>
      `;
      targetContainers.forEach((c) => {
        c.innerHTML = emptyHtml;
      });
      return;
    }

    targetContainers.forEach((container) => {
      container.innerHTML = '';
      devices.forEach((dev) => {
        const castStatus = String(dev.status || 'IDLE').toUpperCase();
        const isCasting = ['PLAYING', 'BUFFERING', 'PAUSED', 'ACTIVE'].includes(castStatus);
        const media = dev.media && (dev.media.mediaSessionId !== undefined || dev.media.title) ? dev.media : null;
        const card = document.createElement('div');
        card.className = `device-card ${isCasting ? 'casting' : ''}`;

        const kindLabel = dev.model
          ? dev.model
          : (dev.kind === 'speaker' ? 'Google Nest Speaker' : 'Chromecast / Google TV');

        const iconSvg =
          dev.kind === 'speaker'
            ? `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
                 <rect x="4" y="2" width="16" height="20" rx="4" ry="4" />
                 <circle cx="12" cy="14" r="4" />
                 <line x1="12" y1="6" x2="12.01" y2="6" />
               </svg>`
            : `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
                 <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                 <line x1="8" y1="21" x2="16" y2="21" />
                 <line x1="12" y1="17" x2="12" y2="21" />
               </svg>`;

        const volPercent = Math.round((dev.volume !== undefined ? dev.volume : 0.7) * 100);
        const isExpanded = expandedCastCmdDevs.has(dev.id);

        card.innerHTML = `
          <div class="device-top">
            <div class="device-info">
              <div class="device-icon">${iconSvg}</div>
              <div>
                <div class="device-name">${escapeHtml(dev.name)}</div>
                <div class="device-meta">
                  <span class="device-kind-tag">${escapeHtml(kindLabel)}</span>
                  <span>${escapeHtml(dev.host)}:${dev.port}</span>
                  <span>&bull; <strong>${escapeHtml(dev.status || 'IDLE')}</strong>${dev.appName ? ` (${escapeHtml(dev.appName)})` : ''}</span>
                </div>
              </div>
            </div>

            <div class="device-actions">
              <button type="button" class="btn btn-ghost btn-sm cast-cmd-toggle-btn" data-id="${escapeHtml(dev.id)}" title="Speak TTS, Play Relaxing Sounds, Launch Apps, or Play Stream URL">${isExpanded ? 'Commands ▴' : 'Commands ▾'}</button>
              <button type="button" class="btn btn-secondary btn-sm cast-sync-btn" data-id="${escapeHtml(dev.id)}" title="Refresh Now Playing & volume">Sync</button>
              ${
                isCasting
                  ? `<button type="button" class="btn btn-danger btn-sm cast-stop-btn" data-id="${escapeHtml(dev.id)}">Stop</button>`
                  : `<button type="button" class="btn btn-primary btn-sm cast-start-btn" data-id="${escapeHtml(dev.id)}">Cast Now</button>`
              }
              ${
                dev.isManual
                  ? `<button type="button" class="btn btn-secondary btn-sm remove-dev-btn" data-id="${escapeHtml(dev.id)}" title="Remove manual device">&times;</button>`
                  : ''
              }
            </div>
          </div>

          <div class="device-volume-row">
            <button type="button" class="mute-btn" data-id="${escapeHtml(dev.id)}" data-muted="${Boolean(dev.muted)}" title="Toggle Mute">
              ${
                dev.muted
                  ? `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>`
                  : `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>`
              }
            </button>
            <input type="range" class="volume-slider" min="0" max="100" value="${volPercent}" data-id="${escapeHtml(dev.id)}" />
            <span class="volume-pct">${dev.muted ? 'Muted' : `${volPercent}%`}</span>
          </div>
          ${renderCastMediaBlock(dev, media)}
          ${renderCastCommandDrawer(dev)}
        `;

        container.appendChild(card);
      });

      bindCastContainerEvents(container);
    });
  }

  function formatMediaTime(sec) {
    const s = Math.max(0, Math.floor(Number(sec) || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = String(s % 60).padStart(2, '0');
    return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
  }

  function estimateMediaPosition(media) {
    if (!media) return 0;
    let pos = Number(media.currentTime) || 0;
    if (String(media.playerState).toUpperCase() === 'PLAYING' && media.updatedAt) {
      pos += Math.max(0, Date.now() / 1000 - Number(media.updatedAt));
    }
    if (media.duration) pos = Math.min(pos, Number(media.duration));
    return pos;
  }

  const MEDIA_ICONS = {
    previous: '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M6 5h2v14H6zM20 5v14L9 12z"/></svg>',
    rewind: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 1 0 3-6.7"/><polyline points="3 3 3 9 9 9"/></svg>',
    play: '<svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor"><path d="M7 4v16l13-8z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor"><path d="M6 4h4v16H6zM14 4h4v16h-4z"/></svg>',
    forward: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-3-6.7"/><polyline points="21 3 21 9 15 9"/></svg>',
    next: '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M16 5h2v14h-2zM4 5v14l11-7z"/></svg>',
    stop: '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>'
  };

  function renderCastMediaBlock(dev, media) {
    const appName = dev.appName || '';
    if (!media && !appName) return '';
    const id = escapeHtml(dev.id);
    if (!media) {
      return `
        <div class="cast-media-block">
          <div class="cast-media-meta">
            <span class="cast-media-app">${escapeHtml(appName)}</span>
            <span class="cast-media-sub">App active on receiver — click Sync or open Commands ▾ to control</span>
          </div>
        </div>`;
    }
    const st = String(media.playerState || '').toUpperCase();
    const isPlaying = st === 'PLAYING' || st === 'BUFFERING';
    const dur = Number(media.duration) || 0;
    const pos = estimateMediaPosition(media);
    const pct = dur > 0 ? Math.min(100, (pos / dur) * 100) : 0;
    const art = media.imageUrl
      ? `<img class="cast-media-art" src="${escapeHtml(media.imageUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer" />`
      : '<div class="cast-media-art cast-media-art-empty"></div>';
    const seekDisabled = media.canSeek === false ? 'disabled' : '';
    const seekBarAttr = dur > 0 && media.canSeek !== false ? `data-seek-id="${id}" data-dur="${dur}" title="Click to seek"` : '';
    return `
      <div class="cast-media-block" data-media-dev="${id}">
        <div class="cast-media-top">
          ${art}
          <div class="cast-media-meta">
            <span class="cast-media-app">${escapeHtml(appName || 'Cast Media')} &bull; ${escapeHtml(st || 'ACTIVE')}</span>
            <span class="cast-media-title" title="${escapeHtml(media.title || '')}">${escapeHtml(media.title || appName || 'Playing Media')}</span>
            <span class="cast-media-sub">${escapeHtml([media.artist, media.album].filter(Boolean).join(' — '))}</span>
          </div>
        </div>
        <div class="cast-media-progress">
          <span class="cast-media-time" data-f="pos">${formatMediaTime(pos)}</span>
          <div class="cast-media-bar" ${seekBarAttr}><div class="cast-media-fill" data-f="fill" style="width:${pct.toFixed(1)}%"></div></div>
          <span class="cast-media-time">${dur > 0 ? formatMediaTime(dur) : 'LIVE'}</span>
        </div>
        <div class="cast-media-controls">
          <button type="button" class="cast-media-btn" data-id="${id}" data-action="previous" title="Previous track">${MEDIA_ICONS.previous}</button>
          <button type="button" class="cast-media-btn" data-id="${id}" data-action="rewind" data-seconds="10" title="Rewind 10s" ${seekDisabled}>${MEDIA_ICONS.rewind}<small>10</small></button>
          <button type="button" class="cast-media-btn cast-media-main" data-id="${id}" data-action="${isPlaying ? 'pause' : 'play'}" title="${isPlaying ? 'Pause' : 'Play'}">${isPlaying ? MEDIA_ICONS.pause : MEDIA_ICONS.play}</button>
          <button type="button" class="cast-media-btn" data-id="${id}" data-action="fast_forward" data-seconds="10" title="Forward 10s" ${seekDisabled}>${MEDIA_ICONS.forward}<small>10</small></button>
          <button type="button" class="cast-media-btn" data-id="${id}" data-action="next" title="Next track">${MEDIA_ICONS.next}</button>
          <button type="button" class="cast-media-btn" data-id="${id}" data-action="stop_media" title="Stop playback">${MEDIA_ICONS.stop}</button>
        </div>
      </div>`;
  }

  // Smoothly advance progress bars between server syncs without re-rendering cards
  setInterval(() => {
    document.querySelectorAll('.cast-media-block[data-media-dev]').forEach((block) => {
      const dev = (devices || []).find((d) => d.id === block.dataset.mediaDev);
      const media = dev && dev.media;
      if (!media) return;
      const pos = estimateMediaPosition(media);
      const dur = Number(media.duration) || 0;
      const posEl = block.querySelector('[data-f="pos"]');
      const fillEl = block.querySelector('[data-f="fill"]');
      if (posEl) posEl.textContent = formatMediaTime(pos);
      if (fillEl && dur > 0) fillEl.style.width = `${Math.min(100, (pos / dur) * 100).toFixed(1)}%`;
    });
  }, 1000);

  async function handleCastMediaAction(deviceId, action, seconds = null, extra = {}) {
    const dev = (devices || []).find((d) => d.id === deviceId);
    const body = { deviceId, action, ...(extra || {}) };
    if (seconds !== null && seconds !== undefined) body.seconds = seconds;
    try {
      if (action === 'play_web_media') {
        showToast(`Searching the internet with gpt-6-luna for "${extra.query || 'media'}"...`, 'info');
      } else if (action === 'announce') {
        showToast(`Speaking on ${dev ? dev.name : 'Google Nest'}...`, 'info');
      } else if (action === 'play_preset') {
        showToast(`Starting ${extra.preset || 'sound'} on ${dev ? dev.name : 'Google Nest'}...`, 'info');
      } else if (action === 'launch_app') {
        showToast(`Launching ${extra.app || 'app'} on ${dev ? dev.name : 'Cast'}...`, 'info');
      }
      const res = await fetch(apiUrl('cast_media'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) throw new Error(data.error || `Cast ${action} failed`);
      if (data.device) {
        const idx = devices.findIndex((d) => d.id === data.device.id);
        if (idx !== -1) devices[idx] = data.device;
        renderDevices(true);
      }
      const labels = {
        play: 'Playing',
        pause: 'Paused',
        stop_media: 'Stopped',
        rewind: `Rewound ${seconds || 10}s`,
        fast_forward: `Forward ${seconds || 10}s`,
        seek: `Seeked to ${formatMediaTime(extra.position_seconds || 0)}`,
        next: 'Next track',
        previous: 'Previous track',
        restart: 'Restarted',
        announce: `Spoke "${(extra.text || '').slice(0, 36)}"`,
        play_preset: `Playing ${data.preset?.title || extra.preset || 'Preset'}`,
        play_web_media: data.resolved
          ? `Playing ${data.resolved.title || extra.query}${data.resolved.artist ? ` by ${data.resolved.artist}` : ''}${data.resolved.year ? ` (${data.resolved.year})` : ''} [${data.resolved.model || 'gpt-6-luna'}]`
          : `Playing ${extra.query || 'Web Media'}`,
        play_url: 'Playing stream URL',
        launch_app: `Launched ${extra.app || 'App'}`
      };
      const title = data.media && data.media.title && !['announce', 'play_preset', 'play_web_media'].includes(action)
        ? ` — ${data.media.title}`
        : '';
      showToast(`${dev ? dev.name : 'Cast'}: ${labels[action] || action}${title}`, 'success');
      if (window.TrevaVos && typeof window.TrevaVos.recordSystemUsage === 'function') {
        window.TrevaVos.recordSystemUsage('cast', `${dev ? dev.name : 'Cast'} ${action}`, { boost: 0.28 });
      }
      syncVosState();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function handleLocalCastStart(deviceId) {
    const dev = devices.find((d) => d.id === deviceId);
    if (!dev) return;

    if (!isCapturing) {
      if (dev.kind === 'speaker' && streamMode !== 'audio') {
        setStreamMode('audio', true);
      } else if (dev.kind === 'display' && streamMode !== 'video') {
        setStreamMode('video', true);
      }
      const started = await startBrowserCapture('display');
      if (!started) return;
      const waitFmt = dev.kind === 'speaker' || streamMode === 'audio' ? 'mp3' : 'webm';
      await waitForUploadedChunk(waitFmt, 2800);
    }

    try {
      const targetMode = dev.kind === 'speaker' ? 'audio' : streamMode;
      if (targetMode === 'audio' && displayStream && displayStream.getAudioTracks().length === 0) {
        showToast('No system audio track captured! Stop capture and check "Also share system audio".', 'error');
        return;
      }
      showToast(`Connecting to ${dev.name}...`);
      const res = await fetch(apiUrl('cast_start'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId, mode: targetMode })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to start casting');
      if (data.device) {
        const idx = devices.findIndex((d) => d.id === data.device.id);
        if (idx !== -1) devices[idx] = data.device;
        renderDevices(true);
      }
      if (window.TrevaVos) {
        if (typeof window.TrevaVos.recordSystemUsage === 'function') {
          window.TrevaVos.recordSystemUsage('cast', `Cast ${targetMode} -> ${dev.name}`, { boost: 0.44 });
        }
        syncVosState();
      }
      showToast(`Streaming ${targetMode === 'audio' ? 'sound' : 'screen & sound'} to ${dev.name}!`, 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function handleLocalCastStop(deviceId) {
    try {
      const res = await fetch(apiUrl('cast_stop'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId })
      });
      const data = await res.json();
      if (data.device) {
        const idx = devices.findIndex((d) => d.id === data.device.id);
        if (idx !== -1) devices[idx] = data.device;
        renderDevices(true);
      }
      if (window.TrevaVos) {
        if (typeof window.TrevaVos.recordSystemUsage === 'function') {
          window.TrevaVos.recordSystemUsage('cast', 'Cast Stopped', { damp: true, boost: 0 });
        }
        syncVosState();
      }
      showToast('Stopped casting to device');
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  refreshDevicesBtn.addEventListener('click', () => discoverLocalDevices(false));
  addManualDeviceBtn.addEventListener('click', () => manualDeviceForm.classList.toggle('hidden'));

  manualDeviceForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const res = await fetch(apiUrl('manual_device'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: manualNameInput.value,
          host: manualHostInput.value,
          kind: manualKindSelect.value,
          port: Number(manualPortInput.value) || 8009
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not add device');
      manualNameInput.value = '';
      manualHostInput.value = '';
      manualDeviceForm.classList.add('hidden');
      if (Array.isArray(data.devices)) {
        devices = data.devices;
        renderDevices(true);
        persistSessionVaultFromResponse(data);
        syncVosState();
      }
      showToast(`Added ${data.device.name}`, 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // ===========================================================================
  // OFFICIAL GOOGLE CAST BROWSER SENDER SDK
  // ===========================================================================
  function updateSdkUi(session) {
    activeCastSession = session || null;
    if (dockCastDot) {
      dockCastDot.classList.toggle('hidden', !(isCapturing || activeCastSession));
    }
    if (!session) {
      sdkSessionBox.classList.add('hidden');
      syncVosState();
      return;
    }

    const castDev = session.getCastDevice ? session.getCastDevice() : null;
    sdkDeviceName.textContent = (castDev && castDev.friendlyName) || 'Google Cast Device';
    sdkSessionBox.classList.remove('hidden');

    if (remotePlayer) {
      const volPct = Math.round((remotePlayer.volumeLevel || 0.7) * 100);
      sdkVolumeSlider.value = volPct;
      sdkVolumePct.textContent = remotePlayer.isMuted ? 'Muted' : `${volPct}%`;
    }
    syncVosState();
  }

  function buildCastMediaInfo(mode) {
    const isAudio = mode === 'audio';
    const baseDir = `${window.location.origin}${window.location.pathname.replace(/\/[^/]*$/, '')}`;
    let baseAudioUrl =
      (serverInfo && serverInfo.streamEndpoints && serverInfo.streamEndpoints.audio) ||
      `${baseDir}/stream.php?sid=${encodeURIComponent(STREAM_SID)}&fmt=mp3`;
    let baseVideoUrl =
      (serverInfo && serverInfo.streamEndpoints && serverInfo.streamEndpoints.video) ||
      `${baseDir}/stream.php?sid=${encodeURIComponent(STREAM_SID)}&fmt=webm`;

    if (window.location.protocol === 'https:' && (!serverInfo || !serverInfo.isLocalEnvironment)) {
      baseAudioUrl = baseAudioUrl.replace(/^http:\/\//i, 'https://');
      baseVideoUrl = baseVideoUrl.replace(/^http:\/\//i, 'https://');
    }

    const streamUrl = (isAudio ? baseAudioUrl : baseVideoUrl) + `&t=${Date.now()}`;
    const mediaInfo = new chrome.cast.media.MediaInfo(streamUrl, isAudio ? 'audio/mpeg' : 'video/webm');
    mediaInfo.streamType = chrome.cast.media.StreamType.LIVE;
    mediaInfo.metadata = isAudio
      ? new chrome.cast.media.MusicTrackMediaMetadata()
      : new chrome.cast.media.GenericMediaMetadata();
    mediaInfo.metadata.title = isAudio ? 'Treva Live Sound Cast' : 'Treva Screen & Sound Cast';
    mediaInfo.metadata.subtitle = 'Streaming Live from Browser';
    return mediaInfo;
  }

  async function loadStreamOnSdkSession(session, mode) {
    sdkActiveMode = mode;
    userStoppedSdkCast = false;
    const mediaInfo = buildCastMediaInfo(mode);
    await session.loadMedia(new chrome.cast.media.LoadRequest(mediaInfo));
    sdkStreamTypeTag.textContent = mode === 'audio' ? 'AUDIO MP3' : 'VIDEO WEBM';
    if (window.TrevaVos && typeof window.TrevaVos.recordSystemUsage === 'function') {
      const castDev = session.getCastDevice ? session.getCastDevice() : null;
      const devNm = (castDev && castDev.friendlyName) || 'Google Cast';
      window.TrevaVos.recordSystemUsage('cast', `SDK ${mode} -> ${devNm}`, { boost: 0.44 });
    }
    updateSdkUi(session);
  }

  function getCastUnavailableReason() {
    const isLocalHost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    if (!window.isSecureContext && !isLocalHost) {
      return 'Browser Google Cast SDK requires HTTPS (or http://localhost). Switch to https:// or use the Pure PHP "Cast Now" buttons below!';
    }
    if (window.__trevaCastScriptError) {
      return 'Could not load Google Cast SDK from gstatic.com (blocked by adblocker or offline). Use the Pure PHP "Cast Now" buttons below!';
    }
    if (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
      return 'Google Cast Web Sender SDK works in Desktop Chrome/Edge over HTTPS. On mobile, open Treva on local Wi-Fi HTTP and use Pure PHP "Cast Now", or use system Cast Screen!';
    }
    return 'Browser Cast Extension / Media Router is unavailable in this browser (use Desktop Chrome/Edge over HTTPS/localhost with Cast enabled, or "Cast Now" below).';
  }

  function initCastFramework(isAvailable) {
    if (!isAvailable || !window.cast || !window.cast.framework) {
      if (isAvailable === false && castSdkHint) {
        castSdkHint.textContent = getCastUnavailableReason();
      }
      return false;
    }
    if (castFrameworkReady) return true;
    try {
      const context = cast.framework.CastContext.getInstance();
      context.setOptions({
        receiverApplicationId: chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
        autoJoinPolicy: chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED
      });

      castFrameworkReady = true;
      if (castSdkHint) {
        castSdkHint.textContent = 'Ready — click Cast to Nest / TV to select any Chromecast or Google Nest on Wi-Fi.';
      }
      remotePlayer = new cast.framework.RemotePlayer();
      remotePlayerController = new cast.framework.RemotePlayerController(remotePlayer);

      remotePlayerController.addEventListener(
        cast.framework.RemotePlayerEventType.VOLUME_LEVEL_CHANGED,
        () => updateSdkUi(context.getCurrentSession())
      );
      remotePlayerController.addEventListener(
        cast.framework.RemotePlayerEventType.IS_MUTED_CHANGED,
        () => updateSdkUi(context.getCurrentSession())
      );
      remotePlayerController.addEventListener(
        cast.framework.RemotePlayerEventType.PLAYER_STATE_CHANGED,
        () => {
          const sess = context.getCurrentSession();
          const st = remotePlayer ? remotePlayer.playerState : '';
          if (st === chrome.cast.media.PlayerState.PLAYING) {
            if (sdkRecoverTimer) {
              clearTimeout(sdkRecoverTimer);
              sdkRecoverTimer = null;
            }
            return;
          }
          if (
            st === chrome.cast.media.PlayerState.IDLE &&
            isCapturing &&
            !userStoppedSdkCast &&
            sess &&
            (Date.now() - sdkLastRecoverAt) > 4000 &&
            sdkRecoverCount < 6
          ) {
            if (sdkRecoverTimer) clearTimeout(sdkRecoverTimer);
            sdkRecoverTimer = setTimeout(async () => {
              sdkRecoverTimer = null;
              const liveSess = context.getCurrentSession();
              if (!isCapturing || userStoppedSdkCast || !liveSess) return;
              if (remotePlayer && remotePlayer.playerState !== chrome.cast.media.PlayerState.IDLE) return;
              sdkLastRecoverAt = Date.now();
              sdkRecoverCount += 1;
              try {
                showToast('Reconnecting live stream to Google Cast...', 'info');
                await loadStreamOnSdkSession(liveSess, sdkActiveMode);
              } catch (_) {}
            }, 1500);
          }
        }
      );

      context.addEventListener(
        cast.framework.CastContextEventType.SESSION_STATE_CHANGED,
        (event) => {
          const sess = context.getCurrentSession();
          if (
            event.sessionState === cast.framework.SessionState.SESSION_STARTED ||
            event.sessionState === cast.framework.SessionState.SESSION_RESUMED
          ) {
            updateSdkUi(sess);
          } else if (event.sessionState === cast.framework.SessionState.SESSION_ENDED) {
            userStoppedSdkCast = true;
            if (sdkRecoverTimer) {
              clearTimeout(sdkRecoverTimer);
              sdkRecoverTimer = null;
            }
            updateSdkUi(null);
          }
        }
      );

      const existing = context.getCurrentSession();
      if (existing) updateSdkUi(existing);
      return true;
    } catch (err) {
      console.warn('Cast SDK init warning:', err);
      return false;
    }
  }

  window.__trevaInitCast = initCastFramework;
  window['__onGCastApiAvailable'] = initCastFramework;
  if (window.__trevaCastAvailable !== null || (window.cast && window.cast.framework)) {
    initCastFramework(window.__trevaCastAvailable !== false && Boolean(window.cast && window.cast.framework));
  }

  browserCastSdkBtn.addEventListener('click', async () => {
    if (!castFrameworkReady && window.cast && window.cast.framework) {
      initCastFramework(true);
    }
    if (!castFrameworkReady || !window.cast || !window.cast.framework) {
      showToast(getCastUnavailableReason(), 'error');
      return;
    }

    try {
      const context = cast.framework.CastContext.getInstance();
      await context.requestSession();
      const session = context.getCurrentSession();
      if (!session) return;

      const castDev = session.getCastDevice ? session.getCastDevice() : null;
      const hasVideoOut =
        castDev && Array.isArray(castDev.capabilities)
          ? castDev.capabilities.includes(chrome.cast.Capability.VIDEO_OUT)
          : streamMode === 'video';

      const hasVideoTrack = !isCapturing ? true : Boolean(displayStream && displayStream.getVideoTracks().length > 0);
      const effectiveMode = !hasVideoOut || !hasVideoTrack ? 'audio' : streamMode;
      if (effectiveMode !== streamMode) setStreamMode(effectiveMode, true);

      if (!isCapturing) {
        const started = await startBrowserCapture('display');
        if (!started) return;
      }

      const finalHasVideo = Boolean(displayStream && displayStream.getVideoTracks().length > 0);
      const castMode = effectiveMode === 'video' && finalHasVideo ? 'video' : 'audio';
      if (castMode !== streamMode) setStreamMode(castMode, true);

      const isAudio = castMode === 'audio';
      if (isAudio && displayStream && displayStream.getAudioTracks().length === 0) {
        showToast('No system audio track captured! Stop capture and check "Also share system audio".', 'error');
        return;
      }

      await waitForUploadedChunk(isAudio ? 'mp3' : 'webm', 2800);

      sdkRecoverCount = 0;
      await loadStreamOnSdkSession(session, castMode);
      showToast(`Streaming ${isAudio ? 'sound' : 'screen & sound'} to ${castDev ? castDev.friendlyName : 'Google Cast'}!`, 'success');
    } catch (err) {
      if (err && err !== 'cancel') {
        showToast(`Cast error: ${err.message || err}`, 'error');
      }
    }
  });

  sdkStopBtn.addEventListener('click', () => {
    userStoppedSdkCast = true;
    if (sdkRecoverTimer) {
      clearTimeout(sdkRecoverTimer);
      sdkRecoverTimer = null;
    }
    if (activeCastSession) {
      activeCastSession.endSession(true);
      if (window.TrevaVos && typeof window.TrevaVos.recordSystemUsage === 'function') {
        window.TrevaVos.recordSystemUsage('cast', 'SDK Cast Stopped', { damp: true, boost: 0 });
      }
      updateSdkUi(null);
      showToast('Disconnected Google Cast session');
    }
  });

  sdkVolumeSlider.addEventListener('input', () => {
    if (remotePlayer && remotePlayerController) {
      remotePlayer.volumeLevel = Number(sdkVolumeSlider.value) / 100;
      remotePlayerController.setVolumeLevel();
    }
  });

  sdkMuteBtn.addEventListener('click', () => {
    if (remotePlayerController) remotePlayerController.muteOrUnmute();
  });

  // ===========================================================================
  // SMART DEVICES: SMART LIFE (TUYA), MAGIC HOME & WEB BLUETOOTH BLE
  // ===========================================================================
  [tuyaAccessSecretInput, mhPasswordInput, mhTokenInput, openAiKeyInput].forEach((inputEl) => {
    if (!inputEl) return;
    inputEl.addEventListener('focus', () => {
      if (inputEl.value === SAVED_SECRET_MASK) inputEl.select();
    });
  });

  function populateSmartConfigForm() {
    if (!smartConfig) return;
    if (smartConfig.tuya) {
      tuyaAccessIdInput.value = smartConfig.tuya.accessId || '';
      const hasSecret = Boolean(smartConfig.tuya.hasSecret);
      tuyaAccessSecretInput.value = hasSecret ? SAVED_SECRET_MASK : '';
      tuyaAccessSecretInput.placeholder = hasSecret
        ? 'Secret saved (leave as-is to keep)'
        : 'Paste Tuya Access Secret';
      if (tuyaSecretSavedTag) tuyaSecretSavedTag.classList.toggle('hidden', !hasSecret);
      tuyaRegionSelect.value = smartConfig.tuya.region || 'us';
      tuyaUidInput.value = smartConfig.tuya.uid || smartConfig.tuya.sampleDeviceId || '';
    }
    if (smartConfig.magicHome) {
      mhEmailInput.value = smartConfig.magicHome.email || '';
      const hasPass = Boolean(smartConfig.magicHome.hasPassword);
      mhPasswordInput.value = hasPass ? SAVED_SECRET_MASK : '';
      mhPasswordInput.placeholder = hasPass
        ? 'Password saved (leave as-is to keep)'
        : 'Password';
      if (mhPasswordSavedTag) mhPasswordSavedTag.classList.toggle('hidden', !hasPass);

      const hasTok = Boolean(smartConfig.magicHome.hasToken);
      mhTokenInput.value = hasTok ? SAVED_SECRET_MASK : '';
      mhTokenInput.placeholder = hasTok
        ? 'Cloud token saved (leave as-is to keep)'
        : 'Optional JWT token';
      if (mhTokenSavedTag) mhTokenSavedTag.classList.toggle('hidden', !hasTok);
      mhRegionSelect.value = smartConfig.magicHome.region || 'us';
    }
    if (smartConfig.openai) {
      const hasSessionOai = Boolean(smartConfig.openai.hasSessionKey);
      const hasServerOai = Boolean(smartConfig.openai.hasServerKey);
      if (openAiKeyInput) {
        openAiKeyInput.value = hasSessionOai ? SAVED_SECRET_MASK : '';
        openAiKeyInput.placeholder = hasSessionOai
          ? 'Local browser key saved (leave as-is to keep)'
          : (hasServerOai
              ? 'Server fallback active (optional: paste your own key)'
              : 'sk-proj-... (saved in your local cache)');
      }
      if (openAiKeySavedTag) {
        openAiKeySavedTag.classList.toggle('hidden', !hasSessionOai && !hasServerOai);
        openAiKeySavedTag.textContent = hasSessionOai
          ? '✓ Local Key'
          : (hasServerOai ? '✓ Server Key' : '');
      }
      if (clearSessionOpenAiBtn) {
        clearSessionOpenAiBtn.classList.toggle('hidden', !hasSessionOai);
        clearSessionOpenAiBtn.textContent = hasServerOai ? 'Use Server Key' : 'Clear Key';
      }
      if (openAiVoiceModalSelect && smartConfig.openai.voice) {
        openAiVoiceModalSelect.value = smartConfig.openai.voice;
      }
      if (aiVoiceSelect && smartConfig.openai.voice) {
        aiVoiceSelect.value = smartConfig.openai.voice;
      }
      if (aiModelSelect && smartConfig.openai.model) {
        aiModelSelect.value = smartConfig.openai.model;
      }
    }
    if (smartConfig.googleNest) {
      if (googleNestProjectIdInput) googleNestProjectIdInput.value = smartConfig.googleNest.projectId || '';
      if (googleNestClientIdInput) googleNestClientIdInput.value = smartConfig.googleNest.clientId || '';
      if (googleNestClientSecretInput) {
        googleNestClientSecretInput.value = smartConfig.googleNest.hasClientSecret ? SAVED_SECRET_MASK : '';
      }
      if (googleNestRefreshTokenInput) {
        googleNestRefreshTokenInput.value = smartConfig.googleNest.hasRefreshToken ? SAVED_SECRET_MASK : '';
      }
    }
    updateSmartAndCastCounters();
    updateLocalSessionStatusUi();
  }

  async function discoverSmartWifi(silent = false) {
    try {
      if (!silent) showToast('Scanning local Wi-Fi for Magic Home & Smart Life devices...');
      const res = await fetch(apiUrl('smart_discover'), { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Smart discovery failed');
      applySyncedScenesData(data);
      if (!silent) {
        const total = (data.foundMagicHome || 0) + (data.foundTuya || 0);
        showToast(
          total > 0
            ? `Found ${data.foundMagicHome || 0} Magic Home + ${data.foundTuya || 0} Smart Life device(s)`
            : 'No new Wi-Fi smart devices replied on broadcast. Make sure devices are on the same 2.4GHz Wi-Fi.',
          total > 0 ? 'success' : 'info'
        );
      }
    } catch (err) {
      if (!silent) showToast(`Smart scan failed: ${err.message}`, 'error');
    }
  }

  let smartScenesSyncPromise = null;
  let lastScenesSyncAt = 0;

  function applySyncedScenesData(data) {
    if (!data || typeof data !== 'object') return;
    if (Array.isArray(data.smartDevices)) {
      smartDevices = data.smartDevices;
    }
    if (Array.isArray(data.sceneLinks)) {
      smartSceneLinks = data.sceneLinks;
    }
    if (data.sliceScenes && typeof data.sliceScenes === 'object') {
      sliceSceneMap = data.sliceScenes;
    }
    if (data.smartScenes) {
      smartScenes = data.smartScenes;
    }
    persistSessionVaultFromResponse(data);
    renderSmartDevices(true);
    renderSmartScenes();
    syncVosState();
  }

  async function syncSmartScenes(silent = true, btn = null) {
    if (smartScenesSyncPromise) return smartScenesSyncPromise;
    const prevSig = JSON.stringify(
      ((smartScenes && smartScenes.scenes) || []).map((s) => `${s.id || ''}:${s.name || ''}`)
    );
    const targetBtns = [btn, syncSmartScenesBtn].filter(Boolean);
    const prevLabels = new Map();
    targetBtns.forEach((b) => {
      prevLabels.set(b, b.textContent);
      b.disabled = true;
      if (b === btn || !silent) b.textContent = 'Syncing...';
    });

    smartScenesSyncPromise = (async () => {
      try {
        const res = await fetch(apiUrl('smart_scenes_sync'), {
          method: 'POST',
          cache: 'no-store'
        });
        const data = await res.json();
        if (!res.ok || data.error) {
          throw new Error(data.error || 'SmartLife scene sync failed');
        }
        lastScenesSyncAt = Date.now();
        applySyncedScenesData(data);
        const nextList = (smartScenes && smartScenes.scenes) || [];
        const nextSig = JSON.stringify(nextList.map((s) => `${s.id || ''}:${s.name || ''}`));
        const changed = nextSig !== prevSig;
        const count = nextList.length;
        if (window.TrevaVos && (!silent || changed)) {
          window.TrevaVos.pushLog('SYNC', `SmartLife scenes synced (${count})`, 'ok');
        }
        if (!silent) {
          showToast(`Synced ${count} SmartLife Tap-to-Run scene(s)`, 'success');
        } else if (changed) {
          showToast(`Updated SmartLife scenes (${count})`, 'info');
        }
        return data;
      } catch (err) {
        if (!silent) {
          showToast(err.message || 'SmartLife scene sync failed', 'error');
          if (window.TrevaVos) window.TrevaVos.pushLog('ERR', err.message || 'Scene sync failed', 'warn');
        }
        return null;
      } finally {
        targetBtns.forEach((b) => {
          if (!b.isConnected) return;
          b.disabled = false;
          if (prevLabels.has(b)) b.textContent = prevLabels.get(b);
        });
        smartScenesSyncPromise = null;
      }
    })();

    return smartScenesSyncPromise;
  }

  async function syncSmartCloud(platform = 'all') {
    const tuyaOk = smartConfig && smartConfig.tuya && smartConfig.tuya.configured;
    const mhOk = smartConfig && smartConfig.magicHome && smartConfig.magicHome.configured;
    if (!tuyaOk && !mhOk) {
      openSmartKeysBtn.click();
      showToast('Enter your Smart Life (Tuya IoT) or Magic Home credentials first.', 'info');
      return;
    }

    try {
      showToast('Syncing Smart Life / Magic Home Cloud devices...');
      const res = await fetch(apiUrl('smart_sync_cloud'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Cloud sync failed');
      if (data.smartConfig) {
        smartConfig = data.smartConfig;
        populateSmartConfigForm();
      }
      applySyncedScenesData(data);
      const cTuya = (data.synced && data.synced.tuya) || 0;
      const cMh = (data.synced && data.synced.magicHome) || 0;
      const cSc = (data.synced && data.synced.scenes) || 0;
      if (window.TrevaVos) {
        window.TrevaVos.pushLog('SYNC', `Cloud synced: ${cTuya} Smart Life, ${cMh} Magic Home, ${cSc} scenes`, 'ok');
      }
      showToast(
        `Cloud sync complete: ${cTuya} Smart Life, ${cMh} Magic Home device(s), ${cSc} scenes!`,
        'success'
      );
      if (Array.isArray(data.warnings) && data.warnings.length > 0) {
        showToast(data.warnings.join(' | '), 'info');
      }
    } catch (err) {
      if (window.TrevaVos) window.TrevaVos.pushLog('ERR', `Cloud sync: ${err.message}`, 'error');
      showToast(`Cloud sync error: ${err.message}`, 'error');
    }
  }

  async function controlWifiSmartDevice(deviceId, payload) {
    const dev = smartDevices.find((d) => d.id === deviceId);
    const prevSnapshot = dev ? { ...dev } : null;
    if (dev) Object.assign(dev, payload);
    const devLabel = dev ? dev.name : deviceId;
    if (window.TrevaVos) {
      if (typeof window.TrevaVos.recordSystemUsage === 'function') {
        const cat = String((dev && dev.category) || 'light');
        if (cat === 'vacuum') {
          const vAct = String(payload.vacuum_action || '');
          const isStop = /^(pause|stop)$/i.test(vAct) || payload.power === false;
          window.TrevaVos.recordSystemUsage(
            'vacuum',
            `${devLabel} (${vAct || 'update'})`,
            isStop ? { damp: true, boost: 0 } : { boost: 0.42 }
          );
        } else if (cat.startsWith('ir_') && cat !== 'ir_hub') {
          const irTxt = payload.ir_command || (payload.ac_temp ? `AC ${payload.ac_temp}°C ${payload.ac_mode || ''}` : 'IR');
          window.TrevaVos.recordSystemUsage('ir', `${devLabel}: ${irTxt}`.trim(), { boost: 0.34 });
        } else {
          const isOff = payload.power === false;
          window.TrevaVos.recordSystemUsage(
            'lights',
            `${devLabel}${isOff ? ' OFF' : (payload.brightness !== undefined ? ` ${payload.brightness}%` : ' updated')}`,
            isOff ? { damp: true, boost: 0 } : { boost: 0.34 }
          );
        }
      }
      window.TrevaVos.pulseCommandJoin();
      window.TrevaVos.pushLog('CTRL', `${devLabel} -> ${JSON.stringify(payload)}`, 'info');
      syncVosState();
    }

    try {
      const res = await fetch(apiUrl('smart_control'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.assign({ deviceId }, payload))
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Control failed');
      if (Array.isArray(data.smartDevices)) {
        smartDevices = data.smartDevices;
        renderSmartDevices(false);
      }
      if (window.TrevaVos) {
        window.TrevaVos.pushLog('OK', `${devLabel} updated`, 'ok');
        syncVosState();
      }
    } catch (err) {
      if (dev && prevSnapshot) {
        Object.assign(dev, prevSnapshot);
        renderSmartDevices(true);
      }
      if (window.TrevaVos) {
        window.TrevaVos.pushLog('ERR', `${devLabel}: ${err.message}`, 'error');
        syncVosState();
      }
      showToast(err.message, 'error');
    }
  }

  // Web Bluetooth BLE LED Strip/Bulb Pairing & Control
  async function pairBluetoothSmartLight() {
    if (!navigator.bluetooth || typeof navigator.bluetooth.requestDevice !== 'function') {
      showToast('Web Bluetooth requires Chrome or Edge over HTTPS (or localhost).', 'error');
      return;
    }

    try {
      const device = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: [
          0xffe5,
          0xffe0,
          0xfff0,
          0xff00,
          0xffd5,
          '0000ffe5-0000-1000-8000-00805f9b34fb',
          '0000ffe0-0000-1000-8000-00805f9b34fb',
          '0000fff0-0000-1000-8000-00805f9b34fb',
          '0000ffd5-0000-1000-8000-00805f9b34fb',
          '0000ffb0-0000-1000-8000-00805f9b34fb'
        ]
      });

      showToast(`Connecting Bluetooth GATT to ${device.name || 'LED Light'}...`);
      const server = await device.gatt.connect();
      const services = await server.getPrimaryServices();

      let writeChar = null;
      let protocol = 'triones';

      for (const svc of services) {
        const chars = await svc.getCharacteristics().catch(() => []);
        for (const ch of chars) {
          const uuid = (ch.uuid || '').toLowerCase();
          if (ch.properties.writeWithoutResponse || ch.properties.write) {
            writeChar = ch;
            if (uuid.includes('fff3') || /elk|bledom|melk|lotus/i.test(device.name || '')) {
              protocol = 'elk';
            } else if (uuid.includes('ff01')) {
              protocol = 'zengge';
            } else {
              protocol = 'triones';
            }
            break;
          }
        }
        if (writeChar) break;
      }

      if (!writeChar) {
        throw new Error('No writable Bluetooth LED characteristic found on this device');
      }

      const existingIdx = bleDevices.findIndex((b) => b.id === device.id);
      const entry = {
        id: device.id,
        name: device.name || 'Bluetooth LED',
        device,
        writeChar,
        protocol,
        power: true,
        r: 255,
        g: 255,
        b: 255,
        brightness: 100
      };

      device.addEventListener('gattserverdisconnected', () => {
        bleDevices = bleDevices.filter((b) => b.id !== device.id);
        renderSmartDevices(true);
        showToast(`${entry.name} Bluetooth disconnected`);
      });

      if (existingIdx !== -1) bleDevices[existingIdx] = entry;
      else bleDevices.push(entry);

      renderSmartDevices(true);
      showToast(`Paired Bluetooth light: ${entry.name}`, 'success');
    } catch (err) {
      if (err && err.name !== 'NotFoundError') {
        showToast(`Bluetooth pair error: ${err.message}`, 'error');
      }
    }
  }

  async function writeBleBytes(char, bytes) {
    const arr = new Uint8Array(bytes);
    if (char.properties.writeWithoutResponse && typeof char.writeValueWithoutResponse === 'function') {
      await char.writeValueWithoutResponse(arr);
    } else {
      await char.writeValue(arr);
    }
  }

  async function controlBleDevice(bleId, cmd, opts = {}) {
    const dev = bleDevices.find((b) => b.id === bleId);
    if (!dev || !dev.writeChar) return;
    if (!dev.device.gatt.connected) {
      await dev.device.gatt.connect();
    }

    if (cmd.power !== undefined) {
      dev.power = Boolean(cmd.power);
      let pkt;
      if (dev.protocol === 'elk') {
        pkt = dev.power
          ? [0x7e, 0x00, 0x04, 0xf0, 0x00, 0x01, 0xff, 0x00, 0xef]
          : [0x7e, 0x00, 0x04, 0x00, 0x00, 0x00, 0xff, 0x00, 0xef];
      } else if (dev.protocol === 'zengge') {
        pkt = dev.power ? [0x71, 0x23, 0x0f, 0xa3] : [0x71, 0x24, 0x0f, 0xa4];
      } else {
        pkt = dev.power ? [0xcc, 0x23, 0x33] : [0xcc, 0x24, 0x33];
      }
      await writeBleBytes(dev.writeChar, pkt);
    }

    if (cmd.r !== undefined && cmd.g !== undefined && cmd.b !== undefined) {
      dev.r = cmd.r;
      dev.g = cmd.g;
      dev.b = cmd.b;
      if (cmd.brightness !== undefined) dev.brightness = cmd.brightness;
      const scale = Math.max(0.05, Math.min(1, (dev.brightness || 100) / 100));
      const r = Math.round(dev.r * scale);
      const g = Math.round(dev.g * scale);
      const b = Math.round(dev.b * scale);
      dev.power = true;

      let pkt;
      if (dev.protocol === 'elk') {
        pkt = [0x7e, 0x00, 0x05, 0x03, r, g, b, 0x00, 0xef];
      } else if (dev.protocol === 'zengge') {
        const raw = [0x31, r, g, b, 0x00, 0xf0, 0x0f];
        raw.push(raw.reduce((a, x) => a + x, 0) & 0xff);
        pkt = raw;
      } else {
        pkt = [0x56, r, g, b, 0x00, 0xf0, 0xaa];
      }
      await writeBleBytes(dev.writeChar, pkt);
    }

    renderSmartDevices(true);
    if (window.TrevaVos) {
      if (typeof window.TrevaVos.recordSystemUsage === 'function') {
        if (opts && opts.isAmbientSync) {
          window.TrevaVos.recordSystemUsage('lights', `Ambient -> ${dev.name}`, {
            isAmbientSync: true,
            boost: 0.08,
            countEvent: false
          });
        } else {
          const isOff = cmd.power === false;
          window.TrevaVos.recordSystemUsage(
            'lights',
            `BLE ${dev.name}${isOff ? ' OFF' : ''}`,
            isOff ? { damp: true, boost: 0 } : { boost: 0.34 }
          );
        }
      }
      if (!opts || !opts.isAmbientSync) {
        window.TrevaVos.pulseCommandJoin();
        window.TrevaVos.pushLog('BLE', `${dev.name} -> ${JSON.stringify(cmd)}`, 'ok');
      }
      syncVosState();
    }
  }

  function renderSmartDevices(force = false) {
    const wifiList = smartDevices || [];
    const bleList = bleDevices || [];

    const isLocalEnv = Boolean(serverInfo && serverInfo.isLocalEnvironment);
    const tuyaCloudConfigured = Boolean(smartConfig && smartConfig.tuya && smartConfig.tuya.configured);
    const mhCloudConfigured = Boolean(smartConfig && smartConfig.magicHome && smartConfig.magicHome.configured);

    const sig = JSON.stringify({
      wifi: wifiList.map((d) => [
        d.id, d.platform, d.name, d.ip, d.mac, d.version, d.hasLocalKey,
        d.power, d.brightness, d.temp, d.workMode, d.battery, d.vacuumMode, d.vacuumCleaning, d.r, d.g, d.b,
        Array.isArray(d.functions) ? d.functions.length : 0
      ]),
      ble: bleList.map((b) => [b.id, b.name, b.power, b.brightness, b.r, b.g, b.b]),
      tuyaCfg: tuyaCloudConfigured,
      mhCfg: mhCloudConfigured,
      local: isLocalEnv,
      sceneLinksLen: Array.isArray(smartSceneLinks) ? smartSceneLinks.length : 0,
      sliceScenesSig: JSON.stringify(sliceSceneMap || {})
    });
    const hasBusySceneChip = Boolean(
      smartDevicesGrid.querySelector('.smart-ir-scene-chip.is-running, .smart-ir-scene-chip.is-done')
    );
    if (!force && (sig === lastSmartSig || hasBusySceneChip)) return;
    lastSmartSig = sig;
    updateSmartAndCastCounters();

    if (wifiList.length === 0 && bleList.length === 0) {
      smartDevicesGrid.innerHTML = `
        <div class="empty-devices" style="grid-column:1 / -1;">
          <p>No Smart Life, Magic Home or Bluetooth devices in your local session yet.</p>
          <span class="empty-sub">${
            isLocalEnv
              ? 'Open <strong>Keys</strong> to enter your own Smart Life / Magic Home IDs and passwords, click <strong>+ Add Device</strong> for local keys, or click <strong>Scan Wi-Fi</strong> / <strong>Pair Bluetooth LED</strong>.'
              : 'Open <strong>Keys</strong> to enter your own Smart Life / Magic Home IDs &amp; passwords in your local browser session, <strong>+ Add Device</strong>, or <strong>Pair Bluetooth LED</strong>.'
          }</span>
        </div>
      `;
      return;
    }

    smartDevicesGrid.innerHTML = '';

    // 1. Render Wi-Fi Smart Life (Tuya) & Magic Home Devices
    wifiList.forEach((dev) => {
      const isTuya = dev.platform === 'tuya';
      const tuyaCat = String(dev.tuyaCategory || '');
      const isVirtualIr = isTuya && tuyaCat.startsWith('infrared_');
      const isVacuum = isTuya && (dev.category === 'vacuum' || tuyaCat === 'sd');
      const isIrHub = isTuya && (dev.category === 'ir_hub' || tuyaCat === 'wnykq');
      const isLight = (dev.category || 'light') === 'light';
      const hexColor = rgbToHex(dev.r ?? 255, dev.g ?? 255, dev.b ?? 255);
      const bri = dev.brightness ?? 100;
      const fnCodes = Array.isArray(dev.functions) ? dev.functions.map((f) => String(f.code || '')) : [];

      let keyTag = '';
      if (isTuya) {
        if (isVirtualIr) {
          keyTag = `<span class="device-kind-tag">IR Virtual Remote</span>`;
        } else if (isIrHub) {
          keyTag = `<span class="device-kind-tag">IR Hub</span>`;
        } else if (isLocalEnv && dev.hasLocalKey && dev.ip) {
          keyTag = `<span class="device-kind-tag smart-key-ok">LAN Key OK (v${escapeHtml(dev.version || '3.3')})</span>`;
        } else if (tuyaCloudConfigured) {
          keyTag = `<span class="device-kind-tag smart-key-ok">Tuya Cloud</span>`;
        } else if (dev.hasLocalKey) {
          keyTag = `<span class="device-kind-tag smart-key-ok">LAN Key OK (v${escapeHtml(dev.version || '3.3')})</span>`;
        } else {
          keyTag = `<span class="device-kind-tag smart-key-warn">Needs Key / Sync</span>`;
        }
      } else {
        if (isLocalEnv && dev.ip) {
          keyTag = dev.mac && mhCloudConfigured
            ? `<span class="device-kind-tag smart-key-ok">LAN :${dev.port || 5577} + Cloud</span>`
            : `<span class="device-kind-tag smart-key-ok">LAN :${dev.port || 5577}</span>`;
        } else if (dev.mac && mhCloudConfigured) {
          keyTag = `<span class="device-kind-tag smart-key-ok">Magic Home Cloud</span>`;
        } else if (dev.mac) {
          keyTag = `<span class="device-kind-tag smart-key-warn">Needs MH Login</span>`;
        } else {
          keyTag = `<span class="device-kind-tag smart-key-warn">Needs MAC / Sync</span>`;
        }
      }

      let extraHtml = '';
      if (isLight) {
        extraHtml = `
          <div class="smart-controls-row">
            <input type="color" class="color-picker-input smart-color-input" value="${hexColor}" data-id="${escapeHtml(dev.id)}" title="Color" />
            <input type="range" class="volume-slider smart-bri-slider" min="5" max="100" value="${bri}" data-id="${escapeHtml(dev.id)}" />
            <span class="volume-pct">${bri}%</span>
            ${
              !isTuya
                ? `<select class="preset-select smart-preset-select" data-id="${escapeHtml(dev.id)}" title="Magic Home Effect">
                     <option value="">Effects...</option>
                     <option value="37">7-Color Fade</option>
                     <option value="38">Red Pulse</option>
                     <option value="41">7-Color Strobe</option>
                     <option value="56">7-Color Jump</option>
                   </select>`
                : ''
            }
          </div>
          ${
            isTuya
              ? `<div class="smart-temp-row">
                   <span class="empty-sub">White Temp:</span>
                   <button type="button" class="btn btn-secondary btn-sm smart-temp-btn" data-id="${escapeHtml(dev.id)}" data-temp="10">Warm</button>
                   <button type="button" class="btn btn-secondary btn-sm smart-temp-btn" data-id="${escapeHtml(dev.id)}" data-temp="55">Neutral</button>
                   <button type="button" class="btn btn-secondary btn-sm smart-temp-btn" data-id="${escapeHtml(dev.id)}" data-temp="100">Cool</button>
                 </div>`
              : ''
          }
        `;
      } else if (isVacuum) {
        extraHtml = `
          <div class="smart-vac-row">
            ${dev.battery !== null && dev.battery !== undefined ? `<span class="device-kind-tag smart-key-ok">${dev.battery}% Bat</span>` : ''}
            <button type="button" class="btn btn-primary btn-sm smart-vac-btn" data-id="${escapeHtml(dev.id)}" data-vac="start_clean">Clean</button>
            <button type="button" class="btn btn-secondary btn-sm smart-vac-btn" data-id="${escapeHtml(dev.id)}" data-vac="mop">Mop</button>
            <button type="button" class="btn btn-secondary btn-sm smart-vac-btn" data-id="${escapeHtml(dev.id)}" data-vac="dock">Dock</button>
            <button type="button" class="btn btn-secondary btn-sm smart-vac-btn" data-id="${escapeHtml(dev.id)}" data-vac="pause">Pause</button>
          </div>
        `;
      } else if (isVirtualIr || isIrHub) {
        const matchedScenes = getScenesForSmartCard(dev);
        const sceneChips = matchedScenes.slice(0, 6).map((sc) => (
          `<button type="button" class="smart-ir-scene-chip" data-scene-id="${escapeHtml(sc.id)}" title="Enable SmartLife scene: ${escapeHtml(sc.name)}">${escapeHtml(sc.name)}</button>`
        )).join('');
        extraHtml = `
          <div class="device-meta" style="margin-top:6px;">
            <span style="color:#7dd3fc;">IR Drivers Disabled &bull; SmartLife Created Scenes</span>
          </div>
          <div class="smart-ir-scenes-row">
            ${sceneChips || '<span class="empty-sub">Click the V.O.S. pie slice &rarr; + Assign to link a SmartLife scene.</span>'}
          </div>
        `;
      }

      const card = document.createElement('div');
      card.className = `smart-card ${dev.power ? 'on' : ''}`;
      card.innerHTML = `
        <div class="device-top">
          <div class="device-info">
            <div>
              <div class="device-name">${escapeHtml(dev.name || dev.id)}</div>
              <div class="device-meta" style="margin-top:4px;">
                <span class="device-kind-tag ${isTuya ? 'smart-badge-tuya' : 'smart-badge-mh'}">${isTuya ? 'Smart Life' : 'Magic Home'}</span>
                ${keyTag}
                ${dev.ip ? `<span>${escapeHtml(dev.ip)}</span>` : ''}
              </div>
            </div>
          </div>
          <div class="device-actions">
            ${
              !isVirtualIr && !isIrHub
                ? `<button type="button" class="btn ${dev.power ? 'btn-danger' : 'btn-primary'} btn-sm smart-power-btn" data-id="${escapeHtml(dev.id)}" data-next="${!dev.power}">
                     ${dev.power ? 'Turn Off' : 'Turn On'}
                   </button>`
                : ''
            }
            <button type="button" class="btn btn-secondary btn-sm smart-del-btn" data-id="${escapeHtml(dev.id)}" title="Remove">&times;</button>
          </div>
        </div>
        ${extraHtml}
      `;
      smartDevicesGrid.appendChild(card);
    });

    // 2. Render Paired Web Bluetooth BLE Lights
    bleList.forEach((ble) => {
      const hexColor = rgbToHex(ble.r, ble.g, ble.b);
      const card = document.createElement('div');
      card.className = `smart-card ${ble.power ? 'on' : ''}`;
      card.innerHTML = `
        <div class="device-top">
          <div class="device-info">
            <div>
              <div class="device-name">${escapeHtml(ble.name)}</div>
              <div class="device-meta" style="margin-top:4px;">
                <span class="device-kind-tag smart-badge-ble">Bluetooth BLE</span>
                <span class="device-kind-tag smart-key-ok">Connected</span>
              </div>
            </div>
          </div>
          <div class="device-actions">
            <button type="button" class="btn ${ble.power ? 'btn-danger' : 'btn-primary'} btn-sm ble-power-btn" data-id="${escapeHtml(ble.id)}" data-next="${!ble.power}">
              ${ble.power ? 'Turn Off' : 'Turn On'}
            </button>
          </div>
        </div>
        <div class="smart-controls-row">
          <input type="color" class="color-picker-input ble-color-input" value="${hexColor}" data-id="${escapeHtml(ble.id)}" />
          <input type="range" class="volume-slider ble-bri-slider" min="5" max="100" value="${ble.brightness}" data-id="${escapeHtml(ble.id)}" />
          <span class="volume-pct">${ble.brightness}%</span>
        </div>
      `;
      smartDevicesGrid.appendChild(card);
    });

    // Bind Wi-Fi smart handlers
    smartDevicesGrid.querySelectorAll('.smart-power-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        controlWifiSmartDevice(btn.dataset.id, { power: btn.dataset.next === 'true' });
      });
    });

    smartDevicesGrid.querySelectorAll('.smart-del-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const res = await fetch(apiUrl('smart_remove'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deviceId: btn.dataset.id })
        });
        const data = await res.json();
        if (Array.isArray(data.smartDevices)) {
          smartDevices = data.smartDevices;
          renderSmartDevices(true);
          persistSessionVaultFromResponse(data);
          syncVosState();
        }
      });
    });

    smartDevicesGrid.querySelectorAll('.smart-color-input').forEach((inp) => {
      inp.addEventListener('input', () => lockDomRefresh(3000));
      inp.addEventListener('change', () => {
        const { r, g, b } = hexToRgb(inp.value);
        controlWifiSmartDevice(inp.dataset.id, { r, g, b, power: true });
      });
    });

    smartDevicesGrid.querySelectorAll('.smart-bri-slider').forEach((slider) => {
      const pct = slider.parentElement.querySelector('.volume-pct');
      slider.addEventListener('input', () => {
        lockDomRefresh(3000);
        if (pct) pct.textContent = `${slider.value}%`;
      });
      slider.addEventListener('change', () => {
        controlWifiSmartDevice(slider.dataset.id, { brightness: Number(slider.value), power: true });
      });
    });

    smartDevicesGrid.querySelectorAll('.smart-preset-select').forEach((sel) => {
      sel.addEventListener('change', () => {
        if (!sel.value) return;
        controlWifiSmartDevice(sel.dataset.id, { preset: Number(sel.value), speed: 65, power: true });
        sel.value = '';
      });
    });

    smartDevicesGrid.querySelectorAll('.smart-temp-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        controlWifiSmartDevice(btn.dataset.id, { color_temp_pct: Number(btn.dataset.temp), power: true });
      });
    });

    smartDevicesGrid.querySelectorAll('.smart-vac-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        controlWifiSmartDevice(btn.dataset.id, { vacuum_action: btn.dataset.vac });
      });
    });

    smartDevicesGrid.querySelectorAll('.smart-ir-scene-chip').forEach((btn) => {
      btn.addEventListener('click', () => {
        const sid = btn.dataset.sceneId || '';
        const sc = (smartScenes?.scenes || []).find((x) => x.id === sid)
          || (smartSceneLinks || []).find((x) => x.id === sid);
        if (sc) triggerSmartSceneItem(sc, btn);
      });
    });

    // Bind BLE smart handlers
    smartDevicesGrid.querySelectorAll('.ble-power-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        controlBleDevice(btn.dataset.id, { power: btn.dataset.next === 'true' }).catch((e) =>
          showToast(e.message, 'error')
        );
      });
    });

    smartDevicesGrid.querySelectorAll('.ble-color-input').forEach((inp) => {
      inp.addEventListener('change', () => {
        const { r, g, b } = hexToRgb(inp.value);
        controlBleDevice(inp.dataset.id, { r, g, b }).catch((e) => showToast(e.message, 'error'));
      });
    });

    smartDevicesGrid.querySelectorAll('.ble-bri-slider').forEach((slider) => {
      const pct = slider.parentElement.querySelector('.volume-pct');
      slider.addEventListener('input', () => {
        lockDomRefresh(3000);
        if (pct) pct.textContent = `${slider.value}%`;
      });
      slider.addEventListener('change', () => {
        const dev = bleDevices.find((b) => b.id === slider.dataset.id);
        if (!dev) return;
        controlBleDevice(slider.dataset.id, {
          r: dev.r,
          g: dev.g,
          b: dev.b,
          brightness: Number(slider.value)
        }).catch((e) => showToast(e.message, 'error'));
      });
    });
  }

  // Ambient Sync Engine (Audio Spectrum or Video Edge Color -> Active Smart Lights)
  function sampleAmbientColor(freqBins) {
    if (streamMode === 'video' && screenPreview && screenPreview.videoWidth > 0) {
      try {
        if (!ambientCanvas) {
          ambientCanvas = document.createElement('canvas');
          ambientCanvas.width = 12;
          ambientCanvas.height = 12;
          ambientCtx = ambientCanvas.getContext('2d', { willReadFrequently: true });
        }
        ambientCtx.drawImage(screenPreview, 0, 0, 12, 12);
        const px = ambientCtx.getImageData(0, 0, 12, 12).data;
        let r = 0, g = 0, b = 0;
        const count = px.length / 4;
        for (let i = 0; i < px.length; i += 4) {
          r += px[i];
          g += px[i + 1];
          b += px[i + 2];
        }
        return { r: Math.round(r / count), g: Math.round(g / count), b: Math.round(b / count) };
      } catch (_) {}
    }

    // Audio spectrum energy -> vivid Hue + Brightness
    let bass = 0, treble = 0;
    const mid = Math.floor(freqBins.length / 2);
    for (let i = 0; i < freqBins.length; i++) {
      if (i < mid) bass += freqBins[i];
      else treble += freqBins[i];
    }
    const bassNorm = bass / (mid * 255 || 1);
    const trebleNorm = treble / ((freqBins.length - mid) * 255 || 1);
    const hue = (bassNorm * 260 + trebleNorm * 140) % 360;
    const lightness = Math.max(0.2, Math.min(0.55, 0.25 + (bassNorm + trebleNorm) * 0.25));
    return hslToRgb(hue, 0.92, lightness);
  }

  function maybeSyncAmbientLights(freqBins) {
    const now = Date.now();
    if (now - lastAmbientSend < 750) return;

    const rgb = sampleAmbientColor(freqBins);
    const delta =
      Math.abs(rgb.r - lastAmbientRgb.r) +
      Math.abs(rgb.g - lastAmbientRgb.g) +
      Math.abs(rgb.b - lastAmbientRgb.b);
    if (delta < 28) return;

    lastAmbientSend = now;
    lastAmbientRgb = rgb;

    // 1. Update powered BLE devices
    bleDevices.forEach((ble) => {
      if (ble.power) {
        controlBleDevice(ble.id, { r: rgb.r, g: rgb.g, b: rgb.b }, { isAmbientSync: true }).catch(() => {});
      }
    });

    // 2. Update powered Wi-Fi lights (fast for LAN Magic Home & Tuya LocalKey, 2.5s cap for Tuya Cloud)
    const allowCloud = now - lastAmbientCloudSend > 2500;
    if (allowCloud) lastAmbientCloudSend = now;

    let wifiAmbientSent = 0;
    (smartDevices || []).forEach((dev) => {
      if (!dev.power || (dev.category || 'light') !== 'light') return;
      const isLocalFast =
        (dev.platform === 'magichome' && dev.ip && serverInfo && serverInfo.isLocalEnvironment) ||
        (dev.platform === 'tuya' && dev.ip && dev.hasLocalKey && serverInfo && serverInfo.isLocalEnvironment);
      if (isLocalFast || allowCloud) {
        wifiAmbientSent += 1;
        fetch(apiUrl('smart_control'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deviceId: dev.id, r: rgb.r, g: rgb.g, b: rgb.b })
        }).catch(() => {});
      }
    });
    if (wifiAmbientSent > 0 && window.TrevaVos && typeof window.TrevaVos.recordSystemUsage === 'function') {
      window.TrevaVos.recordSystemUsage('lights', 'Ambient Light Sync', {
        isAmbientSync: true,
        boost: 0.08,
        countEvent: false
      });
    }
  }

  // Smart Section Button & Form Wiring
  scanSmartWifiBtn.addEventListener('click', () => {
    discoverSmartWifi(false);
    discoverLocalDevices(true);
  });
  if (smartTabScanCastBtn) {
    smartTabScanCastBtn.addEventListener('click', () => discoverLocalDevices(false));
  }
  if (modalScanCastBtn) {
    modalScanCastBtn.addEventListener('click', () => discoverLocalDevices(false));
  }
  if (modalSelectBtBtn && selectBtAudioBtn) {
    modalSelectBtBtn.addEventListener('click', () => {
      smartKeysModal.classList.add('hidden');
      selectBtAudioBtn.click();
    });
  }
  syncSmartCloudBtn.addEventListener('click', () => syncSmartCloud('all'));
  pairBleLightBtn.addEventListener('click', () => pairBluetoothSmartLight());
  addSmartManualBtn.addEventListener('click', () => smartManualForm.classList.toggle('hidden'));

  smartManualPlatform.addEventListener('change', () => {
    const isTuya = smartManualPlatform.value === 'tuya';
    smartTuyaExtraRow.classList.toggle('hidden', !isTuya);
    smartMhSaveRow.classList.toggle('hidden', isTuya);
  });

  smartManualForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const res = await fetch(apiUrl('smart_add_manual'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform: smartManualPlatform.value,
          name: smartManualName.value,
          ip: smartManualIp.value,
          mac: smartManualMac ? smartManualMac.value : '',
          deviceId: smartManualDevId.value,
          localKey: smartManualLocalKey.value,
          version: smartManualVersion.value,
          category: smartManualCategory.value
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not save smart device');
      smartManualForm.reset();
      smartTuyaExtraRow.classList.remove('hidden');
      smartMhSaveRow.classList.add('hidden');
      smartManualForm.classList.add('hidden');
      applySyncedScenesData(data);
      persistSessionVaultFromResponse(data);
      if (data.warning) {
        showToast(data.warning, 'info');
      } else {
        showToast('Smart device saved!', 'success');
      }
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Smart Keys / Tokens Modal & Local Session Cache
  if (localCacheModeSelect) {
    localCacheModeSelect.value = getLocalCacheMode();
    localCacheModeSelect.addEventListener('change', () => {
      setLocalCacheMode(localCacheModeSelect.value);
      showToast(
        getLocalCacheMode() === 'session'
          ? 'Switched to Temporary Tab Session only (wipes when browser closes).'
          : 'Switched to Browser Local Cache (saved only in this browser).',
        'info'
      );
    });
  }
  if (clearLocalSessionBtn) {
    clearLocalSessionBtn.addEventListener('click', () => clearLocalSession());
  }
  if (clearSessionOpenAiBtn) {
    clearSessionOpenAiBtn.addEventListener('click', async () => {
      try {
        const res = await fetch(apiUrl('smart_config_save'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ openai: { clearApiKey: true } })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Could not clear OpenAI key');
        if (data.smartConfig) {
          smartConfig = data.smartConfig;
        }
        persistSessionVaultFromResponse(data);
        if (openAiKeyInput) openAiKeyInput.value = '';
        populateSmartConfigForm();
        showToast('Cleared local OpenAI key (using server fallback if configured).', 'info');
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }
  openSmartKeysBtn.addEventListener('click', () => {
    populateSmartConfigForm();
    smartKeysModal.classList.remove('hidden');
  });
  closeSmartKeysBtn.addEventListener('click', () => smartKeysModal.classList.add('hidden'));
  smartKeysModal.addEventListener('click', (e) => {
    if (e.target === smartKeysModal) smartKeysModal.classList.add('hidden');
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (vosFullscreenOpen) {
        exitVosFullscreen(false);
      }
      smartKeysModal.classList.add('hidden');
      qrModal.classList.add('hidden');
    }
  });

  smartKeysForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const rawUidOrDev = tuyaUidInput.value.trim();
    const firstLanTuya = (smartDevices || []).find((d) => d.platform === 'tuya');
    let uidVal = '';
    let sampleDevVal = firstLanTuya ? firstLanTuya.id : '';

    if (rawUidOrDev !== '') {
      const isKnownDevId = (smartDevices || []).some((d) => d.platform === 'tuya' && d.id === rawUidOrDev);
      if (isKnownDevId || !/^(az|ay|eu|us|in|cn)\d{8,}/i.test(rawUidOrDev)) {
        sampleDevVal = rawUidOrDev;
      } else {
        uidVal = rawUidOrDev;
      }
    }

    try {
      const savePayload = {
        tuya: {
          accessId: tuyaAccessIdInput.value.trim(),
          accessSecret: tuyaAccessSecretInput.value.trim(),
          region: tuyaRegionSelect.value,
          uid: uidVal,
          sampleDeviceId: sampleDevVal
        },
        magicHome: {
          email: mhEmailInput.value.trim(),
          password: mhPasswordInput.value,
          region: mhRegionSelect.value
        }
      };
      if (mhTokenInput.value.trim() !== '') {
        savePayload.magicHome.token = mhTokenInput.value.trim();
      }
      if (openAiKeyInput) {
        savePayload.openai = {
          apiKey: openAiKeyInput.value.trim(),
          voice: openAiVoiceModalSelect ? openAiVoiceModalSelect.value : 'verse',
          model: aiModelSelect ? aiModelSelect.value : 'gpt-realtime-mini'
        };
      }
      if (googleNestProjectIdInput || googleNestClientIdInput) {
        savePayload.googleNest = {
          projectId: googleNestProjectIdInput ? googleNestProjectIdInput.value.trim() : '',
          clientId: googleNestClientIdInput ? googleNestClientIdInput.value.trim() : '',
          clientSecret: googleNestClientSecretInput ? googleNestClientSecretInput.value.trim() : '',
          refreshToken: googleNestRefreshTokenInput ? googleNestRefreshTokenInput.value.trim() : ''
        };
      }

      const saveRes = await fetch(apiUrl('smart_config_save'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(savePayload)
      });
      const saveData = await saveRes.json();
      if (!saveRes.ok) throw new Error(saveData.error || 'Failed to save smart keys');
      if (saveData.smartConfig) {
        smartConfig = saveData.smartConfig;
        populateSmartConfigForm();
      }
      persistSessionVaultFromResponse(saveData);

      smartKeysModal.classList.add('hidden');
      const hasSmartCreds = Boolean(
        (smartConfig && smartConfig.tuya && smartConfig.tuya.configured) ||
        (smartConfig && smartConfig.magicHome && smartConfig.magicHome.configured)
      );
      if (hasSmartCreds) {
        showToast('Saved to local session! Syncing devices...', 'info');
        await syncSmartCloud('all');
      } else {
        showToast('Saved settings to your local session cache!', 'success');
        syncVosState();
      }
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // ===========================================================================
  // ENDPOINT COPY & QR MODAL
  // ===========================================================================
  copyMp3UrlBtn.addEventListener('click', () => {
    const url = serverInfo && serverInfo.streamEndpoints ? serverInfo.streamEndpoints.audio : '';
    if (url) {
      navigator.clipboard.writeText(url);
      showToast(`Copied MP3 stream URL: ${url}`, 'success');
    }
  });

  copyWebmUrlBtn.addEventListener('click', () => {
    const url = serverInfo && serverInfo.streamEndpoints ? serverInfo.streamEndpoints.video : '';
    if (url) {
      navigator.clipboard.writeText(url);
      showToast(`Copied WebM stream URL: ${url}`, 'success');
    }
  });

  openQrModalBtn.addEventListener('click', () => qrModal.classList.remove('hidden'));
  closeQrModalBtn.addEventListener('click', () => qrModal.classList.add('hidden'));
  qrModal.addEventListener('click', (e) => {
    if (e.target === qrModal) qrModal.classList.add('hidden');
  });

  networkInterfaceSelect.addEventListener('change', async () => {
    const ip = networkInterfaceSelect.value;
    await fetch(apiUrl('set_lan_ip'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ip })
    });
    await loadServerInfo();
    showToast(`Active LAN IP updated to ${ip}`, 'success');
  });

  // ===========================================================================
  // SMART SCENES STRIP & OPENAI SMART HOUSE VOICE AGENT
  // ===========================================================================
  function getScenesForSmartCard(dev) {
    if (!dev || !dev.id) return [];
    if (window.TrevaVos && typeof window.TrevaVos.getScenesForDevice === 'function') {
      const list = window.TrevaVos.getScenesForDevice(dev);
      if (Array.isArray(list)) return list;
    }
    const devNameLow = String(dev.name || '').toLowerCase();
    const pinned = Array.isArray(sliceSceneMap[`dev:${dev.id}`]) ? sliceSceneMap[`dev:${dev.id}`] : [];
    const byId = new Map((smartScenes?.scenes || []).map((s) => [String(s.id), s]));
    const seen = new Set();
    const out = [];
    for (const sid of pinned) {
      const s = byId.get(String(sid));
      if (s && !seen.has(s.id)) {
        seen.add(s.id);
        out.push(s);
      }
    }
    for (const lnk of (smartSceneLinks || [])) {
      if (!lnk || !lnk.id || seen.has(lnk.id)) continue;
      const ids = Array.isArray(lnk.targetDeviceIds) ? lnk.targetDeviceIds.map(String) : [];
      const tgtLow = String(lnk.targetDevice || '').toLowerCase();
      if (ids.includes(String(dev.id)) || (devNameLow && tgtLow === devNameLow)) {
        seen.add(lnk.id);
        out.push(byId.get(String(lnk.id)) || lnk);
      }
    }
    return out;
  }

  function resolveSceneSystemBus(sc) {
    if (sc && sc.systemBus) return sc.systemBus;
    const lnk = sc?.id ? (smartSceneLinks || []).find((x) => x.id === sc.id) : null;
    if (lnk && lnk.systemBus) return lnk.systemBus;
    const txt = `${sc?.name || ''} ${sc?.targetDevice || lnk?.targetDevice || ''}`.toLowerCase();
    if (/sh7p|vac|aspir|clean|mop|dock/.test(txt)) return 'vacuum';
    if (/knowhere|cast|music|música|spotif|radio|sonido|audio|speaker/.test(txt)) return 'cast';
    if (/lamp|lámpara|luz|light|rgb|magic|red|bright|warm|cool|color|blaze|fireplace|lujuria|confort/.test(txt)) return 'lights';
    if (/voz|voice|hola/.test(txt)) return 'voice';
    return 'ir';
  }

  async function saveSliceSceneAssignments(sliceKey, sceneIds) {
    if (!sliceKey) return;
    sliceSceneMap = { ...sliceSceneMap, [sliceKey]: Array.isArray(sceneIds) ? [...sceneIds] : [] };
    try {
      const res = await fetch(apiUrl('smart_slice_scenes_save'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sliceKey, sceneIds: sliceSceneMap[sliceKey] })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Save slice scenes failed');
      if (data.sliceScenes && typeof data.sliceScenes === 'object') {
        sliceSceneMap = data.sliceScenes;
      }
      persistSessionVaultFromResponse(data);
      syncVosState();
      renderSmartDevices(true);
      showToast('Updated SmartLife slice routines', 'success');
    } catch (err) {
      showToast(`Failed to save slice scenes: ${err.message}`, 'error');
    }
  }

  async function triggerSmartSceneItem(sc, btn = null) {
    const scObj = typeof sc === 'string'
      ? ((smartScenes.scenes || []).find((x) => x.id === sc)
        || (smartSceneLinks || []).find((x) => x.id === sc)
        || { id: sc, name: sc })
      : sc;
    if (!scObj || !scObj.id) {
      return { ok: false, error: 'Missing scene ID' };
    }
    let succeeded = false;
    try {
      if (btn) {
        btn.disabled = true;
        btn.classList.remove('is-done');
        btn.classList.add('is-running');
      }
      if (window.TrevaVos) {
        window.TrevaVos.pulseCommandJoin();
        window.TrevaVos.pushLog('SCENE', `Trigger "${scObj.name}"`, 'info');
      }
      const res = await fetch(apiUrl('smart_trigger_scene'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sceneId: scObj.id,
          homeId: scObj.homeId || smartScenes.homeId || '',
          deviceHint: scObj.targetDevice || ''
        })
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) throw new Error(data.error || 'Scene failed');
      succeeded = true;
      const bus = resolveSceneSystemBus(scObj);
      if (window.TrevaVos) {
        if (typeof window.TrevaVos.recordSystemUsage === 'function') {
          window.TrevaVos.recordSystemUsage(bus, `Scene: ${scObj.name}`, { boost: 0.42 });
        }
        window.TrevaVos.pushLog('OK', `Scene "${scObj.name}" executed`, 'ok');
      }
      if (btn) {
        btn.classList.remove('is-running');
        btn.classList.add('is-done');
        setTimeout(() => {
          btn.classList.remove('is-done');
        }, 1450);
      }
      showToast(`Enabled SmartLife scene: ${scObj.name}`, 'success');
      return { ok: true, data };
    } catch (err) {
      if (window.TrevaVos) window.TrevaVos.pushLog('ERR', `Scene "${scObj.name}": ${err.message}`, 'error');
      showToast(`Scene error: ${err.message}`, 'error');
      return { ok: false, error: err.message };
    } finally {
      if (btn) {
        btn.disabled = false;
        if (!succeeded) btn.classList.remove('is-running', 'is-done');
      }
    }
  }

  async function saveCustomSceneVoiceLinks(sceneId, rawInput, saveBtn = null) {
    try {
      if (saveBtn) saveBtn.disabled = true;
      const phrases = rawInput
        .split(/[,\n;]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      const res = await fetch(apiUrl('smart_scene_links_save'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sceneId, voicePhrases: phrases })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not save scene voice link');
      if (Array.isArray(data.sceneLinks)) {
        smartSceneLinks = data.sceneLinks;
      }
      persistSessionVaultFromResponse(data);
      renderSmartScenes();
      showToast('Saved scene voice links!', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      if (saveBtn) saveBtn.disabled = false;
    }
  }

  function renderSmartScenes() {
    if (!smartScenesSection || !smartScenesStrip) return;
    const allScenes = Array.isArray(smartScenes && smartScenes.scenes) ? smartScenes.scenes : [];
    const linkById = new Map();
    (Array.isArray(smartSceneLinks) ? smartSceneLinks : []).forEach((lnk) => {
      if (lnk && lnk.id) linkById.set(lnk.id, lnk);
    });

    const sourceList = (Array.isArray(smartSceneLinks) && smartSceneLinks.length > 0)
      ? smartSceneLinks
      : allScenes;

    if (sourceList.length === 0) {
      smartScenesSection.classList.add('hidden');
      return;
    }
    smartScenesSection.classList.remove('hidden');

    const q = smartScenesFilter ? smartScenesFilter.value.trim().toLowerCase() : '';
    const filtered = sourceList.filter((item) => {
      if (!item || !item.name) return false;
      if (q === '') return true;
      const lnk = linkById.get(item.id) || item;
      const hay = [
        item.name,
        lnk.targetDevice || '',
        lnk.parsedSummary || '',
        ...(Array.isArray(lnk.voiceCommands) ? lnk.voiceCommands : [])
      ].join(' ').toLowerCase();
      return hay.includes(q);
    });

    if (smartScenesMeta) {
      const homeLabel = smartScenes.homeName ? `${smartScenes.homeName} · ` : '';
      smartScenesMeta.textContent = `${homeLabel}${filtered.length} Tap-to-Run scene(s)`;
    }
    if (toggleSceneVoiceLinksBtn) {
      toggleSceneVoiceLinksBtn.textContent = showSceneVoiceLinks
        ? 'Compact Pills'
        : `Voice Links (${sourceList.length})`;
    }

    smartScenesStrip.classList.toggle('hidden', showSceneVoiceLinks);
    if (sceneVoiceLinksPanel) {
      sceneVoiceLinksPanel.classList.toggle('hidden', !showSceneVoiceLinks);
    }

    smartScenesStrip.innerHTML = '';
    filtered.forEach((item) => {
      const lnk = linkById.get(item.id) || item;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'scene-pill-btn';
      btn.textContent = item.name;
      btn.dataset.sceneId = item.id;
      const voicePreview = Array.isArray(lnk.voiceCommands) ? lnk.voiceCommands.slice(0, 4).join(', ') : '';
      const tipParts = [];
      if (lnk.targetDevice) tipParts.push(lnk.targetDevice);
      if (lnk.parsedSummary) tipParts.push(lnk.parsedSummary);
      if (voicePreview) tipParts.push(`Voice: ${voicePreview}`);
      if (tipParts.length > 0) btn.title = tipParts.join(' · ');
      btn.addEventListener('click', () => triggerSmartSceneItem(lnk, btn));
      smartScenesStrip.appendChild(btn);
    });

    if (!sceneVoiceLinksPanel || !showSceneVoiceLinks) return;
    sceneVoiceLinksPanel.innerHTML = '';

    filtered.forEach((item) => {
      const lnk = linkById.get(item.id) || item;
      const row = document.createElement('div');
      row.className = 'scene-link-row';

      const top = document.createElement('div');
      top.className = 'scene-link-top';

      const titleWrap = document.createElement('div');
      titleWrap.className = 'scene-link-title-wrap';
      const nameEl = document.createElement('span');
      nameEl.className = 'scene-link-name';
      nameEl.textContent = lnk.name;
      titleWrap.appendChild(nameEl);

      if (lnk.targetDevice) {
        const devTag = document.createElement('span');
        devTag.className = 'scene-link-dev';
        devTag.textContent = lnk.targetDevice;
        titleWrap.appendChild(devTag);
      }

      const actWrap = document.createElement('div');
      actWrap.className = 'scene-link-actions';

      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'btn btn-secondary btn-xs';
      editBtn.textContent = 'Bind Voice';

      const runBtn = document.createElement('button');
      runBtn.type = 'button';
      runBtn.className = 'btn btn-primary btn-xs';
      runBtn.textContent = 'Run';
      runBtn.addEventListener('click', () => triggerSmartSceneItem(lnk, runBtn));

      actWrap.appendChild(editBtn);
      actWrap.appendChild(runBtn);
      top.appendChild(titleWrap);
      top.appendChild(actWrap);
      row.appendChild(top);

      if (lnk.parsedSummary) {
        const cfgEl = document.createElement('div');
        cfgEl.className = 'scene-link-config';
        cfgEl.textContent = lnk.parsedSummary;
        row.appendChild(cfgEl);
      }

      const phrasesEl = document.createElement('div');
      phrasesEl.className = 'scene-link-phrases';
      const customSet = new Set((lnk.customPhrases || []).map((p) => p.toLowerCase()));
      (lnk.voiceCommands || []).slice(0, 8).forEach((phrase) => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = `scene-voice-chip${customSet.has(phrase.toLowerCase()) ? ' is-custom' : ''}`;
        chip.textContent = `"${phrase}"`;
        chip.title = `Run "${lnk.name}" via voice phrase "${phrase}"`;
        chip.addEventListener('click', () => triggerSmartSceneItem(lnk, chip));
        phrasesEl.appendChild(chip);
      });
      row.appendChild(phrasesEl);

      const editor = document.createElement('div');
      editor.className = 'scene-link-editor hidden';
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'text-input';
      input.placeholder = 'Custom voice commands (comma-separated, e.g. air conditioner 24, thunder 24)';
      input.value = Array.isArray(lnk.customPhrases) ? lnk.customPhrases.join(', ') : '';
      const saveBtn = document.createElement('button');
      saveBtn.type = 'button';
      saveBtn.className = 'btn btn-primary btn-xs';
      saveBtn.textContent = 'Save';
      saveBtn.addEventListener('click', () => saveCustomSceneVoiceLinks(lnk.id, input.value, saveBtn));
      editor.appendChild(input);
      editor.appendChild(saveBtn);
      row.appendChild(editor);

      editBtn.addEventListener('click', () => {
        editor.classList.toggle('hidden');
        if (!editor.classList.contains('hidden')) input.focus();
      });

      sceneVoiceLinksPanel.appendChild(row);
    });
  }

  if (smartScenesFilter) {
    smartScenesFilter.addEventListener('input', () => renderSmartScenes());
  }
  if (syncSmartScenesBtn) {
    syncSmartScenesBtn.addEventListener('click', () => syncSmartScenes(false, syncSmartScenesBtn));
  }
  document.addEventListener('visibilitychange', () => {
    if (
      document.visibilityState === 'visible' &&
      smartConfig &&
      smartConfig.tuya &&
      smartConfig.tuya.configured &&
      Date.now() - lastScenesSyncAt > 15000
    ) {
      syncSmartScenes(true);
    }
  });
  if (toggleSceneVoiceLinksBtn) {
    toggleSceneVoiceLinksBtn.addEventListener('click', () => {
      showSceneVoiceLinks = !showSceneVoiceLinks;
      renderSmartScenes();
    });
  }

  // OpenAI Agent State (Realtime WebRTC + Text / PTT Audio Fallback)
  const AI_MAX_RECONNECTS = 3;
  let aiPc = null;
  let aiDc = null;
  let aiMicStream = null;
  let aiMuted = false;
  let aiActive = false;
  let aiIntentionalStop = false;
  let aiReconnectAttempts = 0;
  let aiReconnectTimer = null;
  let aiHealthyTimer = null;
  let aiSessionRefreshTimer = null;
  let aiInstructionSyncTimer = null;
  let aiIceDisconnectTimer = null;
  let aiLastInventorySig = '';
  let aiResponseInFlight = false;
  let aiDeferredResponseCreate = false;
  const aiPendingCallIds = new Set();
  let aiHistory = [];
  let aiResponseBuffer = '';
  let aiPttRecorder = null;
  let aiPttStream = null;
  let aiPttChunks = [];
  let aiRecordingPtt = false;
  let aiPttCancelled = false;
  let vosFullscreenOpen = false;
  let vosNativeFsActive = false;
  let aiUiMode = 'idle';

  function appendAiLog(kind, text) {
    if (!aiLogFeed || !text) return null;
    aiLogFeed.classList.remove('hidden');
    if (aiToggleLogBtn) {
      aiToggleLogBtn.classList.remove('hidden');
      aiToggleLogBtn.textContent = 'Hide Log';
    }
    const div = document.createElement('div');
    div.className = `ai-msg ${kind}`;
    div.textContent = text;
    aiLogFeed.appendChild(div);
    aiLogFeed.scrollTop = aiLogFeed.scrollHeight;
    return div;
  }

  function syncVosVoiceControls(mode) {
    const clean = mode || (aiActive ? 'listening' : 'idle');
    if (vosVoiceStatusBadge) {
      vosVoiceStatusBadge.classList.remove('badge-live', 'badge-idle');
      if (clean === 'connecting') {
        vosVoiceStatusBadge.textContent = 'VOICE CONNECTING...';
        vosVoiceStatusBadge.classList.add('badge-idle');
      } else if (clean === 'listening') {
        vosVoiceStatusBadge.textContent = aiMuted ? 'VOICE MUTED' : 'VOICE LISTENING';
        vosVoiceStatusBadge.classList.add('badge-live');
      } else if (clean === 'speaking') {
        vosVoiceStatusBadge.textContent = 'AI SPEAKING';
        vosVoiceStatusBadge.classList.add('badge-live');
      } else {
        vosVoiceStatusBadge.textContent = 'VOICE STANDBY';
        vosVoiceStatusBadge.classList.add('badge-idle');
      }
    }
    if (vosMuteBtn) {
      const showMute = (clean === 'listening' || clean === 'speaking') && aiActive;
      vosMuteBtn.classList.toggle('hidden', !showMute);
      vosMuteBtn.textContent = aiMuted ? 'Unmute Mic' : 'Mute Mic';
    }
    if (vosReconnectVoiceBtn) {
      const showRetry = clean === 'idle' && !aiActive;
      vosReconnectVoiceBtn.classList.toggle('hidden', !showRetry);
    }
  }

  function setAiUiState(mode) {
    aiUiMode = mode || 'idle';
    syncVosVoiceControls(aiUiMode);
    if (window.TrevaVos) {
      window.TrevaVos.setVoiceState(mode === 'idle' ? 'idle' : mode);
    }
    if (!aiVoiceOrb || !aiStateBadge || !aiVoiceToggleBtn) return;
    aiVoiceOrb.classList.remove('listening', 'speaking');
    aiStateBadge.classList.remove('badge-live');
    aiStateBadge.classList.add('badge-idle');

    if (mode === 'connecting') {
      aiStateBadge.textContent = 'CONNECTING...';
      aiVoiceToggleBtn.textContent = 'Cancel';
      aiVoiceToggleBtn.classList.remove('btn-primary');
      aiVoiceToggleBtn.classList.add('btn-danger');
    } else if (mode === 'listening') {
      aiVoiceOrb.classList.add('listening');
      aiStateBadge.textContent = aiMuted ? 'MUTED' : 'LISTENING';
      aiStateBadge.classList.remove('badge-idle');
      aiStateBadge.classList.add('badge-live');
      aiVoiceToggleBtn.textContent = 'Stop Voice Agent';
      aiVoiceToggleBtn.classList.remove('btn-primary');
      aiVoiceToggleBtn.classList.add('btn-danger');
      if (aiMuteBtn) aiMuteBtn.classList.remove('hidden');
    } else if (mode === 'speaking') {
      aiVoiceOrb.classList.add('speaking');
      aiStateBadge.textContent = 'SPEAKING';
      aiStateBadge.classList.remove('badge-idle');
      aiStateBadge.classList.add('badge-live');
    } else {
      aiStateBadge.textContent = 'STANDBY';
      aiVoiceToggleBtn.textContent = 'Activate Voice Agent';
      aiVoiceToggleBtn.classList.remove('btn-danger');
      aiVoiceToggleBtn.classList.add('btn-primary');
      if (aiMuteBtn) {
        aiMuteBtn.classList.add('hidden');
        aiMuteBtn.textContent = 'Mute Mic';
      }
    }
  }

  function buildAiClientContext() {
    let castSdkInfo = null;
    if (activeCastSession) {
      castSdkInfo = {
        deviceName: activeCastSession.getCastDevice ? activeCastSession.getCastDevice().friendlyName : 'Cast Device',
        volumePct: remotePlayer ? Math.round((remotePlayer.volumeLevel || 0) * 100) : null,
        muted: remotePlayer ? Boolean(remotePlayer.isMuted) : false
      };
    }
    return {
      castSdk: castSdkInfo,
      bleDevices: (bleDevices || []).map((b) => ({
        id: b.id,
        name: b.name,
        power: Boolean(b.power),
        brightness: b.brightness,
        r: b.r,
        g: b.g,
        b: b.b
      }))
    };
  }

  async function executeClientActions(actions) {
    if (!Array.isArray(actions)) return;
    for (const act of actions) {
      if (!act || !act.type) continue;
      if (act.type === 'ble_control') {
        const targets = (bleDevices || []).filter((b) =>
          !act.deviceName || act.deviceName === 'all' ||
          String(b.name || '').toLowerCase().includes(String(act.deviceName).toLowerCase())
        );
        const payload = { ...(act.payload || {}) };
        if (payload.color_hex) {
          const rgb = hexToRgb(payload.color_hex);
          payload.r = rgb.r;
          payload.g = rgb.g;
          payload.b = rgb.b;
        }
        for (const b of targets) {
          await controlBleDevice(b.id, payload).catch(() => {});
        }
      } else if (act.type === 'cast_sdk' && activeCastSession) {
        if (act.action === 'stop') {
          userStoppedSdkCast = true;
          activeCastSession.endSession(true);
          updateSdkUi(null);
        } else if (act.action === 'set_volume' && remotePlayer && remotePlayerController && act.volume !== null) {
          const v = Number(act.volume) > 1 ? Number(act.volume) / 100 : Number(act.volume);
          remotePlayer.volumeLevel = Math.max(0, Math.min(1, v));
          remotePlayerController.setVolumeLevel();
        } else if ((act.action === 'mute' || act.action === 'unmute') && remotePlayerController && remotePlayer) {
          const wantMute = act.action === 'mute';
          if (Boolean(remotePlayer.isMuted) !== wantMute) {
            remotePlayerController.muteOrUnmute();
          }
        } else if (remotePlayer && remotePlayerController && remotePlayer.isMediaLoaded) {
          const paused = Boolean(remotePlayer.isPaused);
          if ((act.action === 'pause' && !paused) || (act.action === 'play' && paused) || act.action === 'toggle_play_pause') {
            remotePlayerController.playOrPause();
          } else if (['rewind', 'fast_forward', 'seek', 'restart'].includes(act.action) && remotePlayer.canSeek) {
            const step = Number(act.seconds) > 0 ? Number(act.seconds) : 15;
            const cur = Number(remotePlayer.currentTime) || 0;
            const dur = Number(remotePlayer.duration) || 0;
            let target = cur;
            if (act.action === 'rewind') target = cur - step;
            else if (act.action === 'fast_forward') target = cur + step;
            else if (act.action === 'seek') target = Number(act.positionSeconds) || 0;
            else target = 0;
            if (dur > 0) target = Math.min(dur, target);
            remotePlayer.currentTime = Math.max(0, target);
            remotePlayerController.seek();
          } else if (act.action === 'stop_media') {
            remotePlayerController.stop();
          }
        }
      }
    }
  }

  function playBase64Audio(dataUrl) {
    if (!dataUrl || !aiRemoteAudio) return;
    try {
      aiRemoteAudio.srcObject = null;
      aiRemoteAudio.src = dataUrl;
      if (window.TrevaVos) {
        aiRemoteAudio.onplay = () => { if (window.TrevaVos) window.TrevaVos.setVoiceState('speaking'); };
        aiRemoteAudio.onended = () => { if (window.TrevaVos && !aiActive) window.TrevaVos.setVoiceState('idle'); };
      }
      aiRemoteAudio.play().catch(() => {});
    } catch (_) {}
  }

  function computeAiInventorySignature() {
    const sList = (smartDevices || []).map((d) => `${d.id}:${d.name}:${d.online ? 1 : 0}:${d.power ? 1 : 0}:${d.brightness ?? ''}:${d.r ?? ''},${d.g ?? ''},${d.b ?? ''}`);
    const cList = (devices || []).map((c) => `${c.id}:${c.name}:${c.status || ''}`);
    const bList = (bleDevices || []).map((b) => `${b.id || ''}:${b.name || ''}`);
    const sceneCount = Array.isArray(smartScenes?.scenes) ? smartScenes.scenes.length : 0;
    return `${sList.join('|')}#${cList.join('|')}#${bList.join('|')}#${sceneCount}`;
  }

  function clearRealtimeTimers(keepReconnect = false) {
    if (!keepReconnect && aiReconnectTimer) {
      clearTimeout(aiReconnectTimer);
      aiReconnectTimer = null;
    }
    if (aiHealthyTimer) {
      clearTimeout(aiHealthyTimer);
      aiHealthyTimer = null;
    }
    if (aiSessionRefreshTimer) {
      clearInterval(aiSessionRefreshTimer);
      aiSessionRefreshTimer = null;
    }
    if (aiInstructionSyncTimer) {
      clearTimeout(aiInstructionSyncTimer);
      aiInstructionSyncTimer = null;
    }
    if (aiIceDisconnectTimer) {
      clearTimeout(aiIceDisconnectTimer);
      aiIceDisconnectTimer = null;
    }
  }

  function cleanupRealtimeTransport(keepReconnect = false) {
    clearRealtimeTimers(keepReconnect);
    aiResponseInFlight = false;
    aiDeferredResponseCreate = false;
    aiPendingCallIds.clear();
    if (aiDc) {
      const oldDc = aiDc;
      aiDc = null;
      oldDc.onopen = null;
      oldDc.onmessage = null;
      oldDc.onclose = null;
      oldDc.onerror = null;
      try { oldDc.close(); } catch (_) {}
    }
    if (aiPc) {
      const oldPc = aiPc;
      aiPc = null;
      oldPc.ontrack = null;
      oldPc.onconnectionstatechange = null;
      oldPc.oniceconnectionstatechange = null;
      try { oldPc.close(); } catch (_) {}
    }
    if (aiMicStream) {
      aiMicStream.getTracks().forEach((t) => {
        try { t.stop(); } catch (_) {}
      });
      aiMicStream = null;
    }
    if (aiRemoteAudio && aiRemoteAudio.srcObject) {
      try {
        const remoteTracks = typeof aiRemoteAudio.srcObject.getTracks === 'function'
          ? aiRemoteAudio.srcObject.getTracks()
          : [];
        remoteTracks.forEach((t) => { try { t.stop(); } catch (_) {} });
      } catch (_) {}
      aiRemoteAudio.srcObject = null;
    }
    if (window.TrevaVos) {
      window.TrevaVos.detachAudio();
    }
  }

  async function syncRealtimeSessionInstructions(force = false) {
    if (!aiActive || !aiDc || aiDc.readyState !== 'open') return;
    const sig = computeAiInventorySignature();
    if (!force && sig === aiLastInventorySig) return;
    try {
      const res = await fetch(apiUrl('ai_session_instructions'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientContext: buildAiClientContext() })
      });
      const data = await res.json();
      if (!res.ok || !data.instructions) return;
      if (!aiActive || !aiDc || aiDc.readyState !== 'open') return;
      aiDc.send(JSON.stringify({
        type: 'session.update',
        session: {
          type: 'realtime',
          instructions: data.instructions
        }
      }));
      aiLastInventorySig = sig;
    } catch (_) {}
  }

  function scheduleRealtimeInstructionSync() {
    if (!aiActive || !aiDc || aiDc.readyState !== 'open') return;
    if (computeAiInventorySignature() === aiLastInventorySig) return;
    if (aiInstructionSyncTimer) clearTimeout(aiInstructionSyncTimer);
    aiInstructionSyncTimer = setTimeout(() => {
      aiInstructionSyncTimer = null;
      syncRealtimeSessionInstructions(false);
    }, 650);
  }

  function flushRealtimeResponseCreate() {
    if (!aiDc || aiDc.readyState !== 'open') return;
    if (aiPendingCallIds.size > 0 || aiResponseInFlight) {
      aiDeferredResponseCreate = true;
      return;
    }
    aiDeferredResponseCreate = false;
    aiDc.send(JSON.stringify({ type: 'response.create' }));
  }

  function scheduleRealtimeReconnect(reason) {
    if (aiIntentionalStop || !aiActive || aiReconnectTimer) return;
    if (aiReconnectAttempts >= AI_MAX_RECONNECTS) {
      const msg = `Realtime connection lost (${reason}) after ${AI_MAX_RECONNECTS} retries.`;
      appendAiLog('error', msg);
      showToast(msg, 'error');
      stopRealtimeVoice(reason);
      return;
    }
    aiReconnectAttempts += 1;
    const delayMs = 1200 * aiReconnectAttempts;
    if (window.TrevaVos) {
      window.TrevaVos.pushLog('VOICE', `Realtime dropped (${reason}) — reconnecting ${aiReconnectAttempts}/${AI_MAX_RECONNECTS}...`, 'warn');
    }
    setAiUiState('connecting');
    cleanupRealtimeTransport(true);
    aiReconnectTimer = setTimeout(() => {
      aiReconnectTimer = null;
      if (aiActive && !aiIntentionalStop) {
        startRealtimeVoice(true);
      }
    }, delayMs);
  }

  function stopRealtimeVoice(reason = '') {
    aiIntentionalStop = true;
    aiActive = false;
    aiMuted = false;
    aiReconnectAttempts = 0;
    aiResponseBuffer = '';
    aiLastInventorySig = '';
    cleanupRealtimeTransport(false);
    if (window.TrevaVos) {
      window.TrevaVos.pushLog('VOICE', reason ? `Realtime voice ended (${reason})` : 'Realtime voice session ended', 'info');
    }
    setAiUiState('idle');
  }

  async function handleRealtimeToolCall(msg) {
    const fnName = msg.name || '';
    const callId = msg.call_id || '';
    if (callId) aiPendingCallIds.add(callId);
    let args = {};
    try {
      args = msg.arguments ? JSON.parse(msg.arguments) : {};
    } catch (_) {
      args = {};
    }

    appendAiLog('tool', `[Action] ${fnName}(${JSON.stringify(args)})`);
    if (window.TrevaVos) {
      window.TrevaVos.beginVoiceAction(fnName, args);
      window.TrevaVos.pushLog('TOOL', `${fnName}(${JSON.stringify(args)})`, 'info');
    }
    let toolResult = { ok: false, error: 'Tool call failed' };

    try {
      const res = await fetch(apiUrl('ai_execute_tool'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: fnName,
          arguments: args,
          clientContext: buildAiClientContext()
        })
      });
      const data = await res.json();
      toolResult = data.result || data;
      if (Array.isArray(data.clientActions)) {
        await executeClientActions(data.clientActions);
      }
      if (Array.isArray(data.smartDevices)) {
        smartDevices = data.smartDevices;
        renderSmartDevices(true);
      }
      if (Array.isArray(data.devices) && serverInfo && serverInfo.isLocalEnvironment) {
        devices = data.devices;
        renderDevices(true);
      }
      if (window.TrevaVos) {
        const resOk = toolResult && toolResult.ok !== false && !toolResult.error;
        window.TrevaVos.pushLog(resOk ? 'OK' : 'WARN', `${fnName} -> ${resOk ? 'completed' : (toolResult.error || 'warn')}`, resOk ? 'ok' : 'warn');
        syncVosState();
        window.TrevaVos.completeVoiceAction(fnName, args, toolResult);
      }
    } catch (err) {
      toolResult = { ok: false, error: err.message };
      if (window.TrevaVos) {
        window.TrevaVos.pushLog('ERR', `${fnName}: ${err.message}`, 'error');
        window.TrevaVos.completeVoiceAction(fnName, args, toolResult);
      }
    } finally {
      if (callId) aiPendingCallIds.delete(callId);
    }

    if (aiDc && aiDc.readyState === 'open' && callId) {
      let serialized = JSON.stringify(toolResult);
      if (serialized.length > 14000) {
        serialized = JSON.stringify({
          ok: Boolean(toolResult && toolResult.ok !== false),
          device: toolResult && toolResult.device ? toolResult.device : undefined,
          error: toolResult && toolResult.error ? toolResult.error : undefined,
          truncated: true
        });
      }
      aiDc.send(JSON.stringify({
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: callId,
          output: serialized
        }
      }));
      flushRealtimeResponseCreate();
    }
  }

  async function startRealtimeVoice(isReconnect = false) {
    const reconnect = isReconnect === true;
    if (aiActive && !reconnect) {
      stopRealtimeVoice('manual');
      return;
    }
    if (!window.isSecureContext || !navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function' || typeof RTCPeerConnection === 'undefined') {
      setAiUiState('idle');
      showToast('Live WebRTC Voice requires HTTPS or localhost. Use the text box below instead!', 'info');
      return;
    }

    cleanupRealtimeTransport(true);
    if (!reconnect) {
      aiIntentionalStop = false;
      aiReconnectAttempts = 0;
    }
    setAiUiState('connecting');
    aiActive = true;

    try {
      aiMicStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      if (!aiActive || aiIntentionalStop) {
        stopRealtimeVoice();
        return;
      }
      if (window.TrevaVos) {
        window.TrevaVos.attachMediaStream(aiMicStream);
        window.TrevaVos.pushLog('VOICE', reconnect ? 'Re-acquiring OpenAI Realtime WebRTC...' : 'Microphone acquired, connecting OpenAI Realtime WebRTC...', 'info');
      }

      const model = aiModelSelect ? aiModelSelect.value : 'gpt-realtime-mini';
      const voice = aiVoiceSelect ? aiVoiceSelect.value : 'verse';

      const sessRes = await fetch(apiUrl('ai_realtime_session'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          voice,
          clientContext: buildAiClientContext()
        })
      });
      const sessData = await sessRes.json();
      if (!sessRes.ok || !sessData.client_secret) {
        throw new Error(sessData.error || 'Could not initialize OpenAI Realtime voice session');
      }
      if (!aiActive || aiIntentionalStop) {
        stopRealtimeVoice();
        return;
      }

      const pc = new RTCPeerConnection();
      aiPc = pc;
      pc.ontrack = (e) => {
        if (aiRemoteAudio && e.streams && e.streams[0]) {
          aiRemoteAudio.src = '';
          aiRemoteAudio.srcObject = e.streams[0];
          aiRemoteAudio.play().catch(() => {});
          if (window.TrevaVos && typeof window.TrevaVos.attachRemoteAudioStream === 'function') {
            window.TrevaVos.attachRemoteAudioStream(e.streams[0]);
          }
        }
      };

      pc.onconnectionstatechange = () => {
        if (aiPc !== pc || !aiActive || aiIntentionalStop) return;
        const st = pc.connectionState;
        if (st === 'failed' || st === 'closed') {
          scheduleRealtimeReconnect(`webrtc_${st}`);
        }
      };

      pc.oniceconnectionstatechange = () => {
        if (aiPc !== pc || !aiActive || aiIntentionalStop) return;
        const ist = pc.iceConnectionState;
        if (ist === 'connected' || ist === 'completed') {
          if (aiIceDisconnectTimer) {
            clearTimeout(aiIceDisconnectTimer);
            aiIceDisconnectTimer = null;
          }
        } else if (ist === 'failed') {
          scheduleRealtimeReconnect('ice_failed');
        } else if (ist === 'disconnected' && !aiIceDisconnectTimer) {
          aiIceDisconnectTimer = setTimeout(() => {
            aiIceDisconnectTimer = null;
            if (aiPc === pc && aiActive && !aiIntentionalStop && (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed')) {
              scheduleRealtimeReconnect('ice_disconnected');
            }
          }, 4000);
        }
      };

      const track = aiMicStream.getAudioTracks()[0];
      if (track) pc.addTrack(track, aiMicStream);

      const dc = pc.createDataChannel('oai-events');
      aiDc = dc;
      let assistantLiveBubble = null;

      dc.onopen = () => {
        if (aiDc !== dc || !aiActive) return;
        setAiUiState('listening');
        aiLastInventorySig = computeAiInventorySignature();
        if (aiHealthyTimer) clearTimeout(aiHealthyTimer);
        aiHealthyTimer = setTimeout(() => {
          aiReconnectAttempts = 0;
        }, 30000);
        if (aiSessionRefreshTimer) clearInterval(aiSessionRefreshTimer);
        aiSessionRefreshTimer = setInterval(() => {
          syncRealtimeSessionInstructions(true);
        }, 240000);

        appendAiLog('tool', `Voice Agent ${reconnect ? 'reconnected' : 'live'} (${sessData.model}, voice: ${sessData.voice}) — speak any smart home command.`);
        if (window.TrevaVos) {
          window.TrevaVos.pushLog('VOICE', `Realtime ${reconnect ? 'reconnected' : 'live'} (${sessData.model}) — 3 planes aligned`, 'ok');
        }
      };

      dc.onmessage = (evt) => {
        let msg;
        try { msg = JSON.parse(evt.data); } catch (_) { return; }

        if (msg.type === 'input_audio_buffer.speech_started') {
          setAiUiState('listening');
        } else if (msg.type === 'conversation.item.input_audio_transcription.completed' && msg.transcript) {
          const userTxt = msg.transcript.trim();
          appendAiLog('user', userTxt);
          if (window.TrevaVos) {
            if (typeof window.TrevaVos.recordSystemUsage === 'function') {
              window.TrevaVos.recordSystemUsage('voice', `User: ${userTxt.slice(0, 42)}`, { boost: 0.28 });
            }
            window.TrevaVos.pushLog('USER', userTxt, 'info');
          }
        } else if (msg.type === 'response.created') {
          aiResponseInFlight = true;
        } else if (msg.type === 'response.output_item.added' && msg.item && msg.item.type === 'function_call' && msg.item.call_id) {
          aiPendingCallIds.add(msg.item.call_id);
        } else if (msg.type === 'response.output_audio.delta' || msg.type === 'response.audio.delta') {
          aiResponseInFlight = true;
          setAiUiState('speaking');
        } else if ((msg.type === 'response.output_audio_transcript.delta' || msg.type === 'response.audio_transcript.delta') && msg.delta) {
          aiResponseBuffer += msg.delta;
          if (!assistantLiveBubble) {
            assistantLiveBubble = appendAiLog('assistant', aiResponseBuffer);
          } else {
            assistantLiveBubble.textContent = aiResponseBuffer;
            aiLogFeed.scrollTop = aiLogFeed.scrollHeight;
          }
        } else if (msg.type === 'response.output_audio_transcript.done' || msg.type === 'response.audio_transcript.done') {
          if (aiResponseBuffer && window.TrevaVos) {
            if (typeof window.TrevaVos.recordSystemUsage === 'function') {
              window.TrevaVos.recordSystemUsage('voice', `AI: ${aiResponseBuffer.slice(0, 42)}`, { boost: 0.20, countEvent: false });
            }
            window.TrevaVos.pushLog('AI', aiResponseBuffer.slice(0, 120), 'ok');
          }
          aiResponseBuffer = '';
          assistantLiveBubble = null;
        } else if (msg.type === 'response.done') {
          aiResponseInFlight = false;
          if (aiResponseBuffer && window.TrevaVos) {
            window.TrevaVos.pushLog('AI', aiResponseBuffer.slice(0, 120), 'ok');
          }
          aiResponseBuffer = '';
          assistantLiveBubble = null;
          if (aiDeferredResponseCreate && aiPendingCallIds.size === 0 && dc.readyState === 'open') {
            aiDeferredResponseCreate = false;
            dc.send(JSON.stringify({ type: 'response.create' }));
          } else if (aiActive) {
            setAiUiState('listening');
          }
        } else if (msg.type === 'response.function_call_arguments.done') {
          handleRealtimeToolCall(msg);
        } else if (msg.type === 'error') {
          const errCode = (msg.error && msg.error.code) || '';
          if (errCode !== 'conversation_already_has_active_response') {
            aiResponseInFlight = false;
          }
          const errMsg = (msg.error && msg.error.message) || 'Realtime voice error';
          appendAiLog('error', errMsg);
          if (window.TrevaVos) window.TrevaVos.pushLog('ERR', errMsg, 'error');
        }
      };

      dc.onclose = () => {
        if (aiDc === dc && aiActive && !aiIntentionalStop) {
          scheduleRealtimeReconnect('datachannel_closed');
        }
      };

      dc.onerror = () => {
        if (aiDc === dc && aiActive && !aiIntentionalStop) {
          scheduleRealtimeReconnect('datachannel_error');
        }
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      let sdpRes = await fetch('https://api.openai.com/v1/realtime/calls', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${sessData.client_secret}`,
          'Content-Type': 'application/sdp'
        },
        body: offer.sdp
      });

      if (!sdpRes.ok) {
        sdpRes = await fetch(`https://api.openai.com/v1/realtime?model=${encodeURIComponent(sessData.model || model)}`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${sessData.client_secret}`,
            'Content-Type': 'application/sdp'
          },
          body: offer.sdp
        });
      }

      if (!sdpRes.ok) {
        const errBody = await sdpRes.text();
        throw new Error(`OpenAI WebRTC handshake failed (${sdpRes.status}): ${errBody.slice(0, 180)}`);
      }

      const answerSdp = await sdpRes.text();
      if (!aiActive || aiIntentionalStop || aiPc !== pc) {
        stopRealtimeVoice();
        return;
      }
      await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
      if (!reconnect) showToast('OpenAI Voice Agent is listening!', 'success');
    } catch (err) {
      if (reconnect && aiActive && !aiIntentionalStop && aiReconnectAttempts < AI_MAX_RECONNECTS) {
        scheduleRealtimeReconnect(err.message || 'reconnect_error');
        return;
      }
      appendAiLog('error', err.message);
      showToast(err.message, 'error');
      stopRealtimeVoice(err.message || 'error');
    }
  }

  async function sendAiCommand(text) {
    const clean = String(text || '').trim();
    if (!clean) return;
    appendAiLog('user', clean);
    if (aiSendBtn) aiSendBtn.disabled = true;
    if (window.TrevaVos) {
      window.TrevaVos.pulseCommandJoin();
      window.TrevaVos.pushLog('USER', clean, 'info');
    }

    try {
      const speak = Boolean(aiSpeakFallbackChk && aiSpeakFallbackChk.checked);
      const voice = aiVoiceSelect ? aiVoiceSelect.value : 'verse';
      const res = await fetch(apiUrl('ai_chat'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: clean,
          history: aiHistory,
          speak,
          voice,
          clientContext: buildAiClientContext()
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'AI command failed');

      if (window.TrevaVos && typeof window.TrevaVos.recordSystemUsage === 'function') {
        window.TrevaVos.recordSystemUsage('voice', `Text AI: ${clean.slice(0, 42)}`, { boost: 0.34 });
      }

      if (Array.isArray(data.executedTools)) {
        data.executedTools.forEach((t) => {
          const toolLine = `${t.tool}(${JSON.stringify(t.arguments || {})})`;
          appendAiLog('tool', `[Action] ${toolLine}`);
          if (window.TrevaVos) window.TrevaVos.pushLog('TOOL', toolLine, 'ok');
        });
      }
      if (data.reply) {
        appendAiLog('assistant', data.reply);
        if (window.TrevaVos) window.TrevaVos.pushLog('AI', data.reply.slice(0, 140), 'info');
      }
      if (Array.isArray(data.history)) aiHistory = data.history;
      if (Array.isArray(data.clientActions)) await executeClientActions(data.clientActions);
      if (Array.isArray(data.smartDevices)) {
        smartDevices = data.smartDevices;
        renderSmartDevices(true);
      }
      if (Array.isArray(data.devices) && serverInfo && serverInfo.isLocalEnvironment) {
        devices = data.devices;
        renderDevices(true);
      }
      syncVosState();
      if (window.TrevaVos && Array.isArray(data.executedTools) && data.executedTools.length > 0) {
        const lastT = data.executedTools[data.executedTools.length - 1];
        window.TrevaVos.beginVoiceAction(lastT.tool, lastT.arguments || {});
        window.TrevaVos.completeVoiceAction(lastT.tool, lastT.arguments || {}, lastT.result || { ok: true });
      }
      if (data.audioDataUrl) playBase64Audio(data.audioDataUrl);
    } catch (err) {
      appendAiLog('error', err.message);
      if (window.TrevaVos) window.TrevaVos.pushLog('ERR', err.message, 'error');
      showToast(err.message, 'error');
    } finally {
      if (aiSendBtn) aiSendBtn.disabled = false;
    }
  }

  function toggleAiMicMute() {
    if (!aiActive) return;
    aiMuted = !aiMuted;
    if (aiMicStream) {
      aiMicStream.getAudioTracks().forEach((t) => { t.enabled = !aiMuted; });
    }
    const label = aiMuted ? 'Unmute Mic' : 'Mute Mic';
    if (aiMuteBtn) aiMuteBtn.textContent = label;
    if (vosMuteBtn) vosMuteBtn.textContent = label;
    setAiUiState('listening');
  }

  function turnOffAllVoice(reason = 'fullscreen_exit') {
    if (aiRecordingPtt || (aiPttRecorder && aiPttRecorder.state !== 'inactive')) {
      aiPttCancelled = true;
      aiRecordingPtt = false;
      try {
        if (aiPttRecorder && aiPttRecorder.state !== 'inactive') {
          aiPttRecorder.stop();
        }
      } catch (_) {}
    }
    if (aiPttStream) {
      aiPttStream.getTracks().forEach((t) => { try { t.stop(); } catch (_) {} });
      aiPttStream = null;
    }

    stopRealtimeVoice(reason);

    if (aiRemoteAudio) {
      try { aiRemoteAudio.pause(); } catch (_) {}
      aiRemoteAudio.onplay = null;
      aiRemoteAudio.onended = null;
      aiRemoteAudio.srcObject = null;
      aiRemoteAudio.removeAttribute('src');
      try { aiRemoteAudio.load(); } catch (_) {}
    }
    if (aiMuteBtn) aiMuteBtn.textContent = 'Mute Mic';
    if (vosMuteBtn) vosMuteBtn.textContent = 'Mute Mic';
  }

  function getNativeFullscreenElement() {
    return document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement || null;
  }

  function isVosNativeFullscreen() {
    const fsEl = getNativeFullscreenElement();
    return Boolean(fsEl && (fsEl === cockpitShell || fsEl === vosSection || fsEl === document.documentElement));
  }

  function enterVosFullscreen() {
    const targetEl = cockpitShell || vosSection;
    if (!targetEl || vosFullscreenOpen) return;
    vosFullscreenOpen = true;
    vosNativeFsActive = false;

    document.body.classList.add('vos-fullscreen-open');
    targetEl.classList.add('is-fullscreen');
    if (vosSection) vosSection.classList.remove('hidden');
    if (openVosFullscreenBtn) {
      openVosFullscreenBtn.classList.add('is-active');
      openVosFullscreenBtn.setAttribute('aria-expanded', 'true');
      const lbl = openVosFullscreenBtn.querySelector('.vos-expand-label');
      if (lbl) lbl.textContent = 'Exit Full';
    }

    // Request native browser fullscreen synchronously inside click gesture (strictly optional overlay if unavailable)
    const reqFs = targetEl.requestFullscreen || targetEl.webkitRequestFullscreen || targetEl.msRequestFullscreen;
    if (typeof reqFs === 'function') {
      try {
        const fsPromise = reqFs.call(targetEl);
        if (fsPromise && typeof fsPromise.catch === 'function') {
          fsPromise.catch(() => {});
        }
      } catch (_) {}
    }

    if (window.TrevaVos && typeof window.TrevaVos.syncCanvasSize === 'function') {
      requestAnimationFrame(() => window.TrevaVos.syncCanvasSize());
    }
  }

  function exitVosFullscreen(fromNativeEvent = false) {
    vosFullscreenOpen = false;
    vosNativeFsActive = false;

    if (!fromNativeEvent && isVosNativeFullscreen()) {
      const exitFs = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
      if (typeof exitFs === 'function') {
        try {
          const p = exitFs.call(document);
          if (p && typeof p.catch === 'function') p.catch(() => {});
        } catch (_) {}
      }
    }

    document.body.classList.remove('vos-fullscreen-open');
    if (cockpitShell) cockpitShell.classList.remove('is-fullscreen');
    if (vosSection) {
      vosSection.classList.remove('is-fullscreen');
      vosSection.classList.remove('hidden');
    }
    if (vosToastContainer) {
      vosToastContainer.innerHTML = '';
    }
    if (openVosFullscreenBtn) {
      openVosFullscreenBtn.classList.remove('is-active');
      openVosFullscreenBtn.setAttribute('aria-expanded', 'false');
      const lbl = openVosFullscreenBtn.querySelector('.vos-expand-label');
      if (lbl) lbl.textContent = 'Fullscreen';
    }
    if (window.TrevaVos && typeof window.TrevaVos.syncCanvasSize === 'function') {
      requestAnimationFrame(() => window.TrevaVos.syncCanvasSize());
    }
  }

  function handleVosFullscreenChange() {
    if (isVosNativeFullscreen()) {
      vosNativeFsActive = true;
      if (window.TrevaVos && typeof window.TrevaVos.syncCanvasSize === 'function') {
        window.TrevaVos.syncCanvasSize();
        requestAnimationFrame(() => window.TrevaVos.syncCanvasSize());
      }
      return;
    }
    if (vosNativeFsActive && vosFullscreenOpen) {
      exitVosFullscreen(true);
    }
  }

  if (cockpitTabBtns.length && cockpitPanes.length) {
    cockpitTabBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const targetId = btn.dataset.dockPane;
        if (!targetId) return;
        cockpitTabBtns.forEach((b) => {
          const active = b === btn;
          b.classList.toggle('active', active);
          b.setAttribute('aria-selected', active ? 'true' : 'false');
        });
        cockpitPanes.forEach((pane) => {
          pane.classList.toggle('hidden', pane.id !== targetId);
        });
        if (window.TrevaVos && typeof window.TrevaVos.syncCanvasSize === 'function') {
          requestAnimationFrame(() => window.TrevaVos.syncCanvasSize());
        }
      });
    });
  }

  if (aiToggleLogBtn && aiLogFeed) {
    aiToggleLogBtn.addEventListener('click', () => {
      const willHide = !aiLogFeed.classList.contains('hidden');
      aiLogFeed.classList.toggle('hidden', willHide);
      aiToggleLogBtn.textContent = willHide ? 'Show Log' : 'Hide Log';
      if (window.TrevaVos && typeof window.TrevaVos.syncCanvasSize === 'function') {
        requestAnimationFrame(() => window.TrevaVos.syncCanvasSize());
      }
    });
  }

  if (openVosFullscreenBtn) {
    openVosFullscreenBtn.addEventListener('click', () => {
      if (vosFullscreenOpen) {
        exitVosFullscreen(false);
      } else {
        enterVosFullscreen();
      }
    });
  }

  if (vosExitFullscreenBtn) {
    vosExitFullscreenBtn.addEventListener('click', () => exitVosFullscreen(false));
  }

  if (vosMuteBtn) {
    vosMuteBtn.addEventListener('click', () => toggleAiMicMute());
  }

  if (vosReconnectVoiceBtn) {
    vosReconnectVoiceBtn.addEventListener('click', () => {
      if (!aiActive) startRealtimeVoice();
    });
  }

  document.addEventListener('fullscreenchange', handleVosFullscreenChange);
  document.addEventListener('webkitfullscreenchange', handleVosFullscreenChange);
  document.addEventListener('msfullscreenchange', handleVosFullscreenChange);

  if (aiVoiceToggleBtn) {
    aiVoiceToggleBtn.addEventListener('click', () => startRealtimeVoice());
  }

  if (aiMuteBtn) {
    aiMuteBtn.addEventListener('click', () => toggleAiMicMute());
  }

  if (aiTextForm && aiTextInput) {
    aiTextForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const val = aiTextInput.value.trim();
      if (!val) return;
      aiTextInput.value = '';
      sendAiCommand(val);
    });
  }

  if (aiQuickChips) {
    aiQuickChips.querySelectorAll('.ai-chip-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const prompt = btn.dataset.prompt || btn.textContent;
        sendAiCommand(prompt);
      });
    });
  }

  if (aiPttBtn) {
    aiPttBtn.addEventListener('click', async () => {
      if (!aiRecordingPtt) {
        if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function' || typeof MediaRecorder === 'undefined') {
          showToast('Microphone recording requires HTTPS or localhost. Type your command instead.', 'info');
          return;
        }
        try {
          aiPttCancelled = false;
          aiPttStream = await navigator.mediaDevices.getUserMedia({ audio: true });
          if (window.TrevaVos) {
            window.TrevaVos.setVoiceState('listening');
            window.TrevaVos.attachMediaStream(aiPttStream);
            window.TrevaVos.pushLog('PTT', 'Recording voice command...', 'info');
          }
          aiPttChunks = [];
          aiPttRecorder = new MediaRecorder(aiPttStream);
          aiPttRecorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) aiPttChunks.push(e.data); };
          aiPttRecorder.onstop = async () => {
            const wasCancelled = aiPttCancelled;
            aiPttCancelled = false;
            const blob = new Blob(aiPttChunks, { type: aiPttRecorder.mimeType || 'audio/webm' });
            if (aiPttStream) {
              aiPttStream.getTracks().forEach((t) => t.stop());
              aiPttStream = null;
            }
            if (window.TrevaVos) window.TrevaVos.detachAudio();
            aiPttBtn.textContent = 'Push to Talk';
            aiPttBtn.classList.remove('btn-danger');
            aiPttBtn.classList.add('btn-secondary');
            if (wasCancelled || blob.size < 400) {
              if (window.TrevaVos) window.TrevaVos.setVoiceState('idle');
              return;
            }

            const form = new FormData();
            form.append('audio', blob, 'voice.webm');
            form.append('history', JSON.stringify(aiHistory));
            form.append('clientContext', JSON.stringify(buildAiClientContext()));
            form.append('speak', aiSpeakFallbackChk && aiSpeakFallbackChk.checked ? '1' : '0');
            form.append('voice', aiVoiceSelect ? aiVoiceSelect.value : 'verse');

            try {
              aiPttBtn.disabled = true;
              if (window.TrevaVos) window.TrevaVos.setVoiceState('executing');
              const res = await fetch(apiUrl('ai_chat'), { method: 'POST', body: form });
              const data = await res.json();
              if (!res.ok) throw new Error(data.error || 'Voice command failed');
              if (window.TrevaVos && typeof window.TrevaVos.recordSystemUsage === 'function') {
                window.TrevaVos.recordSystemUsage('voice', `PTT: ${(data.transcript || 'Voice cmd').slice(0, 42)}`, { boost: 0.36 });
              }
              if (data.transcript) {
                appendAiLog('user', data.transcript);
                if (window.TrevaVos) window.TrevaVos.pushLog('USER', data.transcript, 'info');
              }
              if (Array.isArray(data.executedTools)) {
                data.executedTools.forEach((t) => {
                  const toolLine = `${t.tool}(${JSON.stringify(t.arguments || {})})`;
                  appendAiLog('tool', `[Action] ${toolLine}`);
                  if (window.TrevaVos) window.TrevaVos.pushLog('TOOL', toolLine, 'ok');
                });
              }
              if (data.reply) {
                appendAiLog('assistant', data.reply);
                if (window.TrevaVos) window.TrevaVos.pushLog('AI', data.reply.slice(0, 140), 'info');
              }
              if (Array.isArray(data.history)) aiHistory = data.history;
              if (Array.isArray(data.clientActions)) await executeClientActions(data.clientActions);
              if (Array.isArray(data.smartDevices)) {
                smartDevices = data.smartDevices;
                renderSmartDevices(true);
              }
              syncVosState();
              if (window.TrevaVos && Array.isArray(data.executedTools) && data.executedTools.length > 0) {
                const lastT = data.executedTools[data.executedTools.length - 1];
                window.TrevaVos.beginVoiceAction(lastT.tool, lastT.arguments || {});
                window.TrevaVos.completeVoiceAction(lastT.tool, lastT.arguments || {}, lastT.result || { ok: true });
              }
              if (data.audioDataUrl) playBase64Audio(data.audioDataUrl);
            } catch (err) {
              appendAiLog('error', err.message);
              if (window.TrevaVos) window.TrevaVos.pushLog('ERR', err.message, 'error');
              showToast(err.message, 'error');
            } finally {
              aiPttBtn.disabled = false;
              if (window.TrevaVos) window.TrevaVos.setVoiceState('idle');
            }
          };
          aiPttRecorder.start();
          aiRecordingPtt = true;
          aiPttBtn.textContent = 'Stop & Send';
          aiPttBtn.classList.remove('btn-secondary');
          aiPttBtn.classList.add('btn-danger');
        } catch (err) {
          showToast(`Mic error: ${err.message}`, 'error');
        }
      } else {
        aiRecordingPtt = false;
        if (aiPttRecorder && aiPttRecorder.state !== 'inactive') {
          aiPttRecorder.stop();
        }
      }
    });
  }

  // Pure Empty Hologram View Toggles + Safe ES-Module Boot
  function togglePurePanel(cls, btn) {
    if (!cockpitShell) return;
    const active = cockpitShell.classList.toggle(cls);
    if (btn) btn.classList.toggle('active', active);
    if (window.TrevaVos) {
      setTimeout(() => window.TrevaVos.syncCanvasSize(), 40);
    }
  }

  if (togglePureControlsBtn) {
    togglePureControlsBtn.addEventListener('click', () => togglePurePanel('vos-pure-controls-open', togglePureControlsBtn));
  }
  if (togglePureVoiceBtn) {
    togglePureVoiceBtn.addEventListener('click', () => togglePurePanel('vos-pure-voice-open', togglePureVoiceBtn));
  }
  if (togglePureDrawerBtn) {
    togglePureDrawerBtn.addEventListener('click', () => togglePurePanel('vos-pure-drawer-open', togglePureDrawerBtn));
  }
  if (drawerCloseBtn) {
    drawerCloseBtn.addEventListener('click', () => {
      if (cockpitShell) cockpitShell.classList.remove('vos-pure-drawer-open');
      if (togglePureDrawerBtn) togglePureDrawerBtn.classList.remove('active');
    });
  }
  if (drawerKeysBtn && openSmartKeysBtn) {
    drawerKeysBtn.addEventListener('click', () => openSmartKeysBtn.click());
  }
  if (drawerQrBtn && openQrModalBtn) {
    drawerQrBtn.addEventListener('click', () => openQrModalBtn.click());
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && cockpitShell && cockpitShell.classList.contains('vos-pure-drawer-open')) {
      cockpitShell.classList.remove('vos-pure-drawer-open');
      if (togglePureDrawerBtn) togglePureDrawerBtn.classList.remove('active');
    }
  });

  let vosBooted = false;
  function bootVosEngine() {
    if (vosBooted || !window.TrevaVos) return;
    vosBooted = true;
    window.TrevaVos.init({
      onControlSmart: (id, payload) => controlWifiSmartDevice(id, payload),
      onControlCast: (id, payload) => {
        const d = (devices || []).find((x) => x.id === id);
        if (payload && payload.volume !== undefined) {
          const level = Math.max(0, Math.min(1, Number(payload.volume) / 100));
          if (d) {
            d.volume = level;
            d.muted = false;
          }
          fetch(apiUrl('cast_volume'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ deviceId: id, level, muted: false })
          }).catch(() => {});
          renderDevices(true);
          syncVosState();
          return;
        }
        if (payload && payload.media_action) {
          if (window.TrevaVos) window.TrevaVos.pushLog('CAST', `${d ? d.name : id} -> ${payload.media_action}`, 'ok');
          const extra = {};
          if (payload.preset) extra.preset = payload.preset;
          if (payload.text) extra.text = payload.text;
          if (payload.app) extra.app = payload.app;
          handleCastMediaAction(id, payload.media_action, payload.seconds || null, extra);
          return;
        }
        if (d && window.TrevaVos) {
          window.TrevaVos.pushLog('CAST', `${d.name} (${d.host}:${d.port}) status=${d.status || 'IDLE'}`, 'info');
        }
      },
      onTriggerScene: (scene, btn) => triggerSmartSceneItem(scene, btn),
      onSaveSliceScenes: (sliceKey, sceneIds) => saveSliceSceneAssignments(sliceKey, sceneIds),
      onSyncScenes: (btn) => syncSmartScenes(false, btn),
      onCloseDrawer: () => {
        if (cockpitShell) cockpitShell.classList.remove('vos-pure-drawer-open');
        if (togglePureDrawerBtn) togglePureDrawerBtn.classList.remove('active');
      }
    });
    syncVosState();
    renderSmartDevices(true);
  }
  window.addEventListener('treva:vos-ready', bootVosEngine);
  bootVosEngine();
  loadServerInfo();
  startStatePolling();
})();
