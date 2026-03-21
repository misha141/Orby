const express = require('express');
const { parseCommand, chat } = require('../services/openai');
const { executeAction } = require('../services/actionRouter');
const {
  hasOAuthConfig,
  buildAuthUrl,
  handleGoogleCallback,
  getGmailConnectionStatus,
  buildFrontendRedirectUrl
} = require('../services/googleAuth');

const router = express.Router();

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
    return res.json(structured);
  } catch (error) {
    console.error('Parse command error:', error);
    return res.status(500).json({ error: 'Failed to parse command' });
  }
});

router.post('/execute-action', async (req, res) => {
  try {
    const result = await executeAction(req.body || {});
    return res.json(result);
  } catch (error) {
    console.error('Execute action error:', error);
    return res.status(500).json({ error: 'Failed to execute action' });
  }
});

router.post('/chat', async (req, res) => {
  try {
    const { history } = req.body;

    if (!Array.isArray(history) || history.length === 0) {
      return res.status(400).json({ error: 'history array is required' });
    }

    const chatResult = await chat(history);

    // If the model decided on an action, execute it immediately
    if (chatResult.action && chatResult.action.intent !== 'unknown') {
      const actionResult = await executeAction(chatResult.action);
      return res.json({
        reply: chatResult.reply,
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
