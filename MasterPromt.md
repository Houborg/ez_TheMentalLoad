---
> Build a complete full-stack family calendar platform called MentalLoad.
>
> Use a monorepo architecture with:
>
> * a React and Vite frontend
> * a Fastify and TypeScript backend
> * shared TypeScript contracts between frontend and backend
> * Playwright end-to-end tests
> * local infrastructure for PostgreSQL, Redis, Mailpit, and Ollama (via Docker Compose)
>
> The product is not a generic personal calendar. It is a family project manager for parents and children with shared planning, ownership, reminders, and natural-language assistant workflows.
>
> ---
>
> ## ARCHITECTURE REQUIREMENTS
>
> Backend must follow a modular, domain-driven structure:
>
> * domains: members, entries, calendars, reminders, assistant, chat, mail, sync
> * use repository pattern with interchangeable persistence (in-memory → PostgreSQL)
> * maintain a stable public REST API under /api/v1
> * separate domain logic from transport (routes/controllers)
>
> Use an event-driven approach internally:
>
> * emit domain events (e.g. entry.created, reminder.triggered)
> * use Redis (BullMQ or similar) for background jobs and scheduling
>
> ---
>
> ## REALTIME REQUIREMENTS (CRITICAL)
>
> Implement realtime updates:
>
> * WebSocket support (or Socket.io)
> * clients receive updates when events/tasks are created, updated, or deleted
> * keep state in sync across multiple users/devices instantly
>
> ---
>
> ## CALENDAR & TIME LOGIC (CRITICAL)
>
> The system must support real calendar standards:
>
> * recurring events using RRULE standard
> * ICS import and export support
> * timezone-aware date handling
> * all-day vs timed events
>
> Use libraries where appropriate:
>
> * recurrence: rrule
> * ICS parsing/generation: ical.js or equivalent
>
> ---
>
> ## CORE FEATURES
>
> * family member management with parent and child roles
>
> * role-based permissions (parents can manage all, children limited scope)
>
> * active member switching
>
> * multiple calendars per family (e.g. “Dad”, “Mom”, “Son”)
>
> * event and task creation, editing, deletion, and completion
>
> * reminders with flexible timing
>
> * checklist support inside tasks
>
> * recurring events and tasks
>
> * weekly planner (primary UI)
>
> * monthly overview
>
> * notes and meal planning (lightweight, linked to days)
>
> * weather widget (read-only integration)
>
> * assistant chat for natural-language scheduling
>
> * invite-mail sync via IMAP and SMTP
>
> * settings UI (AI, mail, members, sync)
>
> * mobile-friendly responsive UI
>
> * Danish and English language support (i18n)
>
> ---
>
> ## ENTRY MODEL REQUIREMENTS
>
> Entry must support:
>
> * id
> * title
> * type (event | task)
> * owner member
> * calendarId
> * start and end time (timezone aware)
> * allDay flag
> * reminder configuration (multiple reminders supported)
> * checklist (array of items with completion state)
> * completion state
> * optional location
> * recurrence rule (RRULE string)
> * invitees
> * linked entries (e.g. auto-created tasks)
>
> ---
>
> ## ASSISTANT DESIGN (IMPORTANT)
>
> The assistant must NOT directly control business logic.
>
> Instead:
>
> * AI (via Ollama) is used for:
>
>   * natural language understanding
>   * intent detection
>   * entity extraction
>   * phrasing responses
> * actual event/task creation must be deterministic and handled by backend logic
>
> Assistant must:
>
> * support Danish and English
> * understand:
>
>   * “make an event on 12.4.2026 at 10:00 in Sagas calendar: Birthday at ELLA”
>   * relative dates (today, tomorrow, i dag, i morgen, weekdays)
>
> Flow:
>
> * parse → create draft → ask follow-up → confirm → persist
>
> ---
>
> ## AUTOMATION RULES
>
> Birthday rule:
>
> * detect “birthday” or Danish equivalent
> * auto-create linked task: “Buy a gift”
> * set reminder 24 hours before
> * prevent duplicates
>
> Future-proof:
>
> * design a simple rule engine for similar automations
>
> ---
>
> ## SYNC & INTEGRATIONS
>
> Sync modes:
>
> * none
> * apple (ICS-based)
> * invite-mail
>
> Additionally design for future integrations:
>
> * Google Calendar
> * Outlook
>
> Requirements:
>
> * provider must be connected before configuration is saved
> * support manual sync trigger
> * store sync state and defaults locally
>
> ---
>
> ## NOTIFICATIONS & JOBS
>
> Use Redis for:
>
> * scheduling reminders
> * background jobs
>
> Support:
>
> * email notifications (via SMTP)
> * future push notification support (design-ready)
>
> ---
>
> ## FRONTEND REQUIREMENTS
>
> * responsive weekly planner with member columns
> * monthly overview panel
> * drag-and-drop event editing
> * create/edit flows for events and tasks
> * assistant chat UI with draft preview and follow-ups
> * settings pages
>
> Use:
>
> * shared API client layer (no scattered fetch calls)
> * optimistic UI updates where appropriate
>
> Consider using a calendar UI library (e.g. FullCalendar) but structure it cleanly.
>
> ---
>
> ## AI INTEGRATION
>
> * use Ollama locally
> * fallback gracefully if model is unavailable
> * keep critical logic independent of AI
>
> ---
>
> ## NON-FUNCTIONAL REQUIREMENTS
>
> * clean TypeScript types
> * testable architecture
> * migration-friendly database layer
> * safe local defaults
> * production-ready structure without unnecessary complexity
>
> ---
>
> ## VERIFICATION / DEFINITION OF DONE
>
> * app runs locally via Docker Compose
> * frontend and backend build successfully
> * tests pass
> * realtime updates work across multiple clients
> * recurring events behave correctly
> * ICS import/export works
> * assistant flow works end-to-end
> * reminders trigger via background jobs
> * birthday rule creates both event and gift task
>
> Deliver the project in phases, but continue until:
>
> * working code
> * tests
> * documentation
> * solid backend foundation
>
> Do not stop at scaffolding.




## DATABASE DESIGN (POSTGRESQL)

Use PostgreSQL as the primary database.

The schema must be designed for a real calendar system with support for recurrence, relationships, and future integrations.

Core tables:

members

* id (uuid)
* name
* role (parent | child)
* created_at

calendars

* id (uuid)
* name
* color
* owner_member_id
* created_at

entries

* id (uuid)
* title
* type (event | task)
* owner_member_id
* calendar_id
* start_time (timestamp with timezone)
* end_time (timestamp with timezone)
* all_day (boolean)
* location
* status (active | completed | cancelled)
* recurrence_rule (text, RRULE format)
* parent_entry_id (for linked entries)
* created_at
* updated_at

entry_reminders

* id (uuid)
* entry_id
* minutes_before (integer)
* created_at

entry_checklist_items

* id (uuid)
* entry_id
* text
* is_completed (boolean)

entry_invitees

* id (uuid)
* entry_id
* email
* status (pending | accepted | declined)

chat_conversations

* id (uuid)
* member_id
* created_at

chat_messages

* id (uuid)
* conversation_id
* role (user | assistant | system)
* content
* created_at

assistant_configs

* id (uuid)
* model_name
* language
* enabled

sync_settings

* id (uuid)
* provider (none | apple | invite-mail)
* config_json (jsonb)
* is_connected (boolean)

---

## DATABASE REQUIREMENTS

* Use migrations (no schema sync)
* Use UUIDs for all primary keys
* Use proper indexing:

  * entries (calendar_id, start_time)
  * entries (owner_member_id)
  * reminders (entry_id)
* Use JSONB only where flexibility is needed (e.g. provider configs)
* Enforce foreign key constraints

---

## EVENT-DRIVEN BACKEND (IMPORTANT)

The backend must emit domain events:

* entry.created
* entry.updated
* entry.deleted
* reminder.scheduled
* reminder.triggered

Use Redis (BullMQ or similar) for:

* scheduling reminders
* processing background jobs
* retry logic

Example flow:

* user creates event
  → entry.created event emitted
  → reminder jobs scheduled in Redis
  → when time is reached → reminder.triggered
  → send email notification

---

## REPOSITORY LAYER

Use a repository abstraction:

* EntryRepository
* MemberRepository
* CalendarRepository

Each repository must:

* support in-memory implementation
* support PostgreSQL implementation

Switching database must NOT affect API behavior.

---

## FUTURE-PROOFING

Design the schema so it can later support:

* external calendar IDs (Google / Outlook)
* multi-family support
* audit logs (optional table later)
* attachments (optional)
