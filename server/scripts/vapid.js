// Prints a new VAPID key pair for Web Push (Part R3). Put the lines in the
// API's environment (never in a committed file), with PUSH_ENABLED=true and
// VAPID_SUBJECT set to a contact address, e.g. mailto:ops@example.com.
// Changing the keys invalidates every existing subscription: users turn push
// on again from their menu.
const webpush = require('web-push');

const { publicKey, privateKey } = webpush.generateVAPIDKeys();
console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${privateKey}`);
console.log('VAPID_SUBJECT=mailto:you@example.com');
