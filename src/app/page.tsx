'use client'

import { useState, useEffect, useCallback } from 'react'

interface EmailThread {
  id: string
  snippet: string
  from: string
  subject: string
  date: string
  labels: string[]
  messageCount: number
}

interface InboxResponse {
  threads: EmailThread[]
  nextPageToken: string | null
  resultSizeEstimate: number
}

interface UndoState {
  threadId: string
  action: string
  expiresAt: Date
}

export default function Home() {
  // Auth state
  const [accountEmail, setAccountEmail] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  // Inbox state
  const [threads, setThreads] = useState<EmailThread[]>([])
  const [nextPageToken, setNextPageToken] = useState<string | null>(null)
  const [isLoadingInbox, setIsLoadingInbox] = useState(false)

  // Action state
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [undoState, setUndoState] = useState<UndoState | null>(null)
  const [undoTimeLeft, setUndoTimeLeft] = useState<number>(0)

  // Error/status state
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)

  // Check for gmail_account cookie on mount
  useEffect(() => {
    const checkAuth = () => {
      const cookies = document.cookie.split(';')
      const gmailCookie = cookies.find((c) => c.trim().startsWith('gmail_account='))
      if (gmailCookie) {
        const email = decodeURIComponent(gmailCookie.split('=')[1])
        setAccountEmail(email)
      }
      setIsLoading(false)
    }

    // Check for error in URL query params
    const urlParams = new URLSearchParams(window.location.search)
    const urlError = urlParams.get('error')
    if (urlError) {
      setError(decodeURIComponent(urlError))
      // Clean up URL
      window.history.replaceState({}, '', window.location.pathname)
    }

    checkAuth()
  }, [])

  // Fetch inbox when authenticated
  const fetchInbox = useCallback(
    async (pageToken?: string) => {
      if (!accountEmail) return

      setIsLoadingInbox(true)
      setError(null)

      try {
        const url = new URL('/api/emails/inbox', window.location.origin)
        url.searchParams.set('maxResults', '10')
        if (pageToken) {
          url.searchParams.set('pageToken', pageToken)
        }

        const res = await fetch(url.toString())
        const data = await res.json()

        if (!res.ok) {
          throw new Error(data.error || 'Failed to fetch inbox')
        }

        const inboxData = data as InboxResponse

        if (pageToken) {
          // Append to existing threads
          setThreads((prev) => [...prev, ...inboxData.threads])
        } else {
          // Replace threads
          setThreads(inboxData.threads)
        }
        setNextPageToken(inboxData.nextPageToken)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch inbox')
      } finally {
        setIsLoadingInbox(false)
      }
    },
    [accountEmail]
  )

  // Fetch inbox when authenticated
  useEffect(() => {
    if (accountEmail) {
      fetchInbox()
    }
  }, [accountEmail, fetchInbox])

  // Undo countdown timer
  useEffect(() => {
    if (!undoState) {
      setUndoTimeLeft(0)
      return
    }

    const updateTimer = () => {
      const now = new Date()
      const timeLeft = Math.max(0, Math.floor((undoState.expiresAt.getTime() - now.getTime()) / 1000))
      setUndoTimeLeft(timeLeft)

      if (timeLeft === 0) {
        setUndoState(null)
      }
    }

    updateTimer()
    const interval = setInterval(updateTimer, 1000)
    return () => clearInterval(interval)
  }, [undoState])

  // Connect Gmail
  const handleConnect = () => {
    window.location.href = '/api/auth/gmail'
  }

  // Disconnect Gmail
  const handleDisconnect = () => {
    // Clear the cookie
    document.cookie = 'gmail_account=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;'
    setAccountEmail(null)
    setThreads([])
    setNextPageToken(null)
    setStatus('Disconnected from Gmail')
  }

  // Archive thread
  const handleArchive = async (threadId: string) => {
    setActionLoading(threadId)
    setError(null)

    try {
      const res = await fetch('/api/actions/archive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threadId }),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Failed to archive')
      }

      // Remove from list
      setThreads((prev) => prev.filter((t) => t.id !== threadId))
      setStatus('Thread archived')

      // Set undo state
      setUndoState({
        threadId,
        action: 'archive',
        expiresAt: new Date(data.undoAvailableUntil),
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to archive')
    } finally {
      setActionLoading(null)
    }
  }

  // Delete thread
  const handleDelete = async (threadId: string) => {
    setActionLoading(threadId)
    setError(null)

    try {
      const res = await fetch('/api/actions/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threadId }),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Failed to delete')
      }

      // Remove from list
      setThreads((prev) => prev.filter((t) => t.id !== threadId))
      setStatus('Thread moved to trash')

      // Set undo state
      setUndoState({
        threadId,
        action: 'delete',
        expiresAt: new Date(data.undoAvailableUntil),
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete')
    } finally {
      setActionLoading(null)
    }
  }

  // Star thread
  const handleStar = async (threadId: string) => {
    setActionLoading(threadId)
    setError(null)

    try {
      const res = await fetch('/api/actions/star', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threadId, action: 'toggle' }),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Failed to star')
      }

      // Update thread labels
      setThreads((prev) =>
        prev.map((t) => {
          if (t.id === threadId) {
            const hasStarred = t.labels.includes('STARRED')
            return {
              ...t,
              labels: hasStarred
                ? t.labels.filter((l) => l !== 'STARRED')
                : [...t.labels, 'STARRED'],
            }
          }
          return t
        })
      )

      setStatus(data.starred ? 'Thread starred' : 'Thread unstarred')

      // Set undo state
      setUndoState({
        threadId,
        action: 'star',
        expiresAt: new Date(data.undoAvailableUntil),
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to star')
    } finally {
      setActionLoading(null)
    }
  }

  // Undo last action
  const handleUndo = async () => {
    if (!undoState) return

    setActionLoading('undo')
    setError(null)

    try {
      const res = await fetch('/api/actions/undo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threadId: undoState.threadId }),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Failed to undo')
      }

      setStatus(`Undid ${data.undoneAction} action`)
      setUndoState(null)

      // Refresh inbox to show restored thread
      fetchInbox()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to undo')
    } finally {
      setActionLoading(null)
    }
  }

  // Parse sender name from "From" header
  const parseSender = (from: string): string => {
    // Extract name from "Name <email>" format
    const match = from.match(/^"?([^"<]+)"?\s*</)
    if (match) {
      return match[1].trim()
    }
    // Just email address
    return from.split('@')[0]
  }

  // Format date for display
  const formatDate = (dateStr: string): string => {
    if (!dateStr) return ''
    try {
      const date = new Date(dateStr)
      const now = new Date()
      const isToday = date.toDateString() === now.toDateString()

      if (isToday) {
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      }

      return date.toLocaleDateString([], { month: 'short', day: 'numeric' })
    } catch {
      return dateStr
    }
  }

  if (isLoading) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center p-8">
        <div className="text-gray-500">Loading...</div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-gray-900 dark:text-white">
              Gmail Test UI
            </h1>
            {accountEmail && (
              <p className="text-sm text-gray-500 dark:text-gray-400">{accountEmail}</p>
            )}
          </div>
          <div>
            {accountEmail ? (
              <button
                onClick={handleDisconnect}
                className="px-4 py-2 text-sm font-medium text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 border border-red-300 dark:border-red-600 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
              >
                Disconnect
              </button>
            ) : (
              <button
                onClick={handleConnect}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
              >
                Connect Gmail
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Error/Status Messages */}
      {(error || status) && (
        <div className="max-w-4xl mx-auto px-6 mt-4">
          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 px-4 py-3 rounded-lg">
              {error}
            </div>
          )}
          {status && !error && (
            <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-300 px-4 py-3 rounded-lg">
              {status}
            </div>
          )}
        </div>
      )}

      {/* Main Content */}
      <div className="max-w-4xl mx-auto px-6 py-6">
        {!accountEmail ? (
          <div className="text-center py-20">
            <div className="text-gray-400 dark:text-gray-500 mb-4">
              <svg
                className="mx-auto h-16 w-16"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                />
              </svg>
            </div>
            <h2 className="text-xl font-medium text-gray-700 dark:text-gray-300 mb-2">
              Connect your Gmail
            </h2>
            <p className="text-gray-500 dark:text-gray-400 mb-6">
              Sign in to test the Gmail integration
            </p>
            <button
              onClick={handleConnect}
              className="px-6 py-3 text-base font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
            >
              Connect Gmail Account
            </button>
          </div>
        ) : (
          <>
            {/* Inbox Header */}
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-medium text-gray-900 dark:text-white">Inbox</h2>
              <button
                onClick={() => fetchInbox()}
                disabled={isLoadingInbox}
                className="px-3 py-1.5 text-sm text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50 transition-colors"
              >
                {isLoadingInbox ? 'Loading...' : 'Refresh'}
              </button>
            </div>

            {/* Email List */}
            <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
              {threads.length === 0 && !isLoadingInbox ? (
                <div className="px-6 py-12 text-center text-gray-500 dark:text-gray-400">
                  No emails in inbox
                </div>
              ) : (
                <ul className="divide-y divide-gray-200 dark:divide-gray-700">
                  {threads.map((thread) => (
                    <li
                      key={thread.id}
                      className="px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                    >
                      <div className="flex items-start gap-3">
                        {/* Star button */}
                        <button
                          onClick={() => handleStar(thread.id)}
                          disabled={actionLoading === thread.id}
                          className="mt-1 p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50"
                          title={thread.labels.includes('STARRED') ? 'Unstar' : 'Star'}
                        >
                          <svg
                            className={`h-5 w-5 ${
                              thread.labels.includes('STARRED')
                                ? 'text-yellow-400 fill-current'
                                : 'text-gray-400 dark:text-gray-500'
                            }`}
                            viewBox="0 0 20 20"
                            fill="none"
                            stroke="currentColor"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={1.5}
                              d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"
                            />
                          </svg>
                        </button>

                        {/* Email content */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-medium text-gray-900 dark:text-white truncate">
                              {parseSender(thread.from)}
                            </span>
                            {thread.messageCount > 1 && (
                              <span className="text-xs text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded">
                                {thread.messageCount}
                              </span>
                            )}
                            <span className="text-xs text-gray-400 dark:text-gray-500 ml-auto flex-shrink-0">
                              {formatDate(thread.date)}
                            </span>
                          </div>
                          <div className="text-sm text-gray-800 dark:text-gray-200 truncate mb-1">
                            {thread.subject}
                          </div>
                          <div className="text-sm text-gray-500 dark:text-gray-400 truncate">
                            {thread.snippet}
                          </div>
                        </div>

                        {/* Action buttons */}
                        <div className="flex items-center gap-1 ml-2">
                          <button
                            onClick={() => handleArchive(thread.id)}
                            disabled={actionLoading === thread.id}
                            className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded disabled:opacity-50"
                            title="Archive"
                          >
                            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={1.5}
                                d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4"
                              />
                            </svg>
                          </button>
                          <button
                            onClick={() => handleDelete(thread.id)}
                            disabled={actionLoading === thread.id}
                            className="p-2 text-gray-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded disabled:opacity-50"
                            title="Delete"
                          >
                            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={1.5}
                                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                              />
                            </svg>
                          </button>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              {/* Loading indicator */}
              {isLoadingInbox && (
                <div className="px-6 py-4 text-center text-gray-500 dark:text-gray-400 border-t border-gray-200 dark:border-gray-700">
                  Loading emails...
                </div>
              )}

              {/* Load more button */}
              {nextPageToken && !isLoadingInbox && (
                <div className="px-6 py-3 border-t border-gray-200 dark:border-gray-700">
                  <button
                    onClick={() => fetchInbox(nextPageToken)}
                    className="w-full text-center text-sm text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300"
                  >
                    Load more emails
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Undo Bar */}
      {undoState && undoTimeLeft > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50">
          <div className="bg-gray-900 dark:bg-gray-700 text-white px-4 py-3 rounded-lg shadow-lg flex items-center gap-4">
            <span className="text-sm">
              {undoState.action === 'archive'
                ? 'Thread archived'
                : undoState.action === 'delete'
                ? 'Thread deleted'
                : 'Action completed'}
            </span>
            <button
              onClick={handleUndo}
              disabled={actionLoading === 'undo'}
              className="text-sm font-medium text-blue-400 hover:text-blue-300 disabled:opacity-50"
            >
              Undo ({undoTimeLeft}s)
            </button>
          </div>
        </div>
      )}
    </main>
  )
}
