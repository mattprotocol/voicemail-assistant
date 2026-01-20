import crypto from 'crypto'

/**
 * Vapi Voice AI integration for email triage
 *
 * This module provides:
 * - Webhook signature verification
 * - Type definitions for Vapi API
 * - Function tool definitions for the assistant
 * - Helper functions for managing voice sessions
 */

// ============================================================================
// Types
// ============================================================================

export interface VapiToolCall {
  id: string
  name: string
  parameters: Record<string, unknown>
}

export interface VapiToolCallMessage {
  type: 'tool-calls'
  call?: {
    id: string
    orgId?: string
    createdAt?: string
    type?: string
    status?: string
    assistantId?: string
  }
  toolCallList: VapiToolCall[]
  toolWithToolCallList?: Array<{
    name: string
    toolCall: VapiToolCall
  }>
}

export interface VapiAssistantRequestMessage {
  type: 'assistant-request'
  call?: Record<string, unknown>
}

export interface VapiStatusUpdateMessage {
  type: 'status-update'
  status: 'queued' | 'ringing' | 'in-progress' | 'forwarding' | 'ended'
  call?: Record<string, unknown>
}

export interface VapiEndOfCallReportMessage {
  type: 'end-of-call-report'
  call?: Record<string, unknown>
  endedReason?: string
  transcript?: string
  summary?: string
  messages?: Array<{
    role: string
    message: string
  }>
}

export type VapiWebhookMessage =
  | VapiToolCallMessage
  | VapiAssistantRequestMessage
  | VapiStatusUpdateMessage
  | VapiEndOfCallReportMessage
  | { type: string; [key: string]: unknown }

export interface VapiToolResult {
  name: string
  toolCallId: string
  result: string
}

export interface VapiWebhookResponse {
  results?: VapiToolResult[]
  spokenMessage?: string
  error?: string
}

// ============================================================================
// Webhook Signature Verification
// ============================================================================

/**
 * Verify Vapi webhook signature using HMAC-SHA256
 */
export function verifyWebhookSignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  if (!signature || !secret) {
    return false
  }

  try {
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(payload)
      .digest('hex')

    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    )
  } catch {
    return false
  }
}

// ============================================================================
// Assistant Configuration
// ============================================================================

/**
 * System prompt for the email triage assistant
 */
export const ASSISTANT_SYSTEM_PROMPT = `You are a helpful email triage assistant. Your job is to help the user efficiently process their email inbox while they're driving or busy.

For each email, you will:
1. Announce the sender and subject
2. Provide a brief summary or read short emails in full
3. Wait for the user's command

Available commands you should understand (users may phrase these differently):
- "Archive" / "Done" / "File it" → Archive the email
- "Delete" / "Trash it" → Move to trash
- "Star" / "Flag" / "Important" → Star the email for later
- "Skip" / "Next" → Move to the next email without action
- "Undo" → Undo the last action (within 15 seconds)
- "Stop" / "Done for now" → End the triage session
- "How many left?" → Report remaining emails
- "Repeat" → Re-read the current email

Keep your responses concise and clear. Focus on efficiency - the user is trying to process their inbox quickly.

When announcing an email, use this format:
"Email from [sender]. Subject: [subject]. [Summary or content]"

After processing an email, briefly confirm the action and automatically move to the next email.
If the inbox is empty or the user reaches the end, congratulate them and offer to end the session.`

/**
 * Function tool definitions for the Vapi assistant
 * These map to our API endpoints
 */
export const ASSISTANT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'archive_email',
      description: 'Archive the current email, removing it from the inbox',
      parameters: {
        type: 'object',
        properties: {},
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'delete_email',
      description: 'Move the current email to trash',
      parameters: {
        type: 'object',
        properties: {},
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'star_email',
      description: 'Star/flag the current email for later attention',
      parameters: {
        type: 'object',
        properties: {},
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'skip_email',
      description: 'Skip the current email and move to the next one without taking action',
      parameters: {
        type: 'object',
        properties: {},
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'undo_action',
      description: 'Undo the last email action (archive, delete, or star). Only works within 15 seconds of the action.',
      parameters: {
        type: 'object',
        properties: {},
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_remaining_count',
      description: 'Get the number of remaining emails in the triage queue',
      parameters: {
        type: 'object',
        properties: {},
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'end_session',
      description: 'End the triage session when the user is done',
      parameters: {
        type: 'object',
        properties: {},
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_current_email',
      description: 'Get details about the current email to read or re-read',
      parameters: {
        type: 'object',
        properties: {},
        required: []
      }
    }
  }
]

/**
 * Full assistant configuration for creating/updating via Vapi API
 */
export function getAssistantConfig(serverUrl: string, webhookSecret: string) {
  return {
    name: 'VoiceMail Email Triage Assistant',
    firstMessage: "Hi! I'm ready to help you triage your inbox. Let me get your first email.",
    model: {
      provider: 'anthropic',
      model: 'claude-3-5-sonnet-20241022',
      messages: [
        {
          role: 'system',
          content: ASSISTANT_SYSTEM_PROMPT
        }
      ]
    },
    voice: {
      provider: '11labs',
      voiceId: 'burt' // Professional, clear voice
    },
    server: {
      url: serverUrl,
      secret: webhookSecret,
      timeoutSeconds: 30
    },
    serverMessages: ['tool-calls', 'end-of-call-report', 'status-update'],
    silenceTimeoutSeconds: 30,
    maxDurationSeconds: 1800, // 30 minute max session
    backgroundSound: 'off',
    recordingEnabled: false // Privacy
  }
}

// ============================================================================
// Vapi API Client
// ============================================================================

const VAPI_API_BASE = 'https://api.vapi.ai'

/**
 * Create a web call using the Vapi API
 */
export async function createWebCall(
  assistantId: string,
  metadata?: Record<string, unknown>
): Promise<{ callId: string; webCallUrl: string }> {
  const apiKey = process.env.VAPI_API_KEY
  if (!apiKey) {
    throw new Error('VAPI_API_KEY not configured')
  }

  const response = await fetch(`${VAPI_API_BASE}/call`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      assistantId,
      type: 'webCall',
      metadata
    })
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Failed to create Vapi call: ${error}`)
  }

  const data = await response.json()
  return {
    callId: data.id,
    webCallUrl: data.webCallUrl
  }
}

/**
 * End an active Vapi call
 */
export async function endCall(callId: string): Promise<void> {
  const apiKey = process.env.VAPI_API_KEY
  if (!apiKey) {
    throw new Error('VAPI_API_KEY not configured')
  }

  const response = await fetch(`${VAPI_API_BASE}/call/${callId}/stop`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    }
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Failed to end Vapi call: ${error}`)
  }
}

/**
 * Get call details
 */
export async function getCall(callId: string): Promise<Record<string, unknown>> {
  const apiKey = process.env.VAPI_API_KEY
  if (!apiKey) {
    throw new Error('VAPI_API_KEY not configured')
  }

  const response = await fetch(`${VAPI_API_BASE}/call/${callId}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${apiKey}`
    }
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Failed to get Vapi call: ${error}`)
  }

  return response.json()
}
