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

// ---------------------------------------------------------- release / holds
// Phase 2 hazard set. The TRUE label (needs hold / safe to release) comes
// from these lists, written as an operations vocabulary independent of the
// HOLD keyword rules in ../constants.js — including paraphrases and reworded
// events that a keyword matcher may miss (that is the point of the test).
// A hazard event is one a supervisor must see before the report is stamped
// "checks passed"; a safe event is routine shift traffic.

// Events that genuinely need a hold. `sev` is the severity used when the
// event is recorded as an incident (null: appears only as text).
const HAZARD_EVENTS = [
  // injuries and medical events, varied phrasing
  'A loader injured his hand between the cart and the belt',
  'Staff member hurt while opening the cargo door, taken for treatment',
  'Ramp agent cut badly on a broken pallet edge, bleeding controlled',
  'One of the cleaners fainted in the cabin and needed an ambulance',
  'A staff member twisted an ankle on the stairs at gate 4',
  'Marshaller struck on the shoulder by a swinging hold door',
  'Technician burned his forearm on the APU exhaust',
  // fire, smoke, explosion
  'Smoke was seen coming from the belt loader engine bay',
  'Small fire in a waste bin by the crew room, put out with an extinguisher',
  'Smell of burning from the GPU cable drum at stand 6',
  'Sparks observed from the floodlight junction box',
  'The toaster in the crew room caught fire briefly during the night',
  // spills, leaks, substances
  'Fuel spill under the bowser at stand 2, area closed off',
  'Hydraulic fluid leaking from the tug steering ram',
  'Strong smell of kerosene around the parked aircraft',
  'De-icing fluid spilt across the walkway by the equipment store',
  'A drum of degreaser tipped over in the cargo shed',
  'Unknown chemical odour in the baggage hall, area ventilated',
  // ground events / near misses
  'Baggage cart clipped the wingtip of the parked aircraft',
  'Catering truck reversed into the jet bridge support leg',
  'Tow tractor collided with a stand light pole',
  'Near miss between the fuel bowser and a pushback in progress',
  'A container fell from the loader during offload, nobody underneath',
  'FOD found on the taxiway shoulder near stand 3',
  'Loose metal debris collected from the apron before departure',
  'Pushback stopped because a van crossed the stand without clearance',
  // electrical
  'Ground staff member got an electric shock from the 400Hz connector',
  'Exposed wiring found on the passenger stairs handrail light',
  'GPU cable insulation worn through to the conductor',
  // general unsafe conditions and safety wording
  'Unsafe stacking of containers noticed in the cargo shed',
  'Gate area evacuated for twenty minutes after a suspicious bag report',
  'Emergency stop used on the baggage belt after a jacket was drawn in',
  'Floor by the fuel hydrant pit is slippery and has no cone around it',
  'Handrail on the maintenance platform is loose and gives way when leaned on',
  'Safety barrier around the open pit was found knocked over',
  'High wind warning ignored and the stairs were left unsecured against the fuselage',
];
// Hazards whose wording is deliberately bland: only the recorded incident
// severity says how serious they were (tests hold rule (a) on its own).
const BLAND_SERIOUS = [
  'Problem with the aircraft at stand 1 during turnaround',
  'Event involving the fuel bowser this morning, details with the duty manager',
  'Issue at gate 5 during boarding, report form completed',
  'Occurrence on the apron overnight, engineering attended',
];
// Routine events that are safe to release.
const SAFE_EVENTS = [
  'Catering truck arrived late to gate 6, boarding delayed ten minutes',
  'Printer in the operations office is out of toner again',
  'Two wheelchairs requested for the afternoon arrival',
  'Stand allocation changed twice because of the late inbound',
  'Crew bus air conditioning still weak, garage booked for Tuesday',
  'Spare radio batteries collected from stores',
  'Gate 2 display showing the wrong flight number, IT informed',
  'Lost property handed in: one grey suitcase from the forward hold',
  'New roster published for next week, team briefed',
  'Baggage figures for the shift entered into the daily log',
  'Visitor passes for the auditors arranged for tomorrow',
  'Cleaning of the crew room moved to the quiet period after midnight',
  'Toilets at gate 4 out of order, passengers directed to gate 5',
  'Extra trolleys positioned at arrivals for the delayed wide-body',
  'Uniform order forms distributed to the team',
  'Coffee machine descaled and back in service',
  'Stationery order placed for the operations desk',
  'Both inbound flights on time, turnarounds completed as planned',
];
// Safe to release, but worded so a conservative matcher will likely hold them
// (negations and benign uses of safety vocabulary). Their TRUE label is safe:
// each false hold here is the accepted price of never missing a real hazard.
const SAFE_TRICKY = [
  'Quiet shift, no injuries and no incidents to report',
  'All safety checks completed on schedule, nothing found',
  'Routine fire alarm test carried out at 10:00 as planned',
  'No spills during refuelling, bowser log signed off',
  'Monthly evacuation drill scheduled for next Thursday',
  'Firefighting equipment inspection passed, tags renewed',
];

const SEV_MIX = ['low', 'low', 'low', 'medium', 'medium', 'medium', 'medium', 'high', 'high', 'critical'];
const ROUTINE_SUMMARY = ['Steady shift, all departures away on time.', 'Normal operations through the night, see tasks for follow-ups.', 'Busy afternoon but nothing outstanding beyond the items below.'];
const ROUTINE_TASKS = ['Confirm the catering schedule for the first wave', 'Return the spare headsets to stores', 'Brief the incoming team on the stand changes'];

// At least 200 cases: { summary, tasks, incidents, truth_hold, event }.
// The event text lands in the summary, a task or an incident, as it would in
// a real handover; the rest of the record is routine filler.
function hazardCases(seed = 61, count = 240) {
  const r = rng(seed);
  const cases = [];
  const place = (text, { asIncident, sev }) => {
    const summary = `${pick(r, ROUTINE_SUMMARY)}`;
    const tasks = [{ description: pick(r, ROUTINE_TASKS) }];
    const incidents = [];
    if (asIncident) {
      incidents.push({ title: text.slice(0, 120), description: text, severity: sev });
      return { summary, tasks, incidents };
    }
    if (r() < 0.5) return { summary: `${summary} ${text}.`, tasks, incidents };
    return { summary, tasks: [...tasks, { description: text }], incidents };
  };
  for (let i = 0; i < count; i += 1) {
    const kind = r();
    if (kind < 0.42) { // worded hazard; severity varies, so wording must carry it
      const text = pick(r, HAZARD_EVENTS);
      const asIncident = r() < 0.55;
      cases.push({ ...place(text, { asIncident, sev: pick(r, SEV_MIX) }), truth_hold: true, event: text });
    } else if (kind < 0.5) { // bland wording, serious severity: rule (a) territory
      const text = pick(r, BLAND_SERIOUS);
      cases.push({ ...place(text, { asIncident: true, sev: r() < 0.5 ? 'high' : 'critical' }), truth_hold: true, event: text });
    } else if (kind < 0.93) { // routine, safe
      const text = pick(r, SAFE_EVENTS);
      const asIncident = r() < 0.25; // routine faults do get logged as low/medium incidents
      cases.push({ ...place(text, { asIncident, sev: r() < 0.7 ? 'low' : 'medium' }), truth_hold: false, event: text });
    } else { // safe but hold-bait (negations, benign safety vocabulary)
      const text = pick(r, SAFE_TRICKY);
      cases.push({ ...place(text, { asIncident: false }), truth_hold: false, event: text });
    }
  }
  return cases;
}

module.exports = {
  ownHistory, rng, severityCorpus, FAMILIES, history, drafts, qualityCases, hazardCases,
};
