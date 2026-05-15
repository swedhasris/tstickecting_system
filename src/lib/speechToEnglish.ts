type SpeechLike = typeof window & {
  webkitSpeechRecognition?: any;
  SpeechRecognition?: any;
};

export type SpeechControllerOptions = {
  onInterim?: (text: string) => void;
  onFinal?: (text: string) => void;
  onStateChange?: (listening: boolean) => void;
  onError?: (message: string) => void;
};

const TAMIL_SCRIPT_RE = /[\u0B80-\u0BFF]/;
const TANGGLISH_HINTS = [
  'panna', 'mudiyala', 'varuthu', 'agala', 'illa', 'iruku', 'irukku', 'venum',
  'aagala', 'ticket', 'login', 'password', 'server', 'error', 'network',
  'create', 'open', 'close', 'reply', 'assign', 'issue', 'problem',
  'pannumbothu', 'enaku', 'enakku', 'varudhu'
];

const DIRECT_PHRASES: Array<[RegExp, string]> = [
  // Exact phrase matches requested by user
  [/\benaku login panna mudiyala account open agala\b/gi, 'I am unable to log into my account'],
  [/\bticket create pannumbothu error varuthu\b/gi, 'I am getting an error while creating a ticket'],
  [/\bticket create panna error varuthu\b/gi, 'I am getting an error while creating a ticket'],
  
  // Tanglish Subject/Pronoun mappings
  [/\benaku\b|\benakku\b|\bna\b|\bnaan\b/gi, 'I'],
  
  // Tanglish Action mappings
  [/\blogin panna mudiyala\b/gi, 'am unable to log in'],
  [/\baccount open aagala\b|\baccount open agala\b/gi, 'my account is not opening'],
  [/\bpassword reset panna mudiyala\b/gi, 'am unable to reset the password'],
  [/\bemail anupa mudiyala\b/gi, 'am unable to send an email'],
  [/\baccess panna mudiyala\b/gi, 'am unable to access'],
  
  // Tanglish States
  [/\bserver work aagala\b|\bserver work agala\b/gi, 'the server is not working'],
  [/\bprinter work aagala\b|\bprinter work agala\b/gi, 'the printer is not working'],
  [/\bopen aagala\b|\bopen agala\b/gi, 'is not opening'],
  [/\bwork aagala\b|\bwork agala\b/gi, 'is not working'],
  [/\brespond aagala\b|\bresponse illa\b/gi, 'is not responding'],
  [/\bslow aa iruku\b|\bslow aa irukku\b|\bslow ah iruku\b/gi, 'is running slowly'],
  
  // Tanglish Issue descriptions
  [/\binternet illa\b|\binternet illea\b/gi, 'the internet connection is down'],
  [/\bnetwork issue iruku\b|\bnetwork issue irukku\b/gi, 'there is a network issue'],
  [/\berror varuthu\b|\berror varudhu\b/gi, 'am getting an error'],
  
  // Tamil Script basic fallbacks (if STT captures actual Tamil)
  [/\bஎனக்கு லாகின் பண்ண முடியல\b/gi, 'I am unable to log in'],
  [/\bடிக்கெட் கிரியேட் பண்ணும்போது எரர் வருது\b/gi, 'I am getting an error while creating a ticket'],
];

function cleanWhitespace(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.!?])/g, '$1')
    .trim();
}

function toSentenceCase(text: string): string {
  const trimmed = cleanWhitespace(text);
  if (!trimmed) return '';
  const withPunctuation = /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
  return withPunctuation.charAt(0).toUpperCase() + withPunctuation.slice(1);
}

function detectTamilOrTanglish(text: string): boolean {
  if (TAMIL_SCRIPT_RE.test(text)) return true;
  const lower = text.toLowerCase();
  const hits = TANGGLISH_HINTS.reduce((count, hint) => count + (lower.includes(hint) ? 1 : 0), 0);
  // If at least one distinct Tanglish hint is found alongside other context, treat as Tanglish
  return hits >= 1 && (lower.includes('panna') || lower.includes('agala') || lower.includes('mudiyala') || lower.includes('varuthu') || lower.includes('iruku') || lower.includes('enaku') || lower.includes('pannumbothu'));
}

function normalizeEnglish(text: string): string {
  let normalized = text;
  
  // Grammar and professional IT terminology corrections
  normalized = normalized.replace(/\bi cant\b/gi, "I cannot");
  normalized = normalized.replace(/\bi am not able to\b/gi, 'I am unable to');
  normalized = normalized.replace(/\bcannot able to\b/gi, 'am unable to');
  normalized = normalized.replace(/\bi unable to\b/gi, 'I am unable to');
  normalized = normalized.replace(/\bi getting\b/gi, 'I am getting');
  normalized = normalized.replace(/\bpls\b|\bplz\b/gi, 'please');
  normalized = normalized.replace(/\bgonna\b/gi, 'going to');
  normalized = normalized.replace(/\bwanna\b/gi, 'want to');
  
  // Sentence structure polish
  normalized = normalized.replace(/\bI am unable to log in my account is not opening\b/gi, 'I am unable to log into my account');
  normalized = normalized.replace(/\bI am unable to log in to my account\b/gi, 'I am unable to log into my account');
  normalized = normalized.replace(/\bI am getting an error while creating ticket\b/gi, 'I am getting an error while creating a ticket');
  
  return toSentenceCase(normalized);
}

function translateTanglish(text: string): string {
  let translated = text;
  
  // Pass 1: Direct phrase mappings
  for (const [pattern, replacement] of DIRECT_PHRASES) {
    translated = translated.replace(pattern, replacement);
  }

  // Pass 2: Clean up overlapping grammar from direct translations
  translated = translated.replace(/\bI am unable to log in my account is not opening\b/gi, 'I am unable to log into my account');
  translated = translated.replace(/\bI am unable to log in account is not opening\b/gi, 'I am unable to log into my account');
  translated = translated.replace(/\bI am getting an error while creating ticket\b/gi, 'I am getting an error while creating a ticket');
  
  return normalizeEnglish(translated);
}

export function transformSpeechToProfessionalEnglish(text: string): string {
  if (!text.trim()) return '';
  return detectTamilOrTanglish(text) ? translateTanglish(text) : normalizeEnglish(text);
}

export function createSpeechController(options: SpeechControllerOptions) {
  const win = window as SpeechLike;
  const RecognitionCtor = win.SpeechRecognition || win.webkitSpeechRecognition;
  if (!RecognitionCtor) {
    return {
      supported: false,
      listening: () => false,
      toggle: () => options.onError?.('Speech recognition is not supported in this browser.'),
      stop: () => undefined,
    };
  }

  const recognition = new RecognitionCtor();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = 'en-IN';
  recognition.maxAlternatives = 1;

  let active = false;
  let finalTranscript = '';
  let silenceTimer: ReturnType<typeof setTimeout> | null = null;

  const clearSilenceTimer = () => {
    if (silenceTimer) {
      clearTimeout(silenceTimer);
      silenceTimer = null;
    }
  };

  const armSilenceStop = () => {
    clearSilenceTimer();
    silenceTimer = setTimeout(() => {
      if (active) {
        recognition.stop();
      }
    }, 1800);
  };

  recognition.onstart = () => {
    active = true;
    finalTranscript = '';
    options.onStateChange?.(true);
    options.onInterim?.('');
    armSilenceStop();
  };

  recognition.onresult = (event: any) => {
    let liveFinal = '';
    let interim = '';

    for (let i = 0; i < event.results.length; i += 1) {
      const transcript = event.results[i][0]?.transcript ?? '';
      if (event.results[i].isFinal) {
        liveFinal += `${transcript} `;
      } else {
        interim += `${transcript} `;
      }
    }

    finalTranscript = cleanWhitespace(liveFinal || finalTranscript);
    const liveText = cleanWhitespace([finalTranscript, interim].filter(Boolean).join(' '));
    options.onInterim?.(transformSpeechToProfessionalEnglish(liveText));
    armSilenceStop();
  };

  recognition.onerror = (event: any) => {
    console.error('Speech recognition error:', event?.error, event?.message);
    active = false;
    options.onStateChange?.(false);
    clearSilenceTimer();
    
    if (event?.error === 'not-allowed') {
      options.onError?.('Microphone access denied. Please allow microphone permissions in your browser settings.');
    } else if (event?.error === 'network') {
      options.onError?.('Network error. Speech recognition requires an internet connection in Chrome.');
    } else if (event?.error !== 'no-speech' && event?.error !== 'aborted') {
      options.onError?.(`Speech recognition failed (${event?.error || 'unknown'}). Please try again.`);
    }
  };

  recognition.onend = () => {
    clearSilenceTimer();
    const finalText = transformSpeechToProfessionalEnglish(finalTranscript);
    active = false;
    options.onStateChange?.(false);
    if (finalText) {
      options.onFinal?.(finalText);
    }
  };

  return {
    supported: true,
    listening: () => active,
    toggle: () => {
      try {
        if (active) {
          recognition.stop();
        } else {
          recognition.start();
        }
      } catch (err: any) {
        console.error("Speech recognition toggle error:", err);
        if (err.name === 'NotAllowedError') {
           options.onError?.('Microphone access denied. Please allow microphone permissions.');
        } else {
           options.onError?.(`Error: ${err.message}`);
        }
      }
    },
    stop: () => {
      try {
        if (active) recognition.stop();
      } catch (e) {}
    },
  };
}
