import { NextResponse } from 'next/server'
import { google } from 'googleapis'
import { cookies } from 'next/headers'
import crypto from 'crypto'

// Gmail OAuth scopes
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/userinfo.email',
]

function getOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/api/auth/gmail/callback'
  )
}

export async function GET() {
  try {
    // Validate required environment variables
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
      console.error('Missing Google OAuth credentials')
      return NextResponse.redirect(new URL('/?error=oauth_config_missing', process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'))
    }

    const oauth2Client = getOAuth2Client()

    // Generate CSRF state token for security
    const state = crypto.randomBytes(32).toString('hex')

    // Store state in cookie for validation in callback
    const cookieStore = await cookies()
    cookieStore.set('gmail_oauth_state', state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 10, // 10 minutes
      path: '/',
    })

    // Generate the authorization URL
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline', // Request refresh token
      scope: SCOPES,
      state,
      prompt: 'consent', // Force consent to ensure we get refresh token
      include_granted_scopes: true,
    })

    return NextResponse.redirect(authUrl)
  } catch (error) {
    console.error('Gmail OAuth initiation error:', error)
    return NextResponse.redirect(
      new URL('/?error=oauth_init_failed', process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000')
    )
  }
}
