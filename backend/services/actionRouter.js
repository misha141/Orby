const fs = require('fs/promises');
const path = require('path');
const { summarizeImportantEmails } = require('./openai');
const { listInboxEmails } = require('./gmail');
const { getGmailConnectionStatus } = require('./googleAuth');

const EMAILS_PATH = path.join(__dirname, '..', 'data', 'emails.json');

async function loadMockEmails() {
  const raw = await fs.readFile(EMAILS_PATH, 'utf-8');
  return JSON.parse(raw);
}

async function loadEmailsWithFallback() {
  if (String(process.env.USE_MOCK_GMAIL || '').toLowerCase() === 'true') {
    const mockEmails = await loadMockEmails();
    return { emails: mockEmails, source: 'mock-forced' };
  }

  if (getGmailConnectionStatus().connected) {
    try {
      const gmailEmails = await listInboxEmails();
      if (gmailEmails.length > 0) {
        return { emails: gmailEmails, source: 'gmail' };
      }
    } catch (error) {
      console.warn('Gmail fetch failed, falling back to mock emails:', error.message);
    }
  }

  const mockEmails = await loadMockEmails();
  return { emails: mockEmails, source: 'mock' };
}

async function executeAction(command) {
  const { intent, target, message, date, time } = command;

  switch (intent) {
    case 'reply_email':
      return {
        status: 'success',
        message: `Reply sent to ${target || 'recipient'}`,
        details: {
          target,
          message
        }
      };

    case 'schedule_meeting':
      return {
        status: 'success',
        message: `Meeting scheduled${target ? ` with ${target}` : ''}`,
        details: {
          target,
          date,
          time,
          note: message
        }
      };

    case 'get_important_emails': {
      const { emails, source } = await loadEmailsWithFallback();
      const summary = await summarizeImportantEmails(emails);

      return {
        status: 'success',
        message:
          source === 'gmail'
            ? 'Here are your important emails from Gmail inbox'
            : 'Here are your important emails',
        summary,
        source
      };
    }

    default:
      return {
        status: 'error',
        message: `Unsupported intent: ${intent || 'unknown'}`
      };
  }
}

module.exports = {
  executeAction
};
