<?php
/**
 * Pure PHP Internet Media & Album Resolver powered by OpenAI gpt-6-luna (Responses API + Web Search)
 * Resolves any natural-language music, album, song, video, or radio request into:
 *   1. Native YouTube MDX video/playlist IDs for Chromecast / Google TV / Nest Hub displays
 *   2. Direct multi-track audio queues (MP3/M4A/AAC) for Google Nest Speakers & Cast Speaker Groups
 */
class WebMediaResolver
{
    public static function resolvePlayableMedia(StreamStore $store, string $query): array
    {
        $cleanQuery = trim($query);
        if ($cleanQuery === '') {
            throw new InvalidArgumentException('A search query or media request is required.');
        }

        // If user passed a direct playable URL or YouTube URL directly
        if (preg_match('/^https?:\/\/\S+/i', $cleanQuery, $um)) {
            $directUrl = $um[0];
            if (preg_match('/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/i', $directUrl, $ym)) {
                $vid = $ym[1];
                return [
                    'query' => $cleanQuery,
                    'model' => 'direct_url',
                    'intent' => 'video',
                    'artist' => 'YouTube',
                    'title' => 'YouTube Video (' . $vid . ')',
                    'album' => '',
                    'year' => '',
                    'summary' => 'Direct YouTube URL',
                    'youtubeVideoIds' => [$vid],
                    'youtubeListId' => '',
                    'audioTracks' => []
                ];
            }
            return [
                'query' => $cleanQuery,
                'model' => 'direct_url',
                'intent' => 'url',
                'artist' => 'Treva Direct Stream',
                'title' => basename((string)parse_url($directUrl, PHP_URL_PATH)) ?: 'Web Stream',
                'album' => '',
                'year' => '',
                'summary' => 'Direct media stream URL',
                'youtubeVideoIds' => [],
                'youtubeListId' => '',
                'audioTracks' => [[
                    'url' => $directUrl,
                    'contentType' => self::guessContentType($directUrl),
                    'streamType' => 'BUFFERED',
                    'title' => basename((string)parse_url($directUrl, PHP_URL_PATH)) ?: 'Web Stream',
                    'artist' => 'Web Stream',
                    'album' => '',
                    'imageUrl' => ''
                ]]
            ];
        }

        // Step 1: Use gpt-6-luna with live web search to identify the exact latest album, song, artist, or stream
        $luna = self::queryGpt6LunaWebSearch($store, $cleanQuery);

        $intent = strtolower(trim((string)($luna['intent'] ?? 'album')));
        $artist = trim((string)($luna['artist'] ?? ''));
        $title = trim((string)($luna['title'] ?? ($luna['album'] ?? $cleanQuery)));
        $album = trim((string)($luna['album'] ?? ($intent === 'album' ? $title : '')));
        $year = trim((string)($luna['year'] ?? ''));
        $searchQuery = trim((string)($luna['searchQuery'] ?? trim("{$artist} {$title}"))) ?: $cleanQuery;
        $ytQuery = trim((string)($luna['youtubeQuery'] ?? trim("{$artist} {$title} {$year}"))) ?: $searchQuery;
        $lunaTracks = is_array($luna['tracks'] ?? null) ? $luna['tracks'] : [];
        $directStreamUrl = trim((string)($luna['directStreamUrl'] ?? ''));
        $summary = trim((string)($luna['summary'] ?? ''));

        $audioTracks = [];
        $imageUrl = trim((string)($luna['imageUrl'] ?? ''));

        // Step 2A: If gpt-6-luna found a direct playable audio/video stream URL
        if ($directStreamUrl !== '' && preg_match('/^https?:\/\/.+\.(mp3|m4a|aac|ogg|wav|mp4|webm|m3u8)(\?.*)?$/i', $directStreamUrl)) {
            $audioTracks[] = [
                'url' => $directStreamUrl,
                'contentType' => self::guessContentType($directStreamUrl),
                'streamType' => str_ends_with(strtolower($directStreamUrl), '.m3u8') ? 'LIVE' : 'BUFFERED',
                'title' => $title ?: $cleanQuery,
                'artist' => $artist ?: 'Web Stream',
                'album' => $album,
                'imageUrl' => $imageUrl
            ];
        }

        // Step 2B: If request is a live radio station
        if (empty($audioTracks) && ($intent === 'radio' || preg_match('/\b(radio|fm|station)\b/i', $cleanQuery))) {
            $radioTracks = self::searchRadioBrowser($searchQuery);
            if (!empty($radioTracks)) {
                $audioTracks = $radioTracks;
            }
        }

        // Step 2C: Resolve album / track queue via Deezer API (exact match for gpt-6-luna's resolved album/track)
        if (empty($audioTracks)) {
            $dzTracks = self::searchDeezer($artist, $title, $album, $intent);
            if (!empty($dzTracks)) {
                $audioTracks = $dzTracks;
                if ($imageUrl === '' && !empty($dzTracks[0]['imageUrl'])) {
                    $imageUrl = $dzTracks[0]['imageUrl'];
                }
                if ($album === '' && !empty($dzTracks[0]['album'])) {
                    $album = $dzTracks[0]['album'];
                }
                if ($artist === '' && !empty($dzTracks[0]['artist'])) {
                    $artist = $dzTracks[0]['artist'];
                }
            }
        }

        // Step 2D: Fallback to Apple iTunes Search & Lookup API
        if (empty($audioTracks)) {
            $itTracks = self::searchItunes($artist, $title, $album, $intent);
            if (!empty($itTracks)) {
                $audioTracks = $itTracks;
                if ($imageUrl === '' && !empty($itTracks[0]['imageUrl'])) {
                    $imageUrl = $itTracks[0]['imageUrl'];
                }
            }
        }

        // Step 2E: Fallback to Internet Archive full-length MP3 search
        if (empty($audioTracks)) {
            $iaTracks = self::searchInternetArchive($searchQuery, $artist, $album);
            if (!empty($iaTracks)) {
                $audioTracks = $iaTracks;
            }
        }

        // Step 3: Resolve YouTube videoIds for native YouTube Cast Receiver (Chromecast / Google TV / Nest Hub)
        $youtubeVideoIds = [];
        if (!empty($luna['youtubeUrl']) && preg_match('/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/', (string)$luna['youtubeUrl'], $ym)) {
            $youtubeVideoIds[] = $ym[1];
        }
        $combinedTrackTitles = $lunaTracks;
        foreach ($audioTracks as $at) {
            $tName = trim((string)($at['title'] ?? ''));
            if ($tName !== '' && !in_array($tName, $combinedTrackTitles, true)) {
                $combinedTrackTitles[] = $tName;
            }
        }
        $searchedVids = self::searchYouTubeVideoIds($ytQuery, $artist, $album, $combinedTrackTitles, $intent);
        foreach ($searchedVids as $vid) {
            if (!in_array($vid, $youtubeVideoIds, true)) {
                $youtubeVideoIds[] = $vid;
            }
        }

        if ($summary === '') {
            $trackCount = count($audioTracks);
            $summary = $artist !== ''
                ? "Resolved '{$title}' by {$artist}" . ($year !== '' ? " ({$year})" : '') . ($trackCount > 1 ? " — {$trackCount} tracks" : '')
                : "Resolved '{$title}'";
        }

        return [
            'query' => $cleanQuery,
            'model' => $luna['modelUsed'] ?? 'gpt-6-luna',
            'intent' => $intent,
            'artist' => $artist,
            'title' => $title,
            'album' => $album,
            'year' => $year,
            'imageUrl' => $imageUrl,
            'summary' => $summary,
            'youtubeVideoIds' => array_slice($youtubeVideoIds, 0, 20),
            'youtubeListId' => '',
            'audioTracks' => $audioTracks
        ];
    }

    public static function queryGpt6LunaWebSearch(StreamStore $store, string $query): array
    {
        $cacheDir = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'data' . DIRECTORY_SEPARATOR . 'streams' . DIRECTORY_SEPARATOR . 'web_cache';
        if (!is_dir($cacheDir)) {
            @mkdir($cacheDir, 0775, true);
        }
        $cacheFile = $cacheDir . DIRECTORY_SEPARATOR . 'luna-' . substr(sha1(strtolower(trim($query))), 0, 20) . '.json';
        if (is_file($cacheFile) && (time() - (int)@filemtime($cacheFile)) < 1800) {
            $cached = json_decode((string)@file_get_contents($cacheFile), true);
            if (is_array($cached) && !empty($cached['searchQuery'])) {
                return $cached;
            }
        }

        $apiKey = class_exists('OpenAiAgent') ? OpenAiAgent::resolveApiKey($store) : '';
        if ($apiKey === '' && defined('OPENAI_API_KEY')) {
            $apiKey = trim((string)OPENAI_API_KEY);
        }

        if ($apiKey === '') {
            return [
                'modelUsed' => 'fallback_parser',
                'intent' => preg_match('/\balbum\b/i', $query) ? 'album' : 'track',
                'artist' => '',
                'title' => $query,
                'album' => '',
                'year' => '',
                'searchQuery' => preg_replace('/^(play|put on|listen to|cast|stream|reproducir|pon|poner)\s+/i', '', $query) ?: $query,
                'youtubeQuery' => $query,
                'tracks' => [],
                'summary' => ''
            ];
        }

        $prompt = "The user wants to play media on their Google Nest / Chromecast: \"{$query}\".\n"
            . "Use web search to find the exact, up-to-date release (especially if they ask for 'latest', 'new', or a current album/song).\n"
            . "Return ONLY a valid JSON object (no markdown fences) with these exact keys:\n"
            . "{\n"
            . "  \"intent\": \"album\" | \"track\" | \"playlist\" | \"video\" | \"radio\",\n"
            . "  \"artist\": \"Exact artist name\",\n"
            . "  \"title\": \"Exact album or song title\",\n"
            . "  \"album\": \"Exact album name (if applicable)\",\n"
            . "  \"year\": \"Release year\",\n"
            . "  \"searchQuery\": \"Clean Artist + Album/Track search query\",\n"
            . "  \"youtubeQuery\": \"Best YouTube search query for official audio/video\",\n"
            . "  \"tracks\": [\"Track 1 title\", \"Track 2 title\"],\n"
            . "  \"directStreamUrl\": \"Direct .mp3/.m4a/.mp4/.m3u8 URL if publicly known, else empty string\",\n"
            . "  \"youtubeUrl\": \"Direct youtube.com/watch?v=... URL if found, else empty string\",\n"
            . "  \"summary\": \"Short 1-sentence summary of what was found\"\n"
            . "}";

        $payload = [
            'model' => 'gpt-6-luna',
            'reasoning' => ['effort' => 'low'],
            'tools' => [
                ['type' => 'web_search_preview']
            ],
            'input' => $prompt
        ];

        $ch = curl_init('https://api.openai.com/v1/responses');
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POST => true,
            CURLOPT_HTTPHEADER => [
                "Authorization: Bearer {$apiKey}",
                'Content-Type: application/json'
            ],
            CURLOPT_POSTFIELDS => json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            CURLOPT_TIMEOUT => 30,
            CURLOPT_IPRESOLVE => CURL_IPRESOLVE_V4
        ]);
        $raw = curl_exec($ch);
        $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        $outText = '';
        if ($raw !== false && $code < 400) {
            $res = json_decode((string)$raw, true);
            foreach ($res['output'] ?? [] as $item) {
                if (($item['type'] ?? '') === 'message') {
                    foreach ($item['content'] ?? [] as $part) {
                        if (($part['type'] ?? '') === 'output_text' && isset($part['text'])) {
                            $outText .= (string)$part['text'];
                        }
                    }
                }
            }
            if ($outText === '' && is_string($res['output_text'] ?? null)) {
                $outText = $res['output_text'];
            }
        }

        $parsed = null;
        if ($outText !== '') {
            $cleanJson = trim($outText);
            if (preg_match('/\{[\s\S]*\}/', $cleanJson, $jm)) {
                $parsed = json_decode($jm[0], true);
            }
        }

        if (!is_array($parsed) || empty($parsed['searchQuery'])) {
            $cleanFallback = trim((string)preg_replace('/^(play|put on|listen to|cast|stream|reproducir|pon|poner|the|latest|new)\s+/i', '', $query)) ?: $query;
            $parsed = [
                'modelUsed' => 'gpt-6-luna',
                'intent' => preg_match('/\balbum\b/i', $query) ? 'album' : 'track',
                'artist' => '',
                'title' => $cleanFallback,
                'album' => '',
                'year' => '',
                'searchQuery' => $cleanFallback,
                'youtubeQuery' => $cleanFallback,
                'tracks' => [],
                'directStreamUrl' => '',
                'youtubeUrl' => '',
                'summary' => "Searched for {$cleanFallback}"
            ];
        } else {
            $parsed['modelUsed'] = 'gpt-6-luna';
            @file_put_contents($cacheFile, json_encode($parsed, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), LOCK_EX);
        }

        return $parsed;
    }

    private static function searchDeezer(string $artist, string $title, string $album, string $intent): array
    {
        $wantAlbum = ($intent === 'album' || $album !== '');
        $q = trim($artist . ' ' . ($album !== '' ? $album : $title));
        if ($q === '') return [];

        if ($wantAlbum) {
            $albSearch = self::httpGetJson('https://api.deezer.com/search/album?q=' . urlencode($q) . '&limit=6');
            $candidates = $albSearch['data'] ?? [];
            if (empty($candidates) && $artist !== '') {
                // Fetch artist's albums sorted by release or match title
                $albSearch = self::httpGetJson('https://api.deezer.com/search/album?q=' . urlencode($artist) . '&limit=15');
                $candidates = $albSearch['data'] ?? [];
            }

            $bestAlbum = null;
            $targetFold = strtolower(trim($album ?: $title));
            $artistFold = strtolower(trim($artist));

            foreach ($candidates as $cand) {
                $cTitle = strtolower(trim((string)($cand['title'] ?? '')));
                $cArtist = strtolower(trim((string)($cand['artist']['name'] ?? '')));
                if ($artistFold !== '' && str_contains($cArtist, $artistFold) && $targetFold !== '' && str_contains($cTitle, $targetFold)) {
                    $bestAlbum = $cand;
                    break;
                }
            }
            if (!$bestAlbum && !empty($candidates)) {
                $bestAlbum = $candidates[0];
            }

            if ($bestAlbum && !empty($bestAlbum['id'])) {
                $albId = $bestAlbum['id'];
                $albData = self::httpGetJson("https://api.deezer.com/album/{$albId}");
                $cover = (string)($albData['cover_xl'] ?? ($albData['cover_big'] ?? ($bestAlbum['cover_xl'] ?? '')));
                $albName = (string)($albData['title'] ?? ($bestAlbum['title'] ?? $album));
                $artName = (string)($albData['artist']['name'] ?? ($bestAlbum['artist']['name'] ?? $artist));
                $out = [];
                foreach ($albData['tracks']['data'] ?? [] as $t) {
                    $preview = trim((string)($t['preview'] ?? ''));
                    if ($preview === '') continue;
                    $out[] = [
                        'url' => $preview,
                        'contentType' => 'audio/mpeg',
                        'streamType' => 'BUFFERED',
                        'title' => (string)($t['title'] ?? 'Track'),
                        'artist' => (string)($t['artist']['name'] ?? $artName),
                        'album' => $albName,
                        'imageUrl' => $cover,
                        'duration' => isset($t['duration']) ? (int)$t['duration'] : 30
                    ];
                }
                if (!empty($out)) {
                    return $out;
                }
            }
        }

        // Single track or playlist fallback on Deezer
        $trkSearch = self::httpGetJson('https://api.deezer.com/search/track?q=' . urlencode($q) . '&limit=12');
        $out = [];
        foreach ($trkSearch['data'] ?? [] as $t) {
            $preview = trim((string)($t['preview'] ?? ''));
            if ($preview === '') continue;
            $out[] = [
                'url' => $preview,
                'contentType' => 'audio/mpeg',
                'streamType' => 'BUFFERED',
                'title' => (string)($t['title'] ?? 'Track'),
                'artist' => (string)($t['artist']['name'] ?? $artist),
                'album' => (string)($t['album']['title'] ?? $album),
                'imageUrl' => (string)($t['album']['cover_xl'] ?? ($t['album']['cover_big'] ?? '')),
                'duration' => 30
            ];
            if ($intent === 'track' && count($out) >= 5) break;
        }
        return $out;
    }

    private static function searchItunes(string $artist, string $title, string $album, string $intent): array
    {
        $q = trim($artist . ' ' . ($album !== '' ? $album : $title));
        if ($q === '') return [];

        if ($intent === 'album' || $album !== '') {
            $albRes = self::httpGetJson('https://itunes.apple.com/search?term=' . urlencode($q) . '&entity=album&limit=5');
            $colId = $albRes['results'][0]['collectionId'] ?? null;
            if ($colId) {
                $lookup = self::httpGetJson("https://itunes.apple.com/lookup?id={$colId}&entity=song");
                $out = [];
                foreach ($lookup['results'] ?? [] as $r) {
                    if (($r['wrapperType'] ?? '') !== 'track' || empty($r['previewUrl'])) continue;
                    $artUrl = str_replace('100x100bb', '600x600bb', (string)($r['artworkUrl100'] ?? ''));
                    $out[] = [
                        'url' => (string)$r['previewUrl'],
                        'contentType' => 'audio/mp4',
                        'streamType' => 'BUFFERED',
                        'title' => (string)($r['trackName'] ?? 'Track'),
                        'artist' => (string)($r['artistName'] ?? $artist),
                        'album' => (string)($r['collectionName'] ?? $album),
                        'imageUrl' => $artUrl,
                        'duration' => 30
                    ];
                }
                if (!empty($out)) return $out;
            }
        }

        $songRes = self::httpGetJson('https://itunes.apple.com/search?term=' . urlencode($q) . '&entity=song&limit=10');
        $out = [];
        foreach ($songRes['results'] ?? [] as $r) {
            if (empty($r['previewUrl'])) continue;
            $artUrl = str_replace('100x100bb', '600x600bb', (string)($r['artworkUrl100'] ?? ''));
            $out[] = [
                'url' => (string)$r['previewUrl'],
                'contentType' => 'audio/mp4',
                'streamType' => 'BUFFERED',
                'title' => (string)($r['trackName'] ?? 'Track'),
                'artist' => (string)($r['artistName'] ?? $artist),
                'album' => (string)($r['collectionName'] ?? $album),
                'imageUrl' => $artUrl,
                'duration' => 30
            ];
        }
        return $out;
    }

    private static function searchRadioBrowser(string $query): array
    {
        $clean = trim((string)preg_replace('/\b(play|radio|station|stream|fm)\b/i', '', $query)) ?: $query;
        $url = 'https://de1.api.radio-browser.info/json/stations/search?name=' . urlencode($clean) . '&limit=5&hidebroken=true&order=clickcount&reverse=true';
        $stations = self::httpGetJson($url);
        if (!is_array($stations) || empty($stations)) {
            $urlTag = 'https://de1.api.radio-browser.info/json/stations/search?tag=' . urlencode($clean) . '&limit=5&hidebroken=true&order=clickcount&reverse=true';
            $stations = self::httpGetJson($urlTag);
        }
        $out = [];
        foreach (is_array($stations) ? $stations : [] as $st) {
            $streamUrl = trim((string)($st['url_resolved'] ?? ($st['url'] ?? '')));
            if ($streamUrl === '') continue;
            $out[] = [
                'url' => $streamUrl,
                'contentType' => 'audio/mpeg',
                'streamType' => 'LIVE',
                'title' => (string)($st['name'] ?? $clean),
                'artist' => (string)($st['country'] ?? 'Live Radio'),
                'album' => (string)($st['tags'] ?? 'Live Radio'),
                'imageUrl' => (string)($st['favicon'] ?? '')
            ];
        }
        return $out;
    }

    private static function searchInternetArchive(string $query, string $artist, string $album): array
    {
        $q = "({$query}) AND mediatype:(audio)";
        $url = 'https://archive.org/advancedsearch.php?q=' . urlencode($q) . '&fl[]=identifier,title,creator&rows=3&page=1&output=json';
        $data = self::httpGetJson($url);
        $docs = $data['response']['docs'] ?? [];
        foreach ($docs as $doc) {
            $id = $doc['identifier'] ?? '';
            if (!$id) continue;
            $meta = self::httpGetJson("https://archive.org/metadata/{$id}");
            $files = $meta['files'] ?? [];
            $out = [];
            foreach ($files as $f) {
                $name = (string)($f['name'] ?? '');
                if (!str_ends_with(strtolower($name), '.mp3')) continue;
                $out[] = [
                    'url' => "https://archive.org/download/{$id}/" . rawurlencode($name),
                    'contentType' => 'audio/mpeg',
                    'streamType' => 'BUFFERED',
                    'title' => (string)($f['title'] ?? pathinfo($name, PATHINFO_FILENAME)),
                    'artist' => (string)($f['creator'] ?? ($doc['creator'] ?? $artist ?: 'Internet Archive')),
                    'album' => (string)($doc['title'] ?? $album),
                    'imageUrl' => "https://archive.org/services/img/{$id}"
                ];
                if (count($out) >= 15) break;
            }
            if (!empty($out)) return $out;
        }
        return [];
    }

    public static function searchYouTubeVideoIds(string $query, string $artist = '', string $album = '', array $trackTitles = [], string $intent = 'track'): array
    {
        $candidates = self::fetchYouTubeVideoRenderers($query);
        if ($intent === 'album' && $artist !== '' && $album !== '' && count($candidates) < 5) {
            $extra = self::fetchYouTubeVideoRenderers("{$artist} {$album} Official Audio");
            foreach ($extra as $ex) {
                $candidates[$ex['videoId']] = $ex;
            }
        }

        $vids = [];
        if (!empty($candidates)) {
            $filtered = [];
            foreach ($candidates as $vid => $item) {
                $dur = (int)($item['durationSec'] ?? 0);
                $titleLower = strtolower((string)($item['title'] ?? ''));
                // Exclude YouTube Shorts (< 60s) when searching music/albums
                if ($intent !== 'video' && $dur > 0 && $dur < 60) {
                    continue;
                }
                // Exclude non-song documentaries, interviews, reactions, or trailers when playing an album/track
                if (in_array($intent, ['album', 'track'], true) && preg_match('/\b(documentary|interview|reaction|review|teaser|trailer|behind the scenes|making of)\b/i', $titleLower)) {
                    continue;
                }
                // Exclude multi-hour mixes unless explicitly a Full Album upload
                if ($intent === 'album' && $dur > 900 && !preg_match('/\bfull\s+album\b/i', $titleLower)) {
                    continue;
                }
                $filtered[$vid] = $item;
            }

            // 1. If we have album track titles, order matching official tracks in album sequence first
            if (!empty($trackTitles)) {
                foreach ($trackTitles as $tName) {
                    $normTrack = strtolower(trim((string)preg_replace('/[^a-zA-Z0-9\s]/', '', $tName)));
                    if ($normTrack === '' || strlen($normTrack) < 2) continue;
                    foreach ($filtered as $vid => $item) {
                        if (in_array($vid, $vids, true)) continue;
                        $dur = (int)($item['durationSec'] ?? 0);
                        if ($dur > 600) continue;
                        $normTitle = strtolower((string)preg_replace('/[^a-zA-Z0-9\s]/', '', (string)$item['title']));
                        if (str_contains($normTitle, $normTrack)) {
                            $vids[] = $vid;
                            break;
                        }
                    }
                }
            }

            // 2. Append remaining valid song videos from the search results
            foreach ($filtered as $vid => $item) {
                if (in_array($vid, $vids, true)) continue;
                $dur = (int)($item['durationSec'] ?? 0);
                if ($intent === 'album' && $dur > 600 && !empty($vids)) {
                    continue;
                }
                $vids[] = $vid;
                if (count($vids) >= 15) break;
            }
        }

        // Fallback if ytInitialData structure wasn't matched
        if (empty($vids)) {
            $html = self::httpGetRaw('https://www.youtube.com/results?search_query=' . urlencode($query));
            if ($html !== '' && preg_match_all('/"videoRenderer":\{"videoId":"([a-zA-Z0-9_-]{11})"/', $html, $m)) {
                foreach (array_unique($m[1]) as $v) {
                    $vids[] = $v;
                    if (count($vids) >= 12) break;
                }
            }
        }

        return array_slice($vids, 0, 15);
    }

    private static function fetchYouTubeVideoRenderers(string $query): array
    {
        $html = self::httpGetRaw('https://www.youtube.com/results?search_query=' . urlencode($query));
        if ($html === '' || !preg_match('/var ytInitialData = (\{.*?\});<\/script>/s', $html, $m)) {
            return [];
        }
        $data = json_decode($m[1], true);
        if (!is_array($data)) {
            return [];
        }
        $out = [];
        $walk = static function ($node) use (&$walk, &$out): void {
            if (!is_array($node)) return;
            if (isset($node['videoRenderer']) && is_array($node['videoRenderer'])) {
                $vr = $node['videoRenderer'];
                $vid = (string)($vr['videoId'] ?? '');
                $lenText = (string)($vr['lengthText']['simpleText'] ?? '');
                // Skip Shorts or unplayable items lacking a standard duration badge
                if (preg_match('/^[a-zA-Z0-9_-]{11}$/', $vid) && $lenText !== '') {
                    $parts = array_map('intval', explode(':', $lenText));
                    $sec = 0;
                    if (count($parts) === 2) {
                        $sec = $parts[0] * 60 + $parts[1];
                    } elseif (count($parts) === 3) {
                        $sec = $parts[0] * 3600 + $parts[1] * 60 + $parts[2];
                    }
                    $out[$vid] = [
                        'videoId' => $vid,
                        'title' => (string)($vr['title']['runs'][0]['text'] ?? ''),
                        'owner' => (string)($vr['ownerText']['runs'][0]['text'] ?? ''),
                        'durationText' => $lenText,
                        'durationSec' => $sec
                    ];
                }
                return;
            }
            // Do not descend into reelShelfRenderer (YouTube Shorts shelf)
            if (isset($node['reelShelfRenderer'])) {
                return;
            }
            foreach ($node as $v) {
                if (is_array($v)) $walk($v);
            }
        };
        $walk($data);
        return $out;
    }

    private static function guessContentType(string $url): string
    {
        $path = strtolower((string)parse_url($url, PHP_URL_PATH));
        if (str_ends_with($path, '.mp4') || str_ends_with($path, '.m4v')) return 'video/mp4';
        if (str_ends_with($path, '.webm')) return 'video/webm';
        if (str_ends_with($path, '.m3u8')) return 'application/x-mpegURL';
        if (str_ends_with($path, '.m4a') || str_ends_with($path, '.aac')) return 'audio/mp4';
        if (str_ends_with($path, '.wav')) return 'audio/wav';
        if (str_ends_with($path, '.ogg')) return 'audio/ogg';
        return 'audio/mpeg';
    }

    private static function httpGetRaw(string $url, int $timeout = 8): string
    {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_USERAGENT => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            CURLOPT_TIMEOUT => $timeout,
            CURLOPT_IPRESOLVE => CURL_IPRESOLVE_V4
        ]);
        $raw = curl_exec($ch);
        $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        return ($raw !== false && $code < 400) ? (string)$raw : '';
    }

    private static function httpGetJson(string $url, int $timeout = 8): ?array
    {
        $raw = self::httpGetRaw($url, $timeout);
        if ($raw === '') return null;
        $decoded = json_decode($raw, true);
        return is_array($decoded) ? $decoded : null;
    }
}
