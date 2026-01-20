import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { z } from 'zod'
import { getInboxThreads } from '@/lib/gmail'
import { scrapeInbox, mapThreads, getSessionStatus } from '@/lib/railway'
import { createServiceClient } from '@/lib/supabase/server'

const schema = z.object({
  accountEmail: z.string().email().optional(),
  useGmailOrder: z.boolean().optional() // Skip Superhuman, use Gmail order directly
})

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { accountEmail: bodyEmail, useGmailOrder } = schema.parse(body)

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

    let queueSnapshot
    let mappingStats = null

    // Check if we should use Superhuman ordering or Gmail order
    if (useGmailOrder) {
      // Use Gmail order directly (fallback mode)
      queueSnapshot = gmailThreads.map((t, index) => ({
        position: index,
        threadId: t.threadId,
        subject: t.subject,
        sender: t.sender,
        snippet: t.snippet
      }))
    } else {
      // Try to use Superhuman ordering
      let railwayAvailable = false
      let railwayStatus

      try {
        railwayStatus = await getSessionStatus(accountEmail)
        railwayAvailable = true
      } catch {
        // Railway service unavailable - fall back to Gmail order
        railwayAvailable = false
      }

      if (!railwayAvailable || !railwayStatus?.hasSession) {
        // Fallback to Gmail order
        queueSnapshot = gmailThreads.map((t, index) => ({
          position: index,
          threadId: t.threadId,
          subject: t.subject,
          sender: t.sender,
          snippet: t.snippet
        }))
      } else {
        // Use Superhuman ordering
        let superhumanResult
        try {
          superhumanResult = await scrapeInbox(accountEmail)
        } catch (error) {
          // Fallback to Gmail order on scrape failure
          queueSnapshot = gmailThreads.map((t, index) => ({
            position: index,
            threadId: t.threadId,
            subject: t.subject,
            sender: t.sender,
            snippet: t.snippet
          }))
        }

        if (superhumanResult) {
          // Map Superhuman order to Gmail thread IDs
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

          queueSnapshot = mappingResult.orderedGmailIds.map((threadId, index) => {
            const gmailThread = gmailThreads.find(t => t.threadId === threadId)
            return {
              position: index,
              threadId,
              subject: gmailThread?.subject || '',
              sender: gmailThread?.sender || '',
              snippet: gmailThread?.snippet || ''
            }
          })

          mappingStats = {
            totalSuperhuman: mappingResult.totalSuperhuman,
            successfulMappings: mappingResult.successfulMappings,
            unmappedCount: mappingResult.unmappedCount
          }
        }
      }
    }

    // Create a triage session in Supabase
    const supabase = createServiceClient()

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
      queueLength: queueSnapshot!.length,
      mappingStats,
      firstEmail: queueSnapshot![0] || null
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
