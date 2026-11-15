<?php
/**
 * OpenAI Smart House AI Agent (Realtime Voice + Responses API Reasoning Tool Calling + Audio Fallback)
 * Runs 100% in Pure PHP using cURL. Never leaks OPENAI_API_KEY to browser clients.
 */
class OpenAiAgent
{
    public const DEFAULT_CHAT_MODEL = 'gpt-6-luna';

    public const ALLOWED_CHAT_MODELS = [
        'gpt-6-luna',
        'gpt-6-astra',
        'gpt-6-sol',
        'gpt-6.1-sol',
        'gpt-6.1-terra',
        'gpt-4o-mini',
        'gpt-4o'
    ];

    public const DEFAULT_REASONING_EFFORT = 'low';

    public const ALLOWED_REASONING_EFFORTS = [
        'none',
        'low',
        'medium',
        'high',
        'xhigh'
    ];

    public const ALLOWED_REALTIME_MODELS = [
        'gpt-realtime-mini',
        'gpt-realtime',
        'gpt-realtime-2',
        'gpt-realtime-2.1',
        'gpt-realtime-2.1-mini',
        'gpt-realtime-1.5'
    ];

    public const ALLOWED_VOICES = [
        'verse',
        'alloy',
        'ash',
        'ballad',
        'coral',
        'echo',
        'sage',
        'shimmer'
    ];

    public static function resolveChatModel(array $cfgOpenAi = [], ?string $requested = null): string
    {
        $candidate = trim((string)($requested ?? ($cfgOpenAi['chatModel'] ?? self::DEFAULT_CHAT_MODEL)));
        if ($candidate !== '' && in_array($candidate, self::ALLOWED_CHAT_MODELS, true)) {
            return $candidate;
        }
        return self::DEFAULT_CHAT_MODEL;
    }

    public static function resolveReasoningEffort(array $cfgOpenAi = [], ?string $requested = null): string
    {
        $candidate = strtolower(trim((string)($requested ?? ($cfgOpenAi['reasoningEffort'] ?? self::DEFAULT_REASONING_EFFORT))));
        if ($candidate !== '' && in_array($candidate, self::ALLOWED_REASONING_EFFORTS, true)) {
            return $candidate;
        }
        return self::DEFAULT_REASONING_EFFORT;
    }

    private static function isReasoningModel(string $model): bool
    {
        $m = strtolower(trim($model));
        return str_starts_with($m, 'gpt-6') || str_starts_with($m, 'gpt-5') || preg_match('/^o[0-9]/', $m) === 1;
    }

    public static function resolveApiKey(StreamStore $store): string
    {
        $cfg = $store->getSmartConfig();
        $key = trim((string)($cfg['openai']['apiKey'] ?? ''));
        if ($key === '' && defined('OPENAI_API_KEY')) {
            $key = trim((string)OPENAI_API_KEY);
        }
        return $key;
    }

    private static function foldAscii(string $str): string
    {
        $str = mb_strtolower(trim($str), 'UTF-8');
        if (class_exists('Normalizer')) {
            $norm = Normalizer::normalize($str, Normalizer::FORM_KD);
            if (is_string($norm)) {
                $str = preg_replace('/\p{Mn}+/u', '', $norm) ?? $norm;
            }
        }
        $map = [
            'á' => 'a', 'à' => 'a', 'ä' => 'a', 'ā' => 'a', 'â' => 'a', 'ã' => 'a',
            'é' => 'e', 'è' => 'e', 'ë' => 'e', 'ē' => 'e', 'ê' => 'e',
            'í' => 'i', 'ì' => 'i', 'ï' => 'i', 'ī' => 'i', 'î' => 'i',
            'ó' => 'o', 'ò' => 'o', 'ö' => 'o', 'ō' => 'o', 'ô' => 'o', 'õ' => 'o',
            'ú' => 'u', 'ù' => 'u', 'ü' => 'u', 'ū' => 'u', 'û' => 'u',
            'ñ' => 'n', 'ç' => 'c'
        ];
        $str = strtr($str, $map);
        $str = preg_replace('/\s+/', ' ', $str) ?? $str;
        return trim($str);
    }

    private static function foldAlnum(string $str): string
    {
        $folded = self::foldAscii($str);
        return preg_replace('/[^a-z0-9]+/', '', $folded) ?? $folded;
    }

    private static function normalizeVoiceTarget(string $str): string
    {
        $folded = self::foldAscii($str);
        $wordMap = [
            '/\b(?:uno|una|one)\b/' => '1',
            '/\b(?:dos|two)\b/' => '2',
            '/\b(?:tres|three)\b/' => '3',
            '/\b(?:cuatro|four)\b/' => '4',
            '/\b(?:cinco|five)\b/' => '5',
        ];
        foreach ($wordMap as $rx => $num) {
            $folded = preg_replace($rx, $num, $folded) ?? $folded;
        }
        return preg_replace('/\s+/', ' ', trim($folded)) ?? $folded;
    }

    public static function summarizeSmartDeviceForAi(array $dev): array
    {
        $cat = (string)($dev['category'] ?? '');
        $summary = [
            'id' => (string)($dev['id'] ?? ''),
            'name' => (string)($dev['name'] ?? ($dev['id'] ?? '')),
            'platform' => (string)($dev['platform'] ?? ''),
            'category' => $cat,
            'online' => !empty($dev['online']),
            'power' => !empty($dev['power']),
        ];
        if (!empty($dev['tuyaCategory'])) {
            $summary['tuyaCategory'] = (string)$dev['tuyaCategory'];
        }
        if ($cat === 'light') {
            $summary['brightness'] = (int)($dev['brightness'] ?? 100);
            $summary['color'] = sprintf('#%02x%02x%02x', (int)($dev['r'] ?? 255), (int)($dev['g'] ?? 255), (int)($dev['b'] ?? 255));
            if (isset($dev['workMode'])) $summary['workMode'] = $dev['workMode'];
            if (isset($dev['temp'])) $summary['temp'] = (int)$dev['temp'];
        } else {
            if (isset($dev['battery']) && $dev['battery'] !== null) $summary['battery'] = $dev['battery'];
            if (!empty($dev['vacuumMode'])) $summary['vacuumMode'] = $dev['vacuumMode'];
            if (isset($dev['vacuumCleaning'])) $summary['vacuumCleaning'] = (bool)$dev['vacuumCleaning'];
        }
        return $summary;
    }

    private static function listTargetHints(array $allSmart, array $preferredCategories = []): array
    {
        $hints = [];
        foreach ($allSmart as $dev) {
            if (!empty($preferredCategories) && !in_array($dev['category'] ?? '', $preferredCategories, true)) {
                continue;
            }
            $hints[] = [
                'id' => (string)($dev['id'] ?? ''),
                'name' => (string)($dev['name'] ?? ''),
                'category' => (string)($dev['category'] ?? '')
            ];
        }
        return array_slice($hints, 0, 20);
    }

    public static function resolveSmartDevice(array $allSmart, string $target, array $preferredCategories = []): ?array
    {
        $rawTarget = trim($target);
        $needle = self::normalizeVoiceTarget($rawTarget);
        if ($needle === '') return null;

        // 1. Exact ID match
        if (isset($allSmart[$rawTarget])) {
            return $allSmart[$rawTarget];
        }

        // 2. Exact name match (accent-insensitive + voice number normalized)
        foreach ($allSmart as $dev) {
            $dNorm = self::normalizeVoiceTarget((string)($dev['name'] ?? ''));
            if ($dNorm === $needle) {
                return $dev;
            }
        }

        // 3. Separator-stripped alphanumeric match (e.g. "lampara 1" == "Lámpara1", "r312" == "R-312", "ri2" == "R-I_-2")
        $alnumNeedle = self::foldAlnum($needle);
        $lampAltAlnum = '';
        if (preg_match('/^(?:lamp|light|luz|bulb|foco|lamparita|lampara)\s*([0-9]+)$/', $needle, $lm)) {
            $lampAltAlnum = 'lampara' . $lm[1];
        }
        foreach ($allSmart as $dev) {
            $dAlnum = self::foldAlnum((string)($dev['name'] ?? ''));
            if ($dAlnum === '') continue;
            if ($dAlnum === $alnumNeedle || ($lampAltAlnum !== '' && $dAlnum === $lampAltAlnum)) {
                return $dev;
            }
        }

        // 4. Semantic alias mapping (English + Spanish room/device synonyms)
        $aliasCategories = [];
        if (preg_match('/\b(air\s*cond|a\/c|ac|aire|clima|split|climatizador|calefactor|cooler)\b/', $needle)) {
            $aliasCategories[] = 'ir_ac';
        } elseif (preg_match('/\b(speaker|speakers|parlante|parlantes|altavoz|altavoces|amplifier|amp|amplificador|edifier|soundbar|audio|stereo|musica)\b/', $needle)) {
            $aliasCategories[] = 'ir_audio';
        } elseif (preg_match('/\b(tv|television|tele|smart\s*tv|pantalla)\b/', $needle)) {
            $aliasCategories[] = 'ir_tv';
        } elseif (preg_match('/\b(vacuum|robot|aspiradora|barredora|roomba|sh7p|sh\s*7p)\b/', $needle)) {
            $aliasCategories[] = 'vacuum';
        } elseif (preg_match('/\b(purifier|purificador|air\s*purifier|r312)\b/', $needle)) {
            $aliasCategories[] = 'ir_purifier';
        } elseif (preg_match('/\b(fan|fans|ventilador|ventiladores|sa7335|sa\s*7335|ri2)\b/', $needle)) {
            $aliasCategories[] = 'ir_fan';
        } elseif (preg_match('/\b(ceiling|techo|cielo|magic\s*home|tira\s*led|led\s*strip)\b/', $needle)) {
            if (empty($preferredCategories) || in_array('light', $preferredCategories, true)) {
                foreach ($allSmart as $dev) {
                    if (($dev['platform'] ?? '') === 'magichome') {
                        return $dev;
                    }
                }
            }
        }

        // 5. Partial substring & word-boundary match (prevent tiny names like "IR" matching inside unrelated words)
        $candidates = [];
        foreach ($allSmart as $dev) {
            $dNorm = self::normalizeVoiceTarget((string)($dev['name'] ?? ''));
            $dAlnum = self::foldAlnum($dNorm);
            $dCat = (string)($dev['category'] ?? '');
            $dLen = strlen($dAlnum);
            $nLen = strlen($alnumNeedle);

            $needleInDev = ($nLen >= 3 && (($dNorm !== '' && str_contains($dNorm, $needle)) || ($dAlnum !== '' && str_contains($dAlnum, $alnumNeedle))))
                || ($lampAltAlnum !== '' && $dAlnum !== '' && str_contains($dAlnum, $lampAltAlnum));
            $devInNeedle = false;
            if ($dNorm !== '' && $dLen >= 2) {
                if (preg_match('/(?<![a-z0-9])' . preg_quote($dNorm, '/') . '(?![a-z0-9])/', $needle)) {
                    $devInNeedle = true;
                } elseif ($dLen >= 4 && $nLen >= 4 && str_contains($alnumNeedle, $dAlnum)) {
                    $devInNeedle = true;
                }
            }
            $catHit = !empty($aliasCategories) && in_array($dCat, $aliasCategories, true);
            if ($needleInDev || $devInNeedle || $catHit) {
                $candidates[] = $dev;
            }
        }
        if (count($candidates) === 1) {
            return $candidates[0];
        }
        if (count($candidates) > 1 && !empty($preferredCategories)) {
            foreach ($candidates as $cand) {
                if (in_array($cand['category'] ?? '', $preferredCategories, true)) {
                    return $cand;
                }
            }
        }
        if (!empty($candidates)) {
            return $candidates[0];
        }

        // 6. Fuzzy Levenshtein fallback for minor STT misspellings on alnum >= 4 chars
        if (strlen($alnumNeedle) >= 4) {
            $best = null;
            $bestDist = 99;
            foreach ($allSmart as $dev) {
                if (!empty($preferredCategories) && !in_array($dev['category'] ?? '', $preferredCategories, true)) {
                    continue;
                }
                $dAlnum = self::foldAlnum((string)($dev['name'] ?? ''));
                if ($dAlnum === '') continue;
                $maxAllowed = max(1, min(2, (int)floor(strlen($dAlnum) / 4)));
                $dist = levenshtein($alnumNeedle, $dAlnum);
                if ($dist <= $maxAllowed && $dist < $bestDist) {
                    $bestDist = $dist;
                    $best = $dev;
                }
            }
            if ($best !== null) {
                return $best;
            }
        }

        return null;
    }

    public static function getToolDefinitions(): array
    {
        return [
            [
                'name' => 'list_smart_home_devices',
                'description' => 'Return the live status and capabilities of all Wi-Fi smart lights, robot vacuum, IR remotes (AC, speakers, TV, fans, air purifier), Google Cast speakers/displays, Bluetooth BLE lights, and Tuya Tap-to-Run scenes.',
                'parameters' => [
                    'type' => 'object',
                    'properties' => (object)[]
                ]
            ],
            [
                'name' => 'control_smart_light',
                'description' => 'Control any Wi-Fi smart light (Tuya lamps like Lampara1/2/3, Magic Home like Cielo) or ALL lights at once. Supports power on/off, brightness 1-100%, RGB/hex color, warm-to-cool white color temperature 0-100%, Magic Home effects, and auto-off countdown timers.',
                'parameters' => [
                    'type' => 'object',
                    'properties' => [
                        'target' => [
                            'type' => 'string',
                            'description' => 'Device name or ID (e.g. "Lámpara1", "Cielo"), or "all_lights" to control all Wi-Fi lights.'
                        ],
                        'power' => ['type' => 'boolean', 'description' => 'Turn light on (true) or off (false).'],
                        'brightness' => ['type' => 'integer', 'description' => 'Brightness percentage from 1 to 100.'],
                        'color_hex' => ['type' => 'string', 'description' => 'Hex RGB color such as "#ff4500" or "#38bdf8".'],
                        'color_temp_pct' => ['type' => 'integer', 'description' => 'White color temperature percentage: 0 = warmest amber, 50 = neutral white, 100 = coolest daylight white.'],
                        'preset' => ['type' => 'integer', 'description' => 'Magic Home effect preset ID (37=7-Color Fade, 38=Red Pulse, 41=7-Color Strobe, 56=7-Color Jump).'],
                        'countdown_seconds' => ['type' => 'integer', 'description' => 'Tuya auto turn-off timer in seconds (0 to cancel, e.g. 1800 for 30 minutes).']
                    ],
                    'required' => ['target']
                ]
            ],
            [
                'name' => 'control_robot_vacuum',
                'description' => 'Send a movement or power command to the robot vacuum (e.g. Sh7p). ONLY use when explicitly asked to clean, pause, mop, dock, or power on/off; NEVER call this just to check battery or status (use list_smart_home_devices for status/battery).',
                'parameters' => [
                    'type' => 'object',
                    'properties' => [
                        'target' => ['type' => 'string', 'description' => 'Vacuum device name or ID (default "Sh7p").'],
                        'action' => [
                            'type' => 'string',
                            'enum' => ['start_clean', 'pause', 'dock', 'mop', 'smart_clean', 'power_on', 'power_off'],
                            'description' => 'Cleaning or docking command to execute.'
                        ]
                    ],
                    'required' => ['action']
                ]
            ],
            [
                'name' => 'control_ir_device',
                'description' => 'Control Smart Life IR remote virtual devices such as Air Conditioner (Aire), Edifier Speakers (Edifier), TV, Fans (SA7335, R-I_-2), and Air Purifier (R-312). Sends PowerOff/PowerOn/Power, volume, channel, speed, or AC temperature/mode/fan.',
                'parameters' => [
                    'type' => 'object',
                    'properties' => [
                        'target' => ['type' => 'string', 'description' => 'IR device name or ID (e.g. "Aire", "Edifier", "TV", "SA7335", "R-312").'],
                        'power' => ['type' => 'boolean', 'description' => 'Power state true=on, false=off (maps to PowerOn/PowerOff or Power depending on device).'],
                        'command' => ['type' => 'string', 'description' => 'Specific IR button code from device spec, e.g. PowerOff, PowerOn, Power, Volume+, Volume-, Play, Pause, Next, Previous, Channel+, Channel-, Menu, Home, Speed, Swing, Auto, Sleep.'],
                        'ac_temp' => ['type' => 'integer', 'description' => 'AC target temperature 16..30 C (only for Aire AC).'],
                        'ac_mode' => ['type' => 'string', 'enum' => ['cool', 'heat', 'auto', 'fan', 'dry'], 'description' => 'AC operating mode.'],
                        'ac_fan' => ['type' => 'string', 'enum' => ['auto', 'low', 'mid', 'high'], 'description' => 'AC fan speed.']
                    ],
                    'required' => ['target']
                ]
            ],
            [
                'name' => 'trigger_tuya_scene',
                'description' => 'Run an existing Smart Life Tap-to-Run Smart Scene by scene_id, scene_name, or natural voice command/symbolic link (e.g. "Thunder18" / "air conditioner on 18", "Dry" / "dry mode", "Power Off", "Switch Parlante", "FIKA", or any scene voiceLink). Supports device_hint to disambiguate identically named scenes such as "Power".',
                'parameters' => [
                    'type' => 'object',
                    'properties' => [
                        'scene_id' => ['type' => 'string', 'description' => 'Exact Tuya scene_id from tapToRunScenes (preferred whenever known).'],
                        'scene_name' => ['type' => 'string', 'description' => 'Exact scene name or associated voice command phrase (e.g. "Thunder18", "Dry", "dry mode", "air conditioner 18", "Power Off", "Switch Parlante").'],
                        'device_hint' => ['type' => 'string', 'description' => 'Optional target device name (e.g. "Aire", "TV", "R-312", "Edifier") to disambiguate scenes.']
                    ]
                ]
            ],
            [
                'name' => 'control_tuya_raw_dps',
                'description' => 'Send custom Tuya IoT command DPS array [{code, value}] directly to any Tuya device for specialized controls.',
                'parameters' => [
                    'type' => 'object',
                    'properties' => [
                        'target' => ['type' => 'string', 'description' => 'Tuya device name or ID.'],
                        'commands' => [
                            'type' => 'array',
                            'description' => 'List of Tuya {code, value} command objects.',
                            'items' => [
                                'type' => 'object',
                                'properties' => [
                                    'code' => ['type' => 'string'],
                                    'value' => ['description' => 'DP value matching the device function type (string, integer, or boolean).']
                                ],
                                'required' => ['code', 'value']
                            ]
                        ]
                    ],
                    'required' => ['target', 'commands']
                ]
            ],
            [
                'name' => 'control_google_cast',
                'description' => 'Control Google Nest speakers (any variant: Nest Mini, Nest Audio, Nest Hub, Cast Groups like Knowhere) or Chromecast / Google TV displays (like Alice) — search the internet with gpt-6-luna and play any album, song, artist, playlist, video, or radio station directly on the device (action="play_web_media" with query, e.g. "latest Wiz Khalifa album"), play/resume, pause, toggle play/pause, rewind, fast-forward, seek, next/previous track, stop playback, quit app, adjust volume (set_volume, volume_up, volume_down, mute, unmute, toggle_mute), speak/announce a voice message out loud on the speaker/TV (action="announce" with text), play ambient relaxation sounds (action="play_preset" with preset), play a direct media URL (action="play_url" with url), launch an app (action="launch_app" with app="youtube"|"youtube_music"|"spotify"|"netflix"|"relaxing_sounds"|"backdrop"), or sync live Now Playing status.',
                'parameters' => [
                    'type' => 'object',
                    'properties' => [
                        'target' => ['type' => 'string', 'description' => 'Cast device name or ID (e.g. "Rabbit", "Alice", "Knowhere"), "nest" / "speaker", "chromecast" / "tv", "group" / "everywhere", or "active" to auto-target the currently playing/active device.'],
                        'action' => [
                            'type' => 'string',
                            'enum' => [
                                'play_web_media', 'play', 'pause', 'toggle_play_pause', 'rewind', 'fast_forward', 'seek', 'restart',
                                'previous', 'next', 'stop_media', 'stop', 'set_volume', 'volume_up', 'volume_down',
                                'mute', 'unmute', 'toggle_mute', 'sync_status', 'announce', 'play_preset', 'play_url', 'launch_app'
                            ]
                        ],
                        'query' => ['type' => 'string', 'description' => 'Natural-language search query for any album, song, artist, playlist, video, or radio station on the internet when action="play_web_media" (e.g. "latest Wiz Khalifa album", "Wiz Khalifa Cool", "Daft Punk Random Access Memories", "Lo-Fi Hip Hop radio"). Resolved live via gpt-6-luna web search and played directly on the Chromecast or Google Nest device.'],
                        'seconds' => ['type' => 'number', 'description' => 'Seconds to rewind or fast_forward (defaults to 15 seconds if omitted).'],
                        'position_seconds' => ['type' => 'number', 'description' => 'Target playback position in seconds when action is seek.'],
                        'volume_pct' => ['type' => 'integer', 'description' => 'Volume percentage 0..100 when action is set_volume.'],
                        'text' => ['type' => 'string', 'description' => 'Message text to speak out loud on the Google Nest or Chromecast when action="announce".'],
                        'preset' => [
                            'type' => 'string',
                            'enum' => ['country_night', 'rain', 'ocean', 'thunderstorm', 'fireplace', 'forest', 'running_water', 'white_noise'],
                            'description' => 'Ambient sound preset to play when action="play_preset".'
                        ],
                        'url' => ['type' => 'string', 'description' => 'Direct audio/video stream URL (http/https) when action="play_url".'],
                        'title' => ['type' => 'string', 'description' => 'Optional media title when action="play_url".'],
                        'app' => [
                            'type' => 'string',
                            'description' => 'App to open on Chromecast / Google TV / Nest Display when action="launch_app" (e.g. "youtube", "youtube_music", "spotify", "netflix", "relaxing_sounds", "backdrop").'
                        ]
                    ],
                    'required' => ['action']
                ]
            ],
            [
                'name' => 'control_ble_light',
                'description' => 'Control a paired browser Web Bluetooth BLE smart LED light.',
                'parameters' => [
                    'type' => 'object',
                    'properties' => [
                        'target' => ['type' => 'string', 'description' => 'Bluetooth LED name or ID, or "all".'],
                        'power' => ['type' => 'boolean'],
                        'brightness' => ['type' => 'integer'],
                        'color_hex' => ['type' => 'string']
                    ],
                    'required' => ['target']
                ]
            ],
            [
                'name' => 'batch_smart_actions',
                'description' => 'Execute multiple smart home actions sequentially in a single call (for scenes or multi-device requests like "turn off everything" or "movie mode").',
                'parameters' => [
                    'type' => 'object',
                    'properties' => [
                        'actions' => [
                            'type' => 'array',
                            'items' => [
                                'type' => 'object',
                                'properties' => [
                                    'tool' => [
                                        'type' => 'string',
                                        'enum' => [
                                            'control_smart_light',
                                            'control_robot_vacuum',
                                            'control_ir_device',
                                            'trigger_tuya_scene',
                                            'control_tuya_raw_dps',
                                            'control_google_cast',
                                            'control_ble_light'
                                        ]
                                    ],
                                    'arguments' => ['type' => 'object']
                                ],
                                'required' => ['tool', 'arguments']
                            ]
                        ]
                    ],
                    'required' => ['actions']
                ]
            ]
        ];
    }

    public static function getResponsesTools(): array
    {
        $out = [];
        foreach (self::getToolDefinitions() as $def) {
            $out[] = [
                'type' => 'function',
                'name' => $def['name'],
                'description' => $def['description'],
                'parameters' => $def['parameters']
            ];
        }
        return $out;
    }

    private static function getReasonerToolDefinition(): array
    {
        return [
            'type' => 'function',
            'name' => 'ask_smart_reasoner',
            'description' => 'Delegate complex, analytical, multi-step, troubleshooting, conditional, planning, or detailed explanation requests to Treva\'s deeper reasoning engine (gpt-6-luna). Use this when a user asks why something happened, asks to compare devices/scenes, requests diagnostics, asks open-ended smart-home questions, or needs thoughtful multi-step orchestration rather than a simple single-device toggle.',
            'parameters' => [
                'type' => 'object',
                'properties' => [
                    'request' => [
                        'type' => 'string',
                        'description' => 'The user\'s complete complex question or multi-step request, including relevant context.'
                    ],
                    'allow_device_actions' => [
                        'type' => 'boolean',
                        'description' => 'Set true only when the user explicitly asked to change devices or trigger scenes; false for pure questions, comparisons, or diagnostics.'
                    ]
                ],
                'required' => ['request']
            ]
        ];
    }

    public static function getRealtimeTools(): array
    {
        $out = self::getResponsesTools();
        $out[] = self::getReasonerToolDefinition();
        return $out;
    }

    public static function getChatTools(): array
    {
        $out = [];
        foreach (self::getToolDefinitions() as $def) {
            $out[] = [
                'type' => 'function',
                'function' => $def
            ];
        }
        return $out;
    }

    public static function buildSmartHomeSnapshot(StreamStore $store, array $clientContext = []): array
    {
        $smartPublic = $store->getSmartDevicesPublic();
        $scenesDoc = $store->getSmartScenes();
        $castDevs = NetworkHelper::isLocalEnvironment() ? array_values($store->getDevices()) : [];

        $lights = [];
        $irDevices = [];
        $others = [];
        foreach ($smartPublic as $d) {
            $cat = (string)($d['category'] ?? '');
            $tcat = (string)($d['tuyaCategory'] ?? '');
            $summary = [
                'id' => $d['id'],
                'name' => $d['name'] ?? $d['id'],
                'platform' => $d['platform'] ?? '',
                'category' => $cat,
                'tuyaCategory' => $tcat,
                'online' => !empty($d['online']),
                'power' => !empty($d['power']),
            ];
            if ($cat === 'light') {
                $summary['brightness'] = $d['brightness'] ?? 100;
                $summary['color'] = sprintf('#%02x%02x%02x', (int)($d['r'] ?? 255), (int)($d['g'] ?? 255), (int)($d['b'] ?? 255));
                if (isset($d['workMode'])) $summary['workMode'] = $d['workMode'];
                if (isset($d['temp'])) $summary['temp'] = $d['temp'];
                $lights[] = $summary;
            } elseif (str_starts_with($tcat, 'infrared_') || str_starts_with($cat, 'ir_')) {
                $fnCodes = [];
                foreach (($d['functions'] ?? []) as $fn) {
                    if (!empty($fn['code'])) $fnCodes[] = $fn['code'];
                }
                $summary['functions'] = $fnCodes;
                $irDevices[] = $summary;
            } else {
                if (isset($d['battery']) && $d['battery'] !== null) $summary['battery'] = $d['battery'];
                if (!empty($d['vacuumMode'])) $summary['vacuumMode'] = $d['vacuumMode'];
                if (isset($d['vacuumCleaning'])) $summary['vacuumCleaning'] = (bool)$d['vacuumCleaning'];
                $fnCodes = [];
                foreach (($d['functions'] ?? []) as $fn) {
                    if (!empty($fn['code'])) $fnCodes[] = $fn['code'];
                }
                if (!empty($fnCodes)) $summary['functions'] = $fnCodes;
                $others[] = $summary;
            }
        }

        $sceneSummaries = [];
        if (class_exists('SceneLinker')) {
            foreach (SceneLinker::buildSceneLinks($store) as $sc) {
                $entry = [
                    'id' => $sc['id'],
                    'name' => $sc['name'],
                    'config' => $sc['parsedSummary'],
                    'voiceLinks' => array_slice($sc['voiceCommands'], 0, 8)
                ];
                if ($sc['targetDevice'] !== '') {
                    $entry['device'] = $sc['targetDevice'];
                }
                if ($sc['notes'] !== '') {
                    $entry['notes'] = $sc['notes'];
                }
                $sceneSummaries[] = $entry;
            }
        } else {
            foreach (array_slice($scenesDoc['scenes'] ?? [], 0, 200) as $sc) {
                if (!empty($sc['enabled']) || !isset($sc['enabled'])) {
                    $sceneSummaries[] = [
                        'id' => $sc['id'] ?? '',
                        'name' => $sc['name'] ?? ''
                    ];
                }
            }
        }

        return [
            'home' => [
                'homeId' => $scenesDoc['homeId'] ?? '',
                'homeName' => $scenesDoc['homeName'] ?? ''
            ],
            'lights' => $lights,
            'irRemotes' => $irDevices,
            'vacuumsAndSwitches' => $others,
            'googleCast' => array_map(static function ($c) {
                $media = is_array($c['media'] ?? null) ? $c['media'] : null;
                return [
                    'id' => $c['id'] ?? '',
                    'name' => $c['name'] ?? '',
                    'model' => $c['model'] ?? '',
                    'kind' => $c['kind'] ?? 'speaker',
                    'status' => $c['status'] ?? 'IDLE',
                    'appName' => $c['appName'] ?? null,
                    'media' => $media ? [
                        'playerState' => $media['playerState'] ?? '',
                        'title' => $media['title'] ?? '',
                        'artist' => $media['artist'] ?? '',
                        'currentTime' => $media['currentTime'] ?? 0,
                        'duration' => $media['duration'] ?? null
                    ] : null,
                    'volume' => isset($c['volume']) ? round((float)$c['volume'] * 100) : null,
                    'muted' => !empty($c['muted'])
                ];
            }, NetworkHelper::isLocalEnvironment() ? SmartController::syncAllCastDevices($store, 1.0, true, 5) : $castDevs),
            'activeCastSdk' => $clientContext['castSdk'] ?? null,
            'bleLights' => $clientContext['bleDevices'] ?? [],
            'tapToRunScenes' => $sceneSummaries
        ];
    }

    public static function buildSystemInstructions(StreamStore $store, array $clientContext = [], array $opts = []): string
    {
        $snap = self::buildSmartHomeSnapshot($store, $clientContext);
        $snapJson = self::encodeJsonSafe($snap);
        $mode = (string)($opts['mode'] ?? 'realtime');

        if ($mode === 'chat') {
            $styleGuide = 'Respond in the same language the user uses. For simple direct commands, confirm crisply after executing the tool. For complex, analytical, comparative, diagnostic, troubleshooting, or multi-part questions, reason carefully over live state, device functions, and Tap-to-Run scenes, and provide a smart, thorough, well-structured answer (short paragraphs or clean bullet lists) grounded strictly in verified facts — never invent device capabilities or states.';
        } elseif ($mode === 'voice_turn') {
            $styleGuide = 'Respond in the same language the user uses. Reason carefully behind the scenes using live tools and inventory, then deliver a smart, accurate answer phrased cleanly for speech (avoid markdown asterisks/backticks; keep simple confirmations to 1-2 sentences and complex explanations clear and concise).';
        } else {
            $styleGuide = 'Respond in the same language the user uses. Keep spoken responses concise (1-2 clear sentences) unless asked for a detailed status breakdown.';
        }

        $delegationRule = ($mode === 'realtime')
            ? "\n6. Complex Requests & Deep Reasoning: Whenever the user asks a complex, multi-step, analytical, conditional, diagnostic, troubleshooting, comparison, or planning question — anything needing more than a simple direct device action — call `ask_smart_reasoner` (powered by gpt-6-luna) with the full request instead of giving a generic or surface-level answer."
            : '';

        $readOnlyHint = (array_key_exists('allowDeviceActions', $opts) && $opts['allowDeviceActions'] === false)
            ? "\nRead-only Advisory: This request was flagged as informational/analytical — rely on read-only inspection (`list_smart_home_devices`) and do NOT change device state unless the user's request explicitly commands it."
            : '';

        return <<<PROMPT
You are Treva, an intelligent, capable, bilingual (English & Spanish) smart-house AI assistant.
{$styleGuide}
Always use tools to inspect or control real devices when action or live state is needed; never pretend an action succeeded without executing the tool.
NEVER call any control_* or trigger_* tool when the user only asks to list, read, analyze, compare, troubleshoot, or check device status or battery (call list_smart_home_devices only).{$readOnlyHint}

Current live home inventory and Tap-to-Run scenes:
{$snapJson}

Smart Control Rules:
1. Lights (`Lámpara1`, `Lámpara2`, `Lámpara3`, Magic Home `Cielo`, or `all_lights`): use `control_smart_light`. Magic Home supports power, brightness, RGB hex color, color temperature approximation, and effect presets (37=fade, 38=red pulse, 41=strobe, 56=jump). Tuya lamps also support `color_temp_pct` (0=warm, 100=cool) and `countdown_seconds`.
2. Robot Vacuum (`Sh7p`): use `control_robot_vacuum` (`start_clean`, `pause`, `dock`, `mop`, `power_off`, `power_on`).
3. Infrared (IR) Remotes & Symbolic Scene Links (`Aire` AC, `Edifier` speakers, `TV`, fans `SA7335` / `R-I_-2`, air purifier `R-312`): EVERY Tap-to-Run scene in `tapToRunScenes` includes its decoded `config`, target `device`, and symbolic `voiceLinks`. Whenever the user gives a voice/text command matching a symbolically linked scene — e.g. `"put the air conditioner on 18"` -> `Thunder18` (`M0_T18_S1_0`), `"put it on dry mode"` -> `Dry` (`M4_S1_0`), `"turn power mode on the air conditioner"` / `"jet mode"` / `"jetmode"` -> `"R-312":jetmode` (AC Jet / Power Mode on `Aire`, id `Ed6MOOQ1qnlQKdjj`, NOT the air purifier), `"fan mode"` -> `Ventilador`, `"heat"` -> `Incendio`, `"auto"` -> `Automatico`, `"turn off Aire"` -> `Power Off`, `"start FIKA"` -> `FIKA`, or any custom `voiceLinks` / `"Device":cmd` scene — trigger it directly via `trigger_tuya_scene` with exact `scene_id` (or `scene_name` + `device_hint`). If the requested IR command has NO matching scene (for example `24°C` / `Thunder24` if not synced yet, or fine volume/channel controls), try `control_ir_device` first; if Tuya Universal IR (`28841101`) is unsubscribed, explain honestly and offer the nearest available scenes (e.g. `Thunder22` / `Thunder26`) or ask the user to link/create the scene without silently picking the wrong temperature. Never confuse ambiguous toggles like `Switch Parlante` / `"Loudspeaker":power` with confirmed off state without mentioning it is a power toggle.
4. Complex multi-device scenes ("movie night", "goodnight", "turn off everything"): call `batch_smart_actions` in a single request so every device changes smoothly.
5. Google Cast speakers/displays (`Alice` Chromecast, `Rabbit` Google Nest Mini, `Knowhere` Cast Group, or any Google Nest / Google TV variant): whenever the user asks to play any specific artist, album, song, music, video, or radio station from the internet (e.g. "Play latest Wiz Khalifa album", "Play Wiz Khalifa on Rabbit", "Play Daft Punk on Alice"), IMMEDIATELY call `control_google_cast` with `action="play_web_media"` and `query="<what the user asked to play>"` (do NOT delegate to `ask_smart_reasoner` first — `play_web_media` automatically runs `gpt-6-luna` live web search to find the URL/tracks and starts playing directly on the Chromecast or Google Nest!). Also use `control_google_cast` to `play` (resume), `pause`, `toggle_play_pause`, `rewind` (`seconds`, default 15), `fast_forward` (`seconds`), `seek` (`position_seconds`), `restart`, `previous`, `next`, `stop_media`, `stop` (exit app), `set_volume`, `volume_up`, `volume_down`, `mute`/`unmute`/`toggle_mute`, `announce` (speak a voice message `text` out loud on the speaker/TV), `play_preset` (`country_night`, `rain`, `ocean`, `thunderstorm`, `fireplace`, `forest`, `running_water`, `white_noise`), `play_url` (`url`), `launch_app` (`youtube`, `youtube_music`, `spotify`, `netflix`, `relaxing_sounds`, `backdrop`), or `sync_status` on active Cast sessions (use `target="active"` when the user doesn't specify a device name). Bluetooth BLE lights: use `control_ble_light`.{$delegationRule}
PROMPT;
    }

    public static function executeTool(
        StreamStore $store,
        string $name,
        array $args,
        array $clientContext = [],
        array &$clientActions = []
    ): array {
        $allSmart = $store->getSmartDevices();

        switch ($name) {
            case 'list_smart_home_devices':
                return ['ok' => true] + self::buildSmartHomeSnapshot($store, $clientContext);

            case 'control_smart_light':
                $target = trim((string)($args['target'] ?? ''));
                $payload = [];
                foreach (['power', 'brightness', 'color_hex', 'color_temp_pct', 'preset', 'countdown_seconds', 'work_mode'] as $k) {
                    if (array_key_exists($k, $args) && $args[$k] !== null) {
                        $payload[$k] = $args[$k];
                    }
                }
                if ($target === '' || preg_match('/^(all|all_lights|todas|todas las luces|lights)$/i', self::foldAscii($target))) {
                    $results = [];
                    foreach ($allSmart as $dev) {
                        if (($dev['category'] ?? '') === 'light') {
                            try {
                                $r = SmartController::controlDevice($store, (string)$dev['id'], $payload);
                                $results[] = ['device' => $dev['name'], 'ok' => true, 'method' => $r['meta']['method'] ?? ''];
                            } catch (Throwable $ex) {
                                $results[] = ['device' => $dev['name'], 'ok' => false, 'error' => $ex->getMessage()];
                            }
                        }
                    }
                    // Also forward to connected BLE lights if user said all_lights
                    if (!empty($clientContext['bleDevices'])) {
                        foreach ($clientContext['bleDevices'] as $ble) {
                            $clientActions[] = [
                                'type' => 'ble_control',
                                'deviceId' => $ble['id'] ?? '',
                                'deviceName' => $ble['name'] ?? '',
                                'payload' => $payload
                            ];
                        }
                    }
                    return ['ok' => true, 'target' => 'all_lights', 'results' => $results];
                }
                $dev = self::resolveSmartDevice($allSmart, $target, ['light']);
                if (!$dev) {
                    return [
                        'ok' => false,
                        'error' => "Light not found matching '{$target}'.",
                        'availableLights' => self::listTargetHints($allSmart, ['light']),
                        'hint' => 'Pick the exact matching device name or id from availableLights and retry.'
                    ];
                }
                $r = SmartController::controlDevice($store, (string)$dev['id'], $payload);
                return [
                    'ok' => true,
                    'device' => $dev['name'],
                    'method' => $r['meta']['method'] ?? '',
                    'state' => self::summarizeSmartDeviceForAi($r['device'])
                ];

            case 'ask_smart_reasoner':
                $reqText = trim((string)($args['request'] ?? ''));
                if ($reqText === '') {
                    return ['ok' => false, 'error' => 'request parameter is required'];
                }
                $apiKey = self::resolveApiKey($store);
                if ($apiKey === '') {
                    return ['ok' => false, 'error' => 'OPENAI_API_KEY is not configured on the server.'];
                }
                $allowActions = array_key_exists('allow_device_actions', $args) ? (bool)$args['allow_device_actions'] : true;
                $turn = self::runChatTurn($apiKey, $store, $reqText, [], $clientContext, [
                    'speak' => false,
                    'allowDeviceActions' => $allowActions,
                    'reasoningEffort' => 'low',
                    'conciseForVoice' => true
                ]);
                foreach ($turn['clientActions'] ?? [] as $ca) {
                    $clientActions[] = $ca;
                }
                return [
                    'ok' => true,
                    'model' => $turn['model'] ?? self::DEFAULT_CHAT_MODEL,
                    'answer' => $turn['reply'] ?? '',
                    'executedTools' => $turn['executedTools'] ?? []
                ];

            case 'control_robot_vacuum':
                $target = trim((string)($args['target'] ?? 'Sh7p')) ?: 'Sh7p';
                $dev = self::resolveSmartDevice($allSmart, $target, ['vacuum']);
                if (!$dev) {
                    return [
                        'ok' => false,
                        'error' => "Robot vacuum not found matching '{$target}'.",
                        'availableDevices' => self::listTargetHints($allSmart)
                    ];
                }
                $act = (string)($args['action'] ?? 'start_clean');
                $r = SmartController::controlDevice($store, (string)$dev['id'], ['vacuum_action' => $act]);
                return [
                    'ok' => true,
                    'device' => $dev['name'],
                    'action' => $act,
                    'commands' => $r['meta']['commands'] ?? [],
                    'state' => self::summarizeSmartDeviceForAi($r['device'])
                ];

            case 'control_ir_device':
                $target = trim((string)($args['target'] ?? ''));
                $dev = self::resolveSmartDevice($allSmart, $target, ['ir_ac', 'ir_audio', 'ir_tv', 'ir_fan', 'ir_purifier', 'ir_remote']);
                if (!$dev) {
                    $castHints = NetworkHelper::isLocalEnvironment()
                        ? array_values(array_map(static fn($c) => ['id' => $c['id'] ?? '', 'name' => $c['name'] ?? '', 'kind' => $c['kind'] ?? 'speaker'], $store->getDevices()))
                        : [];
                    return [
                        'ok' => false,
                        'error' => "IR device not found matching '{$target}'.",
                        'availableIrDevices' => self::listTargetHints($allSmart, ['ir_ac', 'ir_audio', 'ir_tv', 'ir_fan', 'ir_purifier', 'ir_remote']),
                        'availableCastDevices' => $castHints,
                        'hint' => 'Use an exact name from availableIrDevices, or control_google_cast if it is a Cast speaker/TV.'
                    ];
                }
                $payload = [];
                if (isset($args['power'])) $payload['power'] = (bool)$args['power'];
                if (!empty($args['command'])) $payload['ir_command'] = (string)$args['command'];
                if (isset($args['ac_temp'])) $payload['ac_temp'] = (int)$args['ac_temp'];
                if (!empty($args['ac_mode'])) $payload['ac_mode'] = (string)$args['ac_mode'];
                if (!empty($args['ac_fan'])) $payload['ac_fan'] = (string)$args['ac_fan'];

                try {
                    $r = SmartController::controlDevice($store, (string)$dev['id'], $payload);
                    return [
                        'ok' => true,
                        'device' => $dev['name'],
                        'tuyaCategory' => $dev['tuyaCategory'] ?? '',
                        'method' => $r['meta']['method'] ?? '',
                        'commands' => $r['meta']['commands'] ?? []
                    ];
                } catch (Throwable $ex) {
                    if (class_exists('SceneLinker')) {
                        $sym = SceneLinker::matchIrRequestToScene($store, $dev, $payload);
                        if (!empty($sym['matched']) && !empty($sym['scene'])) {
                            $scMatch = $sym['scene'];
                            $trig = SmartController::triggerScene($store, (string)$scMatch['id'], '', '', (string)$dev['name']);
                            return [
                                'ok' => true,
                                'device' => $dev['name'],
                                'method' => 'scene_symbolic_link',
                                'matchReason' => $sym['matchReason'] ?? 'symbolic',
                                'sceneId' => $trig['sceneId'],
                                'sceneName' => $trig['name'],
                                'parsedSummary' => $scMatch['parsedSummary'] ?? '',
                                'fallbackFromError' => $ex->getMessage()
                            ];
                        }
                        if (($sym['matchReason'] ?? '') === 'ac_temp_not_in_scenes') {
                            return [
                                'ok' => false,
                                'device' => $dev['name'],
                                'error' => $ex->getMessage(),
                                'requestedTemp' => $sym['requestedTemp'] ?? null,
                                'nearestCandidates' => $sym['nearbyCandidates'] ?? [],
                                'hint' => 'Direct IR failed and no exact Tap-to-Run scene exists for '
                                    . ($sym['requestedTemp'] ?? '') . '°C. Offer the nearest AC scenes from nearestCandidates or instruct the user to create/sync the scene or bind a custom voice link.'
                            ];
                        }
                    }

                    // Surface enriched matching Tap-to-Run scenes so AI/user can handle toggles cleanly
                    $cat = (string)($dev['category'] ?? '');
                    $matches = [];
                    if (class_exists('SceneLinker')) {
                        $devFold = self::foldAscii((string)($dev['name'] ?? $target));
                        foreach (SceneLinker::buildSceneLinks($store) as $scLink) {
                            $hit = ($scLink['targetCategory'] === $cat && $cat !== '')
                                || ($devFold !== '' && str_contains(self::foldAscii($scLink['targetDevice'] . ' ' . $scLink['name']), $devFold));
                            if ($hit) {
                                $matches[] = [
                                    'id' => $scLink['id'],
                                    'name' => $scLink['name'],
                                    'config' => $scLink['parsedSummary']
                                ];
                            }
                            if (count($matches) >= 15) break;
                        }
                    }
                    return [
                        'ok' => false,
                        'device' => $dev['name'],
                        'error' => $ex->getMessage(),
                        'matchingScenes' => $matches,
                        'hint' => !empty($matches)
                            ? 'Direct Tuya IR command failed; matching Smart Life Tap-to-Run scenes exist and can be executed via trigger_tuya_scene.'
                            : 'Tuya Universal Infrared API is not subscribed on iot.tuya.com (error 28841101) and no matching scene was found.'
                    ];
                }

            case 'trigger_tuya_scene':
                return SmartController::triggerScene(
                    $store,
                    trim((string)($args['scene_id'] ?? '')),
                    trim((string)($args['scene_name'] ?? '')),
                    '',
                    trim((string)($args['device_hint'] ?? ''))
                );

            case 'control_tuya_raw_dps':
                $target = trim((string)($args['target'] ?? ''));
                $dev = self::resolveSmartDevice($allSmart, $target);
                if (!$dev) {
                    return [
                        'ok' => false,
                        'error' => "Device not found matching '{$target}'.",
                        'availableDevices' => self::listTargetHints($allSmart)
                    ];
                }
                $cmds = is_array($args['commands'] ?? null) ? $args['commands'] : [];
                $r = SmartController::controlDevice($store, (string)$dev['id'], ['rawCommands' => $cmds]);
                return ['ok' => true, 'device' => $dev['name'], 'commands' => $cmds, 'method' => $r['meta']['method'] ?? 'tuya_cloud'];

            case 'control_google_cast':
                $target = trim((string)($args['target'] ?? 'active'));
                $action = trim((string)($args['action'] ?? 'sync_status'));
                $vol = isset($args['volume_pct']) ? (float)$args['volume_pct'] : null;
                $muted = $action === 'mute' ? true : ($action === 'unmute' ? false : null);
                $mediaOpts = [];
                if (isset($args['seconds']) && is_numeric($args['seconds'])) {
                    $mediaOpts['seconds'] = (float)$args['seconds'];
                }
                if (isset($args['position_seconds']) && is_numeric($args['position_seconds'])) {
                    $mediaOpts['position_seconds'] = (float)$args['position_seconds'];
                }
                foreach (['query', 'text', 'preset', 'url', 'title', 'app', 'voice'] as $optKey) {
                    if (!empty($args[$optKey]) && is_string($args[$optKey])) {
                        $mediaOpts[$optKey] = trim($args[$optKey]);
                    }
                }
                $res = SmartController::controlCast($store, $target, $action, $vol, $muted, $mediaOpts);
                if (!empty($res['clientSideRequired']) && empty($clientContext['castSdk'])) {
                    return [
                        'ok' => false,
                        'error' => "No active media session found on Google Cast or Nest devices matching '{$target}'.",
                        'availableCastDevices' => array_values(array_map(static fn($c) => [
                            'name' => $c['name'] ?? '',
                            'model' => $c['model'] ?? '',
                            'status' => $c['status'] ?? 'IDLE',
                            'appName' => $c['appName'] ?? null
                        ], $store->getDevices()))
                    ];
                }
                if (!empty($res['clientAction'])) {
                    $clientActions[] = $res['clientAction'];
                }
                return $res;

            case 'control_ble_light':
                $payload = [];
                foreach (['power', 'brightness', 'color_hex'] as $k) {
                    if (array_key_exists($k, $args) && $args[$k] !== null) {
                        $payload[$k] = $args[$k];
                    }
                }
                $clientActions[] = [
                    'type' => 'ble_control',
                    'deviceName' => (string)($args['target'] ?? 'all'),
                    'payload' => $payload
                ];
                return ['ok' => true, 'queuedClientAction' => 'ble_control', 'target' => $args['target'] ?? 'all'];

            case 'batch_smart_actions':
                $actions = is_array($args['actions'] ?? null) ? $args['actions'] : [];
                $out = [];
                foreach ($actions as $item) {
                    if (!is_array($item) || empty($item['tool'])) continue;
                    $subTool = (string)$item['tool'];
                    if ($subTool === 'batch_smart_actions' || $subTool === 'ask_smart_reasoner') continue;
                    $subArgs = is_array($item['arguments'] ?? null) ? $item['arguments'] : [];
                    try {
                        $out[] = [
                            'tool' => $subTool,
                            'result' => self::executeTool($store, $subTool, $subArgs, $clientContext, $clientActions)
                        ];
                    } catch (Throwable $ex) {
                        $out[] = ['tool' => $subTool, 'ok' => false, 'error' => $ex->getMessage()];
                    }
                }
                return ['ok' => true, 'batchResults' => $out];

            default:
                throw new InvalidArgumentException("Unknown smart home AI tool: {$name}");
        }
    }

    public static function createRealtimeSession(string $apiKey, StreamStore $store, array $clientContext = [], array $opts = []): array
    {
        if ($apiKey === '') {
            throw new RuntimeException('OPENAI_API_KEY is not configured on the server.');
        }

        $cfg = $store->getSmartConfig()['openai'] ?? [];
        $model = trim((string)($opts['model'] ?? ($cfg['model'] ?? 'gpt-realtime-mini')));
        if (!in_array($model, self::ALLOWED_REALTIME_MODELS, true)) {
            $model = 'gpt-realtime-mini';
        }
        $voice = trim((string)($opts['voice'] ?? ($cfg['voice'] ?? 'verse')));
        if (!in_array($voice, self::ALLOWED_VOICES, true)) {
            $voice = 'verse';
        }

        $payload = [
            'expires_after' => ['anchor' => 'created_at', 'seconds' => 600],
            'session' => [
                'type' => 'realtime',
                'model' => $model,
                'output_modalities' => ['audio'],
                'audio' => [
                    'input' => [
                        'transcription' => ['model' => 'gpt-4o-mini-transcribe'],
                        'noise_reduction' => ['type' => 'near_field'],
                        'turn_detection' => [
                            'type' => 'server_vad',
                            'threshold' => 0.5,
                            'prefix_padding_ms' => 300,
                            'silence_duration_ms' => 450,
                            'create_response' => true,
                            'interrupt_response' => true
                        ]
                    ],
                    'output' => ['voice' => $voice]
                ],
                'instructions' => self::buildSystemInstructions($store, $clientContext),
                'tools' => self::getRealtimeTools()
            ]
        ];

        $res = self::postJson('https://api.openai.com/v1/realtime/client_secrets', $apiKey, $payload, 20);
        if (empty($res['value'])) {
            $errMsg = $res['error']['message'] ?? json_encode($res);
            throw new RuntimeException("OpenAI Realtime session failed: {$errMsg}");
        }

        return [
            'client_secret' => $res['value'],
            'expires_at' => $res['expires_at'] ?? null,
            'session_id' => $res['session']['id'] ?? null,
            'model' => $res['session']['model'] ?? $model,
            'voice' => $res['session']['audio']['output']['voice'] ?? $voice
        ];
    }

    public static function transcribeAudio(string $apiKey, string $filePath, string $mime = 'audio/webm', string $filename = 'voice.webm'): string
    {
        if ($apiKey === '') {
            throw new RuntimeException('OPENAI_API_KEY is not configured.');
        }

        $ch = curl_init('https://api.openai.com/v1/audio/transcriptions');
        $cfile = new CURLFile($filePath, $mime ?: 'audio/webm', $filename ?: 'voice.webm');
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POST => true,
            CURLOPT_HTTPHEADER => ["Authorization: Bearer {$apiKey}"],
            CURLOPT_POSTFIELDS => [
                'model' => 'gpt-4o-mini-transcribe',
                'file' => $cfile
            ],
            CURLOPT_TIMEOUT => 30,
            CURLOPT_IPRESOLVE => CURL_IPRESOLVE_V4
        ]);
        $raw = curl_exec($ch);
        $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $err = curl_error($ch);
        curl_close($ch);

        if ($raw === false) {
            throw new RuntimeException("OpenAI transcription network error: {$err}");
        }
        $data = json_decode($raw, true);
        if ($code >= 400 || !is_array($data)) {
            $msg = is_array($data) ? ($data['error']['message'] ?? $raw) : $raw;
            throw new RuntimeException("OpenAI transcription error ({$code}): {$msg}");
        }
        return trim((string)($data['text'] ?? ''));
    }

    public static function speakTextBytes(string $apiKey, string $text, string $voice = 'verse'): ?string
    {
        if ($apiKey === '' || trim($text) === '') return null;
        if (!in_array($voice, self::ALLOWED_VOICES, true)) {
            $voice = 'verse';
        }

        $ch = curl_init('https://api.openai.com/v1/audio/speech');
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POST => true,
            CURLOPT_HTTPHEADER => [
                "Authorization: Bearer {$apiKey}",
                'Content-Type: application/json'
            ],
            CURLOPT_POSTFIELDS => self::encodeJsonSafe([
                'model' => 'gpt-4o-mini-tts',
                'voice' => $voice,
                'input' => mb_substr($text, 0, 1200, 'UTF-8'),
                'response_format' => 'mp3'
            ]),
            CURLOPT_TIMEOUT => 25,
            CURLOPT_IPRESOLVE => CURL_IPRESOLVE_V4
        ]);
        $raw = curl_exec($ch);
        $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if ($raw === false || $code >= 400 || $raw === '') {
            return null;
        }
        return $raw;
    }

    public static function speakText(string $apiKey, string $text, string $voice = 'verse'): ?string
    {
        $raw = self::speakTextBytes($apiKey, $text, $voice);
        if ($raw === null) return null;
        return 'data:audio/mpeg;base64,' . base64_encode($raw);
    }

    private static function extractResponsesOutput(array $res): array
    {
        $textChunks = [];
        $toolCalls = [];

        foreach ($res['output'] ?? [] as $item) {
            if (!is_array($item)) continue;
            $type = (string)($item['type'] ?? '');
            if ($type === 'function_call') {
                $callId = (string)($item['call_id'] ?? ($item['id'] ?? ''));
                $fnName = (string)($item['name'] ?? '');
                $rawArgs = (string)($item['arguments'] ?? '{}');
                if ($fnName !== '' && $callId !== '') {
                    $toolCalls[] = [
                        'call_id' => $callId,
                        'name' => $fnName,
                        'arguments' => $rawArgs !== '' ? $rawArgs : '{}'
                    ];
                }
            } elseif ($type === 'message') {
                foreach ($item['content'] ?? [] as $part) {
                    if (!is_array($part)) continue;
                    $pType = (string)($part['type'] ?? '');
                    if ($pType === 'output_text' && isset($part['text'])) {
                        $textChunks[] = (string)$part['text'];
                    } elseif ($pType === 'refusal' && isset($part['refusal'])) {
                        $textChunks[] = (string)$part['refusal'];
                    }
                }
            }
        }

        if (empty($textChunks) && is_string($res['output_text'] ?? null) && trim($res['output_text']) !== '') {
            $textChunks[] = (string)$res['output_text'];
        }

        return [
            'text' => trim(implode("\n", $textChunks)),
            'toolCalls' => $toolCalls
        ];
    }

    public static function runChatTurn(
        string $apiKey,
        StreamStore $store,
        string $userText,
        array $history = [],
        array $clientContext = [],
        array $opts = []
    ): array {
        if ($apiKey === '') {
            throw new RuntimeException('OPENAI_API_KEY is not configured on the server.');
        }

        $cfg = $store->getSmartConfig()['openai'] ?? [];
        $chatModel = self::resolveChatModel($cfg, isset($opts['model']) ? (string)$opts['model'] : null);
        $reasoningEffort = self::resolveReasoningEffort($cfg, isset($opts['reasoningEffort']) ? (string)$opts['reasoningEffort'] : null);
        $mode = (!empty($opts['conciseForVoice']) || !empty($opts['speak'])) ? 'voice_turn' : 'chat';
        $instructions = self::buildSystemInstructions($store, $clientContext, [
            'mode' => $mode,
            'allowDeviceActions' => $opts['allowDeviceActions'] ?? null
        ]);

        // Keep last 10 clean user/assistant turns
        $cleanHistory = [];
        $inputItems = [];
        foreach (array_slice($history, -10) as $h) {
            if (!is_array($h)) continue;
            $role = (string)($h['role'] ?? '');
            $content = (string)($h['content'] ?? '');
            if (in_array($role, ['user', 'assistant'], true) && $content !== '') {
                $cleanHistory[] = ['role' => $role, 'content' => $content];
                $inputItems[] = ['role' => $role, 'content' => $content];
            }
        }
        $inputItems[] = ['role' => 'user', 'content' => $userText];

        $tools = self::getResponsesTools();
        $executedTools = [];
        $clientActions = [];
        $replyText = '';
        $previousResponseId = null;
        $pendingInput = $inputItems;

        for ($round = 0; $round < 8; $round++) {
            $payload = [
                'model' => $chatModel,
                'instructions' => $instructions,
                'input' => $pendingInput,
                'tools' => $tools,
                'store' => true
            ];
            if ($previousResponseId !== null) {
                $payload['previous_response_id'] = $previousResponseId;
            }
            if (self::isReasoningModel($chatModel)) {
                $payload['reasoning'] = ['effort' => $reasoningEffort];
            } else {
                $payload['temperature'] = 0.25;
            }

            $res = self::postJson('https://api.openai.com/v1/responses', $apiKey, $payload, 90);

            if (!is_array($res) || !empty($res['error']) || empty($res['id']) || !is_array($res['output'] ?? null)) {
                $errMsg = $res['error']['message'] ?? json_encode($res);
                throw new RuntimeException("OpenAI chat failed ({$chatModel}): {$errMsg}");
            }

            $parsed = self::extractResponsesOutput($res);
            $toolCalls = $parsed['toolCalls'];

            if (empty($toolCalls)) {
                $replyText = $parsed['text'];
                break;
            }

            $previousResponseId = (string)$res['id'];
            $pendingInput = [];

            foreach ($toolCalls as $tc) {
                $callId = $tc['call_id'];
                $fnName = $tc['name'];
                $parsedArgs = json_decode($tc['arguments'], true);
                if (!is_array($parsedArgs)) {
                    $parsedArgs = [];
                }

                try {
                    $result = self::executeTool($store, $fnName, $parsedArgs, $clientContext, $clientActions);
                } catch (Throwable $ex) {
                    $result = ['ok' => false, 'error' => $ex->getMessage()];
                }

                $executedTools[] = [
                    'tool' => $fnName,
                    'arguments' => $parsedArgs,
                    'result' => $result
                ];

                $pendingInput[] = [
                    'type' => 'function_call_output',
                    'call_id' => $callId,
                    'output' => (string)(json_encode($result, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?: '{"ok":false}')
                ];
            }

            if ($parsed['text'] !== '') {
                $replyText = $parsed['text'];
            }
        }

        if ($replyText === '') {
            $replyText = 'Done.';
        }

        $nextHistory = $cleanHistory;
        $nextHistory[] = ['role' => 'user', 'content' => $userText];
        $nextHistory[] = ['role' => 'assistant', 'content' => $replyText];

        $audioDataUrl = null;
        if (!empty($opts['speak'])) {
            $voice = trim((string)($opts['voice'] ?? 'verse')) ?: 'verse';
            $audioDataUrl = self::speakText($apiKey, $replyText, $voice);
        }

        return [
            'ok' => true,
            'model' => $chatModel,
            'reasoningEffort' => self::isReasoningModel($chatModel) ? $reasoningEffort : null,
            'transcript' => $userText,
            'reply' => $replyText,
            'executedTools' => $executedTools,
            'clientActions' => $clientActions,
            'audioDataUrl' => $audioDataUrl,
            'history' => array_slice($nextHistory, -12),
            'smartDevices' => $store->getSmartDevicesPublic(),
            'devices' => NetworkHelper::isLocalEnvironment() ? array_values($store->getDevices()) : []
        ];
    }

    /**
     * Encode JSON safely without excessive PHP serialize_precision float digits (OpenAI rejects >16 decimals).
     */
    private static function encodeJsonSafe(array $payload): string
    {
        $prev = @ini_get('serialize_precision');
        if ($prev !== false) {
            @ini_set('serialize_precision', version_compare(PHP_VERSION, '7.1.0', '>=') ? '-1' : '14');
        }
        try {
            $json = json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        } finally {
            if ($prev !== false) {
                @ini_set('serialize_precision', (string)$prev);
            }
        }
        return $json === false ? '{}' : $json;
    }

    private static function postJson(string $url, string $apiKey, array $payload, int $timeout = 25): array
    {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POST => true,
            CURLOPT_HTTPHEADER => [
                "Authorization: Bearer {$apiKey}",
                'Content-Type: application/json'
            ],
            CURLOPT_POSTFIELDS => self::encodeJsonSafe($payload),
            CURLOPT_TIMEOUT => $timeout,
            CURLOPT_IPRESOLVE => CURL_IPRESOLVE_V4
        ]);
        $raw = curl_exec($ch);
        $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $err = curl_error($ch);
        curl_close($ch);

        if ($raw === false) {
            throw new RuntimeException("OpenAI API connection failed: {$err}");
        }
        $decoded = json_decode($raw, true);
        if (!is_array($decoded)) {
            throw new RuntimeException("Invalid OpenAI API response (HTTP {$code}).");
        }
        if ($code >= 400 && !isset($decoded['error'])) {
            throw new RuntimeException("OpenAI API HTTP {$code}");
        }
        return $decoded;
    }
}
