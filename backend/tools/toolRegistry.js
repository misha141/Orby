const { getImportantEmails, prepareReplyEmail, replyEmail } = require('../services/emailService');
const { prepareScheduleMeeting, scheduleMeeting } = require('../services/calendarService');
const { getTasks, createTask, deleteTask } = require('../services/tasksService');

const toolDefinitions = [
  {
    type: 'function',
    function: {
      name: 'get_tasks',
      description: 'Fetch the user\'s current Google Tasks or assignments from a task list.',
      parameters: {
        type: 'object',
        properties: {
          taskList: {
            type: 'string',
            description: 'Optional Google Task list name. Leave empty to use the default list.'
          }
        },
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_task',
      description: 'Create a new Google Task for an assignment, to-do, or reminder.',
      parameters: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description: 'Short task title.'
          },
          notes: {
            type: 'string',
            description: 'Optional task details or assignment description.'
          },
          dueDate: {
            type: 'string',
            description: 'Optional due date in natural language, like tomorrow, Friday, or 2026-03-25.'
          },
          taskList: {
            type: 'string',
            description: 'Optional Google Task list name. Leave empty to use the default list.'
          }
        },
        required: ['title'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'delete_task',
      description: 'Delete an existing Google Task or assignment by matching its title.',
      parameters: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description: 'Title or partial title of the task to delete.'
          },
          taskList: {
            type: 'string',
            description: 'Optional Google Task list name. Leave empty to use the default list.'
          }
        },
        required: ['title'],
        additionalProperties: false
      }
    }
  },
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
  get_tasks: getTasks,
  create_task: createTask,
  delete_task: deleteTask,
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
    case 'create_task':
      return {
        title: safeString(rawArgs.title),
        notes: safeString(rawArgs.notes),
        dueDate: safeString(rawArgs.dueDate),
        taskList: safeString(rawArgs.taskList)
      };
    case 'delete_task':
      return {
        title: safeString(rawArgs.title),
        taskList: safeString(rawArgs.taskList)
      };
    case 'get_tasks':
      return {
        taskList: safeString(rawArgs.taskList)
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
    case 'create_task':
      return {
        intent: 'create_task',
        target: args.title || '',
        message: args.notes || '',
        date: args.dueDate || '',
        time: ''
      };
    case 'get_tasks':
      return {
        intent: 'get_tasks',
        target: args.taskList || '',
        message: '',
        date: '',
        time: ''
      };
    case 'delete_task':
      return {
        intent: 'delete_task',
        target: args.title || '',
        message: '',
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
  if (toolName !== 'reply_email' && toolName !== 'schedule_meeting') {
    return executeTool(toolName, args);
  }

  const sanitizedArgs = sanitizeToolArguments(toolName, args);

  console.log('[orby] previewTool requested:', {
    toolName,
    args: sanitizedArgs
  });

  const result =
    toolName === 'reply_email'
      ? await prepareReplyEmail(sanitizedArgs)
      : await prepareScheduleMeeting(sanitizedArgs);

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
      : toolName === 'create_task'
      ? {
          title: command.arguments?.title || command.target || '',
          notes: command.arguments?.notes || command.message || '',
          dueDate: command.arguments?.dueDate || command.date || '',
          taskList: command.arguments?.taskList || ''
        }
      : toolName === 'get_tasks'
      ? {
          taskList: command.arguments?.taskList || command.target || ''
        }
      : toolName === 'delete_task'
      ? {
          title: command.arguments?.title || command.target || '',
          taskList: command.arguments?.taskList || ''
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
