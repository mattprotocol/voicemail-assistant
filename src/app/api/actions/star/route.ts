import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { getGmailClient, starThread, unstarThread, isThreadStarred } from '@/lib/gmail'
import type { UndoActionInsert, ActionType } from '@/types/database'

const RequestSchema = z.object({
  threadId: z.string().min(1, 'threadId is required'),
  accountEmail: z.string().email().optional(),
  action: z.enum(['star', 'unstar', 'toggle']).optional().default('toggle'),
})

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const parseResult = RequestSchema.safeParse(body)

    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parseResult.error.issues },
        { status: 400 }
      )
    }

    const { threadId, accountEmail: providedEmail, action } = parseResult.data

    // Get account email from request body or cookie
    let accountEmail = providedEmail
    if (!accountEmail) {
      const cookieStore = await cookies()
      accountEmail = cookieStore.get('gmail_account')?.value
    }

    if (!accountEmail) {
      return NextResponse.json(
        { error: 'No account email provided and none found in cookies' },
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

    // Determine whether to star or unstar
    let shouldStar: boolean
    if (action === 'toggle') {
      const currentlyStarred = await isThreadStarred(gmail, threadId)
      shouldStar = !currentlyStarred
    } else {
      shouldStar = action === 'star'
    }

    // Execute star/unstar action
    if (shouldStar) {
      await starThread(gmail, threadId)
    } else {
      await unstarThread(gmail, threadId)
    }

    // Store undo action in database
    const supabase = createServiceClient()
    const expiresAt = new Date(Date.now() + 15 * 1000).toISOString() // 15 seconds from now

    const undoAction: UndoActionInsert = {
      gmail_thread_id: threadId,
      action_type: 'star' as ActionType,
      reverse_action: {
        type: shouldStar ? 'unstar' : 'star',
        removeLabelIds: shouldStar ? ['STARRED'] : undefined,
        addLabelIds: shouldStar ? undefined : ['STARRED'],
      },
      expires_at: expiresAt,
    }

    const { error: undoError } = await supabase
      .from('undo_actions')
      .insert(undoAction)

    if (undoError) {
      console.error('Error storing undo action:', undoError)
      // Don't fail the request, just log the error
    }

    return NextResponse.json({
      success: true,
      message: shouldStar ? 'Thread starred successfully' : 'Thread unstarred successfully',
      threadId,
      starred: shouldStar,
      undoAvailableUntil: expiresAt,
    })
  } catch (error) {
    console.error('Star action error:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json(
      { error: 'Failed to star/unstar thread', details: message },
      { status: 500 }
    )
  }
}
