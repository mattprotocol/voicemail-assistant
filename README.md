# VoiceMail Assistant

Voice-first PWA for triaging Superhuman email while driving.

## Features (Phase 1 - MVP)

- **Gmail OAuth** - Authenticate with Google account
- **Inbox Reading** - List and read email threads
- **Email Actions** - Archive, Delete, Star emails
- **Undo Support** - 15-second undo window for all actions

## Tech Stack

- **Frontend**: Next.js 16, React 19, TypeScript, Tailwind CSS v4
- **Backend**: Supabase (PostgreSQL with RLS)
- **Email**: Gmail API via googleapis
- **Voice**: Vapi (Phase 3)

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Supabase

The Supabase project is already created (`obapgmaakwzflbsetkgl`).

Create `.env.local`:
```bash
NEXT_PUBLIC_SUPABASE_URL=https://obapgmaakwzflbsetkgl.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<get from Supabase dashboard>
SUPABASE_SERVICE_ROLE_KEY=<get from Supabase dashboard>
```

### 3. Configure Google OAuth

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a new project or select existing
3. Enable the **Gmail API**
4. Create OAuth 2.0 credentials:
   - Application type: **Web application**
   - Authorized redirect URIs: `http://localhost:3000/api/auth/gmail/callback`
5. Add to `.env.local`:
```bash
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_REDIRECT_URI=http://localhost:3000/api/auth/gmail/callback
```

### 4. Run Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and click "Connect Gmail" to authenticate.

## Project Structure

```
src/
├── app/
│   ├── page.tsx                      # Test UI
│   └── api/
│       ├── auth/gmail/               # OAuth flow
│       │   ├── route.ts              # Initiate OAuth
│       │   └── callback/route.ts     # Handle callback
│       ├── emails/
│       │   ├── inbox/route.ts        # List inbox threads
│       │   └── thread/[threadId]/    # Get thread content
│       └── actions/
│           ├── archive/route.ts      # Archive thread
│           ├── delete/route.ts       # Delete thread
│           ├── star/route.ts         # Star/unstar thread
│           └── undo/route.ts         # Undo last action
├── lib/
│   ├── gmail.ts                      # Gmail API wrapper
│   └── supabase/
│       ├── client.ts                 # Browser client
│       └── server.ts                 # Server client
└── types/
    └── database.ts                   # TypeScript types
```

## API Endpoints

### Authentication

- `GET /api/auth/gmail` - Start OAuth flow
- `GET /api/auth/gmail/callback` - OAuth callback (stores tokens)

### Email Operations

- `GET /api/emails/inbox?maxResults=20&pageToken=xxx` - List inbox threads
- `GET /api/emails/thread/[threadId]` - Get full thread content

### Actions

- `POST /api/actions/archive` - Archive thread
- `POST /api/actions/delete` - Delete thread
- `POST /api/actions/star` - Star/unstar thread
- `POST /api/actions/undo` - Undo last action

All action endpoints accept:
```json
{
  "threadId": "string",
  "accountEmail": "optional - uses cookie if not provided"
}
```

## Database Schema

```sql
-- OAuth tokens
gmail_tokens (id, account_email, access_token, refresh_token, expires_at)

-- Triage sessions (Phase 2+)
sessions (id, account_email, status, queue_snapshot, current_index)

-- Undo stack (15-second window)
undo_actions (id, session_id, action_type, gmail_thread_id, reverse_action, expires_at)
```

## Roadmap

- [x] **Phase 1**: Gmail OAuth + Read + Actions (current)
- [ ] **Phase 2**: Superhuman integration (Playwright on Railway)
- [ ] **Phase 3**: Voice interface (Vapi)
- [ ] **Phase 4**: PWA + Polish

## License

Private - All rights reserved.
