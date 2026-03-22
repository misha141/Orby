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

async function gmailRequest(path, options = {}) {
  const token = await getValidGmailAccessToken();
  if (!token) {
    throw new Error('No valid Gmail access token available');
  }

  const response = await fetch(`${GMAIL_API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Gmail API error (${response.status}): ${body}`);
  }

  return response;
}

function parseAddress(value = '') {
  const trimmed = String(value || '').trim();
  const angleMatch = trimmed.match(/^(.*?)(?:\s*)<([^>]+)>$/);

  if (angleMatch) {
    return {
      name: angleMatch[1].replace(/^"|"$/g, '').trim(),
      email: angleMatch[2].trim(),
      raw: trimmed
    };
  }

  const emailMatch = trimmed.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);

  return {
    name: emailMatch ? trimmed.replace(emailMatch[0], '').replace(/[()<>]/g, '').trim() : trimmed,
    email: emailMatch ? emailMatch[0].trim() : '',
    raw: trimmed
  };
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
    const sender = parseAddress(from);

    return {
      id: msg.id || '',
      threadId: msg.threadId || '',
      from,
      senderName: sender.name || from,
      senderEmail: sender.email || '',
      subject,
      snippet: msg.snippet || ''
    };
  });
}

function encodeMessage(rawMessage) {
  return Buffer.from(rawMessage)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

async function sendEmail({ to, subject, body, threadId = '' } = {}) {
  const normalizedTo = String(to || '').trim();
  const normalizedSubject = String(subject || '').trim() || 'Reply from Orby';
  const normalizedBody = String(body || '').trim();

  if (!normalizedTo) {
    throw new Error('Recipient email address is required');
  }

  if (!normalizedBody) {
    throw new Error('Email body is required');
  }

  const rawMessage = [
    `To: ${normalizedTo}`,
    `Subject: ${normalizedSubject}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'MIME-Version: 1.0',
    '',
    normalizedBody
  ].join('\r\n');

  const payload = {
    raw: encodeMessage(rawMessage)
  };

  if (threadId) {
    payload.threadId = threadId;
  }

  const response = await gmailRequest('/messages/send', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  return response.json();
}

module.exports = {
  listInboxEmails,
  parseAddress,
  sendEmail
};
