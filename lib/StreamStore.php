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
    private string $castDevicesFile;
    private string $castNetworksFile;
    private array $memoryVault;

    public function __construct(?string $baseDir = null)
    {
        $this->baseDir = $baseDir ?: dirname(__DIR__) . DIRECTORY_SEPARATOR . 'data';
        $this->settingsFile = $this->baseDir . DIRECTORY_SEPARATOR . 'settings.json';
        $this->castDevicesFile = $this->baseDir . DIRECTORY_SEPARATOR . 'cast_devices.json';
        $this->castNetworksFile = $this->baseDir . DIRECTORY_SEPARATOR . 'cast_networks.json';
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
            'googleNest' => [
                'projectId' => '',
                'clientId' => '',
                'clientSecret' => '',
                'refreshToken' => ''
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
            'networkId' => '',
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
            'networkId' => (string)(($v['networkId'] ?? '') ?: (class_exists('NetworkHelper') ? NetworkHelper::getClientNetworkId() : '')),
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
        foreach (['tuya', 'magicHome', 'googleNest', 'openai'] as $sec) {
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

        $isLocalEnv = !class_exists('NetworkHelper') || NetworkHelper::isLocalEnvironment();
        $currentNetId = class_exists('NetworkHelper') ? NetworkHelper::getClientNetworkId() : '';
        $incomingNetId = trim((string)($incoming['networkId'] ?? ''));
        $isMobileData = !empty($incoming['isMobileData']);
        $networkMismatch = ($incomingNetId !== '' && $currentNetId !== '' && $incomingNetId !== $currentNetId);

        if ($isMobileData) {
            $devices = [];
            if ($isLocalEnv) {
                $this->writeDiskCastDevices([]);
            }
        } else {
            $devices = $isLocalEnv ? $this->readDiskCastDevices() : [];
            if (empty($devices) && self::isPersistableNetworkId($currentNetId)) {
                $devices = $this->readNetworkCastDevices($currentNetId);
            }

            $incomingNetDevices = ($currentNetId !== '' && isset($incoming['devicesByNetwork'][$currentNetId]) && is_array($incoming['devicesByNetwork'][$currentNetId]))
                ? $incoming['devicesByNetwork'][$currentNetId]
                : null;
            $allowRemoteDevices = !$isLocalEnv && ($incomingNetId === '' || $incomingNetId === $currentNetId);
            $sourceList = is_array($incomingNetDevices)
                ? $incomingNetDevices
                : ((!$networkMismatch && ($isLocalEnv || $allowRemoteDevices) && isset($incoming['devices']) && is_array($incoming['devices']))
                    ? $incoming['devices']
                    : null);

            if (is_array($sourceList)) {
                foreach ($sourceList as $k => $dev) {
                    if (!is_array($dev)) continue;
                    $id = trim((string)($dev['id'] ?? $k));
                    if ($id === '') continue;
                    $dev['id'] = $id;
                    if ($isLocalEnv && !empty($dev['host']) && empty($dev['isSdkOnly']) && class_exists('NetworkHelper') && !NetworkHelper::isHostOnCurrentLan((string)$dev['host'])) {
                        continue;
                    }
                    $devices[$id] = array_merge($devices[$id] ?? [], $dev);
                }
            }
            $devices = self::deduplicateCastDevicesMap($devices);
            if ($isLocalEnv) {
                $this->writeDiskCastDevices($devices);
            }
            if (!empty($devices) && self::isPersistableNetworkId($currentNetId)) {
                $this->writeNetworkCastDevices($currentNetId, $devices);
            }
        }

        $vault = [
            'hydrated' => true,
            'networkId' => $isMobileData ? 'mobile_data' : $currentNetId,
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
        $currentNetId = class_exists('NetworkHelper') ? NetworkHelper::getClientNetworkId() : '';
        $this->memoryVault = self::defaultVault();
        @unlink($this->castDevicesFile);
        if (self::isPersistableNetworkId($currentNetId)) {
            $this->writeNetworkCastDevices($currentNetId, []);
        }
        if (session_status() === PHP_SESSION_ACTIVE) {
            $_SESSION['treva_vault'] = $this->memoryVault;
            unset($_SESSION['treva_tuya_tokens']);
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

    public static function defaultCastDevicesSeed(): array
    {
        return [];
    }

    private function readDiskCastDevices(): array
    {
        if (class_exists('NetworkHelper') && !NetworkHelper::isLocalEnvironment()) {
            return [];
        }
        return $this->withJsonLock('cast_devices', false, function () {
            $data = $this->readJsonFileRaw($this->castDevicesFile);
            if (!is_array($data) || empty($data)) {
                return [];
            }
            return self::filterCastDevicesMap($data, true);
        });
    }

    private function writeDiskCastDevices(array $devicesById): void
    {
        $this->withJsonLock('cast_devices', true, function () use ($devicesById) {
            $this->writeJsonFileRaw($this->castDevicesFile, $devicesById);
        });
    }

    private static function isPersistableNetworkId(string $networkId): bool
    {
        return $networkId !== '' && $networkId !== 'mobile_data' && $networkId !== 'local_no_lan';
    }

    private static function isGenericCastName(string $name): bool
    {
        $n = trim($name);
        if ($n === '') return true;
        return (bool)preg_match(
            '/^(Chromecast(?:\s*\/\s*Google\s*TV)?|Google\s+Nest(?:\s+(?:Speaker|Mini|Audio|Hub))?|Google\s+Cast(?:\s+(?:Device|Speaker|Display|Receiver))?|Cast(?:\s+(?:Device|Receiver|Speaker|Display))?)(?:\s*\([0-9a-zA-Z._:-]+\)|\s+[0-9]{1,3}(?:\.[0-9]{1,3}){3})?$/i',
            $n
        );
    }

    private static function castIdScore(string $id): int
    {
        $id = trim($id);
        if ($id === '') return 0;
        if (str_starts_with($id, 'manual-') || str_contains($id, ':')) return 1;
        if (str_starts_with($id, 'sdk-')) return 2;
        if (str_starts_with($id, 'cast-lan-')) return 3;
        return 4;
    }

    private static function isPlaceholderModel(string $model): bool
    {
        $m = trim($model);
        if ($m === '') return true;
        return str_contains($m, '(Wi-Fi LAN)') || str_contains($m, '(Wi-Fi SDK)') || str_contains($m, '(Manual)') || $m === 'Google Cast Device';
    }

    private static function mergeTwoCastDevices(array $a, array $b): array
    {
        $scoreA = self::castIdScore((string)($a['id'] ?? ''));
        $scoreB = self::castIdScore((string)($b['id'] ?? ''));
        $primary = ($scoreB > $scoreA) ? $b : $a;
        $secondary = ($scoreB > $scoreA) ? $a : $b;

        $id = (string)$primary['id'];
        $pName = trim((string)($primary['name'] ?? ''));
        $sName = trim((string)($secondary['name'] ?? ''));
        $name = (!self::isGenericCastName($pName))
            ? $pName
            : ((!self::isGenericCastName($sName)) ? $sName : ($pName !== '' ? $pName : $sName));

        $pHost = trim((string)($primary['host'] ?? ''));
        $sHost = trim((string)($secondary['host'] ?? ''));
        $host = $pHost !== '' ? $pHost : $sHost;

        $pPort = (int)($primary['port'] ?? 0);
        $sPort = (int)($secondary['port'] ?? 0);
        $port = ($pPort > 0 && $pPort !== 8009)
            ? $pPort
            : (($sPort > 0 && $sPort !== 8009) ? $sPort : ($pPort > 0 ? $pPort : ($sPort > 0 ? $sPort : 8009)));

        // Trust LAN-probed record (has host IP) over hostless SDK record for kind/capabilities
        $lanRec = $pHost !== '' ? $primary : ($sHost !== '' ? $secondary : $primary);
        $kind = (($lanRec['kind'] ?? '') === 'display') ? 'display' : ((($lanRec['kind'] ?? '') === 'speaker') ? 'speaker' : ((($primary['kind'] ?? '') === 'display') ? 'display' : 'speaker'));

        $pModel = trim((string)($primary['model'] ?? ''));
        $sModel = trim((string)($secondary['model'] ?? ''));
        $model = (!self::isPlaceholderModel($pModel))
            ? $pModel
            : ((!self::isPlaceholderModel($sModel)) ? $sModel : ($pModel !== '' ? $pModel : $sModel));

        $capabilities = (int)($lanRec['capabilities'] ?? ($primary['capabilities'] ?? ($kind === 'display' ? 5 : 4)));
        $variant = trim((string)($lanRec['variant'] ?? ($primary['variant'] ?? '')));
        if ($variant === '' && class_exists('CastMdns')) {
            $variant = CastMdns::classifyVariant($model, $capabilities);
        }

        $pStatus = strtoupper(trim((string)($primary['status'] ?? 'IDLE')));
        $sStatus = strtoupper(trim((string)($secondary['status'] ?? 'IDLE')));
        $activeStates = ['PLAYING', 'BUFFERING', 'ACTIVE'];
        $status = in_array($pStatus, $activeStates, true)
            ? $pStatus
            : (in_array($sStatus, $activeStates, true) ? $sStatus : ($pStatus !== '' ? $pStatus : 'IDLE'));

        $merged = array_merge($secondary, $primary, [
            'id' => $id,
            'name' => $name !== '' ? $name : ($host !== '' ? "Google Cast ({$host})" : 'Google Cast Device'),
            'model' => $model !== '' ? $model : ($kind === 'display' ? 'Chromecast' : 'Google Cast Speaker'),
            'variant' => $variant !== '' ? $variant : ($kind === 'display' ? 'chromecast' : 'nest_speaker'),
            'host' => $host,
            'port' => $port,
            'capabilities' => $capabilities,
            'kind' => $kind,
            'supportsVideo' => $kind === 'display',
            'supportsAudio' => true,
            'online' => !empty($primary['online']) || !empty($secondary['online']),
            'isManual' => !empty($primary['isManual']) && !empty($secondary['isManual']),
            'isSdkOnly' => $host === '',
            'status' => $status,
            'lastSeen' => max((int)($primary['lastSeen'] ?? 0), (int)($secondary['lastSeen'] ?? 0))
        ]);

        foreach (['mdxScreenId', 'mdxTheme', 'mdxAppId', 'ssid', 'bssid', 'sdkDeviceId', 'discoverySource'] as $field) {
            $val = trim((string)($primary[$field] ?? '')) ?: trim((string)($secondary[$field] ?? ''));
            if ($val !== '') {
                $merged[$field] = $val;
            }
        }
        return $merged;
    }

    public static function deduplicateCastDevicesMap(array $devicesById): array
    {
        $list = [];
        foreach ($devicesById as $k => $dev) {
            if (!is_array($dev)) continue;
            $id = trim((string)($dev['id'] ?? $k));
            if ($id === '') continue;
            $dev['id'] = $id;
            $list[] = $dev;
        }
        if (count($list) <= 1) {
            $singleOut = [];
            foreach ($list as $d) {
                $singleOut[$d['id']] = self::enrichKnownCastDefaults($d);
            }
            return $singleOut;
        }

        // Pass 1: Merge records sharing the exact same non-empty host:port endpoint
        $byEndpoint = [];
        $noEndpoint = [];
        foreach ($list as $d) {
            $host = strtolower(trim((string)($d['host'] ?? '')));
            $port = (int)($d['port'] ?? 8009);
            $port = $port > 0 ? $port : 8009;
            if ($host !== '') {
                $epKey = $host . ':' . $port;
                $byEndpoint[$epKey] = isset($byEndpoint[$epKey])
                    ? self::mergeTwoCastDevices($byEndpoint[$epKey], $d)
                    : $d;
            } else {
                $noEndpoint[] = $d;
            }
        }
        $stage1 = array_merge(array_values($byEndpoint), $noEndpoint);

        // Pass 2: Merge records sharing the exact same real friendly name (case-insensitive)
        $byRealName = [];
        $genericNamed = [];
        foreach ($stage1 as $d) {
            $name = trim((string)($d['name'] ?? ''));
            if (!self::isGenericCastName($name)) {
                $nKey = strtolower($name);
                $byRealName[$nKey] = isset($byRealName[$nKey])
                    ? self::mergeTwoCastDevices($byRealName[$nKey], $d)
                    : $d;
            } else {
                $genericNamed[] = $d;
            }
        }

        // Pass 3: Pair remaining hostless Cast Menu (SDK) devices (which have a real friendly name but no IP)
        // with unnamed Browser-LAN devices (cast-lan-* which have a LAN IP but a placeholder name like "Chromecast (192.168.100.8)")
        foreach ($byRealName as $nKey => $namedDev) {
            if (!empty($namedDev['host']) || empty($genericNamed)) {
                continue;
            }
            $namedKind = ($namedDev['kind'] ?? '') === 'display' ? 'display' : 'speaker';
            $matchIdx = null;
            foreach ($genericNamed as $gIdx => $gDev) {
                if (!empty($gDev['host']) && (($gDev['kind'] ?? '') === $namedKind)) {
                    $matchIdx = $gIdx;
                    break;
                }
            }
            // If only 1 unnamed LAN device remains and kind differed only due to SDK capability fallback, pair them
            if ($matchIdx === null && count($genericNamed) === 1 && !empty($genericNamed[0]['host'])) {
                $matchIdx = 0;
            }
            if ($matchIdx !== null) {
                $byRealName[$nKey] = self::mergeTwoCastDevices($genericNamed[$matchIdx], $namedDev);
                array_splice($genericNamed, $matchIdx, 1);
            }
        }

        $finalOut = [];
        foreach (array_merge(array_values($byRealName), $genericNamed) as $d) {
            $d = self::enrichKnownCastDefaults($d);
            $id = (string)$d['id'];
            $finalOut[$id] = isset($finalOut[$id])
                ? self::mergeTwoCastDevices($finalOut[$id], $d)
                : $d;
        }
        return $finalOut;
    }

    private static function enrichKnownCastDefaults(array $merged): array
    {
        $kind = (($merged['kind'] ?? '') === 'display') ? 'display' : 'speaker';
        if (empty($merged['mdxAppId'])) {
            $merged['mdxAppId'] = $kind === 'display' ? '233637DE' : '2DB7CC49';
        }
        if (empty($merged['mdxTheme'])) {
            $merged['mdxTheme'] = $kind === 'display' ? 'cl' : 'm';
        }
        return $merged;
    }

    private static function filterCastDevicesMap(array $rawDevices, bool $checkLocalLan): array
    {
        $out = [];
        foreach ($rawDevices as $k => $dev) {
            if (!is_array($dev)) continue;
            $id = trim((string)($dev['id'] ?? $k));
            if ($id === '') continue;
            if (
                $checkLocalLan &&
                empty($dev['isManual']) &&
                empty($dev['isSdkOnly']) &&
                !empty($dev['host']) &&
                class_exists('NetworkHelper') &&
                !NetworkHelper::isHostOnCurrentLan((string)$dev['host'])
            ) {
                continue;
            }
            $dev['id'] = $id;
            $out[$id] = $dev;
        }
        return self::deduplicateCastDevicesMap($out);
    }

    private function readNetworkCastDevices(string $networkId): array
    {
        if (!self::isPersistableNetworkId($networkId)) {
            return [];
        }
        $isLocalEnv = !class_exists('NetworkHelper') || NetworkHelper::isLocalEnvironment();
        return $this->withJsonLock('cast_networks', false, function () use ($networkId, $isLocalEnv) {
            $all = $this->readJsonFileRaw($this->castNetworksFile);
            if (!is_array($all) || !isset($all[$networkId]['devices']) || !is_array($all[$networkId]['devices'])) {
                return [];
            }
            return self::filterCastDevicesMap($all[$networkId]['devices'], $isLocalEnv);
        });
    }

    private function writeNetworkCastDevices(string $networkId, array $devicesById): void
    {
        if (!self::isPersistableNetworkId($networkId)) {
            return;
        }
        $this->withJsonLock('cast_networks', true, function () use ($networkId, $devicesById) {
            $all = $this->readJsonFileRaw($this->castNetworksFile);
            if (!is_array($all)) {
                $all = [];
            }
            $all[$networkId] = [
                'updatedAt' => time(),
                'devices' => $devicesById
            ];
            if (count($all) > 20) {
                uasort($all, static function ($a, $b) {
                    return (int)($b['updatedAt'] ?? 0) <=> (int)($a['updatedAt'] ?? 0);
                });
                $all = array_slice($all, 0, 20, true);
            }
            $this->writeJsonFileRaw($this->castNetworksFile, $all);
        });
    }

    private function currentDevicesForMutation(array $v, string $currentNetId = ''): array
    {
        if ($currentNetId === '' && class_exists('NetworkHelper')) {
            $currentNetId = NetworkHelper::getClientNetworkId();
        }
        $mem = is_array($v['devices'] ?? null) ? $v['devices'] : [];
        if (!empty($mem)) {
            return $mem;
        }
        $isLocalEnv = !class_exists('NetworkHelper') || NetworkHelper::isLocalEnvironment();
        if ($isLocalEnv) {
            $disk = $this->readDiskCastDevices();
            if (!empty($disk)) {
                return $disk;
            }
        }
        if (self::isPersistableNetworkId($currentNetId)) {
            return $this->readNetworkCastDevices($currentNetId);
        }
        return [];
    }

    private function commitDevicesState(array $v, array $devicesById, ?string $networkId = null, bool $markHydrated = true): array
    {
        $devicesById = self::deduplicateCastDevicesMap($devicesById);
        $resolvedNetId = $networkId !== null
            ? $networkId
            : (class_exists('NetworkHelper') ? NetworkHelper::getClientNetworkId() : '');
        if ($resolvedNetId === '' && !empty($v['networkId'])) {
            $resolvedNetId = (string)$v['networkId'];
        }
        $v['devices'] = $devicesById;
        if ($resolvedNetId !== '') {
            $v['networkId'] = $resolvedNetId;
        }
        if ($markHydrated) {
            $v['hydrated'] = true;
        }
        $this->writeVault($v);
        if (!class_exists('NetworkHelper') || NetworkHelper::isLocalEnvironment()) {
            $this->writeDiskCastDevices($devicesById);
        }
        if ($resolvedNetId !== 'mobile_data') {
            $this->writeNetworkCastDevices($resolvedNetId, $devicesById);
        }
        return $devicesById;
    }

    public function exitMobileDataForCurrentNetwork(): array
    {
        $v = $this->readVault();
        if (($v['networkId'] ?? '') !== 'mobile_data') {
            return [];
        }
        $currentNetId = class_exists('NetworkHelper') ? NetworkHelper::getClientNetworkId() : '';
        $isLocalEnv = !class_exists('NetworkHelper') || NetworkHelper::isLocalEnvironment();
        $devs = $isLocalEnv ? $this->readDiskCastDevices() : [];
        if (empty($devs) && self::isPersistableNetworkId($currentNetId)) {
            $devs = $this->readNetworkCastDevices($currentNetId);
        }
        $v['networkId'] = $currentNetId;
        $v['devices'] = $devs;
        $this->writeVault($v);
        return $devs;
    }

    public function getDevices(): array
    {
        $v = $this->readVault();
        $currentNetId = class_exists('NetworkHelper') ? NetworkHelper::getClientNetworkId() : '';
        $isLocalEnv = !class_exists('NetworkHelper') || NetworkHelper::isLocalEnvironment();

        if (($v['networkId'] ?? '') === 'mobile_data') {
            if (!empty($v['devices'])) {
                $v['devices'] = [];
                $this->writeVault($v);
            }
            return [];
        }

        if (!empty($v['networkId']) && $currentNetId !== '' && $v['networkId'] !== $currentNetId) {
            $devs = $this->readNetworkCastDevices($currentNetId);
            $v['devices'] = $devs;
            $v['networkId'] = $currentNetId;
            $this->writeVault($v);
            if ($isLocalEnv) {
                $this->writeDiskCastDevices($devs);
            }
            return $devs;
        }

        $mem = is_array($v['devices'] ?? null) ? $v['devices'] : [];
        $devs = $mem;
        $restored = false;
        if (empty($devs) && $isLocalEnv) {
            $devs = $this->readDiskCastDevices();
            $restored = !empty($devs);
        }
        if (empty($devs) && self::isPersistableNetworkId($currentNetId)) {
            $devs = $this->readNetworkCastDevices($currentNetId);
            $restored = !empty($devs);
        }

        if ($isLocalEnv && !empty($devs)) {
            $filtered = self::filterCastDevicesMap($devs, true);
            if (count($filtered) !== count($devs)) {
                return $this->commitDevicesState($v, $filtered, $currentNetId !== '' ? $currentNetId : null, false);
            }
            $devs = $filtered;
        } elseif (!empty($devs)) {
            $deduped = self::deduplicateCastDevicesMap($devs);
            if (count($deduped) !== count($devs)) {
                return $this->commitDevicesState($v, $deduped, $currentNetId !== '' ? $currentNetId : null, false);
            }
            $devs = $deduped;
        }

        if ($restored || ($currentNetId !== '' && empty($v['networkId']))) {
            $v['devices'] = $devs;
            if ($currentNetId !== '') {
                $v['networkId'] = $currentNetId;
            }
            $this->writeVault($v);
            if ($restored && $isLocalEnv && !empty($devs)) {
                $this->writeDiskCastDevices($devs);
            }
        }
        return $devs;
    }

    public function saveDevices(array $devicesById): array
    {
        return $this->commitDevicesState($this->readVault(), $devicesById, null, true);
    }

    public function flushCastDevices(?string $networkId = null): array
    {
        $v = $this->readVault();
        $v['devices'] = [];
        $v['networkId'] = $networkId ?? (class_exists('NetworkHelper') ? NetworkHelper::getClientNetworkId() : '');
        $v['hydrated'] = true;
        $this->writeVault($v);
        if (!class_exists('NetworkHelper') || NetworkHelper::isLocalEnvironment()) {
            $this->writeDiskCastDevices([]);
        }
        return [];
    }

    public function mergeDiscoveredDevices(array $discoveredList, bool $pruneMissingAuto = false): array
    {
        $v = $this->readVault();
        $currentNetId = class_exists('NetworkHelper') ? NetworkHelper::getClientNetworkId() : '';
        $isLocalEnv = !class_exists('NetworkHelper') || NetworkHelper::isLocalEnvironment();
        $existing = $this->currentDevicesForMutation($v, $currentNetId);
        $now = time();
        $discoveredIds = [];
        foreach ($discoveredList as $d) {
            if (!empty($d['id'])) {
                $discoveredIds[(string)$d['id']] = true;
            }
        }

        $shouldPrune = $pruneMissingAuto;
        foreach ($existing as $id => &$dev) {
            if ($isLocalEnv && !empty($dev['host']) && empty($dev['isSdkOnly']) && class_exists('NetworkHelper') && !NetworkHelper::isHostOnCurrentLan((string)$dev['host'])) {
                unset($existing[$id]);
                continue;
            }
            if ($shouldPrune && empty($dev['isManual']) && empty($dev['isSdkOnly']) && !isset($discoveredIds[$id])) {
                unset($existing[$id]);
                continue;
            }
            if (empty($dev['isManual']) && empty($dev['isSdkOnly'])) {
                $dev['online'] = ($now - ($dev['lastSeen'] ?? 0)) < 180;
            }
        }
        unset($dev);

        foreach ($discoveredList as $d) {
            $id = (string)$d['id'];
            $dHost = trim((string)($d['host'] ?? ''));
            $dPort = (int)($d['port'] ?? 8009);
            $dName = trim((string)($d['name'] ?? ''));
            $isPlaceholderId = str_starts_with($id, 'cast-lan-');

            // If a browser CORS fingerprint probe (cast-lan-*) finds an IP already registered with a real Cast UDN/name on this Wi-Fi, preserve its real ID & friendly name.
            if ($isPlaceholderId && $dHost !== '') {
                foreach ($existing as $exId => $exDev) {
                    if (
                        !str_starts_with((string)$exId, 'manual-') &&
                        !str_starts_with((string)$exId, 'cast-lan-') &&
                        ($exDev['host'] ?? '') === $dHost &&
                        (int)($exDev['port'] ?? 8009) === $dPort
                    ) {
                        $id = (string)$exId;
                        $d['id'] = $id;
                        if (!empty($exDev['name'])) {
                            $d['name'] = $exDev['name'];
                        }
                        if (!empty($exDev['model']) && str_contains((string)($d['model'] ?? ''), '(Wi-Fi LAN)')) {
                            $d['model'] = $exDev['model'];
                        }
                        if (!empty($exDev['ssid']) && empty($d['ssid'])) {
                            $d['ssid'] = $exDev['ssid'];
                        }
                        break;
                    }
                }
            }

            $prev = $existing[$id] ?? [];

            // Clean up legacy synthetic manual-<ip>-<port>, cast-lan-*, or sdk-* duplicates when a real Cast UDN is discovered for the same endpoint/name.
            foreach ($existing as $exId => $exDev) {
                if ((string)$exId === $id) continue;
                $isLegacyManual = str_starts_with((string)$exId, 'manual-') && $dHost !== '' && ($exDev['host'] ?? '') === $dHost && (int)($exDev['port'] ?? 8009) === $dPort;
                $isLegacyPlaceholder = !$isPlaceholderId && str_starts_with((string)$exId, 'cast-lan-') && $dHost !== '' && ($exDev['host'] ?? '') === $dHost && (int)($exDev['port'] ?? 8009) === $dPort;
                $isLegacySdk = !empty($exDev['isSdkOnly']) && $dName !== '' && strcasecmp(trim((string)($exDev['name'] ?? '')), $dName) === 0;
                if ($isLegacyManual || $isLegacyPlaceholder || $isLegacySdk) {
                    if (empty($prev)) {
                        $prev = $exDev;
                    }
                    unset($existing[$exId]);
                }
            }

            $merged = array_merge($prev, $d, [
                'id' => $id,
                'lastSeen' => $now,
                'online' => true,
                'isSdkOnly' => false,
                'status' => $prev['status'] ?? 'IDLE',
                'volume' => $prev['volume'] ?? 0.7,
                'muted' => $prev['muted'] ?? false
            ]);
            if (empty($merged['mdxAppId'])) {
                $merged['mdxAppId'] = ($d['kind'] ?? '') === 'display' ? '233637DE' : '2DB7CC49';
            }
            if (empty($merged['mdxTheme'])) {
                $merged['mdxTheme'] = ($d['kind'] ?? '') === 'display' ? 'cl' : 'm';
            }
            $existing[$id] = $merged;
        }

        return $this->commitDevicesState($v, $existing, $currentNetId !== '' ? $currentNetId : null, true);
    }

    public function updateDevice(string $id, array $patch): ?array
    {
        $v = $this->readVault();
        $devices = $this->currentDevicesForMutation($v);
        if (!isset($devices[$id])) return null;
        $devices[$id] = array_merge($devices[$id], $patch);
        $this->commitDevicesState($v, $devices, null, false);
        return $devices[$id];
    }

    public function registerSdkDevice(array $info): array
    {
        $name = trim((string)($info['name'] ?? ($info['friendlyName'] ?? 'Google Cast Device')));
        if ($name === '') {
            $name = 'Google Cast Device';
        }
        $kind = (($info['kind'] ?? '') === 'display') ? 'display' : 'speaker';
        $rawSdkId = trim((string)($info['deviceId'] ?? ($info['id'] ?? '')));
        $sdkId = $rawSdkId !== ''
            ? 'sdk-' . self::sanitizeId($rawSdkId, substr(sha1(strtolower($name)), 0, 12))
            : 'sdk-' . substr(sha1(strtolower($name . '|' . $kind)), 0, 16);

        $v = $this->readVault();
        $devices = $this->currentDevicesForMutation($v);

        // Reuse matching existing device by exact case-insensitive name or sdkDeviceId if present on this Wi-Fi
        $targetId = $sdkId;
        foreach ($devices as $exId => $exDev) {
            if (strcasecmp(trim((string)($exDev['name'] ?? '')), $name) === 0) {
                $targetId = (string)$exId;
                break;
            }
            if ($rawSdkId !== '' && !empty($exDev['sdkDeviceId']) && strcasecmp(trim((string)$exDev['sdkDeviceId']), $rawSdkId) === 0) {
                $targetId = (string)$exId;
                break;
            }
        }
        // If no name match yet, upgrade an unnamed browser_lan placeholder (cast-lan-*) of the same kind (or the sole remaining placeholder) so its IP and real name unify automatically
        if ($targetId === $sdkId) {
            $sameKindPlaceholders = [];
            $allPlaceholders = [];
            foreach ($devices as $exId => $exDev) {
                if (!empty($exDev['host']) && self::isGenericCastName((string)($exDev['name'] ?? ''))) {
                    $allPlaceholders[] = (string)$exId;
                    if (($exDev['kind'] ?? '') === $kind) {
                        $sameKindPlaceholders[] = (string)$exId;
                    }
                }
            }
            if (count($sameKindPlaceholders) === 1) {
                $targetId = $sameKindPlaceholders[0];
            } elseif (empty($sameKindPlaceholders) && count($allPlaceholders) === 1) {
                $targetId = $allPlaceholders[0];
            }
        }

        $prev = $devices[$targetId] ?? [];
        $isDiskless = empty($prev['host']);
        // Preserve LAN-probed kind if matching an existing LAN device so SDK capability gaps never flip a speaker to display
        if (!$isDiskless && !empty($prev['kind']) && in_array($prev['kind'], ['speaker', 'display'], true)) {
            $kind = $prev['kind'];
        }
        $model = trim((string)($info['model'] ?? ($info['modelName'] ?? '')));
        if ($model === '') {
            $model = (!empty($prev['model']) && !self::isPlaceholderModel((string)$prev['model']))
                ? $prev['model']
                : ($prev['model'] ?? ($kind === 'display' ? 'Chromecast / Google TV (Wi-Fi SDK)' : 'Google Nest Speaker (Wi-Fi SDK)'));
        }
        $isGroup = str_contains(strtolower($model), 'group');
        $defaultTheme = $kind === 'display' ? 'cl' : 'm';
        $defaultAppId = ($kind === 'display' && !$isGroup) ? '233637DE' : '2DB7CC49';

        $entry = array_merge($prev, [
            'id' => $targetId,
            'name' => $name,
            'model' => $model,
            'host' => $prev['host'] ?? '',
            'port' => $prev['port'] ?? 8009,
            'capabilities' => $prev['capabilities'] ?? ($kind === 'display' ? 201221 : 198660),
            'kind' => $kind,
            'supportsVideo' => $kind === 'display',
            'supportsAudio' => true,
            'online' => true,
            'isManual' => !empty($prev['isManual']),
            'isSdkOnly' => $isDiskless,
            'sdkDeviceId' => $rawSdkId !== '' ? $rawSdkId : ($prev['sdkDeviceId'] ?? ''),
            'status' => strtoupper(trim((string)($info['status'] ?? ($prev['status'] ?? 'ACTIVE')))),
            'volume' => isset($info['volume']) && is_numeric($info['volume'])
                ? max(0.0, min(1.0, (float)$info['volume']))
                : ($prev['volume'] ?? 0.7),
            'muted' => isset($info['muted']) ? !empty($info['muted']) : !empty($prev['muted']),
            'mdxTheme' => trim((string)($info['mdxTheme'] ?? ($prev['mdxTheme'] ?? $defaultTheme))) ?: $defaultTheme,
            'mdxAppId' => trim((string)($info['mdxAppId'] ?? ($prev['mdxAppId'] ?? $defaultAppId))) ?: $defaultAppId,
            'lastSeen' => time()
        ]);
        if (!empty($info['mdxScreenId'])) {
            $entry['mdxScreenId'] = trim((string)$info['mdxScreenId']);
        }

        $devices[$targetId] = $entry;
        $committed = $this->commitDevicesState($v, $devices, null, true);
        return $committed[$targetId] ?? (reset($committed) ?: $entry);
    }

    public function addManualDevice(string $name, string $host, int $port = 8009, string $kind = 'speaker'): array
    {
        $host = trim($host);
        if ($host === '') {
            throw new InvalidArgumentException('Device IP or hostname is required');
        }
        $id = 'manual-' . preg_replace('/[^a-zA-Z0-9_.-]/', '-', $host) . '-' . $port;
        $v = $this->readVault();
        $devices = $this->currentDevicesForMutation($v);
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
        $this->commitDevicesState($v, $devices, null, true);
        return $devices[$id];
    }

    public function removeDevice(string $id): void
    {
        $v = $this->readVault();
        $devices = $this->currentDevicesForMutation($v);
        unset($devices[$id]);
        $this->commitDevicesState($v, $devices, null, false);
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
            'googleNest' => array_merge($defaults['googleNest'], is_array($data['googleNest'] ?? null) ? $data['googleNest'] : []),
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
            'googleNest' => [
                'configured' => ($cfg['googleNest']['projectId'] ?? '') !== '' && ($cfg['googleNest']['clientId'] ?? '') !== '',
                'projectId' => $cfg['googleNest']['projectId'] ?? '',
                'clientId' => $cfg['googleNest']['clientId'] ?? '',
                'hasClientSecret' => ($cfg['googleNest']['clientSecret'] ?? '') !== '',
                'hasRefreshToken' => ($cfg['googleNest']['refreshToken'] ?? '') !== ''
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

        if (isset($patch['googleNest']) && is_array($patch['googleNest'])) {
            if (!isset($cur['googleNest']) || !is_array($cur['googleNest'])) {
                $cur['googleNest'] = self::defaultSmartConfigRaw()['googleNest'];
            }
            foreach ($patch['googleNest'] as $k => $vItem) {
                $val = trim((string)$vItem);
                if (($k === 'clientSecret' || $k === 'refreshToken') && $val === $mask) {
                    continue;
                }
                if (array_key_exists($k, $cur['googleNest'])) {
                    $cur['googleNest'][$k] = $val;
                }
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
