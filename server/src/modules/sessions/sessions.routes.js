// Work sessions (/api/sessions) and task timers (/api/tasks/:id/timer).
// Any signed-in user may call these; starting a session needs a shift the
// user is rostered on right now, and timers need the user's own draft tasks.
const express = require('express');
const { param } = require('express-validator');
const validate = require('../../middleware/validate');
const { requireAuth } = require('../../middleware/auth');
const service = require('./sessions.service');

const sessions = express.Router();
sessions.use(requireAuth);

sessions.post('/start', async (req, res) => {
  const result = await service.start(req.user);
  res.status(result.created ? 201 : 200).json(result);
});
// The client sends this every 60 s while the tab is visible.
sessions.post('/heartbeat', async (req, res) => res.json(await service.heartbeat(req.user)));
sessions.post('/end', async (req, res) => res.json(await service.end(req.user)));
sessions.get('/mine', async (req, res) => res.json(await service.mine(req.user)));

const tasks = express.Router();
tasks.use(requireAuth);
const taskId = param('id', 'id must be a UUID').isUUID();

tasks.post('/:id/timer/start', taskId, validate, async (req, res) => {
  const result = await service.startTimer(req.user, req.params.id);
  res.status(result.created ? 201 : 200).json(result);
});
tasks.post('/:id/timer/stop', taskId, validate, async (req, res) => res.json(await service.stopTimer(req.user, req.params.id)));

module.exports = { sessions, tasks };
