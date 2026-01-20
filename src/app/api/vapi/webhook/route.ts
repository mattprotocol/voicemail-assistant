import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import {
  getGmailClient,
  archiveThread,
  deleteThread,
  starThread,
  getThread,
  type EmailThread
} from '@/lib/gmail'
import {
  verifyWebhookSignature,
  type VapiWebhookMessage,
  type VapiToolCallMessage,
  type VapiWebhookResponse,
  type VapiToolResult
} from '@/lib/vapi'

// Type for queue item stored in session
interface QueueItem {
  position: number
  threadId: string
  subject: string
  sender: string
  snippet: string
}

// Type for session data
interface SessionData {
  id: string
  account_email: string
  status: string
  queue_snapshot: QueueItem[]
  current_index: number
  vapi_call_id?: string
  last_action_thread_id?: string
}

/**
 * Vapi Webhook Handler
 *
 * Handles incoming webhook events from Vapi, including:
 * - tool-calls: Execute email actions (archive, delete, star, etc.)
 * - status-update: Track call status changes
 * - end-of-call-report: Handle call completion
 */
export async function POST(request: NextRequest) {
  try {
    // Get raw body for signature verification
    const rawBody = await request.text()
    const signature = request.headers.get('x-vapi-signature') ||
                      request.headers.get('vapi-webhook-signature') || ''

    // Verify webhook signature
    const webhookSecret = process.env.VAPI_WEBHOOK_SECRET
    if (webhookSecret && !verifyWebhookSignature(rawBody, signature, webhookSecret)) {
      console.error('Invalid webhook signature')
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }

    // Parse the message
    const message: VapiWebhookMessage = JSON.parse(rawBody)
    console.log('Vapi webhook received:', message.type)

    // Handle different message types
    switch (message.type) {
      case 'tool-calls':
        return handleToolCalls(message as VapiToolCallMessage)

      case 'status-update':
        return handleStatusUpdate(message)

      case 'end-of-call-report':
        return handleEndOfCallReport(message)

      case 'assistant-request':
        // Return assistant configuration if needed
        return NextResponse.json({ received: true })

      default:
        console.log('Unhandled message type:', message.type)
        return NextResponse.json({ received: true })
    }
  } catch (error) {
    console.error('Webhook error:', error)
    return NextResponse.json(
      { error: 'Webhook processing failed' },
      { status: 500 }
    )
  }
}

/**
 * Handle tool-calls message from Vapi
 */
async function handleToolCalls(message: VapiToolCallMessage): Promise<NextResponse<VapiWebhookResponse>> {
  const results: VapiToolResult[] = []
  let spokenMessage = ''

  // Get session from call metadata
  const sessionId = (message.call as { metadata?: { sessionId?: string } })?.metadata?.sessionId
  if (!sessionId) {
    return NextResponse.json({
      results: [],
      spokenMessage: "I'm sorry, I couldn't find your session. Please restart the triage session."
    })
  }

  // Get session data
  const supabase = createServiceClient()
  const { data: session, error: sessionError } = await supabase
    .from('sessions')
    .select('*')
    .eq('id', sessionId)
    .single()

  if (sessionError || !session) {
    return NextResponse.json({
      results: [],
      spokenMessage: "I couldn't find your session. Please restart."
    })
  }

  const sessionData = session as unknown as SessionData
  const queue = sessionData.queue_snapshot as unknown as QueueItem[]
  const currentIndex = sessionData.current_index

  // Process each tool call
  const toolCalls = message.toolCallList ||
    message.toolWithToolCallList?.map(t => t.toolCall) || []

  for (const toolCall of toolCalls) {
    const result = await processToolCall(
      toolCall.name,
      sessionData,
      queue,
      currentIndex,
      supabase
    )

    results.push({
      name: toolCall.name,
      toolCallId: toolCall.id,
      result: JSON.stringify(result.data)
    })

    // Build spoken message
    if (result.message) {
      spokenMessage = result.message
    }
  }

  return NextResponse.json({ results, spokenMessage })
}

/**
 * Process a single tool call
 */
async function processToolCall(
  functionName: string,
  session: SessionData,
  queue: QueueItem[],
  currentIndex: number,
  supabase: ReturnType<typeof createServiceClient>
): Promise<{ data: Record<string, unknown>; message: string }> {
  const currentEmail = queue[currentIndex]
  const accountEmail = session.account_email

  try {
    switch (functionName) {
      case 'archive_email':
        return await handleArchive(session, currentEmail, accountEmail, supabase)

      case 'delete_email':
        return await handleDelete(session, currentEmail, accountEmail, supabase)

      case 'star_email':
        return await handleStar(session, currentEmail, accountEmail, supabase)

      case 'skip_email':
        return await handleSkip(session, queue, currentIndex, supabase)

      case 'undo_action':
        return await handleUndo(session, accountEmail, supabase)

      case 'get_remaining_count':
        return handleGetRemainingCount(queue, currentIndex)

      case 'end_session':
        return await handleEndSession(session, supabase)

      case 'get_current_email':
        return await handleGetCurrentEmail(currentEmail, accountEmail)

      default:
        return {
          data: { error: 'Unknown function' },
          message: "I don't understand that command. You can say archive, delete, star, skip, or undo."
        }
    }
  } catch (error) {
    console.error(`Error processing ${functionName}:`, error)
    return {
      data: { error: 'Action failed' },
      message: "I'm sorry, that action failed. Please try again."
    }
  }
}

/**
 * Archive the current email and move to next
 */
async function handleArchive(
  session: SessionData,
  currentEmail: QueueItem,
  accountEmail: string,
  supabase: ReturnType<typeof createServiceClient>
): Promise<{ data: Record<string, unknown>; message: string }> {
  if (!currentEmail) {
    return {
      data: { success: false },
      message: "You've reached the end of your inbox. Nice work!"
    }
  }

  const gmail = await getGmailClient(accountEmail)
  if (!gmail) {
    return {
      data: { success: false },
      message: "I couldn't connect to your email. Please try again."
    }
  }

  await archiveThread(gmail, currentEmail.threadId)

  // Store undo action
  await storeUndoAction(supabase, session.id, 'archive', currentEmail.threadId, { type: 'unarchive' })

  // Move to next email
  const nextResult = await moveToNextEmail(session, supabase)

  return {
    data: { success: true, action: 'archive', threadId: currentEmail.threadId },
    message: nextResult.message
      ? `Archived. ${nextResult.message}`
      : `Archived. ${nextResult.nextEmail ? `Next email from ${nextResult.nextEmail.sender}. Subject: ${nextResult.nextEmail.subject}. ${nextResult.nextEmail.snippet}` : "You've reached the end of your inbox. Nice work!"}`
  }
}

/**
 * Delete the current email and move to next
 */
async function handleDelete(
  session: SessionData,
  currentEmail: QueueItem,
  accountEmail: string,
  supabase: ReturnType<typeof createServiceClient>
): Promise<{ data: Record<string, unknown>; message: string }> {
  if (!currentEmail) {
    return {
      data: { success: false },
      message: "You've reached the end of your inbox."
    }
  }

  const gmail = await getGmailClient(accountEmail)
  if (!gmail) {
    return {
      data: { success: false },
      message: "I couldn't connect to your email. Please try again."
    }
  }

  await deleteThread(gmail, currentEmail.threadId)

  // Store undo action
  await storeUndoAction(supabase, session.id, 'delete', currentEmail.threadId, { type: 'undelete' })

  // Move to next email
  const nextResult = await moveToNextEmail(session, supabase)

  return {
    data: { success: true, action: 'delete', threadId: currentEmail.threadId },
    message: nextResult.message
      ? `Deleted. ${nextResult.message}`
      : `Deleted. ${nextResult.nextEmail ? `Next email from ${nextResult.nextEmail.sender}. Subject: ${nextResult.nextEmail.subject}. ${nextResult.nextEmail.snippet}` : "You've reached the end of your inbox. Nice work!"}`
  }
}

/**
 * Star the current email and move to next
 */
async function handleStar(
  session: SessionData,
  currentEmail: QueueItem,
  accountEmail: string,
  supabase: ReturnType<typeof createServiceClient>
): Promise<{ data: Record<string, unknown>; message: string }> {
  if (!currentEmail) {
    return {
      data: { success: false },
      message: "You've reached the end of your inbox."
    }
  }

  const gmail = await getGmailClient(accountEmail)
  if (!gmail) {
    return {
      data: { success: false },
      message: "I couldn't connect to your email. Please try again."
    }
  }

  await starThread(gmail, currentEmail.threadId)

  // Store undo action
  await storeUndoAction(supabase, session.id, 'star', currentEmail.threadId, { type: 'unstar' })

  // Move to next email
  const nextResult = await moveToNextEmail(session, supabase)

  return {
    data: { success: true, action: 'star', threadId: currentEmail.threadId },
    message: nextResult.message
      ? `Starred for later. ${nextResult.message}`
      : `Starred for later. ${nextResult.nextEmail ? `Next email from ${nextResult.nextEmail.sender}. Subject: ${nextResult.nextEmail.subject}. ${nextResult.nextEmail.snippet}` : "You've reached the end of your inbox. Nice work!"}`
  }
}

/**
 * Skip the current email and move to next
 */
async function handleSkip(
  session: SessionData,
  queue: QueueItem[],
  currentIndex: number,
  supabase: ReturnType<typeof createServiceClient>
): Promise<{ data: Record<string, unknown>; message: string }> {
  const nextResult = await moveToNextEmail(session, supabase)

  return {
    data: { success: true, action: 'skip' },
    message: nextResult.message
      ? `Skipped. ${nextResult.message}`
      : `Skipped. ${nextResult.nextEmail ? `Next email from ${nextResult.nextEmail.sender}. Subject: ${nextResult.nextEmail.subject}. ${nextResult.nextEmail.snippet}` : "You've reached the end of your inbox. Nice work!"}`
  }
}

/**
 * Undo the last action
 */
async function handleUndo(
  session: SessionData,
  accountEmail: string,
  supabase: ReturnType<typeof createServiceClient>
): Promise<{ data: Record<string, unknown>; message: string }> {
  // Get the most recent undo action
  const now = new Date().toISOString()
  const { data: undoAction } = await supabase
    .from('undo_actions')
    .select('*')
    .eq('session_id', session.id)
    .gt('expires_at', now)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (!undoAction) {
    return {
      data: { success: false },
      message: "Nothing to undo. The undo window may have expired."
    }
  }

  // Execute the reverse action
  const gmail = await getGmailClient(accountEmail)
  if (!gmail) {
    return {
      data: { success: false },
      message: "I couldn't connect to your email to undo."
    }
  }

  const reverseAction = undoAction.reverse_action as { type: string }
  const { unarchiveThread, undeleteThread, unstarThread } = await import('@/lib/gmail')

  switch (reverseAction.type) {
    case 'unarchive':
      await unarchiveThread(gmail, undoAction.gmail_thread_id)
      break
    case 'undelete':
      await undeleteThread(gmail, undoAction.gmail_thread_id)
      break
    case 'unstar':
      await unstarThread(gmail, undoAction.gmail_thread_id)
      break
  }

  // Delete the undo record
  await supabase.from('undo_actions').delete().eq('id', undoAction.id)

  // Move back to that email
  const queue = session.queue_snapshot as unknown as QueueItem[]
  const emailIndex = queue.findIndex(e => e.threadId === undoAction.gmail_thread_id)

  if (emailIndex >= 0) {
    await supabase
      .from('sessions')
      .update({ current_index: emailIndex })
      .eq('id', session.id)
  }

  return {
    data: { success: true, undoneAction: undoAction.action_type },
    message: `Undone. I've reversed the ${undoAction.action_type} action. Let me re-read that email.`
  }
}

/**
 * Get remaining email count
 */
function handleGetRemainingCount(
  queue: QueueItem[],
  currentIndex: number
): { data: Record<string, unknown>; message: string } {
  const remaining = queue.length - currentIndex

  return {
    data: { remaining, total: queue.length, current: currentIndex + 1 },
    message: remaining === 0
      ? "You've processed all your emails. Nice work!"
      : remaining === 1
        ? "You have 1 email left."
        : `You have ${remaining} emails remaining out of ${queue.length} total.`
  }
}

/**
 * End the triage session
 */
async function handleEndSession(
  session: SessionData,
  supabase: ReturnType<typeof createServiceClient>
): Promise<{ data: Record<string, unknown>; message: string }> {
  await supabase
    .from('sessions')
    .update({ status: 'completed' })
    .eq('id', session.id)

  const queue = session.queue_snapshot as unknown as QueueItem[]
  const processed = session.current_index
  const remaining = queue.length - processed

  return {
    data: { success: true, processed, remaining },
    message: remaining > 0
      ? `Session ended. You processed ${processed} emails with ${remaining} remaining. See you next time!`
      : `Session complete! You processed all ${processed} emails. Great job!`
  }
}

/**
 * Get current email details
 */
async function handleGetCurrentEmail(
  currentEmail: QueueItem,
  accountEmail: string
): Promise<{ data: Record<string, unknown>; message: string }> {
  if (!currentEmail) {
    return {
      data: { email: null },
      message: "You've reached the end of your inbox. Say 'stop' to end the session."
    }
  }

  // Get full email content
  let fullEmail: EmailThread | null = null
  try {
    fullEmail = await getThread(accountEmail, currentEmail.threadId)
  } catch {
    // Use cached info if fetch fails
  }

  const email = fullEmail || currentEmail

  return {
    data: { email },
    message: `Email from ${email.sender}. Subject: ${email.subject}. ${'body' in email && email.body ? email.body.slice(0, 500) : email.snippet}`
  }
}

/**
 * Move to the next email in the queue
 */
async function moveToNextEmail(
  session: SessionData,
  supabase: ReturnType<typeof createServiceClient>
): Promise<{ nextEmail: QueueItem | null; message?: string }> {
  const queue = session.queue_snapshot as unknown as QueueItem[]
  const nextIndex = session.current_index + 1

  if (nextIndex >= queue.length) {
    // End of queue
    await supabase
      .from('sessions')
      .update({ current_index: nextIndex, status: 'completed' })
      .eq('id', session.id)

    return { nextEmail: null, message: "You've reached the end of your inbox. Nice work!" }
  }

  // Update current index
  await supabase
    .from('sessions')
    .update({ current_index: nextIndex })
    .eq('id', session.id)

  return { nextEmail: queue[nextIndex] }
}

/**
 * Store an undo action in the database
 */
async function storeUndoAction(
  supabase: ReturnType<typeof createServiceClient>,
  sessionId: string,
  actionType: string,
  threadId: string,
  reverseAction: { type: string }
) {
  const expiresAt = new Date(Date.now() + 15 * 1000).toISOString() // 15 second window

  await supabase.from('undo_actions').insert({
    session_id: sessionId,
    action_type: actionType,
    gmail_thread_id: threadId,
    reverse_action: reverseAction,
    expires_at: expiresAt
  })
}

/**
 * Handle status update from Vapi
 */
async function handleStatusUpdate(message: VapiWebhookMessage): Promise<NextResponse> {
  const status = (message as { status?: string }).status
  console.log('Call status update:', status)

  // Could update session status based on call status
  return NextResponse.json({ received: true })
}

/**
 * Handle end of call report from Vapi
 */
async function handleEndOfCallReport(message: VapiWebhookMessage): Promise<NextResponse> {
  const callMessage = message as {
    call?: { metadata?: { sessionId?: string } }
    endedReason?: string
  }

  const sessionId = callMessage.call?.metadata?.sessionId
  if (sessionId) {
    const supabase = createServiceClient()
    await supabase
      .from('sessions')
      .update({ status: 'paused', vapi_call_id: null })
      .eq('id', sessionId)
  }

  console.log('Call ended:', callMessage.endedReason)
  return NextResponse.json({ received: true })
}
