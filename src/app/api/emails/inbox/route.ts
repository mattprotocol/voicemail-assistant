import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { z } from 'zod'
import { getGmailClient } from '@/lib/gmail'
import type { gmail_v1 } from 'googleapis'

/**
 * Query params schema for inbox listing
 */
const QuerySchema = z.object({
  maxResults: z.coerce.number().min(1).max(100).default(20),
  pageToken: z.string().optional(),
  account: z.string().email().optional(),
})

/**
 * Extract header value from Gmail message headers
 */
function getHeader(
  headers: gmail_v1.Schema$MessagePartHeader[] | undefined,
  name: string
): string | undefined {
  const value = headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value
  return value ?? undefined
}

/**
 * GET /api/emails/inbox
 * List inbox threads with pagination
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)

    // Parse and validate query parameters
    const parseResult = QuerySchema.safeParse({
      maxResults: searchParams.get('maxResults') ?? 20,
      pageToken: searchParams.get('pageToken') ?? undefined,
      account: searchParams.get('account') ?? undefined,
    })

    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'Invalid query parameters', details: parseResult.error.issues },
        { status: 400 }
      )
    }

    const { maxResults, pageToken, account: providedAccount } = parseResult.data

    // Get account email from query param or cookie
    let accountEmail = providedAccount
    if (!accountEmail) {
      const cookieStore = await cookies()
      accountEmail = cookieStore.get('gmail_account')?.value
    }

    if (!accountEmail) {
      return NextResponse.json(
        { error: 'No account email provided. Set account query param or gmail_account cookie.' },
        { status: 401 }
      )
    }

    // Get authenticated Gmail client
    const gmail = await getGmailClient(accountEmail)
    if (!gmail) {
      return NextResponse.json(
        { error: 'Failed to authenticate with Gmail. Please reconnect your account.' },
        { status: 401 }
      )
    }

    // List threads from inbox
    const threadsResponse = await gmail.users.threads.list({
      userId: 'me',
      labelIds: ['INBOX'],
      maxResults,
      pageToken: pageToken || undefined,
    })

    const threads = threadsResponse.data.threads || []
    const nextPageToken = threadsResponse.data.nextPageToken

    // Fetch metadata for each thread (first message only for efficiency)
    const threadDetails = await Promise.all(
      threads.map(async (thread) => {
        if (!thread.id) return null

        try {
          // Get thread with metadata format (headers only, no body)
          const threadData = await gmail.users.threads.get({
            userId: 'me',
            id: thread.id,
            format: 'metadata',
            metadataHeaders: ['From', 'Subject', 'Date'],
          })

          const messages = threadData.data.messages || []
          const firstMessage = messages[0]
          const lastMessage = messages[messages.length - 1]
          const headers = firstMessage?.payload?.headers

          return {
            id: thread.id,
            snippet: thread.snippet || '',
            from: getHeader(headers, 'From') || 'Unknown',
            subject: getHeader(headers, 'Subject') || '(no subject)',
            date: getHeader(lastMessage?.payload?.headers, 'Date') || '',
            labels: firstMessage?.labelIds || [],
            messageCount: messages.length,
          }
        } catch (error) {
          console.error(`Error fetching thread ${thread.id}:`, error)
          return null
        }
      })
    )

    // Filter out any failed thread fetches
    const validThreads = threadDetails.filter((t) => t !== null)

    return NextResponse.json({
      threads: validThreads,
      nextPageToken: nextPageToken || null,
      resultSizeEstimate: threadsResponse.data.resultSizeEstimate || 0,
    })
  } catch (error) {
    console.error('Inbox fetch error:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json(
      { error: 'Failed to fetch inbox', details: message },
      { status: 500 }
    )
  }
}
