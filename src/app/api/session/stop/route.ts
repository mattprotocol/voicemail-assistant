import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { endCall } from '@/lib/vapi'

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
 * POST /api/session/stop
 *
 * Stop/pause the current triage session
 * Optionally ends the associated Vapi call
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

    // If there's an active Vapi call, end it
    if (session.vapi_call_id) {
      try {
        await endCall(session.vapi_call_id)
      } catch (error) {
        console.error('Error ending Vapi call:', error)
        // Continue even if call end fails
      }
    }

    // Update session status
    const { error: updateError } = await supabase
      .from('sessions')
      .update({
        status: 'paused',
        vapi_call_id: null,
        updated_at: new Date().toISOString()
      })
      .eq('id', sessionId)

    if (updateError) {
      return NextResponse.json(
        { error: 'Failed to update session' },
        { status: 500 }
      )
    }

    const queue = session.queue_snapshot as unknown as QueueItem[]
    const currentIndex = session.current_index as number

    return NextResponse.json({
      success: true,
      message: 'Session paused',
      stats: {
        total: queue.length,
        processed: currentIndex,
        remaining: queue.length - currentIndex
      }
    })
  } catch (error) {
    console.error('Stop session error:', error)
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request', details: error.issues },
        { status: 400 }
      )
    }
    return NextResponse.json(
      { error: 'Failed to stop session' },
      { status: 500 }
    )
  }
}
