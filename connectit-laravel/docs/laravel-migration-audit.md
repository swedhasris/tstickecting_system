# Laravel Migration Audit

## Date

2026-05-15

## Summary

The repository is not yet fully migrated from TypeScript/Firebase/Express to Laravel/MySQL.
There is already a partial Laravel implementation, but the working application still depends on:

- Firebase Auth
- Firestore reads and subscriptions in the frontend
- Express endpoints in `C:\Users\HP\Downloads\tickect\tis\server.ts`

This means the system cannot yet be truthfully described as a fully working Laravel-only replacement.

## What exists today

### Frontend

- React + TypeScript app under `C:\Users\HP\Downloads\tickect\tis\src`
- Direct Firebase usage in:
  - `C:\Users\HP\Downloads\tickect\tis\src\contexts\AuthContext.tsx`
  - `C:\Users\HP\Downloads\tickect\tis\src\contexts\TicketsContext.tsx`
  - `C:\Users\HP\Downloads\tickect\tis\src\pages\Login.tsx`
  - `C:\Users\HP\Downloads\tickect\tis\src\pages\Register.tsx`

### Existing Node backend

`C:\Users\HP\Downloads\tickect\tis\server.ts` currently remains the broadest backend surface.

Observed endpoint groups:

- Health and DB diagnostics
- Ticket CRUD and activity timeline
- Users and auth
- Timesheets and time cards
- Work sessions and work notes
- Activity tracker sessions and entries
- Screenshot upload and screen capture
- AI endpoints
- Master data CRUD
- Message history

### Laravel app

`C:\Users\HP\Downloads\tickect\tis\connectit-laravel`

Already includes:

- Laravel 13 scaffold
- MySQL config and migrations
- Ticket-related models, enums, events, mailers, jobs, services
- Partial API routes

## Gap analysis

### Working in Laravel after this pass

- MySQL-backed migrations for major ITSM tables
- Core `/api/tickets/*` compatibility for:
  - list all
  - list open
  - list assigned
  - list unassigned
  - list resolved
  - show ticket
  - create ticket
  - update ticket
  - delete ticket
  - list activities
  - add activity
  - add comment
- `/api/users` basic CRUD
- `/api/auth/login` with the legacy simple hash behavior
- `/api/health`
- `/api/db-test`

### Still missing for a complete Laravel conversion

- Frontend auth migration off Firebase
- Frontend ticket subscription migration off Firestore
- Register flow migration off Firestore
- Timesheet APIs
- Time card APIs
- Activity tracker APIs
- Screenshot upload and screen capture APIs
- Work session and work note APIs
- Master data APIs
- AI work-analysis endpoints
- Message history APIs
- Full reporting and dashboard parity
- Full SLA scheduler parity with the Express cron implementation
- Omni-channel polling parity
- Attachment storage flow parity
- Automated regression coverage proving old/new behavior matches

## Risk notes

1. The frontend currently expects a mix of Firestore and REST behavior, so backend migration alone does not finish the job.
2. Some generated migration notes in the repo overstate completion.
3. Preserving behavior exactly requires endpoint-by-endpoint validation against the current app, not just schema conversion.

## Recommended execution order

1. Replace Firebase auth and registration flows with Laravel endpoints.
2. Replace Firestore ticket subscriptions with Laravel polling or broadcasting.
3. Port timesheet and activity-tracker APIs from `server.ts`.
4. Port screenshot and attachment handling.
5. Port master-data and reporting modules.
6. Move the SPA build into Laravel and run the app behind one server boundary.
7. Add regression tests for core ticket, SLA, role, and dashboard flows.

## Files changed in this pass

- `C:\Users\HP\Downloads\tickect\tis\connectit-laravel\app\Http\Controllers\LegacyApiController.php`
- `C:\Users\HP\Downloads\tickect\tis\connectit-laravel\routes\api.php`
- `C:\Users\HP\Downloads\tickect\tis\connectit-laravel\README.md`
