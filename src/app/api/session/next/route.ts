import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { getThread, type EmailThread } from '@/lib/gmail'

const schema = z.object({
  sessionId: z.string().uuid()
})

interface QueueItem {
  position: number
  threadId: string
  subject: string
  sender: string
  snippet: string
}

/**
 * GET /api/session/next
 *
 * Get the next email in the triage queue
 * Used by the UI or voice assistant to fetch email details
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { sessionId } = schema.parse(body)

    const supabase = createServiceClient()

    // Get session
    const { data: session, error: sessionError } = await supabase
      .from('sessions')
      .select('*')
      .eq('id', sessionId)
      .single()

    if (sessionError || !session) {
      return NextResponse.json(
        { error: 'Session not found' },
        { status: 404 }
      )
    }

    if (session.status === 'completed') {
      return NextResponse.json({
        complete: true,
        message: "You've processed all emails in this session."
      })
    }

    const queue = session.queue_snapshot as unknown as QueueItem[]
    const currentIndex = session.current_index as number

    // Check if we've reached the end
    if (currentIndex >= queue.length) {
      // Mark session complete
      await supabase
        .from('sessions')
        .update({ status: 'completed' })
        .eq('id', sessionId)

      return NextResponse.json({
        complete: true,
        message: "You've processed all emails in this session.",
        stats: {
          total: queue.length,
          processed: currentIndex
        }
      })
    }

    const currentEmail = queue[currentIndex]

    // Try to get full email content
    let fullEmail: EmailThread | null = null
    try {
      fullEmail = await getThread(session.account_email, currentEmail.threadId)
    } catch (error) {
      console.error('Error fetching full email:', error)
      // Continue with cached snippet
    }

    return NextResponse.json({
      complete: false,
      email: {
        threadId: currentEmail.threadId,
        subject: currentEmail.subject,
        sender: currentEmail.sender,
        snippet: currentEmail.snippet,
        body: fullEmail?.body || currentEmail.snippet,
        senderEmail: fullEmail?.senderEmail,
        receivedAt: fullEmail?.receivedAt,
        isUnread: fullEmail?.isUnread
      },
      position: currentIndex + 1,
      total: queue.length,
      remaining: queue.length - currentIndex
    })
  } catch (error) {
    console.error('Get next email error:', error)
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request', details: error.issues },
        { status: 400 }
      )
    }
    return NextResponse.json(
      { error: 'Failed to get next email' },
      { status: 500 }
    )
  }
}
