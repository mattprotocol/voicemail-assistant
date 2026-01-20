# VoiceMail Assistant - Full Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a voice-first PWA for triaging Superhuman email while driving. Single account MVP with archive/delete/star actions.

**Architecture:** Next.js PWA on Vercel, Supabase for state/tokens, Railway for Playwright (Superhuman scraping), Vapi for voice, Gmail API for email actions.

**Tech Stack:** Next.js 14, TypeScript, Tailwind, Supabase, Google APIs, Playwright, Vapi, Zod

---

# Phase 1: Foundation

**Goal:** Next.js app with Gmail OAuth and basic email actions working via UI.

---

## Task 1.1: Project Scaffolding

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.js`, `tailwind.config.ts`
- Create: `src/app/layout.tsx`, `src/app/page.tsx`
- Create: `.env.example`, `.gitignore`

**Step 1: Create Next.js project**

```bash
cd "/Users/mattbrockman/Projects/VoiceMail App"
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm
```

**Step 2: Verify project runs**

```bash
npm run dev
```

Expected: Server starts at http://localhost:3000

**Step 3: Create .env.example**

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here

# Google OAuth
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_REDIRECT_URI=http://localhost:3000/api/auth/gmail/callback

# Railway (Phase 2)
RAILWAY_PLAYWRIGHT_URL=http://localhost:3001

# Vapi (Phase 3)
VAPI_API_KEY=your-vapi-key
VAPI_ASSISTANT_ID=your-assistant-id

# App
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

**Step 4: Update .gitignore**

Append:
```
.env
.env.*
.env.local
!.env.example
supabase/.temp/
```

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: initialize Next.js project with TypeScript and Tailwind"
```

---

## Task 1.2: Install Dependencies

**Step 1: Install all dependencies**

```bash
npm install @supabase/supabase-js @supabase/ssr googleapis zod
```

**Step 2: Verify build**

```bash
npm run build
```

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat: add supabase, googleapis, and zod dependencies"
```

---

## Task 1.3: Supabase Client Setup

**Files:**
- Create: `src/lib/supabase/client.ts`
- Create: `src/lib/supabase/server.ts`
- Create: `src/types/database.ts`

**Step 1: Create browser client** (`src/lib/supabase/client.ts`)

```typescript
import { createBrowserClient } from '@supabase/ssr'
import type { Database } from '@/types/database'

export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
```

**Step 2: Create server client** (`src/lib/supabase/server.ts`)

```typescript
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import type { Database } from '@/types/database'

export async function createClient() {
  const cookieStore = await cookies()
  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {}
        },
      },
    }
  )
}

export function createServiceClient() {
  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      cookies: { getAll() { return [] }, setAll() {} },
    }
  )
}
```

**Step 3: Create database types** (`src/types/database.ts`)

```typescript
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export interface Database {
  public: {
    Tables: {
      gmail_tokens: {
        Row: {
          id: string
          account_email: string
          access_token: string
          refresh_token: string
          expires_at: string
          created_at: string
        }
        Insert: {
          id?: string
          account_email: string
          access_token: string
          refresh_token: string
          expires_at: string
          created_at?: string
        }
        Update: {
          id?: string
          account_email?: string
          access_token?: string
          refresh_token?: string
          expires_at?: string
          created_at?: string
        }
      }
      sessions: {
        Row: {
          id: string
          account_email: string
          status: string
          queue_snapshot: Json
          current_index: number
          started_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          account_email: string
          status: string
          queue_snapshot: Json
          current_index?: number
          started_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          account_email?: string
          status?: string
          queue_snapshot?: Json
          current_index?: number
          started_at?: string
          updated_at?: string
        }
      }
      undo_actions: {
        Row: {
          id: string
          session_id: string
          action_type: string
          gmail_thread_id: string
          reverse_action: Json
          created_at: string
          expires_at: string
        }
        Insert: {
          id?: string
          session_id: string
          action_type: string
          gmail_thread_id: string
          reverse_action: Json
          created_at?: string
          expires_at: string
        }
        Update: {
          id?: string
          session_id?: string
          action_type?: string
          gmail_thread_id?: string
          reverse_action?: Json
          created_at?: string
          expires_at?: string
        }
      }
    }
    Views: {}
    Functions: {}
    Enums: {}
  }
}
```

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: add Supabase client setup and database types"
```

---

## Task 1.4: Create Supabase Schema

**Files:**
- Create: `supabase/migrations/001_initial_schema.sql`

**Step 1: Create migration file**

```sql
-- Gmail OAuth tokens
create table gmail_tokens (
  id uuid primary key default gen_random_uuid(),
  account_email text unique not null,
  access_token text not null,
  refresh_token text not null,
  expires_at timestamptz not null,
  created_at timestamptz default now()
);
alter table gmail_tokens enable row level security;

-- Triage sessions
create table sessions (
  id uuid primary key default gen_random_uuid(),
  account_email text not null,
  status text not null check (status in ('active', 'paused', 'completed')),
  queue_snapshot jsonb not null default '[]'::jsonb,
  current_index int default 0,
  started_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table sessions enable row level security;

-- Undo stack
create table undo_actions (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references sessions(id) on delete cascade,
  action_type text not null check (action_type in ('archive', 'delete', 'star', 'mark_unread')),
  gmail_thread_id text not null,
  reverse_action jsonb not null,
  created_at timestamptz default now(),
  expires_at timestamptz not null
);
alter table undo_actions enable row level security;

-- Indexes
create index sessions_account_status_idx on sessions(account_email, status);
create index undo_actions_session_expires_idx on undo_actions(session_id, expires_at);
```

**Step 2: Apply via Supabase MCP**

Use `mcp__supabase__apply_migration`

**Step 3: Commit**

```bash
git add supabase/
git commit -m "feat: add Supabase schema for tokens, sessions, and undo"
```

---

## Task 1.5: Gmail OAuth Flow

**Files:**
- Create: `src/lib/gmail.ts`
- Create: `src/app/api/auth/gmail/route.ts`
- Create: `src/app/api/auth/gmail/callback/route.ts`

**Step 1: Create Gmail lib** (`src/lib/gmail.ts`)

```typescript
import { google } from 'googleapis'
import { createServiceClient } from '@/lib/supabase/server'

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/userinfo.email',
]

export function createOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  )
}

export function getAuthUrl() {
  const oauth2Client = createOAuth2Client()
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
  })
}

export async function getTokensFromCode(code: string) {
  const oauth2Client = createOAuth2Client()
  const { tokens } = await oauth2Client.getToken(code)
  return tokens
}

export function createAuthenticatedClient(accessToken: string, refreshToken: string) {
  const oauth2Client = createOAuth2Client()
  oauth2Client.setCredentials({ access_token: accessToken, refresh_token: refreshToken })
  return oauth2Client
}

export function getGmailClient(auth: ReturnType<typeof createOAuth2Client>) {
  return google.gmail({ version: 'v1', auth })
}

export async function getStoredTokens(accountEmail: string) {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('gmail_tokens')
    .select('*')
    .eq('account_email', accountEmail)
    .single()
  if (error || !data) throw new Error('No tokens found for account')
  return data
}

export async function refreshTokenIfNeeded(accountEmail: string) {
  const tokens = await getStoredTokens(accountEmail)
  const expiresAt = new Date(tokens.expires_at)
  if (expiresAt.getTime() - Date.now() < 5 * 60 * 1000) {
    const oauth2Client = createOAuth2Client()
    oauth2Client.setCredentials({ refresh_token: tokens.refresh_token })
    const { credentials } = await oauth2Client.refreshAccessToken()
    const supabase = createServiceClient()
    await supabase
      .from('gmail_tokens')
      .update({
        access_token: credentials.access_token!,
        expires_at: new Date(credentials.expiry_date!).toISOString(),
      })
      .eq('account_email', accountEmail)
    return credentials.access_token!
  }
  return tokens.access_token
}

export async function getAuthenticatedGmailClient(accountEmail: string) {
  const tokens = await getStoredTokens(accountEmail)
  const accessToken = await refreshTokenIfNeeded(accountEmail)
  const oauth2Client = createAuthenticatedClient(accessToken, tokens.refresh_token)
  return getGmailClient(oauth2Client)
}
```

**Step 2: Create auth route** (`src/app/api/auth/gmail/route.ts`)

```typescript
import { NextResponse } from 'next/server'
import { getAuthUrl } from '@/lib/gmail'

export async function GET() {
  return NextResponse.redirect(getAuthUrl())
}
```

**Step 3: Create callback route** (`src/app/api/auth/gmail/callback/route.ts`)

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { google } from 'googleapis'
import { getTokensFromCode, createOAuth2Client } from '@/lib/gmail'
import { createServiceClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code')
  const error = request.nextUrl.searchParams.get('error')

  if (error) return NextResponse.redirect(new URL(`/?error=${error}`, request.url))
  if (!code) return NextResponse.redirect(new URL('/?error=no_code', request.url))

  try {
    const tokens = await getTokensFromCode(code)
    const oauth2Client = createOAuth2Client()
    oauth2Client.setCredentials(tokens)
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client })
    const { data: userInfo } = await oauth2.userinfo.get()
    if (!userInfo.email) throw new Error('Could not get user email')

    const supabase = createServiceClient()
    await supabase.from('gmail_tokens').upsert({
      account_email: userInfo.email,
      access_token: tokens.access_token!,
      refresh_token: tokens.refresh_token!,
      expires_at: new Date(tokens.expiry_date!).toISOString(),
    }, { onConflict: 'account_email' })

    return NextResponse.redirect(new URL(`/?success=true&email=${userInfo.email}`, request.url))
  } catch (err) {
    console.error('OAuth error:', err)
    return NextResponse.redirect(new URL('/?error=oauth_failed', request.url))
  }
}
```

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: add Gmail OAuth flow with token storage"
```

---

## Task 1.6: Gmail Actions

**Files:**
- Modify: `src/lib/gmail.ts` (append)
- Create: `src/app/api/actions/archive/route.ts`
- Create: `src/app/api/actions/delete/route.ts`
- Create: `src/app/api/actions/star/route.ts`

**Step 1: Add action functions to gmail.ts**

```typescript
// Append to src/lib/gmail.ts

export async function archiveThread(accountEmail: string, threadId: string) {
  const gmail = await getAuthenticatedGmailClient(accountEmail)
  await gmail.users.threads.modify({
    userId: 'me',
    id: threadId,
    requestBody: { removeLabelIds: ['INBOX'] },
  })
}

export async function deleteThread(accountEmail: string, threadId: string) {
  const gmail = await getAuthenticatedGmailClient(accountEmail)
  await gmail.users.threads.trash({ userId: 'me', id: threadId })
}

export async function starThread(accountEmail: string, threadId: string) {
  const gmail = await getAuthenticatedGmailClient(accountEmail)
  const thread = await gmail.users.threads.get({ userId: 'me', id: threadId })
  const messageId = thread.data.messages?.[0]?.id
  if (messageId) {
    await gmail.users.messages.modify({
      userId: 'me',
      id: messageId,
      requestBody: { addLabelIds: ['STARRED'] },
    })
  }
}

export async function unarchiveThread(accountEmail: string, threadId: string) {
  const gmail = await getAuthenticatedGmailClient(accountEmail)
  await gmail.users.threads.modify({
    userId: 'me',
    id: threadId,
    requestBody: { addLabelIds: ['INBOX'] },
  })
}

export async function undeleteThread(accountEmail: string, threadId: string) {
  const gmail = await getAuthenticatedGmailClient(accountEmail)
  await gmail.users.threads.untrash({ userId: 'me', id: threadId })
}

export async function unstarThread(accountEmail: string, threadId: string) {
  const gmail = await getAuthenticatedGmailClient(accountEmail)
  const thread = await gmail.users.threads.get({ userId: 'me', id: threadId })
  const messageId = thread.data.messages?.[0]?.id
  if (messageId) {
    await gmail.users.messages.modify({
      userId: 'me',
      id: messageId,
      requestBody: { removeLabelIds: ['STARRED'] },
    })
  }
}
```

**Step 2: Create action endpoints**

Create `src/app/api/actions/archive/route.ts`:
```typescript
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { archiveThread } from '@/lib/gmail'

const schema = z.object({ accountEmail: z.string().email(), threadId: z.string().min(1) })

export async function POST(request: NextRequest) {
  try {
    const { accountEmail, threadId } = schema.parse(await request.json())
    await archiveThread(accountEmail, threadId)
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Archive error:', error)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
```

Create `src/app/api/actions/delete/route.ts`:
```typescript
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { deleteThread } from '@/lib/gmail'

const schema = z.object({ accountEmail: z.string().email(), threadId: z.string().min(1) })

export async function POST(request: NextRequest) {
  try {
    const { accountEmail, threadId } = schema.parse(await request.json())
    await deleteThread(accountEmail, threadId)
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Delete error:', error)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
```

Create `src/app/api/actions/star/route.ts`:
```typescript
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { starThread } from '@/lib/gmail'

const schema = z.object({ accountEmail: z.string().email(), threadId: z.string().min(1) })

export async function POST(request: NextRequest) {
  try {
    const { accountEmail, threadId } = schema.parse(await request.json())
    await starThread(accountEmail, threadId)
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Star error:', error)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
```

**Step 3: Commit**

```bash
git add -A
git commit -m "feat: add Gmail action endpoints (archive, delete, star)"
```

---

## Task 1.7: Read Emails

**Files:**
- Modify: `src/lib/gmail.ts` (append)
- Create: `src/app/api/emails/route.ts`
- Create: `src/app/api/emails/[threadId]/route.ts`

**Step 1: Add email reading to gmail.ts**

```typescript
// Append to src/lib/gmail.ts

export interface EmailThread {
  threadId: string
  subject: string
  sender: string
  senderEmail: string
  snippet: string
  body: string
  receivedAt: string
  isUnread: boolean
}

function extractBody(payload: any): string {
  if (!payload) return ''
  if (payload.body?.data) return Buffer.from(payload.body.data, 'base64').toString('utf-8')
  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body?.data)
        return Buffer.from(part.body.data, 'base64').toString('utf-8')
    }
    for (const part of payload.parts) {
      if (part.mimeType === 'text/html' && part.body?.data) {
        const html = Buffer.from(part.body.data, 'base64').toString('utf-8')
        return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
      }
    }
    for (const part of payload.parts) {
      const nested = extractBody(part)
      if (nested) return nested
    }
  }
  return ''
}

export async function getInboxThreads(accountEmail: string, maxResults = 20): Promise<EmailThread[]> {
  const gmail = await getAuthenticatedGmailClient(accountEmail)
  const response = await gmail.users.threads.list({ userId: 'me', labelIds: ['INBOX'], maxResults })
  const threads = response.data.threads || []
  const results: EmailThread[] = []

  for (const thread of threads) {
    if (!thread.id) continue
    const full = await gmail.users.threads.get({ userId: 'me', id: thread.id, format: 'full' })
    const msg = full.data.messages?.[full.data.messages.length - 1]
    if (!msg) continue

    const headers = msg.payload?.headers || []
    const subject = headers.find(h => h.name === 'Subject')?.value || '(no subject)'
    const from = headers.find(h => h.name === 'From')?.value || ''
    const date = headers.find(h => h.name === 'Date')?.value || ''
    const match = from.match(/^(.+?)\s*<(.+?)>$/)

    results.push({
      threadId: thread.id,
      subject,
      sender: match ? match[1].replace(/"/g, '') : from,
      senderEmail: match ? match[2] : from,
      snippet: msg.snippet || '',
      body: extractBody(msg.payload),
      receivedAt: date,
      isUnread: msg.labelIds?.includes('UNREAD') || false,
    })
  }
  return results
}

export async function getThread(accountEmail: string, threadId: string): Promise<EmailThread> {
  const gmail = await getAuthenticatedGmailClient(accountEmail)
  const full = await gmail.users.threads.get({ userId: 'me', id: threadId, format: 'full' })
  const msg = full.data.messages?.[full.data.messages.length - 1]
  if (!msg) throw new Error('No messages')

  const headers = msg.payload?.headers || []
  const subject = headers.find(h => h.name === 'Subject')?.value || '(no subject)'
  const from = headers.find(h => h.name === 'From')?.value || ''
  const date = headers.find(h => h.name === 'Date')?.value || ''
  const match = from.match(/^(.+?)\s*<(.+?)>$/)

  return {
    threadId,
    subject,
    sender: match ? match[1].replace(/"/g, '') : from,
    senderEmail: match ? match[2] : from,
    snippet: msg.snippet || '',
    body: extractBody(msg.payload),
    receivedAt: date,
    isUnread: msg.labelIds?.includes('UNREAD') || false,
  }
}
```

**Step 2: Create email endpoints**

Create `src/app/api/emails/route.ts`:
```typescript
import { NextRequest, NextResponse } from 'next/server'
import { getInboxThreads } from '@/lib/gmail'

export async function GET(request: NextRequest) {
  const email = request.nextUrl.searchParams.get('accountEmail')
  if (!email) return NextResponse.json({ error: 'Missing email' }, { status: 400 })
  try {
    const threads = await getInboxThreads(email)
    return NextResponse.json({ threads })
  } catch (error) {
    console.error('Fetch error:', error)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
```

Create `src/app/api/emails/[threadId]/route.ts`:
```typescript
import { NextRequest, NextResponse } from 'next/server'
import { getThread } from '@/lib/gmail'

export async function GET(request: NextRequest, { params }: { params: Promise<{ threadId: string }> }) {
  const { threadId } = await params
  const email = request.nextUrl.searchParams.get('accountEmail')
  if (!email) return NextResponse.json({ error: 'Missing email' }, { status: 400 })
  try {
    const thread = await getThread(email, threadId)
    return NextResponse.json({ thread })
  } catch (error) {
    console.error('Fetch error:', error)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
```

**Step 3: Commit**

```bash
git add -A
git commit -m "feat: add email reading endpoints"
```

---

## Task 1.8: Test UI

**Files:**
- Modify: `src/app/page.tsx`

**Step 1: Create test UI**

```typescript
'use client'
import { useState } from 'react'

interface EmailThread {
  threadId: string; subject: string; sender: string; snippet: string
}

export default function Home() {
  const [email, setEmail] = useState('')
  const [threads, setThreads] = useState<EmailThread[]>([])
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')

  const fetchEmails = async () => {
    if (!email) return
    setLoading(true)
    try {
      const res = await fetch(`/api/emails?accountEmail=${encodeURIComponent(email)}`)
      const data = await res.json()
      setThreads(data.threads || [])
    } catch { setMessage('Error fetching') }
    finally { setLoading(false) }
  }

  const handleAction = async (action: string, threadId: string) => {
    setLoading(true)
    try {
      await fetch(`/api/actions/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountEmail: email, threadId }),
      })
      setThreads(threads.filter(t => t.threadId !== threadId))
      setMessage(`${action} done`)
    } catch { setMessage('Error') }
    finally { setLoading(false) }
  }

  return (
    <main className="min-h-screen p-8 max-w-2xl mx-auto">
      <h1 className="text-3xl font-bold mb-8">VoiceMail Assistant</h1>
      <div className="space-y-4 mb-8">
        <a href="/api/auth/gmail" className="bg-blue-600 text-white px-6 py-3 rounded-lg inline-block">
          Connect Gmail
        </a>
        <div className="flex gap-2">
          <input type="email" placeholder="Connected email" value={email}
            onChange={e => setEmail(e.target.value)} className="flex-1 border rounded px-4 py-2" />
          <button onClick={fetchEmails} disabled={loading}
            className="bg-green-600 text-white px-6 py-2 rounded disabled:opacity-50">
            Fetch
          </button>
        </div>
      </div>
      {message && <div className="mb-4 p-4 bg-gray-100 rounded">{message}</div>}
      <div className="space-y-4">
        {threads.map(t => (
          <div key={t.threadId} className="border rounded p-4">
            <div className="font-medium">{t.sender}</div>
            <div className="text-lg">{t.subject}</div>
            <div className="text-gray-600 text-sm truncate">{t.snippet}</div>
            <div className="mt-3 flex gap-2">
              <button onClick={() => handleAction('archive', t.threadId)}
                className="bg-gray-200 px-3 py-1 rounded">Archive</button>
              <button onClick={() => handleAction('delete', t.threadId)}
                className="bg-red-100 px-3 py-1 rounded">Delete</button>
              <button onClick={() => handleAction('star', t.threadId)}
                className="bg-yellow-100 px-3 py-1 rounded">Star</button>
            </div>
          </div>
        ))}
      </div>
    </main>
  )
}
```

**Step 2: Commit**

```bash
git add -A
git commit -m "feat: add test UI for Gmail integration"
```

---

## Task 1.9: Google Cloud Setup (Manual)

1. Create project at console.cloud.google.com
2. Enable Gmail API
3. Configure OAuth consent (External, add scopes, add test user)
4. Create OAuth credentials (Web app, redirect: `http://localhost:3000/api/auth/gmail/callback`)
5. Copy credentials to `.env.local`
6. Test full flow

---

## Task 1.10: Documentation

**Files:**
- Create: `CLAUDE.md`
- Update: `README.md`

**Step 1: Create CLAUDE.md**

```markdown
# VoiceMail Assistant

Voice-first PWA for triaging Superhuman email while driving.

## Stack
- Frontend: Next.js 14, TypeScript, Tailwind
- Backend: Supabase
- Email: Gmail API
- Voice: Vapi (Phase 3)
- Superhuman: Railway + Playwright (Phase 2)

## Commands
npm run dev / npm run build / npm run lint

## Docs
See docs/plans/ for architecture and implementation plans.
```

**Step 2: Commit**

```bash
git add -A
git commit -m "docs: add project documentation"
```

---

# Phase 2: Superhuman Integration

**Goal:** Scrape Superhuman inbox order via Playwright on Railway.

---

## Task 2.1: Railway Service Scaffold

**Files:**
- Create: `railway-service/package.json`
- Create: `railway-service/tsconfig.json`
- Create: `railway-service/src/index.ts`
- Create: `railway-service/Dockerfile`

**Step 1: Create service directory and package.json**

```bash
mkdir -p railway-service/src
```

Create `railway-service/package.json`:
```json
{
  "name": "voicemail-playwright",
  "version": "1.0.0",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "express": "^4.18.2",
    "playwright": "^1.40.0"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/node": "^20.10.0",
    "tsx": "^4.6.0",
    "typescript": "^5.3.0"
  }
}
```

**Step 2: Create Express server** (`railway-service/src/index.ts`)

```typescript
import express from 'express'
import { chromium, Browser, Page } from 'playwright'

const app = express()
app.use(express.json())

let browser: Browser | null = null
let page: Page | null = null

async function initBrowser() {
  if (!browser) {
    browser = await chromium.launch({ headless: true })
    page = await browser.newPage()
  }
  return { browser, page: page! }
}

app.get('/health', (req, res) => {
  res.json({ status: 'ok', browserActive: !!browser })
})

app.post('/scrape-inbox', async (req, res) => {
  try {
    const { cookies } = req.body
    const { page } = await initBrowser()

    if (cookies) {
      await page.context().addCookies(cookies)
    }

    await page.goto('https://mail.superhuman.com')
    await page.waitForSelector('[data-testid="thread-list"]', { timeout: 10000 })

    // Scrape inbox - will need DOM inspection to finalize selectors
    const threads = await page.evaluate(() => {
      const items = document.querySelectorAll('[data-testid="thread-item"]')
      return Array.from(items).map((item, index) => ({
        position: index,
        sender: item.querySelector('.sender')?.textContent || '',
        subject: item.querySelector('.subject')?.textContent || '',
        timestamp: item.querySelector('.timestamp')?.textContent || '',
      }))
    })

    res.json({ threads })
  } catch (error) {
    console.error('Scrape error:', error)
    res.status(500).json({ error: 'Scrape failed' })
  }
})

app.post('/health-check', async (req, res) => {
  res.json({ session_alive: !!browser && !!page })
})

const PORT = process.env.PORT || 3001
app.listen(PORT, () => console.log(`Playwright service on ${PORT}`))
```

**Step 3: Create Dockerfile**

```dockerfile
FROM mcr.microsoft.com/playwright:v1.40.0-jammy

WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

EXPOSE 3001
CMD ["npm", "start"]
```

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: add Railway Playwright service scaffold"
```

---

## Task 2.2: Superhuman Session Management

**Files:**
- Create: `railway-service/src/session.ts`
- Modify: `railway-service/src/index.ts`

Implement cookie storage, session restore, and heartbeat.

---

## Task 2.3: Gmail Thread ID Mapping

**Files:**
- Create: `railway-service/src/mapping.ts`

Inspect Superhuman DOM for thread IDs or implement fuzzy matching against Gmail API.

---

## Task 2.4: Wire to Next.js

**Files:**
- Create: `src/lib/railway.ts`
- Modify: `src/app/api/session/start/route.ts`

Create client to call Railway service and integrate with session start.

---

# Phase 3: Voice Loop

**Goal:** Vapi integration for voice-driven email triage.

---

## Task 3.1: Vapi Account Setup

1. Create account at vapi.ai
2. Get API key
3. Create assistant with email triage persona

---

## Task 3.2: Vapi Assistant Configuration

**Files:**
- Create: `src/lib/vapi.ts`

Configure assistant with system prompt, voice, and function definitions.

---

## Task 3.3: Webhook Handler

**Files:**
- Create: `src/app/api/vapi/webhook/route.ts`

Handle incoming function calls from Vapi (archive, delete, star, next, etc.)

---

## Task 3.4: Session Flow

**Files:**
- Create: `src/app/api/session/start/route.ts`
- Create: `src/app/api/session/stop/route.ts`

Wire up: start → scrape → store snapshot → start Vapi → triage loop.

---

## Task 3.5: Undo Implementation

**Files:**
- Create: `src/app/api/actions/undo/route.ts`
- Modify: action endpoints to store undo data

---

# Phase 4: Polish

**Goal:** PWA, error handling, real-world testing.

---

## Task 4.1: PWA Manifest

**Files:**
- Create: `public/manifest.json`
- Create: `public/icons/`
- Modify: `src/app/layout.tsx`

---

## Task 4.2: Session Resume

**Files:**
- Modify: `src/app/page.tsx`
- Create: `src/app/api/session/status/route.ts`

Check for existing session on app open, offer resume.

---

## Task 4.3: Error Handling

Implement retry logic, token refresh, graceful degradation.

---

## Task 4.4: Real-World Testing

Test while driving (safely!). Iterate on voice prompts and timing.

---

# Summary

| Phase | Tasks | Outcome |
|-------|-------|---------|
| 1 | 1.1-1.10 | Gmail OAuth + actions via UI |
| 2 | 2.1-2.4 | Superhuman inbox scraping |
| 3 | 3.1-3.5 | Full voice triage loop |
| 4 | 4.1-4.4 | PWA + polish |

**Phase 1 is fully detailed. Phases 2-4 have task outlines to be expanded when reached.**
