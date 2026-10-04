import controlTower from '../../assets/images/bg/control-tower.webp';
import departureBoard from '../../assets/images/bg/departure-board.webp';
import runwayDusk from '../../assets/images/bg/runway-dusk.webp';
import terminal from '../../assets/images/bg/terminal.webp';
import aircraftGate from '../../assets/images/bg/aircraft-gate.webp';

// Background photo per section, for the supervisor and admin layouts only
// (outgoing and incoming screens stay plain). Longest matching prefix wins.
const PHOTOS = {
  supervisor: [
    ['/supervisor/queue', departureBoard],
    ['/supervisor/escalated', runwayDusk],
    ['/supervisor/search', terminal],
    ['/supervisor/roster', aircraftGate],
    ['/messages', terminal],
    ['/supervisor', controlTower],
  ],
  admin: [
    ['/admin/requests', departureBoard],
    ['/admin/templates', controlTower],
    ['/messages', terminal],
    ['/admin', aircraftGate],
  ],
};

export function pagePhotoFor(role, pathname) {
  const list = PHOTOS[role];
  if (!list) return null;
  const hit = list
    .filter(([prefix]) => pathname === prefix || pathname.startsWith(`${prefix}/`))
    .sort((a, b) => b[0].length - a[0].length)[0];
  return hit ? hit[1] : null;
}
