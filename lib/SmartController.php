<?php
/**
 * Unified Smart Home Execution Engine for Treva
 * Controls Magic Home (TCP 5577 & Cloud), Smart Life / Tuya (Lights, Switches, Robot Vacuum,
 * IR Sub-devices, Universal IR v2, Tap-to-Run Smart Scenes), and Google Cast (CastV2).
 */
class SmartController
{
    public static function ensureMagicHomeToken(StreamStore $store, array &$cfg, bool $forceLogin = false): array
    {
        $mh = $cfg['magicHome'] ?? [];
        $token = trim((string)($mh['token'] ?? ''));
        $email = trim((string)($mh['email'] ?? ''));
        $pass = (string)($mh['password'] ?? '');
        $region = trim((string)($mh['region'] ?? 'us')) ?: 'us';

        if (($forceLogin || $token === '') && $email !== '' && $pass !== '') {
            $login = MagicHomeClient::cloudLogin($email, $pass, $region);
            $token = $login['token'];
            $region = $login['region'] ?? $region;
            $cfg = $store->saveSmartConfig([
                'magicHome' => [
                    'token' => $token,
                    'region' => $region
                ]
            ]);
        }

        return ['token' => $token, 'region' => $region];
    }

    public static function hexToRgb(string $hex): ?array
    {
        if (!preg_match('/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i', trim($hex), $m)) {
            return null;
        }
        return [
            'r' => hexdec($m[1]),
            'g' => hexdec($m[2]),
            'b' => hexdec($m[3])
        ];
    }

    public static function controlDevice(StreamStore $store, string $deviceId, array $params): array
    {
        $allSmart = $store->getSmartDevices();
        if (!isset($allSmart[$deviceId])) {
            throw new InvalidArgumentException("Smart device not found: {$deviceId}");
        }

        $dev = $allSmart[$deviceId];
        $platform = $dev['platform'] ?? 'magichome';
        $cfg = $store->getSmartConfig();
        $isLocal = NetworkHelper::isLocalEnvironment();
        $patch = [];
        $meta = ['method' => 'local'];

        if (!empty($params['color_hex']) && is_string($params['color_hex']) && !isset($params['r'], $params['g'], $params['b'])) {
            $rgb = self::hexToRgb($params['color_hex']);
            if ($rgb) {
                $params['r'] = $rgb['r'];
                $params['g'] = $rgb['g'];
                $params['b'] = $rgb['b'];
            }
        }

        if ($platform === 'magichome') {
            $meta = self::controlMagicHome($store, $cfg, $dev, $params, $isLocal, $patch);
        } else {
            $meta = self::controlTuya($cfg, $dev, $allSmart, $params, $isLocal, $patch);
        }

        $updated = $store->upsertSmartDevice(array_merge($dev, $patch));
        return [
            'ok' => true,
            'device' => $updated,
            'meta' => $meta,
            'smartDevices' => $store->getSmartDevicesPublic()
        ];
    }

    private static function controlMagicHome(
        StreamStore $store,
        array &$cfg,
        array $dev,
        array $body,
        bool $isLocal,
        array &$patch
    ): array {
        $ip = $dev['ip'] ?? '';
        $mac = $dev['mac'] ?? '';
        $packets = [];

        $hasColorOrBriOrPreset = isset($body['r'], $body['g'], $body['b']) || isset($body['brightness']) || isset($body['preset']);
        if (isset($body['power'])) {
            $on = (bool)$body['power'];
            if (!$hasColorOrBriOrPreset || ($on && empty($dev['power']))) {
                $packets[] = MagicHomeClient::buildPowerPacket($on);
            }
            $patch['power'] = $on;
        }

        if (isset($body['r'], $body['g'], $body['b'])) {
            $r = max(0, min(255, (int)$body['r']));
            $g = max(0, min(255, (int)$body['g']));
            $b = max(0, min(255, (int)$body['b']));
            $w = max(0, min(255, (int)($body['w'] ?? ($dev['w'] ?? 0))));
            $bri = isset($body['brightness'])
                ? max(1, min(100, (int)$body['brightness']))
                : max(1, min(100, (int)($dev['brightness'] ?? 100)));
            $scale = $bri / 100.0;
            $writeWhiteOnly = ($r === 0 && $g === 0 && $b === 0 && $w > 0);
            $packets[] = MagicHomeClient::buildColorPacket(
                (int)round($r * $scale),
                (int)round($g * $scale),
                (int)round($b * $scale),
                (int)round($w * $scale),
                $writeWhiteOnly
            );
            $patch = array_merge($patch, ['r' => $r, 'g' => $g, 'b' => $b, 'w' => $w, 'brightness' => $bri, 'power' => true]);
        } elseif (isset($body['color_temp_pct'])) {
            $pct = max(0, min(100, (int)$body['color_temp_pct']));
            $bri = isset($body['brightness'])
                ? max(1, min(100, (int)$body['brightness']))
                : max(1, min(100, (int)($dev['brightness'] ?? 100)));
            $scale = $bri / 100.0;
            // Warm (0%) shifts toward warm amber-white, cool (100%) shifts crisp daylight white
            $r = 255;
            $g = (int)round(205 + ($pct / 100.0) * 50);
            $b = (int)round(145 + ($pct / 100.0) * 110);
            $packets[] = MagicHomeClient::buildColorPacket(
                (int)round($r * $scale),
                (int)round($g * $scale),
                (int)round($b * $scale),
                0,
                false
            );
            $patch = array_merge($patch, ['r' => $r, 'g' => $g, 'b' => $b, 'w' => 0, 'brightness' => $bri, 'temp' => $pct, 'power' => true]);
        } elseif (isset($body['brightness'])) {
            $bri = max(1, min(100, (int)$body['brightness']));
            $scale = $bri / 100.0;
            $r = max(0, min(255, (int)($dev['r'] ?? 255)));
            $g = max(0, min(255, (int)($dev['g'] ?? 255)));
            $b = max(0, min(255, (int)($dev['b'] ?? 255)));
            $w = max(0, min(255, (int)($dev['w'] ?? 0)));
            if ($r === 0 && $g === 0 && $b === 0 && $w === 0) {
                $r = 255;
                $g = 255;
                $b = 255;
            }
            $writeWhiteOnly = ($r === 0 && $g === 0 && $b === 0 && $w > 0);
            $packets[] = MagicHomeClient::buildColorPacket(
                (int)round($r * $scale),
                (int)round($g * $scale),
                (int)round($b * $scale),
                (int)round($w * $scale),
                $writeWhiteOnly
            );
            $patch = array_merge($patch, ['brightness' => $bri, 'power' => true]);
        } elseif (isset($body['preset'])) {
            $packets[] = MagicHomeClient::buildPresetPacket((int)$body['preset'], (int)($body['speed'] ?? 65));
            $patch['power'] = true;
        }

        $controlled = false;
        $method = 'magichome_lan';
        $mhCfg = $cfg['magicHome'] ?? [];
        $hasCloudCreds = $mac !== '' && (
            ($mhCfg['token'] ?? '') !== '' ||
            (($mhCfg['email'] ?? '') !== '' && ($mhCfg['password'] ?? '') !== '')
        );

        if ($isLocal && $ip !== '' && !empty($packets)) {
            try {
                MagicHomeClient::sendTcpCommands($ip, $packets, (int)($dev['port'] ?? 5577));
                $controlled = true;
            } catch (Throwable $localErr) {
                if (!$hasCloudCreds) {
                    throw $localErr;
                }
            }
        }

        if (!$controlled && !empty($packets)) {
            if ($mac === '') {
                throw new RuntimeException('Magic Home needs a MAC address for Cloud control (click Sync Cloud Devices or add the MAC in + Add Device), or open Treva on local Wi-Fi.');
            }
            $auth = self::ensureMagicHomeToken($store, $cfg, false);
            $token = $auth['token'];
            $region = $auth['region'];
            if ($token === '') {
                throw new RuntimeException('Magic Home needs a LAN IP on local Wi-Fi or Magic Home Cloud login in Access Keys / Tokens.');
            }
            try {
                MagicHomeClient::cloudSendBatch($token, $mac, $packets, $region);
            } catch (Throwable $cloudErr) {
                if (MagicHomeClient::isAuthError($cloudErr) &&
                    ($mhCfg['email'] ?? '') !== '' && ($mhCfg['password'] ?? '') !== '') {
                    $auth = self::ensureMagicHomeToken($store, $cfg, true);
                    MagicHomeClient::cloudSendBatch($auth['token'], $mac, $packets, $auth['region']);
                } else {
                    throw $cloudErr;
                }
            }
            $method = 'magichome_cloud';
        }

        return ['method' => $method];
    }

    private static function findFunctionCode(array $dev, array $candidates): string
    {
        $fns = is_array($dev['functions'] ?? null) ? $dev['functions'] : [];
        $byLower = [];
        foreach ($fns as $fn) {
            if (!empty($fn['code'])) {
                $byLower[strtolower((string)$fn['code'])] = (string)$fn['code'];
            }
        }
        foreach ($candidates as $cand) {
            $lc = strtolower($cand);
            if (isset($byLower[$lc])) {
                return $byLower[$lc];
            }
        }
        return '';
    }

    private static function controlTuya(
        array $cfg,
        array $dev,
        array $allSmart,
        array $body,
        bool $isLocal,
        array &$patch
    ): array {
        $deviceId = (string)$dev['id'];
        $tuyaCat = (string)($dev['tuyaCategory'] ?? '');
        $cat = (string)($dev['category'] ?? 'smart');
        $hasCloud = ($cfg['tuya']['accessId'] ?? '') !== '' && ($cfg['tuya']['accessSecret'] ?? '') !== '';
        $hasLocal = $isLocal && !empty($dev['ip']) && !empty($dev['localKey']);

        // 1. Virtual IR Remote sub-devices (infrared_ac, infrared_amplifier, infrared_tv, infrared_fan, infrared_airpurifier)
        if (str_starts_with($tuyaCat, 'infrared_') || str_starts_with($cat, 'ir_')) {
            if (!$hasCloud) {
                throw new RuntimeException('Tuya Cloud Access ID + Secret required to control Smart Life IR remotes.');
            }
            $irCmds = [];
            $acParams = null;
            $keyHint = '';

            if (!empty($body['rawCommands']) && is_array($body['rawCommands'])) {
                $irCmds = $body['rawCommands'];
            } else {
                // Air conditioner multi-parameter control
                if ($tuyaCat === 'infrared_ac' && (isset($body['ac_temp']) || isset($body['ac_mode']) || isset($body['ac_fan']) || isset($body['ac_power']))) {
                    $acPower = $body['ac_power'] ?? ($body['power'] ?? null);
                    if ($acPower === false || $acPower === 'off' || $acPower === 0) {
                        $irCmds[] = ['code' => 'PowerOff', 'value' => 'PowerOff'];
                        $acParams = ['power' => 0];
                        $patch['power'] = false;
                        $keyHint = 'PowerOff';
                    } else {
                        if ($acPower === true || $acPower === 'on' || $acPower === 1) {
                            $irCmds[] = ['code' => 'PowerOn', 'value' => 'PowerOn'];
                            $patch['power'] = true;
                        }
                        $acParams = ['power' => 1];
                        if (isset($body['ac_mode'])) {
                            $modeMap = ['cool' => 0, 'heat' => 1, 'auto' => 2, 'fan' => 3, 'wind' => 3, 'dry' => 4, 'dehumidify' => 4];
                            $m = is_numeric($body['ac_mode']) ? (int)$body['ac_mode'] : ($modeMap[strtolower((string)$body['ac_mode'])] ?? 0);
                            $m = max(0, min(4, $m));
                            $irCmds[] = ['code' => 'M', 'value' => $m];
                            $acParams['mode'] = $m;
                            $patch['acMode'] = $m;
                        }
                        if (isset($body['ac_temp'])) {
                            $t = max(16, min(30, (int)$body['ac_temp']));
                            $irCmds[] = ['code' => 'T', 'value' => $t];
                            $acParams['temp'] = $t;
                            $patch['acTemp'] = $t;
                        }
                        if (isset($body['ac_fan'])) {
                            $fanMap = ['auto' => 0, 'low' => 1, 'mid' => 2, 'medium' => 2, 'high' => 3];
                            $f = is_numeric($body['ac_fan']) ? (int)$body['ac_fan'] : ($fanMap[strtolower((string)$body['ac_fan'])] ?? 0);
                            $f = max(0, min(3, $f));
                            $irCmds[] = ['code' => 'F', 'value' => $f];
                            $acParams['wind'] = $f;
                            $patch['acFan'] = $f;
                        }
                    }
                } elseif (!empty($body['ir_command'])) {
                    $reqKey = trim((string)$body['ir_command']);
                    $matched = self::findFunctionCode($dev, [$reqKey]);
                    $code = $matched !== '' ? $matched : $reqKey;
                    $val = $body['ir_value'] ?? $code;
                    $irCmds[] = ['code' => $code, 'value' => $val];
                    $keyHint = $code;
                    if (strcasecmp($code, 'PowerOn') === 0) $patch['power'] = true;
                    elseif (strcasecmp($code, 'PowerOff') === 0) $patch['power'] = false;
                } elseif (isset($body['power'])) {
                    $on = (bool)$body['power'];
                    $wantCode = $on
                        ? self::findFunctionCode($dev, ['PowerOn', 'Power', 'power'])
                        : self::findFunctionCode($dev, ['PowerOff', 'Power', 'power']);
                    if ($wantCode === '') {
                        $wantCode = ($tuyaCat === 'infrared_tv' || $tuyaCat === 'infrared_airpurifier')
                            ? 'Power'
                            : ($on ? 'PowerOn' : 'PowerOff');
                    }
                    $irCmds[] = ['code' => $wantCode, 'value' => $wantCode];
                    $keyHint = $wantCode;
                    $patch['power'] = $on;
                    if ($tuyaCat === 'infrared_ac') {
                        $acParams = ['power' => $on ? 1 : 0];
                    }
                }
            }

            if (empty($irCmds)) {
                throw new InvalidArgumentException('No IR command specified for ' . ($dev['name'] ?? $deviceId));
            }
            $res = TuyaClient::irSendSmartCommand($cfg['tuya'], $dev, array_values($allSmart), $irCmds, $acParams, $keyHint);
            return ['method' => $res['method'] ?? 'tuya_iot_commands', 'commands' => $irCmds];
        }

        // 2. Arbitrary explicit Tuya DPs (works for vacuums, advanced switches, custom parameters)
        $cloudCmds = [];
        $localDps = [];
        $isLight = $cat === 'light';
        $isVacuum = $cat === 'vacuum' || $tuyaCat === 'sd';

        if (!empty($body['rawCommands']) && is_array($body['rawCommands'])) {
            foreach ($body['rawCommands'] as $cmd) {
                if (is_array($cmd) && !empty($cmd['code'])) {
                    $cloudCmds[] = ['code' => (string)$cmd['code'], 'value' => $cmd['value'] ?? null];
                }
            }
        } elseif ($isVacuum) {
            $vacAct = strtolower(trim((string)($body['vacuum_action'] ?? '')));
            if ($vacAct === 'start_clean' || $vacAct === 'smart_clean' || $vacAct === 'smart' || $vacAct === 'start' || $vacAct === 'clean') {
                $cloudCmds[] = ['code' => 'power', 'value' => true];
                $cloudCmds[] = ['code' => 'mode', 'value' => 'smart'];
                $cloudCmds[] = ['code' => 'power_go', 'value' => true];
                $patch['power'] = true;
                $patch['vacuumCleaning'] = true;
                $patch['vacuumMode'] = 'smart';
            } elseif ($vacAct === 'pause' || $vacAct === 'stop') {
                $cloudCmds[] = ['code' => 'power_go', 'value' => false];
                $patch['vacuumCleaning'] = false;
            } elseif ($vacAct === 'dock' || $vacAct === 'charge' || $vacAct === 'chargego' || $vacAct === 'home') {
                $cloudCmds[] = ['code' => 'mode', 'value' => 'chargego'];
                $cloudCmds[] = ['code' => 'power_go', 'value' => true];
                $patch['power'] = true;
                $patch['vacuumMode'] = 'chargego';
            } elseif ($vacAct === 'mop') {
                $cloudCmds[] = ['code' => 'mode', 'value' => 'mop'];
                $cloudCmds[] = ['code' => 'power_go', 'value' => true];
                $patch['power'] = true;
                $patch['vacuumMode'] = 'mop';
            } else {
                if (isset($body['power'])) {
                    $on = (bool)$body['power'];
                    $cloudCmds[] = ['code' => 'power', 'value' => $on];
                    $patch['power'] = $on;
                }
                if (isset($body['mode']) && is_string($body['mode'])) {
                    $cloudCmds[] = ['code' => 'mode', 'value' => $body['mode']];
                    $patch['vacuumMode'] = $body['mode'];
                }
                if (isset($body['power_go'])) {
                    $go = (bool)$body['power_go'];
                    $cloudCmds[] = ['code' => 'power_go', 'value' => $go];
                    $patch['vacuumCleaning'] = $go;
                }
            }
        } else {
            // Lights, switches, plugs
            $switchCode = !empty($dev['switchCode']) ? (string)$dev['switchCode'] : ($isLight ? 'switch_led' : 'switch_1');

            if (isset($body['power'])) {
                $on = (bool)$body['power'];
                $cloudCmds[] = ['code' => $switchCode, 'value' => $on];
                $localDps[$isLight ? '20' : '1'] = $on;
                $patch['power'] = $on;
            }
            if (isset($body['work_mode']) && is_string($body['work_mode']) && $isLight) {
                $wm = $body['work_mode'];
                $cloudCmds[] = ['code' => 'switch_led', 'value' => true];
                $cloudCmds[] = ['code' => 'work_mode', 'value' => $wm];
                $localDps['20'] = true;
                $localDps['21'] = $wm;
                $patch['workMode'] = $wm;
                $patch['power'] = true;
            }
            if (isset($body['color_temp_pct']) && $isLight) {
                $pct = max(0, min(100, (int)$body['color_temp_pct']));
                $bri = isset($body['brightness'])
                    ? max(1, min(100, (int)$body['brightness']))
                    : max(1, min(100, (int)($dev['brightness'] ?? 100)));
                $cloudCmds[] = ['code' => 'switch_led', 'value' => true];
                $cloudCmds[] = ['code' => 'work_mode', 'value' => 'white'];
                $cloudCmds[] = ['code' => 'bright_value_v2', 'value' => $bri * 10];
                $cloudCmds[] = ['code' => 'temp_value_v2', 'value' => $pct * 10];
                $localDps['20'] = true;
                $localDps['21'] = 'white';
                $localDps['22'] = $bri * 10;
                $localDps['23'] = $pct * 10;
                $patch = array_merge($patch, [
                    'workMode' => 'white',
                    'brightness' => $bri,
                    'temp' => $pct,
                    'r' => 255,
                    'g' => 255,
                    'b' => 255,
                    'power' => true
                ]);
            } elseif (isset($body['r'], $body['g'], $body['b']) && $isLight) {
                $r = max(0, min(255, (int)$body['r']));
                $g = max(0, min(255, (int)$body['g']));
                $b = max(0, min(255, (int)$body['b']));
                $bri = isset($body['brightness'])
                    ? max(1, min(100, (int)$body['brightness']))
                    : max(1, min(100, (int)($dev['brightness'] ?? 100)));
                $hsv = TuyaClient::rgbToTuyaHsv($r, $g, $b);
                $hsv['v'] = $bri * 10;
                $patch['brightness'] = $bri;
                $cloudCmds[] = ['code' => 'switch_led', 'value' => true];
                $cloudCmds[] = ['code' => 'work_mode', 'value' => 'colour'];
                $cloudCmds[] = ['code' => 'colour_data_v2', 'value' => json_encode($hsv)];
                $localDps['20'] = true;
                $localDps['21'] = 'colour';
                $localDps['24'] = sprintf('%04x%04x%04x', $hsv['h'], $hsv['s'], $hsv['v']);
                $patch = array_merge($patch, ['r' => $r, 'g' => $g, 'b' => $b, 'workMode' => 'colour', 'power' => true]);
            } elseif (isset($body['brightness']) && $isLight) {
                $bri = max(1, min(100, (int)$body['brightness']));
                $r = max(0, min(255, (int)($dev['r'] ?? 255)));
                $g = max(0, min(255, (int)($dev['g'] ?? 255)));
                $b = max(0, min(255, (int)($dev['b'] ?? 255)));
                $isColored = ($r !== $g || $g !== $b) || (($dev['workMode'] ?? '') === 'colour');
                $cloudCmds[] = ['code' => 'switch_led', 'value' => true];
                $localDps['20'] = true;
                if ($isColored && !($r === 255 && $g === 255 && $b === 255)) {
                    $hsv = TuyaClient::rgbToTuyaHsv($r, $g, $b);
                    $hsv['v'] = $bri * 10;
                    $cloudCmds[] = ['code' => 'work_mode', 'value' => 'colour'];
                    $cloudCmds[] = ['code' => 'colour_data_v2', 'value' => json_encode($hsv)];
                    $localDps['21'] = 'colour';
                    $localDps['24'] = sprintf('%04x%04x%04x', $hsv['h'], $hsv['s'], $hsv['v']);
                    $patch['workMode'] = 'colour';
                } else {
                    $cloudCmds[] = ['code' => 'work_mode', 'value' => 'white'];
                    $cloudCmds[] = ['code' => 'bright_value_v2', 'value' => $bri * 10];
                    $localDps['21'] = 'white';
                    $localDps['22'] = $bri * 10;
                    $patch['workMode'] = 'white';
                }
                $patch = array_merge($patch, ['brightness' => $bri, 'power' => true]);
            }
            if (isset($body['countdown_seconds'])) {
                $sec = max(0, min(86400, (int)$body['countdown_seconds']));
                $cloudCmds[] = ['code' => 'countdown_1', 'value' => $sec];
                $localDps['26'] = $sec;
            }
        }

        if (empty($cloudCmds) && empty($localDps)) {
            throw new InvalidArgumentException('No valid control parameters provided for ' . ($dev['name'] ?? $deviceId));
        }

        $controlled = false;
        $method = 'tuya_local';
        if ($hasLocal && !empty($localDps) && empty($body['rawCommands'])) {
            try {
                TuyaClient::localSetDps($dev['ip'], $deviceId, $dev['localKey'], $dev['version'] ?? '3.3', $localDps);
                $controlled = true;
            } catch (Throwable $localErr) {
                if (!$hasCloud) {
                    throw $localErr;
                }
            }
        }
        if (!$controlled) {
            if (!$hasCloud) {
                throw new RuntimeException('Smart Life needs Tuya IoT Access ID + Secret OR Device Local Key to control this device.');
            }
            TuyaClient::cloudSendCommands($cfg['tuya'], $deviceId, $cloudCmds);
            $method = 'tuya_cloud';
        }

        return ['method' => $method, 'commands' => $cloudCmds];
    }

    public static function triggerScene(StreamStore $store, string $sceneId = '', string $sceneName = '', string $homeId = '', string $deviceHint = ''): array
    {
        $cfg = $store->getSmartConfig();
        if (($cfg['tuya']['accessId'] ?? '') === '' || ($cfg['tuya']['accessSecret'] ?? '') === '') {
            throw new RuntimeException('Tuya IoT credentials are required to trigger Smart Life scenes.');
        }
        $scenesDoc = $store->getSmartScenes();
        $scenes = is_array($scenesDoc['scenes'] ?? null) ? $scenesDoc['scenes'] : [];

        $resolved = null;
        $matchMeta = null;

        if ($sceneId !== '') {
            foreach ($scenes as $sc) {
                if (($sc['id'] ?? '') === $sceneId) {
                    $resolved = $sc;
                    break;
                }
            }
        }
        if (!$resolved && $sceneName !== '') {
            if (class_exists('SceneLinker')) {
                $res = SceneLinker::resolveSceneForCommand($store, $sceneName, $deviceHint);
                if (!empty($res['matched']) && !empty($res['scene'])) {
                    $resolved = $res['scene'];
                    $matchMeta = $res;
                } elseif (($res['matchReason'] ?? '') === 'ac_temp_not_in_scenes') {
                    $nearNames = array_map(
                        static fn($n) => $n['name'] . ' (' . $n['temp'] . '°C)',
                        array_slice($res['nearbyCandidates'] ?? [], 0, 4)
                    );
                    $nearStr = !empty($nearNames) ? ' Available AC scenes: ' . implode(', ', $nearNames) . '.' : '';
                    throw new InvalidArgumentException(
                        "No Tap-to-Run scene matches {$res['requestedTemp']}°C.{$nearStr}"
                    );
                }
            }
            if (!$resolved) {
                $needle = strtolower(trim($sceneName));
                foreach ($scenes as $sc) {
                    if (strtolower(trim((string)($sc['name'] ?? ''))) === $needle) {
                        $resolved = $sc;
                        break;
                    }
                }
                if (!$resolved) {
                    foreach ($scenes as $sc) {
                        if (str_contains(strtolower((string)($sc['name'] ?? '')), $needle)) {
                            $resolved = $sc;
                            break;
                        }
                    }
                }
            }
        }

        $targetSceneId = $resolved['id'] ?? $sceneId;
        $targetHomeId = $resolved['homeId'] ?? ($homeId !== '' ? $homeId : ($scenesDoc['homeId'] ?? ''));
        if ($targetSceneId === '' || $targetHomeId === '') {
            throw new InvalidArgumentException('Matching Smart Life scene not found. Click Sync Cloud first or specify an exact sceneId.');
        }

        TuyaClient::cloudTriggerHomeScene($cfg['tuya'], $targetHomeId, $targetSceneId);
        return [
            'ok' => true,
            'sceneId' => $targetSceneId,
            'homeId' => $targetHomeId,
            'name' => $resolved['name'] ?? $targetSceneId,
            'targetDevice' => $resolved['targetDevice'] ?? null,
            'parsedSummary' => $resolved['parsedSummary'] ?? null,
            'matchReason' => $matchMeta['matchReason'] ?? ($sceneId !== '' ? 'exact_id' : 'name')
        ];
    }

    private static function applyCastMediaStateToStore(StreamStore $store, string $deviceId, array $existingDev, array $mediaState): array
    {
        $app = is_array($mediaState['app'] ?? null) ? $mediaState['app'] : null;
        $ms = is_array($mediaState['mediaSession'] ?? null) ? $mediaState['mediaSession'] : null;
        $vol = is_array($mediaState['volume'] ?? null) ? $mediaState['volume'] : [];

        $status = 'IDLE';
        if ($ms !== null && !empty($ms['playerState'])) {
            $ps = strtoupper((string)$ms['playerState']);
            $status = ($ps === 'IDLE' && $app !== null) ? 'ACTIVE' : $ps;
        } elseif ($app !== null) {
            $status = 'ACTIVE';
        }

        $appId = $app['appId'] ?? null;
        $appName = $app['displayName'] ?? null;
        $mediaSnapshot = null;
        if ($ms !== null) {
            $mediaSnapshot = [
                'mediaSessionId' => $ms['mediaSessionId'] ?? null,
                'playerState' => $ms['playerState'] ?? 'UNKNOWN',
                'title' => $ms['title'] ?? '',
                'artist' => $ms['artist'] ?? '',
                'album' => $ms['album'] ?? '',
                'imageUrl' => $ms['imageUrl'] ?? '',
                'contentId' => $ms['contentId'] ?? '',
                'contentType' => $ms['contentType'] ?? '',
                'currentTime' => $ms['currentTime'] ?? 0.0,
                'duration' => $ms['duration'] ?? null,
                'canPause' => !empty($ms['canPause']),
                'canSeek' => !empty($ms['canSeek']),
                'canNext' => !empty($ms['canNext']),
                'canPrev' => !empty($ms['canPrev']),
                'updatedAt' => time()
            ];
        }

        $patch = [
            'online' => true,
            'status' => $status,
            'appId' => $appId ?: null,
            'appName' => $appName ?: null,
            'media' => $mediaSnapshot,
            'mediaSyncAt' => time(),
            'volume' => isset($vol['level']) ? round((float)$vol['level'], 2) : ($existingDev['volume'] ?? 0.7),
            'muted' => isset($vol['muted']) ? !empty($vol['muted']) : !empty($existingDev['muted'])
        ];
        if ($status === 'IDLE' || ($appId !== 'CC1AD845')) {
            $patch['activeStreamMode'] = null;
        }

        return $store->updateDevice($deviceId, $patch) ?? array_merge($existingDev, $patch);
    }

    public static function syncCastDevice(StreamStore $store, array $dev, float $timeoutSec = 2.0): array
    {
        $devId = (string)($dev['id'] ?? '');
        $cast = new CastV2();
        try {
            $cast->connect((string)$dev['host'], (int)$dev['port'], $timeoutSec);
            $mediaState = $cast->getMediaState(null, true);
            $cast->close();
            return self::applyCastMediaStateToStore($store, $devId, $dev, $mediaState);
        } catch (Throwable $ex) {
            $cast->close();
            throw $ex;
        }
    }

    public static function syncAllCastDevices(StreamStore $store, float $timeoutSec = 1.4, bool $onlyIfStale = false, int $staleSec = 5): array
    {
        $now = time();
        foreach ($store->getDevices() as $id => $dev) {
            if (array_key_exists('online', $dev) && !$dev['online']) {
                continue;
            }
            if ($onlyIfStale && ($now - (int)($dev['mediaSyncAt'] ?? 0)) < $staleSec) {
                continue;
            }
            try {
                self::syncCastDevice($store, $dev, $timeoutSec);
            } catch (Throwable $ex) {
                $store->updateDevice((string)$id, ['mediaSyncAt' => $now]);
            }
        }
        return array_values($store->getDevices());
    }

    private static function resolveCastTarget(StreamStore $store, string $deviceIdOrName): ?array
    {
        $devices = $store->getDevices();
        $needle = strtolower(trim($deviceIdOrName));

        foreach ($devices as $dev) {
            if (($dev['id'] ?? '') === $deviceIdOrName || strtolower(trim((string)($dev['name'] ?? ''))) === $needle) {
                return $dev;
            }
        }
        if ($needle !== '') {
            foreach ($devices as $dev) {
                if (str_contains(strtolower((string)($dev['name'] ?? '')), $needle)) {
                    return $dev;
                }
            }
        }

        $isAuto = ($needle === '' || in_array($needle, ['active', 'auto', 'current', 'playing', 'music', 'youtube', 'youtube music', 'media'], true));
        $catHint = '';
        if (preg_match('/\b(chromecast|tv|display)\b/', $needle)) {
            $catHint = 'display';
        } elseif (preg_match('/\b(nest|mini|speaker|speakers|home)\b/', $needle)) {
            $catHint = 'speaker';
        }

        if (!$isAuto && $catHint === '') {
            return null;
        }

        $freshDevices = self::syncAllCastDevices($store, 1.5, true, 3);
        $best = null;
        $bestScore = -1.0;

        foreach ($freshDevices as $dev) {
            if (array_key_exists('online', $dev) && !$dev['online']) {
                continue;
            }
            $kind = (string)($dev['kind'] ?? 'speaker');
            if ($catHint !== '' && $kind !== $catHint) {
                continue;
            }
            $score = 1.0;
            $st = strtoupper((string)($dev['status'] ?? 'IDLE'));
            if ($st === 'PLAYING') $score += 30.0;
            elseif ($st === 'BUFFERING') $score += 24.0;
            elseif ($st === 'PAUSED') $score += 20.0;
            elseif ($st === 'ACTIVE') $score += 12.0;

            if (!empty($dev['media']['mediaSessionId'])) {
                $score += 8.0;
            }
            if ($isAuto && $score <= 1.0) {
                // Skip completely idle devices when looking for "active" playback
                continue;
            }
            if ($score > $bestScore) {
                $bestScore = $score;
                $best = $dev;
            }
        }

        return $best;
    }

    public static function controlCast(
        StreamStore $store,
        string $deviceIdOrName,
        string $action,
        ?float $volume = null,
        ?bool $muted = null,
        array $mediaOpts = []
    ): array {
        $actionNorm = strtolower(trim($action));
        if ($actionNorm === 'resume') $actionNorm = 'play';
        if ($actionNorm === 'forward') $actionNorm = 'fast_forward';

        $target = self::resolveCastTarget($store, $deviceIdOrName);

        if (!$target) {
            return [
                'ok' => true,
                'clientSideRequired' => true,
                'clientAction' => [
                    'type' => 'cast_sdk',
                    'action' => $actionNorm,
                    'volume' => $volume,
                    'muted' => $muted,
                    'seconds' => $mediaOpts['seconds'] ?? null,
                    'positionSeconds' => $mediaOpts['position_seconds'] ?? null,
                    'target' => $deviceIdOrName
                ],
                'note' => 'No active local LAN Cast device matched; forwarded to active Chrome Cast SDK session if connected.'
            ];
        }

        $devId = (string)$target['id'];
        $cast = new CastV2();
        try {
            $cast->connect((string)$target['host'], (int)$target['port'], 4.0);
            if ($actionNorm === 'stop') {
                $cast->stopCurrentApp();
                $cast->close();
                $updated = $store->updateDevice($devId, [
                    'status' => 'IDLE',
                    'appId' => null,
                    'appName' => null,
                    'media' => null,
                    'activeStreamMode' => null,
                    'mediaSyncAt' => time()
                ]);
                return ['ok' => true, 'device' => $updated, 'action' => 'stop'];
            }
            if ($actionNorm === 'set_volume' || $actionNorm === 'mute' || $actionNorm === 'unmute') {
                $lvl = $volume !== null ? max(0.0, min(1.0, $volume > 1.0 ? ($volume / 100.0) : $volume)) : null;
                $m = $actionNorm === 'mute' ? true : ($actionNorm === 'unmute' ? false : $muted);
                $vol = $cast->setVolume($lvl, $m);
                $cast->close();
                $updated = $store->updateDevice($devId, [
                    'volume' => isset($vol['level']) ? round((float)$vol['level'], 2) : ($target['volume'] ?? 0.7),
                    'muted' => !empty($vol['muted'])
                ]);
                return ['ok' => true, 'device' => $updated, 'volume' => $vol];
            }
            if ($actionNorm === 'sync_status' || $actionNorm === '') {
                $mediaState = $cast->getMediaState(null, true);
                $cast->close();
                $updated = self::applyCastMediaStateToStore($store, $devId, $target, $mediaState);
                return [
                    'ok' => true,
                    'device' => $updated,
                    'app' => $mediaState['app'],
                    'media' => $mediaState['mediaSession']
                ];
            }

            $ctrlRes = $cast->controlMedia($actionNorm, $mediaOpts);
            $cast->close();
            $updated = self::applyCastMediaStateToStore($store, $devId, $target, $ctrlRes['state']);
            return [
                'ok' => true,
                'action' => $ctrlRes['action'],
                'device' => $updated,
                'app' => $ctrlRes['state']['app'] ?? null,
                'media' => $ctrlRes['mediaSession'] ?? null,
                'meta' => $ctrlRes['meta'] ?? []
            ];
        } catch (Throwable $ex) {
            $cast->close();
            throw $ex;
        }
    }
}
