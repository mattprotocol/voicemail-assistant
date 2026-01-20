import { Cookie } from 'playwright'

// In-memory session storage for MVP
// For production, this should be stored in Supabase
interface Session {
  accountEmail: string
  cookies: Cookie[]
  lastActivity: Date
  isActive: boolean
}

const sessions = new Map<string, Session>()

// Session TTL in milliseconds (30 minutes)
const SESSION_TTL = 30 * 60 * 1000

export function saveSession(accountEmail: string, cookies: Cookie[]): void {
  sessions.set(accountEmail, {
    accountEmail,
    cookies,
    lastActivity: new Date(),
    isActive: true
  })
}

export function getSession(accountEmail: string): Session | null {
  const session = sessions.get(accountEmail)
  if (!session) return null

  // Check if session has expired
  const now = new Date()
  const elapsed = now.getTime() - session.lastActivity.getTime()
  if (elapsed > SESSION_TTL) {
    sessions.delete(accountEmail)
    return null
  }

  return session
}

export function getCookies(accountEmail: string): Cookie[] | null {
  const session = getSession(accountEmail)
  return session?.cookies || null
}

export function updateActivity(accountEmail: string): void {
  const session = sessions.get(accountEmail)
  if (session) {
    session.lastActivity = new Date()
  }
}

export function invalidateSession(accountEmail: string): void {
  sessions.delete(accountEmail)
}

export function isSessionActive(accountEmail: string): boolean {
  const session = getSession(accountEmail)
  return session?.isActive || false
}

// Clean up expired sessions periodically
setInterval(() => {
  const now = new Date()
  for (const [email, session] of sessions.entries()) {
    const elapsed = now.getTime() - session.lastActivity.getTime()
    if (elapsed > SESSION_TTL) {
      sessions.delete(email)
      console.log(`Session expired for ${email}`)
    }
  }
}, 60 * 1000) // Check every minute
