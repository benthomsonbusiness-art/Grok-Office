/** Display names for stored room statuses. Stored values stay unchanged. */
export const ROOM_LABELS: Record<string, string> = {
  working: "Work",
  waiting: "Wait",
  error: "Repair",
  meeting: "War Room",
  idle: "Lounge",
  no_report: "Standby",
};

export function roomLabel(status: string): string {
  return ROOM_LABELS[status] ?? status;
}
