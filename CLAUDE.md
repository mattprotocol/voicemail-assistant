# Voicemail Assistant

Voice-first PWA for triaging Superhuman email while driving.

## Project Overview

This is a Next.js 14+ application with:
- **Frontend**: Next.js App Router, React, TypeScript, Tailwind CSS
- **Backend**: Supabase (PostgreSQL + Auth)
- **Voice**: Vapi for voice interactions
- **Email**: Gmail API integration via Superhuman-style interface

## Directory Structure

```
src/
├── app/              # Next.js App Router pages
├── components/       # React components
├── lib/              # Utilities, Supabase clients
├── hooks/            # Custom React hooks
└── types/            # TypeScript types
```

## Key Commands

```bash
npm run dev          # Start development server
npm run build        # Production build
npm run lint         # Run ESLint
```

## Environment Variables

See `.env.example` for required environment variables.

## Development Notes

- Use Server Components by default
- Add `'use client'` only when needed (hooks, event handlers, browser APIs)
- Always enable RLS on Supabase tables
- Run `/security-check` before commits
