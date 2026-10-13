// FR-16: authorised users search the shift log history by date range,
// department, shift, record status and free-text keyword.
const {
  pool, buildWorld, as, createCompleteDraft, insertRecordWithStatus,
} = require('./helpers/fixtures');

let world;
let current; // dept_a, current (day) shift, draft
let previous; // dept_a, previous (night) shift, acknowledged
let other; // dept_b, previous (night) shift, submitted
beforeEach(async () => {
  world = await buildWorld();
  // The fixture names shifts 'previous'/'current'; give them real types.
  await pool.query("UPDATE shift SET shift_type = CASE shift_type WHEN 'current' THEN 'day' ELSE 'night' END");
  current = await createCompleteDraft(world);
  ({ record: previous } = await insertRecordWithStatus(world, {
    shift: 'previous', status: 'acknowledged', tasks: [{ description: 'Replace 100% worn tyre_on tug 4', status: 'open' }],
  }));
  ({ record: other } = await insertRecordWithStatus(world, { dept: 'dept_b', shift: 'previous', status: 'submitted' }));
});
afterAll(() => pool.end());

const ids = (res) => res.body.map((r) => r.record_id).sort();
const search = (who, qs = '') => as(world, who).get(`/api/handovers/search${qs}`);

describe('filters', () => {
  test('shift_type returns only records of that shift type', async () => {
    const night = await search('supA', '?shift_type=night');
    expect(night.status).toBe(200);
    expect(ids(night)).toEqual([previous.record_id]);
    expect(night.body[0].shift_type).toBe('night');
    expect(ids(await search('supA', '?shift_type=day'))).toEqual([current.record_id]);
  });

  test('shift_id returns only that shift', async () => {
    const res = await search('supA', `?shift_id=${world.shifts.dept_a.current.shift_id}`);
    expect(ids(res)).toEqual([current.record_id]);
  });

  test('an unknown shift_type or a malformed shift_id is a 400', async () => {
    expect((await search('supA', '?shift_type=evening')).body.details)
      .toEqual([{ field: 'shift_type', message: "shift_type must be 'day' or 'night'" }]);
    expect((await search('supA', '?shift_id=abc')).status).toBe(400);
  });

  test('status', async () => {
    expect(ids(await search('supA', '?status=draft'))).toEqual([current.record_id]);
    expect(ids(await search('supA', '?status=acknowledged'))).toEqual([previous.record_id]);
  });

  test('date range on the shift start (inclusive bounds)', async () => {
    const curStart = new Date(world.shifts.dept_a.current.start_time);
    const before = new Date(curStart.getTime() - 1000).toISOString();
    expect(ids(await search('supA', `?from=${encodeURIComponent(curStart.toISOString())}`))).toEqual([current.record_id]);
    expect(ids(await search('supA', `?to=${encodeURIComponent(before)}`))).toEqual([previous.record_id]);
    expect((await search('supA', '?from=yesterday')).status).toBe(400);
  });

  test('keyword matches summary or task text, case-insensitive; % and _ are literal', async () => {
    expect(ids(await search('supA', '?q=stands%20CLEAR'))).toEqual([current.record_id]);
    expect(ids(await search('supA', '?q=gpu'))).toEqual([current.record_id]);
    expect(ids(await search('supA', '?q=100%25%20worn'))).toEqual([previous.record_id]);
    expect(ids(await search('supA', '?q=tyre_on'))).toEqual([previous.record_id]);
    expect(ids(await search('supA', '?q=tyre_o_'))).toEqual([]);
    expect(ids(await search('supA', '?q=%25'))).toEqual([previous.record_id]);
  });

  test('filters combine', async () => {
    expect(ids(await search('supA', '?shift_type=night&status=draft'))).toEqual([]);
    expect(ids(await search('supA', '?shift_type=night&q=tyre'))).toEqual([previous.record_id]);
  });
});

describe('department and role scoping', () => {
  test('a supervisor sees only their own department; asking for another is 403', async () => {
    expect(ids(await search('supA'))).toEqual([current.record_id, previous.record_id].sort());
    expect((await search('supA', `?department_id=${world.depts.dept_b.department_id}`)).status).toBe(403);
    expect((await search('supA', '?department_code=dept_b')).status).toBe(403);
  });

  test('an admin searches every department, or one by id or code', async () => {
    expect(ids(await search('admin'))).toEqual([current.record_id, previous.record_id, other.record_id].sort());
    expect(ids(await search('admin', '?department_code=dept_b'))).toEqual([other.record_id]);
    expect(ids(await search('admin', `?department_id=${world.depts.dept_b.department_id}&shift_type=night`))).toEqual([other.record_id]);
    expect((await search('admin', '?department_code=nope')).status).toBe(404);
  });

  test('outgoing and incoming staff may not search (403)', async () => {
    expect((await search('outA')).status).toBe(403);
    expect((await search('incA')).status).toBe(403);
  });
});
