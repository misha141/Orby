const OpenAI = require('openai');

const PROMPT = `You are Orby, a voice-controlled productivity assistant.

Convert the user command into structured JSON.

Supported intents:

* get_important_emails
* reply_email
* schedule_meeting

Return JSON only with fields:
intent, target, message, date, time`;

const model = process.env.OPENAI_MODEL || 'gpt-4.1-mini';

const client = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

function normalizeParsedCommand(data = {}) {
  return {
    intent: data.intent || 'unknown',
    target: data.target || '',
    message: data.message || '',
    date: data.date || '',
    time: data.time || ''
  };
}

function extractJson(text) {
  if (!text || typeof text !== 'string') {
    return null;
  }

  const trimmed = text.trim();

  try {
    return JSON.parse(trimmed);
  } catch (_error) {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) {
      return null;
    }

    try {
      return JSON.parse(match[0]);
    } catch (_error2) {
      return null;
    }
  }
}

function fallbackParse(text = '') {
  const input = text.toLowerCase();

  if (
    input.includes('important email') ||
    input.includes('important emails') ||
    input.includes('inbox') ||
    input.includes("what's in my inbox") ||
    input.includes('what is in my inbox')
  ) {
    return normalizeParsedCommand({ intent: 'get_important_emails' });
  }

  if (input.includes('reply')) {
    const targetMatch = text.match(/reply to\s+([\w\s]+)/i);
    const msgMatch = text.match(/saying\s+(.+)/i);

    return normalizeParsedCommand({
      intent: 'reply_email',
      target: targetMatch ? targetMatch[1].trim() : '',
      message: msgMatch ? msgMatch[1].trim() : ''
    });
  }

  if (input.includes('send email') || input.includes('send an email') || input.includes('email to')) {
    const targetMatch = text.match(/(?:send (?:an )?email|email)\s+to\s+([\w\s]+)/i);
    const msgMatch = text.match(/(?:saying|that says|with message)\s+(.+)/i);

    return normalizeParsedCommand({
      intent: 'reply_email',
      target: targetMatch ? targetMatch[1].trim() : '',
      message: msgMatch ? msgMatch[1].trim() : ''
    });
  }

  if (input.includes('schedule') || input.includes('meeting')) {
    return normalizeParsedCommand({ intent: 'schedule_meeting' });
  }

  return normalizeParsedCommand({ intent: 'unknown' });
}

async function parseCommand(text) {
  if (!client) {
    return fallbackParse(text);
  }

  try {
    const response = await client.responses.create({
      model,
      input: [
        { role: 'system', content: PROMPT },
        { role: 'user', content: text }
      ],
      temperature: 0
    });

    const rawText = response.output_text || '';
    const parsed = extractJson(rawText);

    if (!parsed) {
      return fallbackParse(text);
    }

    return normalizeParsedCommand(parsed);
  } catch (error) {
    console.warn('OpenAI parse failed, using fallback parser:', error.message);
    return fallbackParse(text);
  }
}

async function summarizeImportantEmails(emails = []) {
  if (!client) {
    return emails.map((email) => ({
      from: email.from,
      subject: email.subject,
      reason: email.snippet
    }));
  }

  const summaryPrompt = `You are Orby, a helpful productivity assistant.
Pick the most important emails and summarize each in one short bullet.
Return JSON only as an array of objects with keys: from, subject, reason.`;

  try {
    const response = await client.responses.create({
      model,
      input: [
        { role: 'system', content: summaryPrompt },
        {
          role: 'user',
          content: JSON.stringify(emails)
        }
      ],
      temperature: 0.2
    });

    const rawText = response.output_text || '';
    const parsed = extractJson(rawText);

    if (Array.isArray(parsed)) {
      return parsed;
    }
  } catch (error) {
    console.warn('OpenAI summarize failed, using fallback summary:', error.message);
  }

  return emails.map((email) => ({
    from: email.from,
    subject: email.subject,
    reason: email.snippet
  }));
}

module.exports = {
  parseCommand,
  summarizeImportantEmails
};
