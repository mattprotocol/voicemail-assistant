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
