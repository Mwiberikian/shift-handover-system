const pool = require('../../config/db');
const AppError = require('../../utils/AppError');
const { withTransaction } = require('../../db/tx');
const { writeAudit } = require('../../utils/audit');

// Messaging rules (documented in the README):
//  - Direct: any active user may message any other active user, across
//    departments. Deliberate: handover coordination crosses departments. This
//    applies to messaging only; handover data stays department-scoped (FR-03).
//  - Department broadcast: to your own department; supervisors and admins may
//    broadcast to any department.
//  - Organisation-wide: supervisors and admins only.
//  - Messages are append-only: there are no edit or delete operations.
const BROADCASTERS = ['supervisor', 'admin'];

// Messages visible to user $1 in department $2 (direct to them, their
// department's broadcasts, organisation broadcasts), excluding their own.
const VISIBLE = `m.sender_id <> $1 AND (
    (m.recipient_type = 'user' AND m.recipient_user_id = $1)
 OR (m.recipient_type = 'department' AND m.recipient_department_id = $2)
 OR m.recipient_type = 'organisation')`;

// SELECT with sender/recipient names; `extra` adds columns and joins.
const messageSelect = ({ columns = '', joins = '' } = {}) => `
  SELECT m.message_id, m.recipient_type, m.subject, m.body, m.created_at,
         m.sender_id, s.full_name AS sender_name, s.role AS sender_role, sd.name AS sender_department_name,
         m.recipient_user_id, ru.full_name AS recipient_name,
         m.recipient_department_id, rd.name AS recipient_department_name${columns}
    FROM message m
    JOIN app_user s ON s.user_id = m.sender_id
    LEFT JOIN department sd ON sd.department_id = s.department_id
    LEFT JOIN app_user ru ON ru.user_id = m.recipient_user_id
    LEFT JOIN department rd ON rd.department_id = m.recipient_department_id${joins}`;

const paging = ({ page = 1, page_size: pageSize = 20 }) => {
  const size = Math.min(Math.max(Number(pageSize) || 20, 1), 50);
  const p = Math.max(Number(page) || 1, 1);
  return { size, offset: (p - 1) * size, page: p };
};

async function inbox(user, query) {
  const { size, offset, page } = paging(query);
  const params = [user.user_id, user.department_id];
  const { rows } = await pool.query(
    `${messageSelect({
      columns: ', mr.read_at, (mr.read_at IS NULL) AS unread',
      joins: ' LEFT JOIN message_read mr ON mr.message_id = m.message_id AND mr.user_id = $1',
    })}
      WHERE ${VISIBLE}
      ORDER BY m.created_at DESC, m.message_id
      LIMIT ${size} OFFSET ${offset}`,
    params,
  );
  const { rows: [{ total }] } = await pool.query(`SELECT count(*)::int AS total FROM message m WHERE ${VISIBLE}`, params);
  return {
    items: rows, page, page_size: size, total,
  };
}

async function sent(user, query) {
  const { size, offset, page } = paging(query);
  const { rows } = await pool.query(
    `${messageSelect({
      columns: ', (SELECT read_at FROM message_read r WHERE r.message_id = m.message_id AND r.user_id = m.recipient_user_id) AS recipient_read_at',
    })}
      WHERE m.sender_id = $1
      ORDER BY m.created_at DESC, m.message_id
      LIMIT ${size} OFFSET ${offset}`,
    [user.user_id],
  );
  const { rows: [{ total }] } = await pool.query('SELECT count(*)::int AS total FROM message WHERE sender_id = $1', [user.user_id]);
  return {
    items: rows, page, page_size: size, total,
  };
}

// One message, if the caller sent it or may see it; 404 otherwise (does not
// reveal whether it exists).
async function getVisible(user, messageId) {
  const { rows: [m] } = await pool.query(
    `${messageSelect()} WHERE m.message_id = $3 AND (m.sender_id = $1 OR ${VISIBLE})`,
    [user.user_id, user.department_id, messageId],
  );
  if (!m) throw new AppError(404, 'Message not found');
  return m;
}

async function unreadCount(user) {
  const { rows: [{ count }] } = await pool.query(
    `SELECT count(*)::int AS count FROM message m
      WHERE ${VISIBLE}
        AND NOT EXISTS (SELECT 1 FROM message_read r WHERE r.message_id = m.message_id AND r.user_id = $1)`,
    [user.user_id, user.department_id],
  );
  return { count };
}

async function markRead(user, messageId) {
  const m = await getVisible(user, messageId);
  if (m.sender_id === user.user_id) return { message_id: messageId, read_at: null };
  return withTransaction(async (client) => {
    await client.query(
      'INSERT INTO message_read (message_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [messageId, user.user_id],
    );
    // Keep the bell in step for direct messages.
    await client.query(
      'UPDATE notification SET read_at = COALESCE(read_at, now()) WHERE message_id = $1 AND recipient_id = $2',
      [messageId, user.user_id],
    );
    const { rows: [r] } = await client.query('SELECT read_at FROM message_read WHERE message_id = $1 AND user_id = $2', [messageId, user.user_id]);
    return { message_id: messageId, read_at: r.read_at };
  });
}

async function assertMaySend(client, user, body) {
  if (body.recipient_type === 'user') {
    if (body.recipient_user_id === user.user_id) throw new AppError(400, 'You cannot send a message to yourself');
    const { rows: [r] } = await client.query('SELECT is_active FROM app_user WHERE user_id = $1', [body.recipient_user_id]);
    if (!r || !r.is_active) throw new AppError(404, 'Recipient not found or inactive');
    return;
  }
  if (body.recipient_type === 'department') {
    const { rows: [d] } = await client.query('SELECT 1 FROM department WHERE department_id = $1', [body.recipient_department_id]);
    if (!d) throw new AppError(404, 'Department not found');
    if (!BROADCASTERS.includes(user.role) && body.recipient_department_id !== user.department_id) {
      throw new AppError(403, 'You can only broadcast to your own department');
    }
    return;
  }
  if (!BROADCASTERS.includes(user.role)) {
    throw new AppError(403, 'Only supervisors and administrators can message everyone');
  }
}

async function send(user, body) {
  return withTransaction(async (client) => {
    await assertMaySend(client, user, body);
    const { rows: [m] } = await client.query(
      `INSERT INTO message (sender_id, recipient_type, recipient_user_id, recipient_department_id, subject, body)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [
        user.user_id, body.recipient_type,
        body.recipient_type === 'user' ? body.recipient_user_id : null,
        body.recipient_type === 'department' ? body.recipient_department_id : null,
        body.subject || null, body.body,
      ],
    );
    // Audit ids and recipient type only, never the subject or body.
    await writeAudit(client, {
      userId: user.user_id, entityType: 'message', entityId: m.message_id, action: 'send',
      newValue: {
        message_id: m.message_id, recipient_type: m.recipient_type,
        recipient_user_id: m.recipient_user_id, recipient_department_id: m.recipient_department_id,
      },
    });
    // Direct messages notify the recipient; broadcasts rely on the unread
    // count instead of fanning out one notification row per person.
    if (m.recipient_type === 'user') {
      await client.query(
        "INSERT INTO notification (recipient_id, type, message_id) VALUES ($1, 'message', $2)",
        [m.recipient_user_id, m.message_id],
      );
    }
    return m;
  });
}

// Active users, minimal fields only, for the recipient picker.
async function directory() {
  const { rows } = await pool.query(
    `SELECT u.user_id, u.full_name, u.role, d.name AS department_name
       FROM app_user u LEFT JOIN department d USING (department_id)
      WHERE u.is_active
      ORDER BY u.full_name`,
  );
  return rows;
}

// Departments (id and name) for the broadcast picker.
async function departments() {
  const { rows } = await pool.query('SELECT department_id, name FROM department ORDER BY name');
  return rows;
}

module.exports = {
  inbox, sent, getVisible, unreadCount, markRead, send, directory, departments,
};
