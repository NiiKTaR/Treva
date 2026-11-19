<?php
/**
 * Pure PHP LAN Network Detection (Zero external executables required)
 */
class NetworkHelper
{
    public static function getLanIps(): array
    {
        $candidates = [];

        // 1. Outbound routing probe (no packets sent; asks OS which local IP routes to internet)
        $sock = @stream_socket_client('udp://8.8.8.8:80', $errno, $errstr, 1);
        if ($sock) {
            $localName = @stream_socket_get_name($sock, false);
            @fclose($sock);
            if ($localName && preg_match('/^(\d+\.\d+\.\d+\.\d+):\d+$/', $localName, $m)) {
                $candidates[] = $m[1];
            }
        }

        // 2. Hostname IPv4 enumeration
        $host = @gethostname();
        if ($host) {
            $ips = @gethostbynamel($host);
            if (is_array($ips)) {
                foreach ($ips as $ip) {
                    if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4)) {
                        $candidates[] = $ip;
                    }
                }
            }
        }

        // 3. Server HTTP host / addr fallback
        if (!empty($_SERVER['SERVER_ADDR']) && filter_var($_SERVER['SERVER_ADDR'], FILTER_VALIDATE_IP, FILTER_FLAG_IPV4)) {
            $candidates[] = $_SERVER['SERVER_ADDR'];
        }

        $candidates = array_values(array_unique($candidates));
        $scored = [];

        foreach ($candidates as $index => $ip) {
            if ($ip === '127.0.0.1' || str_starts_with($ip, '169.254.')) {
                continue;
            }
            $score = 0;
            if ($index === 0) $score += 80; // Outbound default route
            if (str_starts_with($ip, '192.168.')) $score += 60;
            elseif (str_starts_with($ip, '10.')) $score += 50;
            elseif (preg_match('/^172\.(1[6-9]|2\d|3[0-1])\./', $ip)) $score += 10; // Often WSL/Docker vEthernet

            $scored[] = [
                'address' => $ip,
                'name' => ($index === 0 ? 'Primary LAN' : 'Interface') . " ($ip)",
                'isVirtual' => (bool)preg_match('/^172\.(1[6-9]|2\d|3[0-1])\./', $ip) || str_starts_with($ip, '26.'),
                'score' => $score
            ];
        }

        usort($scored, fn($a, $b) => $b['score'] <=> $a['score']);
        return $scored;
    }

    public static function getPrimaryLanIp(): string
    {
        $ips = self::getLanIps();
        return !empty($ips) ? $ips[0]['address'] : '127.0.0.1';
    }

    /**
     * Determines whether this server appears to be running on a local/LAN host
     * vs a public remote hosting server.
     */
    public static function isLocalEnvironment(): bool
    {
        $host = strtolower($_SERVER['HTTP_HOST'] ?? 'localhost');
        $hostOnly = preg_replace('/:\d+$/', '', $host);
        if ($hostOnly === 'localhost' || $hostOnly === '127.0.0.1' || $hostOnly === '::1') {
            return true;
        }
        if (filter_var($hostOnly, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4)) {
            // Private RFC1918 LAN IP
            return !filter_var($hostOnly, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE);
        }
        return false;
    }

    /**
     * Fast Pure PHP parallel TCP port scan across a /24 LAN subnet using curl_multi.
     * Bypasses Windows Firewall unsolicited-UDP drops under Apache/httpd.exe (~0.45s).
     */
    public static function scanSubnetPorts(string $bindIp = '', array $ports = [5577, 6668], int $timeoutMs = 360): array
    {
        $results = [];
        foreach ($ports as $p) {
            $results[(int)$p] = [];
        }
        if (!function_exists('curl_multi_init')) {
            return $results;
        }

        $lanIp = ($bindIp !== '' && filter_var($bindIp, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4))
            ? $bindIp
            : self::getPrimaryLanIp();
        $parts = explode('.', $lanIp);
        if (count($parts) !== 4 || $lanIp === '127.0.0.1') {
            return $results;
        }
        $prefix = "{$parts[0]}.{$parts[1]}.{$parts[2]}.";

        $mh = curl_multi_init();
        $map = [];
        foreach ($ports as $port) {
            $portInt = (int)$port;
            for ($i = 1; $i <= 254; $i++) {
                $ip = $prefix . $i;
                if ($ip === $lanIp) continue;
                $ch = curl_init();
                curl_setopt_array($ch, [
                    CURLOPT_URL => "http://{$ip}:{$portInt}/",
                    CURLOPT_CONNECT_ONLY => true,
                    CURLOPT_CONNECTTIMEOUT_MS => $timeoutMs,
                    CURLOPT_TIMEOUT_MS => $timeoutMs,
                    CURLOPT_NOSIGNAL => 1
                ]);
                curl_multi_add_handle($mh, $ch);
                $map[(int)$ch] = ['ch' => $ch, 'ip' => $ip, 'port' => $portInt];
            }
        }

        $active = null;
        do {
            $mrc = curl_multi_exec($mh, $active);
            while ($info = curl_multi_info_read($mh)) {
                if ($info['msg'] === CURLMSG_DONE && $info['result'] === CURLE_OK) {
                    $id = (int)$info['handle'];
                    if (isset($map[$id])) {
                        $results[$map[$id]['port']][] = $map[$id]['ip'];
                    }
                }
            }
            if ($active) {
                curl_multi_select($mh, 0.04);
            }
        } while ($active && $mrc === CURLM_OK);

        foreach ($map as $m) {
            curl_multi_remove_handle($mh, $m['ch']);
            curl_close($m['ch']);
        }
        curl_multi_close($mh);

        return $results;
    }

    public static function getClientIp(): string
    {
        $candidates = [
            $_SERVER['HTTP_CF_CONNECTING_IP'] ?? '',
            $_SERVER['HTTP_X_REAL_IP'] ?? '',
            $_SERVER['HTTP_X_FORWARDED_FOR'] ?? '',
            $_SERVER['REMOTE_ADDR'] ?? ''
        ];
        foreach ($candidates as $raw) {
            $raw = trim((string)$raw);
            if ($raw === '') {
                continue;
            }
            $first = trim(explode(',', $raw)[0]);
            if (filter_var($first, FILTER_VALIDATE_IP)) {
                return $first;
            }
        }
        return '';
    }

    public static function getActiveLanSubnets(): array
    {
        $subnets = [];
        foreach (self::getLanIps() as $iface) {
            if (!empty($iface['isVirtual'])) {
                continue;
            }
            $addr = trim((string)($iface['address'] ?? ''));
            if ($addr === '' || $addr === '127.0.0.1' || str_starts_with($addr, '169.254.')) {
                continue;
            }
            if (!filter_var($addr, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4)) {
                continue;
            }
            $parts = explode('.', $addr);
            if (count($parts) === 4) {
                $subnets[] = "{$parts[0]}.{$parts[1]}.{$parts[2]}";
            }
        }
        $subnets = array_values(array_unique($subnets));
        sort($subnets);
        return $subnets;
    }

    public static function isHostOnCurrentLan(string $hostIp): bool
    {
        $hostIp = trim($hostIp);
        if (!filter_var($hostIp, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4)) {
            return false;
        }
        $parts = explode('.', $hostIp);
        if (count($parts) !== 4) {
            return false;
        }
        $prefix = "{$parts[0]}.{$parts[1]}.{$parts[2]}";
        return in_array($prefix, self::getActiveLanSubnets(), true);
    }

    public static function getClientNetworkId(): string
    {
        if (self::isLocalEnvironment()) {
            $subnets = self::getActiveLanSubnets();
            if (empty($subnets)) {
                return 'local_no_lan';
            }
            return 'lan_' . substr(sha1(implode(',', $subnets)), 0, 16);
        }
        $ip = self::getClientIp();
        return 'net_' . substr(sha1($ip !== '' ? $ip : 'unknown'), 0, 16);
    }
}
