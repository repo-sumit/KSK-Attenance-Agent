/**
 * How a read combines the server with the device (D-143). Pure.
 *
 * - A record this device has not synced yet (pending or failed) wins for its key: the phone shows what it locked.
 * - Otherwise the server's copy wins, also over a device record the server refused (`rejected`: someone else
 *   submitted that session first), so every device shows the same marks.
 * - A device record the server does not have (yet) still shows: an offline phone keeps its own records, and a
 *   record that has just synced is never missing between the push and the next server read.
 * - Except (Task 17) after a live server read: a device record that already reached the server (`synced`) but that
 *   the server no longer has (a shared reset deleted it) is gone for good, so it is dropped (`staleSynced`).
 */
import { awaitsSync, type SyncState } from '@/domain/attendance';

/** A device record still on its way to the server (pending or failed): it wins over the server's copy. */
export { awaitsSync };

export function mergeRecords<T extends { readonly syncState: SyncState }>(server: readonly T[], local: readonly T[], keyOf: (record: T) => string): T[] {
  const out = new Map(server.map((r) => [keyOf(r), r]));
  for (const r of local) {
    const key = keyOf(r);
    if (awaitsSync(r) || !out.has(key)) out.set(key, r);
  }
  return [...out.values()];
}

/**
 * The device's synced records that a live server answer for the same query no longer has (same key and id).
 * Pending, failed and rejected records are never among them. Call it only with a live answer (`LiveRead.live`).
 */
export function staleSynced<T extends { readonly id: string; readonly syncState: SyncState }>(server: readonly T[], local: readonly T[], keyOf: (record: T) => string): T[] {
  const onServer = new Set(server.map((r) => `${keyOf(r)}\u0000${r.id}`));
  return local.filter((r) => r.syncState === 'synced' && !onServer.has(`${keyOf(r)}\u0000${r.id}`));
}

/** The merged records of one read, dropping (and handing back) the stale synced ones when the read was live. */
export function mergeLive<T extends { readonly id: string; readonly syncState: SyncState }>(
  read: { readonly value: readonly T[]; readonly live: boolean },
  local: readonly T[],
  keyOf: (record: T) => string,
): { readonly records: T[]; readonly dropped: T[] } {
  const dropped = read.live ? staleSynced(read.value, local, keyOf) : [];
  const gone = new Set(dropped);
  return { records: mergeRecords(read.value, local.filter((r) => !gone.has(r)), keyOf), dropped };
}
