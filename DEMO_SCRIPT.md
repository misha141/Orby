# Orby Demo Script

## Goal

Show Orby as a voice-first productivity assistant that can:

- transcribe speech live
- understand natural language
- connect to Gmail
- summarize important emails
- draft an email reply
- create, view, and delete tasks
- schedule a meeting

## Demo Setup Checklist

Before the demo, confirm:

- the site loads at your deployed URL
- microphone permission is allowed in the browser
- Gmail is connected
- Google Tasks and Calendar access are enabled in the same Google account
- there are at least a few real emails in the inbox
- audio output is on, if you want Orby to speak responses

## 60-Second Opening

Use this intro:

`Orby is a voice-driven productivity assistant. Instead of switching between Gmail, Tasks, and Calendar, I can just speak naturally, and Orby listens, transcribes in real time, understands the intent, and takes action.`

## Recommended Demo Flow

### 1. Show Live Voice Input

Say:

`Orby, what's in my inbox?`

What to point out:

- the orb enters listening mode
- live transcript appears while you speak
- Orby understands the request without a typed prompt

What to say:

`The first thing to notice is that I’m not typing. Orby is transcribing my voice live and turning it into an action.`

### 2. Show Email Prioritization

Expected result:

- Orby fetches Gmail
- it returns prioritized emails with high / medium / low importance

What to say:

`Now Orby is reading my inbox, identifying what matters most, and summarizing the urgent items first instead of forcing me to scan everything manually.`

### 3. Show Drafted Email Reply

Pick one visible email sender from the inbox summary and say:

`Reply to [name] and say: I saw your email, and I’ll get back to you by tonight.`

Expected result:

- Orby creates a draft preview
- the UI shows recipient, subject, and message
- you can confirm before sending

What to say:

`This is important: Orby doesn’t just blindly send. It creates a preview so I can verify the message before confirming.`

Optional close:

`I can confirm it here, so the assistant stays useful without taking away control.`

### 4. Show Task Creation

Say:

`Create a task to submit my distributed systems assignment by Friday.`

Expected result:

- task is created
- the UI shows the added task

What to say:

`The same voice interface also works for task management. I can create structured tasks from natural language, including the due date.`

### 5. Show Task Retrieval

Say:

`What are my tasks?`

Expected result:

- Orby lists current tasks from Google Tasks

What to say:

`Now Orby is pulling my current task list, so it’s not just capturing new items, it’s also acting as a voice interface for my existing workflow.`

### 6. Show Task Deletion

Say:

`Delete the task about the distributed systems assignment.`

Expected result:

- matching task is removed

What to say:

`And I can clean up the list the same way, just by referring to the task naturally.`

### 7. Show Calendar Scheduling

Say:

`Schedule a meeting with Neha tomorrow at 3 PM online about the product demo.`

Expected result:

- Orby creates a calendar event
- online mode should create a Meet link if supported in the connected account flow

What to say:

`This extends beyond inbox triage. Orby can also turn voice commands into calendar actions with time, date, and context.`

## Best Spoken Prompts

Use these if you want a cleaner run:

- `What's in my inbox?`
- `Reply to Siya and say I’ll send the update by tonight.`
- `Create a task to finish my system design slides by tomorrow.`
- `What are my tasks?`
- `Delete the task about system design slides.`
- `Schedule a meeting with Neha on Monday at 2 PM online about project planning.`

## Fallback Flow

If Gmail is slow or inconsistent, use this shorter backup flow:

1. `What's in my inbox?`
2. `Create a task to prepare for my demo by tonight.`
3. `What are my tasks?`
4. `Schedule a meeting with Neha tomorrow at 3 PM online.`

## Talking Points

Use these during transitions:

- `The key idea is reducing app switching.`
- `The interface is conversational, but the actions are structured.`
- `Voice is the input layer, and Gmail, Tasks, and Calendar are the execution layer.`
- `The assistant keeps the human in control by previewing sensitive actions like email replies.`

## Known Caveats

Be ready to say this if needed:

- `Email reply and scheduling are demonstrated as assistant workflows, and some behaviors may depend on the connected account configuration.`
- `The strongest live demo path is inbox summary, task creation, task retrieval, and Gmail reply preview.`

## 20-Second Close

Use this close:

`So instead of opening multiple apps and manually triaging work, I can just speak once. Orby listens, understands the request, and turns it into action across email, tasks, and calendar.`
