# Voicemail Assistant

Voice-first PWA for triaging Superhuman email while driving.

## Project Status

**Phase 1 Complete**: Gmail OAuth, Read Emails, Archive/Delete/Star, Undo
**Phase 2 Complete**: Railway Playwright service, Superhuman scraping, Thread mapping
**Phase 3 Complete**: Vapi voice integration, webhook handler, voice session management

## Project Overview

- **Frontend**: Next.js 16 App Router, React 19, TypeScript, Tailwind CSS v4
- **Backend**: Supabase (PostgreSQL + RLS)
- **Voice**: Vapi for voice interactions (Phase 3)
- **Email**: Gmail API via googleapis
- **Scraping**: Playwright on Railway (Superhuman inbox)

## Directory Structure

```
src/
├── app/
│   ├── page.tsx              # Test UI (Connect Gmail, inbox list, actions)
│   └── api/
│       ├── auth/gmail/       # OAuth routes
│       ├── emails/           # Read endpoints (inbox, thread)
│       ├── actions/          # Action endpoints (archive, delete, star, undo)
│       ├── session/
│       │   ├── start/        # Start triage session
│       │   ├── stop/         # Stop/pause session
│       │   ├── next/         # Get next email in queue
│       │   ├── voice/        # Start Vapi voice call
│       │   └── [sessionId]/  # Get session status
│       └── vapi/
│           └── webhook/      # Vapi webhook handler for function calls
├── lib/
│   ├── gmail.ts              # Gmail API wrapper with token refresh
│   ├── railway.ts            # Railway Playwright service client
│   ├── vapi.ts               # Vapi voice AI client and configuration
│   └── supabase/             # Supabase clients (client.ts, server.ts)
└── types/
    └── database.ts           # TypeScript types for DB and API responses

railway-service/            # Playwright service for Superhuman scraping
├── src/
│   ├── index.ts            # Express server with scraping endpoints
│   ├── session.ts          # Cookie/session management
│   └── mapping.ts          # Superhuman → Gmail thread ID mapping
├── Dockerfile              # Railway deployment config
└── package.json
```

## Key Commands

```bash
# Main app
npm run dev          # Start development server
npm run build        # Production build
npm run lint         # Run ESLint

# Railway service
cd railway-service
npm run dev          # Start with tsx watch
npm run build        # TypeScript build
npm start            # Production server
```

## Environment Variables

See `.env.example` for required environment variables.

**Required for Phase 1:**
- `NEXT_PUBLIC_SUPABASE_URL` - Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` - Supabase anon key
- `SUPABASE_SERVICE_ROLE_KEY` - Supabase service role key
- `GOOGLE_CLIENT_ID` - Google OAuth client ID
- `GOOGLE_CLIENT_SECRET` - Google OAuth client secret

**Required for Phase 2:**
- `RAILWAY_PLAYWRIGHT_URL` - Railway service URL (default: http://localhost:3001)

**Required for Phase 3:**
- `VAPI_API_KEY` - Vapi API key for server-side operations
- `VAPI_ASSISTANT_ID` - Vapi assistant ID (created in Vapi dashboard)
- `VAPI_WEBHOOK_SECRET` - Secret for verifying webhook signatures
- `VAPI_PUBLIC_KEY` - Vapi public key for client-side SDK

## Supabase Project

- **Project ID**: `obapgmaakwzflbsetkgl`
- **Region**: us-east-1
- **Tables**: gmail_tokens, sessions, undo_actions

## API Patterns

**Gmail API wrapper** (`src/lib/gmail.ts`):
- `getGmailClient(email)` - Returns authenticated client with auto token refresh
- `getInboxThreads(email)` - Get inbox threads with metadata
- `archiveThread`, `deleteThread`, `starThread`, etc.

**Railway service client** (`src/lib/railway.ts`):
- `scrapeInbox(email)` - Scrape Superhuman inbox order
- `mapThreads(superhuman, gmail)` - Map threads to Gmail IDs
- `saveSession(email)` / `restoreSession(email)` - Cookie management

**Action endpoints** accept:
```json
{ "threadId": "string", "accountEmail": "optional" }
```

**Session start** (`POST /api/session/start`):
```json
{ "accountEmail": "optional" }
```
Returns: sessionId, queueLength, mappingStats, firstEmail

**Vapi voice session** (`POST /api/session/voice`):
```json
{ "sessionId": "uuid" }
```
Returns: callId, webCallUrl, currentEmail, position, total

**Vapi webhook** (`POST /api/vapi/webhook`):
- Receives tool-calls from Vapi assistant
- Executes email actions (archive, delete, star, skip, undo)
- Returns results with spoken messages
- Verifies webhook signature via HMAC-SHA256

**Vapi client** (`src/lib/vapi.ts`):
- `verifyWebhookSignature()` - Verify incoming webhook requests
- `createWebCall()` - Start a web call session
- `endCall()` - End an active call
- `ASSISTANT_TOOLS` - Function definitions for the assistant

## Development Notes

- Use Server Components by default
- Add `'use client'` only when needed (hooks, event handlers, browser APIs)
- Always enable RLS on Supabase tables
- Run `/security-check` before commits
- Gmail tokens stored unencrypted (Supabase handles encryption at rest)
- Railway service uses in-memory session storage (30 min TTL)

## Next Steps (Phase 4 - Polish)

1. Voice triage UI component with Vapi Web SDK
2. PWA manifest and service worker
3. Session resume on app open
4. Error handling and retry logic
5. Real-world testing and voice prompt iteration

## Vapi Setup Instructions

1. Create account at [vapi.ai](https://vapi.ai)
2. Create an assistant with the system prompt from `src/lib/vapi.ts`
3. Add function tools as defined in `ASSISTANT_TOOLS`
4. Set server URL to: `https://your-domain.com/api/vapi/webhook`
5. Copy API key, Assistant ID, and webhook secret to `.env.local`
