# Product Spec: Gerrards Phone & Referral App

**Version:** 1.0 — Draft
**Status:** Ready for build
**Owner:** Greg / Marcus, Gerrards Insurance
**Replaces:** Master Phone and Referral Process (GHL workflow) + 7 per-staff landing pages and forms
**Hosting:** Railway
**Effort estimate:** 5–7 working days, one developer

---

## 1. Background

Gerrards Insurance currently operates a per-staff-member system for capturing leads from inbound phone calls and referrals. Each salesperson has:

- Their own landing page (e.g. `/cohen-phone-and-referral`) with nine insurance-category buttons, each carrying a UTM campaign value identifying the category.
- Their own form (e.g. `/cohen-form`) with the staff member's name hardcoded as the title.
- Their own trigger and condition branch in the Master Phone and Referral Process GHL workflow.
- Their own Custom Webhook node in that workflow, pointing at a per-staff URL.

Onboarding a new staff member requires building a new landing page, a new form, adding a new trigger to the GHL workflow, wiring up a new condition branch, configuring a new assignment step, a new tag step, a new webhook step, and a new opportunity step. Seven staff members produces seven near-identical copies of the same flow.

### 1.1 Why this needs replacing

- Onboarding a new salesperson is manual and slow — multiple systems must be touched in a specific order.
- Seven copies of effectively the same workflow are maintained in parallel; any change must be made seven times.
- Identifying who took the call relies on which form was used, which is fragile (shared links, copy-pasted bookmarks, wrong-form submissions).
- The Cohen form template is reused for other staff with the form title hardcoded, so every new staff member needs a duplicated and re-titled form.

### 1.2 What stays in GHL

GHL remains the CRM and the system of record for contacts, opportunities, tags, and downstream automations (acknowledgement messaging, data lake archival, the broader LeadShook-based lead flows). This project replaces only the entry point for phone-and-referral leads — the landing pages, the forms, and the Master Phone and Referral Process workflow.

---

## 2. Goals and non-goals

### 2.1 Goals

- Reduce new-staff onboarding to a single admin-panel action.
- Provide one shared landing page and one shared form, used by all staff.
- Identify the salesperson by authenticated session, not by which form they used.
- Push leads into GHL with the correct assignment, tag, opportunity, and per-staff webhook call, replicating the behaviour of the existing GHL workflow.
- Provide an audit trail of every submission and every external call made on its behalf.
- Allow admins to manage staff, insurance categories, and per-staff webhook URLs without developer involvement.

### 2.2 Non-goals

- Does not replace GHL as the CRM.
- Does not generate PDFs, LLM summaries, or Google Doc artefacts.
- Does not send acknowledgement emails or SMS messages to leads — GHL continues to handle these.
- Does not append to the Gerrards Data Lake Google Sheet — GHL continues to handle this for the lead flows that use it.
- Does not replace LeadShook or the existing full-lead / partial-lead workflows. Replaces only the inbound phone-and-referral flow.

---

## 3. Users and personas

### 3.1 Salesperson (staff)

- Receives an inbound phone call or referral from a potential client.
- Logs into the app once on their device; session persists for 30 days.
- Selects the relevant insurance category from a landing page of nine buttons.
- Fills out the lead's details and their own notes from the call.
- Submits and sees a confirmation, then either starts another submission or closes the app.

### 3.2 Admin

- Onboards new staff: enters name, email, GHL user ID, per-staff webhook URL.
- Deactivates staff who leave.
- Manages the list of insurance categories (label, sort order, UTM campaign value, GHL pipeline/stage IDs).
- Views all submissions, filters by staff member, category, or date.
- Inspects the event log for any submission to diagnose failures and retry failed steps.

---

## 4. Functional requirements

### 4.1 Authentication

1. Staff enter their email address on the login page.
2. The app sends a magic-link email containing a one-time-use, time-limited token.
3. Clicking the link creates a session valid for 30 days, scoped to that device.
4. Sessions are stored as signed cookies; no server-side session store required at this scale.
5. Magic-link tokens expire after 15 minutes and are single-use.
6. Email addresses must match an active user in the system; unknown emails receive a generic "check your email" response without indicating whether the address exists.
7. Staff can log out manually; logging out invalidates the session.

### 4.2 Landing page

1. Displays the nine insurance-category buttons (Car Insurance, Property Insurance, Business Liability, Truck Insurance, Plant & Contents, Stock & Inventory, Cyber Insurance, Management, Life & Health) — exactly mirroring the current landing pages.
2. Category list and labels are sourced from the `insurance_categories` table, sortable and editable by admins.
3. Each button links to the form, passing the category slug as a query parameter.
4. Includes a small "My recent submissions" link in the corner showing the last 10 submissions by this user.

### 4.3 Lead form

Fields, matching the existing form with one change (no per-form staff name — that's from the session now):

| Field | Type | Required |
|---|---|---|
| First Name | Text | Yes |
| Last Name | Text | Yes |
| Phone | Phone | Yes |
| Email | Email | Yes |
| Organisation | Text | Yes |
| Address (combined search) | Address autocomplete | No |
| Street Address | Text | Yes |
| City | Text | Yes |
| State | Text | Yes |
| Country | Dropdown (default NZ) | Yes |
| Postal Code | Text | Yes |
| Lead Source | Dropdown | Yes |
| Notes | Textarea | Yes |

Hidden / system-set fields, populated automatically:

- `utm_campaign` — set from the category slug clicked on the landing page
- `utm_source` — hardcoded `Phone_Referral` (matches current UTMs)
- `utm_medium` — hardcoded `Internal` (matches current UTMs)
- `salesperson_user_id` — from the authenticated session

### 4.4 Submission processing

When a salesperson clicks Send, the app:

1. Validates all required fields server-side.
2. Writes a `submissions` row with status = `PROCESSING`.
3. Calls GHL: Create or Update Contact, including `assignedTo` = the logged-in user's `ghl_user_id`, all lead fields, organisation, lead source, and the UTM values.
4. Calls GHL: Add Tag `phone/referral` to the contact.
5. Calls GHL: Create Contact Note with the salesperson's notes, formatted with a header indicating the salesperson and category.
6. Calls the logged-in user's per-staff webhook URL with a JSON payload (same payload for all staff; URL is the only thing that varies).
7. Calls GHL: Create Opportunity, in the pipeline/stage configured for the selected insurance category, assigned to the logged-in user.
8. Updates the submission row to status = `COMPLETE` (or `FAILED`, if a fatal step failed).
9. Logs every step to `submission_events` with success/failure, response status, response body, and error message if any.
10. Redirects to a confirmation page showing the submission status and a "Start another" button.

#### 4.4.1 Failure handling

- Contact creation failure is **fatal** — submission marked `FAILED`, salesperson sees an error.
- Tag failure is **fatal** — same handling.
- Opportunity creation failure is **fatal** — same handling.
- Note creation failure is **non-fatal** — submission still completes; admin can retry from the event log.
- Webhook failure is **non-fatal** — submission still completes; admin can retry from the event log.
- On any failure, the error message and full response body are logged to `submission_events` for diagnosis.

### 4.5 Admin panel

Accessible to users with role = `ADMIN`. Routes are role-gated; non-admins see a 403.

#### 4.5.1 Staff management

- List view: name, email, GHL user ID, webhook URL (truncated), active status, last login.
- Add staff: name, email, GHL user ID (with a "pick from GHL" helper that calls the GHL users API), webhook URL, role.
- Edit staff: same fields editable.
- Deactivate staff (soft delete): user can no longer log in; submissions history is preserved.

#### 4.5.2 Insurance category management

- List view: label, slug, UTM campaign value, sort order, active status, GHL pipeline/stage IDs.
- Add / edit / reorder / deactivate categories.
- Deactivated categories no longer appear on the landing page but remain associated with historical submissions.

#### 4.5.3 Submissions list and detail

- Filterable list: by staff member, by category, by date range, by status.
- Per-submission detail page: all form fields, all events with timestamps and response bodies, status, links to the created GHL contact and opportunity.
- "Retry step" button on failed events — re-runs just that step (e.g. retry the webhook without recreating the contact).

---

## 5. Non-functional requirements

### 5.1 Performance

- Form submit to confirmation page: **< 4 seconds** at p95.
- Landing page: **< 500ms** time-to-interactive.
- Magic-link email delivery: **< 30 seconds** in normal operation.

### 5.2 Availability

- Target: **99.5%** monthly uptime.
- Railway provides automatic restarts and health checks; the app exposes a `/health` endpoint.

### 5.3 Security

- Magic-link tokens stored as SHA-256 hashes, not plaintext.
- Session cookies signed, HTTP-only, Secure, SameSite=Lax.
- GHL API key and any other secrets live in Railway environment variables — never in source.
- All admin routes role-gated server-side.
- CSRF protection on all POST routes.
- Per-staff webhook URLs treated as semi-secret — visible to admins, not exposed to staff users.

### 5.4 Mobile

- Desktop-first design, fully responsive down to 375px width (iPhone SE).
- Form fields use appropriate mobile input types (`tel` for phone, `email` for email, etc.).

### 5.5 Browser support

- Latest two versions of Chrome, Safari, Edge, Firefox.
- No IE support.

---

## 6. Technical architecture

### 6.1 Stack

| Layer | Choice | Why |
|---|---|---|
| Runtime | Node.js 20 LTS | Stable, well-supported on Railway |
| Web framework | Fastify | Lighter than Express, good DX, proven at scale |
| ORM | Prisma | Best Postgres DX, type-safe queries, simple migrations |
| Database | PostgreSQL 16 (Railway) | Standard choice, generous Railway tier |
| Templates | EJS | Server-rendered, no build step |
| CSS | Tailwind | Utility-first, no design system to maintain |
| Frontend JS | Alpine.js | Form interactivity; no React build pipeline |
| Email | Resend | Cheap, good DX, friendly NZ delivery |
| Hosting | Railway | Single PaaS for web + DB, simple deploys |

### 6.2 Why server-rendered, not an SPA

The entire user flow is: log in, see buttons, fill a form, submit. No client-side state machines, no real-time updates, no offline. Server-rendered Fastify + EJS ships in roughly 30% of the code an equivalent React app would require, with no build pipeline, faster page loads, and trivial debugging. Alpine.js handles the small amount of client interactivity needed (address autocomplete, conditional fields).

### 6.3 Why no background job queue

With only four external API calls (GHL contact, tag, opportunity, plus the per-staff webhook), inline processing completes in 1–3 seconds end-to-end. A queue (BullMQ + Redis) adds infrastructure and complexity for no user-visible benefit. If submission latency becomes a problem after launch, retrofitting a queue is a half-day change.

### 6.4 Deployment topology

- One Railway service: the web app (Node).
- One Railway add-on: PostgreSQL.
- Total: two billable Railway resources.
- Custom domain (suggested: `phone.gerrards.co.nz` or `referrals.gerrards.co.nz`) via CNAME; Railway provisions TLS automatically.

---

## 7. Data model

Six tables. Full Prisma schema follows in section 7.7.

### 7.1 users

| Column | Type | Notes |
|---|---|---|
| `id` | cuid | Primary key |
| `email` | string | Unique, case-insensitive |
| `name` | string | Display name on submissions |
| `ghl_user_id` | string | Maps to GHL user; used as `assignedTo` on contacts/opps |
| `webhook_url` | string? | Per-staff Custom Webhook destination |
| `role` | enum | `STAFF` \| `ADMIN` |
| `is_active` | boolean | Soft delete flag; inactive users cannot log in |
| `last_login_at` | timestamp? | For admin overview |
| `created_at` | timestamp | |

### 7.2 magic_link_tokens

| Column | Type | Notes |
|---|---|---|
| `id` | cuid | |
| `token_hash` | string | SHA-256 of the token; raw token never stored |
| `user_id` | fk | References `users.id` |
| `expires_at` | timestamp | 15 minutes after creation |
| `used_at` | timestamp? | Set on first use; single-use |
| `created_at` | timestamp | |

### 7.3 sessions

| Column | Type | Notes |
|---|---|---|
| `id` | cuid | Session ID; signed and stored in the cookie |
| `user_id` | fk | |
| `expires_at` | timestamp | 30 days after creation |
| `last_seen_at` | timestamp | Updated on each authenticated request |
| `user_agent` | string? | For admin troubleshooting |
| `created_at` | timestamp | |

### 7.4 insurance_categories

| Column | Type | Notes |
|---|---|---|
| `id` | cuid | |
| `slug` | string | Unique, URL-safe (e.g. `car_insurance`) |
| `label` | string | Display label (e.g. Car Insurance) |
| `utm_campaign` | string | Value used as `utm_campaign` on submission |
| `sort_order` | int | Controls button order on landing page |
| `is_active` | boolean | Inactive categories don't appear on landing page |
| `ghl_pipeline_id` | string? | GHL opportunity pipeline for this category |
| `ghl_stage_id` | string? | GHL opportunity stage for this category |
| `created_at` | timestamp | |

### 7.5 submissions

| Column | Type | Notes |
|---|---|---|
| `id` | cuid | |
| `salesperson_user_id` | fk | Who took the call |
| `insurance_category_id` | fk | |
| `lead_first_name` | string | |
| `lead_last_name` | string | |
| `lead_email` | string | |
| `lead_phone` | string | |
| `organisation` | string? | |
| `address_line` | string? | |
| `city`, `state`, `country`, `postal_code` | strings? | Address components |
| `lead_source` | string | |
| `notes` | text | Salesperson's notes from the call |
| `status` | enum | `PROCESSING` \| `COMPLETE` \| `FAILED` |
| `ghl_contact_id` | string? | Set after successful contact creation |
| `ghl_opportunity_id` | string? | Set after successful opportunity creation |
| `webhook_response_status` | int? | HTTP status from the per-staff webhook |
| `created_at` | timestamp | |
| `completed_at` | timestamp? | |

### 7.6 submission_events

| Column | Type | Notes |
|---|---|---|
| `id` | cuid | |
| `submission_id` | fk | |
| `step` | enum | `GHL_CONTACT` \| `GHL_CONTACT_NOTE` \| `GHL_TAG` \| `STAFF_WEBHOOK` \| `GHL_OPPORTUNITY` |
| `succeeded` | boolean | |
| `response_status` | int? | HTTP status |
| `response_body` | text? | Truncated to 10KB |
| `error_message` | text? | |
| `created_at` | timestamp | |

### 7.7 Full Prisma schema

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
  GHL_CONTACT_NOTE
  GHL_TAG
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
  ghlPipelineId String?  @map("ghl_pipeline_id")
  ghlStageId    String?  @map("ghl_stage_id")
  createdAt     DateTime @default(now()) @map("created_at")

  submissions   Submission[]

  @@map("insurance_categories")
}

model Submission {
  id                    String            @id @default(cuid())
  salespersonUserId     String            @map("salesperson_user_id")
  insuranceCategoryId   String            @map("insurance_category_id")

  leadFirstName         String            @map("lead_first_name")
  leadLastName          String            @map("lead_last_name")
  leadEmail             String            @map("lead_email")
  leadPhone             String            @map("lead_phone")
  organisation          String?
  addressLine           String?           @map("address_line")
  city                  String?
  state                 String?
  country               String?
  postalCode            String?           @map("postal_code")
  leadSource            String            @map("lead_source")
  notes                 String

  status                SubmissionStatus  @default(PROCESSING)
  ghlContactId          String?           @map("ghl_contact_id")
  ghlOpportunityId      String?           @map("ghl_opportunity_id")
  webhookResponseStatus Int?              @map("webhook_response_status")

  createdAt             DateTime          @default(now()) @map("created_at")
  completedAt           DateTime?         @map("completed_at")

  salesperson           User              @relation(fields: [salespersonUserId], references: [id])
  category              InsuranceCategory @relation(fields: [insuranceCategoryId], references: [id])
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

---

## 8. External integrations

### 8.1 GHL (GoHighLevel)

**Auth:** Private Integration token in `Authorization: Bearer <token>` header.

**Required scopes:**

- `contacts.write` — create and update contacts
- `contacts/notes.write` — create contact notes
- `opportunities.write` — create opportunities
- `users.readonly` — for the admin panel staff dropdown

**Endpoints used:**

| Step | Method | Endpoint |
|---|---|---|
| Create/update contact | POST | `/contacts/upsert` |
| Add tag | POST | `/contacts/{id}/tags` (or include in upsert) |
| Add note | POST | `/contacts/{id}/notes` |
| Create opportunity | POST | `/opportunities/` |
| List users (admin) | GET | `/users/` |

Exact endpoint paths and payload shapes to be verified against the GHL API version in use during build kickoff.

### 8.2 Per-staff webhooks

Each staff member has a webhook URL stored in `users.webhook_url`. The payload is identical across all staff; only the URL varies. This replaces the per-staff Custom Webhook nodes (`#1`, `#3`, `#4`, `#5`, `#6`, `#7`, `#8`) in the old GHL workflow.

**Payload shape:**

```json
{
  "contactId": "ghl-contact-id",
  "salesperson": {
    "name": "...",
    "email": "...",
    "ghlUserId": "..."
  },
  "category": "car_insurance",
  "lead": {
    "firstName": "...",
    "lastName": "...",
    "email": "...",
    "phone": "...",
    "organisation": "...",
    "address": {
      "line": "...",
      "city": "...",
      "state": "...",
      "country": "...",
      "postalCode": "..."
    },
    "leadSource": "...",
    "notes": "..."
  },
  "submittedAt": "ISO-8601"
}
```

### 8.3 Resend (email)

Used only for magic-link emails. API key in environment variable. From-address `noreply@gerrards.co.nz` (DKIM/SPF configured during build setup).

---

## 9. UI / pages

Eight pages total. All server-rendered.

| Page | Route | Auth |
|---|---|---|
| Login (email entry) | `GET /login` | Public |
| Check your email | `GET /login/sent` | Public |
| Magic-link verify | `GET /auth/:token` | Public (becomes authed) |
| Landing page (9 category buttons) | `GET /` | Staff |
| Lead form | `GET /new?category=...` | Staff |
| Submission confirmation | `GET /submissions/:id` | Staff (own only) |
| My recent submissions | `GET /my-submissions` | Staff (own only) |
| Admin: staff list | `GET /admin/staff` | Admin |
| Admin: staff edit | `GET /admin/staff/:id` | Admin |
| Admin: categories | `GET /admin/categories` | Admin |
| Admin: submissions list | `GET /admin/submissions` | Admin |
| Admin: submission detail | `GET /admin/submissions/:id` | Admin |

---

## 10. Build plan

Designed to produce a deployable end-to-end app at the end of day 4. Days 5–7 are admin panel, polish, and migration.

| Day | Deliverable |
|---|---|
| 1 | Fastify boilerplate, Prisma schema and migrations, Resend integration, magic-link auth end-to-end (can log in, see a placeholder page) |
| 2 | Landing page with category buttons, lead form, submission writes to DB. No external calls yet. UI styled. |
| 3 | GHL contact + tag + note + opportunity calls. Test with one guinea-pig staff member. |
| 4 | Per-staff webhook call. Event logging fully wired up. App deployable end-to-end. |
| 5 | Admin: staff CRUD + categories CRUD. |
| 6 | Admin: submissions list + detail page + event log + retry-failed-step. |
| 7 | Polish, mobile responsive pass, deploy to Railway, point subdomain, run real test submissions, document handover. |

### 10.1 Pre-build dependencies

Three things to gather before development begins; all can run in parallel with day 1.

1. **GHL Private Integration token** with the required scopes (see section 8.1).
2. **The current seven per-staff webhook URLs** from the old workflow's Custom Webhook nodes — one per staff member.
3. **GHL pipeline and stage IDs** each insurance category should target. If all categories use the same pipeline/stage, even simpler; otherwise we need the mapping.

---

## 11. Migration plan

The old GHL workflow and per-staff forms remain live throughout the migration. No big-bang cutover.

1. Deploy the Railway app and onboard one pilot staff member (Cohen, suggested). The other six continue using the old per-staff forms.
2. Cohen uses the new app for two weeks. Compare submissions in the new app's audit log against contacts created in GHL to confirm parity.
3. Onboard the remaining six staff in batches of two or three.
4. Once all staff are using the new app exclusively, disable (don't delete) the seven Form Submitted triggers in the Master Phone and Referral Process workflow. Wait two weeks.
5. Delete the old workflow, the seven per-staff forms, and the seven per-staff landing pages.

### 11.1 Rollback

Because the old system remains in place during cutover, rollback is as simple as telling a staff member to use their old form again. The new app does not modify or replace any existing GHL records; it only creates new contacts/opportunities the same way the old workflow did.

---

## 12. Open questions

1. **GHL pipeline and stage mapping per category.** Confirm the GHL pipeline and stage that opportunities should land in for each insurance category. If they're all the same, we can hardcode; if they vary by category, we use the `ghl_pipeline_id` / `ghl_stage_id` columns on `insurance_categories`.
2. **Per-staff webhook payload shape.** Confirm the exact payload shape the per-staff webhooks expect. The current Custom Webhook nodes in the old workflow may be sending a specific structure that downstream consumers depend on — match this exactly during build, not approximate.
3. **Lead Source dropdown values.** Confirm the options. The current form has Lead Source as a required dropdown but the options aren't documented in this spec.
4. **Address autocomplete.** Confirm whether the current form uses Google Places or something else — and whether it should remain in the new app or be replaced with manual fields only.

---

## Appendix A: Glossary

| Term | Meaning |
|---|---|
| GHL | GoHighLevel — the CRM Gerrards uses |
| LeadShook | The form-builder used for the broader lead-capture forms (not replaced by this project) |
| Magic link | Login method where the user receives a one-time-use URL in their email rather than entering a password |
| Custom Webhook (GHL) | A workflow node in GHL that POSTs to a configured URL when triggered |
| Per-staff webhook | The URL each staff member's Custom Webhook node points at in the old workflow |
