# Design Spec: Gerrards Phone & Referral App

**Date:** 2026-05-11
**Status:** Approved for implementation
**Builds on:** `Specs/gerrards-phone-referral-spec.md` (product spec v1.0)
**Stack:** Node.js 20 + Fastify + Prisma + PostgreSQL + EJS + Tailwind + Alpine.js
**Hosting:** Railway (1 web service + 1 Postgres addon)

---

## 1. Goal

Replace 7 per-staff GHL landing pages, forms, and workflow branches with a single shared web app. Onboarding a new salesperson becomes a single admin action. All leads continue to flow into GHL identically to today.

---

## 2. Current State Audit

**Current system (GHL — observed from screenshots):**

- **Per-staff forms:** Each staff member has a dedicated GHL form (e.g. "Phone Form Cohen - new") with their name hardcoded as the title. Form fields: First Name, Last Name, Phone, Email, Organization, Address (Google Places search), Street Address, City, State, Country, Postal Code, Lead Source (dropdown), Notes. Hidden fields: UTM Campaign, UTM Source, UTM Medium.

- **Lead Source dropdown values (confirmed from screenshot):** Phone Call, Client Referral, Professional Referral, Networking Referral, Facebook.

- **Master Phone and Referral Process workflow:** Condition node branches by which form was submitted. Each branch: Assign to user → Add Tag "phone/referral" → Custom Webhook (POST) → Create Or Update Opportunity.

- **Webhook payload (confirmed from screenshot):** Flat key-value pairs using GHL contact variables:
  ```
  first_name:      {{contact.first_name}}
  last_name:       {{contact.last_name}}
  phone:           {{contact.phone}}
  email:           {{contact.email}}
  business_name:   {{contact.company_name}}
  contact_notes:   {{contact.notes}}
  street_address:  {{contact.address1}}
  city:            {{contact.city}}
  state:           {{contact.state}}
  country:         {{contact.country}}
  post_code:       {{contact.postal_code}}
  ```
  Webhook URL example: `https://automation.bridgemedia.nz/webhook/9400c3a0-6433-42e5...`
  Method: POST, Authorization: None.

- **Pipeline/stage:** Same pipeline and stage for all 9 insurance categories (confirmed by user).

**Codebase:** Greenfield — repo contains only README.md and product spec. No existing code.

---

## 3. Spec Refinements

Changes from the product spec based on discovery:

| # | Product Spec Says | Design Says | Reason |
|---|-------------------|-------------|--------|
| 1 | Webhook payload is nested JSON (spec s8.2) | Flat key-value pairs matching GHL contact variables | Screenshot of actual Custom Webhook config shows flat keys. Downstream consumers expect this exact shape. |
| 2 | `ghl_pipeline_id` / `ghl_stage_id` on `insurance_categories` table | Two env vars: `GHL_PIPELINE_ID`, `GHL_STAGE_ID` | Same pipeline/stage for all categories — per-category columns are unnecessary complexity. |
| 3 | Lead Source is a string field on submissions | `lead_sources` table + FK on submissions | Admin-manageable dropdown values without code changes. |
| 4 | Session stored as signed cookie, no server-side store (spec s4.1.4) | `sessions` table in Postgres + session ID in signed cookie | The spec already defines a `sessions` table (s7.3). Server-side sessions allow: admin can see last login, session can be invalidated on user deactivation, and `last_seen_at` tracking. |

---

## 4. Proposed Architecture

### 4.1 File Structure

```
src/
├── server.js              # Fastify setup, plugins, cookie config, route registration
├── config.js              # Env var loading + validation
├── routes/
│   ├── auth.js            # GET /login, POST /login, GET /login/sent, GET /auth/:token, POST /logout
│   ├── landing.js         # GET / (category buttons, recent submissions link)
│   ├── submissions.js     # GET /new, POST /new, GET /submissions/:id, GET /my-submissions
│   └── admin/
│       ├── staff.js       # List, add, edit, deactivate staff
│       ├── categories.js  # List, add, edit, reorder, deactivate categories
│       ├── lead-sources.js # List, add, edit, deactivate lead sources
│       └── submissions.js # List (filterable), detail, retry failed step
├── services/
│   ├── auth.js            # Magic link generation, token verification, session create/destroy
│   ├── email.js           # Resend client — send magic link emails
│   ├── ghl.js             # GHL API client (upsert contact, add tag, create note, create opportunity, list users)
│   ├── webhook.js         # Per-staff webhook caller (flat payload)
│   └── submission-processor.js  # Orchestrates the 5-step submission pipeline
├── middleware/
│   ├── authenticate.js    # Reads session cookie → looks up session + user → attaches to request
│   └── authorize.js       # Checks user.role === 'ADMIN', returns 403 if not
├── views/
│   ├── layouts/
│   │   └── main.ejs       # Shared HTML layout (Tailwind CSS, nav, flash messages)
│   ├── login.ejs          # Email input form
│   ├── login-sent.ejs     # "Check your email" confirmation
│   ├── landing.ejs        # 9 category buttons grid
│   ├── form.ejs           # Lead capture form with Google Places
│   ├── confirmation.ejs   # Submission result (success or failure detail)
│   ├── my-submissions.ejs # Last 10 submissions by current user
│   └── admin/
│       ├── staff-list.ejs
│       ├── staff-edit.ejs
│       ├── categories.ejs
│       ├── lead-sources.ejs
│       ├── submissions-list.ejs
│       └── submission-detail.ejs
├── prisma/
│   ├── schema.prisma
│   └── seed.js            # Seeds: 9 categories, 5 lead sources, 1 admin user
└── public/
    ├── css/
    │   └── output.css     # Compiled Tailwind (committed, no prod build step)
    └── js/
        └── places.js      # Google Places Autocomplete → fills address fields
```

### 4.2 Prisma Schema (Modified)

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum Role {
  STAFF
  ADMIN
}

enum SubmissionStatus {
  PROCESSING
  COMPLETE
  FAILED
}

enum SubmissionStep {
  GHL_CONTACT
  GHL_TAG
  GHL_CONTACT_NOTE
  STAFF_WEBHOOK
  GHL_OPPORTUNITY
}

model User {
  id           String    @id @default(cuid())
  email        String    @unique
  name         String
  ghlUserId    String    @map("ghl_user_id")
  webhookUrl   String?   @map("webhook_url")
  role         Role      @default(STAFF)
  isActive     Boolean   @default(true) @map("is_active")
  lastLoginAt  DateTime? @map("last_login_at")
  createdAt    DateTime  @default(now()) @map("created_at")

  magicLinks   MagicLinkToken[]
  sessions     Session[]
  submissions  Submission[]

  @@map("users")
}

model MagicLinkToken {
  id         String    @id @default(cuid())
  tokenHash  String    @unique @map("token_hash")
  userId     String    @map("user_id")
  expiresAt  DateTime  @map("expires_at")
  usedAt     DateTime? @map("used_at")
  createdAt  DateTime  @default(now()) @map("created_at")

  user       User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@map("magic_link_tokens")
}

model Session {
  id          String   @id @default(cuid())
  userId      String   @map("user_id")
  expiresAt   DateTime @map("expires_at")
  lastSeenAt  DateTime @default(now()) @map("last_seen_at")
  userAgent   String?  @map("user_agent")
  createdAt   DateTime @default(now()) @map("created_at")

  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@map("sessions")
}

model InsuranceCategory {
  id            String   @id @default(cuid())
  slug          String   @unique
  label         String
  utmCampaign   String   @map("utm_campaign")
  sortOrder     Int      @default(0) @map("sort_order")
  isActive      Boolean  @default(true) @map("is_active")
  createdAt     DateTime @default(now()) @map("created_at")

  submissions   Submission[]

  @@map("insurance_categories")
}

model LeadSource {
  id          String   @id @default(cuid())
  label       String   @unique
  sortOrder   Int      @default(0) @map("sort_order")
  isActive    Boolean  @default(true) @map("is_active")
  createdAt   DateTime @default(now()) @map("created_at")

  submissions Submission[]

  @@map("lead_sources")
}

model Submission {
  id                    String            @id @default(cuid())
  salespersonUserId     String            @map("salesperson_user_id")
  insuranceCategoryId   String            @map("insurance_category_id")
  leadSourceId          String            @map("lead_source_id")

  leadFirstName         String            @map("lead_first_name")
  leadLastName          String            @map("lead_last_name")
  leadEmail             String            @map("lead_email")
  leadPhone             String            @map("lead_phone")
  organisation          String?
  addressLine           String?           @map("address_line")
  city                  String?
  state                 String?
  country               String?           @default("NZ")
  postalCode            String?           @map("postal_code")
  notes                 String

  status                SubmissionStatus  @default(PROCESSING)
  ghlContactId          String?           @map("ghl_contact_id")
  ghlOpportunityId      String?           @map("ghl_opportunity_id")
  webhookResponseStatus Int?              @map("webhook_response_status")

  createdAt             DateTime          @default(now()) @map("created_at")
  completedAt           DateTime?         @map("completed_at")

  salesperson           User              @relation(fields: [salespersonUserId], references: [id])
  category              InsuranceCategory @relation(fields: [insuranceCategoryId], references: [id])
  leadSource            LeadSource        @relation(fields: [leadSourceId], references: [id])
  events                SubmissionEvent[]

  @@index([salespersonUserId])
  @@index([createdAt])
  @@index([status])
  @@map("submissions")
}

model SubmissionEvent {
  id              String          @id @default(cuid())
  submissionId    String          @map("submission_id")
  step            SubmissionStep
  succeeded       Boolean
  responseStatus  Int?            @map("response_status")
  responseBody    String?         @map("response_body")
  errorMessage    String?         @map("error_message")
  createdAt       DateTime        @default(now()) @map("created_at")

  submission      Submission      @relation(fields: [submissionId], references: [id], onDelete: Cascade)

  @@index([submissionId])
  @@map("submission_events")
}
```

**Changes from product spec schema:**
- `InsuranceCategory`: removed `ghlPipelineId` and `ghlStageId` (env vars instead)
- Added `LeadSource` model (NEW)
- `Submission`: changed `leadSource String` to `leadSourceId String` FK to `LeadSource` (CHANGED)
- `Submission`: added `country @default("NZ")` (spec says default NZ)

### 4.3 Environment Variables

```env
# Database
DATABASE_URL=postgresql://...

# App
APP_URL=https://phone.gerrards.co.nz
COOKIE_SECRET=<random 64-char hex>
PORT=3000

# GHL
GHL_API_KEY=<private integration token>
GHL_LOCATION_ID=<GHL location/sub-account ID>
GHL_PIPELINE_ID=<opportunity pipeline ID>
GHL_STAGE_ID=<opportunity stage ID>

# Resend
RESEND_API_KEY=<resend api key>
EMAIL_FROM=noreply@gerrards.co.nz

# Google Places
GOOGLE_PLACES_API_KEY=<places api key>
```

### 4.4 Submission Processing Pipeline

```
submission-processor.js

async function processSubmission(submissionId, prisma, ghlService, webhookService) {
  const submission = await prisma.submission.findUnique({...include salesperson, category, leadSource})

  // Step 1: GHL Upsert Contact (FATAL)
  const contactResult = await executeStep(submissionId, 'GHL_CONTACT', async () => {
    return ghlService.upsertContact({
      firstName: submission.leadFirstName,
      lastName: submission.leadLastName,
      phone: submission.leadPhone,
      email: submission.leadEmail,
      companyName: submission.organisation,
      address1: submission.addressLine,
      city: submission.city,
      state: submission.state,
      country: submission.country,
      postalCode: submission.postalCode,
      source: submission.leadSource.label,
      assignedTo: submission.salesperson.ghlUserId,
      tags: ['phone/referral'],
      customFields: {
        utm_campaign: submission.category.utmCampaign,
        utm_source: 'Phone_Referral',
        utm_medium: 'Internal'
      }
    })
  })
  if (!contactResult.success) return markFailed(submissionId)
  const contactId = contactResult.data.id
  await prisma.submission.update({ where: { id: submissionId }, data: { ghlContactId: contactId } })

  // Step 2: GHL Add Tag (FATAL)
  const tagResult = await executeStep(submissionId, 'GHL_TAG', () =>
    ghlService.addTag(contactId, 'phone/referral')
  )
  if (!tagResult.success) return markFailed(submissionId)

  // Step 3: GHL Create Note (NON-FATAL)
  await executeStep(submissionId, 'GHL_CONTACT_NOTE', () =>
    ghlService.createNote(contactId, formatNote(submission))
  )

  // Step 4: Staff Webhook (NON-FATAL)
  if (submission.salesperson.webhookUrl) {
    const webhookResult = await executeStep(submissionId, 'STAFF_WEBHOOK', () =>
      webhookService.send(submission.salesperson.webhookUrl, {
        first_name: submission.leadFirstName,
        last_name: submission.leadLastName,
        phone: submission.leadPhone,
        email: submission.leadEmail,
        business_name: submission.organisation || '',
        contact_notes: submission.notes,
        street_address: submission.addressLine || '',
        city: submission.city || '',
        state: submission.state || '',
        country: submission.country || '',
        post_code: submission.postalCode || ''
      })
    )
    await prisma.submission.update({
      where: { id: submissionId },
      data: { webhookResponseStatus: webhookResult.status }
    })
  }

  // Step 5: GHL Create Opportunity (FATAL)
  const oppResult = await executeStep(submissionId, 'GHL_OPPORTUNITY', () =>
    ghlService.createOpportunity({
      pipelineId: config.GHL_PIPELINE_ID,
      stageId: config.GHL_STAGE_ID,
      contactId,
      assignedTo: submission.salesperson.ghlUserId,
      name: `${submission.leadFirstName} ${submission.leadLastName} - ${submission.category.label}`
    })
  )
  if (!oppResult.success) return markFailed(submissionId)
  await prisma.submission.update({
    where: { id: submissionId },
    data: { ghlOpportunityId: oppResult.data.id, status: 'COMPLETE', completedAt: new Date() }
  })
}
```

### 4.5 Webhook Payload (Flat — Matches Current GHL Workflow)

```json
{
  "first_name": "Jane",
  "last_name": "Smith",
  "phone": "+64211234567",
  "email": "jane@example.com",
  "business_name": "Smith Ltd",
  "contact_notes": "Called about car fleet insurance...",
  "street_address": "123 Queen St",
  "city": "Auckland",
  "state": "Auckland",
  "country": "NZ",
  "post_code": "1010"
}
```

### 4.6 Auth Flow

```
GET /login                → Render email input form
POST /login               → Look up user by email (case-insensitive)
                            If not found or inactive: still show "check your email" (no enumeration)
                            If found: generate 32-byte random token, store SHA-256 hash with 15min expiry
                            Send magic link via Resend: {APP_URL}/auth/{raw_token}
                            Redirect to GET /login/sent

GET /auth/:token          → Hash the token, look up magic_link_tokens by token_hash
                            If not found, expired, or already used: show error
                            If valid: mark used_at, create session (30 day expiry),
                            update user.lastLoginAt, set signed session cookie,
                            redirect to GET /

POST /logout              → Delete session row, clear cookie, redirect to /login

authenticate middleware   → Read session ID from signed cookie
                            Look up session, check not expired
                            Update lastSeenAt
                            Attach user to request
                            If invalid: clear cookie, redirect to /login
```

### 4.7 Admin Retry Mechanism

The submission detail page shows all `submission_events` for a submission. For failed events, a "Retry" button POSTs to `POST /admin/submissions/:id/retry/:step`. This re-executes just that one step using the same submission data and logs a new event. For `GHL_CONTACT` retries, it also updates `ghlContactId` on success. If all steps now have at least one successful event, the submission status is updated to `COMPLETE`.

---

## 5. Interface Contracts

All NEW — greenfield project.

### 5.1 Routes

| Method | Path | Auth | Handler |
|--------|------|------|---------|
| GET | `/login` | Public | `routes/auth.js` (NEW) |
| POST | `/login` | Public | `routes/auth.js` (NEW) |
| GET | `/login/sent` | Public | `routes/auth.js` (NEW) |
| GET | `/auth/:token` | Public | `routes/auth.js` (NEW) |
| POST | `/logout` | Staff | `routes/auth.js` (NEW) |
| GET | `/` | Staff | `routes/landing.js` (NEW) |
| GET | `/new` | Staff | `routes/submissions.js` (NEW) |
| POST | `/new` | Staff | `routes/submissions.js` (NEW) |
| GET | `/submissions/:id` | Staff (own) | `routes/submissions.js` (NEW) |
| GET | `/my-submissions` | Staff | `routes/submissions.js` (NEW) |
| GET | `/admin/staff` | Admin | `routes/admin/staff.js` (NEW) |
| GET | `/admin/staff/new` | Admin | `routes/admin/staff.js` (NEW) |
| POST | `/admin/staff` | Admin | `routes/admin/staff.js` (NEW) |
| GET | `/admin/staff/:id` | Admin | `routes/admin/staff.js` (NEW) |
| POST | `/admin/staff/:id` | Admin | `routes/admin/staff.js` (NEW) |
| POST | `/admin/staff/:id/deactivate` | Admin | `routes/admin/staff.js` (NEW) |
| GET | `/admin/categories` | Admin | `routes/admin/categories.js` (NEW) |
| POST | `/admin/categories` | Admin | `routes/admin/categories.js` (NEW) |
| POST | `/admin/categories/:id` | Admin | `routes/admin/categories.js` (NEW) |
| GET | `/admin/lead-sources` | Admin | `routes/admin/lead-sources.js` (NEW) |
| POST | `/admin/lead-sources` | Admin | `routes/admin/lead-sources.js` (NEW) |
| GET | `/admin/submissions` | Admin | `routes/admin/submissions.js` (NEW) |
| GET | `/admin/submissions/:id` | Admin | `routes/admin/submissions.js` (NEW) |
| POST | `/admin/submissions/:id/retry/:step` | Admin | `routes/admin/submissions.js` (NEW) |
| GET | `/health` | Public | `server.js` (NEW) |

### 5.2 Services

| Service | Method | Signature | Notes |
|---------|--------|-----------|-------|
| `auth.js` | `generateMagicLink(userId)` | → `{ token, expiresAt }` | Stores SHA-256 hash in DB |
| `auth.js` | `verifyMagicLink(rawToken)` | → `User \| null` | Marks token used |
| `auth.js` | `createSession(userId, userAgent)` | → `sessionId` | 30-day expiry |
| `auth.js` | `destroySession(sessionId)` | → `void` | Deletes row |
| `auth.js` | `getSessionUser(sessionId)` | → `User \| null` | Checks expiry, updates lastSeenAt |
| `email.js` | `sendMagicLink(email, url)` | → `{ success }` | Via Resend |
| `ghl.js` | `upsertContact(data)` | → `{ id }` | POST /contacts/upsert |
| `ghl.js` | `addTag(contactId, tag)` | → `void` | POST /contacts/:id/tags |
| `ghl.js` | `createNote(contactId, body)` | → `void` | POST /contacts/:id/notes |
| `ghl.js` | `createOpportunity(data)` | → `{ id }` | POST /opportunities/ |
| `ghl.js` | `listUsers()` | → `User[]` | GET /users/ (admin helper) |
| `webhook.js` | `send(url, payload)` | → `{ status }` | POST flat JSON, no auth |
| `submission-processor.js` | `processSubmission(id)` | → `void` | Orchestrates 5 steps |

---

## 6. Seed Data

### 6.1 Insurance Categories

| slug | label | utm_campaign | sort_order |
|------|-------|-------------|------------|
| car_insurance | Car Insurance | car_insurance | 1 |
| property_insurance | Property Insurance | property_insurance | 2 |
| business_liability | Business Liability | business_liability | 3 |
| truck_insurance | Truck Insurance | truck_insurance | 4 |
| plant_contents | Plant & Contents | plant_contents | 5 |
| stock_inventory | Stock & Inventory | stock_inventory | 6 |
| cyber_insurance | Cyber Insurance | cyber_insurance | 7 |
| management | Management | management | 8 |
| life_health | Life & Health | life_health | 9 |

### 6.2 Lead Sources

| label | sort_order |
|-------|------------|
| Phone Call | 1 |
| Client Referral | 2 |
| Professional Referral | 3 |
| Networking Referral | 4 |
| Facebook | 5 |

### 6.3 Initial Admin User

Seeded via `prisma/seed.js` using env vars `ADMIN_EMAIL`, `ADMIN_NAME`, `ADMIN_GHL_USER_ID`. No webhook URL required for admin.

---

## 7. Observable Truths

1. **Truth:** A staff member can log in via magic link and submit a lead form
   **Verification:** Complete the full flow on the deployed app — login email → click link → select category → fill form → submit
   **Expected:** Confirmation page shows status COMPLETE

2. **Truth:** GHL contact is created with correct assignment, tag, and opportunity
   **Verification:** After submission, check GHL CRM for the contact — verify `assignedTo`, tags include "phone/referral", opportunity exists in correct pipeline/stage
   **Expected:** All match the submitting staff member's config

3. **Truth:** Per-staff webhook fires with flat payload matching current GHL workflow
   **Verification:** Use webhook.site or request.bin as a staff member's webhook URL, submit a lead, inspect the received payload
   **Expected:** Flat keys: first_name, last_name, phone, email, business_name, contact_notes, street_address, city, state, country, post_code

4. **Truth:** Admin can onboard a new staff member with a single action
   **Verification:** Admin panel → Add Staff → enter name, email, GHL user ID, webhook URL → save → new user can log in
   **Expected:** New user appears in staff list, can receive magic link, can submit leads

5. **Truth:** Failed steps are logged and retryable
   **Verification:** Temporarily use an invalid webhook URL → submit → check admin submission detail → click Retry on the failed webhook event
   **Expected:** Failed event logged with error details; retry creates new event; if retry succeeds, status updates

6. **Truth:** Submission events provide full audit trail
   **Verification:** `SELECT * FROM submission_events WHERE submission_id = '<test-id>' ORDER BY created_at`
   **Expected:** 5 rows (one per step), each with succeeded, response_status, response_body

---

## 8. Falsifiable Assumptions

| # | Assumption | Verification | Result |
|---|-----------|-------------|--------|
| 1 | Inline processing completes in <4s | Time 4 sequential GHL API calls + 1 webhook POST | UNVERIFIED — depends on GHL API latency. Mitigated: if >4s, add a "processing..." interstitial and use async processing. Low risk at 7 users. |
| 2 | GHL upsert endpoint accepts `assignedTo` field | Check GHL API docs for `/contacts/upsert` payload | TO VERIFY AT BUILD START — endpoint path and field names must be confirmed against current GHL API version |
| 3 | GHL tag can be included in upsert or requires separate call | Check GHL API docs | TO VERIFY AT BUILD START — affects whether step 2 (tag) is a separate HTTP call or merged into step 1 |
| 4 | Resend delivers to NZ email addresses within 30s | Test with actual Resend account and NZ mailboxes | TO VERIFY AT BUILD START |
| 5 | Railway free/dev tier supports persistent Postgres | Check Railway pricing page | TO VERIFY — Railway has changed pricing tiers; confirm Postgres addon is available |
| 6 | Google Places Autocomplete JS API works with API key restriction to the app domain | Standard Google Maps Platform behavior | VERIFIED — standard approach, domain-restricted API keys are supported |
| 7 | 7 concurrent users will not hit GHL rate limits | Check GHL rate limit docs | LOW RISK — 7 users submitting serially; unlikely to hit limits |
| 8 | `@fastify/csrf-protection` works with EJS server-rendered forms | Check Fastify CSRF plugin docs | TO VERIFY — may need `@fastify/formbody` registered first |

---

## 9. System Invariants

1. **Every submission must have a complete event log.** Every step (GHL_CONTACT, GHL_TAG, GHL_CONTACT_NOTE, STAFF_WEBHOOK, GHL_OPPORTUNITY) must produce a `submission_events` row, whether it succeeded or failed. No silent failures.

2. **Session-based identity is authoritative.** The salesperson on a submission is always the authenticated user, never a form field. No form field can override `salespersonUserId`.

3. **Webhook payload shape must match current GHL workflow exactly.** The flat key names (`first_name`, `last_name`, `business_name`, `contact_notes`, `street_address`, `post_code`) must be preserved — downstream consumers depend on them.

4. **Deactivated entities are preserved, not deleted.** Deactivated users, categories, and lead sources remain in the database. Historical submissions continue to reference them. Only `isActive` changes.

5. **Magic link tokens are single-use and time-limited.** A token used once cannot be used again. A token older than 15 minutes cannot be used. Tokens are stored as SHA-256 hashes, never as plaintext.

6. **Admin routes are server-side role-gated.** No admin functionality is accessible by checking a client-side flag. The `authorize` middleware checks `user.role === 'ADMIN'` on every admin route.

---

## 10. Wiring Requirements

| Concern | Action Needed |
|---------|---------------|
| New Fastify app | `server.js`: register `@fastify/cookie`, `@fastify/formbody`, `@fastify/csrf-protection`, `@fastify/static`, `@fastify/view` (EJS). Register all route files. |
| CSRF on POST routes | Every EJS form must include `<input type="hidden" name="_csrf" value="<%= csrfToken %>">`. Every POST handler must validate. |
| Session middleware | `authenticate.js` registered as `preHandler` on all non-public routes. |
| Admin middleware | `authorize.js` registered as `preHandler` on all `/admin/*` routes (after authenticate). |
| Health check | `GET /health` returns `{ status: 'ok' }` — no auth, no middleware. |
| Prisma client | Instantiated once in `server.js`, passed to route handlers via Fastify `decorate`. |
| Tailwind build | Dev: `npx tailwindcss -i src/input.css -o public/css/output.css --watch`. Prod: compiled CSS committed. |
| Railway deploy | `Procfile` or Railway config: `node src/server.js`. Prisma migrate on deploy: `prisma migrate deploy && node src/server.js`. |
| Google Places | `places.js` loaded only on form page. API key injected via EJS template variable (from server config). |

---

## 11. Build Sequence

| Day | Deliverable | Dependency |
|-----|-------------|------------|
| 1 | Fastify boilerplate, Prisma schema + initial migration, seed script, Resend integration, magic-link auth (login → email → click → session → landing page placeholder) | GHL API key not needed yet |
| 2 | Landing page (9 category buttons from DB), lead form (all fields + Google Places autocomplete), form POST writes submission to DB (status PROCESSING, no external calls yet) | Google Places API key needed |
| 3 | GHL service (upsert contact, add tag, create note, create opportunity), submission processor wired up, event logging. Test end-to-end with one staff member. | GHL API key + location ID needed. Verify API endpoint paths. |
| 4 | Webhook service (flat payload POST), full end-to-end flow working. Confirmation page shows result. My-submissions page. | Per-staff webhook URLs needed |
| 5 | Admin panel: staff CRUD (with GHL user picker), categories CRUD (reorder), lead sources CRUD | — |
| 6 | Admin panel: submissions list (filterable), submission detail (event log), retry failed step | — |
| 7 | Mobile responsive pass, Railway deploy, custom domain setup, run real test submissions through full pipeline, handover notes | Railway account, domain DNS access |

---

## 12. Dependencies to Gather Before Day 1

| # | Item | Who Provides | Blocks |
|---|------|-------------|--------|
| 1 | GHL Private Integration token (scopes: contacts.write, contacts/notes.write, opportunities.write, users.readonly) | Greg / Marcus | Day 3 |
| 2 | GHL Location ID | Greg / Marcus | Day 3 |
| 3 | GHL Pipeline ID and Stage ID | Greg / Marcus | Day 3 |
| 4 | 7 per-staff webhook URLs from old workflow | Greg / Marcus | Day 4 (for seeding) |
| 5 | Staff list: name, email, GHL user ID for each of the 7 staff | Greg / Marcus | Day 4 (for seeding) |
| 6 | Resend API key + verified sending domain (noreply@gerrards.co.nz) | Greg | Day 1 |
| 7 | Google Places API key | Greg | Day 2 |
| 8 | Railway account | Greg | Day 7 |
| 9 | DNS access for custom domain (phone.gerrards.co.nz or similar) | Greg | Day 7 |
