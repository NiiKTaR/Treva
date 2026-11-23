<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <title>Treva Cast &mdash; V.O.S. Higgs-Field Holographic Smart Hub</title>
  <script>
    // Google Cast SDK, Screen Capture & Web Bluetooth require HTTPS on remote domains (keep HTTP only for localhost / local LAN IPs)
    if (
      window.location.protocol === 'http:' &&
      !/^(localhost|127\.0\.0\.1|\[::1\]|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(window.location.hostname)
    ) {
      window.location.replace('https://' + window.location.host + window.location.pathname + window.location.search + window.location.hash);
    }
  </script>
  <meta name="theme-color" content="#081124" />
  <meta name="application-name" content="Treva" />
  <meta name="mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
  <meta name="apple-mobile-web-app-title" content="Treva" />
  <link rel="manifest" href="manifest.webmanifest" />
  <link rel="icon" type="image/png" sizes="192x192" href="assets/icons/icon-192.png" />
  <link rel="icon" type="image/png" sizes="512x512" href="assets/icons/icon-512.png" />
  <link rel="apple-touch-icon" sizes="180x180" href="assets/icons/apple-touch-icon.png" />
  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2338bdf8' stroke-width='2'%3E%3Ccircle cx='12' cy='12' r='3'/%3E%3Cellipse cx='12' cy='12' rx='10' ry='4.5' transform='rotate(30 12 12)'/%3E%3Cellipse cx='12' cy='12' rx='10' ry='4.5' transform='rotate(-30 12 12)'/%3E%3C/svg%3E" />
  <link rel="stylesheet" href="assets/css/styles.css?v=6.19" />
  <script type="importmap">
    {
      "imports": {
        "three": "./assets/vendor/three/build/three.module.min.js",
        "three/addons/": "./assets/vendor/three/addons/"
      }
    }
  </script>
  <!-- Official Google Cast Chrome Sender SDK (stub registered early so async load never misses callback) -->
  <script>
    window.__trevaCastAvailable = null;
    window.__trevaCastScriptError = false;
    window['__onGCastApiAvailable'] = function (isAvailable) {
      window.__trevaCastAvailable = Boolean(isAvailable);
      if (typeof window.__trevaInitCast === 'function') {
        window.__trevaInitCast(window.__trevaCastAvailable);
      }
    };
  </script>
  <script src="https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1" async onerror="window.__trevaCastScriptError = true;"></script>
</head>
<body>
  <div class="app-shell cockpit-shell vos-pure-mode" id="cockpitShell">
    <!-- Compact Unified Topbar -->
    <header class="topbar">
      <div class="brand">
        <div class="brand-logo" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8">
            <circle cx="12" cy="12" r="2.6" fill="currentColor" stroke="none" />
            <ellipse cx="12" cy="12" rx="10" ry="4.4" transform="rotate(30 12 12)" />
            <ellipse cx="12" cy="12" rx="10" ry="4.4" transform="rotate(-30 12 12)" />
            <ellipse cx="12" cy="12" rx="4.4" ry="10" />
          </svg>
        </div>
        <div class="brand-title-row">
          <h1>Treva</h1>
          <span class="sci-tag">V.O.S. // H<sup>0</sup> SMART HUB</span>
        </div>
      </div>

      <div class="topbar-actions">
        <div class="status-pill" id="connectionPill">
          <span class="dot" id="serverDot"></span>
          <span id="serverStatusText">Connecting...</span>
        </div>

        <button class="btn btn-secondary btn-sm" id="openSmartKeysBtn" type="button" title="Smart Life (Tuya), Magic Home & OpenAI Keys">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
          </svg>
          <span>Keys</span>
        </button>

        <button class="btn btn-secondary btn-sm" id="openQrModalBtn" type="button" title="Mobile Access & Network Info">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
            <line x1="12" y1="18" x2="12.01" y2="18" />
          </svg>
          <span>Mobile / QR</span>
        </button>

        <button class="btn btn-secondary btn-sm" id="installAppBtn" type="button" title="Install or open Treva as a Chrome App">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="4" width="18" height="14" rx="2" />
            <path d="M8 20h8M12 14V8m0 6l-2.5-2.5M12 14l2.5-2.5" />
          </svg>
          <span id="installAppBtnLabel">Chrome App</span>
        </button>

        <button class="btn btn-secondary btn-sm vos-expand-btn" id="openVosFullscreenBtn" type="button" title="Toggle Fullscreen (Optional)" aria-expanded="false" aria-controls="vosSection">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M8 3H5a2 2 0 0 0-2 2v3" />
            <path d="M16 3h3a2 2 0 0 1 2 2v3" />
            <path d="M8 21H5a2 2 0 0 1-2-2v-3" />
            <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
          </svg>
          <span class="vos-expand-label">Fullscreen</span>
        </button>
      </div>
    </header>

    <!-- Secure Context / Mobile Browser Info Banner -->
    <div class="alert-banner hidden" id="insecureContextBanner">
      <div class="alert-content">
        <strong>Screen Capture Unavailable on Non-HTTPS Origin:</strong>
        <span>Browsers only allow screen &amp; system audio capture on <strong>HTTPS</strong> or <code>localhost</code>. Open this app via HTTPS on your hosting server or use this device as a Remote Control.</span>
      </div>
    </div>

    <!-- Single-Viewport Cockpit Workspace -->
    <main class="cockpit-workspace">
      <!-- Left Primary Stage: Always-On V.O.S. 3D Hologram + Persistent OpenAI Voice Bar -->
      <div class="cockpit-stage">
        <section class="card vos-section" id="vosSection" aria-label="V.O.S. 3D Volumetric Hologram">
          <div class="vos-header">
            <div class="vos-title-block">
              <div class="vos-brand-row">
                <span class="vos-acronym">V.O.S. // H<sup>0</sup></span>
                <span class="badge badge-idle" id="vosModeBadge">3-TIER PIE TUBES SEPARATED</span>
              </div>
            </div>

            <div class="vos-controls-bar">
              <div class="vos-btn-group" role="group" aria-label="Camera Presets">
                <button type="button" class="btn btn-sm btn-secondary vos-preset-btn active" data-preset="iso">Iso 3D</button>
                <button type="button" class="btn btn-sm btn-secondary vos-preset-btn" data-preset="side">Side</button>
                <button type="button" class="btn btn-sm btn-secondary vos-preset-btn" data-preset="front">Top</button>
              </div>

              <div class="vos-btn-group" role="group" aria-label="Layer Solo Filter">
                <button type="button" class="btn btn-sm btn-secondary vos-solo-btn active" data-solo="all" title="Show All 3 Tiers (V, O, S)">All 3</button>
                <button type="button" class="btn btn-sm btn-secondary vos-solo-btn" data-solo="v" title="Visual Layer (V) — Lights &amp; devices showing brightness % or sound level %">V</button>
                <button type="button" class="btn btn-sm btn-secondary vos-solo-btn" data-solo="o" title="Objective Layer (O) — All smart &amp; IR devices">O</button>
                <button type="button" class="btn btn-sm btn-secondary vos-solo-btn" data-solo="s" title="Symbolic Layer (S) — System Bus Load">S</button>
              </div>

              <button type="button" class="btn btn-sm btn-secondary active" id="vosHelperToggleBtn" title="Toggle 3D Spatial Mouse Helper &amp; Polar Reticle">Probe</button>
              <button type="button" class="btn btn-sm btn-secondary" id="vosBurstBtn" title="Trigger Higgs Boson Energy Collision Surge">Burst</button>
              <button type="button" class="btn btn-sm btn-primary" id="vosJoinToggleBtn">Super-Pie</button>
              <button type="button" class="btn btn-sm btn-secondary hidden" id="vosResetFocusBtn">Reset Zoom</button>

              <label class="vos-autojoin-label" title="Pulses dynamically while you talk, and flattens V, O, and S tubes into one nested 3D Super-Pie when AI speaks or acts">
                <input type="checkbox" id="vosAutoJoinVoiceChk" checked />
                <span>Auto-Flat</span>
              </label>

              <div class="vos-voice-meter" title="Live Voice &amp; AI Speech Spectrum Energy">
                <span class="vos-meter-lbl">FLUX</span>
                <div class="vos-meter-track">
                  <div class="vos-meter-fill" id="vosVoiceEnergyFill"></div>
                </div>
              </div>

              <span class="badge badge-idle vos-voice-badge vos-fs-only" id="vosVoiceStatusBadge">VOICE STANDBY</span>
              <button type="button" class="btn btn-sm btn-secondary hidden vos-fs-only" id="vosMuteBtn" title="Mute or unmute microphone">Mute Mic</button>
              <button type="button" class="btn btn-sm btn-primary hidden vos-fs-only" id="vosReconnectVoiceBtn" title="Enable live voice">Enable Voice</button>
              <button type="button" class="btn btn-sm btn-danger vos-exit-btn hidden vos-fs-only" id="vosExitFullscreenBtn" title="Exit Fullscreen (Esc)">Exit Fullscreen</button>
            </div>
          </div>

          <div class="vos-viewport is-exploded" id="vosViewport" data-solo="all">
            <canvas class="vos-webgl-canvas" id="vosWebglCanvas"></canvas>
            <canvas class="vos-hud-canvas" id="vosHudCanvas"></canvas>
            <div class="vos-chamber-frame" aria-hidden="true">
              <span class="vos-corner tl"></span>
              <span class="vos-corner tr"></span>
              <span class="vos-corner bl"></span>
              <span class="vos-corner br"></span>
            </div>
            <div class="vos-holo-emitter" aria-hidden="true"></div>
            <div class="vos-tooltip vos-mouse-helper hidden" id="vosTooltip"></div>

            <div class="vos-ring-legend">
              <span class="vos-leg-pill leg-v"><i></i> V // Visual Telemetry &bull; <strong id="vosVisualStats">0 VISUAL</strong></span>
              <span class="vos-leg-pill leg-o"><i></i> O // Objective PnL &bull; <strong id="vosObjectiveStats">0 DEVICES</strong></span>
              <span class="vos-leg-pill leg-s"><i></i> S // System Bus Load</span>
            </div>

            <div class="vos-chamber-telemetry" id="vosChamberTelemetry" aria-hidden="true">
              <span class="vos-telem-chip">M<sub>H</sub> <strong>125.1 GeV</strong></span>
              <span class="vos-telem-chip">FLUX <strong id="vosFluxVal">0.42 TW</strong></span>
              <span class="vos-telem-chip">PHASE <strong id="vosPhaseVal">3-TIER</strong></span>
            </div>

            <div class="vos-probe-strip" id="vosProbeStrip" aria-hidden="true">
              <span class="vos-probe-dot"></span>
              <span id="vosProbeText">PROBE STANDBY &bull; HOVER 3D PIE SECTORS TO INSPECT</span>
            </div>

            <div class="vos-pnl-legend" id="vosPnlLegend" aria-hidden="true">
              <span class="vos-pnl-chip is-gain"><i class="vos-pnl-swatch pat-gain"></i> + ON</span>
              <span class="vos-pnl-chip is-stream"><i class="vos-pnl-swatch pat-stream"></i> LIVE IO</span>
              <span class="vos-pnl-chip is-flat"><i class="vos-pnl-swatch pat-flat"></i> ~ STANDBY</span>
              <span class="vos-pnl-chip is-loss"><i class="vos-pnl-swatch pat-loss"></i> - OFF</span>
            </div>

            <!-- Minimal Floating Pure-Hologram Corner Overlay -->
            <div class="vos-pure-topbar">
              <div class="vos-pure-brand">
                <span class="vos-pure-dot" id="vosPureDot"></span>
                <span>V.O.S. // H<sup>0</sup></span>
                <span class="vos-pure-phase" id="vosPurePhaseTag">3-TIER</span>
              </div>
              <div class="vos-pure-actions">
                <button type="button" class="vos-pill-btn" id="togglePureControlsBtn" title="Toggle Camera &amp; Layer Controls">Controls</button>
                <button type="button" class="vos-pill-btn" id="togglePureVoiceBtn" title="Toggle Voice Agent Bar">Voice</button>
                <button type="button" class="vos-pill-btn" id="vosPureAppBtn" title="Install or open Treva as a Chrome App">App</button>
                <button type="button" class="vos-pill-btn" id="togglePureDrawerBtn" title="Open Devices, Scenes &amp; Telemetry Drawer">Menu</button>
              </div>
            </div>

            <!-- Contextual Floating Pie Slice Menu (appears when clicking any pie part) -->
            <div class="vos-slice-menu hidden" id="vosSliceMenu" role="dialog" aria-label="Pie Slice Automations &amp; Controls">
              <div class="vos-sm-head">
                <div class="vos-sm-title-wrap">
                  <span class="vos-sm-orb" id="vosSmOrb"></span>
                  <div class="vos-sm-titles">
                    <div class="vos-sm-title" id="vosSmTitle">Sector</div>
                    <div class="vos-sm-meta" id="vosSmMeta">TIER O</div>
                  </div>
                </div>
                <span class="vos-sm-badge" id="vosSmBadge">+ ON</span>
                <button type="button" class="vos-sm-close" id="vosSmCloseBtn" title="Close Menu">&times;</button>
              </div>
              <div class="vos-sm-controls" id="vosSmControls"></div>
              <div class="vos-sm-routines">
                <div class="vos-sm-sec-head">
                  <span>SmartLife Created Scenes</span>
                  <div class="vos-sm-sec-actions">
                    <button type="button" class="vos-sm-assign-toggle vos-sm-sync-btn" id="vosSmSyncBtn" title="Refresh SmartLife Tap-to-Run scenes">&#8635; Sync</button>
                    <button type="button" class="vos-sm-assign-toggle" id="vosSmAssignToggleBtn">+ Assign</button>
                  </div>
                </div>
                <div class="vos-sm-scene-list" id="vosSmSceneList"></div>
                <div class="vos-sm-assign-panel hidden" id="vosSmAssignPanel">
                  <input type="text" class="text-input vos-sm-assign-search" id="vosSmAssignSearch" placeholder="Search SmartLife created scenes..." />
                  <div class="vos-sm-assign-options" id="vosSmAssignOptions"></div>
                </div>
              </div>
            </div>

            <div class="vos-action-banner hidden" id="vosActionBanner"></div>

            <!-- Holographic Wake/Sleep Voice Match Flash Overlay -->
            <div class="vos-voice-match-flash hidden" id="vosVoiceMatchFlash" role="status" aria-live="assertive">
              <div class="vos-vmf-ring" aria-hidden="true"></div>
              <div class="vos-vmf-icon" id="vosVmfIcon">&#9889;</div>
              <div class="vos-vmf-body">
                <div class="vos-vmf-kicker" id="vosVmfKicker">ANNYANG + METAPHONE VOICE MATCH</div>
                <div class="vos-vmf-phrase" id="vosVmfPhrase">&ldquo;Hola Treva&rdquo;</div>
                <div class="vos-vmf-action" id="vosVmfAction">Voice Link Enabled &bull; Voice Menu Opened</div>
              </div>
              <span class="vos-vmf-score" id="vosVmfScore">98% MATCH</span>
            </div>

            <!-- Persistent Bottom Holographic Voice Match Sentinel & English Instruction Bar -->
            <div class="vos-voice-sentinel-hud" id="vosVoiceSentinelHud" role="region" aria-label="Voice Wake and Goodbye Instructions">
              <div class="vos-vs-left">
                <span class="vos-vs-orb is-listening" id="vosSentinelOrb" aria-hidden="true">
                  <i class="vos-vs-wave w1"></i>
                  <i class="vos-vs-wave w2"></i>
                  <i class="vos-vs-wave w3"></i>
                </span>
                <span class="vos-vs-badge" id="vosSentinelStateBadge">VOICE SENTINEL &bull; READY</span>
              </div>
              <div class="vos-vs-guide" id="vosSentinelGuideLabel">
                <strong>Voice Match Guide (EN):</strong> Say <span class="vos-vs-kw wake">&ldquo;Hola Treva&rdquo;</span> or <span class="vos-vs-kw wake">&ldquo;Hello Treva&rdquo;</span> (any language greeting + <em>Treva</em>) to open the Voice Menu &amp; enable the Voice Link &bull; Say <span class="vos-vs-kw sleep">&ldquo;Chau Treva&rdquo;</span> or <span class="vos-vs-kw sleep">&ldquo;Goodbye Treva&rdquo;</span> (any language goodbye) to stop the Voice Link &amp; hide the Voice Menu.
              </div>
              <div class="vos-vs-right">
                <span class="vos-vs-match-chip" id="vosSentinelMatchChip" title="Zero-false-positive phonetic voice matcher">ANNYANG + METAPHONE</span>
                <button type="button" class="vos-vs-toggle-btn active" id="vosSentinelToggleBtn" title="Toggle hands-free wake/goodbye voice detection">Wake Mic ON</button>
              </div>
            </div>
          </div>
          <div class="toast-container vos-fs-toast-container" id="vosToastContainer" aria-live="polite"></div>
        </section>

        <!-- Persistent OpenAI Voice & Command Dock -->
        <section class="card ai-section cockpit-voice-bar" id="aiVoiceSection" aria-label="OpenAI Smart House Voice Agent">
          <div class="ai-bar-top">
            <div class="ai-title-wrap">
              <div class="ai-voice-orb" id="aiVoiceOrb" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  <line x1="12" y1="19" x2="12" y2="23" />
                </svg>
              </div>
              <div class="ai-bar-heading">
                <h2>Voice Agent</h2>
                <span class="badge badge-idle" id="aiStateBadge">STANDBY</span>
              </div>
            </div>

            <div class="header-btns ai-bar-controls">
              <select id="aiModelSelect" class="preset-select" title="Realtime AI Model">
                <option value="gpt-realtime-mini">gpt-realtime-mini</option>
                <option value="gpt-realtime">gpt-realtime</option>
              </select>
              <select id="aiVoiceSelect" class="preset-select" title="Assistant Voice">
                <option value="verse">Verse</option>
                <option value="alloy">Alloy</option>
                <option value="coral">Coral</option>
                <option value="ash">Ash</option>
                <option value="sage">Sage</option>
                <option value="shimmer">Shimmer</option>
              </select>
              <button type="button" class="btn btn-secondary btn-sm hidden" id="aiMuteBtn">Mute Mic</button>
              <button type="button" class="btn btn-primary btn-sm" id="aiVoiceToggleBtn">Activate Voice Agent</button>
              <button type="button" class="btn btn-secondary btn-sm hidden" id="aiToggleLogBtn" title="Show or hide assistant transcript">Hide Log</button>
            </div>
          </div>

          <div class="ai-voice-match-menu-banner" id="aiVoiceMatchMenuBanner">
            <span class="ai-vmm-dot"></span>
            <span class="ai-vmm-text">
              <strong>Hands-Free Voice Match:</strong> Say <code>&ldquo;Hola Treva&rdquo;</code> / <code>&ldquo;Hello Treva&rdquo;</code> (any language greeting + Treva) to connect &amp; open &bull; Say <code>&ldquo;Chau Treva&rdquo;</code> / <code>&ldquo;Goodbye Treva&rdquo;</code> (or any goodbye in any language) to stop the Voice Link and hide this menu.
            </span>
          </div>

          <form class="ai-input-row" id="aiTextForm">
            <input type="text" id="aiTextInput" class="text-input" placeholder="Speak via Voice Agent, hold Push-to-Talk, or type any command (EN / ES)..." autocomplete="off" />
            <label class="ambient-sync-toggle" title="Speak replies aloud for text/push-to-talk mode">
              <input type="checkbox" id="aiSpeakFallbackChk" checked />
              <span>Speak</span>
            </label>
            <button type="button" class="btn btn-secondary btn-sm" id="aiPttBtn" title="Record a voice clip fallback">Push to Talk</button>
            <button type="submit" class="btn btn-primary btn-sm" id="aiSendBtn">Send</button>
          </form>

          <div class="ai-quick-chips" id="aiQuickChips">
            <button type="button" class="chip-btn ai-chip-btn" data-prompt="Play latest Wiz Khalifa album">Play Latest Wiz Khalifa Album</button>
            <button type="button" class="chip-btn ai-chip-btn" data-prompt="What is currently playing on my Google Nest or Chromecast?">What&apos;s Playing?</button>
            <button type="button" class="chip-btn ai-chip-btn" data-prompt="Pause or resume playback on my active Nest speaker">Play / Pause Nest</button>
            <button type="button" class="chip-btn ai-chip-btn" data-prompt="Play country night relaxation sounds on speaker">Country Night on Nest</button>
            <button type="button" class="chip-btn ai-chip-btn" data-prompt="Turn off Aire (air conditioner)">Turn off Aire</button>
            <button type="button" class="chip-btn ai-chip-btn" data-prompt="Set Aire AC to 22 degrees Cool mode">Aire 22&deg;C Cool</button>
            <button type="button" class="chip-btn ai-chip-btn" data-prompt="Send Sh7p robot vacuum back to dock">Dock Sh7p</button>
            <button type="button" class="chip-btn ai-chip-btn" data-prompt="Movie mode: warm dim all lights to 25% brightness">Movie Lights</button>
            <button type="button" class="chip-btn ai-chip-btn" data-prompt="Turn off all lights in the house">All Lights Off</button>
          </div>

          <div class="ai-log-feed hidden" id="aiLogFeed"></div>
          <audio id="aiRemoteAudio" class="hidden" autoplay playsinline></audio>
        </section>
      </div>

      <!-- Right Tabbed Command Dock: V.O.S. Deck | Devices & Scenes | Cast & Studio -->
      <aside class="card cockpit-dock" id="cockpitDock" aria-label="Control & Telemetry Dock">
        <div class="vos-drawer-top">
          <span class="vos-drawer-brand">Treva Telemetry &amp; Config</span>
          <div class="vos-drawer-tools">
            <button type="button" class="btn btn-secondary btn-xs" id="drawerAppBtn" title="Install or open Treva as a Chrome App">App</button>
            <button type="button" class="btn btn-secondary btn-xs" id="drawerKeysBtn" title="Smart Life &amp; OpenAI Keys">Keys</button>
            <button type="button" class="btn btn-secondary btn-xs" id="drawerQrBtn" title="Mobile QR">QR</button>
            <button type="button" class="btn btn-secondary btn-xs" id="drawerCloseBtn" title="Close Menu">&times;</button>
          </div>
        </div>
        <div class="cockpit-tabs" role="tablist" aria-label="Workspace Panels">
          <button type="button" class="cockpit-tab-btn active" role="tab" aria-selected="true" aria-controls="dockPaneVos" data-dock-pane="dockPaneVos">
            <span>V.O.S. Deck</span>
          </button>
          <button type="button" class="cockpit-tab-btn" role="tab" aria-selected="false" aria-controls="dockPaneSmart" data-dock-pane="dockPaneSmart">
            <span>Devices</span>
            <span class="dock-tab-count" id="dockSmartCount">0</span>
          </button>
          <button type="button" class="cockpit-tab-btn" role="tab" aria-selected="false" aria-controls="dockPaneCast" data-dock-pane="dockPaneCast">
            <span>Cast &amp; Studio</span>
            <span class="dock-tab-dot hidden" id="dockCastDot"></span>
          </button>
        </div>

        <div class="cockpit-pane-body">
          <!-- Tab 1: V.O.S. Device Matrix, Slice Inspector & Layer S Execution Telemetry -->
          <div class="cockpit-pane" id="dockPaneVos" role="tabpanel">
            <div class="vos-holo-deck" id="vosHoloDeck">
              <div class="vos-deck-panel vos-deck-nav">
                <div class="vos-deck-title">
                  <span id="vosSectorMatrixTitle">SECTOR MATRIX // TIER O</span>
                  <span class="vos-deck-hint">Click pill or 3D tube</span>
                </div>
                <div class="vos-device-nav" id="vosDeviceNav"></div>
              </div>

              <div class="vos-deck-panel vos-deck-inspector">
                <div class="vos-deck-title">
                  <span style="white-space:nowrap;">SLICE INSPECTOR // V&middot;O</span>
                  <span class="vos-deck-hint">Double-click light</span>
                </div>
                <div class="vos-inspector-body" id="vosInspectorBody"></div>
              </div>

              <div class="vos-deck-panel vos-deck-system">
                <div class="vos-deck-title">
                  <span>COLLIDER BUS // LAYER S</span>
                </div>
                <div class="vos-system-chips" id="vosSystemChips"></div>
                <div class="vos-system-logs" id="vosSystemLogs"></div>
              </div>
            </div>
          </div>

          <!-- Tab 2: Smart Life (Tuya), Magic Home, BLE & Tap-to-Run Scenes -->
          <div class="cockpit-pane hidden" id="dockPaneSmart" role="tabpanel">
            <section class="smart-section dock-smart-pane">
              <div class="dock-section-head">
                <div>
                  <h2>Smart Home &amp; Scenes</h2>
                  <p class="card-desc">Smart Life, IR Remotes, Vacuum, Magic Home &amp; BLE</p>
                </div>
              </div>

              <div class="smart-toolbar">
                <div class="header-btns" style="flex-wrap:wrap;">
                  <button type="button" class="btn btn-secondary btn-sm" id="scanSmartWifiBtn">Scan Wi-Fi</button>
                  <button type="button" class="btn btn-secondary btn-sm" id="syncSmartCloudBtn">Sync Cloud</button>
                  <button type="button" class="btn btn-secondary btn-sm" id="pairBleLightBtn">Pair BLE</button>
                  <button type="button" class="btn btn-secondary btn-sm" id="addSmartManualBtn">+ Add</button>
                </div>
                <label class="ambient-sync-toggle" title="Pulse smart lights with captured audio or screen color">
                  <input type="checkbox" id="ambientSyncCheckbox" />
                  <span>Sync Lights to Cast</span>
                </label>
              </div>

              <!-- Manual Smart Device Form -->
              <form class="manual-device-form hidden" id="smartManualForm">
                <div class="form-row">
                  <select id="smartManualPlatform" class="select-input">
                    <option value="tuya">Smart Life / Tuya Wi-Fi</option>
                    <option value="magichome">Magic Home Wi-Fi (TCP 5577)</option>
                  </select>
                  <input type="text" id="smartManualName" placeholder="Friendly Name (e.g. Desk LED Strip)" class="text-input" />
                  <input type="text" id="smartManualIp" placeholder="Wi-Fi IP (e.g. 192.168.100.9)" class="text-input" />
                </div>
                <div class="form-row" id="smartTuyaExtraRow">
                  <input type="text" id="smartManualDevId" placeholder="Tuya Device ID (optional if IP)" class="text-input" />
                  <input type="text" id="smartManualLocalKey" placeholder="Local Key (16 chars)" class="text-input" />
                  <select id="smartManualVersion" class="select-input" style="max-width:95px;">
                    <option value="3.3">v3.3</option>
                    <option value="3.4">v3.4</option>
                  </select>
                  <select id="smartManualCategory" class="select-input" style="max-width:115px;">
                    <option value="light">RGB Light</option>
                    <option value="switch">Plug / Switch</option>
                  </select>
                  <button type="submit" class="btn btn-primary btn-sm">Save Smart Life</button>
                </div>
                <div class="form-row hidden" id="smartMhSaveRow">
                  <input type="text" id="smartManualMac" placeholder="MAC Address (optional)" class="text-input" />
                  <button type="submit" class="btn btn-primary btn-sm">Save Magic Home</button>
                </div>
              </form>

              <div class="smart-cast-hub" id="smartCastHubSection">
                <div class="smart-scenes-header" style="margin-bottom:8px;">
                  <div>
                    <strong>Google Nest, Chromecast &amp; Google TV</strong>
                    <span class="empty-sub" id="smartCastHubMeta">Live Now Playing, Play/Pause, Voice Broadcast &amp; App Control</span>
                  </div>
                  <div class="smart-scenes-controls">
                    <button type="button" class="btn btn-secondary btn-xs" id="smartTabDiagBtn" title="Run Local Network Diagnostic for Cast &amp; Smart Home devices">Net Diag</button>
                    <button type="button" class="btn btn-secondary btn-xs" id="smartTabScanCastBtn" title="Scan Wi-Fi for Google Nest, Chromecast &amp; Google TV">&#8635; Scan Cast</button>
                  </div>
                </div>
                <div class="lan-diag-box hidden" id="smartTabDiagBox"></div>
                <div class="devices-list" id="smartCastHubList"></div>
              </div>

              <div class="smart-devices-grid" id="smartDevicesGrid">
                <div class="empty-devices">
                  <p>Scanning Wi-Fi for Smart Life &amp; Magic Home devices...</p>
                  <span class="empty-sub">Click <strong>Keys</strong> above to link Smart Life or <strong>Scan Wi-Fi</strong> for local devices.</span>
                </div>
              </div>

              <div class="smart-scenes-box hidden" id="smartScenesSection">
                <div class="smart-scenes-header">
                  <div>
                    <strong>Tap-to-Run Scenes</strong>
                    <span class="empty-sub" id="smartScenesMeta">1-click scenes &amp; symbolic voice links</span>
                  </div>
                  <div class="smart-scenes-controls">
                    <input type="text" id="smartScenesFilter" class="text-input smart-scenes-filter" placeholder="Filter scene, device, or voice cmd..." />
                    <button type="button" class="btn btn-secondary btn-sm" id="syncSmartScenesBtn" title="Refresh Tap-to-Run scenes from SmartLife Cloud">&#8635; Sync</button>
                    <button type="button" class="btn btn-secondary btn-sm" id="toggleSceneVoiceLinksBtn" title="View decoded scene configurations and edit associated voice inputs">Voice Links</button>
                  </div>
                </div>
                <div class="smart-scenes-strip" id="smartScenesStrip"></div>
                <div class="scene-voice-links-panel hidden" id="sceneVoiceLinksPanel"></div>
              </div>
            </section>
          </div>

          <!-- Tab 3: Capture Studio & Google Nest / Cast Devices -->
          <div class="cockpit-pane hidden" id="dockPaneCast" role="tabpanel">
            <div class="dock-cast-stack">
              <!-- Screen & Sound Capture Studio -->
              <section class="dock-subcard studio-card">
                <div class="card-header">
                  <div>
                    <h2>Capture Screen &amp; Sound</h2>
                    <p class="card-desc">AudioWorklet MP3 &amp; WebM live capture</p>
                  </div>
                  <span class="badge badge-idle" id="captureStateBadge">STANDBY</span>
                </div>

                <div class="control-group">
                  <div class="segmented-control" role="radiogroup" aria-label="Stream Format">
                    <button type="button" class="segment-btn active" data-mode="audio" id="modeAudioBtn">
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M9 18V5l12-2v13" />
                        <circle cx="6" cy="18" r="3" />
                        <circle cx="18" cy="16" r="3" />
                      </svg>
                      <div class="segment-text">
                        <strong>Sound (MP3)</strong>
                        <span>Nest / Cast Groups</span>
                      </div>
                    </button>
                    <button type="button" class="segment-btn" data-mode="video" id="modeVideoBtn">
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                        <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                        <line x1="8" y1="21" x2="16" y2="21" />
                        <line x1="12" y1="17" x2="12" y2="21" />
                      </svg>
                      <div class="segment-text">
                        <strong>Screen + Sound</strong>
                        <span>Nest Hub / TV</span>
                      </div>
                    </button>
                  </div>
                </div>

                <div class="preview-stage" id="previewStage">
                  <video id="screenPreview" autoplay muted playsinline></video>
                  <canvas id="audioVisualizer" width="640" height="120"></canvas>

                  <div class="preview-placeholder" id="previewPlaceholder">
                    <div class="placeholder-icon">
                      <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.6">
                        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                        <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                        <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                      </svg>
                    </div>
                    <h3>Ready to Share Screen &amp; Sound</h3>
                    <p>Start capture and enable <strong>"Also share system audio"</strong>.</p>
                  </div>

                  <div class="track-badges hidden" id="trackBadges">
                    <span class="track-pill" id="videoTrackPill">Video: Off</span>
                    <span class="track-pill" id="audioTrackPill">Audio: Off</span>
                  </div>
                </div>

                <div class="warning-box hidden" id="noAudioWarning">
                  <strong>No System Audio Track Detected!</strong>
                  <span>Stop capture and re-select with <em>"Also share system audio"</em> checked.</span>
                </div>

                <div class="bt-output-bar">
                  <div class="bt-output-info">
                    <strong>Bluetooth Speaker Output</strong>
                    <span id="btOutputStatus">Direct zero-buffer BT routing</span>
                  </div>
                  <div class="header-btns">
                    <button type="button" class="btn btn-secondary btn-sm" id="selectBtAudioBtn">Select BT</button>
                    <button type="button" class="btn btn-danger btn-sm hidden" id="stopBtAudioBtn">Stop BT</button>
                  </div>
                </div>
                <audio id="btAudioSink" class="hidden" playsinline></audio>

                <div class="studio-actions">
                  <button type="button" class="btn btn-primary btn-sm" id="startCaptureBtn">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                      <circle cx="12" cy="12" r="10" />
                      <polygon points="10 8 16 12 10 16 10 8" fill="currentColor" />
                    </svg>
                    <span>Start Screen &amp; Sound</span>
                  </button>

                  <button type="button" class="btn btn-secondary btn-sm" id="startMicCaptureBtn" title="Stream Microphone / Line-In Audio without Screen Sharing popup">
                    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                      <line x1="12" y1="19" x2="12" y2="23" />
                    </svg>
                    <span>Mic Only</span>
                  </button>

                  <button type="button" class="btn btn-danger btn-sm hidden" id="stopCaptureBtn">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                      <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />
                    </svg>
                    <span>Stop</span>
                  </button>
                </div>

                <div class="telemetry-bar">
                  <div class="telemetry-item">
                    <span class="telemetry-label">Stream Data</span>
                    <strong id="telemetryBytes">0 B</strong>
                  </div>
                  <div class="telemetry-item">
                    <span class="telemetry-label">Listeners</span>
                    <strong id="telemetryListeners">0</strong>
                  </div>
                  <div class="telemetry-item telemetry-urls">
                    <span class="telemetry-label">Endpoints</span>
                    <div class="endpoint-chips">
                      <button type="button" class="chip-btn" id="copyMp3UrlBtn">MP3</button>
                      <button type="button" class="chip-btn" id="copyWebmUrlBtn">WebM</button>
                    </div>
                  </div>
                </div>
              </section>

              <!-- Google Nest & Cast Devices -->
              <section class="dock-subcard devices-card">
                <div class="card-header">
                  <div>
                    <h2>Google Nest &amp; Cast</h2>
                    <p class="card-desc">Browser Wi-Fi SDK or local LAN discovery</p>
                  </div>
                  <div class="header-btns" id="localScanControls">
                    <button type="button" class="btn btn-secondary btn-sm" id="runNetDiagBtn" title="Run Local Network Diagnostic (Browser Subnet + Cast SDK + Local Bridge)">Net Diag</button>
                    <button type="button" class="btn btn-secondary btn-sm" id="refreshDevicesBtn" title="Scan local Wi-Fi via PHP mDNS &amp; Browser Diagnostics">Scan</button>
                    <button type="button" class="btn btn-secondary btn-sm" id="addManualDeviceBtn">+ IP</button>
                  </div>
                </div>

                <div class="chrome-cast-card">
                  <div class="chrome-cast-top">
                    <div>
                      <strong>Browser Google Cast</strong>
                      <p id="castSdkHint">Chrome/Edge built-in Wi-Fi Cast discovery.</p>
                    </div>
                    <button type="button" class="btn btn-primary btn-sm" id="browserCastSdkBtn">
                      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M2 16.1A5 5 0 0 1 5.9 20M2 12.05A9 9 0 0 1 9.95 20M2 8V6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6" />
                        <line x1="2" y1="20" x2="2.01" y2="20" />
                      </svg>
                      <span>Cast</span>
                    </button>
                  </div>

                  <div class="sdk-active-session hidden" id="sdkSessionBox">
                    <div class="sdk-session-header">
                      <div>
                        <strong id="sdkDeviceName">Connected Device</strong>
                        <span class="device-kind-tag" id="sdkStreamTypeTag">LIVE</span>
                      </div>
                      <button type="button" class="btn btn-danger btn-sm" id="sdkStopBtn">Disconnect</button>
                    </div>
                    <div class="device-volume-row" style="margin-top:0;padding-top:6px;">
                      <button type="button" class="mute-btn" id="sdkMuteBtn" title="Toggle Mute">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                          <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                        </svg>
                      </button>
                      <input type="range" class="volume-slider" id="sdkVolumeSlider" min="0" max="100" value="70" />
                      <span class="volume-pct" id="sdkVolumePct">70%</span>
                    </div>
                  </div>
                </div>

                <form class="manual-device-form hidden" id="manualDeviceForm">
                  <div class="form-row">
                    <input type="text" id="manualNameInput" placeholder="Device Name (e.g. Nest Mini)" class="text-input" />
                    <input type="text" id="manualHostInput" placeholder="IP (e.g. 192.168.100.7)" class="text-input" required />
                  </div>
                  <div class="form-row">
                    <select id="manualKindSelect" class="select-input">
                      <option value="speaker">Nest Speaker (MP3)</option>
                      <option value="display">Nest Hub / TV (Video)</option>
                    </select>
                    <input type="number" id="manualPortInput" value="8009" placeholder="Port" class="text-input port-input" />
                    <button type="submit" class="btn btn-primary btn-sm">Save</button>
                  </div>
                </form>

                <div class="lan-diag-box hidden" id="castTabDiagBox"></div>

                <div class="devices-list" id="devicesList">
                  <div class="empty-devices">
                    <div class="spinner"></div>
                    <p>Checking local Wi-Fi for Cast devices...</p>
                  </div>
                </div>
              </section>
            </div>
          </div>
        </div>
      </aside>
    </main>
  </div>

  <!-- Smart Life & Magic Home Access Keys Modal -->
  <div class="modal-backdrop hidden" id="smartKeysModal">
    <div class="modal-card">
      <div class="modal-header">
        <h3>Access Keys, Tokens &amp; Local Session</h3>
        <button type="button" class="icon-close-btn" id="closeSmartKeysBtn">&times;</button>
      </div>
      <div class="key-section-box local-session-box" id="localSessionBox">
        <div class="local-session-head">
          <h4>Your Local Session Cache</h4>
          <span class="session-pill" id="localSessionStatusPill">Empty Session</span>
        </div>
        <p>Your Access IDs, passwords, tokens, local keys, and synced devices live <strong>only in your own local session &amp; browser cache</strong> — never saved permanently on the server. Each user connects with their own devices, IDs, and passwords.</p>
        <div class="local-session-controls">
          <div style="flex:1;min-width:210px;">
            <label class="group-label" for="localCacheModeSelect">Local Cache Storage</label>
            <select id="localCacheModeSelect" class="select-input">
              <option value="browser">Browser Local Cache (Remember on this browser only)</option>
              <option value="session">Temporary Tab Session Only (Clear when browser closes)</option>
            </select>
          </div>
          <button type="button" class="btn btn-danger btn-sm" id="clearLocalSessionBtn" title="Wipe your saved keys, IDs, tokens, and devices from this browser and active session">Clear Local Session</button>
        </div>
      </div>
      <form id="smartKeysForm">
        <div class="key-section-box">
          <h4>Smart Life / Tuya IoT Credentials <a href="https://iot.tuya.com/" target="_blank" rel="noopener noreferrer" class="btn btn-secondary btn-sm" style="margin-left:8px;padding:2px 9px;font-size:0.7rem;text-decoration:none;">Open iot.tuya.com &nearr;</a></h4>
          <p>One-time setup: Sign in on <strong>iot.tuya.com</strong> &rarr; <strong>Cloud &rarr; Development &rarr; Create Cloud Project</strong> (Smart Home) &rarr; authorize <strong>IoT Core</strong> &rarr; copy <strong>Access ID / Secret</strong> from <strong>Overview</strong> &rarr; scan QR under <strong>Devices &rarr; Link Tuya App Account</strong>. Stored only in your local browser cache.</p>
          <div class="form-grid-2">
            <div>
              <label class="group-label" for="tuyaAccessIdInput">Access ID (Client ID)</label>
              <input type="text" id="tuyaAccessIdInput" class="text-input" placeholder="e.g. x7k9m2p4q8..." />
            </div>
            <div>
              <label class="group-label" for="tuyaAccessSecretInput">Access Secret <span class="saved-pill hidden" id="tuyaSecretSavedTag">&#10003; Saved</span></label>
              <input type="password" id="tuyaAccessSecretInput" class="text-input" autocomplete="off" placeholder="Paste Tuya Access Secret" />
            </div>
          </div>
          <div class="form-grid-2">
            <div>
              <label class="group-label" for="tuyaRegionSelect">Data Center Region</label>
              <select id="tuyaRegionSelect" class="select-input">
                <option value="us">Western America (openapi.tuyaus.com)</option>
                <option value="ue">Eastern America (openapi-ueaz.tuyaus.com)</option>
                <option value="eu">Central Europe (openapi.tuyaeu.com)</option>
                <option value="we">Western Europe (openapi-weaz.tuyaeu.com)</option>
                <option value="cn">China (openapi.tuyacn.com)</option>
                <option value="in">India (openapi.tuyain.com)</option>
              </select>
            </div>
            <div>
              <label class="group-label" for="tuyaUidInput">Smart Life User UID (or 1 Device ID)</label>
              <input type="text" id="tuyaUidInput" class="text-input" placeholder="e.g. az1689... or eb9764c5..." />
            </div>
          </div>
        </div>

        <div class="key-section-box">
          <h4>Magic Home Pro (Optional Cloud Access)</h4>
          <p>On local Wi-Fi, Magic Home devices work on your own LAN scan with <strong>zero tokens</strong>. Fill this only for remote cloud control outside your Wi-Fi.</p>
          <div class="form-grid-2">
            <div>
              <label class="group-label" for="mhEmailInput">Magic Home Account Email</label>
              <input type="text" id="mhEmailInput" class="text-input" autocomplete="username" placeholder="optional@email.com" />
            </div>
            <div>
              <label class="group-label" for="mhPasswordInput">Password <span class="saved-pill hidden" id="mhPasswordSavedTag">&#10003; Saved</span></label>
              <input type="password" id="mhPasswordInput" class="text-input" autocomplete="current-password" placeholder="Leave blank to keep saved" />
            </div>
          </div>
          <div class="form-grid-2">
            <div>
              <label class="group-label" for="mhTokenInput">Or Direct Cloud Token (optional) <span class="saved-pill hidden" id="mhTokenSavedTag">&#10003; Saved</span></label>
              <input type="text" id="mhTokenInput" class="text-input" autocomplete="off" placeholder="Optional JWT token" />
            </div>
            <div>
              <label class="group-label" for="mhRegionSelect">Magic Home Cloud Region</label>
              <select id="mhRegionSelect" class="select-input">
                <option value="us">Americas (wifij01us.magichue.net)</option>
                <option value="eu">Europe (wifij01eu.magichue.net)</option>
                <option value="cn">China (wifij01cn.magichue.net)</option>
              </select>
            </div>
          </div>
        </div>

        <div class="key-section-box">
          <h4>Google Nest (All Variants), Chromecast / Google TV &amp; Bluetooth</h4>
          <p class="small muted" style="margin:0 0 8px 0;">
            <strong>Zero-Key Local Cast V2 API (Active by default):</strong> Automatically discovers and controls Google Nest Mini / Audio / Hub, Cast Speaker Groups, Chromecast, and Google TV over your Wi-Fi LAN (Play, Pause, Seek, Volume, Now Playing, Voice Broadcast TTS, Relaxation Sounds &amp; App Launch) with <strong>no API key required</strong>. You can also pair any Google Nest or TV via <strong>Bluetooth Audio</strong> and select it as your speaker output.
          </p>
          <div style="display:flex; flex-wrap:wrap; gap:8px; align-items:center; margin-bottom:10px;">
            <span id="nestCastModalStatusPill" class="pill pill-live" style="font-size:0.72rem;">Cast V2 LAN Active</span>
            <button type="button" id="modalScanCastBtn" class="btn btn-ghost btn-xs">Scan Nest &amp; Chromecast (mDNS)</button>
            <button type="button" id="modalSelectBtBtn" class="btn btn-ghost btn-xs">Select Bluetooth Speaker Output</button>
          </div>
          <details style="margin-top:6px;">
            <summary class="small muted" style="cursor:pointer; user-select:none;">Optional: Google Home Device Access (SDM Cloud API Keys for Nest Thermostats / Cameras)</summary>
            <div class="smart-keys-grid" style="margin-top:8px;">
              <label>SDM Project ID
                <input type="text" id="googleNestProjectIdInput" placeholder="Optional SDM Enterprise Project ID">
              </label>
              <label>OAuth Client ID
                <input type="text" id="googleNestClientIdInput" placeholder="Optional Google Cloud OAuth Client ID">
              </label>
              <label>OAuth Client Secret
                <input type="password" id="googleNestClientSecretInput" placeholder="Leave blank to keep stored secret">
              </label>
              <label>OAuth Refresh Token
                <input type="password" id="googleNestRefreshTokenInput" placeholder="Leave blank to keep stored refresh token">
              </label>
            </div>
          </details>
        </div>

        <div class="key-section-box">
          <h4>OpenAI Voice Agent (Server Fallback + Local Cache)</h4>
          <p>Uses the server&apos;s configured OpenAI key as fallback when available, or enter your own OpenAI key below to override strictly inside your local session cache.</p>
          <div class="form-grid-2">
            <div>
              <label class="group-label" for="openAiKeyInput">OpenAI API Key <span class="saved-pill hidden" id="openAiKeySavedTag">&#10003; Saved</span></label>
              <div class="openai-key-row">
                <input type="password" id="openAiKeyInput" class="text-input" autocomplete="off" placeholder="sk-proj-... (optional local override)" />
                <button type="button" class="btn btn-secondary btn-sm hidden" id="clearSessionOpenAiBtn" title="Clear local key and revert to server OpenAI fallback">Use Server Key</button>
              </div>
            </div>
            <div>
              <label class="group-label" for="openAiVoiceModalSelect">Default Agent Voice</label>
              <select id="openAiVoiceModalSelect" class="select-input">
                <option value="verse">Verse</option>
                <option value="alloy">Alloy</option>
                <option value="coral">Coral</option>
                <option value="ash">Ash</option>
                <option value="sage">Sage</option>
                <option value="shimmer">Shimmer</option>
              </select>
            </div>
          </div>
        </div>

        <button type="submit" class="btn btn-primary btn-lg">Save to Local Session &amp; Sync</button>
      </form>
    </div>
  </div>

  <!-- Mobile / Network QR Modal -->
  <div class="modal-backdrop hidden" id="qrModal">
    <div class="modal-card">
      <div class="modal-header">
        <h3>Mobile Access &amp; LAN Settings</h3>
        <button type="button" class="icon-close-btn" id="closeQrModalBtn">&times;</button>
      </div>

      <div class="modal-body">
        <div class="control-group hidden" id="lanAdapterGroup">
          <label class="group-label" for="networkInterfaceSelect">Active Wi-Fi / LAN Adapter</label>
          <select id="networkInterfaceSelect" class="select-input"></select>
        </div>

        <div class="qr-single">
          <div class="qr-box" style="width:100%;max-width:340px;">
            <span class="qr-badge">Open on Phone / Another Device</span>
            <div class="qr-canvas-wrap" id="qrContainer"></div>
            <code id="shareUrlCode">...</code>
            <p id="qrHelpText">Scan with your mobile camera to open Treva Cast on your phone.</p>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- Chrome App / PWA Modal -->
  <div class="modal-backdrop hidden" id="appInstallModal">
    <div class="modal-card">
      <div class="modal-header">
        <h3>Treva Chrome App</h3>
        <button type="button" class="icon-close-btn" id="closeAppInstallModalBtn">&times;</button>
      </div>

      <div class="modal-body">
        <div class="pwa-modal-box">
          <div class="pwa-modal-head">
            <span class="pwa-status-badge" id="appInstallStatusBadge">Checking...</span>
          </div>
          <p class="pwa-status-text" id="appInstallStatusText"></p>
          <ul class="pwa-steps-list" id="appModalChromeSteps"></ul>
          <code class="pwa-url-code" id="appModalUrlCode">...</code>
          <div class="pwa-modal-actions">
            <button type="button" class="btn btn-primary btn-sm hidden" id="appModalPrimaryActionBtn">Install Chrome App Now</button>
            <button type="button" class="btn btn-primary btn-sm hidden" id="appModalSwitchOriginBtn">Open on Localhost</button>
            <button type="button" class="btn btn-secondary btn-sm" id="appModalCopyUrlBtn">Copy App URL</button>
            <button type="button" class="btn btn-secondary btn-sm hidden" id="appModalOpenTabBtn">Open in Browser Tab</button>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- Toast Container -->
  <div class="toast-container" id="toastContainer"></div>

  <script src="assets/js/qrcode.js"></script>
  <script type="module" src="assets/js/vos-3d.js?v=6.19"></script>
  <script defer src="assets/js/treva-voice-match.js?v=6.19"></script>
  <script defer src="assets/js/app.js?v=6.19"></script>
  <script defer src="assets/js/pwa.js?v=6.19"></script>
</body>
</html>
