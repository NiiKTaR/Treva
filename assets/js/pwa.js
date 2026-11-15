(function () {
  'use strict';

  const STORAGE_INSTALLED_KEY = 'treva_pwa_installed';

  const els = {
    topbarBtn: document.getElementById('installAppBtn'),
    topbarLabel: document.getElementById('installAppBtnLabel'),
    pureBtn: document.getElementById('vosPureAppBtn'),
    drawerBtn: document.getElementById('drawerAppBtn'),
    modal: document.getElementById('appInstallModal'),
    closeModalBtn: document.getElementById('closeAppInstallModalBtn'),
    statusBadge: document.getElementById('appInstallStatusBadge'),
    statusText: document.getElementById('appInstallStatusText'),
    primaryActionBtn: document.getElementById('appModalPrimaryActionBtn'),
    switchOriginBtn: document.getElementById('appModalSwitchOriginBtn'),
    copyUrlBtn: document.getElementById('appModalCopyUrlBtn'),
    openTabBtn: document.getElementById('appModalOpenTabBtn'),
    urlCode: document.getElementById('appModalUrlCode'),
    chromeStepsBox: document.getElementById('appModalChromeSteps'),
  };

  const state = {
    deferredPrompt: null,
    swReady: false,
    relatedInstalled: false,
    installedHint: readInstalledHint(),
  };

  function readInstalledHint() {
    try {
      return window.localStorage.getItem(STORAGE_INSTALLED_KEY) === '1';
    } catch (_err) {
      return false;
    }
  }

  function writeInstalledHint(value) {
    state.installedHint = Boolean(value);
    try {
      if (value) {
        window.localStorage.setItem(STORAGE_INSTALLED_KEY, '1');
      } else {
        window.localStorage.removeItem(STORAGE_INSTALLED_KEY);
      }
    } catch (_err) {
      // Ignore storage errors in restricted contexts.
    }
  }

  function isStandaloneMode() {
    if (window.navigator.standalone === true) return true;
    const queries = [
      '(display-mode: standalone)',
      '(display-mode: window-controls-overlay)',
      '(display-mode: minimal-ui)',
    ];
    return queries.some((q) => window.matchMedia && window.matchMedia(q).matches);
  }

  function isLocalhostHost(hostname) {
    const h = (hostname || '').toLowerCase();
    return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1';
  }

  function isAppCapableOrigin() {
    if (window.isSecureContext) return true;
    return isLocalhostHost(window.location.hostname);
  }

  function notify(message, type) {
    if (typeof window.showToast === 'function') {
      window.showToast(message, type || 'info');
      return;
    }
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type || 'info'}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3500);
  }

  function getSuggestedLocalhostUrl() {
    const portPart = window.location.port ? `:${window.location.port}` : '';
    return `http://localhost${portPart}${window.location.pathname}${window.location.search}`;
  }

  function getModeSummary() {
    if (isStandaloneMode()) return 'standalone';
    if (!isAppCapableOrigin()) return 'insecure-origin';
    if (state.deferredPrompt) return 'install-ready';
    if (state.relatedInstalled || state.installedHint) return 'installed-browser-tab';
    return 'chrome-menu-install';
  }

  function setButtonAppearance(btn, textEl, label, title, isActive, isPromptReady) {
    if (!btn) return;
    if (textEl) {
      textEl.textContent = label;
    } else {
      btn.textContent = label;
    }
    btn.title = title;
    btn.classList.toggle('active', Boolean(isActive));
    btn.classList.toggle('pwa-ready', Boolean(isPromptReady));
  }

  function syncUi() {
    const mode = getModeSummary();

    if (mode === 'standalone') {
      setButtonAppearance(els.topbarBtn, els.topbarLabel, 'App Active', 'Running inside Treva Chrome App window', true, false);
      setButtonAppearance(els.pureBtn, null, 'App Active', 'Running inside Treva Chrome App window', true, false);
      setButtonAppearance(els.drawerBtn, null, 'App Active', 'Chrome App status & window controls', true, false);
    } else if (mode === 'install-ready') {
      setButtonAppearance(els.topbarBtn, els.topbarLabel, 'Install App', 'Install Treva as a Chrome App (Desktop / Start Menu)', false, true);
      setButtonAppearance(els.pureBtn, null, 'Install App', 'Install Treva as a Chrome App', false, true);
      setButtonAppearance(els.drawerBtn, null, 'Install App', 'Install Treva as a Chrome App', false, true);
    } else if (mode === 'installed-browser-tab') {
      setButtonAppearance(els.topbarBtn, els.topbarLabel, 'Open in App', 'Open Treva in its Chrome App window', false, false);
      setButtonAppearance(els.pureBtn, null, 'Open App', 'Open Treva in its Chrome App window', false, false);
      setButtonAppearance(els.drawerBtn, null, 'Open App', 'Open Treva in its Chrome App window', false, false);
    } else {
      setButtonAppearance(els.topbarBtn, els.topbarLabel, 'Chrome App', 'Install or open Treva as a Chrome App', false, false);
      setButtonAppearance(els.pureBtn, null, 'App', 'Install or open Treva as a Chrome App', false, false);
      setButtonAppearance(els.drawerBtn, null, 'App', 'Install or open Treva as a Chrome App', false, false);
    }

    syncModalContent(mode);
  }

  function syncModalContent(mode) {
    if (!els.modal) return;

    if (els.urlCode) {
      els.urlCode.textContent = window.location.origin + window.location.pathname;
    }

    if (els.openTabBtn) {
      els.openTabBtn.classList.toggle('hidden', mode !== 'standalone');
    }

    if (els.switchOriginBtn) {
      const showSwitch = mode === 'insecure-origin';
      els.switchOriginBtn.classList.toggle('hidden', !showSwitch);
      if (showSwitch) {
        els.switchOriginBtn.dataset.targetUrl = getSuggestedLocalhostUrl();
      }
    }

    if (mode === 'standalone') {
      if (els.statusBadge) els.statusBadge.textContent = 'Running as Chrome App';
      if (els.statusText) {
        els.statusText.textContent =
          'Treva is currently running in its standalone Chrome App window with hardware-accelerated 3D rendering and live streams enabled.';
      }
      if (els.primaryActionBtn) {
        els.primaryActionBtn.classList.add('hidden');
      }
      if (els.chromeStepsBox) {
        els.chromeStepsBox.innerHTML =
          '<li>Use your taskbar or Start Menu shortcut anytime to launch Treva directly in this app window.</li>' +
          '<li>When browsing Treva inside a regular Chrome tab later, click the <strong>Open in Treva</strong> icon on the right side of the Chrome address bar or choose <strong>Chrome Menu (&vellip;) &rarr; Open in Treva</strong>.</li>';
      }
      return;
    }

    if (mode === 'insecure-origin') {
      if (els.statusBadge) els.statusBadge.textContent = 'Use HTTPS or Localhost';
      if (els.statusText) {
        els.statusText.textContent =
          'Chrome only allows installing or opening Progressive Web Apps from HTTPS origins or localhost. You are currently on a plain HTTP network address.';
      }
      if (els.primaryActionBtn) {
        els.primaryActionBtn.classList.add('hidden');
      }
      if (els.chromeStepsBox) {
        els.chromeStepsBox.innerHTML =
          '<li>Click <strong>Open on Localhost</strong> below if running on this PC, or open Treva over <strong>HTTPS</strong>.</li>' +
          '<li>On remote devices, Chrome can also create a shortcut via <strong>Chrome Menu (&vellip;) &rarr; Cast, save, and share &rarr; Create shortcut...</strong> (check <em>Open as window</em>).</li>';
      }
      return;
    }

    if (mode === 'install-ready') {
      if (els.statusBadge) els.statusBadge.textContent = 'Ready to Install';
      if (els.statusText) {
        els.statusText.textContent =
          'Click Install Chrome App below to create a standalone Treva window, desktop shortcut, and enable Chrome\'s one-click "Open in Treva" address bar button.';
      }
      if (els.primaryActionBtn) {
        els.primaryActionBtn.textContent = 'Install Chrome App Now';
        els.primaryActionBtn.classList.remove('hidden');
      }
      if (els.chromeStepsBox) {
        els.chromeStepsBox.innerHTML =
          '<li>Or click the <strong>Install</strong> icon inside Chrome\'s address bar on the right.</li>' +
          '<li>Or open <strong>Chrome Menu (&vellip;) &rarr; Cast, save, and share &rarr; Install page as app...</strong></li>';
      }
      return;
    }

    if (mode === 'installed-browser-tab') {
      if (els.statusBadge) els.statusBadge.textContent = 'Installed (In Browser Tab)';
      if (els.statusText) {
        els.statusText.textContent =
          'Treva appears installed in Chrome. For security, Chrome requires triggering "Open in app" from Chrome\'s own toolbar or menu rather than page JavaScript:';
      }
      if (els.primaryActionBtn) {
        els.primaryActionBtn.classList.add('hidden');
      }
      if (els.chromeStepsBox) {
        els.chromeStepsBox.innerHTML =
          '<li><strong>Fastest:</strong> Click the <strong>Open in Treva</strong> (pop-out square) icon at the right edge of Chrome\'s address bar.</li>' +
          '<li><strong>Via Chrome Menu:</strong> Click <strong>&vellip; &rarr; Open in Treva</strong> (or <strong>Cast, save, and share &rarr; Install page as app...</strong> if not yet installed on this Chrome profile).</li>';
      }
      return;
    }

    // chrome-menu-install (beforeinstallprompt not fired yet or suppressed)
    if (els.statusBadge) els.statusBadge.textContent = 'Chrome App Ready';
    if (els.statusText) {
      els.statusText.textContent =
        'If Chrome has not popped the automatic install banner yet (or if Treva is already installed on this profile), use Chrome\'s built-in app controls:';
    }
    if (els.primaryActionBtn) {
      els.primaryActionBtn.classList.add('hidden');
    }
    if (els.chromeStepsBox) {
      els.chromeStepsBox.innerHTML =
        '<li><strong>Install as App:</strong> Click the install icon in Chrome\'s address bar, or open <strong>Chrome Menu (&vellip;) &rarr; Cast, save, and share &rarr; Install page as app...</strong></li>' +
        '<li><strong>Already Installed?</strong> Click the <strong>Open in Treva</strong> icon in the address bar or <strong>&vellip; &rarr; Open in Treva</strong>.</li>';
    }
  }

  function openAppModal() {
    syncUi();
    if (els.modal) {
      els.modal.classList.remove('hidden');
    }
  }

  function closeAppModal() {
    if (els.modal) {
      els.modal.classList.add('hidden');
    }
  }

  async function triggerInstallPrompt() {
    if (!state.deferredPrompt) {
      openAppModal();
      return;
    }

    const promptEvent = state.deferredPrompt;
    state.deferredPrompt = null;
    syncUi();

    try {
      await promptEvent.prompt();
      const choice = await promptEvent.userChoice;
      if (choice && choice.outcome === 'accepted') {
        writeInstalledHint(true);
        closeAppModal();
        notify('Treva Chrome App installed.', 'success');
      } else {
        notify('Chrome App installation dismissed.', 'info');
      }
    } catch (_err) {
      openAppModal();
    } finally {
      syncUi();
    }
  }

  function handleAppButtonClick() {
    const mode = getModeSummary();
    if (mode === 'install-ready') {
      triggerInstallPrompt();
      return;
    }
    openAppModal();
  }

  async function refreshRelatedInstalledApps() {
    if (typeof navigator.getInstalledRelatedApps !== 'function') return;
    try {
      const apps = await navigator.getInstalledRelatedApps();
      state.relatedInstalled = Array.isArray(apps) && apps.length > 0;
      if (state.relatedInstalled) {
        writeInstalledHint(true);
      }
      syncUi();
    } catch (_err) {
      // Unsupported or restricted origin; fallback state handles cleanly.
    }
  }

  async function registerServiceWorker() {
    if (!('serviceWorker' in navigator) || !isAppCapableOrigin()) {
      syncUi();
      return;
    }

    try {
      const reg = await navigator.serviceWorker.register('./sw.js', { scope: './' });
      state.swReady = Boolean(reg);
      if (reg && reg.waiting) {
        reg.waiting.postMessage({ type: 'SKIP_WAITING' });
      }
    } catch (err) {
      console.warn('Treva service worker registration skipped:', err);
    } finally {
      syncUi();
    }
  }

  function applyLaunchViewShortcut() {
    const params = new URLSearchParams(window.location.search);
    if (params.get('view') === 'voice') {
      const voiceToggleBtn = document.getElementById('togglePureVoiceBtn');
      if (voiceToggleBtn && !voiceToggleBtn.classList.contains('active')) {
        setTimeout(() => voiceToggleBtn.click(), 250);
      }
    }
  }

  function bindEvents() {
    [els.topbarBtn, els.pureBtn, els.drawerBtn].forEach((btn) => {
      if (btn) btn.addEventListener('click', handleAppButtonClick);
    });

    if (els.closeModalBtn) {
      els.closeModalBtn.addEventListener('click', closeAppModal);
    }

    if (els.modal) {
      els.modal.addEventListener('click', (event) => {
        if (event.target === els.modal) closeAppModal();
      });
    }

    if (els.primaryActionBtn) {
      els.primaryActionBtn.addEventListener('click', triggerInstallPrompt);
    }

    if (els.switchOriginBtn) {
      els.switchOriginBtn.addEventListener('click', () => {
        const target = els.switchOriginBtn.dataset.targetUrl;
        if (target) window.location.href = target;
      });
    }

    if (els.copyUrlBtn) {
      els.copyUrlBtn.addEventListener('click', async () => {
        const appUrl = window.location.origin + window.location.pathname;
        try {
          await navigator.clipboard.writeText(appUrl);
          notify('App URL copied to clipboard.', 'success');
        } catch (_err) {
          notify(appUrl, 'info');
        }
      });
    }

    if (els.openTabBtn) {
      els.openTabBtn.addEventListener('click', () => {
        window.open(window.location.href, '_blank', 'noopener');
      });
    }

    window.addEventListener('beforeinstallprompt', (event) => {
      event.preventDefault();
      state.deferredPrompt = event;
      writeInstalledHint(false);
      syncUi();
    });

    window.addEventListener('appinstalled', () => {
      state.deferredPrompt = null;
      writeInstalledHint(true);
      closeAppModal();
      syncUi();
      notify('Treva installed as a Chrome App.', 'success');
    });

    if (window.matchMedia) {
      const standaloneMq = window.matchMedia('(display-mode: standalone)');
      if (typeof standaloneMq.addEventListener === 'function') {
        standaloneMq.addEventListener('change', syncUi);
      }
    }
  }

  bindEvents();
  syncUi();
  registerServiceWorker();
  refreshRelatedInstalledApps();
  applyLaunchViewShortcut();
})();
