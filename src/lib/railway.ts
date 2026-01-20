/**
 * Client for the Railway Playwright service
 * Handles Superhuman scraping and inbox mapping
 */

const RAILWAY_URL = process.env.RAILWAY_PLAYWRIGHT_URL || 'http://localhost:3001'

export interface ScrapedThread {
  position: number
  sender: string
  subject: string
  timestamp: string
  superhumanThreadId: string
  rawText: string
}

export interface GmailThread {
  threadId: string
  subject: string
  sender: string
  senderEmail: string
  snippet: string
  receivedAt: string
}

export interface MappedThread {
  position: number
  superhumanThread: ScrapedThread
  gmailThread: GmailThread | null
  matchConfidence: number
  matchMethod: 'exact' | 'fuzzy' | 'none'
}

export interface ScrapeResult {
  success: boolean
  threads: ScrapedThread[]
  count: number
  error?: string
}

export interface MappingResult {
  success: boolean
  mappedThreads: MappedThread[]
  orderedGmailIds: string[]
  totalSuperhuman: number
  successfulMappings: number
  unmappedCount: number
  error?: string
}

export interface SessionStatus {
  hasSession: boolean
  isActive: boolean
  lastActivity: string | null
}

/**
 * Check if the Railway service is healthy
 */
export async function checkHealth(): Promise<{ status: string; browserActive: boolean }> {
  const res = await fetch(`${RAILWAY_URL}/health`)
  if (!res.ok) throw new Error('Railway service unhealthy')
  return res.json()
}

/**
 * Navigate to Superhuman login page (for manual login)
 */
export async function navigateToLogin(): Promise<void> {
  const res = await fetch(`${RAILWAY_URL}/navigate-login`, { method: 'POST' })
  if (!res.ok) throw new Error('Failed to navigate to login')
}

/**
 * Scrape the Superhuman inbox
 */
export async function scrapeInbox(accountEmail?: string): Promise<ScrapeResult> {
  const res = await fetch(`${RAILWAY_URL}/scrape-inbox`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accountEmail })
  })

  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Scrape failed')
  return data
}

/**
 * Map Superhuman threads to Gmail threads
 */
export async function mapThreads(
  superhumanThreads: ScrapedThread[],
  gmailThreads: GmailThread[]
): Promise<MappingResult> {
  const res = await fetch(`${RAILWAY_URL}/map-threads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ superhumanThreads, gmailThreads })
  })

  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Mapping failed')
  return data
}

/**
 * Save browser session cookies
 */
export async function saveSession(accountEmail: string): Promise<void> {
  const res = await fetch(`${RAILWAY_URL}/session/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accountEmail })
  })

  if (!res.ok) {
    const data = await res.json()
    throw new Error(data.error || 'Failed to save session')
  }
}

/**
 * Restore browser session from saved cookies
 */
export async function restoreSession(accountEmail: string): Promise<void> {
  const res = await fetch(`${RAILWAY_URL}/session/restore`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accountEmail })
  })

  if (!res.ok) {
    const data = await res.json()
    throw new Error(data.error || 'Failed to restore session')
  }
}

/**
 * Check session status
 */
export async function getSessionStatus(accountEmail: string): Promise<SessionStatus> {
  const res = await fetch(
    `${RAILWAY_URL}/session/status?accountEmail=${encodeURIComponent(accountEmail)}`
  )

  if (!res.ok) {
    const data = await res.json()
    throw new Error(data.error || 'Failed to get session status')
  }
  return res.json()
}

/**
 * Invalidate session
 */
export async function invalidateSession(accountEmail: string): Promise<void> {
  const res = await fetch(`${RAILWAY_URL}/session/invalidate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accountEmail })
  })

  if (!res.ok) {
    const data = await res.json()
    throw new Error(data.error || 'Failed to invalidate session')
  }
}

/**
 * Get debug screenshot
 */
export async function getDebugScreenshot(): Promise<string> {
  const res = await fetch(`${RAILWAY_URL}/debug-screenshot`)
  if (!res.ok) throw new Error('Failed to get screenshot')
  const data = await res.json()
  return data.screenshot
}

/**
 * Close browser
 */
export async function closeBrowser(): Promise<void> {
  const res = await fetch(`${RAILWAY_URL}/close`, { method: 'POST' })
  if (!res.ok) throw new Error('Failed to close browser')
}
