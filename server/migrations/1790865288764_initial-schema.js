/**
 * Initial schema for the Shift Handover Management System (SHMS).
 *
 * Integrity rules enforced here (not just in the API):
 *  - Every foreign key is ON DELETE RESTRICT. Nothing cascades, so audit history
 *    can never be lost as a side effect of deleting a parent row.
 *  - Only one non-closed handover_record per (department_id, shift_id).
 *  - A handover_record that has left 'draft' is immutable: its content columns
 *    cannot change, it cannot be deleted, and its tasks/incidents are frozen.
 *    Only legal status transitions are allowed (see trg_handover_record_guard).
 *  - audit_log is append-only (no UPDATE / DELETE).
 *  - handover_template rows are versioned and never updated or deleted; a
 *    change inserts a new version.
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.shorthands = undefined;

const fk = (table) => ({ references: table, onDelete: 'RESTRICT' });
const uuidPk = { type: 'uuid', primaryKey: true, default: { literal: true, value: 'gen_random_uuid()' } };
const now = { type: 'timestamptz', default: { literal: true, value: 'now()' } };

exports.up = (pgm) => {
  pgm.createExtension('pgcrypto', { ifNotExists: true });

  pgm.createType('role_enum', ['outgoing_staff', 'incoming_staff', 'supervisor', 'admin']);
  pgm.createType('record_status_enum', [
    'draft', 'submitted', 'queried', 'acknowledged', 'under_review', 'escalated', 'closed',
  ]);
  pgm.createType('task_status_enum', ['open', 'in_progress', 'resolved']);
  pgm.createType('priority_enum', ['low', 'medium', 'high']);
  pgm.createType('severity_enum', ['low', 'medium', 'high', 'critical']);
  pgm.createType('decision_enum', ['approved', 'escalated']);

  // handover_template is created before department because department.template_id
  // points at the department's *current* template version.
  pgm.createTable('handover_template', {
    template_id: uuidPk,
    department_code: { type: 'varchar(10)' },
    field_definition: { type: 'jsonb', notNull: true },
    version: { type: 'integer', notNull: true, default: 1 },
  });
  pgm.addConstraint('handover_template', 'handover_template_dept_version_unique', {
    unique: ['department_code', 'version'],
  });

  pgm.createTable('department', {
    department_id: uuidPk,
    name: { type: 'varchar(80)', notNull: true },
    code: { type: 'varchar(10)', notNull: true, unique: true },
    template_id: { type: 'uuid', ...fk('handover_template') },
  });

  pgm.createTable('app_user', {
    user_id: uuidPk,
    staff_number: { type: 'varchar(20)', notNull: true, unique: true },
    full_name: { type: 'varchar(120)', notNull: true },
    email: { type: 'varchar(160)', notNull: true, unique: true },
    password_hash: { type: 'varchar(255)', notNull: true },
    role: { type: 'role_enum', notNull: true },
    department_id: { type: 'uuid', ...fk('department') },
    is_active: { type: 'boolean', default: true },
  });

  pgm.createTable('shift', {
    shift_id: uuidPk,
    department_id: { type: 'uuid', notNull: true, ...fk('department') },
    shift_type: { type: 'varchar(20)', notNull: true },
    start_time: { type: 'timestamptz', notNull: true },
    end_time: { type: 'timestamptz', notNull: true },
  });
  pgm.addConstraint('shift', 'shift_time_order_check', { check: 'end_time > start_time' });

  pgm.createTable('handover_record', {
    record_id: uuidPk,
    shift_id: { type: 'uuid', notNull: true, ...fk('shift') },
    department_id: { type: 'uuid', notNull: true, ...fk('department') },
    outgoing_user_id: { type: 'uuid', ...fk('app_user') },
    incoming_user_id: { type: 'uuid', ...fk('app_user') },
    status: { type: 'record_status_enum', notNull: true, default: 'draft' },
    summary_notes: { type: 'text' },
    submitted_at: { type: 'timestamptz' },
    closed_at: { type: 'timestamptz' },
    created_at: now,
  });
  // Only one non-closed record per department/shift.
  pgm.createIndex('handover_record', ['department_id', 'shift_id'], {
    name: 'handover_record_one_open_per_shift',
    unique: true,
    where: "status <> 'closed'",
  });

  pgm.createTable('task', {
    task_id: uuidPk,
    record_id: { type: 'uuid', notNull: true, ...fk('handover_record') },
    description: { type: 'text', notNull: true },
    status: { type: 'task_status_enum', notNull: true, default: 'open' },
    priority: { type: 'priority_enum', notNull: true, default: 'medium' },
    carried_from_task_id: { type: 'uuid', ...fk('task') },
    created_at: now,
  });

  pgm.createTable('incident', {
    incident_id: uuidPk,
    record_id: { type: 'uuid', notNull: true, ...fk('handover_record') },
    title: { type: 'varchar(160)', notNull: true },
    description: { type: 'text' },
    severity: { type: 'severity_enum', notNull: true },
    occurred_at: { type: 'timestamptz', notNull: true },
    reported_by: { type: 'uuid', ...fk('app_user') },
  });

  pgm.createTable('acknowledgement', {
    ack_id: uuidPk,
    record_id: { type: 'uuid', notNull: true, unique: true, ...fk('handover_record') },
    incoming_user_id: { type: 'uuid', notNull: true, ...fk('app_user') },
    confirmed_at: { type: 'timestamptz' },
    query_raised: { type: 'boolean', default: false },
    comments: { type: 'text' },
  });

  pgm.createTable('supervisor_review', {
    review_id: uuidPk,
    record_id: { type: 'uuid', notNull: true, ...fk('handover_record') },
    supervisor_id: { type: 'uuid', notNull: true, ...fk('app_user') },
    decision: { type: 'decision_enum', notNull: true },
    comments: { type: 'text' },
    reviewed_at: now,
  });

  pgm.createTable('notification', {
    notification_id: uuidPk,
    recipient_id: { type: 'uuid', notNull: true, ...fk('app_user') },
    record_id: { type: 'uuid', ...fk('handover_record') },
    type: { type: 'varchar(40)', notNull: true },
    sent_at: now,
    read_at: { type: 'timestamptz' },
  });

  pgm.createTable('audit_log', {
    log_id: { type: 'bigserial', primaryKey: true },
    user_id: { type: 'uuid', ...fk('app_user') },
    entity_type: { type: 'varchar(40)', notNull: true },
    entity_id: { type: 'uuid', notNull: true },
    action: { type: 'varchar(40)', notNull: true },
    previous_value: { type: 'jsonb' },
    new_value: { type: 'jsonb' },
    logged_at: now,
  });

  // Supporting indexes for common lookups.
  pgm.createIndex('handover_record', ['department_id', 'status']);
  pgm.createIndex('task', 'record_id');
  pgm.createIndex('task', 'carried_from_task_id');
  pgm.createIndex('incident', 'record_id');
  pgm.createIndex('notification', ['recipient_id', 'read_at']);
  pgm.createIndex('audit_log', ['entity_type', 'entity_id']);
  pgm.createIndex('shift', ['department_id', 'start_time']);

  // ---------------------------------------------------------------------------
  // Integrity triggers (defence in depth: the service layer checks these too).
  // ---------------------------------------------------------------------------

  // 1. handover_record: immutable once submitted, legal transitions only.
  pgm.sql(`
    CREATE FUNCTION handover_record_guard() RETURNS trigger AS $$
    BEGIN
      IF TG_OP = 'DELETE' THEN
        IF OLD.status <> 'draft' THEN
          RAISE EXCEPTION 'handover_record % is % and cannot be deleted', OLD.record_id, OLD.status
            USING ERRCODE = 'P0001', HINT = 'record_locked';
        END IF;
        RETURN OLD;
      END IF;

      IF OLD.status <> 'draft' AND (
           NEW.record_id        IS DISTINCT FROM OLD.record_id
        OR NEW.shift_id         IS DISTINCT FROM OLD.shift_id
        OR NEW.department_id    IS DISTINCT FROM OLD.department_id
        OR NEW.outgoing_user_id IS DISTINCT FROM OLD.outgoing_user_id
        OR NEW.incoming_user_id IS DISTINCT FROM OLD.incoming_user_id
        OR NEW.summary_notes    IS DISTINCT FROM OLD.summary_notes
        OR NEW.submitted_at     IS DISTINCT FROM OLD.submitted_at
        OR NEW.created_at       IS DISTINCT FROM OLD.created_at
      ) THEN
        RAISE EXCEPTION 'handover_record % is % and its content is locked', OLD.record_id, OLD.status
          USING ERRCODE = 'P0001', HINT = 'record_locked';
      END IF;

      IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
           (OLD.status = 'draft'        AND NEW.status = 'submitted')
        OR (OLD.status = 'submitted'    AND NEW.status IN ('acknowledged', 'queried'))
        OR (OLD.status = 'queried'      AND NEW.status = 'submitted')
        OR (OLD.status = 'acknowledged' AND NEW.status IN ('under_review', 'closed', 'escalated'))
        OR (OLD.status = 'under_review' AND NEW.status IN ('closed', 'escalated'))
        OR (OLD.status = 'escalated'    AND NEW.status = 'closed')
      ) THEN
        RAISE EXCEPTION 'illegal status transition % -> % for handover_record %',
          OLD.status, NEW.status, OLD.record_id
          USING ERRCODE = 'P0001', HINT = 'illegal_transition';
      END IF;

      IF OLD.status = 'closed' AND NEW IS DISTINCT FROM OLD THEN
        RAISE EXCEPTION 'handover_record % is closed', OLD.record_id
          USING ERRCODE = 'P0001', HINT = 'record_locked';
      END IF;

      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER trg_handover_record_guard
      BEFORE UPDATE OR DELETE ON handover_record
      FOR EACH ROW EXECUTE FUNCTION handover_record_guard();
  `);

  // 2. task / incident: children of a non-draft record are frozen.
  pgm.sql(`
    CREATE FUNCTION handover_child_guard() RETURNS trigger AS $$
    DECLARE
      parent_status record_status_enum;
      rid uuid;
    BEGIN
      rid := CASE WHEN TG_OP = 'DELETE' THEN OLD.record_id ELSE NEW.record_id END;
      SELECT status INTO parent_status FROM handover_record WHERE record_id = rid;
      IF parent_status IS DISTINCT FROM 'draft' THEN
        RAISE EXCEPTION '% on % rejected: handover_record % is %', TG_OP, TG_TABLE_NAME, rid, parent_status
          USING ERRCODE = 'P0001', HINT = 'record_locked';
      END IF;
      IF TG_OP = 'UPDATE' AND NEW.record_id IS DISTINCT FROM OLD.record_id THEN
        RAISE EXCEPTION '% cannot be moved to another record', TG_TABLE_NAME
          USING ERRCODE = 'P0001', HINT = 'record_locked';
      END IF;
      RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER trg_task_guard
      BEFORE INSERT OR UPDATE OR DELETE ON task
      FOR EACH ROW EXECUTE FUNCTION handover_child_guard();
    CREATE TRIGGER trg_incident_guard
      BEFORE INSERT OR UPDATE OR DELETE ON incident
      FOR EACH ROW EXECUTE FUNCTION handover_child_guard();
  `);

  // 3. audit_log and handover_template are append-only.
  pgm.sql(`
    CREATE FUNCTION append_only_guard() RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION '% is append-only (% rejected)', TG_TABLE_NAME, TG_OP
        USING ERRCODE = 'P0001', HINT = 'append_only';
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER trg_audit_log_append_only
      BEFORE UPDATE OR DELETE ON audit_log
      FOR EACH ROW EXECUTE FUNCTION append_only_guard();
    CREATE TRIGGER trg_handover_template_append_only
      BEFORE UPDATE OR DELETE ON handover_template
      FOR EACH ROW EXECUTE FUNCTION append_only_guard();
  `);
};

exports.down = (pgm) => {
  pgm.sql('DROP TRIGGER IF EXISTS trg_handover_template_append_only ON handover_template');
  pgm.sql('DROP TRIGGER IF EXISTS trg_audit_log_append_only ON audit_log');
  pgm.sql('DROP TRIGGER IF EXISTS trg_incident_guard ON incident');
  pgm.sql('DROP TRIGGER IF EXISTS trg_task_guard ON task');
  pgm.sql('DROP TRIGGER IF EXISTS trg_handover_record_guard ON handover_record');
  pgm.sql('DROP FUNCTION IF EXISTS append_only_guard()');
  pgm.sql('DROP FUNCTION IF EXISTS handover_child_guard()');
  pgm.sql('DROP FUNCTION IF EXISTS handover_record_guard()');

  [
    'audit_log', 'notification', 'supervisor_review', 'acknowledgement', 'incident',
    'task', 'handover_record', 'shift', 'app_user', 'department', 'handover_template',
  ].forEach((t) => pgm.dropTable(t));

  ['decision_enum', 'severity_enum', 'priority_enum', 'task_status_enum',
    'record_status_enum', 'role_enum'].forEach((t) => pgm.dropType(t));
};
