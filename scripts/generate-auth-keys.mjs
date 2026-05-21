// One-off helper: generates the RS256 keypair that @convex-dev/auth needs.
// Prints JWT_PRIVATE_KEY (PKCS8 PEM) and JWKS (public JWK set) so they can be
// set as Convex deployment env vars. Safe to re-run (rotates keys).
import { exportJWK, exportPKCS8, generateKeyPair } from 'jose';

const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true });
const pkcs8 = await exportPKCS8(privateKey);
const publicJwk = await exportJWK(publicKey);
const jwks = JSON.stringify({ keys: [{ use: 'sig', ...publicJwk }] });

// @convex-dev/auth stores the private key with newlines replaced by spaces.
const jwtPrivateKey = pkcs8.trimEnd().replace(/\n/g, ' ');

console.log(JSON.stringify({ JWT_PRIVATE_KEY: jwtPrivateKey, JWKS: jwks }));
