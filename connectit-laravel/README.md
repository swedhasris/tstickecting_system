# Connect IT Laravel Migration

This directory is the in-progress Laravel 13 port of the Ticketing System.

## Current state

The project is not yet a full Laravel replacement for the existing application.

What is already present:

- Laravel 13 application scaffold
- MySQL-ready migrations for the main ITSM tables
- Core ticket models, enums, services, events, and notification plumbing
- Legacy API compatibility routes for:
  - `/api/health`
  - `/api/db-test`
  - `/api/auth/login`
  - `/api/users`
  - `/api/tickets/*` core listing and activity endpoints

What is not fully migrated yet:

- Frontend auth and ticket subscriptions still rely on Firebase/Firestore in `../src`
- Timesheets, activity tracker, screenshot upload, AI work-session flows, and master-data APIs are still implemented in `../server.ts`
- Frontend build integration into Laravel is not complete
- No full regression suite exists yet to prove feature-for-feature parity with the existing app

## Why this matters

The original app is a mixed stack:

- React + TypeScript frontend
- Firebase Auth + Firestore in several frontend contexts
- Express/Node API in `../server.ts`
- A partial PHP/Laravel port in this folder

Because of that, "convert everything without changing behavior" is a staged migration, not a safe single-file swap.

## Immediate goal of this Laravel app

1. Preserve the old `/api/...` contract so the frontend can keep working.
2. Move business logic from Express/Firebase into Laravel service classes.
3. Replace remaining Firebase reads/writes in the frontend with Laravel-backed APIs.
4. Finish MySQL-only operation and remove backend dependence on `../server.ts`.

## Run locally

1. Create `.env` from `.env.example`
2. Configure MySQL credentials
3. Install dependencies:

```bash
composer install
npm install
```

4. Run migrations:

```bash
php artisan migrate
```

5. Start Laravel + Vite:

```bash
composer run dev

6. Enable public attachment URLs:

```bash
php artisan storage:link
```

## Email integration setup

Configure the support mailbox in `.env`:

```env
MAIL_MAILER=smtp
MAIL_HOST=your-smtp-host
MAIL_PORT=587
MAIL_USERNAME=Support@technosprint.net
MAIL_PASSWORD=your-password
MAIL_FROM_ADDRESS=Support@technosprint.net
MAIL_FROM_NAME="TechnoSprint Support"

IMAP_HOST=your-imap-host
IMAP_PORT=993
IMAP_PROTOCOL=imap
IMAP_ENCRYPTION=ssl
IMAP_USERNAME=Support@technosprint.net
IMAP_PASSWORD=your-password
IMAP_SENT_FOLDER=Sent
```

The scheduler already runs `omnichannel:poll` every minute through `routes/console.php`.
For background notification delivery, keep the queue worker running.
```

## Recommended next migration slices

1. Replace frontend Firebase auth in `../src/pages/Login.tsx`, `../src/pages/Register.tsx`, and `../src/contexts/AuthContext.tsx`
2. Replace Firestore ticket subscriptions in `../src/contexts/TicketsContext.tsx`
3. Port timesheet and activity-tracker APIs from `../server.ts`
4. Port screenshot upload and capture workflows
5. Port master-data CRUD, reporting, AI, and omnichannel endpoints

## Reference

See [docs/laravel-migration-audit.md](docs/laravel-migration-audit.md) for the current gap analysis and endpoint inventory.
