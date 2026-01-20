'use client'

import { useState, useEffect, useCallback } from 'react'
import Vapi from '@vapi-ai/web'

interface QueueItem {
  threadId: string
  subject: string
  sender: string
  snippet: string
}

interface SessionState {
  sessionId: string | null
  status: 'idle' | 'starting' | 'active' | 'paused' | 'completed' | 'error'
  currentEmail: QueueItem | null
  position: number
  total: number
  error: string | null
}

interface VapiState {
  status: 'idle' | 'connecting' | 'connected' | 'speaking' | 'listening' | 'ended'
  isMuted: boolean
}

export default function VoiceTriage({ accountEmail }: { accountEmail: string }) {
  const [session, setSession] = useState<SessionState>({
    sessionId: null,
    status: 'idle',
    currentEmail: null,
    position: 0,
    total: 0,
    error: null
  })

  const [vapi, setVapi] = useState<Vapi | null>(null)
  const [vapiState, setVapiState] = useState<VapiState>({
    status: 'idle',
    isMuted: false
  })

  // Initialize Vapi client
  useEffect(() => {
    const publicKey = process.env.NEXT_PUBLIC_VAPI_PUBLIC_KEY
    if (publicKey) {
      const vapiClient = new Vapi(publicKey)
      setVapi(vapiClient)

      // Set up event listeners
      vapiClient.on('call-start', () => {
        setVapiState(prev => ({ ...prev, status: 'connected' }))
      })

      vapiClient.on('call-end', () => {
        setVapiState(prev => ({ ...prev, status: 'ended' }))
      })

      vapiClient.on('speech-start', () => {
        setVapiState(prev => ({ ...prev, status: 'speaking' }))
      })

      vapiClient.on('speech-end', () => {
        setVapiState(prev => ({ ...prev, status: 'listening' }))
      })

      vapiClient.on('error', (error) => {
        console.error('Vapi error:', error)
        setSession(prev => ({ ...prev, error: 'Voice connection error' }))
      })

      vapiClient.on('message', (message) => {
        console.log('Vapi message:', message)
      })

      return () => {
        vapiClient.stop()
      }
    }
  }, [])

  // Start triage session
  const startSession = useCallback(async () => {
    setSession(prev => ({ ...prev, status: 'starting', error: null }))

    try {
      // Create triage session
      const sessionRes = await fetch('/api/session/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountEmail })
      })

      if (!sessionRes.ok) {
        const error = await sessionRes.json()
        throw new Error(error.error || 'Failed to start session')
      }

      const sessionData = await sessionRes.json()

      setSession(prev => ({
        ...prev,
        sessionId: sessionData.sessionId,
        currentEmail: sessionData.firstEmail,
        position: 1,
        total: sessionData.queueLength,
        status: 'active'
      }))

      // Start voice call directly with Vapi Web SDK
      if (vapi && process.env.NEXT_PUBLIC_VAPI_ASSISTANT_ID) {
        setVapiState(prev => ({ ...prev, status: 'connecting' }))

        // Start the Vapi call with the assistant - web calls use SDK directly
        await vapi.start(process.env.NEXT_PUBLIC_VAPI_ASSISTANT_ID, {
          metadata: {
            sessionId: sessionData.sessionId,
            accountEmail
          }
        })
      }
    } catch (error) {
      console.error('Start session error:', error)
      setSession(prev => ({
        ...prev,
        status: 'error',
        error: error instanceof Error ? error.message : 'Failed to start'
      }))
    }
  }, [accountEmail, vapi])

  // Stop session
  const stopSession = useCallback(async () => {
    if (vapi) {
      vapi.stop()
    }

    if (session.sessionId) {
      try {
        await fetch('/api/session/stop', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: session.sessionId })
        })
      } catch (error) {
        console.error('Stop session error:', error)
      }
    }

    setSession(prev => ({ ...prev, status: 'paused' }))
    setVapiState(prev => ({ ...prev, status: 'ended' }))
  }, [session.sessionId, vapi])

  // Toggle mute
  const toggleMute = useCallback(() => {
    if (vapi) {
      const newMuted = !vapiState.isMuted
      vapi.setMuted(newMuted)
      setVapiState(prev => ({ ...prev, isMuted: newMuted }))
    }
  }, [vapi, vapiState.isMuted])

  // Refresh current email status
  const refreshStatus = useCallback(async () => {
    if (!session.sessionId) return

    try {
      const res = await fetch(`/api/session/${session.sessionId}`)
      if (res.ok) {
        const data = await res.json()
        setSession(prev => ({
          ...prev,
          currentEmail: data.currentEmail,
          position: data.currentIndex + 1,
          total: data.totalEmails,
          status: data.status === 'completed' ? 'completed' : prev.status
        }))
      }
    } catch (error) {
      console.error('Refresh error:', error)
    }
  }, [session.sessionId])

  // Poll for session updates
  useEffect(() => {
    if (session.status === 'active' && session.sessionId) {
      const interval = setInterval(refreshStatus, 3000)
      return () => clearInterval(interval)
    }
  }, [session.status, session.sessionId, refreshStatus])

  return (
    <div className="bg-white rounded-2xl shadow-lg p-6 max-w-md mx-auto">
      {/* Header */}
      <div className="text-center mb-6">
        <h2 className="text-2xl font-bold text-gray-900">Voice Triage</h2>
        <p className="text-gray-500 text-sm mt-1">{accountEmail}</p>
      </div>

      {/* Status indicator */}
      <div className="flex items-center justify-center gap-2 mb-6">
        <div className={`w-3 h-3 rounded-full ${
          vapiState.status === 'connected' || vapiState.status === 'listening' ? 'bg-green-500 animate-pulse' :
          vapiState.status === 'speaking' ? 'bg-blue-500 animate-pulse' :
          vapiState.status === 'connecting' ? 'bg-yellow-500 animate-pulse' :
          'bg-gray-300'
        }`} />
        <span className="text-sm text-gray-600 capitalize">
          {vapiState.status === 'idle' ? 'Ready' : vapiState.status}
        </span>
      </div>

      {/* Current email */}
      {session.currentEmail && session.status === 'active' && (
        <div className="bg-gray-50 rounded-lg p-4 mb-6">
          <div className="flex justify-between items-start mb-2">
            <span className="text-xs font-medium text-gray-500 uppercase">
              Email {session.position} of {session.total}
            </span>
          </div>
          <p className="font-medium text-gray-900">{session.currentEmail.sender}</p>
          <p className="text-gray-700 mt-1">{session.currentEmail.subject}</p>
          <p className="text-gray-500 text-sm mt-2 line-clamp-2">{session.currentEmail.snippet}</p>
        </div>
      )}

      {/* Completed state */}
      {session.status === 'completed' && (
        <div className="text-center py-8">
          <div className="text-5xl mb-4">&#127881;</div>
          <p className="text-lg font-medium text-gray-900">All done!</p>
          <p className="text-gray-500">You processed all {session.total} emails.</p>
        </div>
      )}

      {/* Error state */}
      {session.error && (
        <div className="bg-red-50 text-red-700 rounded-lg p-4 mb-6">
          {session.error}
        </div>
      )}

      {/* Controls */}
      <div className="space-y-3">
        {session.status === 'idle' || session.status === 'error' ? (
          <button
            onClick={startSession}
            className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-xl transition-colors"
          >
            Start Voice Triage
          </button>
        ) : session.status === 'starting' ? (
          <button
            disabled
            className="w-full py-4 bg-gray-300 text-gray-500 font-medium rounded-xl"
          >
            Starting...
          </button>
        ) : session.status === 'active' ? (
          <div className="flex gap-3">
            <button
              onClick={toggleMute}
              className={`flex-1 py-4 font-medium rounded-xl transition-colors ${
                vapiState.isMuted
                  ? 'bg-red-100 text-red-700 hover:bg-red-200'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {vapiState.isMuted ? 'Unmute' : 'Mute'}
            </button>
            <button
              onClick={stopSession}
              className="flex-1 py-4 bg-red-600 hover:bg-red-700 text-white font-medium rounded-xl transition-colors"
            >
              Stop
            </button>
          </div>
        ) : session.status === 'paused' || session.status === 'completed' ? (
          <button
            onClick={startSession}
            className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-xl transition-colors"
          >
            {session.status === 'completed' ? 'Start New Session' : 'Resume'}
          </button>
        ) : null}
      </div>

      {/* Voice commands hint */}
      {session.status === 'active' && (
        <div className="mt-6 text-center">
          <p className="text-xs text-gray-400">
            Say: &quot;Archive&quot;, &quot;Delete&quot;, &quot;Star&quot;, &quot;Skip&quot;, or &quot;Stop&quot;
          </p>
        </div>
      )}
    </div>
  )
}
