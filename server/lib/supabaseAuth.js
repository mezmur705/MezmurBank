const jwt = require('jsonwebtoken');
const { createRemoteJWKSet, jwtVerify } = require('jose');

let jwks;
function getJwks() {
  if (!jwks) jwks = createRemoteJWKSet(new URL(`${process.env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`));
  return jwks;
}

// Supabase projects sign access tokens with either a legacy shared HS256 secret or a newer
// asymmetric key (verified via its published JWKS) - branch on the token's own header so this
// works either way without needing to know which mode the project is in.
async function verifySupabaseToken(token) {
  const decoded = jwt.decode(token, { complete: true });
  if (!decoded) throw new Error('Malformed token');
  if (decoded.header.alg === 'HS256') {
    return jwt.verify(token, process.env.SUPABASE_JWT_SECRET);
  }
  const { payload } = await jwtVerify(token, getJwks());
  return payload;
}

function requireSupabaseUser(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing bearer token' });
  verifySupabaseToken(token)
    .then(payload => {
      req.user = { id: payload.sub, email: payload.email };
      next();
    })
    .catch(err => {
      console.error('requireSupabaseUser failed:', err.message);
      res.status(401).json({ error: 'Invalid or expired token' });
    });
}

module.exports = { requireSupabaseUser };
