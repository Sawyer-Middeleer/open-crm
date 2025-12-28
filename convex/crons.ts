import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Run every minute to check for due scheduled actions
crons.interval(
  "check_scheduled_actions",
  { minutes: 1 },
  internal.functions.actions.scheduled.checkAndExecute
);

export default crons;
