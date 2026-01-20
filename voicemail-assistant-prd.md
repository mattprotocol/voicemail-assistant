# Product Requirements Document: VoiceMail Assistant

## 1. Overview

### 1.1 Product Summary
A voice-first mobile application that allows users to triage their Superhuman email inbox while on the go (primarily driving). The app reads emails aloud, accepts voice commands for actions, and maintains sync with Superhuman's inbox state.

### 1.2 Target User
Single user with 3 Google Workspace accounts, using Superhuman as primary email client.

### 1.3 Core Value Proposition
Process email efficiently during otherwise unproductive time (commuting, driving) while maintaining the Superhuman workflow and inbox organization.

---

## 2. Technical Architecture

### 2.1 Hybrid Integration Approach

Superhuman has no public API. Their AI-generated labels and Split Inbox prioritization exist only in Superhuman's proprietary layer, not in Gmail. This requires a hybrid approach.

**Browser Automation (Playwright/Puppeteer) handles:**
- Reading inbox order from Superhuman (AI-prioritized view)
- Creating/saving drafts in Superhuman (Gmail drafts do NOT sync to Superhuman)
- Session management for 3 accounts

**Gmail API handles:**
- Archive thread
- Delete thread
- Send email
- Search emails
- Read email content (thread body, attachments)
- Mark read/unread
- Star/unstar
- Apply labels

### 2.2 Voice Interface
Conversational AI approach using Vapi (or similar). Natural language understanding for flexible command interpretation, dictation for reply composition. Wake method: manual button press (no wake word).

### 2.3 Platform
- Mobile-first (iOS initially, Android follow-on)
- Web app fallback acceptable

---

## 3. Data Model and Mapping

### 3.1 Required Identifiers Per Email Item
- `accountId` - which of the 3 accounts
- `superhumanQueuePosition` - order in Superhuman inbox at snapshot time
- `gmailThreadId` - Gmail thread ID for API operations
- `gmailMessageId` - specific message within thread (for "newest unread")

### 3.2 Mapping Strategy
When scraping Superhuman inbox, extract enough metadata (sender, subject, timestamp) to match against Gmail API query results. If exact match fails, fall back to reading content directly from Superhuman view for that item.

### 3.3 Technical Validation Required
Before full build, inspect Superhuman's DOM to determine if Gmail thread IDs are exposed (in data attributes, URLs, or network requests). If not, implement fuzzy matching on sender + subject + timestamp.

---

## 4. Account Management

### 4.1 Simultaneous Authentication
- All 3 accounts authenticated at app setup
- 3 concurrent Superhuman browser sessions maintained server-side
- 3 Gmail API refresh tokens stored
- No re-authentication during normal use

### 4.2 Account Switching
- Voice command: "Switch to [Personal/Downeast/Protocol]"
- Instant switch (< 1 second)
- Each account maintains its own queue snapshot and position
- Switching mid-session preserves state on the account you're leaving

### 4.3 Session Management
- Background session health checks
- If a session expires, attempt silent refresh
- Only prompt user if refresh fails after retries

---

## 5. Session Semantics

### 5.1 Snapshot Mode
- Capture queue at session start
- Process deterministically through that list
- New mail arriving mid-session is not included
- User can say "Refresh queue" to get updated snapshot
- Position is stable and predictable

### 5.2 Conflict Handling
- If user archives an email on desktop Superhuman during mobile session, the app will attempt the action via Gmail API and it will succeed (already archived = no-op)
- If email is deleted elsewhere, Gmail API returns error → app says "This email was already handled" and moves to next

### 5.3 Resume Behavior
- Position stored per account
- On resume: "You were on email 7 of 23. That email has been [archived/is still pending]. Continue from here?"
- If inbox has changed significantly, offer "Start fresh with updated queue?"

---

## 6. User Flows

### 6.1 Session Start
1. User opens app, presses "Start" button
2. App prompts: "Which account? Personal, Downeast, or Protocol?"
3. User selects account by voice
4. App retrieves Superhuman inbox order via browser automation (snapshot)
5. App announces: "You have [X] unread emails. Starting with the most recent."

### 6.2 Email Triage Loop
For each email thread:

1. **Announce metadata:** "Email from [sender], subject: [subject], received [relative time]"

2. **Read content:**
   - Short emails (< ~150 words): Read in full
   - Long emails: Provide AI summary (2-3 sentences), then "Say 'read more' for full content."

3. **Wait for command**

4. **Execute action, confirm, move to next**

### 6.3 Search Flow
At any point, user can say "Search for [query]"
- App searches via Gmail API within current account
- Returns results: "Found [X] emails matching [query]. The most recent is from [sender] about [subject]. Want me to read it?"
- User can triage search results or say "back to inbox"

### 6.4 Reply/Reply All Flow
1. User says "Reply" or "Reply all"
2. Superhuman browser automation clicks Reply/Reply All (auto-populates recipients)
3. App: "Go ahead with your message."
4. User dictates message
5. App reads back: "Your reply says: [message]"
6. User chooses: "Send", "Edit", or "Save as draft"

**If Send:**
7. App: "Sending to [recipient names with email addresses]. Say 'confirm' to send."
8. User: "Confirm"
9. App sends via Gmail API
10. App: "Sent."

**If Save as Draft:**
7. App saves via Superhuman browser automation
8. App: "Draft saved."

**If Edit:**
7. App: "What would you like to change?"
8. User re-dictates or provides specific edit
9. Return to step 5

### 6.5 Forward Flow
1. User says "Forward"
2. App: "Who should I forward to?"
3. User provides recipient (name or email)
4. App: "Forwarding to [recipient]. Go ahead with your message, or say 'send' to forward without adding anything."
5. [Optional dictation]
6. App: "Forwarding to [recipient]. Your message says: [message or 'no additional message']. Say 'confirm' to send."
7. User: "Confirm"
8. App sends via Gmail API
9. App: "Forwarded."

### 6.6 Attachment Handling
When email has attachments:
1. App announces: "This email has [X] attachments: [list names and types]"
2. User can say "Read attachment [name/number]"
3. App provides:
   - PDFs/docs: AI summary (capped at ~500 words extracted text)
   - Images: Basic description via vision model
   - Spreadsheets: Overview only ("This spreadsheet has 3 sheets...")
   - Everything else: "This has a [type] attachment. I can't read it aloud, but it's waiting for you."

### 6.7 Thread Navigation
- Default: Read newest unread message in thread
- "Go back" / "Previous message": Read earlier message in thread
- "Summarize thread": AI summary of full thread history

### 6.8 Session Pause/Resume
- User can say "Stop" or close app
- App stores position in inbox queue per account
- Next session: "You have [X] remaining unread in [Account] inbox. Pick up where you left off, or start fresh?"

---

## 7. Voice Commands

### 7.1 Navigation Commands
| Command | Action |
|---------|--------|
| "Next" / "Skip" | Move to next email without action |
| "Search for [query]" | Search within current account |
| "Back to inbox" | Return to inbox queue from search |
| "Switch to [account]" | Change active account |
| "Refresh queue" | Get updated Superhuman inbox snapshot |
| "Stop" / "Done" | End session |

### 7.2 Email Actions
| Command | Action |
|---------|--------|
| "Archive" | Archive thread via Gmail API |
| "Delete" | Delete thread via Gmail API (requires confirmation) |
| "Reply" | Start reply composition |
| "Reply all" | Start reply-all composition |
| "Forward" | Start forward (prompts for recipient) |
| "Label as [label]" | Apply existing label |
| "Star" / "Flag" | Star the thread |
| "Mark unread" | Mark as unread for later |

### 7.3 Content Commands
| Command | Action |
|---------|--------|
| "Read more" / "Full email" | Read complete email content |
| "Read attachment [X]" | Read/summarize attachment |
| "Go back" / "Previous message" | Read earlier message in thread |
| "Summarize thread" | AI summary of full thread |
| "Repeat" | Re-read current content |
| "Who is this from?" | Provide sender details |

### 7.4 Composition Commands
| Command | Action |
|---------|--------|
| "Send" | Send the composed message (requires confirmation) |
| "Save as draft" | Save draft in Superhuman |
| "Edit" | Modify the composed message |
| "Cancel" | Discard composition |
| "Read it back" | Hear the composed message |

### 7.5 Utility Commands
| Command | Action |
|---------|--------|
| "Undo" | Undo last action (15-second window) |
| "Help" | List available commands |
| "How many left?" | Report remaining unread count |

---

## 8. Confirmation and Undo Rules

### 8.1 Confirmation Matrix

| Action | Confirmation Required | Undo Available | Undo Window |
|--------|----------------------|----------------|-------------|
| Archive | No | Yes | 15 seconds |
| Delete | Yes | Yes | 15 seconds |
| Send | Yes ("Say 'confirm' to send") | No | N/A |
| Save draft | No | No | Edit in Superhuman |
| Label | No | Yes | 15 seconds |
| Star | No | Yes | 15 seconds |
| Mark unread | No | Yes | 15 seconds |

### 8.2 Undo Implementation
- Track last action with timestamp and reversal method
- If user says "Undo" within 15 seconds, reverse via Gmail API
- After 15 seconds: "Too late to undo that one"
- Single action depth only (last action)

### 8.3 Send Confirmation Flow
All send actions require explicit two-step confirmation:
1. App states recipients with email addresses
2. User must say "Confirm" (or similar affirmative)
3. Any other response cancels or allows edit

---

## 9. Offline and Connectivity

### 9.1 What Works Offline
- Voice input captured and queued locally
- Action intents queued (archive thread X, delete thread Y)

### 9.2 What Requires Connectivity
- Email content fetching
- AI summarization
- Draft creation in Superhuman
- Send

### 9.3 Reconnection Flow
- Queued actions execute in order
- For queued "send" commands: require re-confirmation after reconnect ("You wanted to send a reply to John. Still want to send?")

### 9.4 Connectivity Loss During Dictation
- Buffer locally
- On reconnect: "I captured your message. Want me to read it back before sending?"

### 9.5 Cell-to-WiFi Handoff
- Handle transitions seamlessly
- Retry failed requests automatically
- Notify user only if action fails after retries

---

## 10. Security and Retention

### 10.1 OAuth Tokens
- Stored encrypted at rest
- Refresh tokens per account, isolated
- Least-privilege scopes

### 10.2 Gmail API Scopes Required
- `gmail.readonly` - read email content
- `gmail.modify` - archive, delete, labels, read status
- `gmail.send` - send email
- `gmail.compose` - create drafts (fallback)

### 10.3 Email Content
- Not persisted beyond session
- Summaries generated on-demand, not stored
- No long-term storage of email bodies

### 10.4 Attachments
- Processed in memory, not retained
- Size limit: 10MB per attachment for processing
- Extracted text discarded after summarization

### 10.5 Voice Provider
- Review data retention policy before selection
- Prefer providers that don't retain conversation audio
- Document what content is sent to third parties

---

## 11. AI Capabilities Required

### 11.1 Email Summarization
- Summarize emails > 150 words into 2-3 sentences
- Summarize full threads on request
- Maintain key information: action items, deadlines, questions

### 11.2 Attachment Analysis
- PDF text extraction and summarization
- Google Docs text extraction and summarization
- Image description via vision model
- Spreadsheet structure overview

### 11.3 Intent Classification
- Parse natural language commands into structured actions
- Handle variations ("archive this", "file it away", "done with this")
- Disambiguate when unclear

### 11.4 Recipient Resolution (Future)
- Match spoken names to contacts
- Suggest corrections for misheard emails

---

## 12. MVP Phasing

### 12.1 MVP v1 (Ship First)
- Account selection and instant switching
- Snapshot Superhuman queue via browser automation
- Map to Gmail thread IDs
- Fetch content via Gmail API
- Summarize long emails, read short ones
- Actions: archive, delete, mark unread, star
- Reply/Reply All: dictate → read back → save as draft OR send
- Forward: with recipient input
- Resume per account
- Undo for reversible actions (15-second window)
- Basic attachment announcements (names and types)

### 12.2 MVP v1.1
- Search within account
- Labeling via Gmail API
- Attachment summaries (PDF, docs, images)
- "Read more" with chunking for very long emails
- Thread summarization

### 12.3 Future
- Complex attachment handling (spreadsheet queries, calendar invite actions)
- Cross-account search
- Contact lookup
- Proactive notifications
- CarPlay deep integration

---

## 13. Technical Stack (Recommended)

### 13.1 Backend
- Node.js or Python service
- Playwright for Superhuman browser automation
- Google APIs Node.js client for Gmail
- Redis or similar for session state
- Queue system for offline action sync

### 13.2 Voice
- Vapi or similar conversational AI platform
- Evaluate: latency, NLU quality, cost, data retention policy

### 13.3 AI
- Claude API or OpenAI for summarization and intent parsing
- Vision model for image descriptions

### 13.4 Mobile
- React Native or Flutter for cross-platform
- Native audio session handling for background playback
- Simple UI: large start button, minimal status display

### 13.5 Infrastructure
- Headless browser hosting (dedicated server or cloud function with persistent context)
- Secure credential storage (Vault, AWS Secrets Manager, or similar)

---

## 14. Success Metrics

- Emails triaged per session
- Session duration
- Action accuracy (commands correctly interpreted)
- Draft completion rate (drafts started vs. sent)
- User-reported time savings
- Automation reliability (Superhuman session success rate)

---

## 15. Open Questions for Development

1. **Superhuman DOM inspection:** Can we reliably extract Gmail thread IDs from Superhuman's interface? Need to inspect network requests and DOM attributes.

2. **Vapi vs. alternatives:** Evaluate latency, cost, NLU quality, and data retention policies.

3. **Superhuman session stability:** How often do sessions expire? Test maintaining 3 concurrent sessions over 24-48 hours.

4. **Voice persona:** Default to neutral professional voice; make configurable later.

5. **Error recovery:** Define specific retry logic for each failure mode (network, auth, API rate limits).

---

## Appendix A: Sync Behavior Summary

| Feature | Syncs to Gmail | Syncs to Superhuman | Method |
|---------|---------------|---------------------|--------|
| Archive | Yes | Yes (via Gmail) | Gmail API |
| Delete | Yes | Yes (via Gmail) | Gmail API |
| Send | Yes | Yes (via Gmail) | Gmail API |
| Read/Unread | Yes | Yes (via Gmail) | Gmail API |
| Star | Yes | Yes (via Gmail) | Gmail API |
| Gmail Labels | Yes | Partial (visible but not AI-applied) | Gmail API |
| Superhuman Labels | No | Yes | Browser automation |
| Drafts | No | Yes | Browser automation |
| Inbox Order | No | N/A (Superhuman-only) | Browser automation (read) |

---

## Appendix B: Error Messages

| Situation | App Says |
|-----------|----------|
| Email already handled | "This email was already handled. Moving to the next one." |
| Network lost mid-action | "I lost connection. I'll retry when you're back online." |
| Send failed | "I couldn't send that. Want me to try again or save as draft?" |
| Session expired | "I need to reconnect to [account]. One moment... Done." |
| Session expired (manual needed) | "I need you to re-authenticate [account]. Opening settings." |
| Undo too late | "Too late to undo that one." |
| No more emails | "You've reached the end of your inbox. Nice work!" |
| Search no results | "I didn't find any emails matching [query]. Try different keywords?" |
