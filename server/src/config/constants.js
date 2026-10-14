module.exports = {
  // bcrypt work factor required by the proposal.
  BCRYPT_ROUNDS: 12,
  // A submitted record not acknowledged this long after shift start is flagged.
  UNACK_ALERT_HOURS: 2,
  // DR-04: task description length in characters, after trimming.
  TASK_DESCRIPTION: { min: 10, max: 1000 },
  // Part M: work sessions. The client sends a heartbeat every
  // heartbeatSeconds while the tab is visible; a session with none for
  // heartbeatTimeoutMinutes ends at its last heartbeat, and any session ends
  // shiftEndGraceMinutes after its shift. The live board shows a worker as
  // idle after idleAfterMinutes without a heartbeat.
  SESSION: {
    heartbeatSeconds: 60, heartbeatTimeoutMinutes: 10, shiftEndGraceMinutes: 30, idleAfterMinutes: 2,
  },
};
