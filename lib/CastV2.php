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

    private $sock = null;
    private string $senderId;
    private int $reqId = 1;
    private array $connectedTransports = [];

    public function __construct()
    {
        $this->senderId = 'sender-' . random_int(1000, 99999);
    }

    public function connect(string $host, int $port = 8009, float $timeout = 4.5): void
    {
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
            foreach (array_keys($this->connectedTransports) as $destId) {
                try {
                    $this->send($this->senderId, (string)$destId, self::NS_CONNECTION, ['type' => 'CLOSE']);
                } catch (Throwable $e) {
                    // Ignore socket errors during cleanup
                }
            }
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

        return [
            'mediaSessionId' => isset($ms['mediaSessionId']) ? (int)$ms['mediaSessionId'] : null,
            'playerState' => strtoupper((string)($ms['playerState'] ?? 'UNKNOWN')),
            'playbackRate' => isset($ms['playbackRate']) ? (float)$ms['playbackRate'] : 1.0,
            'currentTime' => isset($ms['currentTime']) ? round((float)$ms['currentTime'], 2) : 0.0,
            'supportedMediaCommands' => $cmds,
            'canPause' => (($cmds & 1) !== 0),
            'canSeek' => (($cmds & 2) !== 0),
            'canNext' => (($cmds & 64) !== 0),
            'canPrev' => (($cmds & 128) !== 0),
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
                }
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
        $state = $this->getMediaState(null, true);
        $app = $state['app'] ?? null;
        if (!$app) {
            throw new RuntimeException('No active media app is currently running on this Cast device.');
        }
        $transportId = (string)($app['transportId'] ?? '');
        $appName = $app['displayName'] ?: 'Cast app';
        if ($transportId === '' || empty($app['supportsMedia'])) {
            throw new RuntimeException("{$appName} does not expose Google Cast media transport controls.");
        }

        $ms = $state['mediaSession'] ?? null;
        if (!$ms || empty($ms['mediaSessionId'])) {
            throw new RuntimeException("{$appName} is open, but no track or video is currently loaded.");
        }

        $msid = (int)$ms['mediaSessionId'];
        $playerState = (string)($ms['playerState'] ?? 'UNKNOWN');
        $curTime = (float)($ms['currentTime'] ?? 0.0);
        $dur = $ms['duration'] ?? null;
        $actionNorm = strtolower(trim($action));
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

    public function loadMedia(string $streamUrl, string $contentType, string $title = 'Treva Live Cast', string $subtitle = 'Screen & Sound'): array
    {
        $transportId = $this->ensureDefaultMediaReceiver(false);
        $reply = $this->sendLoad($transportId, $streamUrl, $contentType, $title, $subtitle);

        // If stale receiver session rejected LOAD, relaunch a clean DefaultMediaReceiver and retry once
        if (in_array($reply['type'] ?? '', ['LOAD_FAILED', 'INVALID_REQUEST'], true)) {
            $this->stopCurrentApp();
            usleep(250000);
            $transportId = $this->ensureDefaultMediaReceiver(true);
            $reply = $this->sendLoad($transportId, $streamUrl, $contentType, $title, $subtitle);
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

    private function sendLoad(string $transportId, string $streamUrl, string $contentType, string $title, string $subtitle): array
    {
        $isAudio = str_starts_with($contentType, 'audio/');
        $loadRid = $this->nextReqId();
        $this->send($this->senderId, $transportId, self::NS_MEDIA, [
            'type' => 'LOAD',
            'requestId' => $loadRid,
            'autoplay' => true,
            'currentTime' => 0,
            'media' => [
                'contentId' => $streamUrl,
                'contentType' => $contentType,
                'streamType' => 'LIVE',
                'metadata' => [
                    'type' => 0,
                    'metadataType' => $isAudio ? 3 : 1,
                    'title' => $title,
                    'subtitle' => $subtitle,
                    'artist' => $subtitle
                ]
            ]
        ]);

        return $this->waitForMediaReply($loadRid, 8.0);
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
