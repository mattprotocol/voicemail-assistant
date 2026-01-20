# VoiceMail Assistant - Technical Design

**Date:** 2026-01-20
**Status:** Approved
**MVP Scope:** Single account, read + archive/delete/star (no reply)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         USER (Driving)                          │
│                              │                                  │
│                         Mobile Safari                           │
│                         (PWA installed)                         │
└─────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                      VERCEL (Next.js PWA)                       │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │  UI (minimal│  │  API Routes │  │  Vapi Webhook Handler   │  │
│  │  start btn) │  │  /api/*     │  │  (receives voice events)│  │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                               │
         ┌─────────────────────┼─────────────────────┐
         ▼                     ▼                     ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────┐
│    SUPABASE     │  │     RAILWAY     │  │        VAPI         │
│                 │  │                 │  │                     │
│ • OAuth tokens  │  │ • Playwright    │  │ • Speech-to-text    │
│ • Session state │  │   browser       │  │ • Intent parsing    │
│ • Queue snapshot│  │ • Superhuman    │  │ • Text-to-speech    │
│ • Undo stack    │  │   session       │  │ • Conversation mgmt │
└─────────────────┘  └─────────────────┘  └─────────────────────┘
                               │
                               ▼
                     ┌─────────────────┐
                     │   GMAIL API     │
                     │                 │
                     │ • Read emails   │
                     │ • Archive       │
                     │ • Delete        │
                     │ • Star          │
                     └─────────────────┘
```

**Data flow:**
1. User opens PWA, taps "Start"
2. Next.js calls Railway to scrape Superhuman inbox order
3. Snapshot stored in Supabase
4. Vapi session starts - reads first email via Gmail API
5. User speaks command → Vapi parses → webhook hits Next.js → executes action
6. Confirm and move to next email

---

## Data Model (Supabase)

```sql
-- OAuth tokens for Gmail API access
gmail_tokens (
  id              uuid primary key,
  account_email   text unique not null,
  access_token    text not null,             -- encrypted
  refresh_token   text not null,             -- encrypted
  expires_at      timestamptz not null,
  created_at      timestamptz default now()
)

-- Triage session state
sessions (
  id              uuid primary key,
  account_email   text not null,
  status          text not null,             -- 'active', 'paused', 'completed'
  queue_snapshot  jsonb not null,            -- array of {superhuman_position, gmail_thread_id, sender, subject, timestamp}
  current_index   int default 0,
  started_at      timestamptz default now(),
  updated_at      timestamptz default now()
)

-- Undo stack (last action only, 15-second window)
undo_actions (
  id              uuid primary key,
  session_id      uuid references sessions(id),
  action_type     text not null,             -- 'archive', 'delete', 'star', 'mark_unread'
  gmail_thread_id text not null,
  reverse_action  jsonb not null,
  created_at      timestamptz default now(),
  expires_at      timestamptz not null       -- created_at + 15 seconds
)
```

---

## Superhuman Integration (Railway)

**Service structure:**

```
railway-playwright-service/
├── src/
│   ├── index.ts              # Express server
│   ├── superhuman.ts         # Browser automation logic
│   └── session-manager.ts    # Keep browser session alive
├── Dockerfile
└── package.json
```

**Endpoints:**

```
POST /scrape-inbox
  Body: { account_email: string }
  Returns: { threads: [{ position, sender, subject, timestamp, gmail_thread_id? }] }

POST /health-check
  Body: { account_email: string }
  Returns: { session_alive: boolean }

POST /refresh-session
  Body: { account_email: string, cookies?: string }
  Returns: { success: boolean }
```

**Session strategy:**
- On first request, manually log into Superhuman and export cookies
- Service loads cookies to restore session
- Background heartbeat every 5 minutes keeps session alive
- If session dies, service notifies to re-auth

**Gmail thread ID mapping:**
- First: inspect Superhuman DOM/network for exposed thread IDs
- Fallback: fuzzy match on sender + subject + timestamp against Gmail API search
- Store mapping in the queue snapshot

---

## Vapi Voice Integration

**Vapi assistant config:**

```javascript
{
  name: "Email Assistant",
  voice: "jennifer",
  model: {
    provider: "anthropic",
    model: "claude-sonnet-4-20250514"
  },
  firstMessage: "You have {{emailCount}} emails. Starting with the first one.",
  systemPrompt: `You are an email triage assistant. Read emails aloud and execute voice commands.

Available commands: archive, delete, star, mark unread, next, skip, repeat, undo, stop.

When user gives a command, call the appropriate function. Always confirm actions briefly.`,

  serverUrl: "https://your-app.vercel.app/api/vapi/webhook"
}
```

**Webhook flow:**

```
User: "Archive this"
     ↓
Vapi: POST /api/vapi/webhook
     { function: "archive", threadId: "xxx" }
     ↓
Your API: Gmail archive → update session index → return next email
     ↓
Vapi: Speaks "Archived. Next email from Sarah, subject: Q1 Report..."
```

---

## Next.js Project Structure

```
src/
├── app/
│   ├── page.tsx                    # Main UI (Start button, status)
│   ├── layout.tsx
│   ├── api/
│   │   ├── auth/
│   │   │   └── gmail/callback/route.ts
│   │   ├── session/
│   │   │   ├── start/route.ts
│   │   │   ├── stop/route.ts
│   │   │   └── status/route.ts
│   │   ├── vapi/
│   │   │   └── webhook/route.ts
│   │   └── actions/
│   │       ├── archive/route.ts
│   │       ├── delete/route.ts
│   │       ├── star/route.ts
│   │       └── undo/route.ts
├── lib/
│   ├── supabase/
│   │   ├── client.ts
│   │   └── server.ts
│   ├── gmail.ts
│   ├── railway.ts
│   └── vapi.ts
└── types/
    └── database.ts
```

**UI is minimal:** Big start button, current position indicator, last heard command.

---

## Core Triage Loop

```
START SESSION
     │
     ▼
┌─────────────────────────────────────────┐
│ 1. Call Railway to scrape Superhuman    │
│ 2. Map threads to Gmail IDs             │
│ 3. Store snapshot in Supabase           │
│ 4. Start Vapi call                      │
└─────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────┐
│ ANNOUNCE CURRENT EMAIL                  │◄──────────┐
│                                         │           │
│ "Email from [sender], subject [subject],│           │
│  received [2 hours ago]"                │           │
│                                         │           │
│ If < 150 words: read full body          │           │
│ If > 150 words: AI summary              │           │
└─────────────────────────────────────────┘           │
     │                                                │
     ▼                                                │
┌─────────────────────────────────────────┐           │
│ WAIT FOR COMMAND                        │           │
│                                         │           │
│ archive, delete, star, next, skip,      │           │
│ repeat, undo, stop                      │           │
└─────────────────────────────────────────┘           │
     │                                                │
     ▼                                                │
┌─────────────────────────────────────────┐           │
│ EXECUTE ACTION                          │           │
│                                         │           │
│ Store action in undo_actions table      │           │
│ Increment current_index                 │           │
└─────────────────────────────────────────┘           │
     │                                                │
     ▼                                                │
   More emails? ───yes───────────────────────────────►┘
     │
     no
     ▼
"You've reached the end. Nice work!"
```

---

## Error Handling

| Scenario | Response |
|----------|----------|
| Gmail API rate limit | Retry 3x with backoff, then notify user |
| Gmail token expired | Silent refresh, if fails prompt re-auth |
| Superhuman session dead | Attempt cookie restore, if fails notify to re-auth |
| Email already handled | "This email was already handled. Moving to next." |
| Network lost | "Lost connection. I'll retry when you're back online." |
| Vapi connection drops | Auto-reconnect, if fails show reconnect button |
| Undo after 15 seconds | "Too late to undo that one." |

---

## Implementation Sequence

**Phase 1: Foundation**
1. Next.js project setup + Supabase schema
2. Gmail OAuth flow (single account)
3. Gmail API wrapper (read, archive, delete, star)
4. Test: can read and archive emails via API routes

**Phase 2: Superhuman Integration**
5. Railway service scaffold (Express + Playwright)
6. Superhuman login + session persistence
7. Inbox scraping + Gmail ID mapping
8. Test: can get prioritized inbox order

**Phase 3: Voice Loop**
9. Vapi assistant setup + webhook handler
10. Wire up: start session → announce first email
11. Command handling (archive, delete, star, next, stop)
12. Undo implementation
13. Test: full triage loop with voice

**Phase 4: Polish**
14. PWA manifest + install prompt
15. Session resume ("pick up where you left off")
16. Error handling + edge cases
17. Test: real-world driving test

---

## Future Enhancements (Post-MVP)

- Multi-account support (3 accounts)
- Reply/Reply All with dictation
- Forward with recipient input
- Search within account
- Labeling
- Attachment summaries
