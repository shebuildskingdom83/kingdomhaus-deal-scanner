export const RECOVERY_FEEDBACK_DURATION_MS = 4000;

/** Completed actions only. Recovery warnings and errors must remain visible. */
export function completedRecoveryMessage(notice: string, cloud: boolean): string | null {
  switch (notice) {
    case "Acquisition renamed.":
    case "Acquisition deleted. Open work kept.":
    case "Backup exported.":
    case "CSV exported.": return notice;
    default: return null;
  }
}
