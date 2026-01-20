import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import {
  getGmailClient,
  unarchiveThread,
  undeleteThread,
  starThread,
  unstarThread,
} from '@/lib/gmail'

const RequestSchema = z.object({
  threadId: z.string().min(1, 'threadId is required'),
  accountEmail: z.string().email().optional(),
})

// Type for the reverse action stored in the database
interface ReverseAction {
  type: 'unarchive' | 'undelete' | 'star' | 'unstar'
  addLabelIds?: string[]
  removeLabelIds?: string[]
}

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

    const { threadId, accountEmail: providedEmail } = parseResult.data

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

    // Check if there's a valid (non-expired) undo action for this thread
    const supabase = createServiceClient()
    const now = new Date().toISOString()

    const { data: undoAction, error: fetchError } = await supabase
      .from('undo_actions')
      .select('*')
      .eq('gmail_thread_id', threadId)
      .gt('expires_at', now)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    if (fetchError || !undoAction) {
      return NextResponse.json(
        { error: 'No undo action available for this thread. The undo window may have expired.' },
        { status: 404 }
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

    // Execute the reverse action
    const reverseAction = undoAction.reverse_action as unknown as ReverseAction

    switch (reverseAction.type) {
      case 'unarchive':
        await unarchiveThread(gmail, threadId)
        break
      case 'undelete':
        await undeleteThread(gmail, threadId)
        break
      case 'star':
        await starThread(gmail, threadId)
        break
      case 'unstar':
        await unstarThread(gmail, threadId)
        break
      default:
        return NextResponse.json(
          { error: `Unknown reverse action type: ${reverseAction.type}` },
          { status: 400 }
        )
    }

    // Delete the undo record after successful execution
    const { error: deleteError } = await supabase
      .from('undo_actions')
      .delete()
      .eq('id', undoAction.id)

    if (deleteError) {
      console.error('Error deleting undo action record:', deleteError)
      // Don't fail the request, the undo was successful
    }

    return NextResponse.json({
      success: true,
      message: `Successfully undid ${undoAction.action_type} action`,
      threadId,
      undoneAction: undoAction.action_type,
    })
  } catch (error) {
    console.error('Undo action error:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json(
      { error: 'Failed to undo action', details: message },
      { status: 500 }
    )
  }
}
