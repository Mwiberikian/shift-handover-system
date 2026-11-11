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

module.exports = { supervisorControlsEnabled, autoApprovalEnabled };
