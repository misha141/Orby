let gmailTokens = {
  accessToken: '',
  refreshToken: '',
  expiryDate: 0
};

let pendingState = {
  value: '',
  expiresAt: 0
};

function setPendingState(value, ttlMs = 10 * 60 * 1000) {
  pendingState = {
    value,
    expiresAt: Date.now() + ttlMs
  };
}

function consumePendingState(value) {
  const valid =
    pendingState.value &&
    pendingState.value === value &&
    pendingState.expiresAt > Date.now();

  pendingState = { value: '', expiresAt: 0 };
  return valid;
}

function setGmailTokens({ accessToken, refreshToken, expiryDate }) {
  gmailTokens = {
    accessToken: accessToken || gmailTokens.accessToken || '',
    refreshToken: refreshToken || gmailTokens.refreshToken || '',
    expiryDate: expiryDate || gmailTokens.expiryDate || 0
  };
}

function getGmailTokens() {
  return { ...gmailTokens };
}

function hasStoredAccessToken() {
  return Boolean(gmailTokens.accessToken);
}

function hasStoredRefreshToken() {
  return Boolean(gmailTokens.refreshToken);
}

module.exports = {
  setPendingState,
  consumePendingState,
  setGmailTokens,
  getGmailTokens,
  hasStoredAccessToken,
  hasStoredRefreshToken
};
