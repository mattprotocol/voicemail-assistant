import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { z } from 'zod'
import { getGmailClient } from '@/lib/gmail'
import type { gmail_v1 } from 'googleapis'

/**
 * Query params schema
 */
const QuerySchema = z.object({
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
 * Decode base64url encoded string to UTF-8 text
 */
function decodeBase64Url(data: string): string {
  // Replace URL-safe characters and decode
  const base64 = data.replace(/-/g, '+').replace(/_/g, '/')
  const decoded = Buffer.from(base64, 'base64').toString('utf-8')
  return decoded
}

/**
 * Extract body content from a message part
 * Handles multipart messages recursively
 */
function extractBody(
  payload: gmail_v1.Schema$MessagePart | undefined
): { html: string | null; plain: string | null } {
  const result = { html: null as string | null, plain: null as string | null }

  if (!payload) return result

  // If the body has data directly
  if (payload.body?.data) {
    const mimeType = payload.mimeType || ''
    const decoded = decodeBase64Url(payload.body.data)

    if (mimeType === 'text/html') {
      result.html = decoded
    } else if (mimeType === 'text/plain') {
      result.plain = decoded
    }
    return result
  }

  // If there are parts, recurse into them
  if (payload.parts && payload.parts.length > 0) {
    for (const part of payload.parts) {
      const partResult = extractBody(part)
      if (partResult.html && !result.html) result.html = partResult.html
      if (partResult.plain && !result.plain) result.plain = partResult.plain

      // If we have both, we can stop
      if (result.html && result.plain) break
    }
  }

  return result
}

/**
 * Parse a Gmail message into a structured format
 */
function parseMessage(message: gmail_v1.Schema$Message) {
  const headers = message.payload?.headers
  const body = extractBody(message.payload)

  return {
    id: message.id || '',
    threadId: message.threadId || '',
    from: getHeader(headers, 'From') || 'Unknown',
    to: getHeader(headers, 'To') || '',
    cc: getHeader(headers, 'Cc') || null,
    subject: getHeader(headers, 'Subject') || '(no subject)',
    date: getHeader(headers, 'Date') || '',
    snippet: message.snippet || '',
    labels: message.labelIds || [],
    body: {
      html: body.html,
      plain: body.plain,
    },
  }
}

/**
 * GET /api/emails/thread/[threadId]
 * Fetch full thread content with all messages
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ threadId: string }> }
) {
  try {
    const { threadId } = await params
    const { searchParams } = new URL(request.url)

    // Validate threadId
    if (!threadId || threadId.length === 0) {
      return NextResponse.json(
        { error: 'Thread ID is required' },
        { status: 400 }
      )
    }

    // Parse and validate query parameters
    const parseResult = QuerySchema.safeParse({
      account: searchParams.get('account') ?? undefined,
    })

    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'Invalid query parameters', details: parseResult.error.issues },
        { status: 400 }
      )
    }

    const { account: providedAccount } = parseResult.data

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

    // Fetch thread with full message content
    const threadResponse = await gmail.users.threads.get({
      userId: 'me',
      id: threadId,
      format: 'full',
    })

    const thread = threadResponse.data

    if (!thread || !thread.messages) {
      return NextResponse.json(
        { error: 'Thread not found' },
        { status: 404 }
      )
    }

    // Parse all messages in the thread
    const messages = thread.messages.map(parseMessage)

    // Get thread-level metadata from first message
    const firstMessage = messages[0]

    return NextResponse.json({
      id: thread.id || threadId,
      historyId: thread.historyId || null,
      subject: firstMessage?.subject || '(no subject)',
      messageCount: messages.length,
      messages,
    })
  } catch (error) {
    console.error('Thread fetch error:', error)

    // Handle specific Gmail API errors
    if (error instanceof Error) {
      if (error.message.includes('Not Found') || error.message.includes('404')) {
        return NextResponse.json(
          { error: 'Thread not found' },
          { status: 404 }
        )
      }
    }

    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json(
      { error: 'Failed to fetch thread', details: message },
      { status: 500 }
    )
  }
}
