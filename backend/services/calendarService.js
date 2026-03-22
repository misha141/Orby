const { listInboxEmails } = require('./gmail');
const { getGmailConnectionStatus, getValidGoogleAccessToken } = require('./googleAuth');
const crypto = require('crypto');

const CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3/calendars/primary';
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function getCalendarTimeZone() {
  return process.env.CALENDAR_TIMEZONE || process.env.TZ || 'America/Phoenix';
}

function pad(value) {
  return String(value).padStart(2, '0');
}

function formatLocalDate(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function formatLocalDateTime(date) {
  return `${formatLocalDate(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}:00`;
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function normalizePersonName(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function scoreAttendeeMatch(query, email) {
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

async function resolveAttendee(person) {
  if (!person.trim() || !getGmailConnectionStatus().connected) {
    return null;
  }

  const inboxEmails = await listInboxEmails();
  const rankedMatches = inboxEmails
    .map((email) => ({
      email,
      score: scoreAttendeeMatch(person, email)
    }))
    .filter((entry) => entry.score > 0 && entry.email.senderEmail)
    .sort((a, b) => b.score - a.score);

  const bestMatch = rankedMatches[0];

  if (!bestMatch) {
    return null;
  }

  return {
    displayName: bestMatch.email.senderName || person,
    email: bestMatch.email.senderEmail
  };
}

function parseTimeString(timeText = '') {
  const normalized = String(timeText || '')
    .toLowerCase()
    .replace(/\./g, '')
    .trim();

  if (!normalized) {
    return null;
  }

  const namedTimes = {
    noon: { hours: 12, minutes: 0 },
    midnight: { hours: 0, minutes: 0 }
  };

  if (namedTimes[normalized]) {
    return namedTimes[normalized];
  }

  const match = normalized.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);

  if (!match) {
    return null;
  }

  let hours = Number(match[1]);
  const minutes = Number(match[2] || '0');
  const meridiem = match[3] || '';

  if (Number.isNaN(hours) || Number.isNaN(minutes) || minutes > 59) {
    return null;
  }

  if (meridiem) {
    if (hours === 12) {
      hours = meridiem === 'am' ? 0 : 12;
    } else if (meridiem === 'pm') {
      hours += 12;
    }
  }

  if (hours > 23) {
    return null;
  }

  return { hours, minutes };
}

function parseDateString(dateText = '') {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const normalized = String(dateText || '')
    .toLowerCase()
    .replace(/,/g, ' ')
    .trim();

  if (!normalized) {
    return null;
  }

  if (normalized === 'today') {
    return today;
  }

  if (normalized === 'tomorrow') {
    return addMinutes(today, 24 * 60);
  }

  const isoMatch = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    return new Date(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3]));
  }

  const slashMatch = normalized.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (slashMatch) {
    const month = Number(slashMatch[1]) - 1;
    const day = Number(slashMatch[2]);
    const rawYear = slashMatch[3];
    const year = rawYear ? Number(rawYear.length === 2 ? `20${rawYear}` : rawYear) : today.getFullYear();
    return new Date(year, month, day);
  }

  const weekdayIndex = WEEKDAYS.findIndex((weekday) => normalized.includes(weekday));
  if (weekdayIndex >= 0) {
    const currentDay = today.getDay();
    let delta = weekdayIndex - currentDay;
    if (delta <= 0 || normalized.includes('next ')) {
      delta += 7;
    }
    return addMinutes(today, delta * 24 * 60);
  }

  return null;
}

function parseMeetingSchedule({ date, time }) {
  const parsedDate = parseDateString(date);
  const parsedTime = parseTimeString(time);

  if (!parsedDate) {
    throw new Error(`Could not understand meeting date: "${date}"`);
  }

  if (!parsedTime) {
    throw new Error(`Could not understand meeting time: "${time}"`);
  }

  const start = new Date(
    parsedDate.getFullYear(),
    parsedDate.getMonth(),
    parsedDate.getDate(),
    parsedTime.hours,
    parsedTime.minutes,
    0,
    0
  );
  const end = addMinutes(start, 60);

  return {
    startDateTime: formatLocalDateTime(start),
    endDateTime: formatLocalDateTime(end),
    timeZone: getCalendarTimeZone()
  };
}

async function insertCalendarEvent(payload) {
  const token = await getValidGoogleAccessToken();

  if (!token) {
    throw new Error('No valid Google access token available');
  }

  const response = await fetch(`${CALENDAR_API_BASE}/events?conferenceDataVersion=1&sendUpdates=all`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Calendar API error (${response.status}): ${body}`);
  }

  return response.json();
}

async function scheduleMeeting({ person = '', date = '', time = '', meetingMode = '', note = '' } = {}) {
  console.log('[orby] scheduleMeeting triggered:', {
    person,
    date,
    time,
    meetingMode,
    note
  });

  if (!person.trim()) {
    throw new Error('Person is required to schedule a meeting');
  }

  if (!date.trim()) {
    throw new Error('Date is required to schedule a meeting');
  }

  if (!time.trim()) {
    throw new Error('Time is required to schedule a meeting');
  }

  if (!meetingMode.trim()) {
    throw new Error('Meeting mode is required to schedule a meeting');
  }

  if (!getGmailConnectionStatus().connected) {
    throw new Error('Google account is not connected. Please connect Gmail before scheduling.');
  }

  const schedule = parseMeetingSchedule({ date, time });
  const attendee = await resolveAttendee(person);

  console.log('[orby] scheduleMeeting parsed schedule:', schedule);
  console.log('[orby] scheduleMeeting resolved attendee:', attendee);

  const eventPayload = {
    summary: `Meeting with ${person}`,
    description: note || `Scheduled by Orby for ${person}.`,
    start: {
      dateTime: schedule.startDateTime,
      timeZone: schedule.timeZone
    },
    end: {
      dateTime: schedule.endDateTime,
      timeZone: schedule.timeZone
    },
    location: meetingMode === 'in_person' ? 'In person' : ''
  };

  if (attendee?.email) {
    eventPayload.attendees = [
      {
        email: attendee.email,
        displayName: attendee.displayName || person
      }
    ];
  }

  if (meetingMode === 'online') {
    eventPayload.conferenceData = {
      createRequest: {
        requestId: crypto.randomUUID(),
        conferenceSolutionKey: {
          type: 'hangoutsMeet'
        }
      }
    };
  }

  const event = await insertCalendarEvent(eventPayload);

  console.log('[orby] scheduleMeeting Calendar API success:', {
    id: event.id,
    htmlLink: event.htmlLink,
    status: event.status
  });

  return {
    status: 'success',
    message: `Meeting scheduled ${meetingMode === 'online' ? 'online' : 'in person'} with ${person}`,
    details: {
      target: person,
      date,
      time,
      meetingMode,
      note,
      simulated: false,
      provider: 'google-calendar',
      attendeeEmail: attendee?.email || '',
      timeZone: schedule.timeZone,
      startDateTime: schedule.startDateTime,
      endDateTime: schedule.endDateTime,
      calendarEventId: event.id || '',
      calendarEventLink: event.htmlLink || '',
      googleMeetLink: event.hangoutLink || event.conferenceData?.entryPoints?.find((entry) => entry.entryPointType === 'video')?.uri || ''
    }
  };
}

module.exports = {
  scheduleMeeting
};
