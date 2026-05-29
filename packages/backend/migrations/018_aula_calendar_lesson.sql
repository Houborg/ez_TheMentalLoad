-- Migration 018: add calendar_lesson to aula_items type constraint
-- calendar_lesson = timed school lessons from calendar.getEventsByProfileIdsAndResourceIds
-- Fixes the 403 issue: sidecar now calls the API directly with correct +02:00 TZ format

ALTER TABLE aula_items
  DROP CONSTRAINT IF EXISTS aula_items_type_check;

ALTER TABLE aula_items
  ADD CONSTRAINT aula_items_type_check
  CHECK (type IN (
    'post',
    'message',
    'daily_overview',
    'weekplan_lesson',
    'mu_task',
    'presence',
    'calendar_lesson'
  ));
