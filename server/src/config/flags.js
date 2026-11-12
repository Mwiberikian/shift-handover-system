// Feature flags read from the environment at request time, so flipping one on
// the host (e.g. Render) takes effect without a redeploy of code.

// Phase 1 supervisor controls and roster visibility. Default on; set
// SUPERVISOR_CONTROLS_ENABLED=false to make every Phase 1 route answer 404
// and the client hide its buttons and cards.
const supervisorControlsEnabled = () => process.env.SUPERVISOR_CONTROLS_ENABLED !== 'false';

// Phase 2 automatic release of handover reports. Default on; set
// AUTO_APPROVAL_ENABLED=false to treat every submitted report as HELD (the
// safe behaviour — nothing is ever auto-released while it is off). A
// supervisor can always approve a held report, flag on or off.
const autoApprovalEnabled = () => process.env.AUTO_APPROVAL_ENABLED !== 'false';

// Phase 3 roster-derived duty. Default OFF: everything behaves exactly as
// before until ROSTER_DUTY_ENABLED=true is set on the host. When on, who may
// author and who may acknowledge a handover follows the shift roster (the
// staff assigned to a shift are its outgoing people; the staff assigned to
// the department's next shift are its incoming people), and a shift with no
// roster falls back to the fixed-role rules exactly.
const rosterDutyEnabled = () => process.env.ROSTER_DUTY_ENABLED === 'true';

module.exports = { supervisorControlsEnabled, autoApprovalEnabled, rosterDutyEnabled };
