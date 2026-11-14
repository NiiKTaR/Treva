<?php
/**
 * Pure PHP Magic Home / Zengge / Flux-LED Wi-Fi Client
 * Supports Local LAN UDP 48899 discovery + TCP 5577 control AND optional Zengge Cloud API.
 * Zero external binaries required.
 */
class MagicHomeClient
{
    public static function discoverLan(string $bindIp = '', float $timeoutSec = 0.9, array $tcpCandidates = []): array
    {
        $lanIp = $bindIp ?: NetworkHelper::getPrimaryLanIp();
        $parts = explode('.', $lanIp);
        $subnetBcast = (count($parts) === 4) ? "{$parts[0]}.{$parts[1]}.{$parts[2]}.255" : '255.255.255.255';

        $sock = @stream_socket_server("udp://{$lanIp}:0", $errno, $errstr, STREAM_SERVER_BIND);
        if (!$sock) {
            $sock = @stream_socket_server('udp://0.0.0.0:0', $errno, $errstr, STREAM_SERVER_BIND);
        }

        $found = [];
        $seenIps = [];

        if ($sock) {
            stream_set_blocking($sock, false);
            @stream_socket_sendto($sock, 'HF-A11ASSISTHREAD', 0, "{$subnetBcast}:48899");
            @stream_socket_sendto($sock, 'HF-A11ASSISTHREAD', 0, '255.255.255.255:48899');

            $deadline = microtime(true) + $timeoutSec;
            $resent = false;

            while (microtime(true) < $deadline) {
                if (!$resent && ($deadline - microtime(true)) < ($timeoutSec * 0.55)) {
                    $resent = true;
                    @stream_socket_sendto($sock, 'HF-A11ASSISTHREAD', 0, "{$subnetBcast}:48899");
                }
                $r = [$sock]; $w = null; $ex = null;
                if (@stream_select($r, $w, $ex, 0, 80000) > 0) {
                    $pkt = @stream_socket_recvfrom($sock, 1024, 0, $peer);
                    if (!$pkt) continue;
                    $pkt = trim($pkt);
                    // Reply format: IP,MAC,MODEL
                    $segs = explode(',', $pkt);
                    if (count($segs) >= 2 && filter_var(trim($segs[0]), FILTER_VALIDATE_IP, FILTER_FLAG_IPV4)) {
                        $ip = trim($segs[0]);
                        $mac = strtoupper(trim($segs[1]));
                        $model = trim($segs[2] ?? 'Magic Home LED');
                        $id = 'mh-' . $mac;
                        $seenIps[$ip] = true;

                        $state = @self::queryState($ip, 5577, 1.2);
                        $found[$id] = [
                            'id' => $id,
                            'platform' => 'magichome',
                            'name' => "Magic Home ({$ip})",
                            'model' => $model,
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
                        ];
                    }
                }
            }
            @fclose($sock);
        }

        // TCP 5577 verification fallback + UDP unicast MAC probe (catches devices when broadcast is filtered)
        foreach ($tcpCandidates as $ip) {
            if (isset($seenIps[$ip])) continue;
            $state = @self::queryState($ip, 5577, 1.4);
            if (!empty($state['verified'])) {
                $udpInfo = @self::queryInfoUdp($ip, 0.5);
                $mac = $udpInfo['mac'] ?? '';
                $model = $udpInfo['model'] ?? 'Magic Home Wi-Fi LED';
                $id = $mac !== '' ? 'mh-' . $mac : 'mh-ip-' . str_replace('.', '-', $ip);
                $found[$id] = [
                    'id' => $id,
                    'platform' => 'magichome',
                    'name' => "Magic Home ({$ip})",
                    'model' => $model,
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
                ];
            }
        }

        return array_values($found);
    }

    /**
     * Queries a single Magic Home device directly via unicast UDP 48899 to obtain its MAC & model.
     */
    public static function queryInfoUdp(string $ip, float $timeoutSec = 0.6): ?array
    {
        if (!filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4)) {
            return null;
        }
        $sock = @stream_socket_server('udp://0.0.0.0:0', $errno, $errstr, STREAM_SERVER_BIND);
        if (!$sock) return null;

        stream_set_blocking($sock, false);
        @stream_socket_sendto($sock, 'HF-A11ASSISTHREAD', 0, "{$ip}:48899");
        $r = [$sock]; $w = null; $ex = null;
        $sec = (int)floor($timeoutSec);
        $usec = (int)(($timeoutSec - $sec) * 1000000);
        $info = null;
        if (@stream_select($r, $w, $ex, $sec, $usec) > 0) {
            $pkt = trim((string)@stream_socket_recvfrom($sock, 1024, 0, $peer));
            $segs = explode(',', $pkt);
            if (count($segs) >= 2 && filter_var(trim($segs[0]), FILTER_VALIDATE_IP, FILTER_FLAG_IPV4)) {
                $mac = strtoupper(str_replace([':', '-', ' '], '', trim($segs[1])));
                if ($mac !== '') {
                    $info = [
                        'ip' => trim($segs[0]),
                        'mac' => $mac,
                        'model' => trim($segs[2] ?? 'Magic Home Wi-Fi LED')
                    ];
                }
            }
        }
        @fclose($sock);
        return $info;
    }

    public static function queryState(string $ip, int $port = 5577, float $timeout = 2.5): ?array
    {
        $sock = @stream_socket_client("tcp://{$ip}:{$port}", $errno, $errstr, $timeout);
        if (!$sock) return null;
        stream_set_timeout($sock, 2);

        $cmd = "\x81\x8A\x8B\x96";
        @fwrite($sock, $cmd);
        $resp = @fread($sock, 32);
        @fclose($sock);

        if (!$resp || strlen($resp) < 14 || ord($resp[0]) !== 0x81) {
            return ['verified' => false, 'power' => false, 'r' => 255, 'g' => 255, 'b' => 255, 'w' => 0, 'brightness' => 100];
        }

        $b = array_values(unpack('C*', $resp));
        $power = ($b[2] === 0x23);
        $rawR = $b[6] ?? 255;
        $rawG = $b[7] ?? 255;
        $rawB = $b[8] ?? 255;
        $rawW = $b[9] ?? 0;
        $maxVal = max($rawR, $rawG, $rawB, $rawW);

        if ($maxVal > 0) {
            $brightness = max(1, min(100, (int)round(($maxVal / 255) * 100)));
            $invScale = 255.0 / $maxVal;
            $r = min(255, (int)round($rawR * $invScale));
            $g = min(255, (int)round($rawG * $invScale));
            $bVal = min(255, (int)round($rawB * $invScale));
            $w = min(255, (int)round($rawW * $invScale));
        } else {
            $brightness = 100;
            $r = 255;
            $g = 255;
            $bVal = 255;
            $w = 0;
        }

        return [
            'verified' => true,
            'power' => $power,
            'r' => $r,
            'g' => $g,
            'b' => $bVal,
            'w' => $w,
            'brightness' => $brightness,
            'deviceType' => $b[1] ?? 0,
            'mode' => $b[3] ?? 0x61
        ];
    }

    public static function buildPowerPacket(bool $on): array
    {
        return $on ? [0x71, 0x23, 0x0F] : [0x71, 0x24, 0x0F];
    }

    public static function buildColorPacket(int $r, int $g, int $b, int $w = 0, bool $writeWhiteOnly = false): array
    {
        $r = max(0, min(255, $r));
        $g = max(0, min(255, $g));
        $b = max(0, min(255, $b));
        $w = max(0, min(255, $w));

        // 0xF0 = write RGB only, 0x0F = write White only, 0x00 = write both (for 5-ch controllers)
        $mask = $writeWhiteOnly ? 0x0F : (($w > 0 && ($r > 0 || $g > 0 || $b > 0)) ? 0x00 : 0xF0);
        return [0x31, $r, $g, $b, $w, $mask, 0x0F];
    }

    public static function buildPresetPacket(int $presetCode, int $speed = 60): array
    {
        $speedByte = max(1, min(31, (int)round(31 - (max(0, min(100, $speed)) / 100 * 30))));
        return [0x61, $presetCode & 0xFF, $speedByte, 0x0F];
    }

    public static function setPower(string $ip, bool $on, int $port = 5577): bool
    {
        return self::sendTcpCommands($ip, [self::buildPowerPacket($on)], $port);
    }

    public static function setColor(string $ip, int $r, int $g, int $b, int $w = 0, int $port = 5577, bool $writeWhiteOnly = false): bool
    {
        return self::sendTcpCommands($ip, [self::buildColorPacket($r, $g, $b, $w, $writeWhiteOnly)], $port);
    }

    public static function setPreset(string $ip, int $presetCode, int $speed = 60, int $port = 5577): bool
    {
        return self::sendTcpCommands($ip, [self::buildPresetPacket($presetCode, $speed)], $port);
    }

    /**
     * Sends one or more un-checksummed packets over a single TCP connection with a brief retry on busy sockets.
     */
    public static function sendTcpCommands(string $ip, array $packetsWithoutChecksum, int $port = 5577): bool
    {
        if (empty($packetsWithoutChecksum)) {
            return true;
        }
        $sock = @stream_socket_client("tcp://{$ip}:{$port}", $errno, $errstr, 2.5);
        if (!$sock) {
            usleep(120000);
            $sock = @stream_socket_client("tcp://{$ip}:{$port}", $errno, $errstr, 2.5);
        }
        if (!$sock) {
            throw new RuntimeException("Could not reach Magic Home device at {$ip}:{$port} ($errstr)");
        }
        stream_set_timeout($sock, 2);

        $allOk = true;
        $count = count($packetsWithoutChecksum);
        foreach (array_values($packetsWithoutChecksum) as $idx => $bytes) {
            $sum = array_sum($bytes) & 0xFF;
            $pkt = $bytes;
            $pkt[] = $sum;
            $raw = pack('C*', ...$pkt);
            $written = @fwrite($sock, $raw);
            if ($written !== strlen($raw)) {
                $allOk = false;
            }
            if ($idx < $count - 1) {
                usleep(50000);
            }
        }
        usleep(40000);
        @fclose($sock);
        return $allOk;
    }

    // =========================================================================
    // ZENGGE / MAGIC HOME CLOUD API (For Remote Hosting & Unified MAC Sync)
    // =========================================================================

    private static function cloudBaseUrl(string $region): string
    {
        $r = strtolower(trim($region));
        if (str_contains($r, 'magichue.net')) {
            $host = preg_replace('#^https?://#i', '', $r);
            $host = explode('/', $host)[0];
            return 'https://' . $host;
        }
        return match ($r) {
            'eu' => 'https://wifij01eu.magichue.net',
            'cn' => 'https://wifij01cn.magichue.net',
            default => 'https://wifij01us.magichue.net',
        };
    }

    private static function detectRegionFromResponse(array $res, string $fallback): string
    {
        $serverCode = strtolower((string)($res['data']['serverCode'] ?? ''));
        if (in_array($serverCode, ['us', 'eu', 'cn'], true)) {
            return $serverCode;
        }
        $webApi = strtolower((string)($res['data']['webApi'] ?? ''));
        if (str_contains($webApi, 'eu.')) return 'eu';
        if (str_contains($webApi, 'cn.')) return 'cn';
        if (str_contains($webApi, 'us.')) return 'us';
        return $fallback;
    }

    public static function cloudLogin(string $email, string $password, string $region = 'us'): array
    {
        $url = self::cloudBaseUrl($region) . '/app/login/ZG001';
        $attempts = [];
        if (strlen($password) !== 32 || !ctype_xdigit($password)) {
            $attempts[] = md5($password);
        }
        $attempts[] = $password;

        $lastError = 'Magic Home Cloud login failed';
        foreach ($attempts as $pw) {
            $payload = [
                'userID' => $email,
                'password' => $pw,
                'clientID' => 'TrevaCastWeb'
            ];
            $res = self::httpJson('POST', $url, $payload);
            $code = isset($res['code']) ? (int)$res['code'] : null;
            $token = (string)($res['token'] ?? ($res['data']['token'] ?? ($res['data']['authToken'] ?? '')));

            if (($code === null || $code === 0) && $token !== '') {
                return [
                    'token' => $token,
                    'userId' => (string)($res['userID'] ?? ($res['data']['userID'] ?? ($res['data']['userName'] ?? $email))),
                    'region' => self::detectRegionFromResponse($res, $region)
                ];
            }
            if (!empty($res['msg'])) {
                $lastError = (string)$res['msg'];
            } elseif ($code !== null && $code !== 0) {
                $lastError = 'Magic Home Cloud error code ' . $code;
            }
        }

        throw new RuntimeException($lastError);
    }

    public static function cloudListDevices(string $token, string $region = 'us'): array
    {
        $url = self::cloudBaseUrl($region) . '/app/getMyBindDevices/ZG001';
        $res = self::httpJson('GET', $url, null, ['token: ' . $token]);
        if (isset($res['code']) && (int)$res['code'] !== 0) {
            $msg = (string)($res['msg'] ?? ('Magic Home Cloud error code ' . $res['code']));
            throw new RuntimeException($msg !== '' ? $msg : ('Magic Home Cloud error code ' . $res['code']), (int)$res['code']);
        }
        $list = $res['data'] ?? [];
        if (!is_array($list)) return [];

        $devices = [];
        foreach ($list as $item) {
            $mac = strtoupper(str_replace([':', '-', ' '], '', (string)($item['macAddress'] ?? $item['mac'] ?? '')));
            if ($mac === '') continue;
            $id = 'mh-' . $mac;
            $devices[] = [
                'id' => $id,
                'platform' => 'magichome',
                'name' => $item['deviceName'] ?? "Magic Home ({$mac})",
                'model' => $item['moduleID'] ?? 'Magic Home Wi-Fi',
                'mac' => $mac,
                'ip' => $item['localIP'] ?? '',
                'port' => 5577,
                'online' => !empty($item['isOnline']),
                'category' => 'light',
                '_preserveColorState' => true,
                'power' => false,
                'r' => 255,
                'g' => 255,
                'b' => 255,
                'w' => 0,
                'brightness' => 100
            ];
        }
        return $devices;
    }

    /**
     * Sends one or more un-checksummed byte packets to a bound Magic Home device via Cloud API.
     */
    public static function cloudSendBatch(string $token, string $mac, array $packetsWithoutChecksum, string $region = 'us'): bool
    {
        if (empty($packetsWithoutChecksum)) {
            return true;
        }
        $cleanMac = strtoupper(str_replace([':', '-', ' '], '', $mac));
        $items = [];
        foreach ($packetsWithoutChecksum as $bytes) {
            $pkt = $bytes;
            $pkt[] = array_sum($pkt) & 0xFF;
            $hex = '';
            foreach ($pkt as $b) {
                $hex .= sprintf('%02X', $b & 0xFF);
            }
            $items[] = [
                'macAddress' => $cleanMac,
                'hexData' => $hex
            ];
        }

        $url = self::cloudBaseUrl($region) . '/app/sendCommandBatch/ZG001';
        $res = self::httpJson('POST', $url, [
            'dataCommandItems' => $items
        ], ['token: ' . $token]);

        if (!isset($res['code']) || (int)$res['code'] !== 0) {
            $code = (int)($res['code'] ?? 0);
            $msg = trim((string)($res['msg'] ?? ''));
            throw new RuntimeException($msg !== '' ? "Magic Home Cloud: {$msg}" : "Magic Home Cloud error code {$code}", $code);
        }
        return true;
    }

    public static function cloudSendHex(string $token, string $mac, array $bytesWithChecksum, string $region = 'us'): bool
    {
        $hex = '';
        foreach ($bytesWithChecksum as $b) {
            $hex .= sprintf('%02X', $b & 0xFF);
        }
        $cleanMac = strtoupper(str_replace([':', '-', ' '], '', $mac));
        $url = self::cloudBaseUrl($region) . '/app/sendCommandBatch/ZG001';
        $res = self::httpJson('POST', $url, [
            'dataCommandItems' => [
                ['macAddress' => $cleanMac, 'hexData' => $hex]
            ]
        ], ['token: ' . $token]);

        if (!isset($res['code']) || (int)$res['code'] !== 0) {
            $code = (int)($res['code'] ?? 0);
            $msg = trim((string)($res['msg'] ?? ''));
            throw new RuntimeException($msg !== '' ? "Magic Home Cloud: {$msg}" : "Magic Home Cloud error code {$code}", $code);
        }
        return true;
    }

    public static function isAuthError(Throwable $e): bool
    {
        $code = (int)$e->getCode();
        if (in_array($code, [401, 403, 10001, 10002, 10003, 10034], true)) {
            return true;
        }
        return (bool)preg_match('/token|auth|unauthoriz|expired|login|401|403/i', $e->getMessage());
    }

    private static function httpJson(string $method, string $url, ?array $body = null, array $headers = []): array
    {
        $ch = curl_init($url);
        $hdrs = array_merge(['Content-Type: application/json', 'Accept: application/json'], $headers);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 8,
            CURLOPT_CUSTOMREQUEST => $method,
            CURLOPT_HTTPHEADER => $hdrs
        ]);
        if ($body !== null) {
            curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body));
        }
        $raw = curl_exec($ch);
        $httpCode = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $err = curl_error($ch);
        curl_close($ch);
        if ($raw === false) {
            throw new RuntimeException('Magic Home Cloud HTTP error: ' . $err);
        }
        $decoded = json_decode($raw, true);
        if (is_array($decoded)) {
            if (!isset($decoded['code']) && $httpCode >= 400) {
                $decoded['code'] = $httpCode;
            }
            return $decoded;
        }
        if ($httpCode >= 400) {
            throw new RuntimeException("Magic Home Cloud HTTP {$httpCode}", $httpCode);
        }
        return [];
    }
}
