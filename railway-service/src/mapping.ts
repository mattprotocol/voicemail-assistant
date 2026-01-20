/**
 * Maps Superhuman inbox threads to Gmail thread IDs.
 *
 * Since Superhuman uses Gmail under the hood, the thread IDs should match.
 * However, Superhuman may not expose the Gmail thread ID directly in the DOM.
 *
 * Strategy:
 * 1. If Superhuman exposes thread IDs in data attributes, use directly
 * 2. Otherwise, use fuzzy matching on sender + subject + timestamp
 */

interface SuperhumanThread {
  position: number
  sender: string
  subject: string
  timestamp: string
  superhumanThreadId: string
  rawText: string
}

interface GmailThread {
  threadId: string
  subject: string
  sender: string
  senderEmail: string
  snippet: string
  receivedAt: string
}

interface MappedThread {
  position: number
  superhumanThread: SuperhumanThread
  gmailThread: GmailThread | null
  matchConfidence: number // 0-1 score
  matchMethod: 'exact' | 'fuzzy' | 'none'
}

/**
 * Normalize a string for fuzzy comparison
 */
function normalize(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^\w\s]/g, '') // Remove punctuation
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim()
}

/**
 * Calculate similarity between two strings (0-1)
 * Uses a simple overlap coefficient
 */
function similarity(a: string, b: string): number {
  const aWords = new Set(normalize(a).split(' '))
  const bWords = new Set(normalize(b).split(' '))

  if (aWords.size === 0 && bWords.size === 0) return 1
  if (aWords.size === 0 || bWords.size === 0) return 0

  let overlap = 0
  for (const word of aWords) {
    if (bWords.has(word)) overlap++
  }

  const minSize = Math.min(aWords.size, bWords.size)
  return overlap / minSize
}

/**
 * Extract email address from sender string
 * "John Doe <john@example.com>" -> "john@example.com"
 */
function extractEmail(sender: string): string {
  const match = sender.match(/<([^>]+)>/)
  if (match) return match[1].toLowerCase()

  // If it looks like an email already
  if (sender.includes('@')) return sender.toLowerCase().trim()

  return sender.toLowerCase().trim()
}

/**
 * Map Superhuman threads to Gmail threads
 */
export function mapThreads(
  superhumanThreads: SuperhumanThread[],
  gmailThreads: GmailThread[]
): MappedThread[] {
  const results: MappedThread[] = []
  const usedGmailThreads = new Set<string>()

  for (const shThread of superhumanThreads) {
    let bestMatch: GmailThread | null = null
    let bestScore = 0
    let matchMethod: 'exact' | 'fuzzy' | 'none' = 'none'

    // First, try exact match on thread ID (if Superhuman exposes it)
    if (shThread.superhumanThreadId) {
      const exactMatch = gmailThreads.find(
        g => g.threadId === shThread.superhumanThreadId &&
             !usedGmailThreads.has(g.threadId)
      )
      if (exactMatch) {
        bestMatch = exactMatch
        bestScore = 1
        matchMethod = 'exact'
      }
    }

    // If no exact match, try fuzzy matching
    if (!bestMatch) {
      for (const gmailThread of gmailThreads) {
        if (usedGmailThreads.has(gmailThread.threadId)) continue

        // Calculate score based on subject and sender match
        const subjectScore = similarity(shThread.subject, gmailThread.subject)
        const senderScore = similarity(
          extractEmail(shThread.sender),
          gmailThread.senderEmail
        )

        // Weighted average (subject is more reliable)
        const score = subjectScore * 0.7 + senderScore * 0.3

        if (score > bestScore && score > 0.5) { // Minimum threshold
          bestMatch = gmailThread
          bestScore = score
          matchMethod = 'fuzzy'
        }
      }
    }

    if (bestMatch) {
      usedGmailThreads.add(bestMatch.threadId)
    }

    results.push({
      position: shThread.position,
      superhumanThread: shThread,
      gmailThread: bestMatch,
      matchConfidence: bestScore,
      matchMethod: bestMatch ? matchMethod : 'none'
    })
  }

  return results
}

/**
 * Get only successfully mapped threads (with Gmail IDs)
 */
export function getMappedGmailIds(mappedThreads: MappedThread[]): string[] {
  return mappedThreads
    .filter(t => t.gmailThread !== null)
    .map(t => t.gmailThread!.threadId)
}

/**
 * Get threads that couldn't be mapped
 */
export function getUnmappedThreads(mappedThreads: MappedThread[]): SuperhumanThread[] {
  return mappedThreads
    .filter(t => t.gmailThread === null)
    .map(t => t.superhumanThread)
}

/**
 * Get the ordered Gmail thread IDs based on Superhuman inbox order
 */
export function getOrderedGmailThreadIds(mappedThreads: MappedThread[]): string[] {
  return mappedThreads
    .sort((a, b) => a.position - b.position)
    .filter(t => t.gmailThread !== null)
    .map(t => t.gmailThread!.threadId)
}
