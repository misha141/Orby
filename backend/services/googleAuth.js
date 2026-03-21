const crypto = require('crypto');
const {
  setPendingState,
  consumePendingState,
  setGmailTokens,
  getGmailTokens,
  hasStoredAccessToken,
  hasStoredRefreshToken
} = require('./oauthStore');

const GOOGLE_AUTH_BASE = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];

function getOAuthConfig() {
  return {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    redirectUri:
      process.env.GOOGLE_REDIRECT_URI ||
      'http://localhost:4000/auth/google/callback',
    frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000'
  };
}

function hasOAuthConfig() {
  const { clientId, clientSecret, redirectUri } = getOAuthConfig();
  return Boolean(clientId && clientSecret && redirectUri);
}

function buildAuthUrl() {
  const { clientId, redirectUri } = getOAuthConfig();

  if (!clientId) {
    throw new Error('GOOGLE_CLIENT_ID is not configured');
  }

  const state = crypto.randomBytes(16).toString('hex');
  setPendingState(state);

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    state
  });

  return `${GOOGLE_AUTH_BASE}?${params.toString()}`;
}

async function exchangeCodeForToken(code) {
  const { clientId, clientSecret, redirectUri } = getOAuthConfig();

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri
  });

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: body.toString()
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Token exchange failed (${response.status}): ${text}`);
  }

  return response.json();
}

async function refreshAccessToken() {
  const { clientId, clientSecret } = getOAuthConfig();
  const { refreshToken } = getGmailTokens();

  if (!refreshToken) {
    return '';
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token'
  });

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: body.toString()
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Token refresh failed (${response.status}): ${text}`);
  }

  const tokenData = await response.json();
  const expiryDate = Date.now() + (tokenData.expires_in || 3600) * 1000;

  setGmailTokens({
    accessToken: tokenData.access_token,
    refreshToken,
    expiryDate
  });

  return tokenData.access_token;
}

async function handleGoogleCallback({ code, state }) {
  if (!consumePendingState(state)) {
    throw new Error('Invalid or expired OAuth state');
  }

  const tokenData = await exchangeCodeForToken(code);
  const expiryDate = Date.now() + (tokenData.expires_in || 3600) * 1000;

  setGmailTokens({
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token,
    expiryDate
  });
}

async function getValidGmailAccessToken() {
  if (process.env.GMAIL_ACCESS_TOKEN) {
    return process.env.GMAIL_ACCESS_TOKEN;
  }

  const { accessToken, expiryDate } = getGmailTokens();

  if (accessToken && expiryDate > Date.now() + 30 * 1000) {
    return accessToken;
  }

  return refreshAccessToken();
}

function getGmailConnectionStatus() {
  if (process.env.GMAIL_ACCESS_TOKEN) {
    return {
      connected: true,
      source: 'env',
      hasRefreshToken: false,
      oauthConfigured: hasOAuthConfig()
    };
  }

  return {
    connected: hasStoredAccessToken() || hasStoredRefreshToken(),
    source: hasStoredAccessToken() || hasStoredRefreshToken() ? 'oauth' : 'none',
    hasRefreshToken: hasStoredRefreshToken(),
    oauthConfigured: hasOAuthConfig()
  };
}

function buildFrontendRedirectUrl(status, reason = '') {
  const { frontendUrl } = getOAuthConfig();
  const params = new URLSearchParams({ gmail: status });

  if (reason) {
    params.set('reason', reason);
  }

  return `${frontendUrl}?${params.toString()}`;
}

module.exports = {
  hasOAuthConfig,
  buildAuthUrl,
  handleGoogleCallback,
  getValidGmailAccessToken,
  getGmailConnectionStatus,
  buildFrontendRedirectUrl
};
