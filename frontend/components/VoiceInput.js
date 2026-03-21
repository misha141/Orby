import { useEffect, useRef, useState } from 'react';

export default function VoiceInput({ onTranscriptReady, onListeningChange, autoStartSignal = 0, conversationMode = false, onStopListening }) {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [isSupported, setIsSupported] = useState(true);
  const recognitionRef = useRef(null);
  const finalTranscriptRef = useRef('');
  const latestTranscriptRef = useRef('');
  const manualStopRef = useRef(false);

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
    recognition.continuous = !conversationMode;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onspeechend = () => {
      if (!conversationMode) {
        return;
      }
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
    };

    recognition.onend = () => {
      const wasManualStop = manualStopRef.current;
      manualStopRef.current = false;

      setIsListening(false);
      if (onListeningChange) {
        onListeningChange(false);
      }

      if (wasManualStop && onStopListening) {
        onStopListening();
      }

      if (wasManualStop) {
        // User manually stopped listening; do not process a command from partial transcript.
        return;
      }

      const finalText = finalTranscriptRef.current.trim() || latestTranscriptRef.current.trim();
      if (finalText) {
        onTranscriptReady(finalText);
      }
    };

    recognition.onerror = () => {
      setIsListening(false);
      if (onListeningChange) {
        onListeningChange(false);
      }
    };

    recognitionRef.current = recognition;
  }, [onTranscriptReady, onListeningChange]);

  useEffect(() => {
    if (!recognitionRef.current) {
      return;
    }
    recognitionRef.current.continuous = !conversationMode;
  }, [conversationMode]);

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

  const toggleListening = () => {
    if (!recognitionRef.current) {
      window.alert('Speech recognition is not supported in this browser.');
      return;
    }

    if (isListening) {
      manualStopRef.current = true;
      recognitionRef.current.stop();
      return;
    }

    manualStopRef.current = false;
    recognitionRef.current.start();
  };

  return (
    <div className="card">
      {!isSupported && (
        <p className="helpText">
          Speech recognition is not supported in this browser.
        </p>
      )}
      <button className={`micButton ${isListening ? 'listening' : ''}`} type="button" onClick={toggleListening}>
        {isListening ? 'Stop Listening' : '🎤 Talk to Orby'}
      </button>

      <div className="transcriptBox">
        <h3>Transcript</h3>
        <p>{transcript || 'Your spoken command will appear here.'}</p>
      </div>
    </div>
  );
}
