-- Allow calendars with no specific member owner (e.g. a shared "Family" calendar).
alter table calendars alter column owner_member_id drop not null;
