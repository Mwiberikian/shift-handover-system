/**
 * Shift reports (Part L).
 *
 *  - report: a worker's own account of a shift (what was done, what is still
 *    pending). draft -> submitted. Once submitted a report is immutable: no
 *    column can change and it cannot be deleted (trg_report_guard).
 *  - Lengths: done_text 10-5000 characters; pending_text 10-5000 unless
 *    nothing_pending is true (characters after trimming). A draft may be
 *    incomplete but never longer than 5000; a submitted row must satisfy the
 *    full rule (CHECK report_submitted_complete).
 *  - report_task: optional links from a report to handover tasks. Frozen once
 *    the report is submitted; never updated.
 *  - report_share: who a submitted report was shared with, by whom and when.
 *    Append-only except read_at, which can be set once (NULL -> a time).
 *  - notification gains report_id, so a "report shared" alert links to it.
 *  - Every foreign key is ON DELETE RESTRICT.
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.shorthands = undefined;

const fk = (table) => ({ references: table, onDelete: 'RESTRICT' });

exports.up = (pgm) => {
  pgm.createType('report_status_enum', ['draft', 'submitted']);

  pgm.createTable('report', {
    report_id: { type: 'uuid', primaryKey: true, default: { literal: true, value: 'gen_random_uuid()' } },
    author_id: { type: 'uuid', notNull: true, ...fk('app_user') },
    shift_id: { type: 'uuid', notNull: true, ...fk('shift') },
    title: { type: 'varchar(160)', notNull: true },
    done_text: { type: 'text', notNull: true, default: '' },
    pending_text: { type: 'text', notNull: true, default: '' },
    nothing_pending: { type: 'boolean', notNull: true, default: false },
    status: { type: 'report_status_enum', notNull: true, default: 'draft' },
    created_at: { type: 'timestamptz', notNull: true, default: { literal: true, value: 'now()' } },
    submitted_at: { type: 'timestamptz' },
  });
  pgm.addConstraint('report', 'report_text_max', {
    check: 'char_length(btrim(done_text)) <= 5000 AND char_length(btrim(pending_text)) <= 5000',
  });
  pgm.addConstraint('report', 'report_submitted_complete', {
    check: `status = 'draft' OR (
              submitted_at IS NOT NULL
          AND char_length(btrim(title)) >= 1
          AND char_length(btrim(done_text)) BETWEEN 10 AND 5000
          AND (nothing_pending OR char_length(btrim(pending_text)) BETWEEN 10 AND 5000))`,
  });
  pgm.createIndex('report', ['author_id', 'created_at']);
  pgm.createIndex('report', 'shift_id');

  pgm.createTable('report_task', {
    report_id: { type: 'uuid', notNull: true, primaryKey: true, ...fk('report') },
    task_id: { type: 'uuid', notNull: true, primaryKey: true, ...fk('task') },
  });

  pgm.createTable('report_share', {
    report_id: { type: 'uuid', notNull: true, ...fk('report') },
    user_id: { type: 'uuid', notNull: true, ...fk('app_user') },
    shared_by: { type: 'uuid', notNull: true, ...fk('app_user') },
    shared_at: { type: 'timestamptz', notNull: true, default: { literal: true, value: 'now()' } },
    read_at: { type: 'timestamptz' },
  });
  pgm.addConstraint('report_share', 'report_share_once', { unique: ['report_id', 'user_id'] });
  pgm.createIndex('report_share', ['user_id', 'shared_at']);

  pgm.addColumn('notification', { report_id: { type: 'uuid', ...fk('report') } });

  pgm.sql(`
    CREATE FUNCTION report_guard() RETURNS trigger AS $$
    BEGIN
      IF OLD.status = 'submitted' THEN
        RAISE EXCEPTION 'report % is submitted and cannot be %', OLD.report_id,
          CASE WHEN TG_OP = 'DELETE' THEN 'deleted' ELSE 'changed' END
          USING ERRCODE = 'P0001', HINT = 'record_locked';
      END IF;
      IF TG_OP = 'DELETE' THEN
        RETURN OLD;
      END IF;
      IF NEW.report_id  IS DISTINCT FROM OLD.report_id
      OR NEW.author_id  IS DISTINCT FROM OLD.author_id
      OR NEW.shift_id   IS DISTINCT FROM OLD.shift_id
      OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'report %: author, shift and creation time cannot change', OLD.report_id
          USING ERRCODE = 'P0001', HINT = 'record_locked';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER trg_report_guard
      BEFORE UPDATE OR DELETE ON report
      FOR EACH ROW EXECUTE FUNCTION report_guard();

    CREATE FUNCTION report_task_guard() RETURNS trigger AS $$
    DECLARE
      parent_status report_status_enum;
      rid uuid;
    BEGIN
      IF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION 'report_task rows cannot be updated'
          USING ERRCODE = 'P0001', HINT = 'append_only';
      END IF;
      rid := CASE WHEN TG_OP = 'DELETE' THEN OLD.report_id ELSE NEW.report_id END;
      SELECT status INTO parent_status FROM report WHERE report_id = rid;
      IF parent_status = 'submitted' THEN
        RAISE EXCEPTION '% on report_task rejected: report % is submitted', TG_OP, rid
          USING ERRCODE = 'P0001', HINT = 'record_locked';
      END IF;
      RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER trg_report_task_guard
      BEFORE INSERT OR UPDATE OR DELETE ON report_task
      FOR EACH ROW EXECUTE FUNCTION report_task_guard();

    CREATE FUNCTION report_share_guard() RETURNS trigger AS $$
    BEGIN
      IF TG_OP = 'INSERT' THEN
        IF (SELECT status FROM report WHERE report_id = NEW.report_id) IS DISTINCT FROM 'submitted' THEN
          RAISE EXCEPTION 'report % is not submitted and cannot be shared', NEW.report_id
            USING ERRCODE = 'P0001', HINT = 'not_submitted';
        END IF;
        RETURN NEW;
      END IF;
      IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'report_share is append-only (DELETE rejected)'
          USING ERRCODE = 'P0001', HINT = 'append_only';
      END IF;
      IF NEW.report_id IS DISTINCT FROM OLD.report_id
      OR NEW.user_id   IS DISTINCT FROM OLD.user_id
      OR NEW.shared_by IS DISTINCT FROM OLD.shared_by
      OR NEW.shared_at IS DISTINCT FROM OLD.shared_at
      OR (OLD.read_at IS NOT NULL AND NEW.read_at IS DISTINCT FROM OLD.read_at) THEN
        RAISE EXCEPTION 'report_share is append-only; only read_at can be set, once'
          USING ERRCODE = 'P0001', HINT = 'append_only';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER trg_report_share_guard
      BEFORE INSERT OR UPDATE OR DELETE ON report_share
      FOR EACH ROW EXECUTE FUNCTION report_share_guard();
  `);
};

exports.down = (pgm) => {
  pgm.sql('DROP TRIGGER IF EXISTS trg_report_share_guard ON report_share');
  pgm.sql('DROP TRIGGER IF EXISTS trg_report_task_guard ON report_task');
  pgm.sql('DROP TRIGGER IF EXISTS trg_report_guard ON report');
  pgm.sql('DROP FUNCTION IF EXISTS report_share_guard()');
  pgm.sql('DROP FUNCTION IF EXISTS report_task_guard()');
  pgm.sql('DROP FUNCTION IF EXISTS report_guard()');
  pgm.dropColumn('notification', 'report_id');
  pgm.dropTable('report_share');
  pgm.dropTable('report_task');
  pgm.dropTable('report');
  pgm.dropType('report_status_enum');
};
