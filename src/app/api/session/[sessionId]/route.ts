import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

interface QueueItem {
  position: number
  threadId: string
  subject: string
  sender: string
  snippet: string
}

/**
 * GET /api/session/[sessionId]
 *
 * Get the status and details of a triage session
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params

    if (!sessionId) {
      return NextResponse.json(
        { error: 'Session ID required' },
        { status: 400 }
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

    const queue = session.queue_snapshot as unknown as QueueItem[]
    const currentIndex = session.current_index as number
    const currentEmail = currentIndex < queue.length ? queue[currentIndex] : null

    return NextResponse.json({
      id: session.id,
      accountEmail: session.account_email,
      status: session.status,
      currentIndex,
      totalEmails: queue.length,
      processedCount: currentIndex,
      remainingCount: queue.length - currentIndex,
      currentEmail: currentEmail ? {
        threadId: currentEmail.threadId,
        subject: currentEmail.subject,
        sender: currentEmail.sender,
        snippet: currentEmail.snippet
      } : null,
      hasVapiCall: !!session.vapi_call_id,
      startedAt: session.started_at,
      updatedAt: session.updated_at
    })
  } catch (error) {
    console.error('Get session error:', error)
    return NextResponse.json(
      { error: 'Failed to get session' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/session/[sessionId]
 *
 * Delete a triage session
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params

    if (!sessionId) {
      return NextResponse.json(
        { error: 'Session ID required' },
        { status: 400 }
      )
    }

    const supabase = createServiceClient()

    // Delete session (undo_actions will be cascade deleted due to FK)
    const { error: deleteError } = await supabase
      .from('sessions')
      .delete()
      .eq('id', sessionId)

    if (deleteError) {
      return NextResponse.json(
        { error: 'Failed to delete session' },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true, message: 'Session deleted' })
  } catch (error) {
    console.error('Delete session error:', error)
    return NextResponse.json(
      { error: 'Failed to delete session' },
      { status: 500 }
    )
  }
}
