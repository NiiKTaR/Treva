<?php
/**
 * Treva Cast - Pure PHP Live Stream Endpoint
 * Serves continuous MP3 (audio/mpeg) or WebM (video/webm) chunks to Google Nest & Chromecast.
 * Includes silent MPEG frame keep-alive so Google Nest never drops out during brief gaps.
 */

@error_reporting(0);
@ini_set('display_errors', '0');

require_once __DIR__ . '/lib/NetworkHelper.php';
require_once __DIR__ . '/lib/StreamStore.php';

$sid = StreamStore::sanitizeId($_GET['sid'] ?? 'live');
$fmt = (($_GET['fmt'] ?? 'mp3') === 'webm') ? 'webm' : 'mp3';
$contentType = ($fmt === 'webm') ? 'video/webm' : 'audio/mpeg';

@set_time_limit(0);
@ignore_user_abort(false);
@ini_set('zlib.output_compression', '0');
@ini_set('output_buffering', 'off');
@ini_set('implicit_flush', '1');
if (function_exists('apache_setenv')) {
    @apache_setenv('no-gzip', '1');
}

while (ob_get_level() > 0) {
    @ob_end_clean();
}
ob_implicit_flush(true);

header("Content-Type: {$contentType}");
header('Cache-Control: no-cache, no-store, must-revalidate, no-transform');
header('Pragma: no-cache');
header('Expires: 0');
header('Accept-Ranges: none');
header('Connection: keep-alive');
header('Content-Encoding: none');
header('Access-Control-Allow-Origin: *');
header('X-Accel-Buffering: no');
header('X-LiteSpeed-Cache-Control: no-cache');
header('X-Content-Type-Options: nosniff');
if ($fmt === 'mp3') {
    header('icy-name: Treva Live Audio Stream');
}

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'HEAD') {
    exit;
}

function makeSilentMp3Frame(int $sampleRate = 44100): string
{
    if ($sampleRate === 48000) {
        // MPEG-1 Layer 3, 192kbps, 48kHz, Stereo, padding=0 -> 576 bytes
        return "\xFF\xFB\xB4\x00" . str_repeat("\x00", 572);
    }
    // MPEG-1 Layer 3, 192kbps, 44.1kHz, Stereo, padding=0 -> 626 bytes
    return "\xFF\xFB\xB0\x00" . str_repeat("\x00", 622);
}

$store = new StreamStore();
$listenerId = bin2hex(random_bytes(6));
$store->touchListener($sid, $listenerId, $fmt);

// Wait up to 8 seconds for stream to begin if Nest connects slightly before first chunk
$waitStart = microtime(true);
while ((microtime(true) - $waitStart) < 8.0) {
    $st = $store->getFormatState($sid, $fmt);
    if (($st['seq'] ?? 0) > 0) {
        break;
    }
    if (connection_aborted()) {
        $store->removeListener($sid, $listenerId, $fmt);
        exit;
    }
    usleep(40000);
}

$state = $store->getFormatState($sid, $fmt);
$latestSeq = (int)($state['seq'] ?? 0);
$sampleRate = (int)($state['sampleRate'] ?? 44100);
$nextSeq = 1;

if ($fmt === 'mp3') {
    // Pre-buffer up to 6 recent chunks (~1.5-2s) for smooth Nest playback start
    $nextSeq = max(1, $latestSeq - 5);
} else {
    $initSeq = (int)($state['initSeq'] ?? 0);
    $initChunkExists = $initSeq > 0 && is_file($store->chunkPath($sid, 'webm', $initSeq));
    if ($initChunkExists && ($latestSeq - $initSeq) <= 4) {
        $nextSeq = $initSeq;
    } else {
        $prevInit = $initSeq;
        $store->requestWebmKeyframe($sid);
        $kfWait = microtime(true);
        $freshInit = 0;
        while ((microtime(true) - $kfWait) < 6.0) {
            if (connection_aborted()) {
                $store->removeListener($sid, $listenerId, $fmt);
                exit;
            }
            $s2 = $store->getFormatState($sid, 'webm');
            $cand = (int)($s2['initSeq'] ?? 0);
            if ($cand > $prevInit && is_file($store->chunkPath($sid, 'webm', $cand))) {
                $freshInit = $cand;
                break;
            }
            usleep(35000);
        }
        if ($freshInit > 0) {
            $nextSeq = $freshInit;
        } elseif ($initChunkExists) {
            $nextSeq = $initSeq;
        } else {
            $nextSeq = $latestSeq + 1;
        }
    }
}

$lastTouch = time();
$lastDataOut = microtime(true);
$lastKeepAlive = microtime(true);
$lastRealChunkAt = microtime(true);

while (!connection_aborted()) {
    $now = time();
    if ($now - $lastTouch >= 2) {
        $store->touchListener($sid, $listenerId, $fmt);
        $lastTouch = $now;
    }

    $chunkFile = $store->chunkPath($sid, $fmt, $nextSeq);
    if (is_file($chunkFile)) {
        $data = @file_get_contents($chunkFile);
        if ($data !== false && $data !== '') {
            echo $data;
            @flush();
            $nowMicro = microtime(true);
            $lastDataOut = $nowMicro;
            $lastRealChunkAt = $nowMicro;
        }
        $nextSeq++;
        continue;
    }

    // Check if the stream fell far behind or if sampleRate updated
    $curState = $store->getFormatState($sid, $fmt);
    if (!empty($curState['sampleRate'])) {
        $sampleRate = (int)$curState['sampleRate'];
    }
    $curSeq = (int)($curState['seq'] ?? 0);
    if ($fmt === 'mp3' && $curSeq > $nextSeq + 30) {
        $nextSeq = max(1, $curSeq - 5);
        continue;
    }

    $status = $store->getStreamStatus($sid);
    $isStreaming = !empty($status['isStreaming']);

    $nowMicro = microtime(true);
    // Keep MP3 decoder fed with valid silent frames if gap exceeds 750ms while stream is active
    if ($fmt === 'mp3' && $isStreaming && ($nowMicro - $lastDataOut) > 0.75 && ($nowMicro - $lastKeepAlive) > 0.25) {
        echo str_repeat(makeSilentMp3Frame($sampleRate), 4);
        @flush();
        $lastDataOut = $nowMicro;
        $lastKeepAlive = $nowMicro;
    }

    if (connection_aborted()) {
        break;
    }

    // End cleanly when capture stops (allow 2.5s tail to drain final queued chunks).
    // While $isStreaming is true (refreshed by chunks or 8s client heartbeats up to 60s), keep streaming without dropping at 25s!
    if (!$isStreaming && ($nowMicro - $lastRealChunkAt) > 2.5) {
        break;
    }

    usleep(20000);
}

$store->removeListener($sid, $listenerId, $fmt);
