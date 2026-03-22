const Anthropic = require('@anthropic-ai/sdk');

const model = process.env.CLAUDE_MODEL || 'claude-sonnet-4-5-20250929';

const client = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

module.exports = {
  client,
  model
};
