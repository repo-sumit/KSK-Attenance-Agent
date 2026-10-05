-- KSK Attendance (final review): one global order for corrections on every device. A server-assigned, insert-order
-- sequence (GENERATED ALWAYS: a client cannot supply it). Devices sort corrections by (timestamp, seq, correction_id);
-- corrections still waiting in a device's outbox go after the synced ones.
alter table public.corrections add column if not exists seq bigint generated always as identity;
create index if not exists corrections_seq_idx on public.corrections (seq);
