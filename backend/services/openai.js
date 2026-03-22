const { client, model } = require('./openaiClient');
const {
  toolDefinitions,
  normalizeToolCall
} = require('../tools/toolRegistry');

const PARSE_SYSTEM_PROMPT = `You are Orby, a voice-controlled productivity assistant.

Use the available tools whenever the user is clearly asking to perform an action.
If the request does not match a tool, do not call a tool.
For scheduling, do not call the scheduling tool unless you know whether the meeting is online or in person.`;

const CHAT_SYSTEM_PROMPT = `You are Orby, a friendly and natural voice assistant for productivity.

Rules:
- Keep spoken responses short and natural.
- For actionable requests, use one of the provided tools instead of describing JSON in text.
- Prioritize the user's MOST RECENT message over older context when choosing a tool.
- If the latest message clearly switches tasks, ignore older tool context and follow the latest message.
- If required information is missing, ask a brief follow-up question instead of guessing.
- For meetings, you must know: person, date, time, and whether it is online or in person.
- If meeting format is missing, ask a short follow-up like "Should I make that online or in person?" and do not call the scheduling tool yet.
- For conversational messages, respond normally without calling a tool.
- Never mention internal tool names unless the user asks.`;

function normalizeParsedCommand(data = {}) {
  return {
    tool: data.tool || '',
    arguments: data.arguments || {},
    intent: data.intent || 'unknown',
    target: data.target || '',
    message: data.message || '',
    date: data.date || '',
    time: data.time || '',
    meetingMode: data.meetingMode || ''
  };
}

function extractAssistantText(content) {
  if (!content) {
    return '';
  }

  if (typeof content === 'string') {
    return content.trim();
  }

  if (!Array.isArray(content)) {
    return '';
  }

  return content
    .map((part) => {
      if (typeof part === 'string') {
        return part;
      }

      if (part?.type === 'text') {
        return part.text || '';
      }

      return '';
    })
    .join('')
    .trim();
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
    return normalizeParsedCommand({
      tool: 'get_important_emails',
      intent: 'get_important_emails'
    });
  }

  if (input.includes('reply')) {
    const targetMatch = text.match(/reply to\s+([\w\s]+)/i);
    const msgMatch = text.match(/saying\s+(.+)/i);
    const recipient = targetMatch ? targetMatch[1].trim() : '';
    const message = msgMatch ? msgMatch[1].trim() : '';

    return normalizeParsedCommand({
      tool: 'reply_email',
      arguments: {
        recipient,
        message
      },
      intent: 'reply_email',
      target: recipient,
      message
    });
  }

  if (input.includes('send email') || input.includes('send an email') || input.includes('email to')) {
    const targetMatch = text.match(/(?:send (?:an )?email|email)\s+to\s+([\w\s]+)/i);
    const msgMatch = text.match(/(?:saying|that says|with message)\s+(.+)/i);
    const recipient = targetMatch ? targetMatch[1].trim() : '';
    const message = msgMatch ? msgMatch[1].trim() : '';

    return normalizeParsedCommand({
      tool: 'reply_email',
      arguments: {
        recipient,
        message
      },
      intent: 'reply_email',
      target: recipient,
      message
    });
  }

  if (input.includes('schedule') || input.includes('meeting')) {
    const targetMatch = text.match(/(?:schedule(?:\s+a)?\s+meeting\s+with|meeting\s+with)\s+(.+?)(?=\s+(?:today|tomorrow|next\s+\w+|on\s+\d|at\s+\d|at\s+noon|at\s+midnight|$))/i);
    const dateMatch =
      text.match(/\b(today|tomorrow|next\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\b/i);
    const timeMatch = text.match(/\b(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)|noon|midnight)\b/i);

    return normalizeParsedCommand({
      tool: 'schedule_meeting',
      arguments: {
        person: targetMatch ? targetMatch[1].trim() : '',
        date: dateMatch ? dateMatch[1].trim() : '',
        time: timeMatch ? timeMatch[1].trim() : '',
        meetingMode: input.includes('online') || input.includes('virtual') || input.includes('google meet')
          ? 'online'
          : input.includes('in person') || input.includes('in-person')
          ? 'in_person'
          : '',
        note: ''
      },
      intent: 'schedule_meeting',
      target: targetMatch ? targetMatch[1].trim() : '',
      date: dateMatch ? dateMatch[1].trim() : '',
      time: timeMatch ? timeMatch[1].trim() : '',
      meetingMode: input.includes('online') || input.includes('virtual') || input.includes('google meet')
        ? 'online'
        : input.includes('in person') || input.includes('in-person')
        ? 'in_person'
        : ''
    });
  }

  return normalizeParsedCommand({ intent: 'unknown' });
}

function fallbackChat(text) {
  const input = text.toLowerCase();
  const parsed = fallbackParse(text);

  if (parsed.intent !== 'unknown') {
    const messages = {
      get_important_emails: 'Sure, let me check your emails!',
      reply_email: `Alright, I'll send that reply${parsed.target ? ` to ${parsed.target}` : ''}.`,
      schedule_meeting: 'Got it, let me set that up.'
    };

    return {
      reply: messages[parsed.intent] || 'On it!',
      action: parsed
    };
  }

  if (input.match(/\b(hi|hello|hey|howdy|sup|what's up)\b/)) {
    return {
      reply: 'Hey! I can check your emails, send replies, or schedule meetings. What do you need?',
      action: null
    };
  }

  if (input.match(/how are you|how('s| is) it going/)) {
    return { reply: "I'm doing great, thanks for asking! What can I help you with?", action: null };
  }

  if (input.match(/what can you do|help me|what do you do/)) {
    return {
      reply: 'I can check your important emails, send replies, and schedule meetings. Just tell me what you need!',
      action: null
    };
  }

  if (input.match(/thank|thanks|thx/)) {
    return { reply: "You're welcome! Let me know if you need anything else.", action: null };
  }

  if (input.match(/bye|goodbye|see you|later/)) {
    return { reply: 'See you later! Tap me anytime you need help.', action: null };
  }

  return {
    reply: "I'm not sure I understood that. I can check your emails, send replies, or schedule meetings.",
    action: null
  };
}

function buildActionReply(action) {
  switch (action.intent) {
    case 'get_important_emails':
      return 'Sure, I\'ll check your important emails.';
    case 'reply_email':
      return action.target
        ? `Okay, I\'ll send that reply to ${action.target}.`
        : 'Okay, I\'ll send that reply.';
    case 'schedule_meeting':
      return action.target
        ? `Okay, I\'ll schedule that ${action.meetingMode === 'online' ? 'online' : 'in person'} with ${action.target}.`
        : `Okay, I\'ll schedule that ${action.meetingMode === 'online' ? 'online' : 'in person'}.`;
    default:
      return 'On it.';
  }
}

function inferExpectedTool(text = '') {
  const input = String(text || '').toLowerCase();

  if (!input.trim()) {
    return '';
  }

  if (
    input === 'online' ||
    input === 'virtual' ||
    input === 'google meet' ||
    input === 'in person' ||
    input === 'in-person'
  ) {
    return 'schedule_meeting';
  }

  if (input.includes('schedule') || input.includes('meeting') || input.includes('calendar invite')) {
    return 'schedule_meeting';
  }

  if (
    input.includes('reply') ||
    input.includes('send email') ||
    input.includes('send an email') ||
    input.includes('email to')
  ) {
    return 'reply_email';
  }

  if (
    input.includes('important email') ||
    input.includes('inbox') ||
    input.includes('check my email') ||
    input.includes('check my mail')
  ) {
    return 'get_important_emails';
  }

  return '';
}

async function replanFromLatestMessage(latestContent, expectedTool) {
  const replanned = await parseCommand(latestContent);

  if (!replanned || replanned.intent === 'unknown') {
    return null;
  }

  if (expectedTool && replanned.tool && replanned.tool !== expectedTool) {
    return null;
  }

  return replanned;
}

function requiresMeetingMode(action) {
  return action?.tool === 'schedule_meeting' && !String(action?.meetingMode || '').trim();
}

async function planWithTools(messages, temperature = 0) {
  const response = await client.chat.completions.create({
    model,
    messages,
    tools: toolDefinitions,
    tool_choice: 'auto',
    temperature
  });

  const assistantMessage = response.choices?.[0]?.message || {};
  const toolCall = assistantMessage.tool_calls?.[0] || null;
  const normalizedAction = toolCall ? normalizeParsedCommand(normalizeToolCall(toolCall)) : null;
  const reply = extractAssistantText(assistantMessage.content);

  console.log('[orby] OpenAI assistant reply:', reply || '(empty)');
  console.log('[orby] OpenAI selected tool call:', normalizedAction);

  return {
    reply,
    action: normalizedAction
  };
}

async function parseCommand(text) {
  if (!client) {
    return fallbackParse(text);
  }

  try {
    const result = await planWithTools(
      [
        { role: 'system', content: PARSE_SYSTEM_PROMPT },
        { role: 'user', content: text }
      ],
      0
    );

    return result.action || fallbackParse(text);
  } catch (error) {
    console.warn('OpenAI parse failed, using fallback parser:', error.message);
    return fallbackParse(text);
  }
}

async function chat(history) {
  if (!client) {
    const lastMsg = history[history.length - 1];
    return fallbackChat(lastMsg ? lastMsg.content : '');
  }

  try {
    const latestMessage = history[history.length - 1];
    const latestContent = latestMessage?.content || '';
    const expectedTool = inferExpectedTool(latestContent);
    const result = await planWithTools(
      [
        { role: 'system', content: CHAT_SYSTEM_PROMPT },
        ...history
      ],
      0.4
    );

    let finalAction = result.action;
    let finalReply = result.reply;

    if (expectedTool && (!finalAction || finalAction.tool !== expectedTool)) {
      console.log('[orby] planner mismatch detected, replanning from latest message only:', {
        expectedTool,
        selectedTool: finalAction?.tool || ''
      });

      const replannedAction = await replanFromLatestMessage(latestContent, expectedTool);
      if (replannedAction) {
        console.log('[orby] replan succeeded:', replannedAction);
        finalAction = replannedAction;
        finalReply = '';
      }
    }

    if (finalAction) {
      if (requiresMeetingMode(finalAction)) {
        return {
          reply: 'Should I make that meeting online or in person?',
          action: null
        };
      }

      return {
        reply: finalReply || buildActionReply(finalAction),
        action: finalAction
      };
    }

    return {
      reply: result.reply || "I'm not sure what you mean. Could you try again?",
      action: null
    };
  } catch (error) {
    console.warn('OpenAI chat failed, using fallback:', error.message);
    const lastMsg = history[history.length - 1];
    return fallbackChat(lastMsg ? lastMsg.content : '');
  }
}

module.exports = {
  parseCommand,
  chat
};
