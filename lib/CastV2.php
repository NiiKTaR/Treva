<?php
/**
 * Pure PHP Google Cast v2 TLS Client (Zero Node.js or external binaries)
 * Implements CastChannel Protobuf framing over stream_socket_client("ssl://...")
 */
class CastV2
{
    private const NS_CONNECTION = 'urn:x-cast:com.google.cast.tp.connection';
    private const NS_HEARTBEAT  = 'urn:x-cast:com.google.cast.tp.heartbeat';
    private const NS_RECEIVER   = 'urn:x-cast:com.google.cast.receiver';
    private const NS_MEDIA      = 'urn:x-cast:com.google.cast.media';
    private const DEFAULT_RECEIVER_APP_ID = 'CC1AD845';

    public const KNOWN_APPS = [
        'youtube'         => ['appId' => '233637DE', 'name' => 'YouTube'],
        'youtube_music'   => ['appId' => '2DB7CC49', 'name' => 'YouTube Music'],
        'spotify'         => ['appId' => 'CC32E753', 'name' => 'Spotify'],
        'netflix'         => ['appId' => 'CA5E8412', 'name' => 'Netflix'],
        'relaxing_sounds' => ['appId' => '9731D581', 'name' => 'Relaxing Sounds'],
        'default_media'   => ['appId' => 'CC1AD845', 'name' => 'Default Media Receiver'],
        'backdrop'        => ['appId' => 'E8C28D3C', 'name' => 'Ambient Backdrop'],
    ];

    public const SOUND_PRESETS = [
        'country_night' => [
            'title' => 'Sonidos del campo en la noche',
            'artist' => 'Google Nest Relaxation Sounds',
            'url' => 'https://storage.googleapis.com/relaxation-sounds/country_night_3600.mp3',
            'contentType' => 'audio/mp3',
            'imageUrl' => 'https://www.gstatic.com/voice_delight/images/relaxation_sounds/icons/country_night.png'
        ],
        'rain' => [
            'title' => 'Rain Sounds',
            'artist' => 'Google Nest Relaxation Sounds',
            'url' => 'https://storage.googleapis.com/relaxation-sounds/rain_3600.mp3',
            'contentType' => 'audio/mp3',
            'imageUrl' => 'https://www.gstatic.com/voice_delight/images/relaxation_sounds/icons/rain.png'
        ],
        'ocean' => [
            'title' => 'Ocean Waves',
            'artist' => 'Google Nest Relaxation Sounds',
            'url' => 'https://storage.googleapis.com/relaxation-sounds/ocean_3600.mp3',
            'contentType' => 'audio/mp3',
            'imageUrl' => 'https://www.gstatic.com/voice_delight/images/relaxation_sounds/icons/ocean.png'
        ],
        'thunderstorm' => [
            'title' => 'Thunderstorm Sounds',
            'artist' => 'Google Nest Relaxation Sounds',
            'url' => 'https://storage.googleapis.com/relaxation-sounds/thunderstorm_3600.mp3',
            'contentType' => 'audio/mp3',
            'imageUrl' => 'https://www.gstatic.com/voice_delight/images/relaxation_sounds/icons/thunderstorm.png'
        ],
        'fireplace' => [
            'title' => 'Crackling Fireplace',
            'artist' => 'Google Nest Relaxation Sounds',
            'url' => 'https://storage.googleapis.com/relaxation-sounds/fireplace_3600.mp3',
            'contentType' => 'audio/mp3',
            'imageUrl' => 'https://www.gstatic.com/voice_delight/images/relaxation_sounds/icons/fireplace.png'
        ],
        'forest' => [
            'title' => 'Forest Ambience',
            'artist' => 'Google Nest Relaxation Sounds',
            'url' => 'https://storage.googleapis.com/relaxation-sounds/forest_3600.mp3',
            'contentType' => 'audio/mp3',
            'imageUrl' => 'https://www.gstatic.com/voice_delight/images/relaxation_sounds/icons/forest.png'
        ],
        'running_water' => [
            'title' => 'Running Stream',
            'artist' => 'Google Nest Relaxation Sounds',
            'url' => 'https://storage.googleapis.com/relaxation-sounds/running_water_3600.mp3',
            'contentType' => 'audio/mp3',
            'imageUrl' => 'https://www.gstatic.com/voice_delight/images/relaxation_sounds/icons/running_water.png'
        ],
        'white_noise' => [
            'title' => 'White Noise',
            'artist' => 'Google Nest Relaxation Sounds',
            'url' => 'https://storage.googleapis.com/relaxation-sounds/white_noise_3600.mp3',
            'contentType' => 'audio/mp3',
            'imageUrl' => 'https://www.gstatic.com/voice_delight/images/relaxation_sounds/icons/white_noise.png'
        ],
    ];

    private $sock = null;
    private string $senderId;
    private int $reqId = 1;
    private array $connectedTransports = [];
    private string $lastHost = '';
    private int $lastPort = 8009;
    private float $lastTimeout = 4.5;

    public function __construct()
    {
        $this->senderId = 'sender-' . random_int(1000, 99999);
    }

    public function connect(string $host, int $port = 8009, float $timeout = 4.5): void
    {
        $this->lastHost = $host;
        $this->lastPort = $port;
        $this->lastTimeout = $timeout;
        $ctx = stream_context_create([
            'ssl' => [
                'verify_peer' => false,
                'verify_peer_name' => false,
                'allow_self_signed' => true
            ]
        ]);

        $sock = @stream_socket_client(
            "ssl://{$host}:{$port}",
            $errno,
            $errstr,
            $timeout,
            STREAM_CLIENT_CONNECT,
            $ctx
        );

        if (!$sock) {
            throw new RuntimeException("Could not connect to Cast device {$host}:{$port} ($errstr)");
        }

        stream_set_timeout($sock, 5);
        $this->sock = $sock;

        $this->send($this->senderId, 'receiver-0', self::NS_CONNECTION, [
            'type' => 'CONNECT',
            'origin' => new stdClass()
        ]);
    }

    public function close(): void
    {
        if ($this->sock) {
            // Do NOT send NS_CONNECTION CLOSE to active media transportIds on teardown:
            // CAF / Google Cast receivers treat an explicit sender CLOSE as a signal to
            // shut down cloud-launched or single-sender media sessions.
            $this->connectedTransports = [];
            @fclose($this->sock);
            $this->sock = null;
        }
    }

    private function connectTransport(string $transportId): void
    {
        if ($transportId === '' || isset($this->connectedTransports[$transportId])) {
            return;
        }
        $this->send($this->senderId, $transportId, self::NS_CONNECTION, [
            'type' => 'CONNECT',
            'origin' => new stdClass()
        ]);
        $this->connectedTransports[$transportId] = true;
    }

    public static function normalizeMediaSession(array $ms): array
    {
        $media = is_array($ms['media'] ?? null) ? $ms['media'] : [];
        $meta = is_array($media['metadata'] ?? null) ? $media['metadata'] : [];
        $cmds = (int)($ms['supportedMediaCommands'] ?? 0);
        $images = is_array($meta['images'] ?? null) ? $meta['images'] : [];
        $imageUrl = '';
        if (!empty($images[0]['url'])) {
            $imageUrl = (string)$images[0]['url'];
        }

        $hasQueue = !empty($ms['items']) || isset($ms['currentItemId']);

        return [
            'mediaSessionId' => isset($ms['mediaSessionId']) ? (int)$ms['mediaSessionId'] : null,
            'playerState' => strtoupper((string)($ms['playerState'] ?? 'UNKNOWN')),
            'playbackRate' => isset($ms['playbackRate']) ? (float)$ms['playbackRate'] : 1.0,
            'currentTime' => isset($ms['currentTime']) ? round((float)$ms['currentTime'], 2) : 0.0,
            'supportedMediaCommands' => $cmds,
            'canPause' => (($cmds & 1) !== 0),
            'canSeek' => (($cmds & 2) !== 0),
            'canNext' => (($cmds & 64) !== 0) || $hasQueue,
            'canPrev' => (($cmds & 128) !== 0) || $hasQueue,
            'duration' => isset($media['duration']) ? round((float)$media['duration'], 2) : null,
            'contentId' => (string)($media['contentId'] ?? ''),
            'contentType' => (string)($media['contentType'] ?? ''),
            'streamType' => (string)($media['streamType'] ?? ''),
            'title' => (string)($meta['title'] ?? ''),
            'artist' => (string)($meta['artist'] ?? ($meta['subtitle'] ?? ($meta['albumArtist'] ?? ''))),
            'album' => (string)($meta['albumName'] ?? ''),
            'imageUrl' => $imageUrl
        ];
    }

    public function getMediaState(?array $receiverStatus = null, bool $probeMedia = true): array
    {
        $status = $receiverStatus ?? $this->getStatus();
        $activeApp = null;
        foreach (($status['applications'] ?? []) as $app) {
            if (empty($app['isIdleScreen']) && !empty($app['transportId'])) {
                $activeApp = $app;
                break;
            }
        }

        $appInfo = null;
        $mediaSession = null;

        if ($activeApp !== null) {
            $namespaces = [];
            foreach (($activeApp['namespaces'] ?? []) as $ns) {
                if (!empty($ns['name'])) {
                    $namespaces[] = (string)$ns['name'];
                }
            }
            $transportId = (string)($activeApp['transportId'] ?? '');
            $supportsMedia = empty($namespaces) || in_array(self::NS_MEDIA, $namespaces, true);

            $appInfo = [
                'appId' => (string)($activeApp['appId'] ?? ''),
                'displayName' => (string)($activeApp['displayName'] ?? ''),
                'statusText' => (string)($activeApp['statusText'] ?? ''),
                'iconUrl' => (string)($activeApp['iconUrl'] ?? ''),
                'sessionId' => (string)($activeApp['sessionId'] ?? ''),
                'transportId' => $transportId,
                'supportsMedia' => $supportsMedia
            ];

            if ($probeMedia && $transportId !== '' && $supportsMedia) {
                $this->connectTransport($transportId);
                $rid = $this->nextReqId();
                $this->send($this->senderId, $transportId, self::NS_MEDIA, [
                    'type' => 'GET_STATUS',
                    'requestId' => $rid
                ]);
                $reply = $this->waitForMediaReply($rid, 2.5);
                if (!empty($reply['status'][0]) && is_array($reply['status'][0])) {
                    $mediaSession = self::normalizeMediaSession($reply['status'][0]);
                    if ($mediaSession['imageUrl'] === '' && $appInfo['iconUrl'] !== '') {
                        $mediaSession['imageUrl'] = $appInfo['iconUrl'];
                    }
                    if ($mediaSession['title'] === '' && $appInfo['statusText'] !== '') {
                        $mediaSession['title'] = (string)preg_replace('/^(Casting|Playing|Now Playing):\s*/i', '', $appInfo['statusText']);
                    }
                }
            }

            if ($mediaSession === null && ($appInfo['statusText'] !== '' || $appInfo['displayName'] !== '')) {
                $cleanTitle = $appInfo['statusText'] !== ''
                    ? (string)preg_replace('/^(Casting|Playing|Now Playing):\s*/i', '', $appInfo['statusText'])
                    : $appInfo['displayName'];
                $mediaSession = [
                    'mediaSessionId' => 0,
                    'playerState' => 'ACTIVE',
                    'playbackRate' => 1.0,
                    'currentTime' => 0.0,
                    'supportedMediaCommands' => 0,
                    'canPause' => $supportsMedia,
                    'canSeek' => false,
                    'canNext' => false,
                    'canPrev' => false,
                    'duration' => null,
                    'contentId' => '',
                    'contentType' => '',
                    'streamType' => 'LIVE',
                    'title' => $cleanTitle,
                    'artist' => $appInfo['displayName'],
                    'album' => '',
                    'imageUrl' => $appInfo['iconUrl']
                ];
            }
        }

        return [
            'volume' => $status['volume'] ?? null,
            'app' => $appInfo,
            'mediaSession' => $mediaSession
        ];
    }

    private function sendMediaCommandAndAwait(string $transportId, array $payload, float $timeoutSec = 3.0): array
    {
        $this->send($this->senderId, $transportId, self::NS_MEDIA, $payload);
        $reply = $this->waitForMediaReply((int)$payload['requestId'], $timeoutSec);
        $replyType = (string)($reply['type'] ?? '');
        if (in_array($replyType, ['INVALID_REQUEST', 'INVALID_PLAYER_STATE', 'LOAD_FAILED'], true)) {
            $reason = (string)($reply['reason'] ?? $replyType);
            throw new RuntimeException("Cast media command failed: {$reason}");
        }
        return $reply;
    }

    public function controlMedia(string $action, array $opts = []): array
    {
        $actionNorm = strtolower(trim($action));
        $state = $this->getMediaState(null, true);
        $app = $state['app'] ?? null;
        if (!$app) {
            throw new RuntimeException('No active media app is currently running on this Cast device.');
        }
        $transportId = (string)($app['transportId'] ?? '');
        $appName = $app['displayName'] ?: 'Cast app';
        if ($actionNorm === 'stop_media' && ($transportId === '' || empty($state['mediaSession']['mediaSessionId']))) {
            $this->stopCurrentApp();
            return [
                'action' => 'stop_media',
                'meta' => ['stoppedApp' => $appName],
                'state' => ['volume' => $state['volume'] ?? null, 'app' => null, 'mediaSession' => null],
                'mediaSession' => null
            ];
        }
        if ($transportId === '' || empty($app['supportsMedia'])) {
            throw new RuntimeException("{$appName} does not expose Google Cast media transport controls.");
        }

        $ms = $state['mediaSession'] ?? null;
        $msid = (int)($ms['mediaSessionId'] ?? 0);
        if ($msid <= 0) {
            // Try mediaSessionId=1 fallback for receivers that omit GET_STATUS status array until commanded
            $msid = 1;
        }

        $playerState = (string)($ms['playerState'] ?? 'UNKNOWN');
        $curTime = (float)($ms['currentTime'] ?? 0.0);
        $dur = $ms['duration'] ?? null;
        $rid = $this->nextReqId();
        $reply = [];
        $metaOut = [
            'previousTime' => $curTime,
            'previousState' => $playerState
        ];

        $this->connectTransport($transportId);

        switch ($actionNorm) {
            case 'play':
            case 'resume':
                $reply = $this->sendMediaCommandAndAwait($transportId, [
                    'type' => 'PLAY',
                    'mediaSessionId' => $msid,
                    'requestId' => $rid
                ]);
                break;

            case 'pause':
                $reply = $this->sendMediaCommandAndAwait($transportId, [
                    'type' => 'PAUSE',
                    'mediaSessionId' => $msid,
                    'requestId' => $rid
                ]);
                break;

            case 'toggle_play_pause':
                $cmdType = in_array($playerState, ['PLAYING', 'BUFFERING'], true) ? 'PAUSE' : 'PLAY';
                $reply = $this->sendMediaCommandAndAwait($transportId, [
                    'type' => $cmdType,
                    'mediaSessionId' => $msid,
                    'requestId' => $rid
                ]);
                break;

            case 'rewind':
                $offset = isset($opts['seconds']) && (float)$opts['seconds'] > 0 ? abs((float)$opts['seconds']) : 15.0;
                $targetTime = max(0.0, $curTime - $offset);
                $resumeState = ($playerState === 'PAUSED') ? 'PLAYBACK_PAUSE' : 'PLAYBACK_START';
                $metaOut['rewoundBy'] = round(max(0.0, $curTime - $targetTime), 2);
                $metaOut['targetTime'] = round($targetTime, 2);
                $reply = $this->sendMediaCommandAndAwait($transportId, [
                    'type' => 'SEEK',
                    'mediaSessionId' => $msid,
                    'currentTime' => round($targetTime, 3),
                    'resumeState' => $resumeState,
                    'requestId' => $rid
                ]);
                break;

            case 'fast_forward':
            case 'forward':
                $offset = isset($opts['seconds']) && (float)$opts['seconds'] > 0 ? abs((float)$opts['seconds']) : 15.0;
                $targetTime = $curTime + $offset;
                if ($dur !== null && $dur > 0) {
                    $targetTime = min(max(0.0, (float)$dur - 0.5), $targetTime);
                }
                $targetTime = max(0.0, $targetTime);
                $resumeState = ($playerState === 'PAUSED') ? 'PLAYBACK_PAUSE' : 'PLAYBACK_START';
                $metaOut['forwardedBy'] = round(max(0.0, $targetTime - $curTime), 2);
                $metaOut['targetTime'] = round($targetTime, 2);
                $reply = $this->sendMediaCommandAndAwait($transportId, [
                    'type' => 'SEEK',
                    'mediaSessionId' => $msid,
                    'currentTime' => round($targetTime, 3),
                    'resumeState' => $resumeState,
                    'requestId' => $rid
                ]);
                break;

            case 'seek':
                $targetTime = max(0.0, (float)($opts['position_seconds'] ?? $opts['seconds'] ?? 0.0));
                if ($dur !== null && $dur > 0) {
                    $targetTime = min((float)$dur, $targetTime);
                }
                $metaOut['targetTime'] = round($targetTime, 2);
                $reply = $this->sendMediaCommandAndAwait($transportId, [
                    'type' => 'SEEK',
                    'mediaSessionId' => $msid,
                    'currentTime' => round($targetTime, 3),
                    'requestId' => $rid
                ]);
                break;

            case 'restart':
                $metaOut['targetTime'] = 0.0;
                $reply = $this->sendMediaCommandAndAwait($transportId, [
                    'type' => 'SEEK',
                    'mediaSessionId' => $msid,
                    'currentTime' => 0.0,
                    'resumeState' => 'PLAYBACK_START',
                    'requestId' => $rid
                ]);
                break;

            case 'next':
                try {
                    $reply = $this->sendMediaCommandAndAwait($transportId, [
                        'type' => 'QUEUE_UPDATE',
                        'mediaSessionId' => $msid,
                        'jump' => 1,
                        'requestId' => $rid
                    ]);
                } catch (Throwable $ex) {
                    $reply = $this->sendMediaCommandAndAwait($transportId, [
                        'type' => 'QUEUE_NEXT',
                        'mediaSessionId' => $msid,
                        'requestId' => $this->nextReqId()
                    ]);
                }
                break;

            case 'previous':
                try {
                    $reply = $this->sendMediaCommandAndAwait($transportId, [
                        'type' => 'QUEUE_UPDATE',
                        'mediaSessionId' => $msid,
                        'jump' => -1,
                        'requestId' => $rid
                    ]);
                } catch (Throwable $ex) {
                    try {
                        $reply = $this->sendMediaCommandAndAwait($transportId, [
                            'type' => 'QUEUE_PREV',
                            'mediaSessionId' => $msid,
                            'requestId' => $this->nextReqId()
                        ]);
                    } catch (Throwable $ex2) {
                        // Single-item sessions without a queue fall back to restarting from 0s
                        if ($curTime > 2.0) {
                            $metaOut['fallbackRestarted'] = true;
                            $reply = $this->sendMediaCommandAndAwait($transportId, [
                                'type' => 'SEEK',
                                'mediaSessionId' => $msid,
                                'currentTime' => 0.0,
                                'resumeState' => 'PLAYBACK_START',
                                'requestId' => $this->nextReqId()
                            ]);
                        } else {
                            throw $ex2;
                        }
                    }
                }
                break;

            case 'stop_media':
                $reply = $this->sendMediaCommandAndAwait($transportId, [
                    'type' => 'STOP',
                    'mediaSessionId' => $msid,
                    'requestId' => $rid
                ]);
                break;

            default:
                throw new InvalidArgumentException("Unsupported Cast media action: {$action}");
        }

        $updatedMs = (!empty($reply['status'][0]) && is_array($reply['status'][0]))
            ? self::normalizeMediaSession($reply['status'][0])
            : $ms;

        // Receivers like YouTube Music often emit requestId=0 broadcasts; refresh once if state looks stale
        $needRefresh = (int)($reply['requestId'] ?? 0) === 0
            && (
                (($actionNorm === 'pause' || ($actionNorm === 'toggle_play_pause' && in_array($playerState, ['PLAYING', 'BUFFERING'], true))) && $updatedMs['playerState'] !== 'PAUSED')
                || (($actionNorm === 'play' || $actionNorm === 'resume' || ($actionNorm === 'toggle_play_pause' && $playerState === 'PAUSED')) && !in_array($updatedMs['playerState'], ['PLAYING', 'BUFFERING'], true))
                || in_array($actionNorm, ['rewind', 'fast_forward', 'forward', 'seek', 'restart', 'next', 'previous'], true)
            );

        if ($needRefresh) {
            usleep(160000);
            $fresh = $this->getMediaState(['applications' => [$app], 'volume' => $state['volume'] ?? null], true);
            $updatedState = $fresh;
            if ($fresh['mediaSession'] !== null) {
                $updatedMs = $fresh['mediaSession'];
            }
        } else {
            $updatedState = [
                'volume' => $state['volume'] ?? null,
                'app' => $app,
                'mediaSession' => $updatedMs
            ];
        }

        return [
            'action' => $actionNorm,
            'meta' => $metaOut,
            'state' => $updatedState,
            'mediaSession' => $updatedMs
        ];
    }

    public function getStatus(): array
    {
        $rid = $this->nextReqId();
        $this->send($this->senderId, 'receiver-0', self::NS_RECEIVER, [
            'type' => 'GET_STATUS',
            'requestId' => $rid
        ]);
        $msg = $this->waitForReply($rid, 'RECEIVER_STATUS', 4.0);
        return $msg['status'] ?? [];
    }

    public function setVolume(?float $level = null, ?bool $muted = null): array
    {
        $rid = $this->nextReqId();
        $vol = [];
        if ($level !== null) {
            $vol['level'] = max(0.0, min(1.0, $level));
        }
        if ($muted !== null) {
            $vol['muted'] = $muted;
        }
        $this->send($this->senderId, 'receiver-0', self::NS_RECEIVER, [
            'type' => 'SET_VOLUME',
            'volume' => $vol,
            'requestId' => $rid
        ]);
        $msg = $this->waitForReply($rid, 'RECEIVER_STATUS', 4.0);
        return $msg['status']['volume'] ?? $vol;
    }

    public function stopCurrentApp(): bool
    {
        $status = $this->getStatus();
        $apps = $status['applications'] ?? [];
        $stopped = false;
        foreach ($apps as $app) {
            if (!empty($app['sessionId']) && empty($app['isIdleScreen'])) {
                $rid = $this->nextReqId();
                $this->send($this->senderId, 'receiver-0', self::NS_RECEIVER, [
                    'type' => 'STOP',
                    'sessionId' => $app['sessionId'],
                    'requestId' => $rid
                ]);
                $this->waitForReply($rid, 'RECEIVER_STATUS', 3.0);
                $stopped = true;
            }
        }
        return $stopped;
    }

    public static function resolveSoundPreset(string $key): ?array
    {
        $norm = strtolower(trim(str_replace(['-', ' '], '_', $key)));
        if (isset(self::SOUND_PRESETS[$norm])) {
            return self::SOUND_PRESETS[$norm] + ['key' => $norm];
        }
        $aliases = [
            'country' => 'country_night',
            'campo' => 'country_night',
            'noche' => 'country_night',
            'night' => 'country_night',
            'crickets' => 'country_night',
            'lluvia' => 'rain',
            'tormenta' => 'thunderstorm',
            'thunder' => 'thunderstorm',
            'storm' => 'thunderstorm',
            'mar' => 'ocean',
            'olas' => 'ocean',
            'waves' => 'ocean',
            'fuego' => 'fireplace',
            'chimenea' => 'fireplace',
            'fire' => 'fireplace',
            'bosque' => 'forest',
            'agua' => 'running_water',
            'arroyo' => 'running_water',
            'river' => 'running_water',
            'stream' => 'running_water',
            'ruido_blanco' => 'white_noise',
            'noise' => 'white_noise',
        ];
        foreach ($aliases as $word => $presetKey) {
            if (str_contains($norm, $word) && isset(self::SOUND_PRESETS[$presetKey])) {
                return self::SOUND_PRESETS[$presetKey] + ['key' => $presetKey];
            }
        }
        return null;
    }

    public function launchApp(string $appKeyOrId): array
    {
        $norm = strtolower(trim(str_replace(['-', ' '], '_', $appKeyOrId)));
        $appId = self::KNOWN_APPS[$norm]['appId'] ?? strtoupper(trim($appKeyOrId));
        if (!preg_match('/^[A-Z0-9]{8}$/', $appId)) {
            throw new InvalidArgumentException("Unknown Cast app '{$appKeyOrId}'. Try YouTube, YouTube Music, Spotify, Netflix, or an 8-char Cast App ID.");
        }

        $launchRid = $this->nextReqId();
        $this->send($this->senderId, 'receiver-0', self::NS_RECEIVER, [
            'type' => 'LAUNCH',
            'appId' => $appId,
            'requestId' => $launchRid
        ]);

        try {
            $launchReply = $this->waitForReply($launchRid, 'RECEIVER_STATUS', 8.0);
        } catch (Throwable $ex) {
            // Chromecast video receivers reject standalone YouTube Music audio appId (2DB7CC49)
            // and use the main YouTube receiver (233637DE) for YouTube & YouTube Music sessions.
            if ($appId === '2DB7CC49') {
                $retryRid = $this->nextReqId();
                $this->send($this->senderId, 'receiver-0', self::NS_RECEIVER, [
                    'type' => 'LAUNCH',
                    'appId' => '233637DE',
                    'requestId' => $retryRid
                ]);
                $launchReply = $this->waitForReply($retryRid, 'RECEIVER_STATUS', 8.0);
            } else {
                throw $ex;
            }
        }
        return $this->getMediaState($launchReply['status'] ?? null, true);
    }

    public function loadMedia(
        string $streamUrl,
        string $contentType,
        string $title = 'Treva Live Cast',
        string $subtitle = 'Screen & Sound',
        array $opts = []
    ): array {
        $transportId = $this->ensureDefaultMediaReceiver(false);
        $reply = $this->sendLoad($transportId, $streamUrl, $contentType, $title, $subtitle, $opts);

        // If stale receiver session rejected LOAD, relaunch a clean DefaultMediaReceiver and retry once
        if (in_array($reply['type'] ?? '', ['LOAD_FAILED', 'INVALID_REQUEST'], true)) {
            $this->stopCurrentApp();
            usleep(250000);
            $transportId = $this->ensureDefaultMediaReceiver(true);
            $reply = $this->sendLoad($transportId, $streamUrl, $contentType, $title, $subtitle, $opts);
        }

        if (in_array($reply['type'] ?? '', ['LOAD_FAILED', 'INVALID_REQUEST'], true)) {
            $reason = $reply['reason'] ?? $reply['type'];
            throw new RuntimeException("Cast media load failed: {$reason}");
        }

        return $reply;
    }

    private function ensureDefaultMediaReceiver(bool $forceFresh): string
    {
        $status = $this->getStatus();
        $transportId = null;

        if (!$forceFresh) {
            foreach (($status['applications'] ?? []) as $app) {
                if (($app['appId'] ?? '') === self::DEFAULT_RECEIVER_APP_ID && !empty($app['transportId'])) {
                    $transportId = $app['transportId'];
                    break;
                }
            }
        }

        if (!$transportId) {
            $launchRid = $this->nextReqId();
            $this->send($this->senderId, 'receiver-0', self::NS_RECEIVER, [
                'type' => 'LAUNCH',
                'appId' => self::DEFAULT_RECEIVER_APP_ID,
                'requestId' => $launchRid
            ]);

            $launchReply = $this->waitForReply($launchRid, 'RECEIVER_STATUS', 8.0);
            foreach (($launchReply['status']['applications'] ?? []) as $app) {
                if (($app['appId'] ?? '') === self::DEFAULT_RECEIVER_APP_ID && !empty($app['transportId'])) {
                    $transportId = $app['transportId'];
                    break;
                }
            }
        }

        if (!$transportId) {
            throw new RuntimeException('Cast device did not return a transportId for DefaultMediaReceiver');
        }

        $this->connectTransport($transportId);

        return $transportId;
    }

    private function sendLoad(
        string $transportId,
        string $streamUrl,
        string $contentType,
        string $title,
        string $subtitle,
        array $opts = []
    ): array {
        $isAudio = str_starts_with($contentType, 'audio/');
        $streamType = !empty($opts['streamType']) ? strtoupper((string)$opts['streamType']) : 'LIVE';
        $currentTime = isset($opts['currentTime']) ? max(0.0, (float)$opts['currentTime']) : 0;
        $meta = [
            'type' => 0,
            'metadataType' => $isAudio ? 3 : 1,
            'title' => $title,
            'subtitle' => $subtitle,
            'artist' => $subtitle
        ];
        if (!empty($opts['album'])) {
            $meta['albumName'] = (string)$opts['album'];
        }
        if (!empty($opts['imageUrl'])) {
            $meta['images'] = [['url' => (string)$opts['imageUrl']]];
        }

        $loadRid = $this->nextReqId();
        $this->send($this->senderId, $transportId, self::NS_MEDIA, [
            'type' => 'LOAD',
            'requestId' => $loadRid,
            'autoplay' => true,
            'currentTime' => $currentTime,
            'media' => [
                'contentId' => $streamUrl,
                'contentType' => $contentType,
                'streamType' => $streamType,
                'metadata' => $meta
            ]
        ]);

        return $this->waitForMediaReply($loadRid, 8.0);
    }

    /**
     * Load a multi-track audio/video queue (album or playlist) into Default Media Receiver via QUEUE_LOAD.
     */
    public function loadMediaQueue(array $tracks, string $repeatMode = 'REPEAT_OFF'): array
    {
        if (empty($tracks)) {
            throw new InvalidArgumentException('Cannot load an empty media queue.');
        }
        if (count($tracks) === 1) {
            $t = $tracks[0];
            return $this->loadMedia(
                (string)$t['url'],
                (string)($t['contentType'] ?? 'audio/mpeg'),
                (string)($t['title'] ?? 'Track 1'),
                (string)($t['artist'] ?? 'Google Cast'),
                [
                    'streamType' => $t['streamType'] ?? 'BUFFERED',
                    'album' => $t['album'] ?? '',
                    'imageUrl' => $t['imageUrl'] ?? ''
                ]
            );
        }

        $queueItems = [];
        foreach (array_values($tracks) as $idx => $t) {
            $url = trim((string)($t['url'] ?? ''));
            if ($url === '') continue;
            $cType = trim((string)($t['contentType'] ?? 'audio/mpeg')) ?: 'audio/mpeg';
            $isAudio = str_starts_with($cType, 'audio/');
            $meta = [
                'type' => 0,
                'metadataType' => $isAudio ? 3 : 1,
                'title' => (string)($t['title'] ?? ('Track ' . ($idx + 1))),
                'subtitle' => (string)($t['artist'] ?? ''),
                'artist' => (string)($t['artist'] ?? ''),
                'albumName' => (string)($t['album'] ?? '')
            ];
            if (!empty($t['imageUrl'])) {
                $meta['images'] = [['url' => (string)$t['imageUrl']]];
            }
            $queueItems[] = [
                'autoplay' => true,
                'preloadTime' => 4,
                'media' => [
                    'contentId' => $url,
                    'contentType' => $cType,
                    'streamType' => (string)($t['streamType'] ?? 'BUFFERED'),
                    'metadata' => $meta
                ]
            ];
        }

        if (empty($queueItems)) {
            throw new RuntimeException('No playable stream URLs in media queue.');
        }

        $transportId = $this->ensureDefaultMediaReceiver(false);
        $rid = $this->nextReqId();
        $this->send($this->senderId, $transportId, self::NS_MEDIA, [
            'type' => 'QUEUE_LOAD',
            'requestId' => $rid,
            'startIndex' => 0,
            'repeatMode' => $repeatMode,
            'items' => $queueItems
        ]);
        $reply = $this->waitForMediaReply($rid, 8.0);

        if (in_array($reply['type'] ?? '', ['LOAD_FAILED', 'INVALID_REQUEST', 'INVALID_PLAYER_STATE'], true)) {
            $this->stopCurrentApp();
            usleep(250000);
            $transportId = $this->ensureDefaultMediaReceiver(true);
            $rid = $this->nextReqId();
            $this->send($this->senderId, $transportId, self::NS_MEDIA, [
                'type' => 'QUEUE_LOAD',
                'requestId' => $rid,
                'startIndex' => 0,
                'repeatMode' => $repeatMode,
                'items' => $queueItems
            ]);
            $reply = $this->waitForMediaReply($rid, 8.0);
        }

        return $reply;
    }

    /**
     * Pure Cloud YouTube / YouTube Music Lounge session bind & command helper.
     * Works from any remote public server (e.g. knowhereco.ar) without needing local LAN TCP port 8009.
     */
    private static function bindYouTubeLoungeSession(string $screenId, string $theme = 'cl'): array
    {
        $screenId = trim($screenId);
        if ($screenId === '') {
            return ['ok' => false, 'reason' => 'missing_screen_id'];
        }
        $loungeToken = '';
        for ($tokTry = 0; $tokTry < 2 && $loungeToken === ''; $tokTry++) {
            $ch = curl_init('https://www.youtube.com/api/lounge/pairing/get_lounge_token_batch');
            curl_setopt_array($ch, [
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_POST => true,
                CURLOPT_POSTFIELDS => http_build_query(['screen_ids' => $screenId]),
                CURLOPT_CONNECTTIMEOUT => 5,
                CURLOPT_TIMEOUT => 8,
                CURLOPT_IPRESOLVE => CURL_IPRESOLVE_V4
            ]);
            $lRaw = (string)curl_exec($ch);
            curl_close($ch);
            $lData = json_decode($lRaw, true);
            $loungeToken = (string)($lData['screens'][0]['loungeToken'] ?? '');
            if ($loungeToken === '' && $tokTry === 0) {
                usleep(250000);
            }
        }
        if ($loungeToken === '') {
            return ['ok' => false, 'reason' => 'no_lounge_token'];
        }

        $themesToTry = $theme === 'm' ? ['m', 'cl'] : ['cl', 'm'];
        foreach ($themesToTry as $tryTheme) {
            $bindParams = [
                'device' => 'REMOTE_CONTROL',
                'id' => 'treva-cast-remote',
                'name' => 'Treva Smart Hub',
                'mdx-version' => 3,
                'theme' => $tryTheme,
                'loungeIdToken' => $loungeToken,
                'VER' => 8,
                'v' => 2,
                'RID' => random_int(10000, 89999),
                'CVER' => 1,
                'zx' => bin2hex(random_bytes(6)),
                't' => 1
            ];
            $ch1 = curl_init('https://www.youtube.com/api/lounge/bc/bind?' . http_build_query($bindParams));
            curl_setopt_array($ch1, [
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_POST => true,
                CURLOPT_HTTPHEADER => [
                    'Content-Type: application/x-www-form-urlencoded',
                    'X-YouTube-LoungeId-Token: ' . $loungeToken
                ],
                CURLOPT_POSTFIELDS => http_build_query(['count' => 0]),
                CURLOPT_TIMEOUT => 7,
                CURLOPT_IPRESOLVE => CURL_IPRESOLVE_V4
            ]);
            $raw1 = (string)curl_exec($ch1);
            curl_close($ch1);

            if (str_contains($raw1, 'unmatchingTheme')) {
                continue;
            }
            $sid = '';
            $gsession = '';
            if (preg_match('/\["c","([^"]+)"/', $raw1, $m1)) $sid = $m1[1];
            if (preg_match('/\["S","([^"]+)"/', $raw1, $m2)) $gsession = $m2[1];
            if ($sid === '' || $gsession === '') {
                return ['ok' => false, 'reason' => 'bind_failed'];
            }
            $hasScreen = str_contains($raw1, 'LOUNGE_SCREEN') && !str_contains($raw1, 'loungeScreenDisconnected');
            return [
                'ok' => $hasScreen,
                'hasScreen' => $hasScreen,
                'reason' => $hasScreen ? 'connected' : 'screen_not_active',
                'loungeToken' => $loungeToken,
                'bindParams' => $bindParams,
                'sid' => $sid,
                'gsession' => $gsession,
                'theme' => $tryTheme,
                'raw' => $raw1
            ];
        }

        return ['ok' => false, 'reason' => 'theme_mismatch'];
    }

    public static function playYouTubeLoungeCloud(string $screenId, string $theme, array $videoIds, string $listId = ''): array
    {
        $cleanIds = array_values(array_filter(array_map('trim', $videoIds), static fn($v) => preg_match('/^[a-zA-Z0-9_-]{11}$/', $v) === 1));
        if (empty($cleanIds)) {
            return ['ok' => false, 'reason' => 'no_video_ids'];
        }
        $session = self::bindYouTubeLoungeSession($screenId, $theme);
        if (empty($session['ok'])) {
            return $session;
        }

        $cmdParams = $session['bindParams'];
        $cmdParams['SID'] = $session['sid'];
        $cmdParams['gsessionid'] = $session['gsession'];
        $cmdParams['RID'] = $session['bindParams']['RID'] + 1;
        $cmdParams['AID'] = 1;

        $postData = [
            'count' => 1,
            'ofs' => 0,
            'req0__sc' => 'setPlaylist',
            'req0_videoId' => $cleanIds[0],
            'req0_videoIds' => implode(',', array_slice($cleanIds, 0, 25)),
            'req0_currentTime' => 0,
            'req0_currentIndex' => 0
        ];
        if ($listId !== '') {
            $postData['req0_listId'] = $listId;
        }

        $ch2 = curl_init('https://www.youtube.com/api/lounge/bc/bind?' . http_build_query($cmdParams));
        curl_setopt_array($ch2, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POST => true,
            CURLOPT_HTTPHEADER => [
                'Content-Type: application/x-www-form-urlencoded',
                'X-YouTube-LoungeId-Token: ' . $session['loungeToken']
            ],
            CURLOPT_POSTFIELDS => http_build_query($postData),
            CURLOPT_TIMEOUT => 7,
            CURLOPT_IPRESOLVE => CURL_IPRESOLVE_V4
        ]);
        $reply = (string)curl_exec($ch2);
        curl_close($ch2);

        return [
            'ok' => true,
            'screenId' => $screenId,
            'theme' => $session['theme'],
            'videoId' => $cleanIds[0],
            'videoCount' => count($cleanIds),
            'reply' => trim($reply)
        ];
    }

    public static function controlYouTubeLoungeCloud(string $screenId, string $theme, string $action, array $opts = []): array
    {
        $session = self::bindYouTubeLoungeSession($screenId, $theme);
        if (empty($session['ok'])) {
            return $session;
        }

        $cmdParams = $session['bindParams'];
        $cmdParams['SID'] = $session['sid'];
        $cmdParams['gsessionid'] = $session['gsession'];
        $cmdParams['RID'] = $session['bindParams']['RID'] + 1;
        $cmdParams['AID'] = 1;

        $postData = ['count' => 1, 'ofs' => 0];
        $act = strtolower(trim($action));
        if ($act === 'pause') {
            $postData['req0__sc'] = 'pause';
        } elseif ($act === 'play' || $act === 'resume' || $act === 'toggle_play_pause') {
            $postData['req0__sc'] = 'play';
        } elseif ($act === 'next') {
            $postData['req0__sc'] = 'next';
        } elseif ($act === 'previous') {
            $postData['req0__sc'] = 'previous';
        } elseif (in_array($act, ['stop', 'stop_media'], true)) {
            $postData['req0__sc'] = 'stopVideo';
        } elseif (in_array($act, ['seek', 'restart', 'rewind', 'fast_forward'], true)) {
            $cur = isset($opts['currentTime']) ? (float)$opts['currentTime'] : 0.0;
            $step = isset($opts['seconds']) ? (float)$opts['seconds'] : 15.0;
            $targetSec = 0.0;
            if ($act === 'seek') $targetSec = max(0.0, (float)($opts['position_seconds'] ?? 0.0));
            elseif ($act === 'rewind') $targetSec = max(0.0, $cur - $step);
            elseif ($act === 'fast_forward') $targetSec = max(0.0, $cur + $step);
            $postData['req0__sc'] = 'seekTo';
            $postData['req0_newTime'] = (int)round($targetSec);
        } elseif (in_array($act, ['set_volume', 'volume_up', 'volume_down', 'mute', 'unmute', 'toggle_mute'], true)) {
            $volPct = isset($opts['volumePct']) ? (int)round((float)$opts['volumePct']) : 50;
            $postData['req0__sc'] = 'setVolume';
            $postData['req0_volume'] = max(0, min(100, $volPct));
        } else {
            return ['ok' => false, 'reason' => 'unsupported_lounge_action'];
        }

        $ch2 = curl_init('https://www.youtube.com/api/lounge/bc/bind?' . http_build_query($cmdParams));
        curl_setopt_array($ch2, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POST => true,
            CURLOPT_HTTPHEADER => [
                'Content-Type: application/x-www-form-urlencoded',
                'X-YouTube-LoungeId-Token: ' . $session['loungeToken']
            ],
            CURLOPT_POSTFIELDS => http_build_query($postData),
            CURLOPT_TIMEOUT => 7,
            CURLOPT_IPRESOLVE => CURL_IPRESOLVE_V4
        ]);
        $reply = (string)curl_exec($ch2);
        curl_close($ch2);

        return [
            'ok' => true,
            'action' => $act,
            'screenId' => $screenId,
            'theme' => $session['theme'],
            'reply' => trim($reply)
        ];
    }

    /**
     * Launch the native YouTube (233637DE) or YouTube Music (2DB7CC49) Cast Receiver, negotiate an MDX screenId over CastV2,
     * bind a YouTube Lounge session in pure PHP cURL, and start playing a video or album playlist.
     */
    public function playYouTubeMdx(array $videoIds, string $listId = '', string $preferredAppId = '233637DE'): array
    {
        $cleanIds = array_values(array_filter(array_map('trim', $videoIds), static fn($v) => preg_match('/^[a-zA-Z0-9_-]{11}$/', $v) === 1));
        if (empty($cleanIds)) {
            throw new InvalidArgumentException('At least one valid 11-character YouTube videoId is required.');
        }

        $appOrder = $preferredAppId === '2DB7CC49' ? ['2DB7CC49', '233637DE'] : ['233637DE', '2DB7CC49'];
        $status = $this->getStatus();
        $transportId = '';
        $activeAppId = '';
        foreach (($status['applications'] ?? []) as $app) {
            $aid = (string)($app['appId'] ?? '');
            if ($aid === $preferredAppId && !empty($app['transportId'])) {
                $transportId = (string)$app['transportId'];
                $activeAppId = $aid;
                break;
            }
        }

        if ($transportId === '') {
            foreach ($appOrder as $tryAppId) {
                try {
                    $launchRid = $this->nextReqId();
                    $this->send($this->senderId, 'receiver-0', self::NS_RECEIVER, [
                        'type' => 'LAUNCH',
                        'appId' => $tryAppId,
                        'requestId' => $launchRid
                    ]);
                    $launchReply = $this->waitForReply($launchRid, 'RECEIVER_STATUS', 8.0);
                    foreach (($launchReply['status']['applications'] ?? []) as $app) {
                        if (($app['appId'] ?? '') === $tryAppId && !empty($app['transportId'])) {
                            $transportId = (string)$app['transportId'];
                            $activeAppId = $tryAppId;
                            break 2;
                        }
                    }
                } catch (Throwable $e) {
                    // Try next app ID in order
                }
            }
        }

        if ($transportId === '') {
            throw new RuntimeException('Could not launch YouTube / YouTube Music receiver on Cast device.');
        }

        $this->connectTransport($transportId);
        $this->send($this->senderId, $transportId, 'urn:x-cast:com.google.youtube.mdx', [
            'type' => 'getMdxSessionStatus',
            'requestId' => $this->nextReqId()
        ]);

        $screenId = '';
        $deadline = microtime(true) + 4.5;
        while (microtime(true) < $deadline) {
            $msg = $this->readMessage(max(0.2, $deadline - microtime(true)));
            if (!$msg) continue;
            if ($msg['namespace'] === self::NS_HEARTBEAT && ($msg['data']['type'] ?? '') === 'PING') {
                $this->send($this->senderId, 'receiver-0', self::NS_HEARTBEAT, ['type' => 'PONG']);
                continue;
            }
            if (($msg['namespace'] ?? '') === 'urn:x-cast:com.google.youtube.mdx') {
                $screenId = (string)($msg['data']['data']['screenId'] ?? '');
                if ($screenId !== '') break;
            }
        }

        if ($screenId === '') {
            throw new RuntimeException('Cast device did not provide a YouTube MDX screenId.');
        }

        $theme = $activeAppId === '2DB7CC49' ? 'm' : 'cl';

        // Close the CastV2 socket before running external YouTube Lounge HTTP requests so the
        // Cast TLS connection never times out or drops while waiting on cURL.
        $this->close();

        $cloudRes = self::playYouTubeLoungeCloud($screenId, $theme, $cleanIds, $listId);
        if (empty($cloudRes['ok'])) {
            throw new RuntimeException('Failed to bind YouTube Lounge session (' . ($cloudRes['reason'] ?? 'unknown') . ').');
        }
        $theme = (string)($cloudRes['theme'] ?? $theme);

        $state = [
            'app' => null,
            'mediaSession' => null,
            'mdxScreenId' => $screenId,
            'mdxTheme' => $theme,
            'mdxAppId' => $activeAppId
        ];
        for ($attempt = 0; $attempt < 3; $attempt++) {
            usleep($attempt === 0 ? 1500000 : 1000000);
            try {
                $this->close();
                if ($this->lastHost !== '') {
                    $this->connect($this->lastHost, $this->lastPort, $this->lastTimeout);
                    $liveState = $this->getMediaState(null, true);
                    $state = array_merge($state, $liveState);
                    $ps = strtoupper((string)($state['mediaSession']['playerState'] ?? ''));
                    if (in_array($ps, ['PLAYING', 'BUFFERING'], true)) {
                        return $state;
                    }
                }
            } catch (Throwable $e) {
                // Retry on next attempt
            }
        }
        return $state;
    }

    private function nextReqId(): int
    {
        return $this->reqId++;
    }

    private function send(string $sourceId, string $destId, string $namespace, array $payload): void
    {
        $json = json_encode($payload, JSON_UNESCAPED_SLASHES);
        $proto =
            "\x08\x00" .
            $this->pbString(2, $sourceId) .
            $this->pbString(3, $destId) .
            $this->pbString(4, $namespace) .
            "\x28\x00" .
            $this->pbString(6, $json);

        $frame = pack('N', strlen($proto)) . $proto;
        $written = 0;
        $total = strlen($frame);
        while ($written < $total) {
            $n = @fwrite($this->sock, substr($frame, $written));
            if ($n === false || $n === 0) {
                throw new RuntimeException('Socket write failed while sending CastMessage');
            }
            $written += $n;
        }
    }

    private function waitForReply(int $requestId, string $expectedType, float $timeoutSec = 5.0): array
    {
        $deadline = microtime(true) + $timeoutSec;
        while (microtime(true) < $deadline) {
            $msg = $this->readMessage(max(0.15, $deadline - microtime(true)));
            if (!$msg) continue;

            if ($msg['namespace'] === self::NS_HEARTBEAT && ($msg['data']['type'] ?? '') === 'PING') {
                $this->send($this->senderId, 'receiver-0', self::NS_HEARTBEAT, ['type' => 'PONG']);
                continue;
            }

            $data = $msg['data'];
            if (isset($data['requestId']) && (int)$data['requestId'] === $requestId) {
                if (($data['type'] ?? '') === 'LAUNCH_ERROR') {
                    throw new RuntimeException('Cast launch error: ' . ($data['reason'] ?? 'unknown'));
                }
                return $data;
            }

            if ($expectedType && ($data['type'] ?? '') === $expectedType && !isset($data['requestId'])) {
                return $data;
            }
        }
        return [];
    }

    private function waitForMediaReply(int $requestId, float $timeoutSec = 8.0): array
    {
        $deadline = microtime(true) + $timeoutSec;
        while (microtime(true) < $deadline) {
            $msg = $this->readMessage(max(0.15, $deadline - microtime(true)));
            if (!$msg) continue;

            if ($msg['namespace'] === self::NS_HEARTBEAT && ($msg['data']['type'] ?? '') === 'PING') {
                $this->send($this->senderId, 'receiver-0', self::NS_HEARTBEAT, ['type' => 'PONG']);
                continue;
            }

            $data = $msg['data'];
            if (isset($data['requestId']) && (int)$data['requestId'] === $requestId) {
                return $data;
            }
            if ($msg['namespace'] === self::NS_MEDIA && in_array($data['type'] ?? '', ['MEDIA_STATUS', 'LOAD_FAILED', 'INVALID_REQUEST', 'INVALID_PLAYER_STATE'], true)) {
                return $data;
            }
        }
        return [];
    }

    private function readMessage(float $timeoutSec): ?array
    {
        $meta = @stream_get_meta_data($this->sock);
        if (empty($meta['unread_bytes'])) {
            $read = [$this->sock];
            $write = null;
            $except = null;
            $sec = (int)$timeoutSec;
            $usec = (int)(($timeoutSec - $sec) * 1000000);
            if (@stream_select($read, $write, $except, $sec, $usec) <= 0) {
                return null;
            }
        }

        $lenBytes = $this->readExact(4);
        if (strlen($lenBytes) < 4) return null;
        $unpacked = unpack('Nlen', $lenBytes);
        $len = $unpacked['len'];
        if ($len <= 0 || $len > 1048576) return null;

        $proto = $this->readExact($len);
        if (strlen($proto) < $len) return null;

        return $this->decodeCastMessage($proto);
    }

    private function readExact(int $length): string
    {
        $buf = '';
        $attempts = 0;
        while (strlen($buf) < $length && $attempts++ < 250) {
            $chunk = @fread($this->sock, $length - strlen($buf));
            if ($chunk === false) break;
            if ($chunk === '') {
                $meta = stream_get_meta_data($this->sock);
                if (!empty($meta['eof']) || !empty($meta['timed_out'])) break;
                usleep(4000);
                continue;
            }
            $buf .= $chunk;
        }
        return $buf;
    }

    private function pbString(int $fieldNum, string $value): string
    {
        $tag = ($fieldNum << 3) | 2;
        return $this->pbVarint($tag) . $this->pbVarint(strlen($value)) . $value;
    }

    private function pbVarint(int $n): string
    {
        $out = '';
        while ($n >= 0x80) {
            $out .= chr(($n & 0x7F) | 0x80);
            $n >>= 7;
        }
        $out .= chr($n & 0x7F);
        return $out;
    }

    private function decodeCastMessage(string $bytes): array
    {
        $pos = 0;
        $len = strlen($bytes);
        $fields = [
            'sourceId' => '',
            'destinationId' => '',
            'namespace' => '',
            'payloadUtf8' => ''
        ];

        while ($pos < $len) {
            $tag = $this->readVarint($bytes, $pos);
            $fieldNum = $tag >> 3;
            $wireType = $tag & 0x07;

            if ($wireType === 0) {
                $this->readVarint($bytes, $pos);
            } elseif ($wireType === 2) {
                $slen = $this->readVarint($bytes, $pos);
                $val = substr($bytes, $pos, $slen);
                $pos += $slen;
                if ($fieldNum === 2) $fields['sourceId'] = $val;
                elseif ($fieldNum === 3) $fields['destinationId'] = $val;
                elseif ($fieldNum === 4) $fields['namespace'] = $val;
                elseif ($fieldNum === 6) $fields['payloadUtf8'] = $val;
            } elseif ($wireType === 1) {
                $pos += 8;
            } elseif ($wireType === 5) {
                $pos += 4;
            } else {
                break;
            }
        }

        $data = [];
        if ($fields['payloadUtf8'] !== '') {
            $decoded = json_decode($fields['payloadUtf8'], true);
            if (is_array($decoded)) $data = $decoded;
        }

        return [
            'sourceId' => $fields['sourceId'],
            'destinationId' => $fields['destinationId'],
            'namespace' => $fields['namespace'],
            'data' => $data
        ];
    }

    private function readVarint(string $bytes, int &$pos): int
    {
        $res = 0;
        $shift = 0;
        $len = strlen($bytes);
        while ($pos < $len) {
            $b = ord($bytes[$pos++]);
            $res |= ($b & 0x7F) << $shift;
            if (($b & 0x80) === 0) break;
            $shift += 7;
        }
        return $res;
    }
}
