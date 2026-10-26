// Synthetic evaluation data for the handover assistant (Part S). Everything
// here is invented (DR-11): fixed seed, no real staff, flights or events.
//
// Limits to state in the report: the labels come from this generator, which
// the author wrote, so a good score shows the code does what the generator
// defines, not that real handovers look like this. The severity test uses
// phrasing families the model never saw in training, to avoid scoring it only
// on wording it memorised.

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];

// ---------------------------------------------------------------- severity
const OBJECTS = ['the hydraulic line on stand 4', 'the baggage belt at gate 3', 'the fuel bowser', 'the jet bridge at gate 2', 'the cabin door seal', 'the tow tractor', 'stand 5 lighting', 'the catering truck', 'the crew bus', 'the main gear tyre', 'the cargo loader', 'the passenger stairs'];
// Each severity has cue families; train and test use different families that
// share only some cue words.
const SEVERITY_FAMILIES = {
  critical: {
    train: ['Fire reported near {o}, area evacuated', 'Injury to a staff member at {o}, ambulance called', 'Fuel spill at {o}, emergency response started', 'Collision involving {o}, aircraft struck'],
    test: ['Smoke seen coming from {o}, evacuation ordered', 'Staff member hurt at {o}, medical emergency', 'Large fuel leak around {o}, emergency services called', 'Vehicle hit the aircraft near {o}'],
  },
  high: {
    train: ['{o} unserviceable, aircraft grounded until repaired', 'Safety concern with {o}, operation stopped', 'Damage found on {o}, engineering called, departure delayed over two hours', 'Missed procedure at {o}, safety report raised'],
    test: ['{o} failed, flight cannot depart until fixed', 'Hazard around {o}, work halted pending engineer', 'Serious damage to {o}, aircraft not released', 'Safety check skipped at {o}, report to be filed'],
  },
  medium: {
    train: ['{o} faulty, slow operation, workaround in place', 'Intermittent problem with {o}, reduced capacity', 'Delay of about thirty minutes because of {o}', 'Fault noticed on {o}, engineering informed, monitoring'],
    test: ['{o} not working properly, using backup', 'Occasional glitch on {o}, still usable', 'Late turnaround caused by {o}, short delay', 'Defect on {o}, logged for maintenance, keep watching'],
  },
  low: {
    train: ['Minor scuff on {o}, cosmetic only', 'Small cosmetic mark on {o}, noted', 'Spare part for {o} ordered, no effect on operation', 'Routine reminder about {o}, nothing urgent'],
    test: ['Slight paint chip on {o}, no impact', 'Tiny dent on {o}, purely cosmetic', 'Replacement for {o} requested, normal operation continues', 'FYI about {o}, no action needed now'],
  },
};
const NOISE = ['Reported by ground staff.', 'Time approx mid shift.', 'Supervisor informed.', 'Photos not taken.', 'Weather dry.'];

function severityCorpus(seed = 11, perClass = 60) {
  const r = rng(seed);
  const make = (which, n) => {
    const out = [];
    Object.keys(SEVERITY_FAMILIES).forEach((sev) => {
      for (let i = 0; i < n; i += 1) {
        const tpl = pick(r, SEVERITY_FAMILIES[sev][which]);
        const text = `${tpl.replace('{o}', pick(r, OBJECTS))}. ${r() < 0.5 ? pick(r, NOISE) : ''}`.trim();
        out.push({ text, severity: sev });
      }
    });
    return out;
  };
  return { train: make('train', perClass), seen: make('train', Math.round(perClass / 3)), unseen: make('test', Math.round(perClass / 2)) };
}

// ------------------------------------------------------------ issue families
const FAMILIES = [
  { id: 'hyd', texts: ['Hydraulic leak on stand 4 aircraft, seal replacement needed', 'hyd leaking at stand 4, inspect line and seals', 'Leaking hydraulic fluid under A/C at stand 4', 'Hydraulics leak noticed near stand 4, engineer to check'], queries: ['hyd leak', 'hydraulic fluid leaking'] },
  { id: 'gpu', texts: ['GPU on stand 5 unserviceable, awaiting repair', 'Ground power unit at stand 5 not working', 'Stand 5 GPU faulty, use spare unit', 'GPU failure at stand 5, engineering informed'], queries: ['gpu fault', 'stand 5 power unit faulty'] },
  { id: 'belt', texts: ['Baggage belt jammed at gate 3, bags loaded by hand', 'Gate 3 baggage belt stopped again, technician called', 'Luggage belt at gate 3 jam, manual loading used', 'Belt 3 baggage conveyor fault, passengers bags delayed'], queries: ['baggage belt jam', 'luggage conveyor fault gate 3'] },
  { id: 'fuel', texts: ['Fuel bowser late to stand 2, departure delayed', 'Refuelling delayed at stand 2, bowser not available', 'Bowser for refueling arrived late at stand 2', 'Fueling delay stand 2 because the bowser was late'], queries: ['refuelling delay', 'bowser late'] },
  { id: 'light', texts: ['Stand 7 floodlights out, poor visibility at night', 'Lighting failed at stand 7, torches used', 'Stand 7 lights not working after dark', 'Floodlight fault on stand 7, electrician informed'], queries: ['stand lights out', 'floodlight fault'] },
  { id: 'door', texts: ['Cabin door seal damaged on aircraft at stand 1', 'Damaged door seal found on A/C at stand 1, engineer called', 'Aircraft cabin door rubber seal torn at stand 1', 'Door seal defect stand 1 aircraft, maintenance informed'], queries: ['door seal damage', 'torn cabin door seal'] },
  { id: 'tow', texts: ['Tow tractor battery low, replacement requested', 'Tractor for towing has a flat battery, needs charging', 'Tow tractor would not start, battery flat', 'Battery problem on tow tractor, spare requested'], queries: ['tractor battery', 'tow tractor flat battery'] },
  { id: 'bridge', texts: ['Jet bridge at gate 2 stuck, stairs used for boarding', 'Gate 2 jetbridge failed to extend, passenger stairs used', 'Jet bridge 2 would not move, boarding by stairs', 'Boarding bridge at gate 2 stuck, engineer called'], queries: ['jet bridge stuck', 'gate 2 bridge failed'] },
  { id: 'cater', texts: ['Catering truck late to gate 6, galley loaded late', 'Late catering for gate 6 flight, truck delayed', 'Catering arrived late at gate 6, delay to boarding', 'Gate 6 galley supplies late, catering truck delayed'], queries: ['catering late', 'late galley supplies'] },
  { id: 'tyre', texts: ['Main gear tyre pressure low on aircraft at stand 3', 'Low tire pressure on main landing gear stand 3', 'Stand 3 aircraft left tyre pressure below limit, topped up', 'Main wheel tire pressure low, engineer topped up at stand 3'], queries: ['low tyre pressure', 'main gear tire'] },
];
const LONE = ['Crew bus air conditioning broken, temporary vehicle used', 'Cargo shed padlock replaced after key lost', 'Printer in operations office out of toner', 'Visitor passes expired for two contractors', 'Staff canteen closed for cleaning during break', 'Uniform delivery scheduled for next week', 'Radio charger for ramp team missing one dock'];

// A department history: n records, each with 1 to 3 items; some families recur.
function history(seed = 21, n = 30) {
  const r = rng(seed);
  const recurring = FAMILIES.slice(0, 6); // seen repeatedly
  const rare = FAMILIES.slice(6); // seen at most once in the history
  const usedRare = new Set();
  const records = [];
  for (let i = 0; i < n; i += 1) {
    const items = [];
    const k = 1 + Math.floor(r() * 2);
    for (let j = 0; j < k; j += 1) {
      if (r() < 0.65) {
        const f = pick(r, recurring); items.push({ family: f.id, text: pick(r, f.texts) });
      } else if (r() < 0.5) {
        const f = pick(r, rare); if (!usedRare.has(f.id)) { usedRare.add(f.id); items.push({ family: f.id, text: pick(r, f.texts) }); } else items.push({ family: null, text: pick(r, LONE) });
      } else items.push({ family: null, text: pick(r, LONE) });
    }
    records.push({ record_id: `r${i}`, shift_start: new Date(Date.UTC(2031, 0, 1 + i)).toISOString(), items });
  }
  return records;
}

// New handover drafts: items from recurring families (truth: seen before),
// from rare families never in the history (truth: new) and lone items (new).
function drafts(seed = 31, hist, count = 80) {
  const r = rng(seed);
  const seenFamilies = new Map();
  hist.forEach((rec) => rec.items.forEach((it) => { if (it.family) seenFamilies.set(it.family, (seenFamilies.get(it.family) || 0) + 1); }));
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const f = pick(r, FAMILIES);
    const text = pick(r, f.texts);
    // The history phrasing may differ: new draft uses a different paraphrase.
    out.push({ id: `d${i}`, text, family: f.id, truth_recurring: (seenFamilies.get(f.id) || 0) >= 1 });
    if (r() < 0.2) { const lt = pick(r, LONE); out.push({ id: `l${i}`, text: lt, family: null, truth_recurring: hist.some((rec) => rec.items.some((it) => it.text === lt)) }); }
  }
  return out;
}

// ------------------------------------------------------------------ quality
const INCIDENTS = [
  { title: 'Hydraulic leak on stand 4', severity: 'high', followup: 'Replace hydraulic seal on stand 4 aircraft', summaryMention: 'Hydraulic leak found at stand 4 and logged' },
  { title: 'Fuel spill at stand 2', severity: 'critical', followup: 'Clean fuel spill at stand 2 and inspect bowser hose', summaryMention: 'Fuel spill at stand 2 contained' },
  { title: 'Baggage belt fire alarm at gate 3', severity: 'critical', followup: 'Inspect baggage belt motor at gate 3 for fire damage', summaryMention: 'Baggage belt alarm at gate 3 handled by fire team' },
  { title: 'Jet bridge failure at gate 2', severity: 'high', followup: 'Engineer to repair jet bridge at gate 2', summaryMention: 'Jet bridge failure at gate 2 handled with stairs' },
  { title: 'Minor scuff on tow tractor', severity: 'low', followup: 'Report scuff on tow tractor to garage', summaryMention: 'Minor tow tractor scuff noted' },
];
const FILL_TASKS = ['Confirm gate 6 catering schedule with the caterer', 'Collect spare radio batteries from stores before shift change', 'Brief incoming team on the new stand allocation', 'Check stock of passenger stairs lubricant in the workshop'];
const GOOD_SUMMARY = ['Normal shift overall, all departures handled, see the incident and tasks below for follow-up.', 'Busy turnaround period, no delays beyond those listed, incoming shift please read the open tasks.'];
const FILLER_SUMMARY = ['All ok', 'Nothing to report', 'As usual', 'n/a'];

// planted: codes the generator put in on purpose.
function qualityCases(seed = 41, count = 200) {
  const r = rng(seed);
  const cases = [];
  for (let i = 0; i < count; i += 1) {
    const inc = pick(r, INCIDENTS);
    const serious = inc.severity === 'high' || inc.severity === 'critical';
    const planted = new Set();
    let summary = `${pick(r, GOOD_SUMMARY)} ${inc.summaryMention}.`;
    const tasks = [{ description: inc.followup, priority: inc.severity === 'critical' ? 'high' : 'medium', status: 'open' }, { description: pick(r, FILL_TASKS), priority: 'low', status: 'open' }];
    const incidents = [{ title: inc.title, description: '', severity: inc.severity }];
    const mode = Math.floor(r() * 7);
    if (mode === 1 && serious) { tasks.splice(0, 1); tasks.unshift({ description: pick(r, FILL_TASKS.filter((t) => t !== tasks[0].description)), priority: 'high', status: 'open' }); planted.add('incident_no_action'); }
    if (mode === 2 && serious) { summary = `${pick(r, GOOD_SUMMARY)}`; planted.add('summary_omits_incident'); }
    if (mode === 3) { summary = pick(r, FILLER_SUMMARY); planted.add('summary_contradicts_incidents'); }
    if (mode === 4) { tasks.push({ description: 'check gpu', priority: 'low', status: 'open' }); planted.add('task_vague'); }
    if (mode === 5) { tasks.push({ ...tasks[1] }); planted.add('duplicate_task'); }
    if (mode === 6) { summary = 'Quiet shift.'; planted.add('summary_short'); }
    if (mode === 3 && serious) { /* filler also omits the incident */ planted.add('summary_omits_incident'); }
    if (mode === 6 && serious) planted.add('summary_omits_incident');
    cases.push({ summary, tasks, incidents, planted: [...planted], expectCriticalNoHigh: false });
  }
  return cases;
}

// One author's last 10 handovers of one shift type: two habitual tasks
// (GPU check in 6 of them, belt check in 4) among occasional others.
function ownHistory(seed = 51) {
  const r = rng(seed);
  const gpu = FAMILIES.find((f) => f.id === 'gpu'); const belt = FAMILIES.find((f) => f.id === 'belt');
  const others = FAMILIES.filter((f) => f.id !== 'gpu' && f.id !== 'belt');
  const count = {};
  return Array.from({ length: 10 }, (_, i) => {
    const items = [];
    if (i % 5 !== 4) items.push({ family: 'gpu', text: pick(r, gpu.texts) });
    if (i % 5 < 2 && items.length < 3) items.push({ family: 'belt', text: pick(r, belt.texts) });
    const f = pick(r, others);
    if ((count[f.id] || 0) < 2) { count[f.id] = (count[f.id] || 0) + 1; items.push({ family: f.id, text: pick(r, f.texts) }); }
    return { record_id: `o${i}`, shift_start: new Date(Date.UTC(2031, 0, 1 + i)).toISOString(), items };
  });
}

module.exports = {
  ownHistory, rng, severityCorpus, FAMILIES, history, drafts, qualityCases,
};
