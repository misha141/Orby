const { getImportantEmails, prepareReplyEmail, replyEmail } = require('../services/emailService');
const { scheduleMeeting } = require('../services/calendarService');

const toolDefinitions = [
  {
    type: 'function',
    function: {
      name: 'get_important_emails',
      description: 'Fetch and prioritize the user\'s important inbox emails.',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'reply_email',
      description: 'Draft and send an email reply to a recipient.',
      parameters: {
        type: 'object',
        properties: {
          recipient: {
            type: 'string',
            description: 'The person receiving the email reply.'
          },
          message: {
            type: 'string',
            description: 'The email reply message body.'
          }
        },
        required: ['recipient', 'message'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'schedule_meeting',
      description: 'Schedule a meeting or calendar event for the user.',
      parameters: {
        type: 'object',
        properties: {
          person: {
            type: 'string',
            description: 'The person or group to meet with.'
          },
          date: {
            type: 'string',
            description: 'The requested meeting date in natural language.'
          },
          time: {
            type: 'string',
            description: 'The requested meeting time in natural language.'
          },
          meetingMode: {
            type: 'string',
            enum: ['online', 'in_person'],
            description: 'Whether the meeting should be online with a Google Meet link or in person without one.'
          },
          note: {
            type: 'string',
            description: 'Optional meeting context or agenda.'
          }
        },
        required: ['person', 'date', 'time', 'meetingMode'],
        additionalProperties: false
      }
    }
  }
];

const toolHandlers = {
  get_important_emails: getImportantEmails,
  reply_email: replyEmail,
  schedule_meeting: scheduleMeeting
};

function safeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function sanitizeToolArguments(toolName, rawArgs = {}) {
  switch (toolName) {
    case 'reply_email':
      return {
        recipient: safeString(rawArgs.recipient),
        recipientEmail: safeString(rawArgs.recipientEmail),
        displayName: safeString(rawArgs.displayName),
        subject: safeString(rawArgs.subject),
        threadId: safeString(rawArgs.threadId),
        message: safeString(rawArgs.message)
      };
    case 'schedule_meeting':
      return {
        person: safeString(rawArgs.person),
        date: safeString(rawArgs.date),
        time: safeString(rawArgs.time),
        meetingMode: safeString(rawArgs.meetingMode),
        note: safeString(rawArgs.note)
      };
    case 'get_important_emails':
    default:
      return {};
  }
}

function actionFromTool(toolName, args = {}) {
  switch (toolName) {
    case 'reply_email':
      return {
        intent: 'reply_email',
        target: args.recipient || '',
        message: args.message || '',
        date: '',
        time: ''
      };
    case 'schedule_meeting':
      return {
        intent: 'schedule_meeting',
        target: args.person || '',
        message: args.note || '',
        date: args.date || '',
        time: args.time || '',
        meetingMode: args.meetingMode || ''
      };
    case 'get_important_emails':
      return {
        intent: 'get_important_emails',
        target: '',
        message: '',
        date: '',
        time: ''
      };
    default:
      return {
        intent: 'unknown',
        target: '',
        message: '',
        date: '',
        time: ''
      };
  }
}

function parseToolArguments(rawArguments) {
  if (!rawArguments) {
    return {};
  }

  if (typeof rawArguments === 'object') {
    return rawArguments;
  }

  try {
    return JSON.parse(rawArguments);
  } catch (_error) {
    return {};
  }
}

function normalizeToolCall(toolCall) {
  const toolName = toolCall?.function?.name || '';
  const args = sanitizeToolArguments(toolName, parseToolArguments(toolCall?.function?.arguments));

  return {
    tool: toolName,
    arguments: args,
    ...actionFromTool(toolName, args)
  };
}

async function executeTool(toolName, args = {}) {
  const handler = toolHandlers[toolName];
  const sanitizedArgs = sanitizeToolArguments(toolName, args);

  console.log('[orby] executeTool requested:', {
    toolName,
    args: sanitizedArgs
  });

  if (!handler) {
    return {
      status: 'error',
      message: `Unsupported tool: ${toolName || 'unknown'}`
    };
  }

  const result = await handler(sanitizedArgs);

  console.log('[orby] executeTool completed:', {
    toolName,
    result
  });

  return result;
}

async function previewTool(toolName, args = {}) {
  if (toolName !== 'reply_email') {
    return executeTool(toolName, args);
  }

  const sanitizedArgs = sanitizeToolArguments(toolName, args);

  console.log('[orby] previewTool requested:', {
    toolName,
    args: sanitizedArgs
  });

  const result = await prepareReplyEmail(sanitizedArgs);

  console.log('[orby] previewTool completed:', {
    toolName,
    result
  });

  return result;
}

function executeLegacyAction(command = {}) {
  const toolName = command.tool || command.intent || '';
  const args =
    toolName === 'reply_email'
      ? {
          recipient: command.arguments?.recipient || command.target || '',
          message: command.arguments?.message || command.message || ''
        }
      : toolName === 'schedule_meeting'
      ? {
          person: command.arguments?.person || command.target || '',
          date: command.arguments?.date || command.date || '',
          time: command.arguments?.time || command.time || '',
          meetingMode: command.arguments?.meetingMode || command.meetingMode || '',
          note: command.arguments?.note || command.message || ''
        }
      : {};

  return executeTool(toolName, args);
}

module.exports = {
  toolDefinitions,
  normalizeToolCall,
  executeTool,
  previewTool,
  executeLegacyAction
};
