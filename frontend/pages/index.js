import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import VoiceInput from '../components/VoiceInput';
import OrbyAvatar from '../components/OrbyAvatar';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000';

export default function HomePage() {
  const [chatLog, setChatLog] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const speechCancelledRef = useRef(false);
  const voiceRef = useRef(null);
  const chatEndRef = useRef(null);
  const [gmailStatus, setGmailStatus] = useState({
    connected: false,
    source: 'none',
    oauthConfigured: false,
    mockMode: false
  });

  const speakText = useCallback((text) => {
    if (typeof window === 'undefined' || !window.speechSynthesis || !text) {
      return;
    }

    window.speechSynthesis.cancel();
    speechCancelledRef.current = false;
    setIsSpeaking(true);
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1;
    utterance.pitch = 1;

    utterance.onend = () => {
      setIsSpeaking(false);
    };

    utterance.onerror = () => {
      setIsSpeaking(false);
    };

    window.speechSynthesis.speak(utterance);
  }, []);

  const stopSpeaking = useCallback(() => {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      speechCancelledRef.current = true;
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
    }
  }, []);

  // Siri-like avatar tap handler
  const handleAvatarTap = useCallback(() => {
    // If Orby is speaking → stop speaking immediately
    if (isSpeaking) {
      stopSpeaking();
      return;
    }

    // If already listening → stop listening (will auto-process)
    if (isListening) {
      if (voiceRef.current) {
        voiceRef.current.stopListening();
      }
      return;
    }

    // If idle → start listening
    if (voiceRef.current) {
      voiceRef.current.startListening();
    }
  }, [isSpeaking, isListening, stopSpeaking]);

  // Auto-scroll chat to bottom
  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatLog]);

  const refreshGmailStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/auth/google/status`);
      if (!res.ok) {
        return;
      }

      const status = await res.json();
      setGmailStatus(status);
    } catch (_error) {
      // no-op
    }
  }, []);

  useEffect(() => {
    refreshGmailStatus();

    if (typeof window === 'undefined') {
      return;
    }

    const url = new URL(window.location.href);
    const gmail = url.searchParams.get('gmail');
    const reason = url.searchParams.get('reason');

    if (gmail === 'connected') {
      setChatLog((prev) => [...prev, { role: 'assistant', text: 'Gmail connected! I can now check your real inbox.' }]);
      refreshGmailStatus();
      url.searchParams.delete('gmail');
      url.searchParams.delete('reason');
      window.history.replaceState({}, '', url.toString());
      return;
    }

    if (gmail === 'error') {
      setError(`Gmail connection failed${reason ? `: ${reason}` : ''}`);
      url.searchParams.delete('gmail');
      url.searchParams.delete('reason');
      window.history.replaceState({}, '', url.toString());
    }
  }, [refreshGmailStatus]);

  const statusText = useMemo(() => {
    if (loading) {
      return 'Processing...';
    }

    if (isSpeaking) {
      return 'Tap to stop';
    }

    if (isListening) {
      return 'Listening...';
    }

    return 'Tap to speak';
  }, [loading, isSpeaking, isListening]);

  const handleTranscriptReady = useCallback(async (text) => {
    setLoading(true);
    setError('');

    // Add user message to chat log
    const userEntry = { role: 'user', text };
    setChatLog((prev) => [...prev, userEntry]);

    // Build history for the API (last 10 messages for context)
    const recentHistory = [...chatLog, userEntry]
      .slice(-10)
      .map((msg) => ({ role: msg.role === 'user' ? 'user' : 'assistant', content: msg.text }));

    try {
      const res = await fetch(`${API_BASE_URL}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ history: recentHistory })
      });

      if (!res.ok) {
        throw new Error('Orby could not process that.');
      }

      const data = await res.json();

      // Build the assistant chat entry
      const entry = { role: 'assistant', text: data.reply };

      // If there was an action result with email summaries, attach them
      if (data.result && Array.isArray(data.result.summary)) {
        entry.summary = data.result.summary;
      }

      setChatLog((prev) => [...prev, entry]);

      // Build spoken text — include top emails if we have summaries
      let spoken = data.reply;
      if (entry.summary && entry.summary.length > 0) {
        const high = entry.summary.filter((e) => e.priority === 'high');
        const top = high.length > 0 ? high : entry.summary;
        const emailLines = top
          .slice(0, 3)
          .map((e) => `${e.from}: ${e.subject}`)
          .join('. ');
        const prefix = high.length > 0
          ? `You have ${high.length} high priority email${high.length > 1 ? 's' : ''}`
          : `Here are your top emails`;
        spoken = `${spoken} ${prefix}. ${emailLines}.`;
      }
      speakText(spoken);
    } catch (err) {
      const errMessage = err.message || 'Something went wrong';
      setError(errMessage);
      setChatLog((prev) => [...prev, { role: 'assistant', text: "Sorry, I ran into an issue. Try again?" }]);
      speakText("Sorry, I ran into an issue. Try again?");
    } finally {
      setLoading(false);
    }
  }, [chatLog, speakText]);

  const priorityBadge = (level) => {
    const colors = { high: '#e74c3c', medium: '#f39c12', low: '#95a5a6' };
    return (
      <span
        key={level}
        style={{
          background: colors[level] || '#95a5a6',
          color: '#fff',
          padding: '2px 8px',
          borderRadius: '4px',
          fontSize: '0.75rem',
          fontWeight: 600,
          marginRight: '6px',
          textTransform: 'uppercase'
        }}
      >
        {level}
      </span>
    );
  };

  return (
    <main className="splitPage">
      <section className="leftPane">
        <div className="leftPaneInner">
          <h1>Orby</h1>
          <p className="subtitle">{statusText}</p>
          <div
            className="avatarTapZone"
            role="button"
            tabIndex={0}
            onClick={handleAvatarTap}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleAvatarTap(); }}
          >
            <OrbyAvatar isListening={isListening} isSpeaking={isSpeaking} isLoading={loading} />
          </div>
        </div>
      </section>

      <section className="rightPane">
        <div className="rightPaneInner">
          <section className="card gmailCard">
            <div className="gmailRow">
              <div>
                <h3>Gmail Connection</h3>
                <p className="gmailStatusText">
                  {gmailStatus.mockMode
                    ? 'Mock mode active (local emails.json)'
                    : gmailStatus.connected
                    ? `Connected (${gmailStatus.source})`
                    : 'Not connected'}
                </p>
              </div>

              {!gmailStatus.mockMode && (
                <a className="connectButton" href={`${API_BASE_URL}/auth/google/start`}>
                  Connect Gmail
                </a>
              )}
            </div>
            {!gmailStatus.mockMode && !gmailStatus.oauthConfigured && !gmailStatus.connected && (
              <p className="helpText">
                Configure GOOGLE_CLIENT_ID/SECRET in backend .env to enable OAuth.
              </p>
            )}
          </section>

          <VoiceInput
            ref={voiceRef}
            onTranscriptReady={handleTranscriptReady}
            onListeningChange={setIsListening}
          />

          <section className="card chatCard">
            <div className="chatThread">
              {chatLog.length === 0 && (
                <p className="chatEmpty">Tap the orb and say something!</p>
              )}
              {chatLog.map((msg, i) => (
                <div key={i} className={`chatBubble ${msg.role}`}>
                  <p>{msg.text}</p>
                  {msg.summary && msg.summary.length > 0 && (
                    <ul className="summaryList">
                      {msg.summary.map((item, idx) => (
                        <li key={`${item.from}-${idx}`}>
                          {item.priority && priorityBadge(item.priority)}
                          <strong>{item.from}</strong>: {item.subject} — {item.reason}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>
          </section>

          {error && (
            <section className="card errorBox">
              <p>{error}</p>
            </section>
          )}
        </div>
      </section>
    </main>
  );
}
