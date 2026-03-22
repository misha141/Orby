import { useEffect, useRef, useState, useImperativeHandle, forwardRef } from 'react';

const VoiceInput = forwardRef(function VoiceInput(
  { onTranscriptReady, onListeningChange, autoStartSignal = 0 },
  ref
) {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [isSupported, setIsSupported] = useState(true);
  const recognitionRef = useRef(null);
  const finalTranscriptRef = useRef('');
  const latestTranscriptRef = useRef('');
  const silenceTimerRef = useRef(null);
  const manualStopRef = useRef(false);

  const SILENCE_TIMEOUT = 1800; // auto-stop after 1.8s of silence (Siri-like)

  const clearSilenceTimer = () => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  };

  const startSilenceTimer = () => {
    clearSilenceTimer();
    silenceTimerRef.current = setTimeout(() => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
    }, SILENCE_TIMEOUT);
  };

  useImperativeHandle(ref, () => ({
    startListening() {
      if (recognitionRef.current && !isListening) {
        manualStopRef.current = false;
        try {
          recognitionRef.current.start();
        } catch (_e) {
          // already started
        }
      }
    },
    stopListening() {
      clearSilenceTimer();
      if (recognitionRef.current && isListening) {
        manualStopRef.current = true;
        recognitionRef.current.stop();
      }
    }
  }), [isListening]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setIsSupported(false);
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onspeechend = () => {
      recognition.stop();
    };

    recognition.onstart = () => {
      setTranscript('');
      latestTranscriptRef.current = '';
      finalTranscriptRef.current = '';
      setIsListening(true);
      if (onListeningChange) {
        onListeningChange(true);
      }
      // Start the silence timer immediately — if user says nothing, auto-stop
      startSilenceTimer();
    };

    recognition.onresult = (event) => {
      let interim = '';
      let finalTextDelta = '';

      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const segment = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTextDelta += `${segment} `;
        } else {
          interim += segment;
        }
      }

      if (finalTextDelta) {
        finalTranscriptRef.current = `${finalTranscriptRef.current} ${finalTextDelta}`.trim();
      }

      const combined = `${finalTranscriptRef.current} ${interim}`.trim();
      setTranscript(combined);
      latestTranscriptRef.current = combined;

      // Reset the silence timer every time we get speech input
      startSilenceTimer();
    };

    recognition.onend = () => {
      clearSilenceTimer();
      setIsListening(false);
      if (onListeningChange) {
        onListeningChange(false);
      }

      if (manualStopRef.current) {
        manualStopRef.current = false;
        // User manually stopped listening; do not process a command from partial transcript.
        return;
      }

      const finalText = finalTranscriptRef.current.trim() || latestTranscriptRef.current.trim();
      if (finalText) {
        onTranscriptReady(finalText);
      }
    };

    recognition.onerror = () => {
      clearSilenceTimer();
      setIsListening(false);
      if (onListeningChange) {
        onListeningChange(false);
      }
    };

    recognitionRef.current = recognition;

    return () => {
      clearSilenceTimer();
      recognition.stop();
    };
  }, [onTranscriptReady, onListeningChange]);

  useEffect(() => {
    if (!autoStartSignal || !recognitionRef.current || isListening) {
      return;
    }

    try {
      recognitionRef.current.start();
    } catch (_error) {
      // no-op
    }
  }, [autoStartSignal, isListening]);

  return (
    <div className="card voiceCard">
      {!isSupported && (
        <p className="helpText">
          Speech recognition is not supported in this browser.
        </p>
      )}

      {transcript && (
        <div className="transcriptBox">
          <p>{transcript}</p>
        </div>
      )}
    </div>
  );
});

export default VoiceInput;
