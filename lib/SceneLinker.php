<?php
/**
 * Reads synced Smart Life Tap-to-Run scene configurations, decodes their target
 * devices & IR/DP parameters, persists/merges custom symbolic voice links, and
 * resolves natural voice/text commands to exact scene IDs.
 */
class SceneLinker
{
    public const CATALOG_VERSION = 2;

    private const AC_MODE_META = [
        0 => ['mode' => 'cool', 'en' => 'Cool', 'es' => 'Frío'],
        1 => ['mode' => 'heat', 'en' => 'Heat', 'es' => 'Calor'],
        2 => ['mode' => 'auto', 'en' => 'Auto', 'es' => 'Automático'],
        3 => ['mode' => 'fan',  'en' => 'Fan',  'es' => 'Ventilador'],
        4 => ['mode' => 'dry',  'en' => 'Dry',  'es' => 'Seco'],
        5 => ['mode' => 'jet',  'en' => 'Jet / Power Mode', 'es' => 'Modo Jet / Power']
    ];

    public static function foldText(string $str): string
    {
        $str = mb_strtolower(trim($str), 'UTF-8');
        if (class_exists('Normalizer')) {
            $norm = Normalizer::normalize($str, Normalizer::FORM_KD);
            if (is_string($norm)) {
                $str = preg_replace('/\p{Mn}+/u', '', $norm) ?? $norm;
            }
        }
        $str = strtr($str, [
            'á' => 'a', 'à' => 'a', 'ä' => 'a', 'ā' => 'a', 'â' => 'a',
            'é' => 'e', 'è' => 'e', 'ë' => 'e', 'ē' => 'e', 'ê' => 'e',
            'í' => 'i', 'ì' => 'i', 'ï' => 'i', 'ī' => 'i', 'î' => 'i',
            'ó' => 'o', 'ò' => 'o', 'ö' => 'o', 'ō' => 'o', 'ô' => 'o',
            'ú' => 'u', 'ù' => 'u', 'ü' => 'u', 'ū' => 'u', 'û' => 'u',
            'ñ' => 'n', 'ç' => 'c', '°' => ' '
        ]);
        $str = preg_replace('/\s+/', ' ', $str) ?? $str;
        return trim($str);
    }

    private static function normPhrase(string $str): string
    {
        $folded = self::foldText($str);
        $folded = preg_replace('/[^a-z0-9%+\-.\s]+/', ' ', $folded) ?? $folded;
        $folded = preg_replace('/\s+/', ' ', $folded) ?? $folded;
        return trim($folded);
    }

    private static function uniquePhrases(array $phrases): array
    {
        $seen = [];
        $out = [];
        foreach ($phrases as $p) {
            $clean = trim((string)$p);
            if ($clean === '') continue;
            $key = self::normPhrase($clean);
            if ($key === '' || isset($seen[$key])) continue;
            $seen[$key] = true;
            $out[] = $clean;
        }
        return $out;
    }

    private static function resolveDeviceAlias(string $rawPrefix, array $devices): ?array
    {
        $f = self::foldText($rawPrefix);
        if ($f === '') return null;

        if ($f === 'tv' || $f === 'tele' || $f === 'televisor') {
            return self::findDevByCategoryOrName($devices, ['ir_tv'], ['tv']);
        }
        if ($f === 'loudspeaker' || $f === 'parlante' || $f === 'speaker' || $f === 'edifier') {
            return self::findDevByCategoryOrName($devices, ['ir_audio'], ['edifier', 'loudspeaker']);
        }
        if ($f === 'aire' || $f === 'ac' || str_contains($f, 'thunder')) {
            return self::findDevByCategoryOrName($devices, ['ir_ac'], ['aire']);
        }
        if ($f === 'r-312' || $f === 'r312' || $f === 'purificador' || $f === 'purifier') {
            return self::findDevByCategoryOrName($devices, ['ir_purifier'], ['r-312']);
        }
        if ($f === 'a735' || $f === 'sa7335') {
            return self::findDevByCategoryOrName($devices, ['ir_fan'], ['sa7335']);
        }
        if ($f === 'fan 2' || $f === 'fan2' || $f === 'r-i_-2') {
            return self::findDevByCategoryOrName($devices, ['ir_fan'], ['r-i_-2']);
        }
        if ($f === 'fan') {
            return self::findDevByCategoryOrName($devices, ['ir_fan'], ['sa7335', 'r-i_-2']);
        }
        if (str_starts_with($f, 'lampara')) {
            if (preg_match('/lampara\s*([123])/', $f, $m)) {
                return self::findDevByCategoryOrName($devices, ['light'], ['lampara' . $m[1]]);
            }
            return ['id' => 'lights_group', 'name' => 'Lights Group', 'category' => 'light'];
        }
        if ($f === 'protocol' || str_contains($f, '5050')) {
            return ['id' => '5050_led', 'name' => '5050 LED / Protocol', 'category' => 'light'];
        }
        if ($f === 'fika' || $f === 'sh7p') {
            return self::findDevByCategoryOrName($devices, ['vacuum'], ['sh7p', 'fika']);
        }
        return null;
    }

    private static function findDevByCategoryOrName(array $devices, array $categories, array $nameNeedles): ?array
    {
        foreach ($devices as $dev) {
            $dName = self::foldText((string)($dev['name'] ?? ''));
            $dModel = self::foldText((string)($dev['model'] ?? ''));
            foreach ($nameNeedles as $needle) {
                if ($needle !== '' && (str_contains($dName, $needle) || str_contains($dModel, $needle))) {
                    return $dev;
                }
            }
        }
        foreach ($devices as $dev) {
            if (in_array($dev['category'] ?? '', $categories, true)) {
                return $dev;
            }
        }
        return null;
    }

    private static function parseAcKey(string $key): ?array
    {
        if (!preg_match('/^M(\d+)(?:_T(\d+))?_S(\d+)_(\d+)$/i', trim($key), $m)) {
            return null;
        }
        $modeCode = (int)$m[1];
        $meta = self::AC_MODE_META[$modeCode] ?? ['mode' => 'cool', 'en' => 'Mode ' . $modeCode, 'es' => 'Modo ' . $modeCode];
        $tempC = ($m[2] !== '') ? (int)$m[2] : null;
        $fanSpeed = (int)$m[3];
        $swing = (int)$m[4];

        return [
            'type' => 'ir_ac',
            'modeCode' => $modeCode,
            'mode' => $meta['mode'],
            'modeEn' => $meta['en'],
            'modeEs' => $meta['es'],
            'temp' => $tempC,
            'fanSpeed' => $fanSpeed,
            'swing' => $swing,
            'rawKey' => strtoupper($key)
        ];
    }

    private static function buildAcPhrases(array $ac, string $sceneName): array
    {
        $phrases = [];
        $mode = $ac['mode'];
        $temp = $ac['temp'];

        if ($mode === 'cool' && $temp !== null) {
            $phrases = array_merge($phrases, [
                "put the air conditioner on {$temp}",
                "set air conditioner to {$temp}",
                "set ac to {$temp} degrees",
                "ac {$temp}",
                "air conditioner {$temp}",
                "aire en {$temp}",
                "poner el aire en {$temp}",
                "pon el aire en {$temp}",
                "aire acondicionado {$temp} grados",
                "thunder {$temp}"
            ]);
        } elseif ($mode === 'dry') {
            $phrases = array_merge($phrases, [
                'put it on dry mode',
                'put the air conditioner on dry mode',
                'dry mode',
                'ac dry mode',
                'dehumidify mode',
                'aire en modo dry',
                'aire en modo seco',
                'modo seco',
                'deshumidificador'
            ]);
        } elseif ($mode === 'fan') {
            $phrases = array_merge($phrases, [
                'put the air conditioner on fan mode',
                'put it on fan mode',
                'ac fan mode',
                'ac fan only',
                'aire modo ventilador',
                'modo ventilador'
            ]);
        } elseif ($mode === 'heat') {
            $phrases = array_merge($phrases, [
                'put the air conditioner on heat mode',
                'put it on heat mode',
                'ac heat mode',
                'aire modo calor',
                'calefaccion',
                'modo calor'
            ]);
            if ($temp !== null) {
                $phrases[] = "ac heat {$temp}";
                $phrases[] = "aire calor {$temp}";
            }
        } elseif ($mode === 'auto') {
            $phrases = array_merge($phrases, [
                'put the air conditioner on auto mode',
                'put it on auto mode',
                'ac auto mode',
                'aire automatico',
                'modo automatico'
            ]);
        }

        $phrases[] = $sceneName;
        return $phrases;
    }

    private static function analyzeScene(array $sc, array $devicesById, array $allDevices, array $customEntry): array
    {
        $id = (string)($sc['id'] ?? '');
        $name = trim((string)($sc['name'] ?? $id));
        $homeId = (string)($sc['homeId'] ?? '');
        $actions = is_array($sc['actions'] ?? null) ? $sc['actions'] : [];
        $hasActions = !empty($actions);

        $targetDeviceId = '';
        $targetDeviceIds = [];
        $addTargetDev = static function (string $id) use (&$targetDeviceIds): void {
            $clean = trim($id);
            if ($clean !== '' && !in_array($clean, $targetDeviceIds, true)) {
                $targetDeviceIds[] = $clean;
            }
        };
        $targetDeviceName = '';
        $targetCategory = '';
        $summaryParts = [];
        $autoPhrases = [];
        $structuredIntent = null;

        // 1. Inspect Tuya actions[] payload
        if ($hasActions) {
            $actionDevices = [];
            foreach ($actions as $act) {
                if (!is_array($act)) continue;
                $exec = (string)($act['action_executor'] ?? '');
                $eid = (string)($act['entity_id'] ?? '');
                $prop = is_array($act['executor_property'] ?? null) ? $act['executor_property'] : [];

                $dev = $devicesById[$eid] ?? null;
                if ($dev) {
                    $dName = (string)($dev['name'] ?? $eid);
                    $actionDevices[$dName] = $dev;
                    $addTargetDev((string)($dev['id'] ?? $eid));
                    if ($targetDeviceName === '') {
                        $targetDeviceId = (string)($dev['id'] ?? $eid);
                        $targetDeviceName = $dName;
                        $targetCategory = (string)($dev['category'] ?? '');
                    }
                } elseif ($eid === '17135609') {
                    $dName = 'Lights Group';
                    $addTargetDev('17135609');
                    if ($targetDeviceName === '') {
                        $targetDeviceId = '17135609';
                        $targetDeviceName = $dName;
                        $targetCategory = 'light';
                    }
                } else {
                    $dName = $eid;
                }

                if ($exec === 'irIssueVii') {
                    $keyId = (string)($prop['keyId'] ?? '');
                    $rawKey = (string)($prop['key'] ?? '');
                    if ($keyId === 'ir_ac_self_def' && $rawKey !== '') {
                        $ac = self::parseAcKey($rawKey);
                        if ($ac !== null) {
                            $structuredIntent = $ac;
                            $tempStr = $ac['temp'] !== null ? " {$ac['temp']}°C" : '';
                            $summaryParts[] = "IR AC {$ac['modeEn']}{$tempStr} (fan={$ac['fanSpeed']}, {$ac['rawKey']})";
                            $autoPhrases = array_merge($autoPhrases, self::buildAcPhrases($ac, $name));
                            continue;
                        }
                    }
                    if ($keyId !== '') {
                        $summaryParts[] = "IR {$dName} keyId={$keyId}";
                        $structuredIntent = $structuredIntent ?? ['type' => 'ir_key', 'keyId' => $keyId];
                    }
                } elseif ($exec === 'dpIssue' || $exec === 'deviceGroupDpIssue') {
                    $kv = [];
                    foreach ($prop as $pk => $pv) {
                        if ($pk === 'bright_value_v2') {
                            $pct = max(1, min(100, (int)round(((int)$pv) / 10)));
                            $kv[] = "brightness={$pct}%";
                        } elseif ($pk === 'temp_value_v2') {
                            $pct = max(0, min(100, (int)round(((int)$pv) / 10)));
                            $kv[] = "temp={$pct}%";
                        } elseif ($pk === 'power_go') {
                            $kv[] = $pv ? 'start cleaning' : 'pause cleaning';
                            if ($targetCategory === 'vacuum') {
                                $structuredIntent = ['type' => 'vacuum_action', 'action' => $pv ? 'start_clean' : 'pause'];
                            }
                        } elseif ($pk === 'work_mode') {
                            $kv[] = "work_mode={$pv}";
                            $structuredIntent = $structuredIntent ?? ['type' => 'light_mode', 'mode' => (string)$pv];
                        } else {
                            $kv[] = $pk . '=' . (is_bool($pv) ? ($pv ? 'true' : 'false') : (string)$pv);
                        }
                    }
                    $summaryParts[] = "{$dName}: " . implode(', ', $kv);
                } elseif ($exec !== 'standardBatchControl') {
                    $summaryParts[] = "{$exec} -> {$dName}";
                }
            }
            if (count($actionDevices) > 1 && $targetCategory === 'light') {
                $targetDeviceName = implode(', ', array_keys($actionDevices));
            }
        }

        // 2. Parse structured scene name ("Device":Command[:Value] or keyword presets)
        $foldedName = self::foldText($name);

        if (preg_match('/^\s*"([^"]+)"\s*:\s*(.+)$/', $name, $nm)) {
            $prefix = trim($nm[1]);
            $suffix = trim($nm[2]);
            $resolvedFromPrefix = self::resolveDeviceAlias($prefix, $allDevices);
            if ($resolvedFromPrefix) {
                $addTargetDev((string)($resolvedFromPrefix['id'] ?? ''));
            }
            if ($targetDeviceName === '' && $resolvedFromPrefix) {
                $targetDeviceId = (string)($resolvedFromPrefix['id'] ?? '');
                $targetDeviceName = (string)($resolvedFromPrefix['name'] ?? $prefix);
                $targetCategory = (string)($resolvedFromPrefix['category'] ?? '');
            } elseif ($targetDeviceName === '') {
                $targetDeviceName = $prefix;
            }

            $sufFold = self::foldText($suffix);
            if ($sufFold === 'jetmode' || preg_match('/\bjet\s*mode\b/', $sufFold)) {
                // Smart Life stores AC Jet / Power Mode under the "R-312":jetmode IR scene
                $aireDev = self::resolveDeviceAlias('aire', $allDevices);
                if ($aireDev) {
                    $targetDeviceId = (string)($aireDev['id'] ?? $targetDeviceId);
                    $targetDeviceName = (string)($aireDev['name'] ?? 'Aire');
                    $targetCategory = (string)($aireDev['category'] ?? 'ir_ac');
                } else {
                    $targetDeviceName = 'Aire';
                    $targetCategory = 'ir_ac';
                }
                if (empty($summaryParts)) {
                    $summaryParts[] = "IR AC Jet / Power Mode (Turbo Cooling) via Smart Life scene {$name}";
                }
                if ($structuredIntent === null) {
                    $structuredIntent = [
                        'type' => 'ir_ac',
                        'modeCode' => 5,
                        'mode' => 'jet',
                        'modeEn' => 'Jet / Power Mode',
                        'modeEs' => 'Modo Jet / Power',
                        'temp' => null,
                        'fanSpeed' => 3,
                        'swing' => 0,
                        'rawKey' => 'jetmode'
                    ];
                }
            } elseif (empty($summaryParts)) {
                $summaryParts[] = ($targetDeviceName ?: $prefix) . " custom scene: {$suffix}";
            }

            // Map common Tuya sub-command names to natural voice inputs
            $devVoice = $targetDeviceName !== '' ? strtolower($targetDeviceName) : strtolower($prefix);
            $extraAliases = [$devVoice];
            if ($targetCategory === 'ir_audio') $extraAliases = ['edifier', 'speaker', 'speakers', 'parlante'];
            elseif ($targetCategory === 'ir_tv') $extraAliases = ['tv', 'television', 'tele'];
            elseif ($targetCategory === 'ir_fan') $extraAliases = ['fan', 'ventilador', strtolower($targetDeviceName)];
            elseif ($targetCategory === 'ir_purifier') $extraAliases = ['purifier', 'air purifier', 'purificador', 'r-312'];
            elseif ($targetCategory === 'ir_ac') $extraAliases = ['ac', 'air conditioner', 'aire'];

            if (str_contains($sufFold, 'poweroff') || str_ends_with($sufFold, ':0') || str_ends_with($sufFold, ':off')) {
                $structuredIntent = $structuredIntent ?? ['type' => 'ir_power', 'power' => false];
                foreach ($extraAliases as $al) {
                    $autoPhrases[] = "turn off {$al}";
                    $autoPhrases[] = "apagar {$al}";
                }
            } elseif (str_ends_with($sufFold, ':on') || str_ends_with($sufFold, ': 100')) {
                $structuredIntent = $structuredIntent ?? ['type' => 'ir_power', 'power' => true];
                foreach ($extraAliases as $al) {
                    $autoPhrases[] = "turn on {$al}";
                    $autoPhrases[] = "prender {$al}";
                }
            } elseif ($sufFold === 'power') {
                $structuredIntent = $structuredIntent ?? ['type' => 'ir_power_toggle'];
                foreach ($extraAliases as $al) {
                    $autoPhrases[] = "{$al} power";
                    $autoPhrases[] = "toggle {$al}";
                    $autoPhrases[] = "apagar {$al}";
                }
            } elseif ($sufFold === 'up' || $sufFold === 'volume_up' || $sufFold === 'higher') {
                $structuredIntent = $structuredIntent ?? ['type' => 'ir_step', 'dir' => 'up'];
                foreach ($extraAliases as $al) {
                    $autoPhrases[] = ($targetCategory === 'ir_fan') ? "{$al} speed up" : "{$al} volume up";
                    $autoPhrases[] = "subir {$al}";
                }
            } elseif ($sufFold === 'low' || $sufFold === 'volume down' || $sufFold === 'lower') {
                $structuredIntent = $structuredIntent ?? ['type' => 'ir_step', 'dir' => 'down'];
                foreach ($extraAliases as $al) {
                    $autoPhrases[] = ($targetCategory === 'ir_fan') ? "{$al} speed down" : "{$al} volume down";
                    $autoPhrases[] = "bajar {$al}";
                }
            } elseif ($sufFold === 'energysaving') {
                $autoPhrases = array_merge($autoPhrases, ['tv energy saving', 'tv eco mode', 'ahorro energia tv']);
            } elseif ($sufFold === 'homepage') {
                $autoPhrases = array_merge($autoPhrases, ['tv home', 'tv homepage', 'inicio tele']);
            } elseif ($sufFold === 'menu') {
                $autoPhrases = array_merge($autoPhrases, ['tv menu', 'menu de la tele']);
            } elseif ($sufFold === 'jetmode' || preg_match('/\bjet\s*mode\b/', $sufFold)) {
                $autoPhrases = array_merge($autoPhrases, [
                    'jetmode',
                    'jet mode',
                    'power mode',
                    'ac jet mode',
                    'ac power mode',
                    'air conditioner jet mode',
                    'air conditioner power mode',
                    'turn power mode on the air conditioner',
                    'turn on power mode',
                    'enable jetmode',
                    'enable power mode',
                    'ac turbo',
                    'turbo mode',
                    'aire power mode',
                    'aire jet mode',
                    'modo jet',
                    'modo power',
                    'modo turbo'
                ]);
            } elseif (preg_match('/brightness\s*:\s*(\d+%)/i', $suffix, $bm)) {
                $autoPhrases = array_merge($autoPhrases, ["lamps brightness {$bm[1]}", "set lights to {$bm[1]}", "luces al {$bm[1]}"]);
            } elseif (preg_match('/color\s*temp\s*:\s*0%/i', $suffix)) {
                $autoPhrases = array_merge($autoPhrases, ['warm lights', 'lamps warm white', 'luces calidas']);
            } elseif (preg_match('/color\s*temp\s*:\s*100%/i', $suffix)) {
                $autoPhrases = array_merge($autoPhrases, ['cool white lights', 'lamps cool white', 'luces frias']);
            } elseif (str_contains($sufFold, 'music sync')) {
                $autoPhrases = array_merge($autoPhrases, ['lamps music sync', 'lights music mode', 'luces musica']);
            } elseif (str_contains($sufFold, 'estado personalizado')) {
                $autoPhrases = array_merge($autoPhrases, ['aire estado personalizado', 'custom ac preset']);
            } else {
                $cleanCmd = trim(str_replace([':', '_'], ' ', $suffix));
                $autoPhrases[] = "{$devVoice} {$cleanCmd}";
                foreach ($extraAliases as $al) {
                    $autoPhrases[] = "{$al} {$cleanCmd}";
                }
            }
        }

        // Handle Thunder{temp} even if synced without actions[]
        if ($structuredIntent === null && preg_match('/\bthunder\s*(\d{2})\b/i', $name, $tm)) {
            $tVal = (int)$tm[1];
            $acAlias = self::findDevByCategoryOrName($allDevices, ['ir_ac'], ['aire']);
            if ($targetDeviceName === '' && $acAlias) {
                $targetDeviceId = (string)($acAlias['id'] ?? '');
                $targetDeviceName = (string)($acAlias['name'] ?? 'Aire');
                $targetCategory = 'ir_ac';
            }
            $structuredIntent = [
                'type' => 'ir_ac',
                'modeCode' => 0,
                'mode' => 'cool',
                'modeEn' => 'Cool',
                'modeEs' => 'Frío',
                'temp' => $tVal,
                'fanSpeed' => 1,
                'swing' => 0,
                'rawKey' => "M0_T{$tVal}_S1_0"
            ];
            if (empty($summaryParts)) {
                $summaryParts[] = "IR AC Cool {$tVal}°C (named scene {$name})";
            }
            $autoPhrases = array_merge($autoPhrases, self::buildAcPhrases($structuredIntent, $name));
        }

        // Specific well-known standalone scenes
        if ($foldedName === 'power off') {
            if ($targetDeviceName === '') {
                $acAlias = self::findDevByCategoryOrName($allDevices, ['ir_ac'], ['aire']);
                $targetDeviceId = (string)($acAlias['id'] ?? '');
                $targetDeviceName = $acAlias ? (string)$acAlias['name'] : 'Aire';
                $targetCategory = 'ir_ac';
            }
            $structuredIntent = $structuredIntent ?? ['type' => 'ir_power', 'power' => false];
            if (empty($summaryParts)) $summaryParts[] = 'Power Off IR scene (Aire / AC Off)';
            $autoPhrases = array_merge($autoPhrases, ['turn off the air conditioner', 'turn off ac', 'turn off aire', 'apagar el aire', 'power off']);
        } elseif ($foldedName === 'switch parlante') {
            if ($targetDeviceName === '') {
                $edAlias = self::findDevByCategoryOrName($allDevices, ['ir_audio'], ['edifier', 'loudspeaker']);
                $targetDeviceId = (string)($edAlias['id'] ?? '');
                $targetDeviceName = $edAlias ? (string)$edAlias['name'] : 'Edifier';
                $targetCategory = 'ir_audio';
            }
            $structuredIntent = $structuredIntent ?? ['type' => 'ir_power_toggle'];
            if (empty($summaryParts)) $summaryParts[] = 'Toggle Edifier Loudspeaker IR power';
            $autoPhrases = array_merge($autoPhrases, ['switch speaker', 'switch parlante', 'toggle edifier', 'turn off edifier', 'turn on edifier', 'apagar parlante', 'prender parlante']);
        } elseif ($foldedName === 'fika') {
            $autoPhrases = array_merge($autoPhrases, ['start fika', 'start robot vacuum', 'start cleaning', 'clean the house', 'iniciar fika', 'iniciar aspiradora']);
        } elseif ($foldedName === 'audioritmico') {
            $autoPhrases = array_merge($autoPhrases, ['music sync lights', 'lights music mode', 'audioritmico', 'modo musica luces']);
        } elseif ($foldedName === 'modo escena') {
            $autoPhrases = array_merge($autoPhrases, ['lights scene mode', 'modo escena luces']);
        } elseif ($foldedName === 'color' && $targetDeviceName !== '') {
            $autoPhrases = array_merge($autoPhrases, ['lights color mode', 'modo color luces']);
        } elseif ($foldedName === 'power' && $targetCategory === 'ir_tv') {
            $structuredIntent = $structuredIntent ?? ['type' => 'ir_power_toggle'];
            $autoPhrases = array_merge($autoPhrases, ['tv power', 'turn on tv', 'turn off tv', 'apagar tele', 'prender tele']);
        } elseif ($foldedName === 'power' && $targetCategory === 'ir_purifier') {
            $structuredIntent = $structuredIntent ?? ['type' => 'ir_power_toggle'];
            $autoPhrases = array_merge($autoPhrases, ['purifier power', 'turn on purifier', 'turn off purifier', 'r-312 power', 'apagar purificador', 'prender purificador']);
        } elseif ($foldedName === 'ahorro' && $targetCategory === 'ir_tv') {
            $autoPhrases = array_merge($autoPhrases, ['tv eco mode', 'tv energy saving', 'tv ahorro', 'ahorro tv']);
        } elseif ($foldedName === 'purificador' && $targetCategory === 'ir_purifier') {
            $autoPhrases = array_merge($autoPhrases, ['purifier mode', 'purificador']);
        } elseif ($foldedName === 'source' && $targetCategory === 'ir_purifier') {
            $autoPhrases = array_merge($autoPhrases, ['purifier source', 'r-312 source']);
        } elseif (preg_match('/^5050(on|off|up|down)$/', $foldedName, $m50)) {
            $targetDeviceName = $targetDeviceName ?: '5050 LED';
            $targetCategory = $targetCategory ?: 'light';
            $actWord = ['on' => 'turn on', 'off' => 'turn off', 'up' => 'brighten', 'down' => 'dim'][$m50[1]];
            $autoPhrases = array_merge($autoPhrases, ["{$actWord} 5050", "5050 {$m50[1]}"]);
        } elseif ($foldedName === 'swing') {
            $targetDeviceName = $targetDeviceName ?: 'Fan';
            $targetCategory = $targetCategory ?: 'ir_fan';
            $autoPhrases = array_merge($autoPhrases, ['fan swing', 'toggle swing', 'oscilacion ventilador']);
        } elseif ($foldedName === 'ion') {
            $targetDeviceName = $targetDeviceName ?: 'R-312';
            $targetCategory = $targetCategory ?: 'ir_purifier';
            $autoPhrases = array_merge($autoPhrases, ['purifier ionizer', 'ion mode', 'ionizador']);
        } elseif (is_numeric($name) && $name === '40') {
            $autoPhrases = array_merge($autoPhrases, ['scene 40', 'preset 40', 'lamps preset 40', 'escena 40']);
        } elseif ($foldedName === 'bright up' || $foldedName === 'red' || $foldedName === 'fireplace') {
            $targetDeviceId = $targetDeviceId ?: 'lights_group';
            $targetDeviceName = $targetDeviceName ?: 'Lights Group';
            $targetCategory = $targetCategory ?: 'light';
            $addTargetDev($targetDeviceId);
            if (empty($summaryParts)) $summaryParts[] = "Lighting scene preset: {$name}";
        } elseif ($foldedName === 'confort') {
            $acAlias = self::findDevByCategoryOrName($allDevices, ['ir_ac'], ['aire']);
            $targetDeviceId = (string)($acAlias['id'] ?? $targetDeviceId);
            $targetDeviceName = $acAlias ? (string)$acAlias['name'] : 'Aire';
            $targetCategory = $targetCategory ?: 'ir_ac';
            if ($targetDeviceId !== '') $addTargetDev($targetDeviceId);
            if (empty($summaryParts)) $summaryParts[] = "AC Comfort preset: {$name}";
        } elseif ($foldedName === 'lujuria') {
            $purAlias = self::findDevByCategoryOrName($allDevices, ['ir_purifier'], ['r-312']);
            $targetDeviceId = (string)($purAlias['id'] ?? $targetDeviceId);
            $targetDeviceName = $purAlias ? (string)$purAlias['name'] : 'R-312';
            $targetCategory = $targetCategory ?: 'ir_purifier';
            if ($targetDeviceId !== '') $addTargetDev($targetDeviceId);
            if (empty($summaryParts)) $summaryParts[] = "Purifier scene preset: {$name}";
        } elseif ($foldedName === 'knowhere') {
            $fan2Alias = self::findDevByCategoryOrName($allDevices, ['ir_fan'], ['r-i_-2']);
            $targetDeviceId = (string)($fan2Alias['id'] ?? 'knowhere');
            $targetDeviceName = $fan2Alias ? (string)$fan2Alias['name'] : 'Knowhere';
            $targetCategory = $targetCategory ?: 'ir_fan';
            $addTargetDev($targetDeviceId);
            if (empty($summaryParts)) $summaryParts[] = "Knowhere ambience / room scene";
        }

        if ($targetDeviceId !== '') {
            $addTargetDev($targetDeviceId);
        }

        $systemBus = 'ir';
        if ($targetCategory === 'vacuum' || $foldedName === 'fika') {
            $systemBus = 'vacuum';
        } elseif ($targetCategory === 'light' || $targetCategory === 'ble_light' || str_starts_with($foldedName, '5050') || str_contains($foldedName, 'lampara') || str_contains($foldedName, 'protocol')) {
            $systemBus = 'lights';
        } elseif ($targetCategory === 'ir_audio' || $targetCategory === 'ir_tv' || str_contains($foldedName, 'parlante') || str_contains($foldedName, 'loudspeaker') || $foldedName === 'knowhere') {
            $systemBus = ($targetCategory === 'ir_audio' || $foldedName === 'knowhere') ? 'cast' : 'ir';
        } elseif (str_starts_with($targetCategory, 'ir_')) {
            $systemBus = 'ir';
        }

        // Always associate the scene's own clean name & generic activation triggers so all 96 scenes work via voice
        $cleanSelf = trim(str_replace(['"', ':'], ' ', $name));
        $cleanSelf = preg_replace('/\s+/', ' ', $cleanSelf) ?? $cleanSelf;
        $autoPhrases[] = $name;
        if ($cleanSelf !== '' && strcasecmp($cleanSelf, $name) !== 0) {
            $autoPhrases[] = $cleanSelf;
        }
        $autoPhrases[] = "activate {$cleanSelf}";
        $autoPhrases[] = "run {$cleanSelf}";

        $parsedSummary = !empty($summaryParts)
            ? implode(' | ', $summaryParts)
            : ($targetDeviceName !== '' ? "{$targetDeviceName} scene ({$cleanSelf})" : "Tap-to-Run scene: {$cleanSelf}");

        $customPhrases = [];
        if (!empty($customEntry['voicePhrases']) && is_array($customEntry['voicePhrases'])) {
            foreach ($customEntry['voicePhrases'] as $cp) {
                $cp = trim((string)$cp);
                if ($cp !== '') $customPhrases[] = $cp;
            }
        }
        $notes = trim((string)($customEntry['notes'] ?? ''));

        $autoUnique = self::uniquePhrases($autoPhrases);
        $customUnique = self::uniquePhrases($customPhrases);
        $mergedVoice = self::uniquePhrases(array_merge($customUnique, $autoUnique));

        return [
            'id' => $id,
            'name' => $name,
            'homeId' => $homeId,
            'hasActions' => $hasActions,
            'targetDeviceId' => $targetDeviceId,
            'targetDeviceIds' => $targetDeviceIds,
            'targetDevice' => $targetDeviceName,
            'targetCategory' => $targetCategory,
            'systemBus' => $systemBus,
            'parsedSummary' => $parsedSummary,
            'structuredIntent' => $structuredIntent,
            'customPhrases' => $customUnique,
            'autoPhrases' => $autoUnique,
            'voiceCommands' => $mergedVoice,
            'notes' => $notes
        ];
    }

    public static function buildSceneLinks(StreamStore $store): array
    {
        $scenesDoc = $store->getSmartScenes();
        $devices = $store->getSmartDevicesPublic();
        $customDoc = $store->getSmartSceneLinks();
        $customById = is_array($customDoc['customBySceneId'] ?? null) ? $customDoc['customBySceneId'] : [];

        $devicesById = [];
        foreach ($devices as $dev) {
            if (!empty($dev['id'])) {
                $devicesById[(string)$dev['id']] = $dev;
            }
        }

        $links = [];
        foreach (($scenesDoc['scenes'] ?? []) as $sc) {
            if (!is_array($sc)) continue;
            if (isset($sc['enabled']) && !$sc['enabled']) continue;
            $sid = (string)($sc['id'] ?? '');
            if ($sid === '') continue;
            $links[] = self::analyzeScene($sc, $devicesById, $devices, is_array($customById[$sid] ?? null) ? $customById[$sid] : []);
        }

        return $links;
    }

    public static function syncCatalog(StreamStore $store): array
    {
        $links = self::buildSceneLinks($store);
        $catalog = [];
        foreach ($links as $item) {
            $catalog[$item['id']] = [
                'name' => $item['name'],
                'targetDevice' => $item['targetDevice'],
                'targetCategory' => $item['targetCategory'],
                'parsedSummary' => $item['parsedSummary'],
                'structuredIntent' => $item['structuredIntent'],
                'voiceCommands' => array_slice($item['voiceCommands'], 0, 12)
            ];
        }
        $store->updateSmartSceneGeneratedCatalog($catalog);
        return $links;
    }

    private static function extractAcIntentFromText(string $query, string $deviceHint = ''): ?array
    {
        $q = self::foldText($query);
        $dh = self::foldText($deviceHint);

        $mode = null;
        if (preg_match('/\b(dry|dehumidif\w*|modo seco|seco|deshumidificador)\b/', $q)) {
            $mode = 'dry';
        } elseif (preg_match('/\b(heat|heating|calor|calefaccion|incendio)\b/', $q)) {
            $mode = 'heat';
        } elseif (preg_match('/\b(fan mode|fan only|modo ventilador|ventilador)\b/', $q)) {
            $mode = 'fan';
        } elseif (preg_match('/\b(auto mode|modo automatico|automatico)\b/', $q)) {
            $mode = 'auto';
        } elseif (preg_match('/\b(jet\s*mode|power\s*mode|modo\s*jet|modo\s*power|turbo\s*mode|modo\s*turbo|ac\s*turbo|aire\s*turbo)\b/', $q)) {
            $mode = 'jet';
        } elseif (preg_match('/\b(cool|cooling|frio|thunder)\b/', $q)) {
            $mode = 'cool';
        }

        $temp = null;
        $hasAcContext = ($dh === 'aire' || $dh === 'ac' || $dh === 'ir_ac')
            || preg_match('/\b(ac|aire|air\s*condition\w*|acondicionador|thunder|clima|degrees?|grados?)\b/', $q) === 1;
        if ($mode === null && $hasAcContext && preg_match('/\b(turbo|jet)\b/', $q)) {
            $mode = 'jet';
        }

        if ($hasAcContext && preg_match('/\b(1[6-9]|2[0-9]|30)\b/', $q, $tm)) {
            $temp = (int)$tm[1];
        } elseif (preg_match('/\bthunder\s*(1[6-9]|2[0-9]|30)\b/', $q, $tm2)) {
            $temp = (int)$tm2[1];
            $hasAcContext = true;
        }

        // Unambiguous standalone AC mode keywords ("put it on dry mode", "modo seco")
        if ($mode === null && !$hasAcContext) {
            return null;
        }
        if ($mode === null && $temp === null) {
            return null;
        }
        // Only treat temperature-only phrases as AC intent when AC context is present
        if ($mode === 'fan' && !$hasAcContext && !preg_match('/\b(fan mode|fan only|modo ventilador)\b/', $q)) {
            return null;
        }

        return ['mode' => $mode, 'temp' => $temp, 'hasAcContext' => $hasAcContext];
    }

    private static function detectExplicitCategory(string $normQ): string
    {
        if ($normQ === '') return '';
        $patterns = [
            'ir_ac'       => '/\b(ac|aire|air\s*condition\w*|acondicionador|clima|thunder)\b/',
            'ir_tv'       => '/\b(tv|tele|televisor|television|apple\s*tv)\b/',
            'ir_purifier' => '/\b(purifier|purificador|r\s*312)\b/',
            'ir_audio'    => '/\b(edifier|speaker|speakers|parlante|altavoz|soundbar|audio)\b/',
            'vacuum'      => '/\b(vacuum|aspiradora|sh7p|robot)\b/',
            'ir_fan'      => '/\b(fan|fans|sa7335)\b/',
        ];
        foreach ($patterns as $cat => $rx) {
            if (preg_match($rx, $normQ)) {
                return $cat;
            }
        }
        return '';
    }

    public static function resolveSceneForCommand(StreamStore $store, string $query, string $deviceHint = ''): array
    {
        $links = self::buildSceneLinks($store);
        $rawQuery = trim($query);
        $normQ = self::normPhrase($rawQuery);
        $normHint = self::normPhrase($deviceHint);

        // 1. Exact sceneId
        if ($rawQuery !== '') {
            foreach ($links as $item) {
                if ($item['id'] === $rawQuery) {
                    return ['matched' => true, 'scene' => $item, 'matchReason' => 'exact_id', 'confidence' => 1.0];
                }
            }
        }

        // Score helper when multiple scenes share a phrase/name (e.g. duplicate "Power")
        $scoreCandidate = static function (array $item) use ($normHint, $normQ): float {
            $s = 1.0;
            $devNorm = self::normPhrase($item['targetDevice']);
            $catNorm = self::normPhrase($item['targetCategory']);
            if ($normHint !== '' && ($devNorm === $normHint || ($devNorm !== '' && str_contains($devNorm, $normHint)) || str_contains($catNorm, $normHint))) {
                $s += 2.0;
            }
            if ($devNorm !== '' && preg_match('/(?:^| )' . preg_quote($devNorm, '/') . '(?:$| )/', $normQ)) {
                $s += 1.5;
            }
            if ($item['hasActions']) {
                $s += 0.25;
            }
            return $s;
        };

        // 2. Exact match in user-defined customPhrases
        if ($normQ !== '') {
            $customHits = [];
            foreach ($links as $item) {
                foreach ($item['customPhrases'] as $cp) {
                    if (self::normPhrase($cp) === $normQ) {
                        $customHits[] = $item;
                        break;
                    }
                }
            }
            if (!empty($customHits)) {
                usort($customHits, static fn($a, $b) => $scoreCandidate($b) <=> $scoreCandidate($a));
                return ['matched' => true, 'scene' => $customHits[0], 'matchReason' => 'custom_phrase', 'confidence' => 1.0];
            }
        }

        // 3. Exact scene name match
        if ($normQ !== '') {
            $nameHits = [];
            foreach ($links as $item) {
                if (strcasecmp(trim($item['name']), $rawQuery) === 0 || self::normPhrase($item['name']) === $normQ) {
                    $nameHits[] = $item;
                }
            }
            if (!empty($nameHits)) {
                usort($nameHits, static fn($a, $b) => $scoreCandidate($b) <=> $scoreCandidate($a));
                return ['matched' => true, 'scene' => $nameHits[0], 'matchReason' => 'exact_name', 'confidence' => 1.0];
            }
        }

        // 4. Structured AC intent matching (e.g. "put the air conditioner on 18", "put it on dry mode", "air conditioner 24")
        $acIntent = self::extractAcIntentFromText($rawQuery, $deviceHint);
        if ($acIntent !== null) {
            $acScenes = array_values(array_filter($links, static fn($it) => ($it['structuredIntent']['type'] ?? '') === 'ir_ac'));
            $wantTemp = $acIntent['temp'];
            $wantMode = $acIntent['mode'];

            if ($wantTemp !== null) {
                $desiredMode = $wantMode ?? 'cool';
                foreach ($acScenes as $sc) {
                    $si = $sc['structuredIntent'];
                    if (($si['temp'] ?? null) === $wantTemp && ($si['mode'] ?? '') === $desiredMode) {
                        return ['matched' => true, 'scene' => $sc, 'matchReason' => 'ac_intent', 'confidence' => 0.98];
                    }
                }
                if ($wantMode === null) {
                    foreach ($acScenes as $sc) {
                        if (($sc['structuredIntent']['temp'] ?? null) === $wantTemp) {
                            return ['matched' => true, 'scene' => $sc, 'matchReason' => 'ac_intent', 'confidence' => 0.95];
                        }
                    }
                }
                // Exact temperature not found in scenes -> report nearest AC temperature scenes clearly
                $nearby = [];
                foreach ($acScenes as $sc) {
                    if (($sc['structuredIntent']['temp'] ?? null) !== null) {
                        $scTemp = (int)$sc['structuredIntent']['temp'];
                        $nearby[] = [
                            'id' => $sc['id'],
                            'name' => $sc['name'],
                            'temp' => $scTemp,
                            'mode' => $sc['structuredIntent']['mode'] ?? 'cool',
                            'diff' => abs($scTemp - $wantTemp)
                        ];
                    }
                }
                usort($nearby, static fn($a, $b) => $a['diff'] <=> $b['diff']);
                return [
                    'matched' => false,
                    'scene' => null,
                    'matchReason' => 'ac_temp_not_in_scenes',
                    'confidence' => 0.0,
                    'requestedTemp' => $wantTemp,
                    'nearbyCandidates' => $nearby
                ];
            }

            if ($wantMode !== null) {
                foreach ($acScenes as $sc) {
                    if (($sc['structuredIntent']['mode'] ?? '') === $wantMode) {
                        return ['matched' => true, 'scene' => $sc, 'matchReason' => 'ac_intent', 'confidence' => 0.98];
                    }
                }
            }
        }

        // 5. Exact or strong whole-word phrase/token match across associated voiceCommands
        if ($normQ !== '') {
            $scored = [];
            $qTokens = array_values(array_filter(explode(' ', $normQ), static fn($t) => strlen($t) >= 2));
            $explicitCat = self::detectExplicitCategory($normQ);

            foreach ($links as $item) {
                $itemCat = (string)($item['targetCategory'] ?? '');
                $bestScore = 0.0;
                foreach ($item['voiceCommands'] as $idx => $vc) {
                    $vcNorm = self::normPhrase($vc);
                    if ($vcNorm === '') continue;
                    $isCustom = $idx < count($item['customPhrases']);
                    $boost = $isCustom ? 1.2 : 1.0;

                    if ($vcNorm === $normQ) {
                        $bestScore = max($bestScore, 100.0 * $boost);
                        break;
                    }
                    $vcTokens = array_values(array_filter(explode(' ', $vcNorm), static fn($t) => strlen($t) >= 2));
                    if (count($vcTokens) >= 2 && preg_match('/(?:^| )' . preg_quote($vcNorm, '/') . '(?:$| )/', $normQ)) {
                        $bestScore = max($bestScore, (65.0 + min(30, strlen($vcNorm))) * $boost);
                    } elseif ((count($qTokens) >= 2 || strlen($normQ) >= 6) && preg_match('/(?:^| )' . preg_quote($normQ, '/') . '(?:$| )/', $vcNorm)) {
                        $bestScore = max($bestScore, (55.0 + min(30, strlen($normQ))) * $boost);
                    } elseif (count($vcTokens) === 1 && strlen($vcNorm) >= 6 && in_array($vcNorm, $qTokens, true)) {
                        $bestScore = max($bestScore, (48.0 + min(20, strlen($vcNorm))) * $boost);
                    } elseif (!empty($qTokens) && !empty($vcTokens)) {
                        $overlap = count(array_intersect($qTokens, $vcTokens));
                        $ratio = $overlap / max(count($vcTokens), count($qTokens));
                        if ($overlap >= 2 || ($overlap === 1 && count($vcTokens) === 1 && count($qTokens) === 1)) {
                            $bestScore = max($bestScore, ($ratio * 50.0) * $boost);
                        }
                    }
                }
                if ($explicitCat !== '' && $itemCat !== '' && $itemCat !== $explicitCat) {
                    // Prevent generic word overlap from selecting a conflicting device category
                    $bestScore -= 40.0;
                }
                if ($bestScore >= 32.0) {
                    $bestScore += $scoreCandidate($item) * 2.0;
                    $scored[] = ['score' => $bestScore, 'item' => $item];
                }
            }

            if (!empty($scored)) {
                usort($scored, static fn($a, $b) => $b['score'] <=> $a['score']);
                return [
                    'matched' => true,
                    'scene' => $scored[0]['item'],
                    'matchReason' => 'symbolic_phrase',
                    'confidence' => min(1.0, $scored[0]['score'] / 100.0)
                ];
            }
        }

        return ['matched' => false, 'scene' => null, 'matchReason' => 'none', 'confidence' => 0.0];
    }

    public static function matchIrRequestToScene(StreamStore $store, array $dev, array $irParams): array
    {
        $devName = (string)($dev['name'] ?? '');
        $devCat = (string)($dev['category'] ?? '');
        $links = self::buildSceneLinks($store);

        // 1. Air conditioner structured parameter lookup
        if ($devCat === 'ir_ac') {
            $power = $irParams['power'] ?? null;
            $hasTemp = isset($irParams['ac_temp']);
            $hasMode = !empty($irParams['ac_mode']);

            if ($power === false && !$hasTemp && !$hasMode) {
                $res = self::resolveSceneForCommand($store, 'power off', $devName);
                if (!empty($res['matched'])) return $res;
            }

            if ($hasTemp || $hasMode) {
                $wantTemp = $hasTemp ? (int)$irParams['ac_temp'] : null;
                $wantMode = $hasMode ? strtolower((string)$irParams['ac_mode']) : null;
                if ($wantMode === 'wind') $wantMode = 'fan';
                if ($wantMode === 'dehumidify') $wantMode = 'dry';
                if (in_array($wantMode, ['power', 'turbo', 'jetmode', 'powerful'], true)) {
                    $wantMode = 'jet';
                }

                $queryParts = ['air conditioner'];
                if ($wantMode !== null) $queryParts[] = "{$wantMode} mode";
                if ($wantTemp !== null) $queryParts[] = (string)$wantTemp;

                $res = self::resolveSceneForCommand($store, implode(' ', $queryParts), 'Aire');
                if (!empty($res['matched'])) return $res;
                if (($res['matchReason'] ?? '') === 'ac_temp_not_in_scenes') return $res;
            }
        }

        // 2. Non-AC IR devices (explicit power off or explicit button command)
        $cmd = trim((string)($irParams['ir_command'] ?? ''));
        if ($cmd !== '') {
            $res = self::resolveSceneForCommand($store, "{$devName} {$cmd}", $devName);
            if (!empty($res['matched'])) return $res;
        }

        if (isset($irParams['power']) && $irParams['power'] === false && $devCat !== 'ir_ac') {
            foreach ($links as $item) {
                if (($item['targetCategory'] ?? '') === $devCat && ($item['structuredIntent']['type'] ?? '') === 'ir_power' && ($item['structuredIntent']['power'] ?? null) === false) {
                    return ['matched' => true, 'scene' => $item, 'matchReason' => 'ir_exact_off', 'confidence' => 0.95];
                }
            }
        }

        // Collect all related scenes for this device to assist callers
        $related = [];
        foreach ($links as $item) {
            if (($item['targetCategory'] ?? '') === $devCat || strcasecmp($item['targetDevice'], $devName) === 0) {
                $related[] = [
                    'id' => $item['id'],
                    'name' => $item['name'],
                    'parsedSummary' => $item['parsedSummary']
                ];
            }
        }

        return [
            'matched' => false,
            'scene' => null,
            'matchReason' => 'no_exact_scene',
            'relatedScenes' => array_slice($related, 0, 15)
        ];
    }
}
