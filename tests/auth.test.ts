import { generateKeyPairSync, verify } from 'node:crypto';
import { assert, describe, it } from 'vitest';

import {
	ANDROID_PUBLISHER_SCOPE,
	createServiceAccountAssertion,
	GOOGLE_TOKEN_URL,
} from '../nodes/GooglePlay/auth';

const keyPair = generateKeyPairSync('rsa', { modulusLength: 2048 });
const privateKey = keyPair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

const credentials = {
	serviceAccountEmail: 'bot@project.iam.gserviceaccount.com',
	privateKey,
};

describe('createServiceAccountAssertion', () => {
	it('builds the OAuth2 JWT-bearer assertion Google expects', () => {
		const now = 1_755_000_000;
		const assertion = createServiceAccountAssertion(credentials, now);
		const [header, payload, signature] = assertion.split('.');

		assert.deepEqual(JSON.parse(Buffer.from(header, 'base64url').toString()), {
			alg: 'RS256',
			typ: 'JWT',
		});
		assert.deepEqual(JSON.parse(Buffer.from(payload, 'base64url').toString()), {
			iss: credentials.serviceAccountEmail,
			scope: ANDROID_PUBLISHER_SCOPE,
			aud: GOOGLE_TOKEN_URL,
			iat: now,
			exp: now + 3600,
		});
		assert.ok(
			verify(
				'RSA-SHA256',
				Buffer.from(`${header}.${payload}`),
				keyPair.publicKey,
				Buffer.from(signature, 'base64url'),
			),
		);
	});

	it('rejects an empty service account email', () => {
		assert.throws(
			() => createServiceAccountAssertion({ serviceAccountEmail: '  ', privateKey }, 0),
			/email is empty/,
		);
	});
});
