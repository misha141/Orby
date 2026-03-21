const { getValidGmailAccessToken } = require('./googleAuth');

const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

function parseHeader(headers = [], name) {
  const found = headers.find((h) => h.name?.toLowerCase() === name.toLowerCase());
  return found?.value || '';
}

async function gmailFetch(path) {
  const token = await getValidGmailAccessToken();
  if (!token) {
    throw new Error('No valid Gmail access token available');
  }

  const response = await fetch(`${GMAIL_API_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Gmail API error (${response.status}): ${body}`);
  }

  return response.json();
}

async function listInboxEmails() {
  const maxResults = Number(process.env.GMAIL_MAX_EMAILS || 8);
  const query = encodeURIComponent(process.env.GMAIL_QUERY || 'in:inbox');

  const listData = await gmailFetch(
    `/messages?labelIds=INBOX&maxResults=${maxResults}&q=${query}`
  );

  const messageIds = Array.isArray(listData.messages)
    ? listData.messages.map((m) => m.id).filter(Boolean)
    : [];

  if (messageIds.length === 0) {
    return [];
  }

  const messages = await Promise.all(
    messageIds.map((id) =>
      gmailFetch(`/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`)
    )
  );

  return messages.map((msg) => {
    const from = parseHeader(msg.payload?.headers, 'From') || 'Unknown sender';
    const subject = parseHeader(msg.payload?.headers, 'Subject') || '(No subject)';

    return {
      from,
      subject,
      snippet: msg.snippet || ''
    };
  });
}

module.exports = {
  listInboxEmails
};
