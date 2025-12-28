// Simple cron expression parser for scheduled action triggers.
// Supports standard 5-field cron format: minute hour day-of-month month day-of-week
//
// Examples:
// - "0 9 * * 1-5" = 9 AM on weekdays
// - "star/15 * * * *" = every 15 minutes (where star = *)
// - "0 0 1 * *" = midnight on 1st of each month

/**
 * Check if a cron expression matches the given date
 */
export function isCronDue(cronString: string, date: Date): boolean {
  const parts = cronString.trim().split(/\s+/);
  if (parts.length !== 5) {
    return false;
  }

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

  return (
    matchesCronField(minute, date.getUTCMinutes()) &&
    matchesCronField(hour, date.getUTCHours()) &&
    matchesCronField(dayOfMonth, date.getUTCDate()) &&
    matchesCronField(month, date.getUTCMonth() + 1) &&
    matchesCronField(dayOfWeek, date.getUTCDay())
  );
}

// Check if a single cron field matches the given value
// Supports: wildcard, specific numbers, ranges (1-5), steps (e.g. every 5), lists (1,3,5)
function matchesCronField(field: string, value: number): boolean {
  // Wildcard matches everything
  if (field === "*") {
    return true;
  }

  // List: "1,3,5" or "1,3-5,7"
  if (field.includes(",")) {
    return field.split(",").some((f) => matchesCronField(f.trim(), value));
  }

  // Step: e.g. every 5 minutes, or "1-10/2"
  if (field.includes("/")) {
    const [range, stepStr] = field.split("/");
    const step = parseInt(stepStr, 10);
    if (isNaN(step) || step <= 0) {
      return false;
    }

    if (range === "*") {
      return value % step === 0;
    }

    // Range with step: "1-10/2"
    if (range.includes("-")) {
      const [startStr, endStr] = range.split("-");
      const start = parseInt(startStr, 10);
      const end = parseInt(endStr, 10);
      if (isNaN(start) || isNaN(end)) {
        return false;
      }
      return value >= start && value <= end && (value - start) % step === 0;
    }

    // Single value with step (unusual but valid)
    const start = parseInt(range, 10);
    if (isNaN(start)) {
      return false;
    }
    return value >= start && (value - start) % step === 0;
  }

  // Range: "1-5"
  if (field.includes("-")) {
    const [startStr, endStr] = field.split("-");
    const start = parseInt(startStr, 10);
    const end = parseInt(endStr, 10);
    if (isNaN(start) || isNaN(end)) {
      return false;
    }
    return value >= start && value <= end;
  }

  // Specific value: "5"
  const target = parseInt(field, 10);
  if (isNaN(target)) {
    return false;
  }
  return value === target;
}
