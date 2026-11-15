<?php
/**
 * Treva Cast - Pure PHP API, Binary Chunk Ingest, Castv2, Smart Life (Tuya) & Magic Home Endpoint
 * Works on any Apache, Nginx, cPanel, or XAMPP hosting without .bat or executables.
 */

@ini_set('display_errors', '0');

if (is_file(__DIR__ . '/config.php')) {
    require_once __DIR__ . '/config.php';
}

require_once __DIR__ . '/lib/NetworkHelper.php';
require_once __DIR__ . '/lib/CastMdns.php';
require_once __DIR__ . '/lib/CastV2.php';
require_once __DIR__ . '/lib/StreamStore.php';
require_once __DIR__ . '/lib/MagicHomeClient.php';
require_once __DIR__ . '/lib/TuyaClient.php';
require_once __DIR__ . '/lib/SmartController.php';
require_once __DIR__ . '/lib/SceneLinker.php';
require_once __DIR__ . '/lib/WebMediaResolver.php';
require_once __DIR__ . '/lib/OpenAiAgent.php';

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Access-Control-Request-Private-Network');
header('Access-Control-Allow-Private-Network: true');
header('Cache-Control: no-store, no-cache, must-revalidate');

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') {
    http_response_code(204);
    exit;
}

$action = $_GET['action'] ?? 'state';
if ($action === 'cast_tts_audio') {
    $file = basename((string)($_GET['file'] ?? ''));
    $path = __DIR__ . DIRECTORY_SEPARATOR . 'data' . DIRECTORY_SEPARATOR . 'streams' . DIRECTORY_SEPARATOR . 'tts' . DIRECTORY_SEPARATOR . $file;
    if (!preg_match('/^tts-[a-f0-9]{16,40}\.mp3$/', $file) || !is_file($path)) {
        http_response_code(404);
        echo json_encode(['error' => 'TTS audio file not found']);
        exit;
    }
    header('Content-Type: audio/mpeg');
    header('Content-Length: ' . (string)filesize($path));
    header('Accept-Ranges: bytes');
    readfile($path);
    exit;
}

$sid = StreamStore::sanitizeId($_GET['sid'] ?? 'live');
$store = new StreamStore();
if (!in_array($action, ['push', 'stream_start', 'stream_stop', 'stream_heartbeat', 'cast_tts_audio'], true)) {
    $store->initSession(in_array($action, ['state', 'ai_session_instructions'], true));
}

function readJsonBody(): array
{
    $raw = file_get_contents('php://input');
    if (!$raw) return [];
    $decoded = json_decode($raw, true);
    return is_array($decoded) ? $decoded : [];
}

/**
 * Build consistent sceneLinks + sliceScenes payload for the active session.
 */
function buildSceneSnapshot(StreamStore $store): array
{
    $doc = $store->getSmartSceneLinks();
    if (empty($doc['catalog']) && !empty($store->getSmartScenes()['scenes'])) {
        $sceneLinks = SceneLinker::syncCatalog($store);
        $doc = $store->getSmartSceneLinks();
    } else {
        $sceneLinks = SceneLinker::buildSceneLinks($store);
    }
    return [
        'sceneLinks' => $sceneLinks,
        'sliceScenes' => is_array($doc['sliceScenes'] ?? null) ? $doc['sliceScenes'] : new stdClass()
    ];
}

/**
 * Attach the active browser session vault snapshot to mutation responses so
 * client storage stays synchronized without persisting secrets on the server.
 */
function withSessionVault(StreamStore $store, array $payload): array
{
    $payload['sessionHydrated'] = $store->hasSessionVaultData();
    $payload['sessionVault'] = $store->exportSessionVault();
    return $payload;
}

/**
 * Fetch live Tap-to-Run scenes from Tuya Cloud, persist them, and rebuild the scene-link catalog.
 */
function syncTuyaScenesCatalog(StreamStore $store, string $uidOverride = ''): array
{
    $cfg = $store->getSmartConfig();
    $tuya = is_array($cfg['tuya'] ?? null) ? $cfg['tuya'] : [];
    $accessId = trim((string)($tuya['accessId'] ?? ''));
    $secret = trim((string)($tuya['accessSecret'] ?? ''));
    if ($accessId === '' || $secret === '') {
        throw new InvalidArgumentException('Tuya Cloud credentials are not configured.');
    }

    $uid = trim($uidOverride !== '' ? $uidOverride : (string)($tuya['uid'] ?? ''));
    if ($uid === '') {
        $devRes = TuyaClient::cloudSyncDevices($tuya);
        $uid = trim((string)($devRes['uid'] ?? ''));
        if ($uid !== '') {
            $store->saveSmartConfig(['tuya' => ['uid' => $uid]]);
        }
    }
    if ($uid === '') {
        throw new RuntimeException('Unable to resolve Tuya Smart Life UID for scene sync.');
    }

    $scenesData = TuyaClient::cloudSyncHomeScenes($tuya, $uid);
    $scenesData['updatedAt'] = time();
    $store->saveSmartScenes($scenesData);
    $sceneLinks = SceneLinker::syncCatalog($store);
    $doc = $store->getSmartSceneLinks();

    return [
        'smartScenes' => $scenesData,
        'sceneLinks' => $sceneLinks,
        'sliceScenes' => is_array($doc['sliceScenes'] ?? null) ? $doc['sliceScenes'] : new stdClass(),
        'count' => count($scenesData['scenes'] ?? [])
    ];
}

function getBasePath(): string
{
    $scriptName = $_SERVER['SCRIPT_NAME'] ?? '/api.php';
    $dir = str_replace('\\', '/', dirname($scriptName));
    return rtrim($dir, '/');
}

function buildStreamUrls(string $sid, string $selectedLanIp): array
{
    $basePath = getBasePath();
    $isLocal = NetworkHelper::isLocalEnvironment();
    $httpHost = $_SERVER['HTTP_HOST'] ?? 'localhost';
    $isHttps =
        (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ||
        strtolower((string)($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '')) === 'https' ||
        strtolower((string)($_SERVER['HTTP_X_FORWARDED_SSL'] ?? '')) === 'on' ||
        (!empty($_SERVER['HTTP_CF_VISITOR']) && str_contains((string)$_SERVER['HTTP_CF_VISITOR'], '"https"')) ||
        (int)($_SERVER['SERVER_PORT'] ?? 80) === 443;
    $scheme = $isHttps ? 'https' : 'http';

    if ($isLocal) {
        $portSuffix = '';
        if (preg_match('/:(\d+)$/', $httpHost, $m)) {
            $p = (int)$m[1];
            if ($p !== 80 && $p !== 443) {
                $portSuffix = ':' . $p;
            }
        }
        $castOrigin = "http://{$selectedLanIp}{$portSuffix}{$basePath}";
        $uiHttpUrl = "http://{$selectedLanIp}{$portSuffix}{$basePath}/";
    } else {
        $castOrigin = "{$scheme}://{$httpHost}{$basePath}";
        $uiHttpUrl = "{$scheme}://{$httpHost}{$basePath}/";
    }

    return [
        'isLocalEnvironment' => $isLocal,
        'uiUrl' => $uiHttpUrl,
        'audio' => "{$castOrigin}/stream.php?sid=" . urlencode($sid) . '&fmt=mp3',
        'video' => "{$castOrigin}/stream.php?sid=" . urlencode($sid) . '&fmt=webm'
    ];
}

function magicHomeEnsureToken(StreamStore $store, array $cfg, bool $forceLogin = false): array
{
    return SmartController::ensureMagicHomeToken($store, $cfg, $forceLogin);
}

try {
    // -------------------------------------------------------------------------
    // 1. Binary Audio/Video Chunk Push
    // -------------------------------------------------------------------------
    if ($action === 'push') {
        $fmt = (($_GET['fmt'] ?? 'mp3') === 'webm') ? 'webm' : 'mp3';
        $isInit = !empty($_GET['init']) && $_GET['init'] !== '0';
        $sampleRate = (int)($_GET['sr'] ?? 44100);
        $bytes = file_get_contents('php://input');
        if ($bytes === false || $bytes === '') {
            echo json_encode(['ok' => true, 'bytes' => 0]);
            exit;
        }
        $res = $store->pushChunk($sid, $fmt, $bytes, $isInit, $sampleRate);
        echo json_encode(['ok' => true] + $res);
        exit;
    }

    // -------------------------------------------------------------------------
    // 2. Start / Stop Live Stream Session
    // -------------------------------------------------------------------------
    if ($action === 'stream_start') {
        $body = readJsonBody();
        $mode = $body['mode'] ?? ($_GET['mode'] ?? 'audio');
        $status = $store->startStream($sid, $mode);
        echo json_encode(['ok' => true, 'streamStatus' => $status]);
        exit;
    }

    if ($action === 'stream_stop') {
        $status = $store->stopStream($sid);
        echo json_encode(['ok' => true, 'streamStatus' => $status]);
        exit;
    }

    if ($action === 'stream_heartbeat') {
        $status = $store->heartbeatStream($sid);
        echo json_encode(['ok' => true, 'streamStatus' => $status]);
        exit;
    }

    if ($action === 'session_hydrate') {
        $body = readJsonBody();
        $vault = is_array($body['vault'] ?? null) ? $body['vault'] : [];
        $store->hydrateSessionVault($vault);
        $snap = buildSceneSnapshot($store);
        echo json_encode(withSessionVault($store, [
            'ok' => true,
            'devices' => array_values($store->getDevices()),
            'smartConfig' => $store->getSmartConfigPublic(),
            'smartDevices' => $store->getSmartDevicesPublic(),
            'smartScenes' => $store->getSmartScenes(),
            'sceneLinks' => $snap['sceneLinks'],
            'sliceScenes' => $snap['sliceScenes']
        ]));
        exit;
    }

    if ($action === 'session_clear') {
        $store->clearSessionVault();
        echo json_encode([
            'ok' => true,
            'sessionHydrated' => false,
            'devices' => [],
            'smartConfig' => $store->getSmartConfigPublic(),
            'smartDevices' => [],
            'smartScenes' => $store->getSmartScenes(),
            'sceneLinks' => [],
            'sliceScenes' => new stdClass()
        ]);
        exit;
    }

    // -------------------------------------------------------------------------
    // 3. System Info & Initial Snapshot
    // -------------------------------------------------------------------------
    if ($action === 'info') {
        $interfaces = NetworkHelper::getLanIps();
        $settings = $store->getSettings();
        $selectedLanIp = $settings['selectedLanIp'] ?? NetworkHelper::getPrimaryLanIp();

        if (!empty($interfaces)) {
            $knownIps = array_column($interfaces, 'address');
            if (!in_array($selectedLanIp, $knownIps, true)) {
                $selectedLanIp = $interfaces[0]['address'];
                $store->saveSettings(['selectedLanIp' => $selectedLanIp]);
            }
        }

        $isLocal = NetworkHelper::isLocalEnvironment();
        $devices = $isLocal
            ? SmartController::syncAllCastDevices($store, 1.2, true, 6)
            : array_values($store->getDevices());
        $endpoints = buildStreamUrls($sid, $selectedLanIp);
        $snap = buildSceneSnapshot($store);

        echo json_encode([
            'ok' => true,
            'sessionHydrated' => $store->hasSessionVaultData(),
            'isLocalEnvironment' => $isLocal,
            'selectedLanIp' => $selectedLanIp,
            'interfaces' => $interfaces,
            'uiUrl' => $endpoints['uiUrl'],
            'streamEndpoints' => [
                'audio' => $endpoints['audio'],
                'video' => $endpoints['video']
            ],
            'streamStatus' => $store->getStreamStatus($sid),
            'devices' => $devices,
            'smartConfig' => $store->getSmartConfigPublic(),
            'smartDevices' => $store->getSmartDevicesPublic(),
            'smartScenes' => $store->getSmartScenes(),
            'sceneLinks' => $snap['sceneLinks'],
            'sliceScenes' => $snap['sliceScenes']
        ]);
        exit;
    }

    // -------------------------------------------------------------------------
    // 4. Lightweight State Polling
    // -------------------------------------------------------------------------
    if ($action === 'state') {
        echo json_encode([
            'ok' => true,
            'sessionHydrated' => $store->hasSessionVaultData(),
            'streamStatus' => $store->getStreamStatus($sid),
            'devices' => array_values($store->getDevices()),
            'smartDevices' => $store->getSmartDevicesPublic()
        ]);
        exit;
    }

    // -------------------------------------------------------------------------
    // 5. Select LAN Interface IP
    // -------------------------------------------------------------------------
    if ($action === 'set_lan_ip') {
        $body = readJsonBody();
        $ip = trim($body['ip'] ?? '');
        if (!filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4)) {
            http_response_code(400);
            echo json_encode(['error' => 'Valid IPv4 address required']);
            exit;
        }
        $store->saveSettings(['selectedLanIp' => $ip]);
        $endpoints = buildStreamUrls($sid, $ip);
        echo json_encode([
            'ok' => true,
            'selectedLanIp' => $ip,
            'streamEndpoints' => [
                'audio' => $endpoints['audio'],
                'video' => $endpoints['video']
            ]
        ]);
        exit;
    }

    // -------------------------------------------------------------------------
    // 6. Google Cast Local LAN Discovery & Control
    // -------------------------------------------------------------------------
    if ($action === 'discover') {
        $isLocal = NetworkHelper::isLocalEnvironment();
        if ($isLocal) {
            $settings = $store->getSettings();
            $bindIp = $settings['selectedLanIp'] ?? '';
            $found = CastMdns::discover($bindIp, 1.5);
            $store->mergeDiscoveredDevices($found, true);
            $synced = SmartController::syncAllCastDevices($store, 1.4, false);
        } else {
            $synced = array_values($store->getDevices());
        }
        echo json_encode(withSessionVault($store, [
            'ok' => true,
            'remoteHosting' => !$isLocal,
            'devices' => $synced
        ]));
        exit;
    }

    if ($action === 'register_sdk_device') {
        $body = readJsonBody();
        $dev = $store->registerSdkDevice($body);
        echo json_encode(withSessionVault($store, [
            'ok' => true,
            'device' => $dev,
            'devices' => array_values($store->getDevices())
        ]));
        exit;
    }

    if ($action === 'lan_diag_sync') {
        $body = readJsonBody();
        $castEndpoints = is_array($body['castDevices'] ?? null) ? $body['castDevices'] : [];
        $smartEndpoints = is_array($body['smartDevices'] ?? null) ? $body['smartDevices'] : [];
        foreach ($castEndpoints as $ep) {
            if (!is_array($ep)) continue;
            $host = trim((string)($ep['host'] ?? ''));
            if (!filter_var($host, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4)) continue;
            $port = (int)($ep['port'] ?? 8009);
            $name = trim((string)($ep['name'] ?? '')) ?: "Cast Device ({$host})";
            $kind = in_array($ep['kind'] ?? '', ['speaker', 'display'], true) ? $ep['kind'] : 'display';
            $store->addManualDevice($name, $host, $port > 0 ? $port : 8009, $kind);
        }
        foreach ($smartEndpoints as $sep) {
            if (!is_array($sep)) continue;
            $ip = trim((string)($sep['ip'] ?? ''));
            if (!filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4)) continue;
            $platform = strtolower(trim((string)($sep['platform'] ?? 'magichome')));
            $name = trim((string)($sep['name'] ?? '')) ?: ($platform === 'tuya' ? "SmartLife ({$ip})" : "MagicHome ({$ip})");
            $store->upsertSmartDevice([
                'id' => ($sep['id'] ?? '') ?: ($platform . '_' . str_replace('.', '_', $ip)),
                'name' => $name,
                'platform' => $platform,
                'ip' => $ip,
                'category' => $sep['category'] ?? 'light',
                'online' => true
            ]);
        }
        echo json_encode(withSessionVault($store, [
            'ok' => true,
            'devices' => array_values($store->getDevices()),
            'smartDevices' => $store->getSmartDevicesPublic()
        ]));
        exit;
    }

    if ($action === 'manual_device') {
        $body = readJsonBody();
        $dev = $store->addManualDevice(
            $body['name'] ?? '',
            $body['host'] ?? '',
            (int)($body['port'] ?? 8009),
            $body['kind'] ?? 'speaker'
        );
        echo json_encode(withSessionVault($store, ['ok' => true, 'device' => $dev, 'devices' => array_values($store->getDevices())]));
        exit;
    }

    if ($action === 'remove_device') {
        $body = readJsonBody();
        $id = $body['deviceId'] ?? ($_GET['deviceId'] ?? '');
        if ($id !== '') $store->removeDevice($id);
        echo json_encode(withSessionVault($store, ['ok' => true, 'devices' => array_values($store->getDevices())]));
        exit;
    }

    if ($action === 'cast_start') {
        $body = readJsonBody();
        $deviceId = $body['deviceId'] ?? '';
        $devices = $store->getDevices();
        if (!isset($devices[$deviceId])) {
            http_response_code(404);
            echo json_encode(['error' => 'Cast device not found']);
            exit;
        }

        $dev = $devices[$deviceId];
        $mode = ($dev['kind'] === 'speaker') ? 'audio' : (($body['mode'] ?? 'video') === 'audio' ? 'audio' : 'video');
        $contentType = ($mode === 'audio') ? 'audio/mpeg' : 'video/webm';

        $settings = $store->getSettings();
        $selectedLanIp = $settings['selectedLanIp'] ?? NetworkHelper::getPrimaryLanIp();
        $endpoints = buildStreamUrls($sid, $selectedLanIp);
        $streamUrl = $endpoints[$mode === 'audio' ? 'audio' : 'video'] . '&t=' . time();

        $cast = new CastV2();
        try {
            $cast->connect($dev['host'], (int)$dev['port'], 5.0);
            $reply = $cast->loadMedia(
                $streamUrl,
                $contentType,
                $mode === 'audio' ? 'Treva Audio Cast' : 'Treva Screen & Sound Cast',
                "Streaming from {$selectedLanIp}"
            );
            $recStatus = $cast->getStatus();
            $cast->close();

            $vol = $recStatus['volume'] ?? [];
            $updated = $store->updateDevice($deviceId, [
                'status' => 'PLAYING',
                'activeStreamMode' => $mode,
                'volume' => isset($vol['level']) ? round((float)$vol['level'], 2) : ($dev['volume'] ?? 0.7),
                'muted' => !empty($vol['muted'])
            ]);

            echo json_encode([
                'ok' => true,
                'device' => $updated,
                'streamUrl' => $streamUrl,
                'mode' => $mode,
                'reply' => $reply
            ]);
        } catch (Throwable $ex) {
            $cast->close();
            $store->updateDevice($deviceId, ['status' => 'ERROR', 'activeStreamMode' => null]);
            http_response_code(500);
            echo json_encode(['error' => $ex->getMessage()]);
        }
        exit;
    }

    if ($action === 'cast_stop') {
        $body = readJsonBody();
        $deviceId = $body['deviceId'] ?? '';
        $res = SmartController::controlCast($store, (string)$deviceId, 'stop');
        echo json_encode($res);
        exit;
    }

    if ($action === 'cast_volume') {
        $body = readJsonBody();
        $deviceId = $body['deviceId'] ?? '';
        $level = isset($body['level']) ? (float)$body['level'] : null;
        $muted = isset($body['muted']) ? (bool)$body['muted'] : null;
        $volAct = $level !== null ? 'set_volume' : ($muted === true ? 'mute' : ($muted === false ? 'unmute' : 'set_volume'));
        $res = SmartController::controlCast($store, (string)$deviceId, $volAct, $level, $muted);
        echo json_encode($res);
        exit;
    }

    if ($action === 'cast_lounge_play') {
        $body = readJsonBody();
        $deviceId = trim((string)($body['deviceId'] ?? ''));
        $screenId = trim((string)($body['screenId'] ?? ''));
        $theme = trim((string)($body['theme'] ?? 'cl')) ?: 'cl';
        $videoIds = is_array($body['videoIds'] ?? null) ? $body['videoIds'] : [];
        $listId = trim((string)($body['listId'] ?? ''));
        if ($deviceId !== '' && $screenId !== '') {
            $store->updateDevice($deviceId, [
                'mdxScreenId' => $screenId,
                'mdxTheme' => $theme,
                'mdxAppId' => $theme === 'm' ? '2DB7CC49' : '233637DE'
            ]);
        }
        $res = CastV2::playYouTubeLoungeCloud($screenId, $theme, $videoIds, $listId);
        if (!empty($res['ok']) && $deviceId !== '') {
            $usedTheme = (string)($res['theme'] ?? $theme);
            $appId = $usedTheme === 'm' ? '2DB7CC49' : '233637DE';
            $appName = $usedTheme === 'm' ? 'YouTube Music' : 'YouTube';
            $res['device'] = $store->updateDevice($deviceId, [
                'status' => 'PLAYING',
                'appId' => $appId,
                'appName' => $appName,
                'mdxScreenId' => $screenId,
                'mdxTheme' => $usedTheme,
                'mdxAppId' => $appId,
                'mediaSyncAt' => time()
            ]);
            $res['devices'] = array_values($store->getDevices());
        }
        echo json_encode($res);
        exit;
    }

    if ($action === 'cast_sync') {
        $body = readJsonBody();
        $deviceId = trim((string)($body['deviceId'] ?? ''));
        $devices = $store->getDevices();
        if (!isset($devices[$deviceId])) {
            http_response_code(404);
            echo json_encode(['error' => 'Device not found']);
            exit;
        }
        $updated = SmartController::syncCastDevice($store, $devices[$deviceId], 3.0);
        echo json_encode(['ok' => true, 'device' => $updated]);
        exit;
    }

    if ($action === 'cast_sync_all') {
        $onlyStale = !empty($_GET['fast']);
        $synced = NetworkHelper::isLocalEnvironment()
            ? SmartController::syncAllCastDevices($store, 1.4, $onlyStale, 4)
            : array_values($store->getDevices());
        echo json_encode(['ok' => true, 'devices' => $synced]);
        exit;
    }

    if ($action === 'cast_media') {
        $body = readJsonBody();
        $deviceId = trim((string)($body['deviceId'] ?? 'active')) ?: 'active';
        $mediaAction = trim((string)($body['action'] ?? ''));
        if ($mediaAction === '') {
            http_response_code(400);
            echo json_encode(['error' => 'Media action required']);
            exit;
        }
        $mediaOpts = [];
        if (isset($body['seconds']) && is_numeric($body['seconds'])) {
            $mediaOpts['seconds'] = (float)$body['seconds'];
        }
        if (isset($body['position_seconds']) && is_numeric($body['position_seconds'])) {
            $mediaOpts['position_seconds'] = (float)$body['position_seconds'];
        }
        if (isset($body['step']) && is_numeric($body['step'])) {
            $mediaOpts['step'] = (float)$body['step'];
        }
        foreach (['query', 'text', 'preset', 'url', 'title', 'subtitle', 'content_type', 'app', 'voice', 'image_url'] as $optKey) {
            if (!empty($body[$optKey]) && is_string($body[$optKey])) {
                $mediaOpts[$optKey] = trim($body[$optKey]);
            }
        }
        $vol = isset($body['volume']) && is_numeric($body['volume']) ? (float)$body['volume'] : null;
        $muted = isset($body['muted']) ? (bool)$body['muted'] : null;
        $res = SmartController::controlCast($store, $deviceId, $mediaAction, $vol, $muted, $mediaOpts);
        echo json_encode($res);
        exit;
    }

    // -------------------------------------------------------------------------
    // 7. SMART LIFE (TUYA) & MAGIC HOME INTEGRATION ENDPOINTS
    // -------------------------------------------------------------------------
    if ($action === 'smart_config_save') {
        $body = readJsonBody();
        $store->saveSmartConfig($body);
        echo json_encode(withSessionVault($store, [
            'ok' => true,
            'smartConfig' => $store->getSmartConfigPublic()
        ]));
        exit;
    }

    if ($action === 'smart_discover') {
        if (!NetworkHelper::isLocalEnvironment()) {
            echo json_encode([
                'ok' => true,
                'remoteHosting' => true,
                'smartDevices' => $store->getSmartDevicesPublic()
            ]);
            exit;
        }

        $settings = $store->getSettings();
        $bindIp = $settings['selectedLanIp'] ?? '';
        $tcpScan = NetworkHelper::scanSubnetPorts($bindIp, [5577, 6668], 380);
        $mhFound = MagicHomeClient::discoverLan($bindIp, 0.9, $tcpScan[5577] ?? []);
        $tuyaFound = TuyaClient::discoverLan(2.2, $tcpScan[6668] ?? []);

        foreach ($mhFound as $dev) {
            $store->upsertSmartDevice($dev);
        }
        foreach ($tuyaFound as $dev) {
            $store->upsertSmartDevice($dev);
        }

        echo json_encode(withSessionVault($store, [
            'ok' => true,
            'foundMagicHome' => count($mhFound),
            'foundTuya' => count($tuyaFound),
            'smartDevices' => $store->getSmartDevicesPublic()
        ]));
        exit;
    }

    if ($action === 'smart_sync_cloud') {
        $body = readJsonBody();
        $platform = $body['platform'] ?? 'all';
        $cfg = $store->getSmartConfig();
        $synced = ['tuya' => 0, 'magicHome' => 0, 'scenes' => 0];
        $warnings = [];

        if (($platform === 'all' || $platform === 'tuya') &&
            $cfg['tuya']['accessId'] !== '' && $cfg['tuya']['accessSecret'] !== '') {
            try {
                $res = TuyaClient::cloudSyncDevices($cfg['tuya']);
                if (!empty($res['uid']) && $cfg['tuya']['uid'] === '') {
                    $store->saveSmartConfig(['tuya' => ['uid' => $res['uid']]]);
                }

                $tuyaPort6668Ips = [];
                if (NetworkHelper::isLocalEnvironment()) {
                    $settings = $store->getSettings();
                    $scan = NetworkHelper::scanSubnetPorts($settings['selectedLanIp'] ?? '', [6668], 380);
                    $tuyaPort6668Ips = $scan[6668] ?? [];
                }

                foreach ($res['devices'] as $dev) {
                    $tuyaCat = (string)($dev['tuyaCategory'] ?? '');
                    // Match physical Tuya Wi-Fi devices to LAN IP & version via local TCP 6668 (skip virtual IR sub-devices)
                    if (!empty($tuyaPort6668Ips) && !empty($dev['localKey']) && !str_starts_with($tuyaCat, 'infrared_')) {
                        $matched = TuyaClient::resolveLanIpForDevice($tuyaPort6668Ips, $dev['id'], $dev['localKey']);
                        if ($matched) {
                            $dev['ip'] = $matched['ip'];
                            $dev['version'] = $matched['version'];
                            $tuyaPort6668Ips = array_values(array_diff($tuyaPort6668Ips, [$matched['ip']]));
                        }
                    }
                    $store->upsertSmartDevice($dev);
                    $synced['tuya']++;
                }

                // Also sync Smart Life Tap-to-Run scenes for IR/complex fallback and AI voice agent
                $uidForScenes = !empty($res['uid']) ? (string)$res['uid'] : (string)($cfg['tuya']['uid'] ?? '');
                try {
                    $sceneSync = syncTuyaScenesCatalog($store, $uidForScenes);
                    $synced['scenes'] = $sceneSync['count'];
                } catch (Throwable $ignored) {
                    // Best-effort scene sync
                }
            } catch (Throwable $tuyaErr) {
                if ($platform === 'tuya') {
                    throw $tuyaErr;
                }
                $warnings[] = 'Smart Life: ' . $tuyaErr->getMessage();
            }
        }

        if ($platform === 'all' || $platform === 'magichome') {
            $mhCfg = $cfg['magicHome'] ?? [];
            $hasMhCreds = ($mhCfg['token'] ?? '') !== '' ||
                (($mhCfg['email'] ?? '') !== '' && ($mhCfg['password'] ?? '') !== '');
            if ($hasMhCreds) {
                try {
                    $auth = magicHomeEnsureToken($store, $cfg, false);
                    $mhToken = $auth['token'];
                    $mhRegion = $auth['region'];
                    if ($mhToken !== '') {
                        try {
                            $mhDevs = MagicHomeClient::cloudListDevices($mhToken, $mhRegion);
                        } catch (Throwable $mhErr) {
                            if (MagicHomeClient::isAuthError($mhErr) &&
                                ($mhCfg['email'] ?? '') !== '' && ($mhCfg['password'] ?? '') !== '') {
                                $auth = magicHomeEnsureToken($store, $cfg, true);
                                $mhToken = $auth['token'];
                                $mhRegion = $auth['region'];
                                $mhDevs = MagicHomeClient::cloudListDevices($mhToken, $mhRegion);
                            } else {
                                throw $mhErr;
                            }
                        }

                        $existingMhIps = [];
                        if (NetworkHelper::isLocalEnvironment()) {
                            foreach ($store->getSmartDevices() as $edev) {
                                if (($edev['platform'] ?? '') === 'magichome' && !empty($edev['ip'])) {
                                    $info = @MagicHomeClient::queryInfoUdp($edev['ip'], 0.45);
                                    if (!empty($info['mac'])) {
                                        $existingMhIps[$info['mac']] = $edev['ip'];
                                    }
                                }
                            }
                        }

                        foreach ($mhDevs as $dev) {
                            $mac = $dev['mac'] ?? '';
                            if (empty($dev['ip']) && $mac !== '' && isset($existingMhIps[$mac])) {
                                $dev['ip'] = $existingMhIps[$mac];
                                $st = @MagicHomeClient::queryState($dev['ip'], 5577, 1.0);
                                if (!empty($st['verified'])) {
                                    $dev['_preserveColorState'] = false;
                                    $dev['power'] = $st['power'];
                                    $dev['r'] = $st['r'];
                                    $dev['g'] = $st['g'];
                                    $dev['b'] = $st['b'];
                                    $dev['w'] = $st['w'];
                                    $dev['brightness'] = $st['brightness'];
                                }
                            }
                            $store->upsertSmartDevice($dev);
                            $synced['magicHome']++;
                        }
                    }
                } catch (Throwable $mhSyncErr) {
                    if ($platform === 'magichome') {
                        throw $mhSyncErr;
                    }
                    $warnings[] = 'Magic Home Cloud: ' . $mhSyncErr->getMessage();
                }
            }
        }

        if ($synced['tuya'] === 0 && $synced['magicHome'] === 0 && !empty($warnings)) {
            throw new RuntimeException(implode(' | ', $warnings));
        }

        $snap = buildSceneSnapshot($store);
        echo json_encode(withSessionVault($store, [
            'ok' => true,
            'synced' => $synced,
            'warnings' => $warnings,
            'smartConfig' => $store->getSmartConfigPublic(),
            'smartDevices' => $store->getSmartDevicesPublic(),
            'smartScenes' => $store->getSmartScenes(),
            'sceneLinks' => $snap['sceneLinks'],
            'sliceScenes' => $snap['sliceScenes']
        ]));
        exit;
    }

    if ($action === 'smart_add_manual') {
        $body = readJsonBody();
        $platform = ($body['platform'] ?? 'magichome') === 'tuya' ? 'tuya' : 'magichome';
        $ip = trim((string)($body['ip'] ?? ''));
        $name = trim((string)($body['name'] ?? ''));
        $isLocal = NetworkHelper::isLocalEnvironment();
        $cfg = $store->getSmartConfig();
        $warning = null;

        if ($ip !== '' && !filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4)) {
            throw new InvalidArgumentException('Wi-Fi IP must be a valid IPv4 address (e.g. 192.168.1.50)');
        }

        if ($platform === 'magichome') {
            $mac = strtoupper(str_replace([':', '-', ' '], '', trim((string)($body['mac'] ?? ''))));
            if ($ip === '' && $mac === '') {
                throw new InvalidArgumentException('Enter a Magic Home Wi-Fi IP or MAC address');
            }
            $udpInfo = ($isLocal && $ip !== '' && $mac === '') ? @MagicHomeClient::queryInfoUdp($ip, 0.55) : null;
            if ($mac === '' && !empty($udpInfo['mac'])) {
                $mac = $udpInfo['mac'];
            }
            $state = ($isLocal && $ip !== '') ? @MagicHomeClient::queryState($ip, 5577, 1.5) : [];
            $ipSlug = $ip !== '' ? str_replace('.', '-', $ip) : strtolower($mac);
            $id = $mac !== '' ? 'mh-' . $mac : 'mh-manual-' . $ipSlug;
            $dev = $store->upsertSmartDevice([
                'id' => $id,
                'platform' => 'magichome',
                'name' => $name !== '' ? $name : ($ip !== '' ? "Magic Home ({$ip})" : "Magic Home ({$mac})"),
                'model' => $udpInfo['model'] ?? 'Magic Home Wi-Fi LED',
                'mac' => $mac,
                'ip' => $ip,
                'port' => 5577,
                'online' => true,
                'category' => 'light',
                'power' => $state['power'] ?? false,
                'r' => $state['r'] ?? 255,
                'g' => $state['g'] ?? 255,
                'b' => $state['b'] ?? 255,
                'w' => $state['w'] ?? 0,
                'brightness' => $state['brightness'] ?? 100
            ]);
            if (!$isLocal && $mac === '') {
                $warning = 'Saved! Note: private 192.168.x.x IPs cannot be reached from a remote server. Link Magic Home Cloud and click Sync Cloud Devices (or enter the MAC).';
            } elseif (!$isLocal && empty($cfg['magicHome']['token']) && (empty($cfg['magicHome']['email']) || empty($cfg['magicHome']['password']))) {
                $warning = 'Saved! Link your Magic Home Cloud account in Access Keys / Tokens to control this device from remote hosting.';
            }
        } else {
            $devId = trim((string)($body['deviceId'] ?? ''));
            $localKey = trim((string)($body['localKey'] ?? ''));
            $ver = trim((string)($body['version'] ?? '3.3'));
            if ($devId === '' && $ip === '') {
                throw new InvalidArgumentException('Enter a Smart Life Device ID (gwId) or Wi-Fi IP address');
            }
            $id = $devId !== '' ? $devId : ('tuya-manual-' . str_replace('.', '-', $ip));
            $fallbackLabel = $devId !== '' ? substr($devId, -6) : $ip;
            $dev = $store->upsertSmartDevice([
                'id' => $id,
                'platform' => 'tuya',
                'name' => $name !== '' ? $name : "Smart Life ({$fallbackLabel})",
                'model' => 'Smart Life Wi-Fi',
                'category' => ($body['category'] ?? 'light'),
                'ip' => $ip,
                'port' => 6668,
                'localKey' => $localKey,
                'version' => $ver ?: '3.3',
                'online' => true,
                'power' => false,
                'brightness' => 100,
                'r' => 255,
                'g' => 255,
                'b' => 255
            ]);
            $hasCloud = ($cfg['tuya']['accessId'] ?? '') !== '' && ($cfg['tuya']['accessSecret'] ?? '') !== '';
            if (!$hasCloud && ($localKey === '' || $devId === '' || !$isLocal)) {
                $warning = $hasCloud
                    ? null
                    : 'Saved! To send commands, add your Tuya IoT Access ID + Secret (Access Keys / Tokens) or enter the 16-char Local Key + Device ID.';
            }
        }

        $publicDev = $dev;
        $publicDev['hasLocalKey'] = !empty($publicDev['localKey']);
        unset($publicDev['localKey']);
        echo json_encode(withSessionVault($store, [
            'ok' => true,
            'device' => $publicDev,
            'warning' => $warning,
            'smartDevices' => $store->getSmartDevicesPublic()
        ]));
        exit;
    }

    if ($action === 'smart_remove') {
        $body = readJsonBody();
        $id = $body['deviceId'] ?? '';
        if ($id !== '') $store->removeSmartDevice($id);
        echo json_encode(withSessionVault($store, [
            'ok' => true,
            'smartDevices' => $store->getSmartDevicesPublic()
        ]));
        exit;
    }

    if ($action === 'smart_control') {
        $body = readJsonBody();
        $deviceId = trim((string)($body['deviceId'] ?? ''));
        if ($deviceId === '') {
            http_response_code(400);
            echo json_encode(['error' => 'deviceId required']);
            exit;
        }
        $result = SmartController::controlDevice($store, $deviceId, $body);
        echo json_encode([
            'ok' => true,
            'meta' => $result['meta'] ?? [],
            'smartDevices' => $result['smartDevices']
        ]);
        exit;
    }

    if ($action === 'smart_trigger_scene') {
        $body = readJsonBody();
        $res = SmartController::triggerScene(
            $store,
            trim((string)($body['sceneId'] ?? '')),
            trim((string)($body['sceneName'] ?? '')),
            trim((string)($body['homeId'] ?? '')),
            trim((string)($body['deviceHint'] ?? ''))
        );
        echo json_encode($res);
        exit;
    }

    if ($action === 'smart_scene_links') {
        $rescan = !empty($_GET['rescan']);
        $links = $rescan ? SceneLinker::syncCatalog($store) : SceneLinker::buildSceneLinks($store);
        $doc = $store->getSmartSceneLinks();
        echo json_encode([
            'ok' => true,
            'sceneLinks' => $links,
            'sliceScenes' => is_array($doc['sliceScenes'] ?? null) ? $doc['sliceScenes'] : new stdClass()
        ]);
        exit;
    }

    if ($action === 'smart_scenes_sync') {
        $syncRes = syncTuyaScenesCatalog($store);
        echo json_encode(withSessionVault($store, [
            'ok' => true,
            'count' => $syncRes['count'],
            'smartScenes' => $syncRes['smartScenes'],
            'sceneLinks' => $syncRes['sceneLinks'],
            'sliceScenes' => $syncRes['sliceScenes']
        ]));
        exit;
    }

    if ($action === 'smart_slice_scenes_save') {
        $body = readJsonBody();
        $sliceKey = trim((string)($body['sliceKey'] ?? ''));
        $sceneIds = is_array($body['sceneIds'] ?? null) ? $body['sceneIds'] : [];
        if ($sliceKey === '') {
            respondError('sliceKey is required', 400);
        }
        $saved = $store->saveSliceSceneAssignments($sliceKey, $sceneIds);
        echo json_encode(withSessionVault($store, [
            'ok' => true,
            'sliceKey' => $sliceKey,
            'sliceScenes' => is_array($saved['sliceScenes'] ?? null) ? $saved['sliceScenes'] : new stdClass()
        ]));
        exit;
    }

    if ($action === 'smart_scene_links_save') {
        $body = readJsonBody();
        $sceneId = trim((string)($body['sceneId'] ?? ''));
        $rawPhrases = $body['voicePhrases'] ?? [];
        if (is_string($rawPhrases)) {
            $rawPhrases = preg_split('/[\r\n,;]+/', $rawPhrases) ?: [];
        }
        if (!is_array($rawPhrases)) {
            $rawPhrases = [];
        }
        $notes = trim((string)($body['notes'] ?? ''));
        $store->saveSmartSceneCustomLink($sceneId, $rawPhrases, $notes);
        $links = SceneLinker::syncCatalog($store);
        echo json_encode(withSessionVault($store, [
            'ok' => true,
            'sceneId' => $sceneId,
            'sceneLinks' => $links
        ]));
        exit;
    }

    // -------------------------------------------------------------------------
    // 8. OPENAI SMART HOUSE VOICE AGENT ENDPOINTS (SERVER-SIDE KEY ONLY)
    // -------------------------------------------------------------------------
    if ($action === 'ai_session_instructions') {
        $body = readJsonBody();
        $clientContext = is_array($body['clientContext'] ?? null) ? $body['clientContext'] : [];
        echo json_encode([
            'ok' => true,
            'instructions' => OpenAiAgent::buildSystemInstructions($store, $clientContext)
        ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        exit;
    }

    if ($action === 'ai_realtime_session') {
        $body = readJsonBody();
        $apiKey = OpenAiAgent::resolveApiKey($store);
        $clientContext = is_array($body['clientContext'] ?? null) ? $body['clientContext'] : [];
        $session = OpenAiAgent::createRealtimeSession($apiKey, $store, $clientContext, [
            'model' => $body['model'] ?? null,
            'voice' => $body['voice'] ?? null
        ]);
        echo json_encode(['ok' => true] + $session);
        exit;
    }

    if ($action === 'ai_execute_tool') {
        $body = readJsonBody();
        $toolName = trim((string)($body['name'] ?? ''));
        $args = is_array($body['arguments'] ?? null) ? $body['arguments'] : [];
        $clientContext = is_array($body['clientContext'] ?? null) ? $body['clientContext'] : [];
        if ($toolName === '') {
            http_response_code(400);
            echo json_encode(['error' => 'Tool name required']);
            exit;
        }
        $clientActions = [];
        try {
            $result = OpenAiAgent::executeTool($store, $toolName, $args, $clientContext, $clientActions);
        } catch (Throwable $ex) {
            $result = ['ok' => false, 'error' => $ex->getMessage()];
        }
        echo json_encode([
            'ok' => true,
            'result' => $result,
            'clientActions' => $clientActions,
            'smartDevices' => $store->getSmartDevicesPublic(),
            'devices' => array_values($store->getDevices())
        ]);
        exit;
    }

    if ($action === 'ai_chat') {
        $apiKey = OpenAiAgent::resolveApiKey($store);
        $contentType = strtolower((string)($_SERVER['CONTENT_TYPE'] ?? ''));
        $text = '';
        $history = [];
        $clientContext = [];
        $speak = false;
        $voice = 'verse';

        $chatModel = null;
        $reasoningEffort = null;

        if (str_contains($contentType, 'multipart/form-data') || isset($_FILES['audio'])) {
            if (!empty($_FILES['audio']['tmp_name']) && is_uploaded_file($_FILES['audio']['tmp_name'])) {
                $text = OpenAiAgent::transcribeAudio(
                    $apiKey,
                    $_FILES['audio']['tmp_name'],
                    (string)($_FILES['audio']['type'] ?? 'audio/webm'),
                    (string)($_FILES['audio']['name'] ?? 'voice.webm')
                );
            } else {
                $text = trim((string)($_POST['text'] ?? ''));
            }
            $histDec = json_decode((string)($_POST['history'] ?? '[]'), true);
            $history = is_array($histDec) ? $histDec : [];
            $ctxDec = json_decode((string)($_POST['clientContext'] ?? '{}'), true);
            $clientContext = is_array($ctxDec) ? $ctxDec : [];
            $speak = !empty($_POST['speak']) && $_POST['speak'] !== 'false' && $_POST['speak'] !== '0';
            $voice = trim((string)($_POST['voice'] ?? 'verse')) ?: 'verse';
            if (isset($_POST['model']) && trim((string)$_POST['model']) !== '') {
                $chatModel = trim((string)$_POST['model']);
            }
            if (isset($_POST['reasoningEffort']) && trim((string)$_POST['reasoningEffort']) !== '') {
                $reasoningEffort = trim((string)$_POST['reasoningEffort']);
            }
        } else {
            $body = readJsonBody();
            $text = trim((string)($body['text'] ?? ''));
            $history = is_array($body['history'] ?? null) ? $body['history'] : [];
            $clientContext = is_array($body['clientContext'] ?? null) ? $body['clientContext'] : [];
            $speak = !empty($body['speak']);
            $voice = trim((string)($body['voice'] ?? 'verse')) ?: 'verse';
            if (isset($body['model']) && trim((string)$body['model']) !== '') {
                $chatModel = trim((string)$body['model']);
            }
            if (isset($body['reasoningEffort']) && trim((string)$body['reasoningEffort']) !== '') {
                $reasoningEffort = trim((string)$body['reasoningEffort']);
            }
        }

        if ($text === '') {
            http_response_code(400);
            echo json_encode(['error' => 'Speak clearly or enter a command for the AI agent.']);
            exit;
        }

        $turn = OpenAiAgent::runChatTurn($apiKey, $store, $text, $history, $clientContext, [
            'speak' => $speak,
            'voice' => $voice,
            'model' => $chatModel,
            'reasoningEffort' => $reasoningEffort
        ]);
        echo json_encode($turn);
        exit;
    }

    http_response_code(400);
    echo json_encode(['error' => "Unknown action: {$action}"]);
} catch (InvalidArgumentException $e) {
    http_response_code(400);
    echo json_encode(['error' => $e->getMessage()]);
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
}
