import { google, gmail_v1 } from 'googleapis'
import { createServiceClient } from '@/lib/supabase/server'
import type { GmailToken } from '@/types/database'

/**
 * Gmail API wrapper with automatic token refresh
 */

function getOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/api/auth/gmail/callback'
  )
}

/**
 * Fetch Gmail tokens from Supabase for a given account email
 */
export async function getTokensForAccount(accountEmail: string): Promise<GmailToken | null> {
  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('gmail_tokens')
    .select('*')
    .eq('account_email', accountEmail)
    .single()

  if (error || !data) {
    console.error('Error fetching tokens for account:', accountEmail, error)
    return null
  }

  return data
}

/**
 * Check if token is expired (with 5-minute buffer)
 */
function isTokenExpired(expiresAt: string): boolean {
  const expiryTime = new Date(expiresAt).getTime()
  const bufferMs = 5 * 60 * 1000 // 5 minutes buffer
  return Date.now() >= expiryTime - bufferMs
}

/**
 * Refresh the access token using the refresh token
 * Updates the token in Supabase and returns the new access token
 */
async function refreshAccessToken(
  accountEmail: string,
  refreshToken: string
): Promise<string | null> {
  try {
    const oauth2Client = getOAuth2Client()
    oauth2Client.setCredentials({ refresh_token: refreshToken })

    const { credentials } = await oauth2Client.refreshAccessToken()

    if (!credentials.access_token) {
      console.error('No access token in refresh response')
      return null
    }

    // Calculate new expiration time
    const expiresAt = credentials.expiry_date
      ? new Date(credentials.expiry_date).toISOString()
      : new Date(Date.now() + 3600 * 1000).toISOString()

    // Update token in Supabase
    const supabase = createServiceClient()
    const { error } = await supabase
      .from('gmail_tokens')
      .update({
        access_token: credentials.access_token,
        expires_at: expiresAt,
        // Update refresh token if a new one was provided
        ...(credentials.refresh_token && { refresh_token: credentials.refresh_token }),
      })
      .eq('account_email', accountEmail)

    if (error) {
      console.error('Error updating refreshed token:', error)
      return null
    }

    return credentials.access_token
  } catch (error) {
    console.error('Error refreshing access token:', error)
    return null
  }
}

/**
 * Get an authenticated Gmail client for a given account email
 * Automatically refreshes token if expired
 */
export async function getGmailClient(accountEmail: string): Promise<gmail_v1.Gmail | null> {
  const tokens = await getTokensForAccount(accountEmail)

  if (!tokens) {
    return null
  }

  let accessToken = tokens.access_token

  // Refresh token if expired
  if (isTokenExpired(tokens.expires_at)) {
    const newToken = await refreshAccessToken(accountEmail, tokens.refresh_token)
    if (!newToken) {
      console.error('Failed to refresh expired token for:', accountEmail)
      return null
    }
    accessToken = newToken
  }

  // Create authenticated OAuth2 client
  const oauth2Client = getOAuth2Client()
  oauth2Client.setCredentials({ access_token: accessToken })

  // Return Gmail API client
  return google.gmail({ version: 'v1', auth: oauth2Client })
}

/**
 * Gmail action functions
 */

export async function archiveThread(gmail: gmail_v1.Gmail, threadId: string): Promise<void> {
  await gmail.users.threads.modify({
    userId: 'me',
    id: threadId,
    requestBody: {
      removeLabelIds: ['INBOX'],
    },
  })
}

export async function unarchiveThread(gmail: gmail_v1.Gmail, threadId: string): Promise<void> {
  await gmail.users.threads.modify({
    userId: 'me',
    id: threadId,
    requestBody: {
      addLabelIds: ['INBOX'],
    },
  })
}

export async function deleteThread(gmail: gmail_v1.Gmail, threadId: string): Promise<void> {
  await gmail.users.threads.trash({
    userId: 'me',
    id: threadId,
  })
}

export async function undeleteThread(gmail: gmail_v1.Gmail, threadId: string): Promise<void> {
  await gmail.users.threads.untrash({
    userId: 'me',
    id: threadId,
  })
}

export async function starThread(gmail: gmail_v1.Gmail, threadId: string): Promise<void> {
  await gmail.users.threads.modify({
    userId: 'me',
    id: threadId,
    requestBody: {
      addLabelIds: ['STARRED'],
    },
  })
}

export async function unstarThread(gmail: gmail_v1.Gmail, threadId: string): Promise<void> {
  await gmail.users.threads.modify({
    userId: 'me',
    id: threadId,
    requestBody: {
      removeLabelIds: ['STARRED'],
    },
  })
}

/**
 * Check if a thread is currently starred
 */
export async function isThreadStarred(gmail: gmail_v1.Gmail, threadId: string): Promise<boolean> {
  const thread = await gmail.users.threads.get({
    userId: 'me',
    id: threadId,
    format: 'minimal',
  })

  // Check if any message in the thread has STARRED label
  const messages = thread.data.messages || []
  return messages.some(msg => msg.labelIds?.includes('STARRED'))
}

/**
 * Email thread interface for inbox listing
 */
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

/**
 * Extract plain text body from message payload
 */
function extractBody(payload: gmail_v1.Schema$MessagePart | undefined): string {
  if (!payload) return ''

  // Direct body data
  if (payload.body?.data) {
    return Buffer.from(payload.body.data, 'base64').toString('utf-8')
  }

  // Check parts for text content
  if (payload.parts) {
    // First try text/plain
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        return Buffer.from(part.body.data, 'base64').toString('utf-8')
      }
    }
    // Then try text/html and strip tags
    for (const part of payload.parts) {
      if (part.mimeType === 'text/html' && part.body?.data) {
        const html = Buffer.from(part.body.data, 'base64').toString('utf-8')
        return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
      }
    }
    // Recurse into nested parts
    for (const part of payload.parts) {
      const nested = extractBody(part)
      if (nested) return nested
    }
  }

  return ''
}

/**
 * Get inbox threads for an account
 */
export async function getInboxThreads(
  accountEmail: string,
  maxResults = 20
): Promise<EmailThread[]> {
  const gmail = await getGmailClient(accountEmail)
  if (!gmail) {
    throw new Error(`No Gmail client available for ${accountEmail}`)
  }

  const response = await gmail.users.threads.list({
    userId: 'me',
    labelIds: ['INBOX'],
    maxResults,
  })

  const threads = response.data.threads || []
  const results: EmailThread[] = []

  for (const thread of threads) {
    if (!thread.id) continue

    const full = await gmail.users.threads.get({
      userId: 'me',
      id: thread.id,
      format: 'full',
    })

    // Get the latest message in the thread
    const messages = full.data.messages || []
    const msg = messages[messages.length - 1]
    if (!msg) continue

    const headers = msg.payload?.headers || []
    const subject = headers.find(h => h.name === 'Subject')?.value || '(no subject)'
    const from = headers.find(h => h.name === 'From')?.value || ''
    const date = headers.find(h => h.name === 'Date')?.value || ''

    // Parse sender name and email
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

/**
 * Get a single thread by ID
 */
export async function getThread(
  accountEmail: string,
  threadId: string
): Promise<EmailThread> {
  const gmail = await getGmailClient(accountEmail)
  if (!gmail) {
    throw new Error(`No Gmail client available for ${accountEmail}`)
  }

  const full = await gmail.users.threads.get({
    userId: 'me',
    id: threadId,
    format: 'full',
  })

  const messages = full.data.messages || []
  const msg = messages[messages.length - 1]
  if (!msg) throw new Error('No messages in thread')

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
