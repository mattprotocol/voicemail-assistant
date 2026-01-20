import { NextRequest, NextResponse } from 'next/server'
import { google } from 'googleapis'
import { cookies } from 'next/headers'
import { createServiceClient } from '@/lib/supabase/server'
import type { GmailTokenInsert } from '@/types/database'

function getOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/api/auth/gmail/callback'
  )
}

function getBaseUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
}

export async function GET(request: NextRequest) {
  const baseUrl = getBaseUrl()

  try {
    const searchParams = request.nextUrl.searchParams
    const code = searchParams.get('code')
    const state = searchParams.get('state')
    const error = searchParams.get('error')

    // Handle OAuth errors from Google
    if (error) {
      console.error('Google OAuth error:', error)
      return NextResponse.redirect(new URL(`/?error=${encodeURIComponent(error)}`, baseUrl))
    }

    // Validate authorization code
    if (!code) {
      console.error('Missing authorization code')
      return NextResponse.redirect(new URL('/?error=missing_code', baseUrl))
    }

    // Validate state parameter (CSRF protection)
    const cookieStore = await cookies()
    const storedState = cookieStore.get('gmail_oauth_state')?.value

    if (!state || !storedState || state !== storedState) {
      console.error('State mismatch - possible CSRF attack')
      return NextResponse.redirect(new URL('/?error=invalid_state', baseUrl))
    }

    // Clear the state cookie
    cookieStore.delete('gmail_oauth_state')

    // Exchange code for tokens
    const oauth2Client = getOAuth2Client()
    const { tokens } = await oauth2Client.getToken(code)

    if (!tokens.access_token || !tokens.refresh_token) {
      console.error('Missing tokens in response')
      return NextResponse.redirect(new URL('/?error=missing_tokens', baseUrl))
    }

    // Set credentials to fetch user info
    oauth2Client.setCredentials(tokens)

    // Get user email from Google
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client })
    const userInfo = await oauth2.userinfo.get()
    const accountEmail = userInfo.data.email

    if (!accountEmail) {
      console.error('Could not retrieve user email')
      return NextResponse.redirect(new URL('/?error=missing_email', baseUrl))
    }

    // Calculate token expiration time
    const expiresAt = tokens.expiry_date
      ? new Date(tokens.expiry_date).toISOString()
      : new Date(Date.now() + 3600 * 1000).toISOString() // Default 1 hour

    // Store tokens in Supabase using service client
    const supabase = createServiceClient()

    const tokenData: GmailTokenInsert = {
      account_email: accountEmail,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: expiresAt,
    }

    // UPSERT: Insert or update if email already exists
    const { error: dbError } = await supabase
      .from('gmail_tokens')
      .upsert(tokenData, {
        onConflict: 'account_email',
        ignoreDuplicates: false,
      })

    if (dbError) {
      console.error('Database error storing tokens:', dbError)
      return NextResponse.redirect(new URL('/?error=token_storage_failed', baseUrl))
    }

    // Store account email in cookie for client use
    cookieStore.set('gmail_account', accountEmail, {
      httpOnly: false, // Allow client-side access
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 30, // 30 days
      path: '/',
    })

    // Success - redirect to home
    return NextResponse.redirect(new URL('/', baseUrl))
  } catch (error) {
    console.error('Gmail OAuth callback error:', error)
    const message = error instanceof Error ? error.message : 'unknown_error'
    return NextResponse.redirect(new URL(`/?error=${encodeURIComponent(message)}`, baseUrl))
  }
}
