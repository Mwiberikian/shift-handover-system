// Production configuration (Part P2). Every secret comes from the environment;
// nothing here has a fallback value for one.

const PLACEHOLDER_SECRETS = new Set(['change_me']);

// CLIENT_ORIGIN may list several origins, comma-separated (for example the
// static host's own address and a custom domain).
function clientOrigins(env = process.env) {
  return String(env.CLIENT_ORIGIN || '')
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}

// Express "trust proxy": how many proxies sit in front of the API, so that
// req.ip (and the per-IP rate limits) see the client, not the load balancer.
// TRUST_PROXY wins (a hop count, or false); production defaults to 1 hop,
// everything else to none.
function trustProxy(env = process.env) {
  const v = env.TRUST_PROXY?.trim();
  if (v) {
    if (v === 'false') return false;
    const hops = Number(v);
    if (Number.isInteger(hops) && hops >= 0) return hops;
    throw new Error(`TRUST_PROXY must be a hop count or false, got '${v}'`);
  }
  return env.NODE_ENV === 'production' ? 1 : false;
}

// The reasons the server must not start. Empty outside production.
function productionConfigErrors(env = process.env) {
  if (env.NODE_ENV !== 'production') return [];
  const errors = [];
  const secret = env.JWT_SECRET?.trim();
  if (!secret) errors.push('JWT_SECRET is not set');
  else if (PLACEHOLDER_SECRETS.has(secret)) errors.push('JWT_SECRET is still the placeholder change_me');
  if (!clientOrigins(env).length) errors.push('CLIENT_ORIGIN is not set');
  if (!env.DATABASE_URL?.trim()) errors.push('DATABASE_URL is not set');
  try { trustProxy(env); } catch (err) { errors.push(err.message); }
  if (env.PUSH_ENABLED === 'true') {
    for (const k of ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT']) {
      if (!env[k]?.trim()) errors.push(`PUSH_ENABLED=true but ${k} is not set`);
    }
  }
  return errors;
}

module.exports = { clientOrigins, trustProxy, productionConfigErrors };
