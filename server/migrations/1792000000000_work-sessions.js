/**
 * Work sessions and task timers (Part M).
 *
 *  - work_session: one row per "Start shift" .. "End shift" (or automatic
 *    end). At most one active session (ended_at IS NULL) per user.
 *  - task_timer: time a user spends on one task inside a session. At most one
 *    running timer (stopped_at IS NULL) per user. A timer can only be started
 *    in the user's own active session.
 *  - Rows are append-only. The only changes allowed are:
 *      work_session.ended_at (+ end_reason, set together) once, NULL -> time;
 *      work_session.last_heartbeat_at, forwards only, while the session is
 *        active (the heartbeat the client sends every 60 s);
 *      task_timer.stopped_at once, NULL -> time.
 *    Deletes are refused. Nothing is ever purged: rows are kept indefinitely.
 *  - Every foreign key is ON DELETE RESTRICT.
 *  - audit_log gets an index on (user_id, logged_at) for the live board's
 *    "last activity".
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.shorthands = undefined;

const fk = (table) => ({ references: table, onDelete: 'RESTRICT' });
const uuidPk = { type: 'uuid', primaryKey: true, default: { literal: true, value: 'gen_random_uuid()' } };
const now = { type: 'timestamptz', notNull: true, default: { literal: true, value: 'now()' } };

exports.up = (pgm) => {
  pgm.createType('session_end_reason_enum', ['manual', 'heartbeat', 'shift_end']);

  pgm.createTable('work_session', {
    session_id: uuidPk,
    user_id: { type: 'uuid', notNull: true, ...fk('app_user') },
    shift_id: { type: 'uuid', notNull: true, ...fk('shift') },
    started_at: now,
    ended_at: { type: 'timestamptz' },
    end_reason: { type: 'session_end_reason_enum' },
    last_heartbeat_at: now,
  });
  pgm.addConstraint('work_session', 'work_session_end_together', { check: '(ended_at IS NULL) = (end_reason IS NULL)' });
  pgm.addConstraint('work_session', 'work_session_time_order', {
    check: 'last_heartbeat_at >= started_at AND (ended_at IS NULL OR ended_at >= started_at)',
  });
  pgm.createIndex('work_session', 'user_id', { name: 'work_session_one_active_per_user', unique: true, where: 'ended_at IS NULL' });
  pgm.createIndex('work_session', ['user_id', 'started_at']);
  pgm.createIndex('work_session', ['shift_id']);

  pgm.createTable('task_timer', {
    timer_id: uuidPk,
    session_id: { type: 'uuid', notNull: true, ...fk('work_session') },
    task_id: { type: 'uuid', notNull: true, ...fk('task') },
    user_id: { type: 'uuid', notNull: true, ...fk('app_user') },
    started_at: now,
    stopped_at: { type: 'timestamptz' },
  });
  pgm.addConstraint('task_timer', 'task_timer_time_order', { check: 'stopped_at IS NULL OR stopped_at >= started_at' });
  pgm.createIndex('task_timer', 'user_id', { name: 'task_timer_one_running_per_user', unique: true, where: 'stopped_at IS NULL' });
  pgm.createIndex('task_timer', ['session_id']);
  pgm.createIndex('task_timer', ['task_id']);

  pgm.createIndex('audit_log', ['user_id', 'logged_at']);

  pgm.sql(`
    CREATE FUNCTION work_session_guard() RETURNS trigger AS $$
    BEGIN
      IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'work_session is append-only (DELETE rejected)'
          USING ERRCODE = 'P0001', HINT = 'append_only';
      END IF;
      IF NEW.session_id IS DISTINCT FROM OLD.session_id
      OR NEW.user_id    IS DISTINCT FROM OLD.user_id
      OR NEW.shift_id   IS DISTINCT FROM OLD.shift_id
      OR NEW.started_at IS DISTINCT FROM OLD.started_at THEN
        RAISE EXCEPTION 'work_session %: only ended_at, end_reason and last_heartbeat_at can change', OLD.session_id
          USING ERRCODE = 'P0001', HINT = 'append_only';
      END IF;
      IF OLD.ended_at IS NOT NULL AND NEW IS DISTINCT FROM OLD THEN
        RAISE EXCEPTION 'work_session % has ended and cannot change', OLD.session_id
          USING ERRCODE = 'P0001', HINT = 'append_only';
      END IF;
      IF NEW.last_heartbeat_at < OLD.last_heartbeat_at THEN
        RAISE EXCEPTION 'work_session %: last_heartbeat_at cannot go backwards', OLD.session_id
          USING ERRCODE = 'P0001', HINT = 'append_only';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER trg_work_session_guard
      BEFORE UPDATE OR DELETE ON work_session
      FOR EACH ROW EXECUTE FUNCTION work_session_guard();

    CREATE FUNCTION task_timer_guard() RETURNS trigger AS $$
    DECLARE
      s work_session%ROWTYPE;
    BEGIN
      IF TG_OP = 'INSERT' THEN
        SELECT * INTO s FROM work_session WHERE session_id = NEW.session_id;
        IF s.user_id IS DISTINCT FROM NEW.user_id OR s.ended_at IS NOT NULL THEN
          RAISE EXCEPTION 'a timer needs the same user''s active work session'
            USING ERRCODE = 'P0001', HINT = 'append_only';
        END IF;
        RETURN NEW;
      END IF;
      IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'task_timer is append-only (DELETE rejected)'
          USING ERRCODE = 'P0001', HINT = 'append_only';
      END IF;
      IF NEW.timer_id   IS DISTINCT FROM OLD.timer_id
      OR NEW.session_id IS DISTINCT FROM OLD.session_id
      OR NEW.task_id    IS DISTINCT FROM OLD.task_id
      OR NEW.user_id    IS DISTINCT FROM OLD.user_id
      OR NEW.started_at IS DISTINCT FROM OLD.started_at
      OR (OLD.stopped_at IS NOT NULL AND NEW.stopped_at IS DISTINCT FROM OLD.stopped_at) THEN
        RAISE EXCEPTION 'task_timer %: only stopped_at can be set, once', OLD.timer_id
          USING ERRCODE = 'P0001', HINT = 'append_only';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER trg_task_timer_guard
      BEFORE INSERT OR UPDATE OR DELETE ON task_timer
      FOR EACH ROW EXECUTE FUNCTION task_timer_guard();
  `);
};

exports.down = (pgm) => {
  pgm.sql('DROP TRIGGER IF EXISTS trg_task_timer_guard ON task_timer');
  pgm.sql('DROP TRIGGER IF EXISTS trg_work_session_guard ON work_session');
  pgm.sql('DROP FUNCTION IF EXISTS task_timer_guard()');
  pgm.sql('DROP FUNCTION IF EXISTS work_session_guard()');
  pgm.dropIndex('audit_log', ['user_id', 'logged_at']);
  pgm.dropTable('task_timer');
  pgm.dropTable('work_session');
  pgm.dropType('session_end_reason_enum');
};
