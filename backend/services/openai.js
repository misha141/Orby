const OpenAI = require('openai');

const PARSE_PROMPT = `You are Orby, a voice-controlled productivity assistant.

Convert the user command into structured JSON.

Supported intents:

* get_important_emails
* reply_email
* schedule_meeting

Return JSON only with fields:
intent, target, message, date, time`;

const CHAT_SYSTEM_PROMPT = `You are Orby, a friendly and natural voice assistant for productivity. You help people manage their emails, schedule meetings, and stay organized.

Your personality:
- Warm, concise, and helpful — like a smart friend who keeps things brief
- You speak naturally, never robotic
- You keep responses SHORT (1-3 sentences max) since they'll be spoken aloud
- You never say you're an AI or a language model

When the user says something conversational (greetings, small talk, questions about you), respond naturally and briefly. Always steer gently toward how you can help.

When the user asks you to DO something (check emails, send a reply, schedule a meeting), respond with a JSON block wrapped in <action> tags so the system can execute it:
<action>{"intent": "get_important_emails"}</action>

Supported actions:
- get_important_emails — when user wants to check/read/prioritize/see their emails or inbox
- reply_email — needs target (who) and message (what to say): <action>{"intent": "reply_email", "target": "Sarah", "message": "Got it, thanks!"}</action>
- schedule_meeting — needs target, date, time: <action>{"intent": "schedule_meeting", "target": "team", "date": "tomorrow", "time": "3pm"}</action>

Rules:
- If the user's intent is clear, include the <action> tag AND a brief natural response before it
- If you need more info, just ask naturally (don't output an action tag)
- NEVER output raw JSON without the <action> wrapper
- Keep spoken text SHORT — these are voice replies`;

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
    input.includes('what is in my inbox') ||
    input.includes('prioritize') ||
    input.includes('priority') ||
    input.includes('urgent') ||
    input.includes('summarize my email') ||
    input.includes('check my email') ||
    input.includes('check my mail')
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
        { role: 'system', content: PARSE_PROMPT },
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

function extractAction(text) {
  const match = text.match(/<action>([\s\S]*?)<\/action>/);
  if (!match) {
    return null;
  }
  try {
    return JSON.parse(match[1].trim());
  } catch (_e) {
    return null;
  }
}

function stripActionTags(text) {
  return text.replace(/<action>[\s\S]*?<\/action>/g, '').trim();
}

function fallbackChat(text) {
  const input = text.toLowerCase();

  // Check if it's an actionable command
  const parsed = fallbackParse(text);
  if (parsed.intent !== 'unknown') {
    const messages = {
      get_important_emails: "Sure, let me check your emails!",
      reply_email: `Alright, I'll send that reply${parsed.target ? ' to ' + parsed.target : ''}.`,
      schedule_meeting: "Got it, let me set that up."
    };

    return {
      reply: messages[parsed.intent] || "On it!",
      action: parsed
    };
  }

  // Conversational fallback when no OpenAI key
  if (input.match(/\b(hi|hello|hey|howdy|sup|what's up)\b/)) {
    return { reply: "Hey! I'm Orby, your voice assistant. I can check your emails, send replies, or schedule meetings. What do you need?", action: null };
  }

  if (input.match(/how are you|how('s| is) it going/)) {
    return { reply: "I'm doing great, thanks for asking! What can I help you with?", action: null };
  }

  if (input.match(/what can you do|help me|what do you do/)) {
    return { reply: "I can check your important emails, send replies, and schedule meetings. Just tell me what you need!", action: null };
  }

  if (input.match(/thank|thanks|thx/)) {
    return { reply: "You're welcome! Let me know if you need anything else.", action: null };
  }

  if (input.match(/bye|goodbye|see you|later/)) {
    return { reply: "See you later! Tap me anytime you need help.", action: null };
  }

  return { reply: "I'm not sure I understood that. I can check your emails, send replies, or schedule meetings — just ask!", action: null };
}

async function chat(history) {
  if (!client) {
    const lastMsg = history[history.length - 1];
    return fallbackChat(lastMsg ? lastMsg.content : '');
  }

  try {
    const messages = [
      { role: 'system', content: CHAT_SYSTEM_PROMPT },
      ...history
    ];

    const response = await client.responses.create({
      model,
      input: messages,
      temperature: 0.7
    });

    const rawText = response.output_text || '';
    const action = extractAction(rawText);
    const reply = stripActionTags(rawText) || (action ? "On it!" : "I'm not sure what you mean. Could you try again?");

    return {
      reply,
      action: action ? normalizeParsedCommand(action) : null
    };
  } catch (error) {
    console.warn('OpenAI chat failed, using fallback:', error.message);
    const lastMsg = history[history.length - 1];
    return fallbackChat(lastMsg ? lastMsg.content : '');
  }
}

async function summarizeImportantEmails(emails = []) {
  if (!client) {
    return emails.map((email, i) => ({
      from: email.from,
      subject: email.subject,
      reason: email.snippet,
      priority: i < 3 ? 'high' : 'low'
    }));
  }

  const summaryPrompt = `You are Orby, a helpful productivity assistant.
Analyze the following emails and prioritize them by importance.
Rank every email as "high", "medium", or "low" priority.
High = urgent action needed, time-sensitive, or from important contacts.
Medium = useful but not urgent.
Low = newsletters, social notifications, or purely informational.
Sort the results so the highest priority emails come first.
For each email, include a short one-sentence reason explaining why it matters.
Return JSON only as an array of objects with keys: from, subject, reason, priority.`;

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
  summarizeImportantEmails,
  chat
};
