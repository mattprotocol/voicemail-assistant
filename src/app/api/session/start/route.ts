import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { z } from 'zod'
import { getInboxThreads } from '@/lib/gmail'
import { scrapeInbox, mapThreads, getSessionStatus } from '@/lib/railway'
import { createServiceClient } from '@/lib/supabase/server'

const schema = z.object({
  accountEmail: z.string().email().optional()
})

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { accountEmail: bodyEmail } = schema.parse(body)

    // Get account email from body or cookie
    const cookieStore = await cookies()
    const cookieEmail = cookieStore.get('gmail_account')?.value
    const accountEmail = bodyEmail || cookieEmail

    if (!accountEmail) {
      return NextResponse.json(
        { error: 'No account email provided. Please connect Gmail first.' },
        { status: 400 }
      )
    }

    // Check if Railway service has a valid Superhuman session
    let railwayStatus
    try {
      railwayStatus = await getSessionStatus(accountEmail)
    } catch {
      return NextResponse.json(
        { error: 'Railway service unavailable. Please try again later.' },
        { status: 503 }
      )
    }

    if (!railwayStatus.hasSession) {
      return NextResponse.json(
        {
          error: 'No Superhuman session found',
          needsLogin: true,
          message: 'Please log into Superhuman first via the Railway service'
        },
        { status: 401 }
      )
    }

    // Step 1: Get Gmail inbox threads
    let gmailThreads
    try {
      gmailThreads = await getInboxThreads(accountEmail, 20)
    } catch (error) {
      return NextResponse.json(
        { error: 'Failed to fetch Gmail inbox', details: error instanceof Error ? error.message : 'Unknown' },
        { status: 500 }
      )
    }

    // Step 2: Scrape Superhuman inbox order
    let superhumanResult
    try {
      superhumanResult = await scrapeInbox(accountEmail)
    } catch (error) {
      return NextResponse.json(
        { error: 'Failed to scrape Superhuman', details: error instanceof Error ? error.message : 'Unknown' },
        { status: 500 }
      )
    }

    // Step 3: Map Superhuman order to Gmail thread IDs
    const mappingResult = await mapThreads(
      superhumanResult.threads,
      gmailThreads.map(t => ({
        threadId: t.threadId,
        subject: t.subject,
        sender: t.sender,
        senderEmail: t.senderEmail,
        snippet: t.snippet,
        receivedAt: t.receivedAt
      }))
    )

    // Step 4: Create a triage session in Supabase
    const supabase = createServiceClient()
    const queueSnapshot = mappingResult.orderedGmailIds.map((threadId, index) => {
      const gmailThread = gmailThreads.find(t => t.threadId === threadId)
      return {
        position: index,
        threadId,
        subject: gmailThread?.subject || '',
        sender: gmailThread?.sender || '',
        snippet: gmailThread?.snippet || ''
      }
    })

    const { data: session, error: sessionError } = await supabase
      .from('sessions')
      .insert({
        account_email: accountEmail,
        status: 'active',
        queue_snapshot: queueSnapshot,
        current_index: 0
      })
      .select()
      .single()

    if (sessionError) {
      return NextResponse.json(
        { error: 'Failed to create session', details: sessionError.message },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      sessionId: session.id,
      queueLength: queueSnapshot.length,
      mappingStats: {
        totalSuperhuman: mappingResult.totalSuperhuman,
        successfulMappings: mappingResult.successfulMappings,
        unmappedCount: mappingResult.unmappedCount
      },
      firstEmail: queueSnapshot[0] || null
    })
  } catch (error) {
    console.error('Session start error:', error)
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid request', details: error.issues }, { status: 400 })
    }
    return NextResponse.json(
      { error: 'Failed to start session', details: error instanceof Error ? error.message : 'Unknown' },
      { status: 500 }
    )
  }
}
