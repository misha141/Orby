const { client, model } = require('./openaiClient');
const {
  toolDefinitions,
  normalizeToolCall
} = require('../tools/toolRegistry');

const PARSE_SYSTEM_PROMPT = `You are Orby, a voice-controlled productivity assistant.

Use the available tools whenever the user is clearly asking to perform an action.
If the request does not match a tool, do not call a tool.
For scheduling, do not call the scheduling tool unless you know whether the meeting is online or in person.
For tasks, use create_task for new to-dos or assignments, get_tasks for showing the current task list, and delete_task for removing an existing task.`;

const CHAT_SYSTEM_PROMPT = `You are Orby, a friendly and natural voice assistant for productivity.

Rules:
- Keep spoken responses short and natural.
- For actionable requests, use one of the provided tools instead of describing JSON in text.
- Prioritize the user's MOST RECENT message over older context when choosing a tool.
- If the latest message clearly switches tasks, ignore older tool context and follow the latest message.
- If required information is missing, ask a brief follow-up question instead of guessing.
- For meetings, you must know: person, date, time, and whether it is online or in person.
- If meeting format is missing, ask a short follow-up like "Should I make that online or in person?" and do not call the scheduling tool yet.
- For task creation, you must know the task title. Due date and notes are optional.
- For task deletion, you must know which task title to remove.
- Use Google Tasks for assignment tracking and to-do list requests.
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
    meetingMode: data.meetingMode || '',
    taskList: data.taskList || '',
    dueDate: data.dueDate || ''
  };
}

function convertToolDefinitionsForClaude(tools = []) {
  return tools
    .map((tool) => {
      if (!tool?.function?.name) {
        return null;
      }

      return {
        name: tool.function.name,
        description: tool.function.description || '',
        input_schema: tool.function.parameters || {
          type: 'object',
          properties: {},
          additionalProperties: false
        }
      };
    })
    .filter(Boolean);
}

function convertHistoryForClaude(history = []) {
  return history
    .filter((message) => message?.role === 'user' || message?.role === 'assistant')
    .map((message) => ({
      role: message.role,
      content: String(message.content || '')
    }));
}

function extractAssistantText(content) {
  if (!Array.isArray(content)) {
    return '';
  }

  return content
    .filter((block) => block?.type === 'text')
    .map((block) => block.text || '')
    .join('\n')
    .trim();
}

function extractToolCall(content) {
  if (!Array.isArray(content)) {
    return null;
  }

  const toolUse = content.find((block) => block?.type === 'tool_use');
  if (!toolUse) {
    return null;
  }

  return {
    function: {
      name: toolUse.name || '',
      arguments: JSON.stringify(toolUse.input || {})
    }
  };
}

function fallbackParse(text = '') {
  const input = text.toLowerCase();

  if (
    input.includes('to-do list') ||
    input.includes('todo list') ||
    input.includes('my tasks') ||
    input.includes('my assignments') ||
    input.includes('show tasks') ||
    input.includes('show my tasks') ||
    input.includes('what are my tasks') ||
    input.includes('what is on my to-do')
  ) {
    return normalizeParsedCommand({
      tool: 'get_tasks',
      arguments: {},
      intent: 'get_tasks'
    });
  }

  if (
    input.includes('delete task') ||
    input.includes('remove task') ||
    input.includes('delete assignment') ||
    input.includes('remove assignment') ||
    input.includes('delete my task') ||
    input.includes('remove my task')
  ) {
    const titleMatch =
      text.match(/(?:delete task|remove task|delete assignment|remove assignment|delete my task|remove my task)\s+(.+)/i);

    return normalizeParsedCommand({
      tool: 'delete_task',
      arguments: {
        title: titleMatch ? titleMatch[1].trim() : '',
        taskList: ''
      },
      intent: 'delete_task',
      target: titleMatch ? titleMatch[1].trim() : ''
    });
  }

  if (
    input.includes('add task') ||
    input.includes('create task') ||
    input.includes('add assignment') ||
    input.includes('create assignment') ||
    input.includes('add to my to-do') ||
    input.includes('add to my todo') ||
    input.includes('remind me to')
  ) {
    const titleMatch =
      text.match(/(?:add task|create task|add assignment|create assignment|add to my to-?do(?: list)?|remind me to)\s+(.+?)(?=\s+(?:due\s+|by\s+|on\s+\d|today|tomorrow|next\s+\w+|$))/i);
    const dueDateMatch =
      text.match(/(?:due|by)\s+(today|tomorrow|next\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)/i);

    return normalizeParsedCommand({
      tool: 'create_task',
      arguments: {
        title: titleMatch ? titleMatch[1].trim() : '',
        notes: '',
        dueDate: dueDateMatch ? dueDateMatch[1].trim() : '',
        taskList: ''
      },
      intent: 'create_task',
      target: titleMatch ? titleMatch[1].trim() : '',
      date: dueDateMatch ? dueDateMatch[1].trim() : '',
      dueDate: dueDateMatch ? dueDateMatch[1].trim() : ''
    });
  }

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

  if (input.includes('reply to')) {
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
      get_tasks: 'Sure, here are your tasks.',
      create_task: parsed.target ? `Okay, I'll add "${parsed.target}" to your tasks.` : 'Okay, I\'ll add that to your tasks.',
      delete_task: parsed.target ? `Okay, I'll delete "${parsed.target}" from your tasks.` : 'Okay, I\'ll delete that task.',
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
      reply: 'Hey! I can check your emails, send replies, schedule meetings, and manage tasks. What do you need?',
      action: null
    };
  }

  if (input.match(/how are you|how('s| is) it going/)) {
    return { reply: "I'm doing great, thanks for asking! What can I help you with?", action: null };
  }

  if (input.match(/what can you do|help me|what do you do/)) {
    return {
      reply: 'I can check your emails, send replies, manage tasks, and schedule meetings. Just tell me what you need!',
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
    reply: "I'm not sure I understood that. I can check your emails, send replies, manage tasks, or schedule meetings.",
    action: null
  };
}

function buildActionReply(action) {
  switch (action.intent) {
    case 'get_important_emails':
      return 'Sure, I\'ll check your important emails.';
    case 'reply_email':
      return action.target
        ? `Okay, I'll prepare that reply to ${action.target}.`
        : 'Okay, I\'ll prepare that reply.';
    case 'get_tasks':
      return 'Sure, I\'ll pull up your tasks.';
    case 'create_task':
      return action.target
        ? `Okay, I'll add "${action.target}" to your tasks.`
        : 'Okay, I\'ll add that to your tasks.';
    case 'delete_task':
      return action.target
        ? `Okay, I'll delete "${action.target}" from your tasks.`
        : 'Okay, I\'ll delete that task.';
    case 'schedule_meeting':
      return action.target
        ? `Okay, I'll schedule that ${action.meetingMode === 'online' ? 'online' : 'in person'} with ${action.target}.`
        : `Okay, I'll schedule that ${action.meetingMode === 'online' ? 'online' : 'in person'}.`;
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
    input.includes('to-do list') ||
    input.includes('todo list') ||
    input.includes('task') ||
    input.includes('assignment')
  ) {
    if (input.includes('delete ') || input.includes('remove ')) {
      return 'delete_task';
    }

    return input.includes('add ') || input.includes('create ') || input.includes('remind me')
      ? 'create_task'
      : 'get_tasks';
  }

  if (
    input.includes('reply to') ||
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

async function planWithTools(messages, systemPrompt, temperature = 0) {
  const response = await client.messages.create({
    model,
    max_tokens: 1200,
    system: systemPrompt,
    messages: convertHistoryForClaude(messages),
    tools: convertToolDefinitionsForClaude(toolDefinitions),
    temperature
  });

  const toolCall = extractToolCall(response.content);
  const normalizedAction = toolCall ? normalizeParsedCommand(normalizeToolCall(toolCall)) : null;
  const reply = extractAssistantText(response.content);

  console.log('[orby] Claude assistant reply:', reply || '(empty)');
  console.log('[orby] Claude selected tool call:', normalizedAction);

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
      [{ role: 'user', content: text }],
      PARSE_SYSTEM_PROMPT,
      0
    );

    return result.action || fallbackParse(text);
  } catch (error) {
    console.warn('Claude parse failed, using fallback parser:', error.message);
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
    const result = await planWithTools(history, CHAT_SYSTEM_PROMPT, 0.4);

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
    console.warn('Claude chat failed, using fallback:', error.message);
    const lastMsg = history[history.length - 1];
    return fallbackChat(lastMsg ? lastMsg.content : '');
  }
}

module.exports = {
  parseCommand,
  chat
};
