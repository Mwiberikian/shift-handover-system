// Phase 2 FAIL SAFE: if the release evaluation itself throws, the report is
// HELD, never silently released, and the submission still succeeds. The
// evaluator is mocked to explode in this file only.
jest.mock('../src/modules/assistant/release', () => ({
  evaluateRelease: () => { throw new Error('synthetic evaluation failure'); },
}));

const {
  pool, buildWorld, as, createCompleteDraft,
} = require('./helpers/fixtures');

let world;
beforeEach(async () => { world = await buildWorld(); });
afterAll(() => pool.end());

test('an evaluation crash holds the report instead of releasing it', async () => {
  const draft = await createCompleteDraft(world);
  const res = await as(world, 'outA').post(`/api/handovers/${draft.record_id}/submit`);

  expect(res.status).toBe(200); // the submission itself is not harmed
  expect(res.body.status).toBe('submitted');
  expect(res.body.release_state).toBe('held');
  expect(res.body.released_at).toBeNull();
  expect(res.body.release_reasons).toEqual([
    expect.objectContaining({ code: 'evaluation_failed' }),
  ]);

  // Supervisors are alerted that it needs approval.
  const { rows } = await pool.query(
    'SELECT recipient_id, type FROM notification WHERE record_id = $1', [draft.record_id],
  );
  expect(rows).toEqual(expect.arrayContaining([
    { recipient_id: world.users.supA.user_id, type: 'handover_held' },
  ]));

  // And the way out still works: a supervisor approves.
  const ok = await as(world, 'supA').post(`/api/handovers/${draft.record_id}/approve`, {});
  expect(ok.status).toBe(200);
  expect(ok.body.release_state).toBe('approved');
});
