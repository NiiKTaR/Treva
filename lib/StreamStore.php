<?php
/**
 * Pure PHP Stream Chunk Relay & Device Registry Store
 * Stores live audio/video chunks atomically on disk with rolling cleanup.
 * Zero databases, zero daemons, zero executables required.
 */
class StreamStore
{
    private string $baseDir;
    private string $settingsFile;
    private array $memoryVault;

    public function __construct(?string $baseDir = null)
    {
        $this->baseDir = $baseDir ?: dirname(__DIR__) . DIRECTORY_SEPARATOR . 'data';
        $this->settingsFile = $this->baseDir . DIRECTORY_SEPARATOR . 'settings.json';
        $this->memoryVault = self::defaultVault();
        if (!is_dir($this->baseDir)) {
            @mkdir($this->baseDir, 0775, true);
        }
    }

    private static function defaultSmartConfigRaw(): array
    {
        return [
            'tuya' => [
                'accessId' => '',
                'accessSecret' => '',
                'region' => 'us',
                'uid' => '',
                'sampleDeviceId' => ''
            ],
            'magicHome' => [
                'email' => '',
                'password' => '',
                'token' => '',
                'region' => 'us'
            ],
            'openai' => [
                'apiKey' => '',
                'model' => 'gpt-realtime-mini',
                'voice' => 'verse',
                'chatModel' => 'gpt-6-luna',
                'reasoningEffort' => 'low'
            ]
        ];
    }

    private static function defaultVault(): array
    {
        return [
            'hydrated' => false,
            'smartConfig' => self::defaultSmartConfigRaw(),
            'smartDevices' => [],
            'smartScenes' => ['homeId' => '', 'homeName' => '', 'scenes' => []],
            'smartSceneLinks' => ['updatedAt' => 0, 'customBySceneId' => [], 'sliceScenes' => [], 'catalog' => []],
            'devices' => []
        ];
    }

    public function initSession(bool $readOnly = false): void
    {
        if (session_status() === PHP_SESSION_NONE && !headers_sent()) {
            @ini_set('session.use_only_cookies', '1');
            @ini_set('session.use_strict_mode', '1');
            @session_set_cookie_params([
                'lifetime' => 0,
                'path' => '/',
                'httponly' => true,
                'samesite' => 'Lax'
            ]);
            @session_start($readOnly ? ['read_and_close' => true] : []);
        }
        if (isset($_SESSION['treva_vault']) && is_array($_SESSION['treva_vault'])) {
            $this->memoryVault = array_replace(self::defaultVault(), $_SESSION['treva_vault']);
        }
    }

    private function readVault(): array
    {
        if (session_status() === PHP_SESSION_ACTIVE) {
            if (!isset($_SESSION['treva_vault']) || !is_array($_SESSION['treva_vault'])) {
                $_SESSION['treva_vault'] = $this->memoryVault;
            }
            $this->memoryVault = array_replace(self::defaultVault(), $_SESSION['treva_vault']);
        } elseif (isset($_SESSION['treva_vault']) && is_array($_SESSION['treva_vault'])) {
            // Read-only session after read_and_close keeps $_SESSION populated in memory
            $this->memoryVault = array_replace(self::defaultVault(), $_SESSION['treva_vault']);
        }
        return $this->memoryVault;
    }

    private function writeVault(array $vault): void
    {
        $normalized = array_replace(self::defaultVault(), $vault);
        $this->memoryVault = $normalized;
        if (session_status() === PHP_SESSION_ACTIVE) {
            $_SESSION['treva_vault'] = $normalized;
        }
    }

    public function hasSessionVaultData(): bool
    {
        $v = $this->readVault();
        $cfg = $v['smartConfig'] ?? [];
        return !empty($v['hydrated'])
            || trim((string)($cfg['tuya']['accessId'] ?? '')) !== ''
            || trim((string)($cfg['tuya']['accessSecret'] ?? '')) !== ''
            || trim((string)($cfg['magicHome']['email'] ?? '')) !== ''
            || trim((string)($cfg['magicHome']['token'] ?? '')) !== ''
            || trim((string)($cfg['openai']['apiKey'] ?? '')) !== ''
            || !empty($v['smartDevices'])
            || !empty($v['devices'])
            || !empty($v['smartScenes']['scenes']);
    }

    public function exportSessionVault(): array
    {
        $v = $this->readVault();
        $rawCfg = $this->readSmartConfigRaw($v);
        $constKey = defined('OPENAI_API_KEY') ? trim((string)OPENAI_API_KEY) : '';
        if ($constKey !== '' && ($rawCfg['openai']['apiKey'] ?? '') === $constKey) {
            $rawCfg['openai']['apiKey'] = '';
        }
        return [
            'version' => 1,
            'updatedAt' => time(),
            'smartConfig' => $rawCfg,
            'smartDevices' => is_array($v['smartDevices'] ?? null) ? $v['smartDevices'] : [],
            'smartScenes' => is_array($v['smartScenes'] ?? null) ? $v['smartScenes'] : ['homeId' => '', 'homeName' => '', 'scenes' => []],
            'smartSceneLinks' => is_array($v['smartSceneLinks'] ?? null) ? $v['smartSceneLinks'] : ['updatedAt' => 0, 'customBySceneId' => [], 'sliceScenes' => [], 'catalog' => []],
            'devices' => is_array($v['devices'] ?? null) ? $v['devices'] : []
        ];
    }

    public function hydrateSessionVault(array $incoming): array
    {
        $defaults = self::defaultVault();
        $rawCfg = self::defaultSmartConfigRaw();
        $inCfg = is_array($incoming['smartConfig'] ?? null) ? $incoming['smartConfig'] : [];
        foreach (['tuya', 'magicHome', 'openai'] as $sec) {
            if (isset($inCfg[$sec]) && is_array($inCfg[$sec])) {
                foreach ($rawCfg[$sec] as $k => $defVal) {
                    if (array_key_exists($k, $inCfg[$sec])) {
                        $rawCfg[$sec][$k] = trim((string)$inCfg[$sec][$k]);
                    }
                }
            }
        }
        $constKey = defined('OPENAI_API_KEY') ? trim((string)OPENAI_API_KEY) : '';
        if ($constKey !== '' && ($rawCfg['openai']['apiKey'] ?? '') === $constKey) {
            $rawCfg['openai']['apiKey'] = '';
        }

        $smartDevices = [];
        if (isset($incoming['smartDevices']) && is_array($incoming['smartDevices'])) {
            foreach ($incoming['smartDevices'] as $k => $dev) {
                if (!is_array($dev)) continue;
                $id = trim((string)($dev['id'] ?? $k));
                if ($id === '') continue;
                $dev['id'] = $id;
                $smartDevices[$id] = $dev;
            }
        }

        $smartScenes = $defaults['smartScenes'];
        if (isset($incoming['smartScenes']) && is_array($incoming['smartScenes'])) {
            $smartScenes = [
                'homeId' => trim((string)($incoming['smartScenes']['homeId'] ?? '')),
                'homeName' => trim((string)($incoming['smartScenes']['homeName'] ?? '')),
                'scenes' => is_array($incoming['smartScenes']['scenes'] ?? null) ? array_values($incoming['smartScenes']['scenes']) : [],
                'updatedAt' => (int)($incoming['smartScenes']['updatedAt'] ?? 0)
            ];
        }

        $smartSceneLinks = $defaults['smartSceneLinks'];
        if (isset($incoming['smartSceneLinks']) && is_array($incoming['smartSceneLinks'])) {
            $inLinks = $incoming['smartSceneLinks'];
            $smartSceneLinks = [
                'updatedAt' => (int)($inLinks['updatedAt'] ?? 0),
                'customBySceneId' => is_array($inLinks['customBySceneId'] ?? null) ? $inLinks['customBySceneId'] : [],
                'sliceScenes' => is_array($inLinks['sliceScenes'] ?? null) ? $inLinks['sliceScenes'] : [],
                'catalog' => is_array($inLinks['catalog'] ?? null) ? $inLinks['catalog'] : []
            ];
        }

        $devices = [];
        if (isset($incoming['devices']) && is_array($incoming['devices'])) {
            foreach ($incoming['devices'] as $k => $dev) {
                if (!is_array($dev)) continue;
                $id = trim((string)($dev['id'] ?? $k));
                if ($id === '') continue;
                $dev['id'] = $id;
                $devices[$id] = $dev;
            }
        }

        $vault = [
            'hydrated' => true,
            'smartConfig' => $rawCfg,
            'smartDevices' => $smartDevices,
            'smartScenes' => $smartScenes,
            'smartSceneLinks' => $smartSceneLinks,
            'devices' => $devices
        ];
        $this->writeVault($vault);
        return $vault;
    }

    public function clearSessionVault(): void
    {
        $this->memoryVault = self::defaultVault();
        if (session_status() === PHP_SESSION_ACTIVE) {
            $_SESSION['treva_vault'] = $this->memoryVault;
            unset($_SESSION['treva_tuya_tokens']);
            if (!headers_sent()) {
                @session_regenerate_id(true);
            }
        }
    }

    public static function sanitizeId(string $val, string $fallback = 'live'): string
    {
        $clean = preg_replace('/[^a-zA-Z0-9_-]/', '', $val);
        return $clean !== '' ? substr($clean, 0, 48) : $fallback;
    }

    // =========================================================================
    // ATOMIC LOCKED JSON STORAGE HELPERS (Prevent concurrent read/write races)
    // =========================================================================

    private function lockPath(string $name): string
    {
        if (!is_dir($this->baseDir)) {
            @mkdir($this->baseDir, 0775, true);
        }
        return $this->baseDir . DIRECTORY_SEPARATOR . '.' . preg_replace('/[^a-zA-Z0-9_-]/', '', $name) . '.lock';
    }

    private function withJsonLock(string $name, bool $exclusive, callable $fn)
    {
        $fp = @fopen($this->lockPath($name), 'c+');
        if ($fp) {
            @flock($fp, $exclusive ? LOCK_EX : LOCK_SH);
        }
        try {
            return $fn();
        } finally {
            if ($fp) {
                @flock($fp, LOCK_UN);
                @fclose($fp);
            }
        }
    }

    private function readJsonFileRaw(string $path, ?string $backupPath = null): ?array
    {
        if (is_file($path)) {
            $raw = (string)@file_get_contents($path);
            if (trim($raw) !== '') {
                $decoded = json_decode($raw, true);
                if (is_array($decoded)) {
                    return $decoded;
                }
            }
        }
        if ($backupPath !== null && is_file($backupPath)) {
            $bakRaw = (string)@file_get_contents($backupPath);
            $bakDecoded = trim($bakRaw) !== '' ? json_decode($bakRaw, true) : null;
            if (is_array($bakDecoded)) {
                $this->writeJsonFileRaw($path, $bakDecoded);
                return $bakDecoded;
            }
        }
        return null;
    }

    private function writeJsonFileRaw(string $path, array $data, ?string $backupPath = null): bool
    {
        if (!is_dir($this->baseDir)) {
            @mkdir($this->baseDir, 0775, true);
        }
        $json = json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        if ($json === false) {
            return false;
        }
        $tmp = $path . '.' . uniqid('', true) . '.tmp';
        $ok = false;
        if (@file_put_contents($tmp, $json) !== false) {
            if (@rename($tmp, $path)) {
                $ok = true;
            } else {
                // Windows fallback if rename momentarily contends
                if (@copy($tmp, $path)) {
                    $ok = true;
                }
                @unlink($tmp);
            }
        }
        if (!$ok) {
            $ok = @file_put_contents($path, $json, LOCK_EX) !== false;
        }
        if ($ok && $backupPath !== null && !empty($data)) {
            $bakTmp = $backupPath . '.' . uniqid('', true) . '.tmp';
            if (@file_put_contents($bakTmp, $json) !== false) {
                if (!@rename($bakTmp, $backupPath)) {
                    @copy($bakTmp, $backupPath);
                    @unlink($bakTmp);
                }
            }
        }
        return $ok;
    }

    public function getSettings(): array
    {
        $defaults = ['selectedLanIp' => NetworkHelper::getPrimaryLanIp()];
        return $this->withJsonLock('settings', false, function () use ($defaults) {
            $data = $this->readJsonFileRaw($this->settingsFile);
            return is_array($data) ? array_merge($defaults, $data) : $defaults;
        });
    }

    public function saveSettings(array $patch): array
    {
        return $this->withJsonLock('settings', true, function () use ($patch) {
            $defaults = ['selectedLanIp' => NetworkHelper::getPrimaryLanIp()];
            $data = $this->readJsonFileRaw($this->settingsFile);
            $current = is_array($data) ? array_merge($defaults, $data) : $defaults;
            $next = array_merge($current, $patch);
            $this->writeJsonFileRaw($this->settingsFile, $next);
            return $next;
        });
    }

    public function getDevices(): array
    {
        $v = $this->readVault();
        return is_array($v['devices'] ?? null) ? $v['devices'] : [];
    }

    public function saveDevices(array $devicesById): array
    {
        $v = $this->readVault();
        $v['devices'] = $devicesById;
        $v['hydrated'] = true;
        $this->writeVault($v);
        return $devicesById;
    }

    public function mergeDiscoveredDevices(array $discoveredList): array
    {
        $v = $this->readVault();
        $existing = is_array($v['devices'] ?? null) ? $v['devices'] : [];
        $now = time();

        foreach ($existing as $id => &$dev) {
            if (empty($dev['isManual'])) {
                $dev['online'] = ($now - ($dev['lastSeen'] ?? 0)) < 180;
            }
        }
        unset($dev);

        foreach ($discoveredList as $d) {
            $id = $d['id'];
            $prev = $existing[$id] ?? [];
            $existing[$id] = array_merge($prev, $d, [
                'lastSeen' => $now,
                'online' => true,
                'status' => $prev['status'] ?? 'IDLE',
                'volume' => $prev['volume'] ?? 0.7,
                'muted' => $prev['muted'] ?? false
            ]);
        }

        $v['devices'] = $existing;
        $v['hydrated'] = true;
        $this->writeVault($v);
        return $existing;
    }

    public function updateDevice(string $id, array $patch): ?array
    {
        $v = $this->readVault();
        $devices = is_array($v['devices'] ?? null) ? $v['devices'] : [];
        if (!isset($devices[$id])) return null;
        $devices[$id] = array_merge($devices[$id], $patch);
        $v['devices'] = $devices;
        $this->writeVault($v);
        return $devices[$id];
    }

    public function addManualDevice(string $name, string $host, int $port = 8009, string $kind = 'speaker'): array
    {
        $host = trim($host);
        if ($host === '') {
            throw new InvalidArgumentException('Device IP or hostname is required');
        }
        $id = 'manual-' . preg_replace('/[^a-zA-Z0-9_.-]/', '-', $host) . '-' . $port;
        $v = $this->readVault();
        $devices = is_array($v['devices'] ?? null) ? $v['devices'] : [];
        $devices[$id] = [
            'id' => $id,
            'name' => trim($name) !== '' ? trim($name) : "Google Nest ({$host})",
            'model' => $kind === 'speaker' ? 'Google Nest Speaker (Manual)' : 'Google Cast Display (Manual)',
            'host' => $host,
            'port' => $port,
            'capabilities' => $kind === 'speaker' ? 4 : 5,
            'kind' => $kind === 'display' ? 'display' : 'speaker',
            'supportsVideo' => $kind === 'display',
            'supportsAudio' => true,
            'online' => true,
            'isManual' => true,
            'status' => 'IDLE',
            'volume' => 0.7,
            'muted' => false,
            'lastSeen' => time()
        ];
        $v['devices'] = $devices;
        $v['hydrated'] = true;
        $this->writeVault($v);
        return $devices[$id];
    }

    public function removeDevice(string $id): void
    {
        $v = $this->readVault();
        $devices = is_array($v['devices'] ?? null) ? $v['devices'] : [];
        unset($devices[$id]);
        $v['devices'] = $devices;
        $this->writeVault($v);
    }

    // =========================================================================
    // LIVE STREAM CHUNK STORE (Per-format isolated lock-safe queues)
    // =========================================================================

    private function streamDir(string $sid): string
    {
        $sid = self::sanitizeId($sid);
        return $this->baseDir . DIRECTORY_SEPARATOR . 'streams' . DIRECTORY_SEPARATOR . $sid;
    }

    private function formatDir(string $sid, string $fmt): string
    {
        $fmt = ($fmt === 'webm') ? 'webm' : 'mp3';
        return $this->streamDir($sid) . DIRECTORY_SEPARATOR . $fmt;
    }

    private function metaPath(string $sid): string
    {
        return $this->streamDir($sid) . DIRECTORY_SEPARATOR . 'meta.json';
    }

    public function startStream(string $sid, string $mode = 'audio'): array
    {
        $sid = self::sanitizeId($sid);
        $dir = $this->streamDir($sid);
        $this->clearDirectory($dir);
        @mkdir($dir . DIRECTORY_SEPARATOR . 'mp3', 0775, true);
        @mkdir($dir . DIRECTORY_SEPARATOR . 'webm', 0775, true);
        @mkdir($dir . DIRECTORY_SEPARATOR . 'listeners', 0775, true);

        $meta = [
            'sid' => $sid,
            'isStreaming' => true,
            'streamMode' => ($mode === 'video') ? 'video' : 'audio',
            'startedAt' => microtime(true),
            'updatedAt' => microtime(true)
        ];
        @file_put_contents($this->metaPath($sid), json_encode($meta), LOCK_EX);

        $this->writeFormatState($sid, 'mp3', [
            'seq' => 0,
            'initSeq' => 0,
            'bytes' => 0,
            'needKeyframeAt' => 0.0,
            'updatedAt' => microtime(true)
        ]);
        $this->writeFormatState($sid, 'webm', [
            'seq' => 0,
            'initSeq' => 0,
            'bytes' => 0,
            'needKeyframeAt' => 0.0,
            'updatedAt' => microtime(true)
        ]);

        return $this->getStreamStatus($sid);
    }

    public function stopStream(string $sid): array
    {
        $sid = self::sanitizeId($sid);
        $meta = $this->getMeta($sid);
        $meta['isStreaming'] = false;
        $meta['updatedAt'] = microtime(true);
        if (!is_dir($this->streamDir($sid))) {
            @mkdir($this->streamDir($sid), 0775, true);
        }
        @file_put_contents($this->metaPath($sid), json_encode($meta), LOCK_EX);
        return $this->getStreamStatus($sid);
    }

    public function heartbeatStream(string $sid): array
    {
        $sid = self::sanitizeId($sid);
        $dir = $this->streamDir($sid);
        if (!is_dir($dir)) {
            @mkdir($dir, 0775, true);
        }
        $lockFp = @fopen($dir . DIRECTORY_SEPARATOR . 'meta.lock', 'c');
        if ($lockFp) @flock($lockFp, LOCK_EX);
        try {
            $meta = $this->getMeta($sid);
            if (!empty($meta['isStreaming'])) {
                $meta['updatedAt'] = microtime(true);
                @file_put_contents($this->metaPath($sid), json_encode($meta), LOCK_EX);
            }
        } finally {
            if ($lockFp) {
                @flock($lockFp, LOCK_UN);
                @fclose($lockFp);
            }
        }
        return $this->getStreamStatus($sid);
    }

    public function getMeta(string $sid): array
    {
        $path = $this->metaPath($sid);
        if (!is_file($path)) {
            return [
                'sid' => self::sanitizeId($sid),
                'isStreaming' => false,
                'streamMode' => 'audio',
                'startedAt' => null,
                'updatedAt' => 0
            ];
        }
        $decoded = json_decode((string)@file_get_contents($path), true);
        return is_array($decoded) ? $decoded : [];
    }

    private function getFormatStateRaw(string $sid, string $fmt): array
    {
        $fdir = $this->formatDir($sid, $fmt);
        $statePath = $fdir . DIRECTORY_SEPARATOR . 'state.json';
        if (!is_file($statePath)) {
            return ['seq' => 0, 'initSeq' => 0, 'bytes' => 0, 'needKeyframeAt' => 0.0, 'updatedAt' => 0];
        }
        $decoded = json_decode((string)@file_get_contents($statePath), true);
        return is_array($decoded) ? $decoded : ['seq' => 0, 'initSeq' => 0, 'bytes' => 0, 'needKeyframeAt' => 0.0, 'updatedAt' => 0];
    }

    public function getFormatState(string $sid, string $fmt): array
    {
        $fdir = $this->formatDir($sid, $fmt);
        if (!is_file($fdir . DIRECTORY_SEPARATOR . 'state.json')) {
            return ['seq' => 0, 'initSeq' => 0, 'bytes' => 0, 'needKeyframeAt' => 0.0, 'updatedAt' => 0];
        }
        $lockFp = @fopen($fdir . DIRECTORY_SEPARATOR . 'state.lock', 'c');
        if ($lockFp) @flock($lockFp, LOCK_SH);
        try {
            return $this->getFormatStateRaw($sid, $fmt);
        } finally {
            if ($lockFp) {
                @flock($lockFp, LOCK_UN);
                @fclose($lockFp);
            }
        }
    }

    private function writeFormatStateRaw(string $sid, string $fmt, array $state): void
    {
        $fdir = $this->formatDir($sid, $fmt);
        if (!is_dir($fdir)) {
            @mkdir($fdir, 0775, true);
        }
        $statePath = $fdir . DIRECTORY_SEPARATOR . 'state.json';
        $json = json_encode($state);
        $tmp = $statePath . '.' . uniqid('', true) . '.tmp';
        if (@file_put_contents($tmp, $json) !== false) {
            if (!@rename($tmp, $statePath)) {
                @unlink($tmp);
                @file_put_contents($statePath, $json, LOCK_EX);
            }
        } else {
            @file_put_contents($statePath, $json, LOCK_EX);
        }
    }

    private function writeFormatState(string $sid, string $fmt, array $state): void
    {
        $fdir = $this->formatDir($sid, $fmt);
        if (!is_dir($fdir)) {
            @mkdir($fdir, 0775, true);
        }
        $lockFp = @fopen($fdir . DIRECTORY_SEPARATOR . 'state.lock', 'c');
        if ($lockFp) @flock($lockFp, LOCK_EX);
        try {
            $this->writeFormatStateRaw($sid, $fmt, $state);
        } finally {
            if ($lockFp) {
                @flock($lockFp, LOCK_UN);
                @fclose($lockFp);
            }
        }
    }

    public function getStreamStatus(string $sid): array
    {
        $sid = self::sanitizeId($sid);
        $meta = $this->getMeta($sid);
        $mp3State = $this->getFormatState($sid, 'mp3');
        $webmState = $this->getFormatState($sid, 'webm');
        $listeners = $this->getListenerCounts($sid);

        $isStreaming = !empty($meta['isStreaming']);
        // Auto-expire stale streams only after 60s without chunks or client heartbeat
        $lastActive = max((float)($meta['updatedAt'] ?? 0), (float)($mp3State['updatedAt'] ?? 0), (float)($webmState['updatedAt'] ?? 0));
        if ($isStreaming && $lastActive > 0 && (microtime(true) - $lastActive) > 60.0) {
            $isStreaming = false;
        }

        return [
            'sid' => $sid,
            'isStreaming' => $isStreaming,
            'streamMode' => $meta['streamMode'] ?? 'audio',
            'startedAt' => $meta['startedAt'] ?? null,
            'bytesReceived' => (int)($mp3State['bytes'] ?? 0) + (int)($webmState['bytes'] ?? 0),
            'mp3Seq' => (int)($mp3State['seq'] ?? 0),
            'webmSeq' => (int)($webmState['seq'] ?? 0),
            'mp3Listeners' => $listeners['mp3'],
            'webmListeners' => $listeners['webm']
        ];
    }

    public function pushChunk(string $sid, string $fmt, string $bytes, bool $isInit = false, int $sampleRate = 44100): array
    {
        $sid = self::sanitizeId($sid);
        $fmt = ($fmt === 'webm') ? 'webm' : 'mp3';
        $fdir = $this->formatDir($sid, $fmt);
        if (!is_dir($fdir)) {
            @mkdir($fdir, 0775, true);
        }

        $lockFp = @fopen($fdir . DIRECTORY_SEPARATOR . 'state.lock', 'c+');
        if ($lockFp) {
            @flock($lockFp, LOCK_EX);
        }

        $state = $this->getFormatStateRaw($sid, $fmt);
        $nextSeq = ((int)($state['seq'] ?? 0)) + 1;

        $chunkFile = $this->chunkPath($sid, $fmt, $nextSeq);
        $tmpFile = $chunkFile . '.tmp';
        file_put_contents($tmpFile, $bytes);
        if (!@rename($tmpFile, $chunkFile)) {
            @unlink($tmpFile);
            @file_put_contents($chunkFile, $bytes, LOCK_EX);
        }

        $state['seq'] = $nextSeq;
        $state['bytes'] = ((int)($state['bytes'] ?? 0)) + strlen($bytes);
        $state['updatedAt'] = microtime(true);
        if ($fmt === 'mp3' && $sampleRate > 0) {
            $state['sampleRate'] = $sampleRate;
        }
        if ($fmt === 'webm' && $isInit) {
            $state['initSeq'] = $nextSeq;
            $state['needKeyframeAt'] = 0.0;
        }

        $keyframeReset = false;
        if ($fmt === 'webm' && !$isInit && !empty($state['needKeyframeAt']) && (microtime(true) - $state['needKeyframeAt']) < 6.0) {
            $keyframeReset = true;
            $state['needKeyframeAt'] = 0.0;
        }

        $this->writeFormatStateRaw($sid, $fmt, $state);

        if ($lockFp) {
            @flock($lockFp, LOCK_UN);
            @fclose($lockFp);
        }

        // Rolling cleanup every 15 chunks (keeps last ~90 chunks)
        if ($nextSeq % 15 === 0 && $nextSeq > 95) {
            $cutoff = $nextSeq - 95;
            for ($s = max(1, $cutoff - 25); $s <= $cutoff; $s++) {
                $old = $this->chunkPath($sid, $fmt, $s);
                if (is_file($old)) {
                    @unlink($old);
                }
            }
        }

        return [
            'seq' => $nextSeq,
            'bytesReceived' => $state['bytes'],
            'keyframeReset' => $keyframeReset
        ];
    }

    public function requestWebmKeyframe(string $sid): void
    {
        $sid = self::sanitizeId($sid);
        $fdir = $this->formatDir($sid, 'webm');
        if (!is_dir($fdir)) return;

        $lockFp = @fopen($fdir . DIRECTORY_SEPARATOR . 'state.lock', 'c+');
        if ($lockFp) {
            @flock($lockFp, LOCK_EX);
        }
        $state = $this->getFormatStateRaw($sid, 'webm');
        $prevReq = (float)($state['needKeyframeAt'] ?? 0.0);
        if ($prevReq <= 0.0 || (microtime(true) - $prevReq) > 1.8) {
            $state['needKeyframeAt'] = microtime(true);
            $this->writeFormatStateRaw($sid, 'webm', $state);
        }
        if ($lockFp) {
            @flock($lockFp, LOCK_UN);
            @fclose($lockFp);
        }
    }

    public function chunkPath(string $sid, string $fmt, int $seq): string
    {
        return $this->formatDir($sid, $fmt) . DIRECTORY_SEPARATOR . sprintf('chunk_%08d.bin', $seq);
    }

    public function touchListener(string $sid, string $listenerId, string $fmt): void
    {
        $ldir = $this->streamDir($sid) . DIRECTORY_SEPARATOR . 'listeners';
        if (!is_dir($ldir)) {
            @mkdir($ldir, 0775, true);
        }
        $file = $ldir . DIRECTORY_SEPARATOR . preg_replace('/[^a-zA-Z0-9_-]/', '', $listenerId) . '.' . ($fmt === 'webm' ? 'webm' : 'mp3');
        @file_put_contents($file, (string)time());
    }

    public function removeListener(string $sid, string $listenerId, string $fmt): void
    {
        $file = $this->streamDir($sid) . DIRECTORY_SEPARATOR . 'listeners' . DIRECTORY_SEPARATOR . preg_replace('/[^a-zA-Z0-9_-]/', '', $listenerId) . '.' . ($fmt === 'webm' ? 'webm' : 'mp3');
        if (is_file($file)) {
            @unlink($file);
        }
    }

    public function getListenerCounts(string $sid): array
    {
        $ldir = $this->streamDir($sid) . DIRECTORY_SEPARATOR . 'listeners';
        $mp3 = 0;
        $webm = 0;
        if (!is_dir($ldir)) {
            return ['mp3' => 0, 'webm' => 0];
        }
        $now = time();
        foreach (glob($ldir . DIRECTORY_SEPARATOR . '*') ?: [] as $file) {
            $ts = (int)@file_get_contents($file);
            if ($now - $ts > 6) {
                @unlink($file);
                continue;
            }
            if (str_ends_with($file, '.webm')) $webm++;
            elseif (str_ends_with($file, '.mp3')) $mp3++;
        }
        return ['mp3' => $mp3, 'webm' => $webm];
    }

    // =========================================================================
    // SMART LIFE (TUYA) & MAGIC HOME SESSION-SCOPED CONFIG / DEVICE REGISTRY
    // =========================================================================

    private function readSmartConfigRaw(?array $vault = null): array
    {
        $v = $vault ?? $this->readVault();
        $defaults = self::defaultSmartConfigRaw();
        $data = is_array($v['smartConfig'] ?? null) ? $v['smartConfig'] : [];
        return [
            'tuya' => array_merge($defaults['tuya'], is_array($data['tuya'] ?? null) ? $data['tuya'] : []),
            'magicHome' => array_merge($defaults['magicHome'], is_array($data['magicHome'] ?? null) ? $data['magicHome'] : []),
            'openai' => array_merge($defaults['openai'], is_array($data['openai'] ?? null) ? $data['openai'] : [])
        ];
    }

    public function getSmartConfig(): array
    {
        $cfg = $this->readSmartConfigRaw();
        $constKey = defined('OPENAI_API_KEY') ? trim((string)OPENAI_API_KEY) : '';
        if (trim((string)($cfg['openai']['apiKey'] ?? '')) === '' && $constKey !== '') {
            $cfg['openai']['apiKey'] = $constKey;
        }
        return $cfg;
    }

    public function getSmartConfigPublic(): array
    {
        $cfg = $this->readSmartConfigRaw();
        $sessionOpenAiKey = trim((string)($cfg['openai']['apiKey'] ?? ''));
        $serverOpenAiKey = defined('OPENAI_API_KEY') ? trim((string)OPENAI_API_KEY) : '';
        $hasSessionKey = $sessionOpenAiKey !== '';
        $hasServerKey = $serverOpenAiKey !== '';
        return [
            'tuya' => [
                'configured' => $cfg['tuya']['accessId'] !== '' && $cfg['tuya']['accessSecret'] !== '',
                'accessId' => $cfg['tuya']['accessId'],
                'hasSecret' => $cfg['tuya']['accessSecret'] !== '',
                'region' => $cfg['tuya']['region'],
                'uid' => $cfg['tuya']['uid'],
                'sampleDeviceId' => $cfg['tuya']['sampleDeviceId']
            ],
            'magicHome' => [
                'configured' => $cfg['magicHome']['token'] !== '' || ($cfg['magicHome']['email'] !== '' && $cfg['magicHome']['password'] !== ''),
                'email' => $cfg['magicHome']['email'],
                'hasPassword' => $cfg['magicHome']['password'] !== '',
                'hasToken' => $cfg['magicHome']['token'] !== '',
                'region' => $cfg['magicHome']['region']
            ],
            'openai' => [
                'configured' => $hasSessionKey || $hasServerKey,
                'hasKey' => $hasSessionKey || $hasServerKey,
                'hasSessionKey' => $hasSessionKey,
                'hasServerKey' => $hasServerKey,
                'source' => $hasSessionKey ? 'session' : ($hasServerKey ? 'server' : 'none'),
                'model' => $cfg['openai']['model'] ?? 'gpt-realtime-mini',
                'voice' => $cfg['openai']['voice'] ?? 'verse',
                'chatModel' => $cfg['openai']['chatModel'] ?? 'gpt-6-luna',
                'reasoningEffort' => $cfg['openai']['reasoningEffort'] ?? 'low'
            ]
        ];
    }

    public function saveSmartConfig(array $patch): array
    {
        $v = $this->readVault();
        $cur = $this->readSmartConfigRaw($v);
        $mask = '••••••••';

        if (isset($patch['tuya']) && is_array($patch['tuya'])) {
            $tuyaIdTrimmed = array_key_exists('accessId', $patch['tuya'])
                ? trim((string)$patch['tuya']['accessId'])
                : null;
            foreach ($patch['tuya'] as $k => $vItem) {
                $val = trim((string)$vItem);
                // Keep existing secret if left blank or unchanged masked placeholder while accessId stays present
                if ($k === 'accessSecret' && ($val === $mask || ($val === '' && $cur['tuya']['accessSecret'] !== '' && $tuyaIdTrimmed !== ''))) {
                    continue;
                }
                if (array_key_exists($k, $cur['tuya'])) {
                    $cur['tuya'][$k] = $val;
                }
            }
            if ($tuyaIdTrimmed === '' && trim((string)($patch['tuya']['accessSecret'] ?? '')) === '') {
                $cur['tuya']['accessSecret'] = '';
                $cur['tuya']['uid'] = '';
                $cur['tuya']['sampleDeviceId'] = '';
            }
        }

        if (isset($patch['magicHome']) && is_array($patch['magicHome'])) {
            $mhCredentialsChanged = false;
            $explicitToken = trim((string)($patch['magicHome']['token'] ?? ''));
            $mhEmailTrimmed = array_key_exists('email', $patch['magicHome'])
                ? trim((string)$patch['magicHome']['email'])
                : null;
            foreach ($patch['magicHome'] as $k => $vItem) {
                $val = trim((string)$vItem);
                if ($k === 'password' && ($val === $mask || ($val === '' && $cur['magicHome']['password'] !== '' && $mhEmailTrimmed !== ''))) {
                    continue;
                }
                if ($k === 'token' && ($val === $mask || ($val === '' && $cur['magicHome']['token'] !== ''))) {
                    continue;
                }
                if (array_key_exists($k, $cur['magicHome'])) {
                    if (($k === 'email' || $k === 'password') && $val !== '' && $cur['magicHome'][$k] !== $val) {
                        $mhCredentialsChanged = true;
                    }
                    $cur['magicHome'][$k] = $val;
                }
            }
            if ($mhCredentialsChanged && ($explicitToken === '' || $explicitToken === $mask)) {
                $cur['magicHome']['token'] = '';
            }
            if ($mhEmailTrimmed === '' && trim((string)($patch['magicHome']['password'] ?? '')) === '' && $explicitToken === '') {
                $cur['magicHome']['password'] = '';
                $cur['magicHome']['token'] = '';
            }
        }

        if (isset($patch['openai']) && is_array($patch['openai'])) {
            $clearOpenAi = !empty($patch['openai']['clearApiKey']);
            if ($clearOpenAi) {
                $cur['openai']['apiKey'] = '';
            }
            foreach ($patch['openai'] as $k => $vItem) {
                if ($k === 'clearApiKey') continue;
                $val = trim((string)$vItem);
                if ($k === 'apiKey') {
                    if ($clearOpenAi || $val === $mask || $val === '') {
                        continue;
                    }
                    $constKey = defined('OPENAI_API_KEY') ? trim((string)OPENAI_API_KEY) : '';
                    $cur['openai']['apiKey'] = ($constKey !== '' && $val === $constKey) ? '' : $val;
                } elseif ($k === 'model' && $val !== '') {
                    $cur['openai']['model'] = $val;
                } elseif ($k === 'voice' && $val !== '') {
                    $cur['openai']['voice'] = $val;
                } elseif ($k === 'chatModel' && $val !== '') {
                    $cur['openai']['chatModel'] = $val;
                } elseif ($k === 'reasoningEffort' && $val !== '') {
                    $cur['openai']['reasoningEffort'] = $val;
                }
            }
        }

        $v['smartConfig'] = $cur;
        $v['hydrated'] = true;
        $this->writeVault($v);
        return $this->getSmartConfig();
    }

    public function getSmartScenes(): array
    {
        $defaults = ['homeId' => '', 'homeName' => '', 'scenes' => []];
        $v = $this->readVault();
        $data = $v['smartScenes'] ?? null;
        return is_array($data) ? array_merge($defaults, $data) : $defaults;
    }

    public function saveSmartScenes(array $scenesData): array
    {
        $v = $this->readVault();
        $v['smartScenes'] = $scenesData;
        $v['hydrated'] = true;
        $this->writeVault($v);
        return $scenesData;
    }

    public function getSmartSceneLinks(): array
    {
        $defaults = ['updatedAt' => 0, 'customBySceneId' => [], 'sliceScenes' => [], 'catalog' => []];
        $v = $this->readVault();
        $data = $v['smartSceneLinks'] ?? null;
        if (!is_array($data)) return $defaults;
        $merged = array_merge($defaults, $data);
        if (!is_array($merged['sliceScenes'] ?? null)) {
            $merged['sliceScenes'] = [];
        }
        return $merged;
    }

    public function saveSliceSceneAssignments(string $sliceKey, array $sceneIds): array
    {
        $cleanSlice = trim($sliceKey);
        if ($cleanSlice === '') {
            throw new InvalidArgumentException('sliceKey is required.');
        }
        $cleanIds = [];
        $seen = [];
        foreach ($sceneIds as $sid) {
            $val = trim((string)$sid);
            if ($val === '' || isset($seen[$val])) continue;
            $seen[$val] = true;
            $cleanIds[] = $val;
        }
        $v = $this->readVault();
        $cur = is_array($v['smartSceneLinks'] ?? null)
            ? $v['smartSceneLinks']
            : ['updatedAt' => 0, 'customBySceneId' => [], 'sliceScenes' => [], 'catalog' => []];
        if (!isset($cur['sliceScenes']) || !is_array($cur['sliceScenes'])) {
            $cur['sliceScenes'] = [];
        }
        if (empty($cleanIds)) {
            unset($cur['sliceScenes'][$cleanSlice]);
        } else {
            $cur['sliceScenes'][$cleanSlice] = $cleanIds;
        }
        $cur['updatedAt'] = time();
        $v['smartSceneLinks'] = $cur;
        $v['hydrated'] = true;
        $this->writeVault($v);
        return $cur;
    }

    public function saveSmartSceneCustomLink(string $sceneId, array $voicePhrases, string $notes = ''): array
    {
        $cleanId = trim($sceneId);
        if ($cleanId === '') {
            throw new InvalidArgumentException('sceneId is required.');
        }
        $cleanPhrases = [];
        $seen = [];
        foreach ($voicePhrases as $p) {
            $val = trim((string)$p);
            if ($val === '') continue;
            $k = strtolower($val);
            if (isset($seen[$k])) continue;
            $seen[$k] = true;
            $cleanPhrases[] = $val;
        }
        $v = $this->readVault();
        $cur = is_array($v['smartSceneLinks'] ?? null)
            ? $v['smartSceneLinks']
            : ['updatedAt' => 0, 'customBySceneId' => [], 'sliceScenes' => [], 'catalog' => []];
        if (!isset($cur['customBySceneId']) || !is_array($cur['customBySceneId'])) {
            $cur['customBySceneId'] = [];
        }
        $cleanNotes = trim($notes);
        if (empty($cleanPhrases) && $cleanNotes === '') {
            unset($cur['customBySceneId'][$cleanId]);
        } else {
            $cur['customBySceneId'][$cleanId] = [
                'voicePhrases' => $cleanPhrases,
                'notes' => $cleanNotes,
                'updatedAt' => time()
            ];
        }
        $cur['updatedAt'] = time();
        $v['smartSceneLinks'] = $cur;
        $v['hydrated'] = true;
        $this->writeVault($v);
        return $cur;
    }

    public function updateSmartSceneGeneratedCatalog(array $catalog): array
    {
        $v = $this->readVault();
        $cur = is_array($v['smartSceneLinks'] ?? null)
            ? $v['smartSceneLinks']
            : ['updatedAt' => 0, 'customBySceneId' => [], 'sliceScenes' => [], 'catalog' => []];
        $cur['catalog'] = $catalog;
        $cur['updatedAt'] = time();
        $v['smartSceneLinks'] = $cur;
        $this->writeVault($v);
        return $cur;
    }

    public function getSmartDevices(): array
    {
        $v = $this->readVault();
        return is_array($v['smartDevices'] ?? null) ? $v['smartDevices'] : [];
    }

    public function getSmartDevicesPublic(): array
    {
        $list = [];
        foreach ($this->getSmartDevices() as $dev) {
            $copy = $dev;
            $copy['hasLocalKey'] = !empty($dev['localKey']);
            unset($copy['localKey']);
            $list[] = $copy;
        }
        return $list;
    }

    public function saveSmartDevices(array $devicesById): array
    {
        $v = $this->readVault();
        $v['smartDevices'] = $devicesById;
        $v['hydrated'] = true;
        $this->writeVault($v);
        return $devicesById;
    }

    private static function isPrivateIpv4(string $ip): bool
    {
        if (!filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4)) {
            return false;
        }
        return !filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE);
    }

    private static function findExistingByIp(array $all, string $platform, string $ip, string $excludeId = ''): ?string
    {
        if ($ip === '') return null;
        foreach ($all as $eid => $edev) {
            if ($eid === $excludeId) continue;
            if (($edev['platform'] ?? '') === $platform && ($edev['ip'] ?? '') === $ip) {
                return $eid;
            }
        }
        return null;
    }

    public function upsertSmartDevice(array $dev): array
    {
        $v = $this->readVault();
        $all = is_array($v['smartDevices'] ?? null) ? $v['smartDevices'] : [];

        $id = $dev['id'];
        $platform = $dev['platform'] ?? '';
        $ip = $dev['ip'] ?? '';

        $isScanPlaceholder = str_starts_with($id, 'tuya-ip-') || str_starts_with($id, 'mh-ip-');
        $isManualPlaceholder = str_starts_with($id, 'tuya-manual-') || str_starts_with($id, 'mh-manual-');

        $preserveColorState = !empty($dev['_preserveColorState']);
        unset($dev['_preserveColorState']);

        if ($isScanPlaceholder && $ip !== '') {
            $eid = self::findExistingByIp($all, $platform, $ip, $id);
            if ($eid !== null) {
                $all[$eid]['online'] = true;
                $all[$eid]['updatedAt'] = time();
                if ($platform === 'magichome' && isset($dev['power'])) {
                    $all[$eid] = array_merge($all[$eid], array_intersect_key($dev, array_flip(['power', 'r', 'g', 'b', 'w', 'brightness'])));
                }
                $v['smartDevices'] = $all;
                $v['hydrated'] = true;
                $this->writeVault($v);
                return $all[$eid];
            }
        } elseif ($isManualPlaceholder && $ip !== '') {
            // Manual IP entry: merge into any existing discovered/real record on the same IP
            $eid = self::findExistingByIp($all, $platform, $ip, $id);
            if ($eid !== null) {
                $id = $eid;
                $dev['id'] = $eid;
            }
        } elseif (!$isScanPlaceholder && !$isManualPlaceholder) {
            // Real ID arrived: absorb any temporary/manual placeholder matching the same IP or MAC
            $candidates = [];
            if ($ip !== '') {
                $slug = str_replace('.', '-', $ip);
                $candidates = ['tuya-ip-' . $slug, 'mh-ip-' . $slug, 'tuya-manual-' . $slug, 'mh-manual-' . $slug, 'mh-manual-' . $ip];
            }
            if (!empty($dev['mac'])) {
                foreach ($all as $eid => $edev) {
                    if ($eid !== $id && ($edev['platform'] ?? '') === $platform && strcasecmp((string)($edev['mac'] ?? ''), (string)$dev['mac']) === 0) {
                        $candidates[] = $eid;
                    }
                }
            }
            foreach (array_unique($candidates) as $tmpId) {
                if ($tmpId !== $id && isset($all[$tmpId]) && ($all[$tmpId]['platform'] ?? '') === $platform) {
                    if (empty($dev['localKey']) && !empty($all[$tmpId]['localKey'])) {
                        $dev['localKey'] = $all[$tmpId]['localKey'];
                    }
                    if (empty($dev['mac']) && !empty($all[$tmpId]['mac'])) {
                        $dev['mac'] = $all[$tmpId]['mac'];
                    }
                    if ($ip === '' && !empty($all[$tmpId]['ip'])) {
                        $dev['ip'] = $all[$tmpId]['ip'];
                        $ip = $dev['ip'];
                    }
                    unset($all[$tmpId]);
                }
            }
        }

        $prev = $all[$id] ?? [];
        if ($preserveColorState && !empty($prev)) {
            foreach (['power', 'r', 'g', 'b', 'w', 'brightness'] as $ck) {
                if (array_key_exists($ck, $prev)) {
                    $dev[$ck] = $prev[$ck];
                }
            }
        }
        if (empty($dev['localKey']) && !empty($prev['localKey'])) {
            $dev['localKey'] = $prev['localKey'];
        }
        if (empty($dev['mac']) && !empty($prev['mac'])) {
            $dev['mac'] = $prev['mac'];
        }
        if (!self::isPrivateIpv4($ip) && !empty($prev['ip']) && self::isPrivateIpv4($prev['ip'])) {
            $dev['ip'] = $prev['ip'];
        } elseif ($ip === '' && !empty($prev['ip'])) {
            $dev['ip'] = $prev['ip'];
        }
        $all[$id] = array_merge($prev, $dev, ['updatedAt' => time()]);
        $v['smartDevices'] = $all;
        $v['hydrated'] = true;
        $this->writeVault($v);
        return $all[$id];
    }

    public function removeSmartDevice(string $id): void
    {
        $v = $this->readVault();
        $all = is_array($v['smartDevices'] ?? null) ? $v['smartDevices'] : [];
        unset($all[$id]);
        $v['smartDevices'] = $all;
        $this->writeVault($v);
    }

    private function clearDirectory(string $dir): void
    {
        if (!is_dir($dir)) return;
        $items = scandir($dir);
        if (!is_array($items)) return;
        foreach ($items as $item) {
            if ($item === '.' || $item === '..') continue;
            $full = $dir . DIRECTORY_SEPARATOR . $item;
            if (is_dir($full)) {
                $this->clearDirectory($full);
                @rmdir($full);
            } else {
                @unlink($full);
            }
        }
    }
}
