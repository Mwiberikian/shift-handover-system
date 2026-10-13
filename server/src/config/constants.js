module.exports = {
  // bcrypt work factor required by the proposal.
  BCRYPT_ROUNDS: 12,
  // A submitted record not acknowledged this long after shift start is flagged.
  UNACK_ALERT_HOURS: 2,
  // DR-04: task description length in characters, after trimming.
  TASK_DESCRIPTION: { min: 10, max: 1000 },
};
