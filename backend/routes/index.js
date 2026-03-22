const express = require('express');
const { parseCommand, chat } = require('../services/openai');
const { executeAction } = require('../services/actionRouter');
const { previewTool } = require('../tools/toolRegistry');
const {
  hasOAuthConfig,
  buildAuthUrl,
  handleGoogleCallback,
  getGmailConnectionStatus,
  buildFrontendRedirectUrl
} = require('../services/googleAuth');

const router = express.Router();

router.post('/realtime/transcription-session', async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: 'OPENAI_API_KEY is required for realtime transcription.' });
    }

    if (!req.body || typeof req.body !== 'string') {
      return res.status(400).json({ error: 'SDP offer is required.' });
    }

    const sessionConfig = {
      type: 'transcription',
      audio: {
        input: {
          noise_reduction: {
            type: process.env.OPENAI_TRANSCRIBE_NOISE_REDUCTION || 'far_field'
          },
          transcription: {
            model: process.env.OPENAI_TRANSCRIBE_MODEL || 'gpt-4o-transcribe',
            language: process.env.OPENAI_TRANSCRIBE_LANGUAGE || 'en',
            prompt:
              process.env.OPENAI_TRANSCRIBE_PROMPT ||
              'Common words include Orby, Gmail, Google Tasks, Neha, Misha, Michelle, calendar, assignment, inbox, reply, and meeting.'
          },
          turn_detection: {
            type: 'server_vad',
            threshold: 0.5,
            prefix_padding_ms: 300,
            silence_duration_ms: 500
          }
        }
      }
    };

    const formData = new FormData();
    formData.set('sdp', req.body);
    formData.set('session', JSON.stringify(sessionConfig));

    const openAIResponse = await fetch('https://api.openai.com/v1/realtime/calls', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: formData
    });

    const sdpAnswer = await openAIResponse.text();

    if (!openAIResponse.ok) {
      console.error('[orby] realtime transcription session error:', sdpAnswer);
      return res.status(openAIResponse.status).send(sdpAnswer);
    }

    console.log('[orby] realtime transcription session created');
    res.type('application/sdp');
    return res.send(sdpAnswer);
  } catch (error) {
    console.error('Realtime transcription session error:', error);
    return res.status(500).json({ error: 'Failed to create realtime transcription session' });
  }
});

router.get('/auth/google/status', (_req, res) => {
  return res.json({
    ...getGmailConnectionStatus(),
    mockMode: String(process.env.USE_MOCK_GMAIL || '').toLowerCase() === 'true'
  });
});

router.get('/auth/google/start', (_req, res) => {
  try {
    if (!hasOAuthConfig()) {
      return res.status(400).json({
        error:
          'Google OAuth is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI.'
      });
    }

    const authUrl = buildAuthUrl();
    return res.redirect(authUrl);
  } catch (error) {
    console.error('Google auth start error:', error);
    return res.status(500).json({ error: 'Failed to start Google auth' });
  }
});

router.get('/auth/google/callback', async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    return res.redirect(buildFrontendRedirectUrl('error', String(error)));
  }

  if (!code || !state) {
    return res.redirect(buildFrontendRedirectUrl('error', 'missing_code_or_state'));
  }

  try {
    await handleGoogleCallback({ code: String(code), state: String(state) });
    return res.redirect(buildFrontendRedirectUrl('connected'));
  } catch (callbackError) {
    console.error('Google auth callback error:', callbackError);
    return res.redirect(buildFrontendRedirectUrl('error', 'oauth_callback_failed'));
  }
});

router.post('/parse-command', async (req, res) => {
  try {
    const { text } = req.body;

    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'text is required' });
    }

    const structured = await parseCommand(text);
    console.log('[orby] /parse-command result:', structured);
    return res.json(structured);
  } catch (error) {
    console.error('Parse command error:', error);
    return res.status(500).json({ error: 'Failed to parse command' });
  }
});

router.post('/execute-action', async (req, res) => {
  try {
    console.log('[orby] /execute-action request:', req.body || {});
    const result = await executeAction(req.body || {});
    console.log('[orby] /execute-action result:', result);
    return res.json(result);
  } catch (error) {
    console.error('Execute action error:', error);
    return res.status(500).json({ error: 'Failed to execute action' });
  }
});

router.post('/confirm-email-reply', async (req, res) => {
  try {
    console.log('[orby] /confirm-email-reply request:', req.body || {});
    const result = await executeAction({
      intent: 'reply_email',
      target: req.body?.recipient || req.body?.displayName || '',
      message: req.body?.message || '',
      arguments: {
        recipient: req.body?.recipient || req.body?.displayName || '',
        recipientEmail: req.body?.recipientEmail || '',
        displayName: req.body?.displayName || '',
        subject: req.body?.subject || '',
        threadId: req.body?.threadId || '',
        message: req.body?.message || ''
      }
    });
    console.log('[orby] /confirm-email-reply result:', result);
    return res.json(result);
  } catch (error) {
    console.error('Confirm email reply error:', error);
    return res.status(500).json({ error: error.message || 'Failed to send email reply' });
  }
});

router.post('/chat', async (req, res) => {
  try {
    const { history } = req.body;

    if (!Array.isArray(history) || history.length === 0) {
      return res.status(400).json({ error: 'history array is required' });
    }

    const lastMessage = history[history.length - 1];
    console.log('[orby] /chat last user message:', lastMessage);

    const chatResult = await chat(history);
    console.log('[orby] /chat planner result:', chatResult);

    // If the model decided on an action, execute it immediately
    if (chatResult.action && chatResult.action.intent !== 'unknown') {
      console.log('[orby] /chat executing action:', chatResult.action);
      const actionResult =
        chatResult.action.intent === 'reply_email'
          ? await previewTool(chatResult.action.tool || chatResult.action.intent, chatResult.action.arguments || {})
          : await executeAction(chatResult.action);
      console.log('[orby] /chat action result:', actionResult);
      return res.json({
        reply: actionResult?.message || chatResult.reply,
        action: chatResult.action,
        result: actionResult
      });
    }

    // Pure conversation — no action
    return res.json({
      reply: chatResult.reply,
      action: null,
      result: null
    });
  } catch (error) {
    console.error('Chat error:', error);
    return res.status(500).json({ error: 'Failed to process chat' });
  }
});

module.exports = router;
