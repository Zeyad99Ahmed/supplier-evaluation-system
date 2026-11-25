// Password hashing with Node's built-in scrypt (as planned in the Phase 1 proposal, section 6.2).
// Stored format: scrypt$<N>$<salt-b64>$<hash-b64>. A random 16-byte salt per password.
const crypto = require('crypto');
const { promisify } = require('util');

const scrypt = promisify(crypto.scrypt);
const N = 16384; const KEYLEN = 64;

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, KEYLEN, { N, r: 8, p: 1 });
  return `scrypt$${N}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

async function verifyPassword(password, stored) {
  const [alg, n, saltB64, hashB64] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length, { N: Number(n), r: 8, p: 1 });
  return crypto.timingSafeEqual(expected, actual); // constant-time comparison
}

// A dummy hash so a login for an unknown e-mail takes the same time as a wrong password.
let dummy;
async function dummyVerify(password) {
  dummy = dummy || await hashPassword('dummy-password-for-timing');
  await verifyPassword(password, dummy);
  return false;
}

// Password policy: 10-72 characters, at least one letter and one digit.
function passwordProblems(pw) {
  if (typeof pw !== 'string' || pw.length < 10 || pw.length > 72) return 'password must be 10-72 characters.';
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return 'password must contain letters and digits.';
  return null;
}

module.exports = { hashPassword, verifyPassword, dummyVerify, passwordProblems };
