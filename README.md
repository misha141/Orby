# Orby MVP (Voice-Driven AI Assistant)

Orby is a voice-controlled productivity assistant MVP.

## What is included

- Frontend (Next.js): voice input, live transcript, action preview, confirm/cancel, response output
- Backend (Node.js + Express):
  - `POST /parse-command`
  - `POST /execute-action`
- OpenAI intent extraction + important email summarization
- Mock email data in `backend/data/emails.json`

## Project structure

- `backend/server.js`
- `backend/routes/index.js`
- `backend/services/openai.js`
- `backend/services/actionRouter.js`
- `backend/data/emails.json`
- `frontend/components/VoiceInput.js`
- `frontend/components/ActionPreview.js`
- `frontend/components/ResponseBox.js`
- `frontend/pages/index.js`

## 1) Backend setup

```bash
cd backend
cp .env.example .env
```

Update `.env`:

```env
OPENAI_API_KEY=your_openai_api_key_here
OPENAI_MODEL=gpt-4.1-mini
PORT=4000
FRONTEND_URL=http://localhost:3000
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:4000/auth/google/callback
USE_MOCK_GMAIL=true
GMAIL_ACCESS_TOKEN=
GMAIL_MAX_EMAILS=8
GMAIL_QUERY=in:inbox
```

Install and run:

```bash
npm install
npm run dev
```

Backend runs on `http://localhost:4000`.

Health check:

```bash
curl http://localhost:4000/health
```

## 2) Frontend setup

```bash
cd frontend
cp .env.local.example .env.local
npm install
npm run dev
```

Frontend runs on `http://localhost:3000`.

## 3) MVP flow

1. Click `🎤 Talk to Orby`
2. Speak command
3. Transcript appears
4. Frontend calls `POST /parse-command`
5. UI shows action preview
6. Click `Confirm ✅`
7. Frontend calls `POST /execute-action`
8. Result appears in response box

## API examples

### Parse command

```bash
curl -X POST http://localhost:4000/parse-command \
  -H "Content-Type: application/json" \
  -d '{"text":"Reply to Sarah"}'
```

Expected shape:

```json
{
  "intent": "reply_email",
  "target": "Sarah",
  "message": "I will send update by EOD",
  "date": "",
  "time": ""
}
```

### Execute action

```bash
curl -X POST http://localhost:4000/execute-action \
  -H "Content-Type: application/json" \
  -d '{"intent":"reply_email","target":"Sarah","message":"I will send the update by EOD"}'
```

Expected shape:

```json
{
  "status": "success",
  "message": "Reply sent to Sarah"
}
```

## Notes

- If `OPENAI_API_KEY` is missing, Orby uses a local fallback parser and still runs.
- Set `USE_MOCK_GMAIL=true` to always use local mock inbox data (`backend/data/emails.json`).
- You can connect Gmail in the UI using `Connect Gmail` (OAuth flow).
- OAuth endpoints:
  - `GET /auth/google/start`
  - `GET /auth/google/callback`
  - `GET /auth/google/status`
- If `GMAIL_ACCESS_TOKEN` is set, Orby can also use that env token directly.
- If Gmail is unavailable, Orby automatically falls back to `backend/data/emails.json`.
- `reply_email` and `schedule_meeting` execution is simulated for MVP.

## Voice phrase example

Say: `what's in my inbox`

Orby will parse it as `get_important_emails`, fetch inbox emails (Gmail if configured), and return prioritized summaries.

## Google OAuth setup

1. Create a Google Cloud project.
2. Enable `Gmail API`.
3. Configure OAuth consent screen.
4. Create OAuth client credentials (`Web application`).
5. Add authorized redirect URI:
   - `http://localhost:4000/auth/google/callback`
6. Copy values into `backend/.env`:
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
   - `GOOGLE_REDIRECT_URI` (same as above)
   - `FRONTEND_URL=http://localhost:3000`
7. Restart backend, open Orby UI, click `Connect Gmail`.
