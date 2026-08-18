import { generateKeyPairSync, verify } from 'node:crypto';
import { assert, describe, it } from 'vitest';

import { normalizePrivateKey, signJwt } from '../../nodes/shared/jwt';

function decodeSegment(segment: string): Record<string, unknown> {
	return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
}

const rsaKeyPair = generateKeyPairSync('rsa', { modulusLength: 2048 });
const ecKeyPair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });

const rsaPrivatePem = rsaKeyPair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const ecPrivatePem = ecKeyPair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

describe('normalizePrivateKey', () => {
	it('converts escaped newlines into real newlines', () => {
		const escaped = rsaPrivatePem.trim().replace(/\n/g, '\\n');
		assert.equal(normalizePrivateKey(escaped), rsaPrivatePem.trim());
	});

	it('trims surrounding whitespace', () => {
		assert.equal(normalizePrivateKey(`\n  ${ecPrivatePem.trim()}  \n`), ecPrivatePem.trim());
	});

	it('rebuilds a key whose newlines were collapsed into spaces', () => {
		// Single-line password inputs turn the pasted newlines into spaces
		const collapsed = ecPrivatePem.trim().replace(/\n/g, ' ');
		assert.equal(normalizePrivateKey(collapsed), ecPrivatePem.trim());
	});

	it('rebuilds a key whose newlines were stripped entirely', () => {
		const glued = ecPrivatePem
			.trim()
			.replace(/-----\n/g, '-----')
			.replace(/\n-----/g, '-----')
			.replace(/\n/g, '');
		assert.equal(normalizePrivateKey(glued), ecPrivatePem.trim());
	});

	it('wraps a bare base64 body as a PKCS#8 key', () => {
		const body = ecPrivatePem
			.trim()
			.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '')
			.trim();
		assert.equal(normalizePrivateKey(body), ecPrivatePem.trim());
		assert.equal(normalizePrivateKey(body.replace(/\n/g, ' ')), ecPrivatePem.trim());
	});
});

describe('signJwt', () => {
	it('produces a verifiable RS256 token', () => {
		const token = signJwt({ alg: 'RS256', typ: 'JWT' }, { iss: 'me' }, rsaPrivatePem, 'RS256');
		const [header, payload, signature] = token.split('.');

		assert.deepEqual(decodeSegment(header), { alg: 'RS256', typ: 'JWT' });
		assert.deepEqual(decodeSegment(payload), { iss: 'me' });
		assert.ok(
			verify(
				'RSA-SHA256',
				Buffer.from(`${header}.${payload}`),
				rsaKeyPair.publicKey,
				Buffer.from(signature, 'base64url'),
			),
		);
	});

	it('produces a verifiable ES256 token in JOSE signature format', () => {
		const token = signJwt({ alg: 'ES256', kid: 'KEY' }, { aud: 'x' }, ecPrivatePem, 'ES256');
		const [header, payload, signature] = token.split('.');

		const rawSignature = Buffer.from(signature, 'base64url');
		// JOSE ES256 signatures are the raw r || s concatenation: exactly 64 bytes
		assert.equal(rawSignature.length, 64);
		assert.ok(
			verify(
				'sha256',
				Buffer.from(`${header}.${payload}`),
				{ key: ecKeyPair.publicKey, dsaEncoding: 'ieee-p1363' },
				rawSignature,
			),
		);
	});

	it('accepts keys pasted with escaped newlines', () => {
		const escaped = rsaPrivatePem.trim().replace(/\n/g, '\\n');
		const token = signJwt({ alg: 'RS256' }, { iss: 'me' }, escaped, 'RS256');
		assert.equal(token.split('.').length, 3);
	});

	it('rejects garbage instead of a PEM key', () => {
		assert.throws(() => signJwt({}, {}, 'not a key', 'RS256'), /not a valid PEM-encoded key/);
	});

	it('rejects an EC key for RS256', () => {
		assert.throws(() => signJwt({}, {}, ecPrivatePem, 'RS256'), /RS256 requires an RSA/);
	});

	it('rejects an RSA key for ES256', () => {
		assert.throws(() => signJwt({}, {}, rsaPrivatePem, 'ES256'), /ES256 requires an EC/);
	});
});
