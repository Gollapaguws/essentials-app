/** A door-list row, as much of it as the counters need. */
export interface DoorGuest {
  status: string;
  headcount?: number | null;
  checkedInAt?: string | null;
}

export interface DoorSummary {
  /** Entries on the list, excluding the waitlist. */
  onList: number;
  /** People inside: party sizes added up, not entries. */
  inside: number;
  /** Entries checked in during the current local day. */
  today: number;
}

/**
 * The numbers a door team reads at a glance. They cover the whole night, so a
 * search on the page never changes them.
 */
export function doorSummary(guests: DoorGuest[], now = new Date()): DoorSummary {
  const inside = guests.filter((g) => g.status === "checked_in");
  const day = now.toDateString();
  return {
    onList: guests.filter((g) => g.status !== "waitlisted").length,
    // Party size is what the room sees, not the number of list entries.
    inside: inside.reduce((total, g) => total + (g.headcount || 1), 0),
    today: inside.filter((g) => g.checkedInAt && new Date(g.checkedInAt).toDateString() === day).length,
  };
}

/** The last entries in, newest first. Guests without a timestamp are not "recent". */
export function recentEntries<T extends DoorGuest>(guests: T[], limit = 5): T[] {
  return guests
    .filter((g) => g.status === "checked_in" && g.checkedInAt)
    .sort((a, b) => +new Date(b.checkedInAt!) - +new Date(a.checkedInAt!))
    .slice(0, limit);
}
