// What an email says (IR-05). Deliberately thin: a subject and a few lines
// with the notification's title and a link to the app. Never handover content
// (summaries, tasks, incidents, comments), never message bodies, never
// passwords. The reader signs in to see the rest.

// Titles for notifications that have none of their own (handover events).
const TYPE_TITLES = {
  handover_submitted: 'A handover has been submitted',
  handover_acknowledged: 'A handover has been acknowledged',
  handover_queried: 'A query was raised on a handover',
  handover_clarified: 'A handover query was answered',
  handover_escalated: 'A handover was escalated',
  handover_resolved: 'An escalated handover was resolved',
  handover_closed: 'A handover was closed',
  message: 'You have a new message',
  reminder: 'Shift Handover reminder',
  report_shared: 'A shift report has been shared with you',
};

// Reminder titles are fixed phrases written by the reminders job ("Handover
// due soon"); their bodies name people and shifts, so only the title is used.
// A shared report's title is "Shift report shared with you: <report title>";
// the report's text is never in the notification, so never in the email.
const OWN_TITLE = ['reminder', 'report_shared'];
const titleFor = (n) => (OWN_TITLE.includes(n.type) && n.title) || TYPE_TITLES[n.type] || 'Shift Handover notification';

function buildEmail(notification, { appUrl }) {
  const title = titleFor(notification);
  return {
    subject: `[Shift Handover] ${title}`.slice(0, 200),
    text: [
      title,
      '',
      'Sign in to Shift Handover to see the details:',
      appUrl,
      '',
      'You receive this because email alerts are on for your account. You can turn them off in the app (your name, top right).',
      'This message contains no handover details. Do not reply to it.',
    ].join('\n'),
  };
}

module.exports = { buildEmail, titleFor, TYPE_TITLES };
