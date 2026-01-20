# Voicemail Assistant

Voice-first PWA for triaging Superhuman email while driving.

## Project Status

**Phase 1 Complete**: Gmail OAuth, Read Emails, Archive/Delete/Star, Undo

## Project Overview

- **Frontend**: Next.js 16 App Router, React 19, TypeScript, Tailwind CSS v4
- **Backend**: Supabase (PostgreSQL + RLS)
- **Voice**: Vapi for voice interactions (Phase 3)
- **Email**: Gmail API via googleapis

## Directory Structure

```
src/
├── app/
│   ├── page.tsx              # Test UI (Connect Gmail, inbox list, actions)
│   └── api/
│       ├── auth/gmail/       # OAuth routes
│       ├── emails/           # Read endpoints (inbox, thread)
│       └── actions/          # Action endpoints (archive, delete, star, undo)
├── lib/
│   ├── gmail.ts              # Gmail API wrapper with token refresh
│   └── supabase/             # Supabase clients (client.ts, server.ts)
└── types/
    └── database.ts           # TypeScript types for DB and API responses
```

## Key Commands

```bash
npm run dev          # Start development server
npm run build        # Production build
npm run lint         # Run ESLint
```

## Environment Variables

See `.env.example` for required environment variables.

**Required for Phase 1:**
- `NEXT_PUBLIC_SUPABASE_URL` - Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` - Supabase anon key
- `SUPABASE_SERVICE_ROLE_KEY` - Supabase service role key
- `GOOGLE_CLIENT_ID` - Google OAuth client ID
- `GOOGLE_CLIENT_SECRET` - Google OAuth client secret

## Supabase Project

- **Project ID**: `obapgmaakwzflbsetkgl`
- **Region**: us-east-1
- **Tables**: gmail_tokens, sessions, undo_actions

## API Patterns

**Gmail API wrapper** (`src/lib/gmail.ts`):
- `getGmailClient(email)` - Returns authenticated client with auto token refresh
- `archiveThread`, `deleteThread`, `starThread`, etc.

**Action endpoints** accept:
```json
{ "threadId": "string", "accountEmail": "optional" }
```

Account email defaults to `gmail_account` cookie set during OAuth.

## Development Notes

- Use Server Components by default
- Add `'use client'` only when needed (hooks, event handlers, browser APIs)
- Always enable RLS on Supabase tables
- Run `/security-check` before commits
- Gmail tokens stored unencrypted (Supabase handles encryption at rest)

## Next Steps (Phase 2)

1. Railway service for Playwright (Superhuman scraping)
2. Inbox order mapping (Superhuman → Gmail thread IDs)
3. Session management in Supabase
