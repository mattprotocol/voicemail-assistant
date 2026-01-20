# VoiceMail Assistant Phase 1 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the foundation - Next.js PWA with Gmail OAuth and basic email actions (read, archive, delete, star).

**Architecture:** Next.js App Router on Vercel, Supabase for auth token storage and session state, Gmail API for email operations. Single account for MVP.

**Tech Stack:** Next.js 14, TypeScript, Supabase, Google APIs (gmail), Tailwind CSS, Zod

---

## Task 1: Project Scaffolding

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.js`, `tailwind.config.ts`
- Create: `src/app/layout.tsx`, `src/app/page.tsx`
- Create: `.env.example`, `.gitignore`

**Step 1: Create Next.js project**

```bash
cd "/Users/mattbrockman/Projects/VoiceMail App"
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm
```

Select: Yes to all defaults

**Step 2: Verify project runs**

```bash
npm run dev
```

Expected: Server starts at http://localhost:3000

**Step 3: Create .env.example**

Create file `.env.example`:

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here

# Google OAuth
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_REDIRECT_URI=http://localhost:3000/api/auth/gmail/callback

# App
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

**Step 4: Update .gitignore**

Append to `.gitignore`:

```
# Environment
.env
.env.*
.env.local
!.env.example

# Supabase
supabase/.temp/
```

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: initialize Next.js project with TypeScript and Tailwind"
```

---

## Task 2: Install Dependencies

**Files:**
- Modify: `package.json`

**Step 1: Install Supabase client**

```bash
npm install @supabase/supabase-js
```

**Step 2: Install Google APIs client**

```bash
npm install googleapis
```

**Step 3: Install validation and utilities**

```bash
npm install zod
```

**Step 4: Verify installation**

```bash
npm run build
```

Expected: Build succeeds

**Step 5: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat: add supabase, googleapis, and zod dependencies"
```

---

## Task 3: Supabase Client Setup

**Files:**
- Create: `src/lib/supabase/client.ts`
- Create: `src/lib/supabase/server.ts`
- Create: `src/types/database.ts`

**Step 1: Create browser client**

Create file `src/lib/supabase/client.ts`:

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

**Step 2: Install SSR package**

```bash
npm install @supabase/ssr
```

**Step 3: Create server client**

Create file `src/lib/supabase/server.ts`:

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
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // Called from Server Component
          }
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
      cookies: {
        getAll() { return [] },
        setAll() {},
      },
    }
  )
}
```

**Step 4: Create placeholder types**

Create file `src/types/database.ts`:

```typescript
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

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

**Step 5: Verify build**

```bash
npm run build
```

Expected: Build succeeds

**Step 6: Commit**

```bash
git add -A
git commit -m "feat: add Supabase client setup and database types"
```

---

## Task 4: Create Supabase Project and Schema

**Files:**
- Create: `supabase/migrations/001_initial_schema.sql`

**Step 1: Create Supabase project**

Use Supabase MCP or dashboard to create project "voicemail-assistant"

**Step 2: Create migration file**

Create file `supabase/migrations/001_initial_schema.sql`:

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

-- Enable RLS
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

-- Index for finding active session
create index sessions_account_status_idx on sessions(account_email, status);

-- Index for finding valid undo actions
create index undo_actions_session_expires_idx on undo_actions(session_id, expires_at);
```

**Step 3: Apply migration via Supabase MCP**

Use `mcp__supabase__apply_migration` with the SQL above.

**Step 4: Copy .env values**

Create `.env.local` with actual Supabase credentials from project settings.

**Step 5: Commit migration**

```bash
git add supabase/
git commit -m "feat: add Supabase schema for tokens, sessions, and undo"
```

---

## Task 5: Gmail OAuth Setup

**Files:**
- Create: `src/lib/gmail.ts`
- Create: `src/app/api/auth/gmail/route.ts`
- Create: `src/app/api/auth/gmail/callback/route.ts`

**Step 1: Create Gmail OAuth config**

Create file `src/lib/gmail.ts`:

```typescript
import { google } from 'googleapis'

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
  oauth2Client.setCredentials({
    access_token: accessToken,
    refresh_token: refreshToken,
  })
  return oauth2Client
}

export function getGmailClient(auth: ReturnType<typeof createOAuth2Client>) {
  return google.gmail({ version: 'v1', auth })
}
```

**Step 2: Create auth initiation route**

Create file `src/app/api/auth/gmail/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import { getAuthUrl } from '@/lib/gmail'

export async function GET() {
  const authUrl = getAuthUrl()
  return NextResponse.redirect(authUrl)
}
```

**Step 3: Create OAuth callback route**

Create file `src/app/api/auth/gmail/callback/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { google } from 'googleapis'
import { getTokensFromCode, createOAuth2Client } from '@/lib/gmail'
import { createServiceClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const code = searchParams.get('code')
  const error = searchParams.get('error')

  if (error) {
    return NextResponse.redirect(
      new URL(`/?error=${encodeURIComponent(error)}`, request.url)
    )
  }

  if (!code) {
    return NextResponse.redirect(
      new URL('/?error=no_code', request.url)
    )
  }

  try {
    const tokens = await getTokensFromCode(code)

    // Get user email
    const oauth2Client = createOAuth2Client()
    oauth2Client.setCredentials(tokens)
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client })
    const { data: userInfo } = await oauth2.userinfo.get()

    if (!userInfo.email) {
      throw new Error('Could not get user email')
    }

    // Store tokens in Supabase
    const supabase = createServiceClient()
    const { error: dbError } = await supabase
      .from('gmail_tokens')
      .upsert({
        account_email: userInfo.email,
        access_token: tokens.access_token!,
        refresh_token: tokens.refresh_token!,
        expires_at: new Date(tokens.expiry_date!).toISOString(),
      }, {
        onConflict: 'account_email',
      })

    if (dbError) {
      throw dbError
    }

    return NextResponse.redirect(
      new URL(`/?success=true&email=${encodeURIComponent(userInfo.email)}`, request.url)
    )
  } catch (err) {
    console.error('OAuth callback error:', err)
    return NextResponse.redirect(
      new URL(`/?error=oauth_failed`, request.url)
    )
  }
}
```

**Step 4: Verify build**

```bash
npm run build
```

Expected: Build succeeds

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: add Gmail OAuth flow with token storage"
```

---

## Task 6: Gmail API Actions

**Files:**
- Modify: `src/lib/gmail.ts`
- Create: `src/app/api/actions/archive/route.ts`
- Create: `src/app/api/actions/delete/route.ts`
- Create: `src/app/api/actions/star/route.ts`

**Step 1: Add Gmail action functions**

Append to `src/lib/gmail.ts`:

```typescript
import { createServiceClient } from '@/lib/supabase/server'

export async function getStoredTokens(accountEmail: string) {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('gmail_tokens')
    .select('*')
    .eq('account_email', accountEmail)
    .single()

  if (error || !data) {
    throw new Error('No tokens found for account')
  }

  return data
}

export async function refreshTokenIfNeeded(accountEmail: string) {
  const tokens = await getStoredTokens(accountEmail)
  const expiresAt = new Date(tokens.expires_at)

  // Refresh if expires in less than 5 minutes
  if (expiresAt.getTime() - Date.now() < 5 * 60 * 1000) {
    const oauth2Client = createOAuth2Client()
    oauth2Client.setCredentials({
      refresh_token: tokens.refresh_token,
    })

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

// Email actions
export async function archiveThread(accountEmail: string, threadId: string) {
  const gmail = await getAuthenticatedGmailClient(accountEmail)
  await gmail.users.threads.modify({
    userId: 'me',
    id: threadId,
    requestBody: {
      removeLabelIds: ['INBOX'],
    },
  })
}

export async function deleteThread(accountEmail: string, threadId: string) {
  const gmail = await getAuthenticatedGmailClient(accountEmail)
  await gmail.users.threads.trash({
    userId: 'me',
    id: threadId,
  })
}

export async function starThread(accountEmail: string, threadId: string) {
  const gmail = await getAuthenticatedGmailClient(accountEmail)
  // Star the first message in the thread
  const thread = await gmail.users.threads.get({
    userId: 'me',
    id: threadId,
  })
  const messageId = thread.data.messages?.[0]?.id
  if (messageId) {
    await gmail.users.messages.modify({
      userId: 'me',
      id: messageId,
      requestBody: {
        addLabelIds: ['STARRED'],
      },
    })
  }
}

export async function unstarThread(accountEmail: string, threadId: string) {
  const gmail = await getAuthenticatedGmailClient(accountEmail)
  const thread = await gmail.users.threads.get({
    userId: 'me',
    id: threadId,
  })
  const messageId = thread.data.messages?.[0]?.id
  if (messageId) {
    await gmail.users.messages.modify({
      userId: 'me',
      id: messageId,
      requestBody: {
        removeLabelIds: ['STARRED'],
      },
    })
  }
}

export async function unarchiveThread(accountEmail: string, threadId: string) {
  const gmail = await getAuthenticatedGmailClient(accountEmail)
  await gmail.users.threads.modify({
    userId: 'me',
    id: threadId,
    requestBody: {
      addLabelIds: ['INBOX'],
    },
  })
}

export async function undeleteThread(accountEmail: string, threadId: string) {
  const gmail = await getAuthenticatedGmailClient(accountEmail)
  await gmail.users.threads.untrash({
    userId: 'me',
    id: threadId,
  })
}
```

**Step 2: Create archive endpoint**

Create file `src/app/api/actions/archive/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { archiveThread } from '@/lib/gmail'

const schema = z.object({
  accountEmail: z.string().email(),
  threadId: z.string().min(1),
})

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { accountEmail, threadId } = schema.parse(body)

    await archiveThread(accountEmail, threadId)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Archive error:', error)
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    }
    return NextResponse.json({ error: 'Failed to archive' }, { status: 500 })
  }
}
```

**Step 3: Create delete endpoint**

Create file `src/app/api/actions/delete/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { deleteThread } from '@/lib/gmail'

const schema = z.object({
  accountEmail: z.string().email(),
  threadId: z.string().min(1),
})

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { accountEmail, threadId } = schema.parse(body)

    await deleteThread(accountEmail, threadId)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Delete error:', error)
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    }
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 })
  }
}
```

**Step 4: Create star endpoint**

Create file `src/app/api/actions/star/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { starThread } from '@/lib/gmail'

const schema = z.object({
  accountEmail: z.string().email(),
  threadId: z.string().min(1),
})

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { accountEmail, threadId } = schema.parse(body)

    await starThread(accountEmail, threadId)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Star error:', error)
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    }
    return NextResponse.json({ error: 'Failed to star' }, { status: 500 })
  }
}
```

**Step 5: Verify build**

```bash
npm run build
```

Expected: Build succeeds

**Step 6: Commit**

```bash
git add -A
git commit -m "feat: add Gmail API action endpoints (archive, delete, star)"
```

---

## Task 7: Read Email Content

**Files:**
- Modify: `src/lib/gmail.ts`
- Create: `src/app/api/emails/[threadId]/route.ts`
- Create: `src/app/api/emails/route.ts`

**Step 1: Add email reading functions**

Append to `src/lib/gmail.ts`:

```typescript
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

export async function getInboxThreads(accountEmail: string, maxResults = 20): Promise<EmailThread[]> {
  const gmail = await getAuthenticatedGmailClient(accountEmail)

  const response = await gmail.users.threads.list({
    userId: 'me',
    labelIds: ['INBOX'],
    maxResults,
  })

  const threads = response.data.threads || []
  const emailThreads: EmailThread[] = []

  for (const thread of threads) {
    if (!thread.id) continue

    const fullThread = await gmail.users.threads.get({
      userId: 'me',
      id: thread.id,
      format: 'full',
    })

    const messages = fullThread.data.messages || []
    const latestMessage = messages[messages.length - 1]

    if (!latestMessage) continue

    const headers = latestMessage.payload?.headers || []
    const subject = headers.find(h => h.name === 'Subject')?.value || '(no subject)'
    const from = headers.find(h => h.name === 'From')?.value || ''
    const date = headers.find(h => h.name === 'Date')?.value || ''

    // Parse sender
    const senderMatch = from.match(/^(.+?)\s*<(.+?)>$/)
    const sender = senderMatch ? senderMatch[1].replace(/"/g, '') : from
    const senderEmail = senderMatch ? senderMatch[2] : from

    // Get body
    const body = extractBody(latestMessage.payload)

    // Check if unread
    const isUnread = latestMessage.labelIds?.includes('UNREAD') || false

    emailThreads.push({
      threadId: thread.id,
      subject,
      sender,
      senderEmail,
      snippet: latestMessage.snippet || '',
      body,
      receivedAt: date,
      isUnread,
    })
  }

  return emailThreads
}

export async function getThread(accountEmail: string, threadId: string): Promise<EmailThread> {
  const gmail = await getAuthenticatedGmailClient(accountEmail)

  const fullThread = await gmail.users.threads.get({
    userId: 'me',
    id: threadId,
    format: 'full',
  })

  const messages = fullThread.data.messages || []
  const latestMessage = messages[messages.length - 1]

  if (!latestMessage) {
    throw new Error('Thread has no messages')
  }

  const headers = latestMessage.payload?.headers || []
  const subject = headers.find(h => h.name === 'Subject')?.value || '(no subject)'
  const from = headers.find(h => h.name === 'From')?.value || ''
  const date = headers.find(h => h.name === 'Date')?.value || ''

  const senderMatch = from.match(/^(.+?)\s*<(.+?)>$/)
  const sender = senderMatch ? senderMatch[1].replace(/"/g, '') : from
  const senderEmail = senderMatch ? senderMatch[2] : from

  const body = extractBody(latestMessage.payload)
  const isUnread = latestMessage.labelIds?.includes('UNREAD') || false

  return {
    threadId,
    subject,
    sender,
    senderEmail,
    snippet: latestMessage.snippet || '',
    body,
    receivedAt: date,
    isUnread,
  }
}

function extractBody(payload: any): string {
  if (!payload) return ''

  // Direct body
  if (payload.body?.data) {
    return Buffer.from(payload.body.data, 'base64').toString('utf-8')
  }

  // Multipart
  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        return Buffer.from(part.body.data, 'base64').toString('utf-8')
      }
    }
    // Fallback to HTML if no plain text
    for (const part of payload.parts) {
      if (part.mimeType === 'text/html' && part.body?.data) {
        const html = Buffer.from(part.body.data, 'base64').toString('utf-8')
        // Basic HTML stripping
        return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
      }
    }
    // Recursive for nested multipart
    for (const part of payload.parts) {
      const nested = extractBody(part)
      if (nested) return nested
    }
  }

  return ''
}
```

**Step 2: Create inbox endpoint**

Create file `src/app/api/emails/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getInboxThreads } from '@/lib/gmail'

const schema = z.object({
  accountEmail: z.string().email(),
  maxResults: z.number().optional().default(20),
})

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const accountEmail = searchParams.get('accountEmail')
    const maxResults = searchParams.get('maxResults')

    const params = schema.parse({
      accountEmail,
      maxResults: maxResults ? parseInt(maxResults) : undefined,
    })

    const threads = await getInboxThreads(params.accountEmail, params.maxResults)

    return NextResponse.json({ threads })
  } catch (error) {
    console.error('Get emails error:', error)
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    }
    return NextResponse.json({ error: 'Failed to get emails' }, { status: 500 })
  }
}
```

**Step 3: Create single thread endpoint**

Create file `src/app/api/emails/[threadId]/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getThread } from '@/lib/gmail'

const schema = z.object({
  accountEmail: z.string().email(),
})

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ threadId: string }> }
) {
  try {
    const { threadId } = await params
    const searchParams = request.nextUrl.searchParams
    const accountEmail = searchParams.get('accountEmail')

    const { accountEmail: validEmail } = schema.parse({ accountEmail })

    const thread = await getThread(validEmail, threadId)

    return NextResponse.json({ thread })
  } catch (error) {
    console.error('Get thread error:', error)
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    }
    return NextResponse.json({ error: 'Failed to get thread' }, { status: 500 })
  }
}
```

**Step 4: Verify build**

```bash
npm run build
```

Expected: Build succeeds

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: add email reading endpoints (inbox list and single thread)"
```

---

## Task 8: Basic UI for Testing

**Files:**
- Modify: `src/app/page.tsx`
- Create: `src/app/globals.css` (verify Tailwind setup)

**Step 1: Create test UI**

Replace `src/app/page.tsx`:

```typescript
'use client'

import { useState } from 'react'

interface EmailThread {
  threadId: string
  subject: string
  sender: string
  snippet: string
  receivedAt: string
}

export default function Home() {
  const [email, setEmail] = useState('')
  const [threads, setThreads] = useState<EmailThread[]>([])
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')

  const handleConnect = () => {
    window.location.href = '/api/auth/gmail'
  }

  const handleFetchEmails = async () => {
    if (!email) return
    setLoading(true)
    setMessage('')
    try {
      const res = await fetch(`/api/emails?accountEmail=${encodeURIComponent(email)}`)
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setThreads(data.threads)
    } catch (err) {
      setMessage(`Error: ${err}`)
    } finally {
      setLoading(false)
    }
  }

  const handleAction = async (action: string, threadId: string) => {
    setLoading(true)
    setMessage('')
    try {
      const res = await fetch(`/api/actions/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountEmail: email, threadId }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setMessage(`${action} successful!`)
      // Remove from list
      setThreads(threads.filter(t => t.threadId !== threadId))
    } catch (err) {
      setMessage(`Error: ${err}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen p-8 max-w-2xl mx-auto">
      <h1 className="text-3xl font-bold mb-8">VoiceMail Assistant</h1>

      <div className="space-y-4 mb-8">
        <button
          onClick={handleConnect}
          className="bg-blue-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-blue-700"
        >
          Connect Gmail Account
        </button>

        <div className="flex gap-2">
          <input
            type="email"
            placeholder="Enter connected email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="flex-1 border rounded-lg px-4 py-2"
          />
          <button
            onClick={handleFetchEmails}
            disabled={loading || !email}
            className="bg-green-600 text-white px-6 py-2 rounded-lg font-medium hover:bg-green-700 disabled:opacity-50"
          >
            Fetch Emails
          </button>
        </div>
      </div>

      {message && (
        <div className="mb-4 p-4 bg-gray-100 rounded-lg">{message}</div>
      )}

      <div className="space-y-4">
        {threads.map((thread) => (
          <div key={thread.threadId} className="border rounded-lg p-4">
            <div className="font-medium">{thread.sender}</div>
            <div className="text-lg">{thread.subject}</div>
            <div className="text-gray-600 text-sm truncate">{thread.snippet}</div>
            <div className="mt-3 flex gap-2">
              <button
                onClick={() => handleAction('archive', thread.threadId)}
                className="bg-gray-200 px-3 py-1 rounded hover:bg-gray-300"
              >
                Archive
              </button>
              <button
                onClick={() => handleAction('delete', thread.threadId)}
                className="bg-red-100 px-3 py-1 rounded hover:bg-red-200"
              >
                Delete
              </button>
              <button
                onClick={() => handleAction('star', thread.threadId)}
                className="bg-yellow-100 px-3 py-1 rounded hover:bg-yellow-200"
              >
                Star
              </button>
            </div>
          </div>
        ))}
      </div>
    </main>
  )
}
```

**Step 2: Verify app runs**

```bash
npm run dev
```

Expected: App loads at http://localhost:3000 with UI

**Step 3: Commit**

```bash
git add -A
git commit -m "feat: add basic test UI for Gmail integration"
```

---

## Task 9: Google Cloud Console Setup

**This is a manual setup task.**

**Step 1: Create Google Cloud Project**

1. Go to https://console.cloud.google.com
2. Create new project: "VoiceMail Assistant"
3. Enable Gmail API in APIs & Services

**Step 2: Configure OAuth Consent Screen**

1. Go to OAuth consent screen
2. Select "External" user type
3. Fill in app name, support email
4. Add scopes: gmail.readonly, gmail.modify, gmail.send, userinfo.email
5. Add your email as test user

**Step 3: Create OAuth Credentials**

1. Go to Credentials
2. Create OAuth 2.0 Client ID
3. Application type: Web application
4. Add authorized redirect URI: `http://localhost:3000/api/auth/gmail/callback`
5. Copy Client ID and Client Secret to `.env.local`

**Step 4: Test the flow**

1. Run `npm run dev`
2. Click "Connect Gmail Account"
3. Complete OAuth flow
4. Enter email and click "Fetch Emails"
5. Test archive/delete/star buttons

---

## Task 10: Final Cleanup and Documentation

**Files:**
- Create: `CLAUDE.md`
- Update: `README.md`

**Step 1: Create project CLAUDE.md**

Create file `CLAUDE.md`:

```markdown
# VoiceMail Assistant

Voice-first PWA for triaging Superhuman email while driving.

## Stack

- **Frontend:** Next.js 14 (App Router), TypeScript, Tailwind CSS
- **Backend:** Supabase (PostgreSQL + Auth token storage)
- **Email:** Gmail API
- **Voice:** Vapi (Phase 3)
- **Superhuman:** Railway + Playwright (Phase 2)
- **Hosting:** Vercel

## Development

```bash
npm run dev     # Start dev server
npm run build   # Production build
npm run lint    # Run ESLint
```

## Environment Variables

See `.env.example` for required variables.

## Architecture

See `docs/plans/2026-01-20-voicemail-assistant-design.md`
```

**Step 2: Update README.md**

Replace `README.md`:

```markdown
# VoiceMail Assistant

A voice-first PWA for triaging your Superhuman email inbox while driving.

## Features (MVP)

- Connect Gmail account via OAuth
- Read inbox emails
- Archive, delete, star emails
- Voice commands (coming in Phase 3)

## Getting Started

1. Clone the repo
2. Copy `.env.example` to `.env.local` and fill in values
3. Run `npm install`
4. Run `npm run dev`
5. Open http://localhost:3000

## Documentation

- [Technical Design](docs/plans/2026-01-20-voicemail-assistant-design.md)
- [PRD](voicemail-assistant-prd.md)
```

**Step 3: Final commit**

```bash
git add -A
git commit -m "docs: add project documentation"
```

---

## Phase 1 Complete!

**Milestone achieved:** You can now:
- Connect a Gmail account via OAuth
- View inbox emails
- Archive, delete, and star emails via API

**Next phase:** Superhuman integration (Railway + Playwright)
