# Kinglike Luxury — Full Production Backup Report

**Generated:** 2026-06-02  
**Repository commit:** `a004aa3bbf47981dfddeb80d5062499e197399b4`  
**Prepared by:** Automated audit of live codebase and deployment environment

---

## Table of Contents

1. [Source Code Structure](#1-source-code-structure)
2. [Database Schema](#2-database-schema)
3. [Environment Variables](#3-environment-variables)
4. [Railway Deployment Configuration](#4-railway-deployment-configuration)
5. [GitHub Repository Configuration](#5-github-repository-configuration)
6. [Domain and DNS Configuration](#6-domain-and-dns-configuration)
7. [Cloudinary Configuration](#7-cloudinary-configuration)
8. [OpenAI Integration](#8-openai-integration)
9. [Resend Email Configuration](#9-resend-email-configuration)
10. [Push Notification Configuration](#10-push-notification-configuration)
11. [Mobile App and PWA Configuration](#11-mobile-app-and-pwa-configuration)
12. [All Active API Integrations](#12-all-active-api-integrations)
13. [Production Architecture Diagram](#13-production-architecture-diagram)
14. [Recovery Instructions](#14-recovery-instructions)

---

## 1. Source Code Structure

```
/
├── client/                      # React + TypeScript frontend (Vite)
│   ├── src/
│   │   ├── pages/               # 25 route pages (home, properties, blog, admin, etc.)
│   │   ├── components/          # Reusable UI components
│   │   │   ├── ui/              # Shadcn/Radix base components
│   │   │   ├── property/        # Property-specific components
│   │   │   ├── home/            # Home page sections
│   │   │   └── layout/          # Header, footer, navigation
│   │   ├── lib/                 # queryClient, i18n, utilities
│   │   ├── hooks/               # Custom React hooks
│   │   └── main.tsx             # Entry point + service worker registration
│   └── public/
│       ├── sw.js                # Service worker (cache + push handler, v4)
│       ├── manifest.json        # PWA manifest
│       ├── icons/               # PWA icons (192px, 512px)
│       └── locales/             # i18n translation files (9 languages)
│
├── server/                      # Express.js backend (TypeScript → ESM bundle)
│   ├── index.ts                 # App entry: middleware, CORS, session, startup logs
│   ├── routes.ts                # All API route handlers (~3500 lines)
│   ├── db.ts                    # Neon PostgreSQL pool (NEON_DATABASE_URL)
│   ├── storage.ts               # Storage interface (IStorage) + MemStorage fallback
│   ├── database-storage.ts      # DatabaseStorage: Drizzle ORM implementations
│   ├── cloudinaryService.ts     # Upload/delete media via Cloudinary API
│   ├── notificationService.ts   # Resend email + web-push notifications
│   ├── emailService.ts          # Transactional email templates (OTP, reset, etc.)
│   ├── aiAdvisor.ts             # OpenAI AI Advisor chat + lead scoring
│   ├── schedulerService.ts      # Cron: weekly updates, inactive reminders (3-day promo)
│   ├── dailyBackup.ts           # Daily 2:00 AM backup job
│   ├── sitemapGenerator.ts      # Auto-generates /sitemap.xml
│   ├── translate.ts             # Translation service
│   ├── objectStorage.ts         # Replit object storage (Replit-env only, guarded)
│   └── vite.ts                  # Vite dev middleware + serveStatic for production
│
├── shared/
│   └── schema.ts                # Drizzle ORM schema: all 19 tables + Zod insert schemas
│
├── mobile/                      # React Native / Expo mobile app
│   └── ...                      # ViroReact AR, React Navigation, native maps
│
├── docs/
│   └── ai-backup/               # AI configuration backups (LOCKED — never modify)
│
├── railway.toml                 # Railway deployment config
├── eas.json                     # Expo Application Services build config
├── app.json                     # Expo project config
├── drizzle.config.ts            # Drizzle Kit migration config (DO NOT EDIT)
├── vite.config.ts               # Vite build config (DO NOT EDIT)
└── package.json                 # npm scripts and dependencies
```

### Key npm scripts

| Script | Command | Purpose |
|--------|---------|---------|
| `dev` | `NODE_ENV=development tsx server/index.ts` | Local development |
| `build` | `vite build && esbuild server/index.ts --platform=node --packages=external --bundle --format=esm --outdir=dist` | Production build |
| `start` | `NODE_ENV=production node dist/index.js` | Production server |
| `db:push` | `drizzle-kit push` | Push schema to database |

### Frontend pages

| Page | Route |
|------|-------|
| Home | `/` |
| Properties listing | `/properties` |
| Property detail | `/property/:id` |
| Submit property | `/submit-property` |
| Projects | `/projects` |
| Live construction | `/live-projects` |
| Blog | `/blog` |
| Blog post | `/blog/:slug`, `/:lang/blog/:slug` |
| Map view | `/map-view` |
| AI Advisor | `/ai-advisor` |
| Consultation booking | `/consultation-booking` |
| Favorites | `/favorites` |
| Notifications | `/notifications` |
| Payment result | `/payment-result` |
| Login / Register | `/login`, `/register` |
| Admin panel | `/admin/*` |
| Privacy / Terms | `/privacy-policy`, `/terms` |

---

## 2. Database Schema

**Provider:** Neon PostgreSQL (serverless, WebSocket driver via `@neondatabase/serverless`)  
**ORM:** Drizzle ORM (`drizzle-orm/neon-serverless`)  
**Total tables:** 19  
**Connection variable:** `NEON_DATABASE_URL`

### Table Inventory

| # | Table | Purpose | Key Relations |
|---|-------|---------|--------------|
| 1 | `users` | User accounts, auth methods, roles | Root entity |
| 2 | `properties` | Property listings (apartment/villa/land/commercial/project) | `owner_id → users.id` |
| 3 | `projects` | Construction project detail linked to a property | `property_id → properties.id` |
| 4 | `payments` | VIP/Super-VIP listing payment records (Stripe/PayPal/BOG) | `property_id`, `user_id` |
| 5 | `blog_posts` | Blog articles with multilingual translations + SEO slugs | `author_id → users.id` |
| 6 | `contact_logs` | WhatsApp contact-click audit trail | `property_id`, `contactor_id` |
| 7 | `verification_codes` | SMS/email OTP codes with expiry | Standalone |
| 8 | `notification_templates` | Admin-managed email/WhatsApp message templates | Standalone |
| 9 | `notification_logs` | Delivery audit: sent/failed per user per trigger | `user_id → users.id` |
| 10 | `app_settings` | Key-value config store (e.g. RESEND_API_KEY override) | Standalone |
| 11 | `consultation_time_slots` | Admin-defined available booking windows | Standalone |
| 12 | `consultation_bookings` | User consultation requests with method/type/status | `user_id`, `property_id`, `slot_id` |
| 13 | `user_notifications` | In-app notification bell items | `user_id → users.id` (cascade delete) |
| 14 | `ai_conversations` | AI Advisor chat session metadata | `user_id → users.id` (cascade delete) |
| 15 | `ai_messages` | Individual messages within AI conversations | `conversation_id → ai_conversations.id` |
| 16 | `investor_profiles` | Structured investor data extracted by AI | `user_id`, `conversation_id`, `assigned_agent_id` |
| 17 | `ai_lead_scores` | Scoring history per investor profile | `investor_profile_id` (cascade delete) |
| 18 | `push_subscriptions` | Web push endpoint + VAPID keys per user device | `user_id → users.id` (cascade delete) |
| 19 | `project_live_cameras` | Live construction camera embed URLs per project | `property_id → properties.id` (cascade delete) |

### `properties` Table — Full Column List

| Column | Type | Notes |
|--------|------|-------|
| id | serial PK | Auto-increment |
| title | text | Required |
| description | text | Required |
| price | integer | USD |
| price_max | integer | Upper range for price bands |
| location | text | Display address |
| latitude / longitude | text | Stored as text for precision |
| area | text | Comma-separated for range support |
| bedrooms / bathrooms | integer | Nullable (land has neither) |
| floor_number | integer | Apartments only |
| property_type | text | apartment / villa / land / commercial / project |
| images | jsonb `string[]` | Cloudinary URLs |
| videos | jsonb `string[]` | Cloudinary video URLs |
| features / amenities | jsonb `string[]` | Tag arrays |
| location_score … overall_score | integer 0-100 | 6 quality metric scores |
| status | text | pending / approved / rejected |
| owner_id | integer FK | → users.id |
| listing_type | text | regular / vip / super_vip |
| listing_expires_at | timestamp | VIP expiry |
| is_sold | boolean | |
| land_type | text | agricultural / non-agricultural |
| land_features | jsonb | electricity, water, etc. |
| payment_method | text | cash / installments |
| down_payment_percent | integer | |
| installment_duration | text | 1-month … 2-years |
| monthly_installment | integer | |
| remaining_balance | integer | |
| live_enabled … live_updated_at | mixed | Live camera embed fields |
| title_en / description_en | text | Optional English override |
| top_rated / best_price / acceptable_price / high_price | boolean | Admin badges |
| created_at / updated_at | timestamp | Auto |

### `users` Authentication Methods

```
AUTH_METHODS = { EMAIL, PHONE, WHATSAPP, FACEBOOK }
```

Passwords stored as hashed text. Social logins (Facebook, WhatsApp, phone) have `password = null`. `is_admin = true` grants admin panel access.

---

## 3. Environment Variables

**Rule:** Never print, commit, or log values. Names only are listed here.

### Required — Application will crash without these

| Variable | Used In | Purpose |
|----------|---------|---------|
| `NEON_DATABASE_URL` | `server/db.ts` | Primary PostgreSQL connection (full Neon connection string) |
| `SESSION_SECRET` | `server/index.ts` | Express session signing key |
| `VAPID_PUBLIC_KEY` | `server/notificationService.ts` | Web push public key (87 chars, Base64url) |
| `VAPID_PRIVATE_KEY` | `server/notificationService.ts` | Web push private key (43 chars) |

### Required — Features disabled silently if absent

| Variable | Used In | Purpose |
|----------|---------|---------|
| `CLOUDINARY_CLOUD_NAME` | `server/cloudinaryService.ts` | Cloud account identifier |
| `CLOUDINARY_API_KEY` | `server/cloudinaryService.ts` | 10–20 digit key |
| `CLOUDINARY_API_SECRET` | `server/cloudinaryService.ts` | Upload signing secret |
| `OPENAI_API_KEY` | `server/aiAdvisor.ts` | AI Advisor chat (also accepted as `AI_API_KEY`) |
| `RESEND_API_KEY` | `server/notificationService.ts`, `server/emailService.ts` | Transactional email delivery |
| `TWILIO_ACCOUNT_SID` | `server/routes.ts` | SMS OTP for phone/WhatsApp login |
| `TWILIO_AUTH_TOKEN` | `server/routes.ts` | Twilio authentication |
| `TWILIO_MESSAGING_SERVICE_SID` | `server/routes.ts` | Preferred SMS sender (fallback to phone number) |
| `TWILIO_PHONE_NUMBER` | `server/routes.ts` | SMS fallback from-number |
| `BOG_CLIENT_ID` | `server/routes.ts` | Bank of Georgia payment gateway client |
| `BOG_CLIENT_SECRET` | `server/routes.ts` | BOG OAuth secret |
| `BOG_BASE_URL` | `server/routes.ts` | BOG API base URL (e.g. `https://api.bog.ge`) |

### Platform / Runtime

| Variable | Set By | Purpose |
|----------|--------|---------|
| `PORT` | Railway (auto) / Replit | Server listen port. App defaults to `5000` if absent |
| `NODE_ENV` | Build scripts | `development` or `production` |
| `REPL_ID` | Replit (auto) | Presence signals Replit environment; gates objectStorage usage |
| `DATABASE_URL` | Replit (auto, injected) | **Intentionally ignored** — `NEON_DATABASE_URL` is used instead |

### Optional / Object Storage (Replit-only)

| Variable | Used In | Purpose |
|----------|---------|---------|
| `PRIVATE_OBJECT_DIR` | `server/objectStorage.ts` | Replit object storage private dir |
| `PUBLIC_OBJECT_SEARCH_PATHS` | `server/objectStorage.ts` | Public search paths |
| `VAPID_SUBJECT` | `server/notificationService.ts` | Push notification contact URI. Defaults to `mailto:info@kinglikeluxury.app` |
| `AI_API_KEY` | `server/aiAdvisor.ts` | Alias for `OPENAI_API_KEY` |

---

## 4. Railway Deployment Configuration

**File:** `railway.toml` (project root)

```toml
[build]
builder = "nixpacks"
buildCommand = "npm run build"

[deploy]
startCommand = "npm run start"
restartPolicyType = "on_failure"
restartPolicyMaxRetries = 3
```

### Build pipeline on Railway

```
1. npm install              (installs all dependencies from package.json)
2. vite build               (compiles React SPA → dist/public/)
3. esbuild server/index.ts  (bundles Express server → dist/index.js, ESM format)
```

### Runtime on Railway

```
NODE_ENV=production node dist/index.js
```

- Listens on `process.env.PORT` (injected by Railway)
- Serves React SPA from `dist/public/`
- Connects to Neon DB via WebSocket (`neonConfig.webSocketConstructor = ws`)
- Restart policy: restarts on crash, max 3 retries before Railway serves 502

### Required Railway environment variables (must be set in Railway dashboard → Variables)

All variables listed under "Required" in Section 3 must be present in Railway Variables. Key ones that differ from Replit:

- `NEON_DATABASE_URL` — confirmed present
- `SESSION_SECRET` — must be set
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` — must be set
- `CLOUDINARY_*`, `OPENAI_API_KEY`, `RESEND_API_KEY` — must be set
- `REPL_ID` — must **NOT** be set on Railway (its absence disables Replit-only object storage)

---

## 5. GitHub Repository Configuration

| Item | Value |
|------|-------|
| Repository | `https://github.com/kinglikeluxury/Kinglikeluxury-app` |
| Default branch | `main` |
| Current HEAD | `a004aa3bbf47981dfddeb80d5062499e197399b4` |
| CI/CD | **None** — no GitHub Actions workflows configured |
| Auto-deploy | Railway connects to GitHub; push to `main` triggers Railway redeploy (if configured in Railway dashboard) |

### Recent commit history

| SHA | Message |
|-----|---------|
| `a004aa3` | Mask sensitive database connection details in logs |
| `702dc07` | Add push notification service worker registration to the application |
| `0cbde64` | Improve error handling and object storage configuration |
| `7133ec8` | Create backup of local changes and push to GitHub |
| `453e936` | Create backups of configuration files for deployment and development |

### Known git state issue

A stale lock file `.git/refs/remotes/origin/main.lock` exists in the Replit environment. This causes `git status` to falsely report "ahead by 23 commits." The actual GitHub remote is in sync at `a004aa3`. The lock has no effect on pushes or fetches to GitHub. Delete it with `rm .git/refs/remotes/origin/main.lock` from the Replit Shell tab to restore normal local tracking display.

---

## 6. Domain and DNS Configuration

### Active domains

| Domain | Resolves to | Purpose |
|--------|------------|---------|
| `www.kinglikeluxury.app` | Railway Edge (`railway-edge` server header, `us-west2`) | Primary production URL |
| `kinglikeluxury.app` | Redirects → `www.kinglikeluxury.app` | Canonical redirect |
| `real-estate-hub-kinglikeluxury.replit.app` | Replit deployment | Staging / backup |

### CORS allowed origins (server/index.ts)

```
https://kinglikeluxury.app
https://www.kinglikeluxury.app
https://real-estate-hub-kinglikeluxury.replit.app
```

### robots.txt

```
User-agent: *
Allow: /

Sitemap: https://www.kinglikeluxury.app/sitemap.xml
```

Sitemap is auto-generated at startup by `server/sitemapGenerator.ts`.

### DNS records required (for custom domain on Railway)

The following records must exist in the DNS provider for `kinglikeluxury.app`:

| Type | Name | Points to |
|------|------|-----------|
| CNAME | `www` | Railway-provided CNAME (check Railway dashboard → Settings → Domains) |
| CNAME or A | `@` (root) | Redirect to `www` or Railway IP |

---

## 7. Cloudinary Configuration

**Service:** Cloudinary (cloud-hosted media CDN)  
**Client library:** `cloudinary` v2 (`import { v2 as cloudinary }`)  
**File:** `server/cloudinaryService.ts`

### Credential resolution

The service auto-detects which environment variable holds which credential by pattern matching (handles slot-swapping mistakes):

- **Cloud name:** 5–15 lowercase alphanumeric chars (e.g. `dmfy0mz7g`)
- **API key:** 10–20 pure digits
- **API secret:** everything else (long alphanumeric)

### Upload folders

| Folder | Content |
|--------|---------|
| `kinglike/photos` | Property images |
| `kinglike/videos` | Property videos |
| `kinglike/audio` | Audio files |
| `kinglike/blog` | Blog cover images and media |

### Startup log confirmation

```
[Cloudinary] Configured → cloud: <name>, key: XXXXXX***
```

If this line is absent from Railway startup logs, Cloudinary env vars are missing or misconfigured.

---

## 8. OpenAI Integration

**File:** `server/aiAdvisor.ts`  
**Client library:** `openai` npm package  
**Feature:** AI Real Estate Advisor — qualifies investors, scores leads, profiles users

### Model routing

| Model | When used |
|-------|-----------|
| `gpt-4o-mini` | Default — fast, low-cost for standard qualifying conversations |
| `gpt-4o` | Complex investment analysis or hot leads ready to close |

### API key resolution

```ts
const apiKey = process.env.OPENAI_API_KEY || process.env.AI_API_KEY;
```

Both variable names are accepted. `OPENAI_API_KEY` takes precedence.

### Startup log

```
[AI] OpenAI client initialised ✓
```

If absent, the AI Advisor is silently disabled (returns `AI_UNAVAILABLE` error on requests).

### AI routes

| Method | Route | Purpose |
|--------|-------|---------|
| POST | `/api/ai/start` | Start a new AI conversation |
| POST | `/api/ai/chat` | Send message, receive streaming response |

### Security note

The OpenAI API key is **never sent to the frontend**. All AI communication flows through the server: `Frontend → /api/ai/* → aiAdvisor.ts → OpenAI API`.

---

## 9. Resend Email Configuration

**Primary file:** `server/emailService.ts`  
**Also used in:** `server/notificationService.ts`, `server/routes.ts`  
**Library:** `resend` npm package

### Sender identity

```
From: Kinglike Luxury <info@kinglikeluxury.app>
```

### Key fallback chain

1. `process.env.RESEND_API_KEY` (env var, preferred)
2. `SELECT value FROM app_settings WHERE key='RESEND_API_KEY'` (DB override)

### Email use cases

| Trigger | Template |
|---------|---------|
| User registration / OTP | Verification code |
| Password reset | OTP + reset link |
| Consultation confirmed | Booking confirmation with meeting link |
| Consultation booked (admin) | New booking alert to admin |
| Weekly property update | Campaign to active users |
| Inactive user reminder | Re-engagement email |

### Startup log

```
[Startup] RESEND_API_KEY: SET (len=36)
```

---

## 10. Push Notification Configuration

**Library:** `web-push` npm package  
**Standard:** W3C Web Push Protocol with VAPID authentication

### Server side

**File:** `server/notificationService.ts`

```ts
webpush.setVapidDetails(
  process.env.VAPID_SUBJECT,   // mailto:info@kinglikeluxury.app
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);
```

**Routes:**

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/push/vapid-key` | Returns public VAPID key to browser for subscription |
| POST | `/api/push/subscribe` | Saves push subscription (endpoint + p256dh + auth) |
| DELETE | `/api/push/unsubscribe` | Removes subscription |

### Client side

**Registration:** `client/src/main.tsx` — registered on `window.load` event  
**Service worker:** `client/public/sw.js` — cache version `kinglike-v4`

**Push event handler:**

```js
self.addEventListener('push', (event) => { ... });
self.addEventListener('notificationclick', (event) => { ... });
```

API requests (`/api/*`) are never intercepted or cached by the service worker.

### Database storage

Subscriptions stored in `push_subscriptions` table:

```
endpoint (unique), p256dh, auth, user_agent, user_id
```

### Startup log

```
[Push] VAPID keys configured ✓
```

---

## 11. Mobile App and PWA Configuration

### PWA (Progressive Web App)

**Manifest:** `client/public/manifest.json`

| Property | Value |
|----------|-------|
| Name | Kinglike Luxury Real Estate |
| Short name | Kinglike |
| App ID | `kinglike-luxury-real-estate` |
| Display | `standalone` |
| Theme color | `#3bcac4` (brand teal) |
| Background color | `#005476` (brand deep blue) |
| Start URL | `/` |
| Orientation | `portrait-primary` |
| Languages | `en` (dir: auto, supports RTL) |
| Categories | business, lifestyle |
| Icons | 192×192 and 512×512 PNG (any + maskable) |

**PWA shortcuts:**

| Name | URL |
|------|-----|
| Properties | `/properties` |
| Add Property | `/submit-property` |
| Projects | `/projects` |

**Install prompt:** handled by `client/src/components/InstallPWA.tsx`

### React Native / Expo Mobile App

**Location:** `mobile/` directory  
**Platform:** Android (primary), iOS-compatible

**`app.json`:**

```json
{
  "expo": {
    "extra": { "eas": { "projectId": "722329bf-81e9-4e53-81b5-bddb12fed95f" } },
    "android": { "package": "kinglike.luxury" }
  }
}
```

**`eas.json` build profiles:**

| Profile | Distribution | Notes |
|---------|-------------|-------|
| `development` | Internal | Development client |
| `preview` | Internal | Test APK |
| `production` | Store | Auto-increment version |

**Mobile features:**
- AR property visualization via ViroReact
- Interactive floor plan overlays (scale, rotate, move)
- Surface detection for placing 3D models
- React Native Maps for property locations
- Native navigation (React Navigation)

---

## 12. All Active API Integrations

### Internal API surface

All routes are prefixed `/api/`. Full route list:

**Authentication**
```
POST /api/auth/register
POST /api/auth/login
POST /api/auth/logout
GET  /api/auth/me
POST /api/auth/send-verification
POST /api/auth/verify-code
POST /api/auth/send-email-otp
POST /api/auth/send-reset-otp
POST /api/auth/reset-password
POST /api/auth/change-password
```

**Properties**
```
GET    /api/properties
GET    /api/properties/:id
PATCH  /api/properties/:id
DELETE /api/properties/:id
PATCH  /api/properties/:id/status
PATCH  /api/properties/:id/sold
PATCH  /api/properties/:id/top-rated
PATCH  /api/properties/:id/best-price
PATCH  /api/properties/:id/acceptable-price
PATCH  /api/properties/:id/high-price
```

**Projects & Live Cameras**
```
GET   /api/projects
GET   /api/projects/:id
GET   /api/live-projects
GET   /api/live-projects/:propertyId/cameras
```

**Blog**
```
GET    /api/blog
GET    /api/blog/:id
GET    /api/blog/slug/:slug
DELETE /api/blog/:id
GET    /blog/:slug              (SEO redirect)
GET    /:lang/blog/:slug        (multilingual SEO redirect)
```

**AI Advisor**
```
POST /api/ai/start
POST /api/ai/chat
```

**Consultation**
```
GET   /api/consultation/slots
GET   /api/consultation/bookings/mine
```

**Push Notifications**
```
GET    /api/push/vapid-key
DELETE /api/push/unsubscribe
```

**User Notifications**
```
GET   /api/notifications
PATCH /api/notifications/:id/read
PATCH /api/notifications/read-all
```

**Payments**
```
POST /api/payments
POST /api/bog/create-order
POST /api/bog/callback
GET  /api/bog/order-status/:orderId
POST /api/bog/refund/:propertyId
```

**Media**
```
POST /api/audios/upload
POST /api/audios/process
GET  /api/cloudinary/test
```

**Admin (require isAdmin middleware)**
```
GET/POST/PATCH/DELETE /api/admin/users/:id
GET/POST/PATCH/DELETE /api/admin/consultation/slots
PATCH /api/admin/consultation/bookings/:id
GET/POST/PATCH/DELETE /api/admin/live-cameras
GET /api/admin/contact-logs
GET /api/admin/leads
GET /api/admin/leads/export
GET /api/admin/ai-leads
GET /api/admin/notification-logs
GET /api/admin/notification-status
GET/POST/PATCH /api/admin/notification-templates
POST /api/admin/notifications/send
POST /api/admin/test-notifications
POST /api/admin/email-campaign
POST /api/admin/retranslate-blogs
POST /api/admin/backfill-blog-seo
POST /api/admin/migrate-blog-slugs
GET  /api/admin/blog/:id/seo-status
GET  /api/admin/projects-for-cameras
```

**Utility**
```
GET /api/health-db
GET /api/geo/detect
GET /api/debug/database-status
GET /api/twilio-test
GET /.well-known/assetlinks.json
GET /property/:id               (legacy redirect)
```

### External services

| Service | Provider | Purpose | Credentials |
|---------|----------|---------|------------|
| **Database** | Neon (PostgreSQL) | All persistent data | `NEON_DATABASE_URL` |
| **Media CDN** | Cloudinary | Photos, videos, audio, blog images | `CLOUDINARY_*` |
| **AI** | OpenAI | AI Advisor chat, lead scoring | `OPENAI_API_KEY` / `AI_API_KEY` |
| **Email** | Resend | Transactional email, campaigns | `RESEND_API_KEY` |
| **SMS / OTP** | Twilio | Phone number verification, WhatsApp login | `TWILIO_*` |
| **Payment (BOG)** | Bank of Georgia | Property listing payments (Georgian market) | `BOG_*` |
| **Payment (Stripe)** | Stripe | VIP listing payments (schema ready, Replit integration installed) | Stripe integration |
| **Payment (PayPal)** | PayPal | VIP listing payments (schema ready, Replit integration installed) | PayPal integration |
| **Maps (Web)** | Leaflet.js | Interactive property map | No API key required |
| **Maps (Mobile)** | React Native Maps | Native map in mobile app | No API key required |
| **AR (Mobile)** | ViroReact | AR property visualization | No API key required |

### Multilingual support

9 languages with full i18n via `react-i18next`:

| Code | Language | Direction |
|------|----------|-----------|
| `en` | English | LTR |
| `ar` | Arabic | RTL |
| `he` | Hebrew | RTL |
| `ru` | Russian | LTR |
| `ka` | Georgian | LTR |
| `az` | Azerbaijani | LTR |
| `tr` | Turkish | LTR |
| `zh` | Chinese | LTR |
| `pl` | Polish | LTR |

---

## 13. Production Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                        USER / BROWSER                               │
│              Chrome, Safari, Firefox, Mobile PWA                    │
└────────────────────────────┬────────────────────────────────────────┘
                             │ HTTPS
                             │
┌────────────────────────────▼────────────────────────────────────────┐
│               RAILWAY EDGE CDN (us-west2 region)                    │
│               www.kinglikeluxury.app                                │
│               server: railway-edge                                  │
│               x-railway-edge: railway/us-west2                      │
└────────────────────────────┬────────────────────────────────────────┘
                             │ Proxy to app container
                             │
┌────────────────────────────▼────────────────────────────────────────┐
│             EXPRESS.JS APPLICATION SERVER                           │
│             Node.js — dist/index.js (ESM bundle)                    │
│             PORT: injected by Railway                               │
│                                                                     │
│  ┌─────────────────┐  ┌──────────────────┐  ┌────────────────────┐ │
│  │  Session Store  │  │  Static Files     │  │  API Routes        │ │
│  │  connect-pg-    │  │  dist/public/     │  │  server/routes.ts  │ │
│  │  simple         │  │  (React SPA)      │  │  ~80 endpoints     │ │
│  └────────┬────────┘  └──────────────────┘  └────────────────────┘ │
│           │                                                         │
│  ┌────────▼──────────────────────────────────────────────────────┐  │
│  │               NEON DATABASE POOL (Drizzle ORM)                │  │
│  │               @neondatabase/serverless + ws WebSocket         │  │
│  │               pool: max=10, idle=30s, connect timeout=10s     │  │
│  └────────────────────────────────────────────────────────────────┘ │
└────────────────────────────┬────────────────────────────────────────┘
                             │
          ┌──────────────────┼─────────────────────┐
          │                  │                     │
          ▼                  ▼                     ▼
┌──────────────────┐ ┌──────────────────┐ ┌────────────────────────┐
│ NEON POSTGRESQL  │ │   CLOUDINARY     │ │  EXTERNAL APIS         │
│ ep-young-forest- │ │  Media CDN       │ │                        │
│ aq74bptf-pooler  │ │  4 folders       │ │  OpenAI (gpt-4o-mini   │
│ c-8.us-east-1    │ │  photos/videos/  │ │          gpt-4o)       │
│ neondb           │ │  audio/blog      │ │  Resend (email)        │
│ 19 tables        │ │  Secure HTTPS    │ │  Twilio (SMS OTP)      │
│ ~7 users         │ └──────────────────┘ │  BOG Payment Gateway   │
│ ~73 properties   │                      │  Stripe (installed)    │
│ ~28 projects     │                      │  PayPal (installed)    │
│ ~32 blog posts   │                      └────────────────────────┘
└──────────────────┘

REPLIT (STAGING / BACKUP DEPLOYMENT)
  real-estate-hub-kinglikeluxury.replit.app
  Same codebase, port 5000, forwarded to external port 80
  Replit object storage active (guarded by REPL_ID env var)

MOBILE APP (separate artifact)
  Android APK via Expo EAS (project: 722329bf-...)
  Package: kinglike.luxury
  Features: AR via ViroReact, Native Maps, React Navigation
```

### Scheduled background jobs

| Job | Schedule | File |
|-----|----------|------|
| Weekly property update emails | Monday 9:00 AM | `server/schedulerService.ts` |
| Inactive user reminder emails | Daily 10:00 AM | `server/schedulerService.ts` |
| 3-day promotional campaign | Daily 10:00 AM | `server/schedulerService.ts` |
| Daily database backup | Daily 2:00 AM | `server/dailyBackup.ts` |

---

## 14. Recovery Instructions

### A. Railway production is down (502 / unresponsive)

**Step 1 — Check Railway dashboard**
1. Go to [railway.app](https://railway.app) → your project
2. Open **Deployments** tab
3. Check if latest deployment has status "Active" (green) or "Failed" (red)

**Step 2 — Read Railway deployment logs**
1. Click the latest deployment → **View Logs**
2. Look for these markers in order:
   - `[DB] ACTIVE_DB: SET` → database env var present
   - `[Push] VAPID keys configured ✓` → push keys present
   - `[AI] OpenAI client initialised ✓` → OpenAI key present
   - `[express] serving on port XXXX` → server started
   - `DATABASE CONNECTION ACTIVE` → Neon connection succeeded

**Step 3 — If server never reaches "serving on port"**

Check **Variables** tab on Railway. These must ALL be present:

```
NEON_DATABASE_URL
SESSION_SECRET
VAPID_PUBLIC_KEY
VAPID_PRIVATE_KEY
CLOUDINARY_CLOUD_NAME
CLOUDINARY_API_KEY
CLOUDINARY_API_SECRET
OPENAI_API_KEY
RESEND_API_KEY
TWILIO_ACCOUNT_SID
TWILIO_AUTH_TOKEN
TWILIO_PHONE_NUMBER
BOG_CLIENT_ID
BOG_CLIENT_SECRET
BOG_BASE_URL
```

**Step 4 — Trigger a fresh deploy**
1. Railway dashboard → **Deploy** button (manual redeploy)
2. Or push any commit to GitHub main branch

**Step 5 — Emergency failover to Replit**
1. Update DNS CNAME for `www` to point to `real-estate-hub-kinglikeluxury.replit.app`
2. The Replit deployment serves the same codebase and uses the same Neon database

---

### B. Replit environment is down / inaccessible

**Step 1 — Railway is the primary production server**  
`www.kinglikeluxury.app` runs on Railway, not Replit. Replit outage does not affect live users.

**Step 2 — To restore Replit development environment**
1. Clone from GitHub: `git clone https://github.com/kinglikeluxury/Kinglikeluxury-app.git`
2. Run `npm install`
3. Set all secrets in Replit Secrets panel (see Section 3)
4. Start: `npm run dev`

**Step 3 — Resolve stale git lock if present**
```bash
rm .git/refs/remotes/origin/main.lock
```

---

### C. GitHub repository is inaccessible

**Step 1 — Use Replit as source of truth**  
Replit's main branch is the live working copy. All commits are on Replit.

**Step 2 — If GitHub is permanently lost**
1. Source code is fully present in Replit workspace at `/home/runner/workspace`
2. Initialize a new GitHub repo
3. Set remote: `git remote set-url origin https://github.com/NEW_ORG/NEW_REPO.git`
4. Push: `git push origin main`
5. Reconnect Railway to the new GitHub repository

**Step 3 — Railway deploy without GitHub**  
Railway supports direct CLI deploys: `railway up` — does not require GitHub integration.

---

### D. Database (Neon PostgreSQL) fails or is lost

**Step 1 — Check Neon dashboard**
1. Go to [console.neon.tech](https://console.neon.tech)
2. Verify the `ep-young-forest-aq74bptf` endpoint is active
3. Check for connection limits or suspension (free tier has compute suspension)

**Step 2 — Neon compute suspension (free tier)**  
Neon auto-suspends compute after inactivity. The first request after suspension takes 1–5 seconds to wake up. This is normal and not an outage.

**Step 3 — Restore schema to a new database**
1. Export schema: `npx drizzle-kit generate` (generates SQL migration files)
2. Create a new Neon project
3. Run: `npx drizzle-kit push` with the new `NEON_DATABASE_URL`

**Step 4 — Data recovery**  
The `server/dailyBackup.ts` job runs every day at 2:00 AM. Check its output for the most recent backup location.

**Step 5 — Emergency read-only mode**  
If the DB is unavailable, the app will crash on startup (module-level pool creation fails after timeout). There is no read-only fallback mode — this requires the DB to be restored.

---

### E. Cloudinary media loss

**Step 1** — All media URLs stored in the database under `properties.images` and `properties.videos` columns point to `res.cloudinary.com` CDN URLs.

**Step 2** — Cloudinary media is not automatically backed up to local storage. Recovery requires:
- Cloudinary's own backup/restore features (available in paid plans)
- Or re-uploading original source images

**Step 3** — To migrate to a new Cloudinary account:
1. Update `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`
2. Use Cloudinary's migration tools or re-upload via admin panel

---

### F. Full platform migration (move away from Railway + Replit)

**Required artifacts:**
1. Source code — `git clone https://github.com/kinglikeluxury/Kinglikeluxury-app.git`
2. All environment variables (Section 3) — retrieve from Replit Secrets and Railway Variables
3. Database — export from Neon using `pg_dump` or Neon's export feature
4. Media — export from Cloudinary

**Deploy target requirements:**
- Node.js 20+
- `npm run build` to compile
- `npm run start` to launch
- All env vars must be set
- Outbound WebSocket connections to Neon must be allowed
- `PORT` env var must be set to the listening port

---

## Appendix: Startup Log Sequence (healthy boot)

A healthy Railway/Replit startup produces these lines in order:

```
[DB] ACTIVE_DB: SET
[DB] Host: ep-young-forest-aq74bptf-pooler.c-8.us-east-1.aws.neon.tech
[DB] Database: neondb
[Push] VAPID keys configured ✓
[Startup] RESEND_API_KEY: SET (len=36)
[AI] OpenAI client initialised ✓
[Scheduler] Started — weekly updates (Mon 9AM), inactive reminders (daily 10AM), 3-day promo (10AM)
[DailyBackup] Scheduled — runs daily at 2:00 AM
HH:MM:SS AM [express] serving on port XXXX
┌─────────────────────────────────────────────────────┐
│              DATABASE CONNECTION ACTIVE              │
├─────────────────────────────────────────────────────┤
│  Host:    ep-young-forest-aq74bptf-pooler...         │
│  Database: neondb                                    │
│  Tables:   19                                        │
│  properties   73 rows                               │
│  projects     28 rows                               │
│  users         7 rows                               │
│  blog_posts   32 rows                               │
└─────────────────────────────────────────────────────┘
```

If any line is missing, cross-reference Section 3 to identify the missing environment variable.

---

*This document was generated from live codebase inspection. It reflects the state of commit `a004aa3`. Update this file whenever major infrastructure changes are made.*
