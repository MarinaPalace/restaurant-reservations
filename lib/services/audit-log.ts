import { connectToDatabase, isMongoConfigured } from "@/lib/db/connect";
import { AuditEntryModel } from "@/lib/models/audit-entry";
import { appendLocalAuditEntry, listLocalAuditEntries } from "@/lib/db/local-admin-store";
import type { Actor, AuditAction, AuditChange, AuditEntry } from "@/types/booking";

/**
 * Who did what, and when.
 *
 * Every action that changes a booking or an account writes one line here. The
 * log is append-only — nothing in the app updates or deletes an entry, which
 * is the only reason it is worth having.
 *
 * Writing to it must never break the thing being logged: a failed log write is
 * reported to the server console and swallowed. Losing the record of a
 * cancellation is bad; failing the guest's cancellation because the log was
 * unreachable is worse.
 */

type MongoAuditDocument = Record<string, unknown>;

function toAuditEntry(document: MongoAuditDocument): AuditEntry {
  return {
    _id: String(document._id),
    id: String(document._id),
    at: document.createdAt ? new Date(document.createdAt as string).toISOString() : new Date(0).toISOString(),
    action: String(document.action) as AuditAction,
    actorKind: (document.actorKind as AuditEntry["actorKind"]) ?? "system",
    actorId: document.actorId ? String(document.actorId) : undefined,
    actorName: String(document.actorName ?? "Unknown"),
    reservationNumber: document.reservationNumber ? String(document.reservationNumber) : undefined,
    summary: String(document.summary ?? ""),
    ...(Array.isArray(document.changes) && document.changes.length > 0
      ? { changes: (document.changes as AuditChange[]).map(toAuditChange) }
      : {}),
    ...(typeof document.version === "number" ? { version: document.version } : {}),
  };
}

function toAuditChange(change: AuditChange): AuditChange {
  return {
    field: String(change.field ?? ""),
    label: String(change.label ?? ""),
    ...(change.from ? { from: String(change.from) } : {}),
    ...(change.to ? { to: String(change.to) } : {}),
  };
}

export async function recordAuditEntry(input: {
  action: AuditAction;
  actor: Actor;
  reservationNumber?: string;
  summary: string;
  /** What moved, field by field. Only edits have any. */
  changes?: AuditChange[];
  /** The version of the record this produced, when the record is versioned. */
  version?: number;
}): Promise<void> {
  try {
    if (!isMongoConfigured()) {
      await appendLocalAuditEntry({
        at: new Date().toISOString(),
        action: input.action,
        actorKind: input.actor.kind,
        actorId: input.actor.id,
        actorName: input.actor.name,
        reservationNumber: input.reservationNumber,
        summary: input.summary,
        ...(input.changes?.length ? { changes: input.changes } : {}),
        ...(input.version === undefined ? {} : { version: input.version }),
      });
      return;
    }

    await connectToDatabase();
    await AuditEntryModel.create({
      action: input.action,
      actorKind: input.actor.kind,
      actorId: input.actor.id,
      actorName: input.actor.name,
      reservationNumber: input.reservationNumber,
      summary: input.summary,
      ...(input.changes?.length ? { changes: input.changes } : {}),
      ...(input.version === undefined ? {} : { version: input.version }),
    });
  } catch (error) {
    console.error("[audit] failed to record entry", input.action, error);
  }
}

export async function getAuditEntries(options: {
  reservationNumber?: string;
  limit?: number;
} = {}): Promise<AuditEntry[]> {
  const limit = Math.min(options.limit ?? 200, 1000);

  if (!isMongoConfigured()) {
    return listLocalAuditEntries({ reservationNumber: options.reservationNumber, limit });
  }

  await connectToDatabase();

  const filter = options.reservationNumber ? { reservationNumber: options.reservationNumber } : {};
  const entries = await AuditEntryModel.find(filter).sort({ createdAt: -1 }).limit(limit).lean();

  return entries.map((entry) => toAuditEntry(entry as MongoAuditDocument));
}
