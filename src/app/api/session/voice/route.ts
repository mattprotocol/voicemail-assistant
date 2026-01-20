import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { createWebCall } from '@/lib/vapi'
import { getThread } from '@/lib/gmail'

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
 * POST /api/session/voice
 *
 * Start a Vapi voice call for an existing triage session
 * Returns the webCallUrl that the client uses to connect
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { sessionId } = schema.parse(body)

    const assistantId = process.env.VAPI_ASSISTANT_ID
    if (!assistantId) {
      return NextResponse.json(
        { error: 'VAPI_ASSISTANT_ID not configured' },
        { status: 500 }
      )
    }

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
      return NextResponse.json(
        { error: 'Session already completed' },
        { status: 400 }
      )
    }

    // If there's already an active call, return its info
    if (session.vapi_call_id) {
      return NextResponse.json({
        callId: session.vapi_call_id,
        message: 'Voice call already active for this session'
      })
    }

    // Get current email to include in initial context
    const queue = session.queue_snapshot as unknown as QueueItem[]
    const currentIndex = session.current_index as number
    const currentEmail = currentIndex < queue.length ? queue[currentIndex] : null

    // Try to get full email content for first announcement
    let emailBody = currentEmail?.snippet || ''
    if (currentEmail) {
      try {
        const fullEmail = await getThread(session.account_email, currentEmail.threadId)
        emailBody = fullEmail.body.slice(0, 500)
      } catch {
        // Use snippet if full fetch fails
      }
    }

    // Create Vapi web call with session metadata
    const { callId, webCallUrl } = await createWebCall(assistantId, {
      sessionId,
      accountEmail: session.account_email,
      firstEmail: currentEmail ? {
        sender: currentEmail.sender,
        subject: currentEmail.subject,
        body: emailBody
      } : null,
      queueLength: queue.length,
      currentPosition: currentIndex + 1
    })

    // Update session with call ID
    await supabase
      .from('sessions')
      .update({
        vapi_call_id: callId,
        status: 'active',
        updated_at: new Date().toISOString()
      })
      .eq('id', sessionId)

    return NextResponse.json({
      success: true,
      callId,
      webCallUrl,
      currentEmail: currentEmail ? {
        sender: currentEmail.sender,
        subject: currentEmail.subject,
        snippet: currentEmail.snippet
      } : null,
      position: currentIndex + 1,
      total: queue.length
    })
  } catch (error) {
    console.error('Start voice session error:', error)
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request', details: error.issues },
        { status: 400 }
      )
    }
    return NextResponse.json(
      { error: 'Failed to start voice session', details: error instanceof Error ? error.message : 'Unknown' },
      { status: 500 }
    )
  }
}
