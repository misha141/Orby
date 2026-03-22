import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import VoiceInput from '../components/VoiceInput';
import OrbyAvatar from '../components/OrbyAvatar';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000';

export default function HomePage() {
  const [chatLog, setChatLog] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [pendingEmailReply, setPendingEmailReply] = useState(null);
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

      if (data.result?.status === 'requires_confirmation' && data.action?.intent === 'reply_email') {
        const options = Array.isArray(data.result.details?.options) ? data.result.details.options : [];
        const preview = data.result.details?.preview || null;
        const selectedOption = options[0] || null;
        const pendingDraft = {
          recipient: data.result.details?.target || data.action?.target || '',
          message: data.result.details?.message || data.action?.message || '',
          options,
          selectedOption,
          preview
        };

        entry.emailReplyPreview = pendingDraft;
        setPendingEmailReply(pendingDraft);
      } else {
        setPendingEmailReply(null);
      }

      if (data.result?.details?.preview && data.result?.status === 'success' && data.action?.intent === 'reply_email') {
        entry.sentEmailPreview = data.result.details.preview;
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

  const handleSelectEmailOption = useCallback((option) => {
    setPendingEmailReply((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        selectedOption: option,
        preview: {
          toName: option.displayName,
          toEmail: option.email,
          subject: option.subject ? (/^re:/i.test(option.subject) ? option.subject : `Re: ${option.subject}`) : 'Reply from Orby',
          body: current.message
        }
      };
    });
  }, []);

  const handleConfirmEmailReply = useCallback(async () => {
    if (!pendingEmailReply?.selectedOption) {
      setError('Choose a recipient before sending the email.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const selected = pendingEmailReply.selectedOption;
      const res = await fetch(`${API_BASE_URL}/confirm-email-reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipient: pendingEmailReply.recipient,
          displayName: selected.displayName,
          recipientEmail: selected.email,
          subject: selected.subject,
          threadId: selected.threadId,
          message: pendingEmailReply.message
        })
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to send email.');
      }

      setChatLog((prev) => [
        ...prev,
        {
          role: 'assistant',
          text: data.message || 'Email sent.',
          sentEmailPreview: data.details?.preview || null
        }
      ]);
      setPendingEmailReply(null);
      speakText(data.message || 'Email sent.');
    } catch (err) {
      const errMessage = err.message || 'Failed to send email.';
      setError(errMessage);
      setChatLog((prev) => [...prev, { role: 'assistant', text: errMessage }]);
      speakText(errMessage);
    } finally {
      setLoading(false);
    }
  }, [pendingEmailReply, speakText]);

  const handleCancelEmailReply = useCallback(() => {
    setPendingEmailReply(null);
    setChatLog((prev) => [...prev, { role: 'assistant', text: 'Okay, I won’t send that email.' }]);
    speakText('Okay, I will not send that email.');
  }, [speakText]);

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

  const actionButtonStyle = {
    background: '#2f7fd3',
    color: '#fff',
    border: 'none',
    borderRadius: '999px',
    padding: '10px 16px',
    fontSize: '0.9rem',
    cursor: 'pointer'
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
                  {msg.emailReplyPreview && (
                    <div className="transcriptBox" style={{ marginTop: '12px' }}>
                      <p><strong>Draft Preview</strong></p>
                      <p>To: {(pendingEmailReply?.preview || msg.emailReplyPreview.preview)?.toName} {(pendingEmailReply?.preview || msg.emailReplyPreview.preview)?.toEmail ? `(${(pendingEmailReply?.preview || msg.emailReplyPreview.preview).toEmail})` : ''}</p>
                      <p>Subject: {(pendingEmailReply?.preview || msg.emailReplyPreview.preview)?.subject}</p>
                      <p>Message: {(pendingEmailReply?.preview || msg.emailReplyPreview.preview)?.body}</p>
                      {msg.emailReplyPreview.options?.length > 0 && (
                        <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          {msg.emailReplyPreview.options.map((option) => {
                            const isSelected =
                              pendingEmailReply?.selectedOption?.email === option.email &&
                              pendingEmailReply?.selectedOption?.threadId === option.threadId;

                            return (
                              <button
                                key={`${option.email}-${option.threadId}`}
                                type="button"
                                onClick={() => handleSelectEmailOption(option)}
                                style={{
                                  ...actionButtonStyle,
                                  background: isSelected ? '#4cc9f0' : '#31456a',
                                  textAlign: 'left'
                                }}
                              >
                                {option.displayName} ({option.email})
                              </button>
                            );
                          })}
                        </div>
                      )}
                      {pendingEmailReply && (
                        <div style={{ marginTop: '12px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                          <button type="button" onClick={handleConfirmEmailReply} style={actionButtonStyle}>
                            Send Email
                          </button>
                          <button
                            type="button"
                            onClick={handleCancelEmailReply}
                            style={{ ...actionButtonStyle, background: '#5c677d' }}
                          >
                            Cancel
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                  {msg.sentEmailPreview && (
                    <div className="transcriptBox" style={{ marginTop: '12px' }}>
                      <p><strong>Sent Email</strong></p>
                      <p>To: {msg.sentEmailPreview.toName} ({msg.sentEmailPreview.toEmail})</p>
                      <p>Subject: {msg.sentEmailPreview.subject}</p>
                      <p>Message: {msg.sentEmailPreview.body}</p>
                    </div>
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
