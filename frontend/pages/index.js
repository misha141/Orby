import { useCallback, useEffect, useMemo, useState } from 'react';
import VoiceInput from '../components/VoiceInput';
import ActionPreview from '../components/ActionPreview';
import ResponseBox from '../components/ResponseBox';
import OrbyAvatar from '../components/OrbyAvatar';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000';

export default function HomePage() {
  const [parsedAction, setParsedAction] = useState(null);
  const [response, setResponse] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [conversationMode, setConversationMode] = useState(false);
  const [voiceRepliesEnabled, setVoiceRepliesEnabled] = useState(true);
  const [autoStartSignal, setAutoStartSignal] = useState(0);
  const [gmailStatus, setGmailStatus] = useState({
    connected: false,
    source: 'none',
    oauthConfigured: false,
    mockMode: false
  });
  const [conversationListeningEnabled, setConversationListeningEnabled] = useState(false);

  const queueNextListeningCycle = useCallback(() => {
    if (!conversationMode || !conversationListeningEnabled) {
      return;
    }
    setAutoStartSignal((value) => value + 1);
  }, [conversationMode, conversationListeningEnabled]);

  const speakText = useCallback((text, onDone) => {
    if (typeof window === 'undefined' || !window.speechSynthesis || !voiceRepliesEnabled || !text) {
      if (onDone) {
        onDone();
      }
      return;
    }

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1;
    utterance.pitch = 1;

    utterance.onend = () => {
      if (onDone) {
        onDone();
      }
    };

    utterance.onerror = () => {
      if (onDone) {
        onDone();
      }
    };

    window.speechSynthesis.speak(utterance);
  }, [voiceRepliesEnabled]);

  const buildSpokenReply = useCallback((payload) => {
    if (!payload) {
      return 'Done.';
    }

    const base = payload.message || 'Done.';
    if (!Array.isArray(payload.summary) || payload.summary.length === 0) {
      return base;
    }

    const summaryText = payload.summary
      .slice(0, 3)
      .map((item) => `${item.from}: ${item.subject}`)
      .join('. ');

    return `${base}. Top emails: ${summaryText}.`;
  }, []);

  const buildActionPreviewSpeech = useCallback((action) => {
    if (!action) {
      return 'I did not catch that command.';
    }

    if (action.intent === 'reply_email') {
      return `I can send a reply to ${action.target || 'the contact'}. Do you want me to continue?`;
    }

    if (action.intent === 'schedule_meeting') {
      return `I can schedule this meeting${action.target ? ` with ${action.target}` : ''}. Should I proceed?`;
    }

    if (action.intent === 'get_important_emails') {
      return 'I can summarize your important inbox emails. Should I continue?';
    }

    return 'I could not map that request to an action yet.';
  }, []);

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
      setResponse({ message: 'Gmail connected. Orby can now prioritize your inbox.' });
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
      return 'Orby is working on it...';
    }

    if (isListening) {
      return 'Voice channel open';
    }

    if (conversationMode && !conversationListeningEnabled) {
      return 'Conversation paused (stop listening pressed)';
    }

    return conversationMode ? 'Conversation mode is active' : 'Orby is ready to help!';
  }, [loading, isListening, conversationMode, conversationListeningEnabled]);

  const executeParsedAction = useCallback(async (action, shouldContinueConversation = false) => {
    setLoading(true);
    setError('');

    try {
      const result = await fetch(`${API_BASE_URL}/execute-action`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(action)
      });

      if (!result.ok) {
        throw new Error('Orby could not complete that action.');
      }

      const payload = await result.json();
      setResponse(payload);
      setParsedAction(null);

      speakText(buildSpokenReply(payload), () => {
        if (shouldContinueConversation) {
          queueNextListeningCycle();
        }
      });
    } catch (err) {
      const errMessage = err.message || 'Failed to execute action';
      setError(errMessage);
      speakText(errMessage, () => {
        if (shouldContinueConversation) {
          queueNextListeningCycle();
        }
      });
    } finally {
      setLoading(false);
    }
  }, [buildSpokenReply, queueNextListeningCycle, speakText]);

  const handleTranscriptReady = useCallback(async (text) => {
    setLoading(true);
    setError('');
    setResponse(null);

    try {
      const result = await fetch(`${API_BASE_URL}/parse-command`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ text })
      });

      if (!result.ok) {
        throw new Error('Orby could not understand that command.');
      }

      const action = await result.json();
      if (conversationMode) {
        await executeParsedAction(action, true);
      } else {
        setParsedAction(action);
        speakText(buildActionPreviewSpeech(action));
      }
    } catch (err) {
      setParsedAction(null);
      const errMessage = err.message || 'Failed to parse command';
      setError(errMessage);
      if (conversationMode) {
        speakText(errMessage, () => queueNextListeningCycle());
      }
    } finally {
      setLoading(false);
    }
  }, [buildActionPreviewSpeech, conversationMode, executeParsedAction, queueNextListeningCycle, speakText]);

  const handleConfirm = async () => {
    if (!parsedAction) {
      return;
    }

    await executeParsedAction(parsedAction, false);
  };

  const handleCancel = () => {
    setParsedAction(null);
    const cancelled = { message: 'Action cancelled. Orby is standing by.' };
    setResponse(cancelled);
    setError('');
    speakText(cancelled.message);
  };

  const handleToggleConversationMode = () => {
    setConversationMode((current) => {
      const next = !current;
      if (next) {
        setConversationListeningEnabled(true);
        speakText('Conversation mode enabled. Ask me about your inbox.', () => {
          queueNextListeningCycle();
        });
      } else {
        setConversationListeningEnabled(false);
        speakText('Conversation mode disabled. You can use manual confirmation.');
      }
      return next;
    });
  };

  return (
    <main className="splitPage">
      <section className="leftPane">
        <div className="leftPaneInner">
          <h1>Orby - Your Voice Assistant</h1>
          <p className="subtitle">{statusText}</p>
          <OrbyAvatar isListening={isListening} />
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

          <section className="card modeCard">
            <div className="modeRow">
              <button
                className={`toggleButton ${conversationMode ? 'on' : ''}`}
                type="button"
                onClick={handleToggleConversationMode}
              >
                {conversationMode ? 'Conversation Mode: On' : 'Conversation Mode: Off'}
              </button>
              <button
                className={`toggleButton ${voiceRepliesEnabled ? 'on' : ''}`}
                type="button"
                onClick={() => setVoiceRepliesEnabled((value) => !value)}
              >
                {voiceRepliesEnabled ? 'Voice Replies: On' : 'Voice Replies: Off'}
              </button>
            </div>
            <p className="helpText">
              In conversation mode, Orby executes commands and speaks the response automatically.
            </p>
          </section>

          <VoiceInput
            onTranscriptReady={handleTranscriptReady}
            onListeningChange={setIsListening}
            autoStartSignal={autoStartSignal}
            conversationMode={conversationMode}
            onStopListening={() => setConversationListeningEnabled(false)}
          />

          {!conversationMode && (
            <ActionPreview
              action={parsedAction}
              onConfirm={handleConfirm}
              onCancel={handleCancel}
              loading={loading}
            />
          )}

          {error && (
            <section className="card errorBox">
              <p>{error}</p>
            </section>
          )}

          <ResponseBox response={response} />
        </div>
      </section>
    </main>
  );
}
