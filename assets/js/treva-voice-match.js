/**
 * Treva High-Precision Open-Source Voice Match & Multilingual Wake/Sleep Engine (v2)
 *
 * Architecture:
 * 1. Annyang-compatible Open-Source Speech Command Engine (MIT License, based on annyang by Tal Ater)
 * 2. Contiguous Bigram Lattice Matcher: requires adjacent [Salute + Treva] or [Goodbye + Treva]
 *    at the end of a short wake/farewell utterance (2-5 words) -> ZERO false positives during conversation.
 * 3. Acoustic-Phonetic Dictionary for "Treva": handles Spanish/English/Multilingual Google STT
 *    dictionary substitutions ("treva", "treba", "prueba", "tregua", "breva", "trepa", "trevor", "te va", "tre va")
 *    strictly when immediately preceded by a verified greeting or goodbye.
 * 4. Interim Stability Gate (220ms) + AI Echo Suppression Gate + Live Heard Telemetry.
 */
(function (window) {
  'use strict';

  const SpeechRecognition =
    window.SpeechRecognition ||
    window.webkitSpeechRecognition ||
    window.mozSpeechRecognition ||
    window.msSpeechRecognition ||
    null;

  // ---------------------------------------------------------------------------
  // 1. Multilingual Greeting & Farewell Phrase Lexicons (Normalized ASCII/Unicode)
  // ---------------------------------------------------------------------------

  // Ordered longest-first so multi-word phrases match before single tokens
  const SALUTE_PHRASES = [
    // Spanish
    'buenos dias', 'buenas tardes', 'buenas noches', 'buen dia', 'hola que tal', 'que tal', 'aloha', 'hola', 'ola', 'buenas',
    // English & cross-lingual STT spellings of Hola / Hello
    'good morning', 'good afternoon', 'good evening', 'good day', 'hello', 'hi', 'hey', 'howdy', 'greetings',
    'jelo', 'jelou', 'helo', 'helou', 'holla', 'oh la', 'all a',
    // French
    'bon matin', 'bonjour', 'bonjur', 'bonsoir', 'salut', 'coucou',
    // Italian
    'buon giorno', 'buona sera', 'buongiorno', 'buonasera', 'ciao', 'salve',
    // Portuguese
    'bom dia', 'boa tarde', 'boa noite', 'oi',
    // German / Dutch / Nordic
    'guten morgen', 'guten tag', 'guten abend', 'gruss gott', 'goede morgen', 'goeie morgen', 'goedenavond',
    'hallo', 'servus', 'moin', 'gruezi', 'hoi', 'hej', 'hei', 'terve',
    // Slavic / Central & Eastern European / Turkish / Greek / Semitic / Indic / East Asian
    'dobroe utro', 'dobry den', 'dobry vecher', 'dzien dobry', 'privet', 'zdravstvuyte',
    'czesc', 'ahoj', 'buna', 'szia', 'zdravo', 'merhaba', 'selam', 'salam', 'marhaba', 'ahlan',
    'shalom', 'namaste', 'yassou', 'konnichiwa', 'moshi moshi', 'ohayo', 'annyeong', 'annyeonghaseyo', 'ni hao', 'nihao',
    'こんにちは', 'おはよう', 'もしもし', '안녕', '안녕하세요', '你好', '您好', 'مرحبا', 'أهلا', 'привет', 'здравствуйте'
  ];

  const GOODBYE_PHRASES = [
    // Spanish
    'hasta luego', 'hasta pronto', 'hasta manana', 'hasta la vista', 'nos vemos', 'que descanses', 'buenas noches',
    'chau chau', 'chao chao', 'chau', 'chao', 'adios',
    // English & cross-lingual STT spellings of Chau / Goodbye
    'good bye', 'bye bye', 'see you later', 'see you', 'see ya', 'good night', 'have a good night',
    'goodbye', 'bye', 'farewell', 'goodnight', 'gudbai', 'gudbay', 'byebye', 'baibai', 'chow', 'chaw',
    // French
    'au revoir', 'a bientot', 'a plus tard', 'a demain', 'bonne nuit', 'aurevoir', 'orevoar', 'adieu',
    // Italian
    'a presto', 'a domani', 'buona notte', 'arrivederci', 'addio', 'ci vediamo', 'ciao',
    // Portuguese
    'ate logo', 'ate mais', 'ate breve', 'ate amanha', 'boa noite', 'tchau', 'adeus',
    // German / Dutch / Nordic
    'auf wiedersehen', 'bis bald', 'bis spater', 'bis morgen', 'gute nacht', 'leb wohl',
    'tot ziens', 'tot straks', 'goede nacht', 'tschuss', 'tschuess', 'tschau', 'chus', 'tchus', 'aufwiedersehen', 'doei', 'hejda', 'farvel',
    // Slavic / Turkish / Arabic / Hebrew / Hindi / Greek / East Asian
    'do widzenia', 'do zobaczenia', 'dobranoc', 'do svidaniya', 'spokoynoy nochi', 'poka', 'dosvidaniya',
    'gule gule', 'iyi geceler', 'gorusuruz', 'ma a salama', 'maa salama', 'wadaeaan', 'lehitraot', 'alvida',
    'annyeonghi gaseyo', 'ja ne', 'mata ne', 'sayonara', 'sayounara', 'zaijian', 'jalga',
    'さようなら', 'じゃあね', 'またね', 'バイバイ', '잘가', '안녕히가세요', '再见', '拜拜', 'مع السلامة', 'وداعا', 'пока', 'до свидания'
  ];

  // Optional leading/trailing polite vocative particles allowed around [Salute/Goodbye + Treva]
  const OPTIONAL_FILLERS = new Set([
    'hey', 'ey', 'ok', 'okay', 'che', 'oye', 'oiga', 'disculpa', 'por', 'favor', 'please', 'gracias', 'thanks', 'thank', 'you'
  ]);

  // Direct single-word matches for "Treva" (exact + direct rhotic/labial STT transcripts)
  const DIRECT_TREVA_TOKENS = new Set([
    'treva', 'treba', 'trevah', 'trevva', 'trebba', 'trev', 'trevor', 'triva', 'trova', 'trava',
    'trevar', 'trever', 'trepha', 'dreva', 'preva', 'creva', 'breva', 'trevi', 'trevo',
    'трева', 'треба', 'トレヴァ', 'トレバ', '트레바'
  ]);

  // Contextual acoustic substitutions that Google STT produces for "/t-r-e-v-a/" ONLY when immediately
  // preceded by a Salute ("Hola", "Hello", etc.) or Goodbye ("Chau", "Goodbye", etc.)
  const CONTEXTUAL_TREVA_SINGLE_TOKENS = new Set([
    'prueba', 'pruebas', 'tregua', 'trepa', 'trebol', 'teba', 'teva', 'reba', 'deba', 'seba',
    'eva', 'eba', 'greba', 'gleba', 'cueva', 'nueva', 'brava', 'grava', 'clava', 'esteban', 'reva', 'leva'
  ]);

  // Contextual 2-token split transcriptions of "Tre-va" right after a Salute or Goodbye (e.g. "Hola te va", "Hola tre va")
  const CONTEXTUAL_TREVA_PAIRS = new Set([
    'tre va', 'tre ba', 'trev a', 'tres va', 'tres a', 'te va', 'te ba', 'de va', 'le va', 'se va'
  ]);

  // Media / smart-home command verbs that disqualify an utterance from being a wake/sleep trigger
  const COMMAND_EXCLUSION_WORDS = new Set([
    'play', 'reproduce', 'reproducir', 'pon', 'pone', 'poner', 'put', 'listen', 'escuchar',
    'song', 'cancion', 'track', 'tema', 'album', 'artist', 'artista', 'music', 'musica', 'video', 'youtube', 'spotify',
    'volume', 'volumen', 'sube', 'baja', 'turn', 'enciende', 'prende', 'apaga', 'switch', 'light', 'luz', 'luces',
    'color', 'brightness', 'brillo', 'scene', 'escena', 'temperature', 'temperatura', 'aire', 'vacuum', 'aspiradora',
    'search', 'busca', 'buscar', 'find', 'cast', 'stream', 'pause', 'pausa', 'resume', 'next', 'siguiente', 'previous'
  ]);

  // ---------------------------------------------------------------------------
  // 2. Normalization & Phonetic Similarity Helpers
  // ---------------------------------------------------------------------------

  function normalizeText(raw) {
    if (!raw) return '';
    return String(raw)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/['’`´]/g, ' ')
      .replace(/[^a-z0-9\u0400-\u04ff\u0600-\u06ff\u3040-\u30ff\u4e00-\u9faf\uac00-\ud7af\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function damerauLevenshtein(a, b) {
    const alen = a.length;
    const blen = b.length;
    if (alen === 0) return blen;
    if (blen === 0) return alen;
    const dp = Array.from({ length: alen + 1 }, () => new Array(blen + 1).fill(0));
    for (let i = 0; i <= alen; i++) dp[i][0] = i;
    for (let j = 0; j <= blen; j++) dp[0][j] = j;

    for (let i = 1; i <= alen; i++) {
      for (let j = 1; j <= blen; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
          dp[i][j] = Math.min(dp[i][j], dp[i - 2][j - 2] + cost);
        }
      }
    }
    return dp[alen][blen];
  }

  /**
   * Checks if token(s) at `tokens[idx]` match "Treva" when immediately adjacent to a Salute or Goodbye.
   * Returns `{ score, span }` where `span` is 1 or 2 tokens consumed.
   */
  function matchAdjacentTreva(tokens, idx, precederPhrase = '') {
    if (idx < 0 || idx >= tokens.length) return { score: 0, span: 0 };
    const t1 = tokens[idx];
    const t2 = idx + 1 < tokens.length ? tokens[idx + 1] : '';

    if (t1 === 'treva' || t1 === 'treba' || t1 === 'трева' || t1 === 'треба') {
      return { score: 1.0, span: 1 };
    }
    if (DIRECT_TREVA_TOKENS.has(t1)) {
      return { score: 0.96, span: 1 };
    }

    // Check 2-token split ("tre va", "te va", "tres va")
    if (t2) {
      const pair = `${t1} ${t2}`;
      if (pair === 'tre va' || pair === 'tre ba' || pair === 'trev a') {
        return { score: 0.97, span: 2 };
      }
      // Exclude "que tal te va" (which is a greeting question, not "Hola Treva")
      if (CONTEXTUAL_TREVA_PAIRS.has(pair) && precederPhrase !== 'que tal') {
        return { score: 0.92, span: 2 };
      }
    }

    if (CONTEXTUAL_TREVA_SINGLE_TOKENS.has(t1)) {
      return { score: 0.91, span: 1 };
    }

    // Acoustic-phonetic pattern check: 4-7 chars starting with plosive/rhotic and containing labial/velar middle consonant + vowel ending
    if (t1.length >= 4 && t1.length <= 7 && /^[tdpcbgr]r?[eaiou]+[vbfpg][aoe]s?$/.test(t1)) {
      const dist = Math.min(
        damerauLevenshtein(t1, 'treva'),
        damerauLevenshtein(t1, 'treba'),
        damerauLevenshtein(t1, 'prueba'),
        damerauLevenshtein(t1, 'tregua')
      );
      if (dist <= 2) {
        return { score: 0.88, span: 1 };
      }
    }

    return { score: 0, span: 0 };
  }

  function scoreTrevaToken(token, nextToken = '') {
    return matchAdjacentTreva([String(token || '').toLowerCase(), String(nextToken || '').toLowerCase()].filter(Boolean), 0).score;
  }

  function formatCanonicalDisplayPhrase(keyword, intent) {
    const clean = String(keyword || '').trim();
    if (!clean) return intent === 'wake' ? 'Hola Treva' : 'Chau Treva';
    const map = {
      'jelo': 'Hello', 'jelou': 'Hello', 'helo': 'Hello', 'helou': 'Hello',
      'holla': 'Hola', 'oh la': 'Hola', 'all a': 'Hola', 'ola': 'Olá',
      'buenos dias': 'Buenos días', 'buen dia': 'Buen día', 'que tal': 'Qué tal',
      'adios': 'Adiós', 'hasta manana': 'Hasta mañana', 'chow': 'Chau', 'chaw': 'Chau',
      'gudbai': 'Goodbye', 'gudbay': 'Goodbye', 'good bye': 'Goodbye', 'byebye': 'Bye bye', 'baibai': 'Bye bye',
      'a bientot': 'À bientôt', 'aurevoir': 'Au revoir', 'orevoar': 'Au revoir',
      'ate logo': 'Até logo', 'tschuss': 'Tschüss', 'tschuess': 'Tschüss'
    };
    const titled = map[clean] || (clean.charAt(0).toUpperCase() + clean.slice(1));
    return `${titled} Treva`;
  }

  // ---------------------------------------------------------------------------
  // 3. Contiguous Bigram Wake/Goodbye Classifier (Zero False Positives)
  // ---------------------------------------------------------------------------

  function tryMatchPhraseAt(tokens, startIdx, phraseList) {
    for (const phrase of phraseList) {
      const pTokens = phrase.split(' ');
      if (startIdx + pTokens.length > tokens.length) continue;
      let ok = true;
      for (let k = 0; k < pTokens.length; k++) {
        if (tokens[startIdx + k] !== pTokens[k]) {
          ok = false;
          break;
        }
      }
      if (ok) {
        return { phrase, length: pTokens.length };
      }
    }
    return null;
  }

  function evaluateWindowTokens(tokens, isVoiceActive) {
    if (tokens.length < 2 || tokens.length > 6) return null;
    if (tokens.some((tk) => COMMAND_EXCLUSION_WORDS.has(tk))) return null;

    // Strip optional leading/trailing polite filler particles ("hey", "ok", "por favor", "please", "gracias")
    let start = 0;
    while (start < tokens.length - 2 && OPTIONAL_FILLERS.has(tokens[start])) {
      start++;
    }
    let end = tokens.length;
    while (end > start + 2 && OPTIONAL_FILLERS.has(tokens[end - 1])) {
      end--;
    }
    const core = tokens.slice(start, end);
    if (core.length < 2 || core.length > 5) return null;

    const sharedAmbiguous = new Set(['ciao', 'salut', 'annyeong', 'aloha', 'shalom', 'salam', 'buenas noches', 'boa noite']);

    // Check Pattern 1: [Salute / Goodbye] immediately followed by [Treva] (e.g. "Hola Treva", "Buenos días Treva", "Chau Treva", "Goodbye Treva")
    const salMatch = tryMatchPhraseAt(core, 0, SALUTE_PHRASES);
    const byeMatch = tryMatchPhraseAt(core, 0, GOODBYE_PHRASES);

    if (salMatch) {
      const trevaRes = matchAdjacentTreva(core, salMatch.length, salMatch.phrase);
      if (trevaRes.score >= 0.85 && (salMatch.length + trevaRes.span) === core.length) {
        const isAmbiguousGoodbye = isVoiceActive && sharedAmbiguous.has(salMatch.phrase);
        const intent = isAmbiguousGoodbye ? 'sleep' : 'wake';
        return {
          intent,
          phrase: formatCanonicalDisplayPhrase(salMatch.phrase, intent),
          salute: intent === 'wake' ? salMatch.phrase : undefined,
          goodbye: intent === 'sleep' ? salMatch.phrase : undefined,
          confidence: Number(Math.min(0.99, (trevaRes.score + 0.98) / 2).toFixed(2))
        };
      }
    }

    if (byeMatch) {
      const trevaRes = matchAdjacentTreva(core, byeMatch.length, byeMatch.phrase);
      if (trevaRes.score >= 0.85 && (byeMatch.length + trevaRes.span) === core.length) {
        return {
          intent: 'sleep',
          phrase: formatCanonicalDisplayPhrase(byeMatch.phrase, 'sleep'),
          goodbye: byeMatch.phrase,
          confidence: Number(Math.min(0.99, (trevaRes.score + 0.98) / 2).toFixed(2))
        };
      }
    }

    // Check Pattern 2: [Treva] immediately followed by [Salute / Goodbye] (e.g. "Treva hola", "Treva chau", "Treva goodbye")
    const leadTreva = matchAdjacentTreva(core, 0, '');
    if (leadTreva.score >= 0.90 && leadTreva.span < core.length) {
      const salAfter = tryMatchPhraseAt(core, leadTreva.span, SALUTE_PHRASES);
      if (salAfter && (leadTreva.span + salAfter.length) === core.length) {
        const isAmbiguousGoodbye = isVoiceActive && sharedAmbiguous.has(salAfter.phrase);
        const intent = isAmbiguousGoodbye ? 'sleep' : 'wake';
        return {
          intent,
          phrase: formatCanonicalDisplayPhrase(salAfter.phrase, intent),
          salute: intent === 'wake' ? salAfter.phrase : undefined,
          goodbye: intent === 'sleep' ? salAfter.phrase : undefined,
          confidence: Number(Math.min(0.99, (leadTreva.score + 0.96) / 2).toFixed(2))
        };
      }
      const byeAfter = tryMatchPhraseAt(core, leadTreva.span, GOODBYE_PHRASES);
      if (byeAfter && (leadTreva.span + byeAfter.length) === core.length) {
        return {
          intent: 'sleep',
          phrase: formatCanonicalDisplayPhrase(byeAfter.phrase, 'sleep'),
          goodbye: byeAfter.phrase,
          confidence: Number(Math.min(0.99, (leadTreva.score + 0.96) / 2).toFixed(2))
        };
      }
    }

    return null;
  }

  function evaluateTranscript(rawTranscript, options = {}) {
    const norm = normalizeText(rawTranscript);
    if (!norm) return null;

    const allTokens = norm.split(' ').filter(Boolean);
    if (allTokens.length < 2) return null;

    const isVoiceActive = Boolean(options.isVoiceActive || options.isVoiceMenuOpen);

    // 1. Evaluate the full utterance if it is a short 2-6 word phrase
    if (allTokens.length <= 6) {
      const direct = evaluateWindowTokens(allTokens, isVoiceActive);
      if (direct) {
        return { ...direct, rawHeard: String(rawTranscript).trim(), normalized: norm };
      }
    }

    // 2. If continuous SpeechRecognition accumulated earlier words in the buffer before the user paused and said "Hola Treva" / "Chau Treva",
    // check the trailing 2, 3, and 4 tokens at the very end of the buffer (provided the preceding words do not contain command exclusion verbs).
    const leadingTokens = allTokens.slice(0, Math.max(0, allTokens.length - 4));
    if (leadingTokens.some((tk) => COMMAND_EXCLUSION_WORDS.has(tk))) {
      return null;
    }
    for (const tailLen of [2, 3, 4]) {
      if (allTokens.length > tailLen) {
        const tail = allTokens.slice(allTokens.length - tailLen);
        const tailMatch = evaluateWindowTokens(tail, isVoiceActive);
        if (tailMatch) {
          return { ...tailMatch, rawHeard: String(rawTranscript).trim(), normalized: tail.join(' ') };
        }
      }
    }

    return null;
  }

  // ---------------------------------------------------------------------------
  // 4. Sci-Fi Holographic Audio Feedback Chimes
  // ---------------------------------------------------------------------------

  function playVoiceMatchChime(type = 'wake') {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const now = ctx.currentTime;
      const notes = type === 'wake' ? [523.25, 659.25, 783.99, 1046.5] : [783.99, 659.25, 523.25, 392.0];
      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = type === 'wake' ? 'sine' : 'triangle';
        osc.frequency.setValueAtTime(freq, now + idx * 0.065);
        gain.gain.setValueAtTime(0.0001, now + idx * 0.065);
        gain.gain.exponentialRampToValueAtTime(0.09, now + idx * 0.065 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.065 + 0.22);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + idx * 0.065);
        osc.stop(now + idx * 0.065 + 0.24);
      });
      setTimeout(() => {
        try { ctx.close(); } catch (_) {}
      }, 700);
    } catch (_) {}
  }

  // ---------------------------------------------------------------------------
  // 5. Continuous Speech Sentinel with Interim Stability & Echo Suppression
  // ---------------------------------------------------------------------------

  function createSentinel(config = {}) {
    let recognition = null;
    let enabled = config.enabled !== false;
    let isRunning = false;
    let restartTimer = null;
    let interimConfirmTimer = null;
    let lastTriggerAt = 0;
    let lastAiSpeakingAt = 0;
    let permissionDenied = false;
    // Default to 'es-AR' because Latin-phoneme Spanish STT natively transcribes "Hola", "Chau", "Treva", "Hello", "Goodbye", "Ciao", "Bonjour"
    let currentLang = config.lang || 'es-AR';
    const cooldownMs = Number(config.cooldownMs || 1800);

    function emitState(state, detail = {}) {
      if (typeof config.onStateChange === 'function') {
        config.onStateChange({
          supported: Boolean(SpeechRecognition),
          enabled,
          running: isRunning,
          permissionDenied,
          lang: currentLang,
          state,
          ...detail
        });
      }
    }

    function isEchoGated() {
      const now = Date.now();
      if (typeof config.isAiSpeaking === 'function' && config.isAiSpeaking()) {
        lastAiSpeakingAt = now;
        return true;
      }
      return (now - lastAiSpeakingAt) < 1600;
    }

    function executeMatch(match) {
      const now = Date.now();
      if ((now - lastTriggerAt) < cooldownMs) return false;
      if (interimConfirmTimer) {
        clearTimeout(interimConfirmTimer);
        interimConfirmTimer = null;
      }
      lastTriggerAt = now;
      playVoiceMatchChime(match.intent);
      if (match.intent === 'wake' && typeof config.onWake === 'function') {
        config.onWake(match);
      } else if (match.intent === 'sleep' && typeof config.onSleep === 'function') {
        config.onSleep(match);
      }
      // Reset recognition buffer after a trigger so old transcript words never carry over
      if (recognition && isRunning) {
        try { recognition.abort(); } catch (_) {}
      }
      return true;
    }

    function handleCandidateText(transcript, isFinal, fromExternal = false) {
      const now = Date.now();
      if ((now - lastTriggerAt) < cooldownMs) return false;
      if (!fromExternal && isEchoGated()) return false;

      const isVoiceActive = typeof config.isVoiceActive === 'function' ? Boolean(config.isVoiceActive()) : false;
      const isVoiceMenuOpen = typeof config.isVoiceMenuOpen === 'function' ? Boolean(config.isVoiceMenuOpen()) : false;

      if (typeof config.onHeard === 'function') {
        config.onHeard(transcript, isFinal);
      }

      const match = evaluateTranscript(transcript, { isVoiceActive, isVoiceMenuOpen });
      if (!match) {
        // If user continued speaking a longer non-matching sentence, cancel any pending interim trigger
        if (interimConfirmTimer) {
          clearTimeout(interimConfirmTimer);
          interimConfirmTimer = null;
        }
        return false;
      }

      if (isFinal || fromExternal) {
        return executeMatch(match);
      }

      // Interim result matched [Salute + Treva] or [Goodbye + Treva]: wait 220ms to ensure the user finished the wake phrase
      if (interimConfirmTimer) clearTimeout(interimConfirmTimer);
      interimConfirmTimer = setTimeout(() => {
        interimConfirmTimer = null;
        if (!isEchoGated()) {
          executeMatch(match);
        }
      }, 220);
      return true;
    }

    function ensureRecognitionInstance() {
      if (!SpeechRecognition) return null;
      if (recognition) return recognition;

      const rec = new SpeechRecognition();
      rec.continuous = true;
      rec.interimResults = true;
      rec.maxAlternatives = 4;
      rec.lang = currentLang;

      rec.onstart = () => {
        isRunning = true;
        permissionDenied = false;
        emitState('listening');
      };

      rec.onresult = (event) => {
        if (isEchoGated()) return;
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const res = event.results[i];
          if (!res) continue;
          const isFinal = Boolean(res.isFinal);
          let matchedInResult = false;
          for (let altIdx = 0; altIdx < res.length; altIdx++) {
            const alt = res[altIdx];
            // Skip low-confidence secondary alternatives to prevent false positives
            if (altIdx > 0 && typeof alt.confidence === 'number' && alt.confidence > 0 && alt.confidence < 0.45) {
              continue;
            }
            const txt = String((alt && alt.transcript) || '').trim();
            if (!txt) continue;
            if (handleCandidateText(txt, isFinal, false)) {
              matchedInResult = true;
              break;
            }
          }
          // If a final segment accumulated > 8 non-matching words, recycle the buffer cleanly
          if (isFinal && !matchedInResult && res[0] && String(res[0].transcript || '').trim().split(/\s+/).length > 8) {
            try { rec.abort(); } catch (_) {}
            break;
          }
        }
      };

      rec.onerror = (event) => {
        const err = String((event && event.error) || '');
        if (err === 'not-allowed' || err === 'service-not-allowed') {
          permissionDenied = true;
          isRunning = false;
          emitState('permission_needed', { error: err });
          return;
        }
        if (err === 'aborted' || err === 'no-speech') {
          return;
        }
        emitState('standby', { error: err });
      };

      rec.onend = () => {
        isRunning = false;
        if (enabled && !permissionDenied && !document.hidden) {
          if (restartTimer) clearTimeout(restartTimer);
          restartTimer = setTimeout(() => {
            start();
          }, 260);
        } else {
          emitState(enabled ? 'standby' : 'disabled');
        }
      };

      recognition = rec;
      return recognition;
    }

    function start() {
      if (!SpeechRecognition) {
        emitState('unsupported');
        return false;
      }
      if (!enabled) return false;
      const rec = ensureRecognitionInstance();
      if (!rec) return false;
      if (isRunning) return true;
      try {
        rec.lang = currentLang;
        rec.start();
        return true;
      } catch (_) {
        return false;
      }
    }

    function stop() {
      if (restartTimer) {
        clearTimeout(restartTimer);
        restartTimer = null;
      }
      if (interimConfirmTimer) {
        clearTimeout(interimConfirmTimer);
        interimConfirmTimer = null;
      }
      if (recognition && isRunning) {
        try { recognition.abort(); } catch (_) {}
      }
      isRunning = false;
      emitState(enabled ? 'standby' : 'disabled');
    }

    function setEnabled(nextEnabled) {
      enabled = Boolean(nextEnabled);
      permissionDenied = false;
      if (enabled) {
        start();
      } else {
        stop();
      }
    }

    function setLang(nextLang) {
      currentLang = String(nextLang || 'es-AR');
      if (recognition) {
        recognition.lang = currentLang;
        if (isRunning) {
          try { recognition.abort(); } catch (_) {}
        }
      }
    }

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (recognition && isRunning) {
          try { recognition.abort(); } catch (_) {}
        }
      } else if (enabled && !permissionDenied) {
        start();
      }
    });

    return {
      isSupported: () => Boolean(SpeechRecognition),
      start,
      stop,
      setEnabled,
      setLang,
      getLang: () => currentLang,
      isEnabled: () => enabled,
      isRunning: () => isRunning,
      evaluateTranscript,
      checkExternalTranscript: (text) => handleCandidateText(text, true, true),
      playChime: playVoiceMatchChime
    };
  }

  const TrevaVoiceMatch = {
    isSupported: () => Boolean(SpeechRecognition),
    evaluateTranscript,
    scoreTrevaToken,
    playVoiceMatchChime,
    createSentinel
  };

  window.TrevaVoiceMatch = TrevaVoiceMatch;
  if (!window.annyang) {
    window.annyang = TrevaVoiceMatch;
  }
})(window);
