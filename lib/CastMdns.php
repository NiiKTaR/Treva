<?php
/**
 * Pure PHP mDNS Google Cast Discovery (RFC 6762 / DNS-SD)
 * Works with core PHP stream_socket_server (no ext-sockets or executables required).
 */
class CastMdns
{
    public static function discover(string $bindIp = '', float $timeoutSec = 1.6): array
    {
        $ipsToProbe = [];
        if ($bindIp && filter_var($bindIp, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4)) {
            $ipsToProbe[] = $bindIp;
        }
        foreach (NetworkHelper::getLanIps() as $iface) {
            if (empty($iface['isVirtual']) && !empty($iface['address'])) {
                $ipsToProbe[] = $iface['address'];
            }
        }
        $ipsToProbe = array_values(array_unique($ipsToProbe));
        if (empty($ipsToProbe)) {
            $ipsToProbe[] = '0.0.0.0';
        }

        $sockets = [];
        // DNS PTR query for _googlecast._tcp.local with QU (unicast-response) bit 0x8001
        $qname = "\x0b_googlecast\x04_tcp\x05local\x00";
        $queryPkt = "\x00\x00\x00\x00\x00\x01\x00\x00\x00\x00\x00\x00" . $qname . "\x00\x0c\x80\x01";

        foreach ($ipsToProbe as $ip) {
            $sock = @stream_socket_server("udp://{$ip}:0", $errno, $errstr, STREAM_SERVER_BIND);
            if ($sock) {
                stream_set_blocking($sock, false);
                @stream_socket_sendto($sock, $queryPkt, 0, '224.0.0.251:5353');
                $sockets[(int)$sock] = $sock;
            }
        }

        if (empty($sockets)) {
            return [];
        }

        $services = [];
        $deadline = microtime(true) + $timeoutSec;
        $resent = false;

        while (microtime(true) < $deadline) {
            $elapsed = $timeoutSec - ($deadline - microtime(true));
            if (!$resent && $elapsed > 0.45) {
                $resent = true;
                foreach ($sockets as $sock) {
                    @stream_socket_sendto($sock, $queryPkt, 0, '224.0.0.251:5353');
                }
            }

            $read = $sockets;
            $write = null;
            $except = null;
            $ready = @stream_select($read, $write, $except, 0, 80000);
            if ($ready > 0) {
                foreach ($read as $sock) {
                    $pkt = @stream_socket_recvfrom($sock, 8192, 0, $peer);
                    if ($pkt && strlen($pkt) > 12) {
                        $peerIp = $peer ? explode(':', $peer)[0] : '';
                        self::parseMdnsPacket($pkt, $peerIp, $services);
                    }
                }
            }
        }

        foreach ($sockets as $sock) {
            @fclose($sock);
        }

        self::discoverViaEurekaSubnet($ipsToProbe, $services);

        return array_values($services);
    }

    /**
     * Unicast HTTP Eureka (:8008) fallback for dual-band routers (2.4 GHz / 5.8 GHz)
     * that filter UDP multicast mDNS (224.0.0.251:5353) between wireless bands.
     */
    private static function discoverViaEurekaSubnet(array $ipsToProbe, array &$services): void
    {
        if (!function_exists('curl_multi_init') || !function_exists('curl_init')) {
            return;
        }

        $localIpSet = [];
        $allPrefixes = [];
        $preferredPrefixes = [];
        foreach ($ipsToProbe as $ip) {
            $ip = trim((string)$ip);
            if ($ip === '' || $ip === '0.0.0.0' || $ip === '127.0.0.1' || str_starts_with($ip, '169.254.')) {
                continue;
            }
            if (!filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4)) {
                continue;
            }
            $localIpSet[$ip] = true;
            $parts = explode('.', $ip);
            if (count($parts) !== 4) {
                continue;
            }
            $prefix = $parts[0] . '.' . $parts[1] . '.' . $parts[2];
            $allPrefixes[$prefix] = $prefix;
            if (!str_starts_with($ip, '10.234.')) {
                $preferredPrefixes[$prefix] = $prefix;
            }
        }

        $prefixesToScan = !empty($preferredPrefixes) ? array_values($preferredPrefixes) : array_values($allPrefixes);
        $prefixesToScan = array_slice($prefixesToScan, 0, 2);
        if (empty($prefixesToScan)) {
            return;
        }

        $priorityIps = [];
        $restIps = [];
        foreach ($prefixesToScan as $prefix) {
            for ($hostOctet = 1; $hostOctet <= 254; $hostOctet++) {
                $candidateIp = $prefix . '.' . $hostOctet;
                if (isset($localIpSet[$candidateIp])) {
                    continue;
                }
                if ($hostOctet >= 2 && $hostOctet <= 35) {
                    $priorityIps[] = $candidateIp;
                } else {
                    $restIps[] = $candidateIp;
                }
            }
        }
        if (empty($priorityIps) && empty($restIps)) {
            return;
        }

        $probeBatches = function (array $ips, int $chunkSize, int $connectMs, int $totalMs) use (&$services): int {
            $foundInPass = 0;
            foreach (array_chunk($ips, $chunkSize) as $batch) {
                $mh = curl_multi_init();
                if ($mh === false) {
                    continue;
                }
                $handles = [];
                foreach ($batch as $ip) {
                    $ch = curl_init('http://' . $ip . ':8008/setup/eureka_info?params=name,detail,device_info,net,wifi');
                    if ($ch === false) {
                        continue;
                    }
                    curl_setopt_array($ch, [
                        CURLOPT_RETURNTRANSFER => true,
                        CURLOPT_CONNECTTIMEOUT_MS => $connectMs,
                        CURLOPT_TIMEOUT_MS => $totalMs,
                        CURLOPT_NOSIGNAL => 1,
                        CURLOPT_FOLLOWLOCATION => false,
                    ]);
                    curl_multi_add_handle($mh, $ch);
                    $handles[$ip] = $ch;
                }

                $running = null;
                do {
                    $status = curl_multi_exec($mh, $running);
                    if ($running) {
                        curl_multi_select($mh, 0.05);
                    }
                } while ($running > 0 && $status === CURLM_OK);

                foreach ($handles as $ip => $ch) {
                    $httpCode = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
                    $raw = curl_multi_getcontent($ch);
                    curl_multi_remove_handle($mh, $ch);
                    curl_close($ch);

                    if ($httpCode !== 200 || !is_string($raw) || $raw === '') {
                        continue;
                    }
                    $info = json_decode($raw, true);
                    if (!is_array($info)) {
                        continue;
                    }

                    $friendlyName = trim((string)($info['name'] ?? ''));
                    $rawUdn = trim((string)($info['ssdp_udn'] ?? ($info['device_info']['ssdp_udn'] ?? '')));
                    if ($friendlyName === '' && $rawUdn === '') {
                        continue;
                    }
                    $foundInPass++;
                    $id = $rawUdn !== '' ? strtolower(str_replace('-', '', $rawUdn)) : ($ip . ':8009');
                    $ssid = trim((string)($info['ssid'] ?? ($info['wifi']['ssid'] ?? '')));
                    $bssid = trim((string)($info['bssid'] ?? ($info['wifi']['bssid'] ?? '')));

                    // Preserve existing UDP mDNS metadata (including Cast Groups sharing a host IP); only add Wi-Fi info.
                    if (isset($services[$id])) {
                        if ($ssid !== '' && empty($services[$id]['ssid'])) {
                            $services[$id]['ssid'] = $ssid;
                        }
                        if ($bssid !== '' && empty($services[$id]['bssid'])) {
                            $services[$id]['bssid'] = $bssid;
                        }
                        continue;
                    }

                    $capsObj = is_array($info['device_info']['capabilities'] ?? null) ? $info['device_info']['capabilities'] : [];
                    $model = trim((string)($info['detail']['model_name'] ?? ($info['device_info']['model_name'] ?? '')));
                    $hasDisplayHints = !empty($capsObj['display_supported'])
                        || array_key_exists('closed_caption', $info)
                        || !empty($info['hdmi_control']);
                    if ($model === '') {
                        $model = $hasDisplayHints ? 'Chromecast' : 'Google Cast Speaker';
                    }

                    if ($hasDisplayHints) {
                        $capabilities = 5;
                    } else {
                        $capabilities = !empty($capsObj['multizone_supported']) ? 4 : (self::classifyDevice($model, 0) === 'display' ? 5 : 4);
                    }

                    $kind = self::classifyDevice($model, $capabilities);
                    $variant = self::classifyVariant($model, $capabilities);

                    $entry = [
                        'id' => $id,
                        'name' => $friendlyName !== '' ? $friendlyName : ('Cast ' . $ip),
                        'model' => $model,
                        'variant' => $variant,
                        'host' => $ip,
                        'port' => 8009,
                        'capabilities' => $capabilities,
                        'kind' => $kind,
                        'supportsVideo' => $kind === 'display',
                        'supportsAudio' => true,
                        'mdnsStatusText' => null,
                        'online' => true,
                        'isManual' => false,
                    ];
                    if ($ssid !== '') {
                        $entry['ssid'] = $ssid;
                    }
                    if ($bssid !== '') {
                        $entry['bssid'] = $bssid;
                    }
                    $services[$id] = $entry;
                }

                curl_multi_close($mh);
            }
            return $foundInPass;
        };

        // Pass 1: Priority DHCP range (.2-.35) with generous timeout for waking Wi-Fi power-save radios
        if (!empty($priorityIps)) {
            $foundCount = $probeBatches($priorityIps, 34, 650, 950);
            if ($foundCount < 2) {
                $knownHosts = [];
                foreach ($services as $svc) {
                    if (!empty($svc['host']) && (int)($svc['port'] ?? 8009) === 8009) {
                        $knownHosts[$svc['host']] = true;
                    }
                }
                $retryIps = array_values(array_filter($priorityIps, static fn($ip) => !isset($knownHosts[$ip])));
                if (!empty($retryIps)) {
                    $probeBatches($retryIps, 34, 650, 950);
                }
            }
        }

        // Pass 2: Remaining subnet hosts (.1, .36-.254)
        if (!empty($restIps)) {
            $probeBatches($restIps, 64, 320, 520);
        }
    }

    private static function parseMdnsPacket(string $pkt, string $peerIp, array &$services): void
    {
        $len = strlen($pkt);
        if ($len < 12) return;

        $hdr = unpack('nid/nflags/nqd/nan/nns/nar', substr($pkt, 0, 12));
        $offset = 12;

        // Skip questions
        for ($i = 0; $i < $hdr['qd']; $i++) {
            self::readDnsName($pkt, $offset);
            $offset += 4;
            if ($offset > $len) return;
        }

        $records = [];
        $totalRr = $hdr['an'] + $hdr['ns'] + $hdr['ar'];
        for ($i = 0; $i < $totalRr; $i++) {
            if ($offset >= $len) break;
            $name = self::readDnsName($pkt, $offset);
            if ($offset + 10 > $len) break;
            $meta = unpack('ntype/nclass/Nttl/nrdlen', substr($pkt, $offset, 10));
            $offset += 10;
            $rdStart = $offset;
            $rdLen = $meta['rdlen'];
            if ($offset + $rdLen > $len) break;

            $records[] = [
                'name' => $name,
                'type' => $meta['type'],
                'rdStart' => $rdStart,
                'rdLen' => $rdLen
            ];
            $offset += $rdLen;
        }

        $srvByInstance = [];
        $txtByInstance = [];
        $aByHost = [];

        foreach ($records as $rr) {
            $type = $rr['type'];
            $rdStart = $rr['rdStart'];
            $rdLen = $rr['rdLen'];

            if ($type === 1 && $rdLen === 4) { // A record
                $ip = inet_ntop(substr($pkt, $rdStart, 4));
                if ($ip) {
                    $aByHost[strtolower($rr['name'])] = $ip;
                }
            } elseif ($type === 33 && $rdLen >= 6) { // SRV record
                $srv = unpack('nprio/nweight/nport', substr($pkt, $rdStart, 6));
                $targetOff = $rdStart + 6;
                $target = self::readDnsName($pkt, $targetOff);
                $srvByInstance[$rr['name']] = [
                    'port' => $srv['port'],
                    'target' => strtolower($target)
                ];
            } elseif ($type === 16) { // TXT record
                $txtData = substr($pkt, $rdStart, $rdLen);
                $txtByInstance[$rr['name']] = self::parseTxt($txtData);
            }
        }

        foreach ($srvByInstance as $instanceName => $srv) {
            if (!str_contains(strtolower($instanceName), '_googlecast._tcp')) {
                continue;
            }
            $txt = $txtByInstance[$instanceName] ?? [];
            $hostIp = $aByHost[$srv['target']] ?? $peerIp;
            if (!$hostIp) continue;

            $id = $txt['id'] ?? ($hostIp . ':' . $srv['port']);
            $friendlyName = $txt['fn'] ?? explode('.', $instanceName)[0];
            $model = $txt['md'] ?? 'Google Cast Device';
            $capabilities = (int)($txt['ca'] ?? 0);
            $kind = self::classifyDevice($model, $capabilities);
            $variant = self::classifyVariant($model, $capabilities);
            $mdnsStatusText = trim((string)($txt['rs'] ?? ''));

            $services[$id] = [
                'id' => $id,
                'name' => $friendlyName,
                'model' => $model,
                'variant' => $variant,
                'host' => $hostIp,
                'port' => (int)$srv['port'],
                'capabilities' => $capabilities,
                'kind' => $kind,
                'supportsVideo' => $kind === 'display',
                'supportsAudio' => true,
                'mdnsStatusText' => $mdnsStatusText !== '' ? $mdnsStatusText : null,
                'online' => true,
                'isManual' => false
            ];
        }
    }

    public static function classifyVariant(string $model, int $capabilities = 0): string
    {
        $lower = strtolower($model);
        if (str_contains($lower, 'group')) {
            return 'cast_group';
        }
        if (str_contains($lower, 'hub') || str_contains($lower, 'display')) {
            return 'nest_hub';
        }
        if (
            str_contains($lower, 'google tv') ||
            str_contains($lower, 'android tv') ||
            str_contains($lower, 'shield') ||
            str_contains($lower, 'bravia')
        ) {
            return 'google_tv';
        }
        if (
            str_contains($lower, 'mini') ||
            str_contains($lower, 'nest audio') ||
            str_contains($lower, 'google home') ||
            str_contains($lower, 'chromecast audio') ||
            str_contains($lower, 'speaker')
        ) {
            return 'nest_speaker';
        }
        return (($capabilities & 1) === 1 || str_contains($lower, 'chromecast')) ? 'chromecast' : 'nest_speaker';
    }

    public static function classifyDevice(string $model, int $capabilities = 0): string
    {
        $lower = strtolower($model);
        $hasVideoBit = ($capabilities & 1) === 1;
        $isKnownAudioOnly =
            str_contains($lower, 'mini') ||
            str_contains($lower, 'nest audio') ||
            str_contains($lower, 'google home') ||
            str_contains($lower, 'chromecast audio') ||
            str_contains($lower, 'speaker') ||
            str_contains($lower, 'group');

        if ($capabilities > 0) {
            return ($hasVideoBit && !$isKnownAudioOnly) ? 'display' : 'speaker';
        }
        return $isKnownAudioOnly ? 'speaker' : 'display';
    }

    private static function parseTxt(string $data): array
    {
        $res = [];
        $pos = 0;
        $len = strlen($data);
        while ($pos < $len) {
            $segLen = ord($data[$pos]);
            $pos++;
            if ($segLen <= 0 || $pos + $segLen > $len) break;
            $entry = substr($data, $pos, $segLen);
            $pos += $segLen;
            $eq = strpos($entry, '=');
            if ($eq !== false) {
                $k = substr($entry, 0, $eq);
                $v = substr($entry, $eq + 1);
                $res[$k] = $v;
            }
        }
        return $res;
    }

    private static function readDnsName(string $pkt, int &$offset): string
    {
        $labels = [];
        $len = strlen($pkt);
        $jumped = false;
        $jumpOffset = 0;
        $safety = 0;

        while ($offset < $len && $safety++ < 64) {
            $b = ord($pkt[$offset]);
            if ($b === 0) {
                $offset++;
                break;
            }
            if (($b & 0xC0) === 0xC0) {
                if ($offset + 1 >= $len) break;
                $ptr = (($b & 0x3F) << 8) | ord($pkt[$offset + 1]);
                if (!$jumped) {
                    $jumpOffset = $offset + 2;
                    $jumped = true;
                }
                $offset = $ptr;
                continue;
            }
            $offset++;
            if ($offset + $b > $len) break;
            $labels[] = substr($pkt, $offset, $b);
            $offset += $b;
        }

        if ($jumped) {
            $offset = $jumpOffset;
        }
        return implode('.', $labels);
    }
}
