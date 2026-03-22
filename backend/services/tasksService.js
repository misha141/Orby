const { getValidGoogleAccessToken, getGmailConnectionStatus } = require('./googleAuth');

const TASKS_API_BASE = 'https://tasks.googleapis.com/tasks/v1';
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function pad(value) {
  return String(value).padStart(2, '0');
}

function addDays(date, days) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function parseDueDate(input = '') {
  const normalized = String(input || '').toLowerCase().replace(/,/g, ' ').trim();

  if (!normalized) {
    return '';
  }

  const today = new Date();
  const base = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  if (normalized === 'today') {
    return new Date(base.getFullYear(), base.getMonth(), base.getDate(), 23, 59, 0).toISOString();
  }

  if (normalized === 'tomorrow') {
    const tomorrow = addDays(base, 1);
    return new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate(), 23, 59, 0).toISOString();
  }

  const isoMatch = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    return new Date(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3]), 23, 59, 0).toISOString();
  }

  const slashMatch = normalized.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (slashMatch) {
    const month = Number(slashMatch[1]) - 1;
    const day = Number(slashMatch[2]);
    const rawYear = slashMatch[3];
    const year = rawYear ? Number(rawYear.length === 2 ? `20${rawYear}` : rawYear) : base.getFullYear();
    return new Date(year, month, day, 23, 59, 0).toISOString();
  }

  const weekdayIndex = WEEKDAYS.findIndex((weekday) => normalized.includes(weekday));
  if (weekdayIndex >= 0) {
    const currentDay = base.getDay();
    let delta = weekdayIndex - currentDay;
    if (delta <= 0 || normalized.includes('next ')) {
      delta += 7;
    }
    const target = addDays(base, delta);
    return new Date(target.getFullYear(), target.getMonth(), target.getDate(), 23, 59, 0).toISOString();
  }

  return '';
}

async function tasksRequest(path, options = {}) {
  const token = await getValidGoogleAccessToken();

  if (!token) {
    throw new Error('No valid Google access token available');
  }

  const response = await fetch(`${TASKS_API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Google Tasks API error (${response.status}): ${body}`);
  }

  return response.json();
}

async function tasksRequestNoContent(path, options = {}) {
  const token = await getValidGoogleAccessToken();

  if (!token) {
    throw new Error('No valid Google access token available');
  }

  const response = await fetch(`${TASKS_API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Google Tasks API error (${response.status}): ${body}`);
  }
}

async function listTaskLists() {
  const data = await tasksRequest('/users/@me/lists');
  return Array.isArray(data.items) ? data.items : [];
}

async function resolveTaskListId(taskList = '') {
  const requested = String(taskList || '').trim();

  if (!requested) {
    return '@default';
  }

  if (requested === '@default') {
    return requested;
  }

  const taskLists = await listTaskLists();
  const lower = requested.toLowerCase();
  const match = taskLists.find((list) => String(list.title || '').toLowerCase() === lower)
    || taskLists.find((list) => String(list.title || '').toLowerCase().includes(lower));

  if (!match) {
    throw new Error(`Could not find a Google Task list named "${requested}"`);
  }

  return match.id;
}

async function getTasks({ taskList = '', maxResults = 10 } = {}) {
  console.log('[orby] getTasks triggered:', { taskList, maxResults });

  if (!getGmailConnectionStatus().connected) {
    throw new Error('Google account is not connected. Please connect Google before using Tasks.');
  }

  const taskListId = await resolveTaskListId(taskList || process.env.TASKS_DEFAULT_LIST || '@default');
  const data = await tasksRequest(
    `/lists/${encodeURIComponent(taskListId)}/tasks?showCompleted=false&showHidden=false&maxResults=${Number(maxResults) || 10}`
  );

  const tasks = Array.isArray(data.items)
    ? data.items.map((task) => ({
        id: task.id || '',
        title: task.title || '(Untitled task)',
        notes: task.notes || '',
        due: task.due || '',
        status: task.status || 'needsAction',
        link: task.selfLink || ''
      }))
    : [];

  return {
    status: 'success',
    message: tasks.length > 0 ? `Here are your top ${tasks.length} tasks.` : 'You have no tasks currently.',
    tasks,
    taskListId
  };
}

function normalizeTaskText(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function scoreTaskMatch(query, task) {
  const normalizedQuery = normalizeTaskText(query);
  const title = normalizeTaskText(task.title || '');
  const notes = normalizeTaskText(task.notes || '');

  if (!normalizedQuery) {
    return 0;
  }

  if (title === normalizedQuery) {
    return 100;
  }

  if (title.includes(normalizedQuery)) {
    return 80;
  }

  const parts = normalizedQuery.split(' ').filter(Boolean);
  const titleMatches = parts.filter((part) => title.includes(part)).length;
  const notesMatches = parts.filter((part) => notes.includes(part)).length;
  const totalMatches = titleMatches + notesMatches;

  if (titleMatches === parts.length && parts.length > 0) {
    return 60 + titleMatches;
  }

  if (totalMatches > 0) {
    return 20 + totalMatches;
  }

  return 0;
}

async function createTask({ title = '', notes = '', dueDate = '', taskList = '' } = {}) {
  console.log('[orby] createTask triggered:', { title, notes, dueDate, taskList });

  if (!title.trim()) {
    throw new Error('Task title is required.');
  }

  if (!getGmailConnectionStatus().connected) {
    throw new Error('Google account is not connected. Please connect Google before using Tasks.');
  }

  const taskListId = await resolveTaskListId(taskList || process.env.TASKS_DEFAULT_LIST || '@default');
  const due = parseDueDate(dueDate);
  const payload = {
    title: title.trim()
  };

  if (notes.trim()) {
    payload.notes = notes.trim();
  }

  if (due) {
    payload.due = due;
  }

  const task = await tasksRequest(`/lists/${encodeURIComponent(taskListId)}/tasks`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  return {
    status: 'success',
    message: `Added "${task.title || title}" to Google Tasks.`,
    task: {
      id: task.id || '',
      title: task.title || title,
      notes: task.notes || notes,
      due: task.due || due || '',
      status: task.status || 'needsAction',
      link: task.selfLink || ''
    },
    taskListId
  };
}

async function deleteTask({ title = '', taskList = '' } = {}) {
  console.log('[orby] deleteTask triggered:', { title, taskList });

  if (!title.trim()) {
    throw new Error('Task title is required to delete a task.');
  }

  if (!getGmailConnectionStatus().connected) {
    throw new Error('Google account is not connected. Please connect Google before using Tasks.');
  }

  const taskListId = await resolveTaskListId(taskList || process.env.TASKS_DEFAULT_LIST || '@default');
  const currentTasksResult = await getTasks({ taskList: taskListId, maxResults: 100 });
  const ranked = currentTasksResult.tasks
    .map((task) => ({
      task,
      score: scoreTaskMatch(title, task)
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  const match = ranked[0]?.task;

  if (!match?.id) {
    throw new Error(`Could not find a task matching "${title}".`);
  }

  await tasksRequestNoContent(`/lists/${encodeURIComponent(taskListId)}/tasks/${encodeURIComponent(match.id)}`, {
    method: 'DELETE'
  });

  const remainingTasksResult = await getTasks({ taskList: taskListId, maxResults: 10 });

  return {
    status: 'success',
    message: `Deleted task "${match.title}".`,
    deletedTask: match,
    tasks: remainingTasksResult.tasks,
    taskListId
  };
}

module.exports = {
  getTasks,
  createTask,
  deleteTask
};
