// Writes one audit_log row. Must be called with the transaction client of the
// write being logged so the change and its audit entry commit (or roll back)
// together.
async function writeAudit(client, { userId, entityType, entityId, action, previousValue = null, newValue = null }) {
  await client.query(
    `INSERT INTO audit_log (user_id, entity_type, entity_id, action, previous_value, new_value)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      userId, entityType, entityId, action,
      previousValue === null ? null : JSON.stringify(previousValue),
      newValue === null ? null : JSON.stringify(newValue),
    ],
  );
}

module.exports = { writeAudit };
