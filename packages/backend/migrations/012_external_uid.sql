-- Track the source UID for entries imported from external calendars (e.g. Apple CalDAV).
-- Used for dedup: before importing a remote event we check if external_uid already exists.
ALTER TABLE entries ADD COLUMN IF NOT EXISTS external_uid TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS entries_external_uid_family_uniq
  ON entries (external_uid, family_id)
  WHERE external_uid IS NOT NULL;
