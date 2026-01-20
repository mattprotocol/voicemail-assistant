import express from 'express'
import { chromium, Browser, Page, Cookie } from 'playwright'
import {
  saveSession,
  getSession,
  getCookies,
  updateActivity,
  invalidateSession,
  isSessionActive
} from './session.js'
import { mapThreads, getOrderedGmailThreadIds } from './mapping.js'

const app = express()
app.use(express.json())

let browser: Browser | null = null
let page: Page | null = null

interface ScrapedThread {
  position: number
  sender: string
  subject: string
  timestamp: string
  superhumanThreadId: string
  rawText: string
}

async function initBrowser() {
  if (!browser) {
    browser = await chromium.launch({ headless: true })
    page = await browser.newPage()
  }
  return { browser, page: page! }
}

async function closeBrowser() {
  if (page) {
    await page.close()
    page = null
  }
  if (browser) {
    await browser.close()
    browser = null
  }
}

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', browserActive: !!browser })
})

// Save cookies for a session (used after manual login)
app.post('/session/save', async (req, res) => {
  try {
    const { accountEmail } = req.body as { accountEmail: string }
    if (!accountEmail) {
      return res.status(400).json({ error: 'Missing accountEmail' })
    }

    if (!page) {
      return res.status(400).json({ error: 'No active browser session' })
    }

    // Get all cookies from current browser context
    const cookies = await page.context().cookies()
    saveSession(accountEmail, cookies)

    res.json({
      success: true,
      cookieCount: cookies.length
    })
  } catch (error) {
    console.error('Session save error:', error)
    res.status(500).json({ error: 'Failed to save session' })
  }
})

// Restore a session from saved cookies
app.post('/session/restore', async (req, res) => {
  try {
    const { accountEmail } = req.body as { accountEmail: string }
    if (!accountEmail) {
      return res.status(400).json({ error: 'Missing accountEmail' })
    }

    const cookies = getCookies(accountEmail)
    if (!cookies) {
      return res.status(404).json({ error: 'No saved session found' })
    }

    const { page } = await initBrowser()
    await page.context().addCookies(cookies)
    updateActivity(accountEmail)

    res.json({ success: true, restored: true })
  } catch (error) {
    console.error('Session restore error:', error)
    res.status(500).json({ error: 'Failed to restore session' })
  }
})

// Check session status
app.get('/session/status', (req, res) => {
  const accountEmail = req.query.accountEmail as string
  if (!accountEmail) {
    return res.status(400).json({ error: 'Missing accountEmail' })
  }

  const session = getSession(accountEmail)
  res.json({
    hasSession: !!session,
    isActive: isSessionActive(accountEmail),
    lastActivity: session?.lastActivity || null
  })
})

// Invalidate a session
app.post('/session/invalidate', (req, res) => {
  const { accountEmail } = req.body as { accountEmail: string }
  if (!accountEmail) {
    return res.status(400).json({ error: 'Missing accountEmail' })
  }

  invalidateSession(accountEmail)
  res.json({ success: true })
})

// Navigate to Superhuman login (for manual login flow)
app.post('/navigate-login', async (_req, res) => {
  try {
    const { page } = await initBrowser()
    await page.goto('https://mail.superhuman.com/login')
    res.json({ success: true, message: 'Navigated to login page' })
  } catch (error) {
    console.error('Navigation error:', error)
    res.status(500).json({ error: 'Navigation failed' })
  }
})

app.post('/scrape-inbox', async (req, res) => {
  try {
    const { cookies, accountEmail } = req.body as {
      cookies?: Cookie[]
      accountEmail?: string
    }
    const { page } = await initBrowser()

    // Try to use provided cookies, then saved session
    if (cookies && cookies.length > 0) {
      await page.context().addCookies(cookies)
    } else if (accountEmail) {
      const savedCookies = getCookies(accountEmail)
      if (savedCookies) {
        await page.context().addCookies(savedCookies)
        updateActivity(accountEmail)
      }
    }

    await page.goto('https://mail.superhuman.com')

    // Wait for inbox to load - selectors may need adjustment after DOM inspection
    await page.waitForSelector('[data-testid="thread-list"], .thread-list, [class*="inbox"]', {
      timeout: 15000
    })

    // Update session activity if we have an account email
    if (accountEmail) {
      updateActivity(accountEmail)
    }

    // Scrape inbox - selectors will need refinement based on actual Superhuman DOM
    const threads: ScrapedThread[] = await page.evaluate(() => {
      // Try multiple possible selectors
      const selectors = [
        '[data-testid="thread-item"]',
        '.thread-item',
        '[class*="thread-row"]',
        '[class*="email-row"]',
        '[role="listitem"]'
      ]

      let items: Element[] = []
      for (const selector of selectors) {
        const found = document.querySelectorAll(selector)
        if (found.length > 0) {
          items = Array.from(found)
          break
        }
      }

      if (items.length === 0) return []

      return items.map((item, index) => {
        // Try to extract sender
        const senderEl = item.querySelector('.sender, [class*="sender"], [class*="from"]')
        // Try to extract subject
        const subjectEl = item.querySelector('.subject, [class*="subject"], [class*="title"]')
        // Try to extract timestamp
        const timestampEl = item.querySelector('.timestamp, [class*="time"], [class*="date"]')
        // Try to extract any data attributes that might contain thread ID
        const threadId = item.getAttribute('data-thread-id') ||
                        item.getAttribute('data-id') ||
                        item.getAttribute('id') || ''

        return {
          position: index,
          sender: senderEl?.textContent?.trim() || '',
          subject: subjectEl?.textContent?.trim() || '',
          timestamp: timestampEl?.textContent?.trim() || '',
          superhumanThreadId: threadId,
          // Store raw text for fuzzy matching
          rawText: (item.textContent?.trim() || '').substring(0, 500)
        }
      })
    })

    res.json({
      success: true,
      threads,
      count: threads.length
    })
  } catch (error) {
    console.error('Scrape error:', error)
    res.status(500).json({
      error: 'Scrape failed',
      message: error instanceof Error ? error.message : 'Unknown error'
    })
  }
})

// Get current page state/screenshot for debugging
app.get('/debug-screenshot', async (_req, res) => {
  try {
    if (!page) {
      return res.status(400).json({ error: 'No active browser session' })
    }
    const buffer = await page.screenshot()
    const base64 = buffer.toString('base64')
    res.json({ screenshot: `data:image/png;base64,${base64}` })
  } catch (error) {
    res.status(500).json({ error: 'Screenshot failed' })
  }
})

// Get page HTML for DOM inspection
app.get('/debug-html', async (_req, res) => {
  try {
    if (!page) {
      return res.status(400).json({ error: 'No active browser session' })
    }
    const html = await page.content()
    res.json({ html: html.substring(0, 50000) }) // Truncate for safety
  } catch (error) {
    res.status(500).json({ error: 'HTML fetch failed' })
  }
})

app.post('/close', async (_req, res) => {
  await closeBrowser()
  res.json({ success: true })
})

app.post('/health-check', async (_req, res) => {
  res.json({ session_alive: !!browser && !!page })
})

// Map Superhuman inbox order to Gmail thread IDs
app.post('/map-threads', async (req, res) => {
  try {
    const { superhumanThreads, gmailThreads } = req.body as {
      superhumanThreads: ScrapedThread[]
      gmailThreads: Array<{
        threadId: string
        subject: string
        sender: string
        senderEmail: string
        snippet: string
        receivedAt: string
      }>
    }

    if (!superhumanThreads || !gmailThreads) {
      return res.status(400).json({ error: 'Missing required thread data' })
    }

    const mapped = mapThreads(superhumanThreads, gmailThreads)
    const orderedIds = getOrderedGmailThreadIds(mapped)

    res.json({
      success: true,
      mappedThreads: mapped,
      orderedGmailIds: orderedIds,
      totalSuperhuman: superhumanThreads.length,
      successfulMappings: orderedIds.length,
      unmappedCount: superhumanThreads.length - orderedIds.length
    })
  } catch (error) {
    console.error('Mapping error:', error)
    res.status(500).json({
      error: 'Mapping failed',
      message: error instanceof Error ? error.message : 'Unknown error'
    })
  }
})

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, closing browser...')
  await closeBrowser()
  process.exit(0)
})

const PORT = process.env.PORT || 3001
app.listen(PORT, () => console.log(`Playwright service running on port ${PORT}`))
