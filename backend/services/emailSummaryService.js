const { client, model } = require('./openaiClient');

function extractJson(text) {
  if (!text || typeof text !== 'string') {
    return null;
  }

  const trimmed = text.trim();

  try {
    return JSON.parse(trimmed);
  } catch (_error) {
    const match = trimmed.match(/\[[\s\S]*\]|\{[\s\S]*\}/);
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

async function summarizeImportantEmails(emails = []) {
  if (!client) {
    return emails.map((email, index) => ({
      from: email.from,
      subject: email.subject,
      reason: email.snippet,
      priority: index < 3 ? 'high' : 'low'
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
    const response = await client.messages.create({
      model,
      max_tokens: 1200,
      system: summaryPrompt,
      messages: [
        {
          role: 'user',
          content: JSON.stringify(emails)
        }
      ],
      temperature: 0.2
    });

    const rawText = Array.isArray(response.content)
      ? response.content
          .filter((block) => block.type === 'text')
          .map((block) => block.text || '')
          .join('\n')
      : '';
    const parsed = extractJson(rawText);

    if (Array.isArray(parsed)) {
      return parsed;
    }
  } catch (error) {
    console.warn('Claude summarize failed, using fallback summary:', error.message);
  }

  return emails.map((email) => ({
    from: email.from,
    subject: email.subject,
    reason: email.snippet
  }));
}

module.exports = {
  summarizeImportantEmails
};
