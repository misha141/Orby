const fs = require('fs/promises');
const path = require('path');
const { listInboxEmails, parseAddress, sendEmail } = require('./gmail');
const { getGmailConnectionStatus } = require('./googleAuth');
const { summarizeImportantEmails } = require('./emailSummaryService');

const EMAILS_PATH = path.join(__dirname, '..', 'data', 'emails.json');

async function loadMockEmails() {
  const raw = await fs.readFile(EMAILS_PATH, 'utf-8');
  return JSON.parse(raw);
}

async function loadEmailsWithFallback() {
  if (String(process.env.USE_MOCK_GMAIL || '').toLowerCase() === 'true') {
    console.log('[orby] emailService using mock emails because USE_MOCK_GMAIL=true');
    const mockEmails = await loadMockEmails();
    return { emails: mockEmails, source: 'mock-forced' };
  }

  if (getGmailConnectionStatus().connected) {
    try {
      const gmailEmails = await listInboxEmails();
      if (gmailEmails.length > 0) {
        console.log('[orby] emailService fetched inbox from Gmail API:', {
          count: gmailEmails.length
        });
        return { emails: gmailEmails, source: 'gmail' };
      }
    } catch (error) {
      console.warn('Gmail fetch failed, falling back to mock emails:', error.message);
    }
  }

  console.log('[orby] emailService falling back to local mock emails');
  const mockEmails = await loadMockEmails();
  return { emails: mockEmails, source: 'mock' };
}

async function getImportantEmails() {
  console.log('[orby] getImportantEmails triggered');
  const { emails, source } = await loadEmailsWithFallback();
  const summary = await summarizeImportantEmails(emails);

  return {
    status: 'success',
    message:
      source === 'gmail'
        ? 'Here are your emails prioritized from Gmail inbox'
        : 'Here are your emails ranked by priority',
    summary,
    source
  };
}

function normalizePersonName(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function scoreRecipientMatch(query, email) {
  const normalizedQuery = normalizePersonName(query);
  const senderName = normalizePersonName(email.senderName || email.from || '');
  const senderEmail = String(email.senderEmail || '').toLowerCase();
  const rawFrom = String(email.from || '').toLowerCase();

  if (!normalizedQuery) {
    return 0;
  }

  if (senderName === normalizedQuery) {
    return 100;
  }

  if (senderName.includes(normalizedQuery)) {
    return 80;
  }

  const queryParts = normalizedQuery.split(' ').filter(Boolean);
  const matchedParts = queryParts.filter(
    (part) => senderName.includes(part) || senderEmail.includes(part) || rawFrom.includes(part)
  ).length;

  if (matchedParts === queryParts.length && matchedParts > 0) {
    return 60 + matchedParts;
  }

  if (matchedParts > 0) {
    return 20 + matchedParts;
  }

  return 0;
}

async function resolveRecipient(recipient) {
  const directAddress = parseAddress(recipient);

  if (directAddress.email) {
    return {
      displayName: directAddress.name || recipient,
      email: directAddress.email,
      source: 'direct'
    };
  }

  if (!getGmailConnectionStatus().connected) {
    throw new Error('Gmail must be connected to resolve recipient names');
  }

  const inboxEmails = await listInboxEmails();
  const rankedMatches = inboxEmails
    .map((email) => ({
      email,
      score: scoreRecipientMatch(recipient, email)
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  const bestMatch = rankedMatches[0];

  if (!bestMatch || !bestMatch.email.senderEmail) {
    throw new Error(`Could not find an email address for "${recipient}" in recent inbox messages`);
  }

  return {
    displayName: bestMatch.email.senderName || recipient,
    email: bestMatch.email.senderEmail,
    subject: bestMatch.email.subject || '',
    threadId: bestMatch.email.threadId || '',
    source: 'inbox-match'
  };
}

async function findRecipientOptions(recipient) {
  const directAddress = parseAddress(recipient);

  if (directAddress.email) {
    return [
      {
        displayName: directAddress.name || recipient,
        email: directAddress.email,
        subject: '',
        threadId: '',
        source: 'direct',
        score: 100
      }
    ];
  }

  if (!getGmailConnectionStatus().connected) {
    throw new Error('Gmail must be connected to resolve recipient names');
  }

  const inboxEmails = await listInboxEmails();
  const rankedMatches = inboxEmails
    .map((email) => ({
      displayName: email.senderName || recipient,
      email: email.senderEmail || '',
      subject: email.subject || '',
      threadId: email.threadId || '',
      source: 'inbox-match',
      score: scoreRecipientMatch(recipient, email)
    }))
    .filter((entry) => entry.score > 0 && entry.email)
    .sort((a, b) => b.score - a.score);

  const deduped = [];
  const seen = new Set();

  for (const option of rankedMatches) {
    const key = `${option.displayName}|${option.email}|${option.threadId}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(option);
    }
  }

  return deduped.slice(0, 5);
}

function buildReplySubject(subject = '') {
  return subject
    ? /^re:/i.test(subject)
      ? subject
      : `Re: ${subject}`
    : 'Reply from Orby';
}

async function prepareReplyEmail({ recipient = '', message = '' } = {}) {
  console.log('[orby] prepareReplyEmail triggered:', {
    recipient,
    message
  });

  if (!recipient.trim()) {
    throw new Error('Recipient is required to send an email');
  }

  if (!message.trim()) {
    throw new Error('Message is required to send an email');
  }

  if (!getGmailConnectionStatus().connected) {
    throw new Error('Gmail is not connected. Please connect Gmail before sending email.');
  }

  const options = await findRecipientOptions(recipient);

  if (options.length === 0) {
    throw new Error(`Could not find an email address for "${recipient}" in recent inbox messages`);
  }

  console.log('[orby] prepareReplyEmail recipient options:', options);

  const selectedRecipient = options[0];

  return {
    status: 'requires_confirmation',
    message:
      options.length > 1
        ? `I found a few matches for ${recipient}. Choose the right person before I send it.`
        : `I found ${selectedRecipient.displayName}. Review the draft below before I send it.`,
    details: {
      target: recipient,
      message,
      preview: {
        toName: selectedRecipient.displayName || recipient,
        toEmail: selectedRecipient.email,
        subject: buildReplySubject(selectedRecipient.subject),
        body: message
      },
      options: options.map((option) => ({
        displayName: option.displayName,
        email: option.email,
        subject: option.subject,
        threadId: option.threadId,
        source: option.source
      }))
    }
  };
}

async function replyEmail({ recipient = '', message = '', recipientEmail = '', threadId = '', subject = '', displayName = '' } = {}) {
  console.log('[orby] replyEmail triggered:', {
    recipient,
    recipientEmail,
    threadId,
    subject,
    displayName,
    message
  });

  if (!message.trim()) {
    throw new Error('Message is required to send an email');
  }

  if (!getGmailConnectionStatus().connected) {
    throw new Error('Gmail is not connected. Please connect Gmail before sending email.');
  }

  let resolvedRecipient;

  if (recipientEmail.trim()) {
    resolvedRecipient = {
      displayName: displayName || recipient || recipientEmail,
      email: recipientEmail.trim(),
      subject: subject || '',
      threadId: threadId || '',
      source: 'confirmed-option'
    };
  } else {
    resolvedRecipient = await resolveRecipient(recipient);
  }

  console.log('[orby] replyEmail resolved recipient:', resolvedRecipient);

  const sendResult = await sendEmail({
    to: resolvedRecipient.email,
    subject: buildReplySubject(resolvedRecipient.subject),
    body: message,
    threadId: resolvedRecipient.threadId
  });

  console.log('[orby] replyEmail Gmail send success:', {
    id: sendResult.id,
    threadId: sendResult.threadId,
    labelIds: sendResult.labelIds
  });

  return {
    status: 'success',
    message: `Reply sent to ${resolvedRecipient.displayName || recipient}`,
    details: {
      target: resolvedRecipient.displayName || recipient,
      recipientEmail: resolvedRecipient.email,
      preview: {
        toName: resolvedRecipient.displayName || recipient,
        toEmail: resolvedRecipient.email,
        subject: buildReplySubject(resolvedRecipient.subject),
        body: message
      },
      message,
      simulated: false,
      provider: 'gmail',
      source: resolvedRecipient.source,
      gmailMessageId: sendResult.id || '',
      gmailThreadId: sendResult.threadId || resolvedRecipient.threadId || ''
    }
  };
}

module.exports = {
  getImportantEmails,
  prepareReplyEmail,
  replyEmail
};
