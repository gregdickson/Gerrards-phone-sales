# Gerrards Phone & Referral App

Internal lead capture app for Gerrards Insurance, replacing 7 per-staff GHL workflows with a single shared web app.

## Stack

- **Runtime:** Node.js 20 + Fastify
- **Database:** PostgreSQL (Railway) + Prisma ORM (v5)
- **Templates:** EJS (server-rendered)
- **CSS:** Tailwind CSS v3 (compiled, committed)
- **Frontend JS:** Alpine.js (nav only), vanilla JS (Google Places)
- **Email:** Mailgun
- **Hosting:** Railway (web service + Postgres addon)
- **Live URL:** https://phone.gerrards.co.nz

## Project Structure

```
src/
├── server.js              # Fastify app entry, plugin registration
├── config.js              # Env var loading + validation
├── routes/
│   ├── auth.js            # Magic-link login/logout
│   ├── landing.js         # Category buttons (GET /)
│   ├── submissions.js     # Lead form, confirmation, my-submissions
│   └── admin/             # Staff, categories, lead sources, submissions CRUD
├── services/
│   ├── auth.js            # Magic link + session management
│   ├── email.js           # Mailgun wrapper
│   ├── ghl.js             # GHL API client (contacts, tags, notes, opportunities)
│   ├── webhook.js         # Per-staff webhook (flat payload)
│   ├── folio.js           # Folio new-business API
│   └── submission-processor.js  # 6-step pipeline orchestrator
├── middleware/
│   ├── authenticate.js    # Session cookie → user lookup
│   └── authorize.js       # Admin role check
└── views/                 # EJS templates
```

## Key Concepts

### Submission Pipeline

When a lead is submitted, 6 steps run inline (sequentially):

1. **GHL_CONTACT** — Upsert contact in GHL (FATAL)
2. **GHL_TAG** — Add "phone/referral" tag (FATAL)
3. **GHL_CONTACT_NOTE** — Create note with salesperson info (NON-FATAL)
4. **STAFF_WEBHOOK** — POST flat payload to per-staff webhook URL (NON-FATAL)
5. **GHL_OPPORTUNITY** — Create opportunity in Commercial pipeline (FATAL)
6. **FOLIO** — Create new business in Folio (NON-FATAL)

FATAL steps stop processing on failure. NON-FATAL steps log the error and continue. All steps log to `submission_events` for audit. Failed steps are retryable from the admin panel.

### Authentication

Magic-link email login. Tokens are SHA-256 hashed, single-use, 15-minute expiry. Sessions last 30 days, stored in Postgres.

### Webhook Payload

The per-staff webhook sends flat key-value pairs matching the old GHL Custom Webhook nodes:
```json
{ "first_name", "last_name", "phone", "email", "business_name", "contact_notes", "street_address", "city", "state", "country", "post_code" }
```
Do NOT change these keys — downstream consumers depend on them.

## Commands

```bash
npm run dev          # Start dev server (--watch)
npm start            # Start production server
npm run seed         # Seed categories, lead sources, admin user
npm run css:build    # Compile Tailwind (minified)
npm run css:watch    # Tailwind watch mode
```

## Database

```bash
npx prisma db push          # Push schema to DB (dev)
npx prisma migrate deploy   # Run migrations (prod)
npx prisma generate         # Regenerate client after schema changes
npx prisma studio           # Visual DB browser
```

## Deployment

Railway auto-deploys via `railway up`. The Procfile runs migrations before starting:
```
npx prisma migrate deploy && node src/server.js
```

After schema changes, run `npx prisma db push` against the public DB URL before deploying, or create a migration with `npx prisma migrate dev --name <name>`.

## GHL API

- Base URL: `https://services.leadconnectorhq.com`
- Auth: `Authorization: Bearer <GHL_API_KEY>` + `Version: 2021-07-28` header
- Scopes needed: `contacts.write`, `opportunities.write`, `opportunities.readonly`, `users.readonly`
- All categories use the same pipeline/stage (env vars `GHL_PIPELINE_ID`, `GHL_STAGE_ID`)

## Branding

- **Orange:** `#ff7624` (primary CTA, accents)
- **Dark:** `#1a1a2e` (headings, text)
- **Warm gray:** `#f8f6f3` (background)
- **Fonts:** DM Sans (body), Instrument Serif italic (headings)
- **Logo:** Loaded from Gerrards CDN (`cdn.prod.website-files.com`)
