<?php
/**
 * Pure PHP Smart Life / Tuya Wi-Fi Client
 * Supports:
 *  1) Local LAN UDP Discovery (ports 6666 & 6667 AES-128-ECB)
 *  2) Direct Local Wi-Fi TCP 6668 Control (Tuya v3.3 AND v3.4 session handshake!)
 *  3) Tuya IoT OpenAPI v2.0 Cloud Client (Auto-sync devices + local_keys + Cloud control)
 */
class TuyaClient
{
    private const PREFIX_55AA = "\x00\x00\x55\xAA";
    private const SUFFIX_AA55 = "\x00\x00\xAA\x55";
    private const UDP_KEY_STR = 'yGAdlopoPVldABfn';

    // =========================================================================
    // 1. LOCAL LAN DISCOVERY (UDP 6666 / 6667)
    // =========================================================================

    public static function discoverLan(float $timeoutSec = 2.0, array $tcpCandidates = []): array
    {
        $s6666 = @stream_socket_server('udp://0.0.0.0:6666', $e1, $str1, STREAM_SERVER_BIND);
        $s6667 = @stream_socket_server('udp://0.0.0.0:6667', $e2, $str2, STREAM_SERVER_BIND);
        $sockets = array_filter([$s6666, $s6667]);

        $found = [];
        $seenIps = [];

        if (!empty($sockets)) {
            foreach ($sockets as $s) {
                stream_set_blocking($s, false);
            }

            $udpKey = md5(self::UDP_KEY_STR, true);
            $deadline = microtime(true) + $timeoutSec;

            while (microtime(true) < $deadline) {
                $r = $sockets;
                $w = null;
                $ex = null;
                if (@stream_select($r, $w, $ex, 0, 100000) > 0) {
                    foreach ($r as $sock) {
                        $pkt = @stream_socket_recvfrom($sock, 4096, 0, $peer);
                        if (!$pkt || strlen($pkt) < 28) continue;
                        $parsed = self::decodeUdpBroadcast($pkt, $udpKey);
                        if ($parsed && !empty($parsed['gwId'])) {
                            $gwId = $parsed['gwId'];
                            $ip = $parsed['ip'] ?? explode(':', $peer)[0];
                            $seenIps[$ip] = true;
                            $found[$gwId] = [
                                'id' => $gwId,
                                'platform' => 'tuya',
                                'name' => "Smart Life (" . substr($gwId, -6) . ")",
                                'ip' => $ip,
                                'port' => 6668,
                                'version' => (string)($parsed['version'] ?? '3.3'),
                                'productKey' => $parsed['productKey'] ?? '',
                                'online' => true
                            ];
                        }
                    }
                }
            }

            foreach ($sockets as $s) {
                @fclose($s);
            }
        }

        // TCP 6668 scan fallback (works even if Windows Firewall drops unsolicited UDP to httpd.exe)
        foreach ($tcpCandidates as $ip) {
            if (isset($seenIps[$ip])) continue;
            $id = 'tuya-ip-' . str_replace('.', '-', $ip);
            $found[$id] = [
                'id' => $id,
                'platform' => 'tuya',
                'name' => "Smart Life ({$ip})",
                'ip' => $ip,
                'port' => 6668,
                'version' => '3.3',
                'category' => 'light',
                'online' => true
            ];
        }

        return array_values($found);
    }

    /**
     * Tests candidate LAN IPs on TCP 6668 to bind a Cloud-synced Tuya Device ID + localKey
     * to its local IP & protocol version (3.3 or 3.4) even without UDP broadcast.
     */
    public static function resolveLanIpForDevice(array $candidateIps, string $deviceId, string $localKey): ?array
    {
        if (strlen($localKey) < 16 || empty($candidateIps)) return null;
        $key16 = substr($localKey, 0, 16);

        foreach ($candidateIps as $ip) {
            // Try v3.4 handshake first
            $sock = @stream_socket_client("tcp://{$ip}:6668", $e, $es, 0.45);
            if ($sock) {
                stream_set_timeout($sock, 0, 450000);
                try {
                    self::handshakeV34($sock, $key16);
                    @fclose($sock);
                    return ['ip' => $ip, 'version' => '3.4'];
                } catch (Throwable $_) {
                    @fclose($sock);
                }
            }

            // Try v3.3 DP_QUERY
            $sock = @stream_socket_client("tcp://{$ip}:6668", $e, $es, 0.45);
            if ($sock) {
                stream_set_timeout($sock, 0, 450000);
                $payload = json_encode(['gwId' => $deviceId, 'devId' => $deviceId, 'uid' => $deviceId, 't' => (string)time()], JSON_UNESCAPED_SLASHES);
                @fwrite($sock, self::packFrame33(1, 0x0A, $payload, $key16, false));
                $resp = self::readFrame33($sock, $key16);
                @fclose($sock);
                if (is_array($resp)) {
                    return ['ip' => $ip, 'version' => '3.3'];
                }
            }
        }
        return null;
    }

    private static function decodeUdpBroadcast(string $pkt, string $udpKey): ?array
    {
        if (substr($pkt, 0, 4) !== self::PREFIX_55AA) return null;
        $hdr = unpack('Nprefix/Nseq/Ncmd/Nlen', substr($pkt, 0, 16));
        $payloadLen = $hdr['len'];
        if ($payloadLen < 12 || strlen($pkt) < 16 + $payloadLen) return null;

        // 4 bytes retcode + encrypted body + 4 bytes CRC + 4 bytes AA55
        $body = substr($pkt, 16, $payloadLen - 8);
        $plain = @openssl_decrypt(substr($body, 4), 'AES-128-ECB', $udpKey, OPENSSL_RAW_DATA);
        if (!$plain) {
            $plain = @openssl_decrypt($body, 'AES-128-ECB', $udpKey, OPENSSL_RAW_DATA);
        }
        if (!$plain) {
            // Unencrypted v3.1 fallback
            $plain = substr($body, 4);
        }
        $decoded = json_decode(trim($plain), true);
        return is_array($decoded) ? $decoded : null;
    }

    // =========================================================================
    // 2. TUYA LOCAL WI-FI CONTROL (TCP 6668 - PROTOCOL v3.3 & v3.4)
    // =========================================================================

    public static function localSetDps(string $ip, string $deviceId, string $localKey, string $version, array $dps): array
    {
        if (strlen($localKey) < 16) {
            throw new RuntimeException('Invalid Tuya localKey (must be 16 characters)');
        }
        $key16 = substr($localKey, 0, 16);
        $ver = trim($version) ?: '3.3';

        $sock = @stream_socket_client("tcp://{$ip}:6668", $errno, $errstr, 3.5);
        if (!$sock) {
            throw new RuntimeException("Could not connect to Smart Life device at {$ip}:6668 ($errstr)");
        }
        stream_set_timeout($sock, 4);

        try {
            if (version_compare($ver, '3.4', '>=')) {
                return self::localControlV34($sock, $deviceId, $key16, $dps);
            }
            return self::localControlV33($sock, $deviceId, $key16, $dps);
        } finally {
            @fclose($sock);
        }
    }

    public static function localQueryDps(string $ip, string $deviceId, string $localKey, string $version): array
    {
        if (strlen($localKey) < 16) return [];
        $key16 = substr($localKey, 0, 16);
        $sock = @stream_socket_client("tcp://{$ip}:6668", $errno, $errstr, 2.5);
        if (!$sock) return [];
        stream_set_timeout($sock, 3);

        try {
            if (version_compare($version, '3.4', '>=')) {
                $sessionKey = self::handshakeV34($sock, $key16);
                $payload = json_encode(['gwId' => $deviceId, 'devId' => $deviceId, 'uid' => $deviceId, 't' => (string)time()], JSON_UNESCAPED_SLASHES);
                $frame = self::packFrame34(1, 0x10, $payload, $sessionKey); // CMD 16 DP_QUERY_NEW
                @fwrite($sock, $frame);
                $resp = self::readFrame34($sock, $sessionKey);
                return $resp['dps'] ?? [];
            }

            $payload = json_encode(['gwId' => $deviceId, 'devId' => $deviceId, 'uid' => $deviceId, 't' => (string)time()], JSON_UNESCAPED_SLASHES);
            $frame = self::packFrame33(1, 0x0A, $payload, $key16, false); // CMD 10 DP_QUERY
            @fwrite($sock, $frame);
            $resp = self::readFrame33($sock, $key16);
            return $resp['dps'] ?? [];
        } catch (Throwable $e) {
            return [];
        } finally {
            @fclose($sock);
        }
    }

    private static function localControlV33($sock, string $deviceId, string $key16, array $dps): array
    {
        $payload = json_encode([
            'devId' => $deviceId,
            'uid' => $deviceId,
            't' => (string)time(),
            'dps' => (object)$dps
        ], JSON_UNESCAPED_SLASHES);

        $frame = self::packFrame33(1, 0x07, $payload, $key16, true);
        @fwrite($sock, $frame);
        $resp = self::readFrame33($sock, $key16);
        return $resp ?? ['ok' => true];
    }

    private static function localControlV34($sock, string $deviceId, string $key16, array $dps): array
    {
        $sessionKey = self::handshakeV34($sock, $key16);
        $payload = json_encode([
            'protocol' => 5,
            't' => time(),
            'data' => ['dps' => (object)$dps]
        ], JSON_UNESCAPED_SLASHES);

        // CMD 13 = CONTROL_NEW
        $frame = self::packFrame34(3, 0x0D, "3.4\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00" . $payload, $sessionKey);
        @fwrite($sock, $frame);
        $resp = self::readFrame34($sock, $sessionKey);
        return $resp ?? ['ok' => true];
    }

    private static function handshakeV34($sock, string $key16): string
    {
        $localNonce = random_bytes(16);
        // Step 1: SESS_KEY_NEG_START (CMD 3)
        @fwrite($sock, self::packFrame34(1, 0x03, $localNonce, $key16));
        $rawResp = self::readRaw55AA($sock);
        if (!$rawResp) {
            throw new RuntimeException('Tuya v3.4 session handshake timed out');
        }

        // Unwrap AES-ECB encrypted body (strip 4-byte retcode at start, 32-byte HMAC + 4-byte AA55 at end)
        $encBody = substr($rawResp['rest'], 4, max(0, strlen($rawResp['rest']) - 40));
        $dec = @openssl_decrypt($encBody, 'AES-128-ECB', $key16, OPENSSL_RAW_DATA);
        if (!$dec || strlen($dec) < 48) {
            throw new RuntimeException('Tuya v3.4 handshake decryption failed (check localKey)');
        }
        $remoteNonce = substr($dec, 0, 16);

        // Step 2: SESS_KEY_NEG_FINISH (CMD 5) with HMAC-SHA256(key, remoteNonce)
        $hmacVerify = hash_hmac('sha256', $remoteNonce, $key16, true);
        @fwrite($sock, self::packFrame34(2, 0x05, $hmacVerify, $key16));
        usleep(40000);

        // Derive session key: AES-128-ECB(localKey, localNonce XOR remoteNonce) without padding
        $xored = $localNonce ^ $remoteNonce;
        $sessionKey = openssl_encrypt($xored, 'AES-128-ECB', $key16, OPENSSL_RAW_DATA | OPENSSL_ZERO_PADDING);
        return substr($sessionKey, 0, 16);
    }

    private static function packFrame33(int $seq, int $cmd, string $json, string $key16, bool $addHeader33): string
    {
        $enc = openssl_encrypt($json, 'AES-128-ECB', $key16, OPENSSL_RAW_DATA);
        $body = $addHeader33 ? ("3.3\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00" . $enc) : $enc;
        $len = strlen($body) + 8; // +4 CRC +4 suffix
        $head = self::PREFIX_55AA . pack('NNN', $seq, $cmd, $len) . $body;
        $crc = crc32($head);
        return $head . pack('N', $crc) . self::SUFFIX_AA55;
    }

    private static function packFrame34(int $seq, int $cmd, string $rawPayload, string $key16): string
    {
        // PKCS7 padded AES-128-ECB
        $enc = openssl_encrypt($rawPayload, 'AES-128-ECB', $key16, OPENSSL_RAW_DATA);
        $len = strlen($enc) + 36; // +32 HMAC +4 suffix
        $head = self::PREFIX_55AA . pack('NNN', $seq, $cmd, $len) . $enc;
        $hmac = hash_hmac('sha256', $head, $key16, true);
        return $head . $hmac . self::SUFFIX_AA55;
    }

    private static function readRaw55AA($sock, float $maxWaitSec = 0.65): ?array
    {
        $hdr = '';
        $deadline = microtime(true) + $maxWaitSec;
        while (strlen($hdr) < 16 && microtime(true) < $deadline) {
            $r = [$sock]; $w = null; $ex = null;
            $ready = @stream_select($r, $w, $ex, 0, 50000);
            if ($ready === false) return null;
            if ($ready === 0) continue;
            $chunk = @fread($sock, 16 - strlen($hdr));
            if ($chunk === false || ($chunk === '' && feof($sock))) {
                return null;
            }
            $hdr .= $chunk;
        }
        if (strlen($hdr) < 16 || substr($hdr, 0, 4) !== self::PREFIX_55AA) return null;

        $meta = unpack('Nprefix/Nseq/Ncmd/Nlen', $hdr);
        $rem = $meta['len'];
        if ($rem <= 0 || $rem > 65536) return null;

        $rest = '';
        $deadline = microtime(true) + $maxWaitSec;
        while (strlen($rest) < $rem && microtime(true) < $deadline) {
            $r = [$sock]; $w = null; $ex = null;
            $ready = @stream_select($r, $w, $ex, 0, 50000);
            if ($ready === false) return null;
            if ($ready === 0) continue;
            $chunk = @fread($sock, $rem - strlen($rest));
            if ($chunk === false || ($chunk === '' && feof($sock))) {
                return null;
            }
            $rest .= $chunk;
        }
        if (strlen($rest) < $rem) return null;

        // Check whether v3.4 (32-byte HMAC) or v3.3 (4-byte CRC)
        $payload = substr($rest, 0, max(0, strlen($rest) - 8));
        return [
            'seq' => $meta['seq'],
            'cmd' => $meta['cmd'],
            'rest' => $rest,
            'payload' => $payload
        ];
    }

    private static function readFrame33($sock, string $key16): ?array
    {
        $raw = self::readRaw55AA($sock);
        if (!$raw) return null;
        $body = substr($raw['rest'], 0, strlen($raw['rest']) - 8);
        $enc = substr($body, 4); // strip 4-byte retcode
        if (str_starts_with($enc, '3.3')) {
            $enc = substr($enc, 15);
        }
        $dec = @openssl_decrypt($enc, 'AES-128-ECB', $key16, OPENSSL_RAW_DATA);
        if (!$dec) $dec = $enc;
        $decoded = json_decode(trim($dec), true);
        return is_array($decoded) ? $decoded : null;
    }

    private static function readFrame34($sock, string $sessionKey): ?array
    {
        $raw = self::readRaw55AA($sock);
        if (!$raw) return null;
        // Strip 32-byte HMAC + 4-byte AA55 suffix
        $enc = substr($raw['rest'], 0, max(0, strlen($raw['rest']) - 36));
        $dec = @openssl_decrypt($enc, 'AES-128-ECB', $sessionKey, OPENSSL_RAW_DATA);
        if (!$dec) return null;
        // Strip 4-byte retcode + optional 15-byte '3.4' header
        $plain = substr($dec, 4);
        if (str_starts_with($plain, '3.4')) {
            $plain = substr($plain, 15);
        }
        $decoded = json_decode(trim($plain), true);
        if (is_array($decoded) && isset($decoded['data']['dps'])) {
            return ['dps' => $decoded['data']['dps']];
        }
        return is_array($decoded) ? $decoded : null;
    }

    // =========================================================================
    // 3. TUYA IOT CLOUD OPENAPI v2.0 (Auto-sync Devices + Local Keys + Control)
    // =========================================================================

    private static function cloudBaseUrl(string $region): string
    {
        return match (strtolower($region)) {
            'eu' => 'https://openapi.tuyaeu.com',
            'we' => 'https://openapi-weaz.tuyaeu.com',
            'ue' => 'https://openapi-ueaz.tuyaus.com',
            'cn' => 'https://openapi.tuyacn.com',
            'in' => 'https://openapi.tuyain.com',
            default => 'https://openapi.tuyaus.com',
        };
    }

    private static array $memoryTokenCache = [];

    public static function cloudGetToken(string $accessId, string $accessSecret, string $region = 'us', bool $forceRefresh = false): string
    {
        $cacheKey = sha1($region . '|' . $accessId . '|' . substr(sha1($accessSecret), 0, 8));
        $now = time();

        if (!$forceRefresh) {
            if (isset(self::$memoryTokenCache[$cacheKey]) && (int)(self::$memoryTokenCache[$cacheKey]['expiresAt'] ?? 0) > ($now + 60)) {
                return (string)self::$memoryTokenCache[$cacheKey]['token'];
            }
            if (session_status() === PHP_SESSION_ACTIVE && isset($_SESSION['treva_tuya_tokens'][$cacheKey]) && is_array($_SESSION['treva_tuya_tokens'][$cacheKey])) {
                $cached = $_SESSION['treva_tuya_tokens'][$cacheKey];
                if (!empty($cached['token']) && (int)($cached['expiresAt'] ?? 0) > ($now + 60)) {
                    self::$memoryTokenCache[$cacheKey] = $cached;
                    return (string)$cached['token'];
                }
            }
        }

        $res = self::cloudRequest('GET', '/v1.0/token?grant_type=1', null, $accessId, $accessSecret, '', $region, false);
        if (empty($res['success']) || empty($res['result']['access_token'])) {
            $code = (int)($res['code'] ?? 0);
            $msg = (string)($res['msg'] ?? 'Check Access ID, Secret & Region');
            if ($code === 1114 || stripos($msg, "don't have access to this API") !== false) {
                throw new RuntimeException(
                    "Tuya IP Allowlist blocked this server ({$msg}). On iot.tuya.com -> Cloud -> Development -> Project -> Overview, turn OFF 'Cloud Authorization IP Allowlist' (or add this IP to the allowlist)."
                );
            }
            throw new RuntimeException('Tuya Cloud auth failed: ' . $msg);
        }

        $token = (string)$res['result']['access_token'];
        $expireSec = (int)($res['result']['expire_time'] ?? 7200);
        $ttl = max(60, min(6600, $expireSec - 90));
        $entry = [
            'token' => $token,
            'expiresAt' => time() + $ttl
        ];
        self::$memoryTokenCache[$cacheKey] = $entry;
        if (session_status() === PHP_SESSION_ACTIVE) {
            if (!isset($_SESSION['treva_tuya_tokens']) || !is_array($_SESSION['treva_tuya_tokens'])) {
                $_SESSION['treva_tuya_tokens'] = [];
            }
            $_SESSION['treva_tuya_tokens'][$cacheKey] = $entry;
        }
        return $token;
    }

    public static function cloudSyncDevices(array $tuyaCfg): array
    {
        $accessId = trim($tuyaCfg['accessId'] ?? '');
        $secret = trim($tuyaCfg['accessSecret'] ?? '');
        $region = trim($tuyaCfg['region'] ?? 'us');
        $uid = trim($tuyaCfg['uid'] ?? '');
        $sampleDevId = trim($tuyaCfg['sampleDeviceId'] ?? '');

        if ($accessId === '' || $secret === '') {
            throw new RuntimeException('Tuya Access ID and Access Secret are required');
        }

        $token = self::cloudGetToken($accessId, $secret, $region);

        // If UID was omitted but a sample Device ID was provided, resolve UID automatically!
        if ($uid === '' && $sampleDevId !== '') {
            $devRes = self::cloudRequest('GET', "/v1.0/devices/{$sampleDevId}", null, $accessId, $secret, $token, $region);
            if (!empty($devRes['success']) && !empty($devRes['result']['uid'])) {
                $uid = $devRes['result']['uid'];
            }
        }

        if ($uid !== '') {
            $listRes = self::cloudRequest('GET', "/v1.0/users/{$uid}/devices", null, $accessId, $secret, $token, $region);
        } else {
            $listRes = self::cloudRequest('GET', '/v1.3/iot-03/devices?page_no=1&page_size=50', null, $accessId, $secret, $token, $region);
            if (empty($listRes['success'])) {
                $listRes = self::cloudRequest('GET', '/v1.0/iot-03/devices?page_no=1&page_size=50', null, $accessId, $secret, $token, $region);
            }
        }

        if (empty($listRes['success'])) {
            throw new RuntimeException('Tuya Cloud device list failed: ' . ($listRes['msg'] ?? 'Provide Smart Life User UID or a Device ID'));
        }

        $rawList = $listRes['result']['list'] ?? ($listRes['result'] ?? []);
        if (!is_array($rawList)) $rawList = [];

        $devices = [];
        foreach ($rawList as $item) {
            if (!is_array($item) || empty($item['id'])) continue;
            $devId = $item['id'];
            $cat = (string)($item['category'] ?? '');
            $statusArr = is_array($item['status'] ?? null) ? $item['status'] : [];
            $parsed = self::parseTuyaStatusArray($statusArr);
            $mappedCat = self::mapCategory($cat);

            $functions = [];
            if (str_starts_with($cat, 'infrared_') || $cat === 'sd' || $cat === 'dj' || $parsed['switchCode'] === '') {
                try {
                    $spec = self::cloudFetchDeviceSpec($tuyaCfg, $devId, $token);
                    if (!empty($spec['functions']) && is_array($spec['functions'])) {
                        foreach ($spec['functions'] as $fn) {
                            if (!is_array($fn) || empty($fn['code'])) continue;
                            $functions[] = [
                                'code' => (string)$fn['code'],
                                'name' => (string)($fn['name'] ?? $fn['code']),
                                'type' => (string)($fn['type'] ?? ''),
                                'values' => $fn['values'] ?? ''
                            ];
                        }
                    }
                } catch (Throwable $ignored) {
                    // Best-effort spec lookup; do not fail full device sync
                }
            }

            if ($parsed['switchCode'] === '' && !empty($functions)) {
                foreach ($functions as $fn) {
                    if (in_array($fn['code'], ['switch_led', 'switch_1', 'switch', 'led_switch', 'power', 'Power', 'PowerOn'], true)) {
                        $parsed['switchCode'] = $fn['code'];
                        break;
                    }
                }
            }

            $devices[] = [
                'id' => $devId,
                'platform' => 'tuya',
                'name' => $item['name'] ?? ($item['product_name'] ?? 'Smart Life Device'),
                'model' => $item['product_name'] ?? $cat,
                'category' => $mappedCat,
                'tuyaCategory' => $cat,
                'switchCode' => $parsed['switchCode'],
                'workMode' => $parsed['workMode'],
                'ip' => $item['ip'] ?? '',
                'port' => 6668,
                'localKey' => $item['local_key'] ?? '',
                'version' => '3.3',
                'online' => !empty($item['online']),
                'power' => $parsed['power'],
                'brightness' => $parsed['brightness'],
                'temp' => $parsed['temp'],
                'battery' => $parsed['battery'],
                'vacuumMode' => $parsed['vacuumMode'],
                'vacuumCleaning' => $parsed['vacuumCleaning'],
                'r' => $parsed['r'],
                'g' => $parsed['g'],
                'b' => $parsed['b'],
                'functions' => $functions,
                'rawStatus' => $statusArr
            ];
        }

        return ['uid' => $uid, 'devices' => $devices];
    }

    public static function cloudFetchDeviceSpec(array $tuyaCfg, string $deviceId, ?string $token = null): array
    {
        $accessId = trim($tuyaCfg['accessId'] ?? '');
        $secret = trim($tuyaCfg['accessSecret'] ?? '');
        $region = trim($tuyaCfg['region'] ?? 'us');
        $tok = $token ?: self::cloudGetToken($accessId, $secret, $region);
        $res = self::cloudRequest('GET', "/v1.0/iot-03/devices/{$deviceId}/specification", null, $accessId, $secret, $tok, $region);
        if (empty($res['success'])) {
            $res = self::cloudRequest('GET', "/v1.0/devices/{$deviceId}/specifications", null, $accessId, $secret, $tok, $region);
        }
        return !empty($res['success']) && is_array($res['result'] ?? null) ? $res['result'] : [];
    }

    public static function cloudSendCommandsRaw(array $tuyaCfg, string $deviceId, array $commands): array
    {
        $accessId = trim($tuyaCfg['accessId'] ?? '');
        $secret = trim($tuyaCfg['accessSecret'] ?? '');
        $region = trim($tuyaCfg['region'] ?? 'us');

        $token = self::cloudGetToken($accessId, $secret, $region);
        $body = ['commands' => array_values($commands)];

        $res = self::cloudRequest('POST', "/v1.0/iot-03/devices/{$deviceId}/commands", $body, $accessId, $secret, $token, $region);
        if (empty($res['success'])) {
            $fallback = self::cloudRequest('POST', "/v1.0/devices/{$deviceId}/commands", $body, $accessId, $secret, $token, $region);
            if (!empty($fallback['success']) || empty($res['code'])) {
                $res = $fallback;
            }
        }
        return $res;
    }

    public static function cloudSendCommands(array $tuyaCfg, string $deviceId, array $commands): array
    {
        $res = self::cloudSendCommandsRaw($tuyaCfg, $deviceId, $commands);
        if (empty($res['success'])) {
            $code = isset($res['code']) ? " (code {$res['code']})" : '';
            throw new RuntimeException('Tuya Cloud command failed: ' . ($res['msg'] ?? 'unknown') . $code);
        }
        return $res;
    }

    public static function cloudListHomes(array $tuyaCfg, string $uid, ?string $token = null): array
    {
        if ($uid === '') return [];
        $accessId = trim($tuyaCfg['accessId'] ?? '');
        $secret = trim($tuyaCfg['accessSecret'] ?? '');
        $region = trim($tuyaCfg['region'] ?? 'us');
        $tok = $token ?: self::cloudGetToken($accessId, $secret, $region);
        $res = self::cloudRequest('GET', "/v1.0/users/{$uid}/homes", null, $accessId, $secret, $tok, $region);
        return (!empty($res['success']) && is_array($res['result'] ?? null)) ? $res['result'] : [];
    }

    public static function cloudListHomeScenes(array $tuyaCfg, string $homeId, ?string $token = null): array
    {
        if ($homeId === '') return [];
        $accessId = trim($tuyaCfg['accessId'] ?? '');
        $secret = trim($tuyaCfg['accessSecret'] ?? '');
        $region = trim($tuyaCfg['region'] ?? 'us');
        $tok = $token ?: self::cloudGetToken($accessId, $secret, $region);
        $res = self::cloudRequest('GET', "/v1.0/homes/{$homeId}/scenes", null, $accessId, $secret, $tok, $region);
        if (empty($res['success']) || !is_array($res['result'] ?? null)) {
            return [];
        }
        $out = [];
        foreach ($res['result'] as $sc) {
            if (!is_array($sc) || empty($sc['scene_id'])) continue;
            $out[] = [
                'id' => (string)$sc['scene_id'],
                'name' => (string)($sc['name'] ?? $sc['scene_id']),
                'enabled' => !isset($sc['enabled']) || (bool)$sc['enabled'],
                'homeId' => $homeId,
                'actions' => is_array($sc['actions'] ?? null) ? $sc['actions'] : []
            ];
        }
        return $out;
    }

    public static function cloudSyncHomeScenes(array $tuyaCfg, string $uid = ''): array
    {
        $uid = trim($uid !== '' ? $uid : (string)($tuyaCfg['uid'] ?? ''));
        if ($uid === '') {
            return ['homeId' => '', 'homeName' => '', 'scenes' => []];
        }
        $accessId = trim($tuyaCfg['accessId'] ?? '');
        $secret = trim($tuyaCfg['accessSecret'] ?? '');
        $region = trim($tuyaCfg['region'] ?? 'us');
        $tok = self::cloudGetToken($accessId, $secret, $region);

        $homes = self::cloudListHomes($tuyaCfg, $uid, $tok);
        if (empty($homes)) {
            return ['homeId' => '', 'homeName' => '', 'scenes' => []];
        }
        $primaryHomeId = (string)($homes[0]['home_id'] ?? '');
        $primaryHomeName = (string)($homes[0]['name'] ?? '');
        $allScenes = [];
        foreach ($homes as $home) {
            $hid = (string)($home['home_id'] ?? '');
            if ($hid === '') continue;
            foreach (self::cloudListHomeScenes($tuyaCfg, $hid, $tok) as $sc) {
                $sc['homeName'] = (string)($home['name'] ?? $primaryHomeName);
                $allScenes[] = $sc;
            }
        }
        return ['homeId' => $primaryHomeId, 'homeName' => $primaryHomeName, 'scenes' => $allScenes];
    }

    public static function cloudTriggerHomeScene(array $tuyaCfg, string $homeId, string $sceneId): array
    {
        $accessId = trim($tuyaCfg['accessId'] ?? '');
        $secret = trim($tuyaCfg['accessSecret'] ?? '');
        $region = trim($tuyaCfg['region'] ?? 'us');
        $tok = self::cloudGetToken($accessId, $secret, $region);
        $res = self::cloudRequest('POST', "/v1.0/homes/{$homeId}/scenes/{$sceneId}/trigger", (object)[], $accessId, $secret, $tok, $region);
        if (empty($res['success'])) {
            $code = isset($res['code']) ? " (code {$res['code']})" : '';
            throw new RuntimeException('Tuya scene trigger failed: ' . ($res['msg'] ?? 'unknown') . $code);
        }
        return $res;
    }

    public static function irListRemotes(array $tuyaCfg, string $irHubId): array
    {
        $accessId = trim($tuyaCfg['accessId'] ?? '');
        $secret = trim($tuyaCfg['accessSecret'] ?? '');
        $region = trim($tuyaCfg['region'] ?? 'us');
        $tok = self::cloudGetToken($accessId, $secret, $region);
        return self::cloudRequest('GET', "/v2.0/infrareds/{$irHubId}/remotes", null, $accessId, $secret, $tok, $region);
    }

    public static function irListKeys(array $tuyaCfg, string $irHubId, string $remoteId): array
    {
        $accessId = trim($tuyaCfg['accessId'] ?? '');
        $secret = trim($tuyaCfg['accessSecret'] ?? '');
        $region = trim($tuyaCfg['region'] ?? 'us');
        $tok = self::cloudGetToken($accessId, $secret, $region);
        return self::cloudRequest('GET', "/v2.0/infrareds/{$irHubId}/remotes/{$remoteId}/keys", null, $accessId, $secret, $tok, $region);
    }

    public static function irSendKey(array $tuyaCfg, string $irHubId, string $remoteId, string $key, ?int $categoryId = null): array
    {
        $accessId = trim($tuyaCfg['accessId'] ?? '');
        $secret = trim($tuyaCfg['accessSecret'] ?? '');
        $region = trim($tuyaCfg['region'] ?? 'us');
        $tok = self::cloudGetToken($accessId, $secret, $region);
        $body = ['key' => $key];
        if ($categoryId !== null) {
            $body['category_id'] = $categoryId;
        }
        return self::cloudRequest('POST', "/v2.0/infrareds/{$irHubId}/remotes/{$remoteId}/command", $body, $accessId, $secret, $tok, $region);
    }

    public static function irControlAc(array $tuyaCfg, string $irHubId, string $remoteId, array $params): array
    {
        $accessId = trim($tuyaCfg['accessId'] ?? '');
        $secret = trim($tuyaCfg['accessSecret'] ?? '');
        $region = trim($tuyaCfg['region'] ?? 'us');
        $tok = self::cloudGetToken($accessId, $secret, $region);
        return self::cloudRequest('POST', "/v2.0/infrareds/{$irHubId}/remotes/{$remoteId}/ac/scene/command", $params, $accessId, $secret, $tok, $region);
    }

    public static function irSendSmartCommand(array $tuyaCfg, array $dev, array $allDevices, array $commands, ?array $acParams = null, string $irKeyHint = ''): array
    {
        // Step 1: Standard IoT Core Device Control (/v1.0/iot-03/devices/{id}/commands)
        $rawRes = self::cloudSendCommandsRaw($tuyaCfg, (string)$dev['id'], $commands);
        if (!empty($rawRes['success'])) {
            return ['ok' => true, 'method' => 'tuya_iot_commands', 'commands' => $commands, 'result' => $rawRes];
        }

        // Step 2: Optional Universal Infrared v2 API (works when Universal Infrared Service is subscribed on iot.tuya.com)
        $irHubId = '';
        foreach ($allDevices as $cand) {
            if (($cand['platform'] ?? '') === 'tuya' && (($cand['tuyaCategory'] ?? '') === 'wnykq' || ($cand['category'] ?? '') === 'ir_hub')) {
                $irHubId = (string)($cand['id'] ?? '');
                break;
            }
        }
        $v2Err = null;
        if ($irHubId !== '') {
            $cat = (string)($dev['tuyaCategory'] ?? '');
            if ($cat === 'infrared_ac' && !empty($acParams)) {
                $v2Res = self::irControlAc($tuyaCfg, $irHubId, (string)$dev['id'], $acParams);
            } else {
                $catMap = [
                    'infrared_tv' => 1,
                    'infrared_stb' => 2,
                    'infrared_box' => 3,
                    'infrared_dvd' => 4,
                    'infrared_ac' => 5,
                    'infrared_fan' => 8,
                    'infrared_airpurifier' => 9,
                    'infrared_amplifier' => 12
                ];
                $keyName = $irKeyHint !== '' ? $irKeyHint : (string)($commands[0]['code'] ?? 'Power');
                $v2Res = self::irSendKey($tuyaCfg, $irHubId, (string)$dev['id'], $keyName, $catMap[$cat] ?? null);
            }
            if (!empty($v2Res['success'])) {
                return ['ok' => true, 'method' => 'tuya_ir_v2', 'result' => $v2Res];
            }
            $v2Err = $v2Res;
        }

        $code1 = (string)($rawRes['code'] ?? '');
        $msg1 = (string)($rawRes['msg'] ?? 'unknown');
        $code2 = (string)($v2Err['code'] ?? '');
        $msg2 = (string)($v2Err['msg'] ?? '');
        if ($code2 === '28841101' || $code1 === '28841101') {
            throw new RuntimeException(
                "Tuya IR command rejected ({$msg1}" . ($code1 ? " [{$code1}]" : '') . "; v2 IR API not subscribed [28841101]). "
                . "Subscribe to Universal Infrared Control in iot.tuya.com -> Cloud -> Service API, or run a Tap-to-Run Smart Scene."
            );
        }
        throw new RuntimeException(
            "Tuya IR command failed: {$msg1}" . ($code1 ? " (code {$code1})" : '')
            . ($msg2 !== '' ? " | v2: {$msg2} ({$code2})" : '')
        );
    }

    private static function cloudRequest(string $method, string $pathAndQuery, array|object|null $body, string $accessId, string $secret, string $accessToken, string $region, bool $allowTokenRetry = true): array
    {
        $t = (string)(int)(microtime(true) * 1000);
        $nonce = bin2hex(random_bytes(8));
        $bodyStr = $body !== null ? json_encode($body, JSON_UNESCAPED_SLASHES) : '';
        $contentHash = hash('sha256', $bodyStr);

        $stringToSign = strtoupper($method) . "\n" . $contentHash . "\n\n" . $pathAndQuery;
        $signStr = $accessId . $accessToken . $t . $nonce . $stringToSign;
        $sign = strtoupper(hash_hmac('sha256', $signStr, $secret));

        $headers = [
            "client_id: {$accessId}",
            "sign: {$sign}",
            "t: {$t}",
            "nonce: {$nonce}",
            "sign_method: HMAC-SHA256",
            "Content-Type: application/json"
        ];
        if ($accessToken !== '') {
            $headers[] = "access_token: {$accessToken}";
        }

        $url = self::cloudBaseUrl($region) . $pathAndQuery;
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 10,
            CURLOPT_IPRESOLVE => CURL_IPRESOLVE_V4,
            CURLOPT_CUSTOMREQUEST => strtoupper($method),
            CURLOPT_HTTPHEADER => $headers
        ]);
        if ($body !== null) {
            curl_setopt($ch, CURLOPT_POSTFIELDS, $bodyStr);
        }

        $raw = curl_exec($ch);
        $err = curl_error($ch);
        curl_close($ch);

        if ($raw === false) {
            throw new RuntimeException("Tuya Cloud HTTP error: {$err}");
        }
        $decoded = json_decode($raw, true);
        if (is_array($decoded) && $allowTokenRetry && $accessToken !== '' && empty($decoded['success']) && in_array((int)($decoded['code'] ?? 0), [1010, 1011, 1012], true)) {
            $freshToken = self::cloudGetToken($accessId, $secret, $region, true);
            return self::cloudRequest($method, $pathAndQuery, $body, $accessId, $secret, $freshToken, $region, false);
        }
        return is_array($decoded) ? $decoded : [];
    }

    private static function mapCategory(string $cat): string
    {
        if (in_array($cat, ['dj', 'dd', 'dc', 'fwd', 'xdd', 'fsd', 'tyndj'], true)) return 'light';
        if (in_array($cat, ['cz', 'pc', 'kg', 'tdq'], true)) return 'switch';
        if ($cat === 'sd') return 'vacuum';
        if ($cat === 'wnykq') return 'ir_hub';
        if ($cat === 'infrared_ac') return 'ir_ac';
        if ($cat === 'infrared_amplifier') return 'ir_audio';
        if ($cat === 'infrared_tv') return 'ir_tv';
        if ($cat === 'infrared_fan') return 'ir_fan';
        if ($cat === 'infrared_airpurifier') return 'ir_purifier';
        if (str_starts_with($cat, 'infrared_')) return 'ir_remote';
        return 'smart';
    }

    private static function parseTuyaStatusArray(array $statusArr): array
    {
        $res = [
            'power' => false,
            'brightness' => 100,
            'temp' => 50,
            'battery' => null,
            'vacuumMode' => '',
            'vacuumCleaning' => false,
            'r' => 255,
            'g' => 255,
            'b' => 255,
            'workMode' => 'white',
            'switchCode' => ''
        ];
        $brightWhite = null;
        $brightColor = null;
        foreach ($statusArr as $dp) {
            $code = $dp['code'] ?? '';
            $val = $dp['value'] ?? null;
            if (in_array($code, ['switch_led', 'switch_1', 'switch', 'led_switch', 'power'], true)) {
                $res['power'] = (bool)$val;
                if ($res['switchCode'] === '') {
                    $res['switchCode'] = $code;
                }
            } elseif ($code === 'power_go') {
                $res['vacuumCleaning'] = (bool)$val;
            } elseif ($code === 'mode' && is_string($val)) {
                $res['vacuumMode'] = $val;
            } elseif ($code === 'electricity_left' && is_numeric($val)) {
                $res['battery'] = max(0, min(100, (int)$val));
            } elseif ($code === 'work_mode' && is_string($val)) {
                $res['workMode'] = $val;
            } elseif ($code === 'temp_value_v2' && is_numeric($val)) {
                $res['temp'] = max(0, min(100, (int)round(((float)$val / 1000.0) * 100)));
            } elseif ($code === 'bright_value_v2' && is_numeric($val)) {
                $brightWhite = max(1, min(100, (int)round(((float)$val / 1000.0) * 100)));
            } elseif ($code === 'bright_value' && is_numeric($val)) {
                $brightWhite = max(1, min(100, (int)round(((float)$val / 255.0) * 100)));
            } elseif ($code === 'colour_data_v2' && is_string($val)) {
                $c = json_decode($val, true);
                if (is_array($c) && isset($c['h'], $c['s'], $c['v'])) {
                    // Preserve full-intensity hue RGB so slider/swatch doesn't collapse to near-black at low brightness
                    [$r, $g, $b] = self::hsvToRgb((float)$c['h'], (float)$c['s'] / 1000.0, 1.0);
                    $res['r'] = $r;
                    $res['g'] = $g;
                    $res['b'] = $b;
                    $brightColor = max(1, min(100, (int)round(((float)$c['v'] / 1000.0) * 100)));
                }
            }
        }
        if ($res['workMode'] === 'colour' && $brightColor !== null) {
            $res['brightness'] = $brightColor;
        } elseif ($brightWhite !== null) {
            $res['brightness'] = $brightWhite;
        } elseif ($brightColor !== null) {
            $res['brightness'] = $brightColor;
        }
        return $res;
    }

    public static function rgbToTuyaHsv(int $r, int $g, int $b): array
    {
        $rf = $r / 255.0; $gf = $g / 255.0; $bf = $b / 255.0;
        $max = max($rf, $gf, $bf);
        $min = min($rf, $gf, $bf);
        $d = $max - $min;
        $h = 0;
        if ($d > 0) {
            if ($max === $rf) $h = 60 * fmod((($gf - $bf) / $d), 6);
            elseif ($max === $gf) $h = 60 * ((($bf - $rf) / $d) + 2);
            else $h = 60 * ((($rf - $gf) / $d) + 4);
        }
        if ($h < 0) $h += 360;
        $s = ($max == 0) ? 0 : ($d / $max);
        return ['h' => (int)round($h), 's' => (int)round($s * 1000), 'v' => (int)round($max * 1000)];
    }

    private static function hsvToRgb(float $h, float $s, float $v): array
    {
        $c = $v * $s;
        $x = $c * (1 - abs(fmod($h / 60.0, 2) - 1));
        $m = $v - $c;
        if ($h < 60) [$r, $g, $b] = [$c, $x, 0];
        elseif ($h < 120) [$r, $g, $b] = [$x, $c, 0];
        elseif ($h < 180) [$r, $g, $b] = [0, $c, $x];
        elseif ($h < 240) [$r, $g, $b] = [0, $x, $c];
        elseif ($h < 300) [$r, $g, $b] = [$x, 0, $c];
        else [$r, $g, $b] = [$c, 0, $x];
        return [(int)round(($r + $m) * 255), (int)round(($g + $m) * 255), (int)round(($b + $m) * 255)];
    }
}
