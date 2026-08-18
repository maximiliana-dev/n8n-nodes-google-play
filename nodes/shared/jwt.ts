import { createPrivateKey, sign, type KeyObject } from 'node:crypto';

export type JwtAlgorithm = 'RS256' | 'ES256';

const PEM_REGEX = /-----BEGIN ([A-Z0-9 ]+)-----([A-Za-z0-9+/=\s]+)-----END \1-----/;
const BASE64_REGEX = /^[A-Za-z0-9+/=\s]+$/;

/**
 * Rebuilds a well-formed PEM out of whatever survived the paste into the
 * credential field: keys copied from a JSON file carry literal "\n" sequences,
 * and single-line password inputs collapse real newlines into spaces (or strip
 * them entirely), leaving header, body and footer glued together.
 */
export function normalizePrivateKey(raw: string): string {
	const unescaped = raw.trim().replace(/\\n/g, '\n');

	const match = PEM_REGEX.exec(unescaped);
	if (match === null) {
		// Tolerate pasting only the base64 body of a PKCS#8 key (e.g. a .p8 file
		// without its BEGIN/END lines)
		if (BASE64_REGEX.test(unescaped)) {
			return wrapPem('PRIVATE KEY', unescaped);
		}
		return unescaped;
	}
	return wrapPem(match[1], match[2]);
}

function wrapPem(label: string, base64Body: string): string {
	const body = base64Body.replace(/\s+/g, '');
	const lines = body.match(/.{1,64}/g) ?? [];
	return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----`;
}

export function base64UrlEncode(input: Buffer | string): string {
	return Buffer.from(input).toString('base64url');
}

function parsePrivateKey(privateKeyPem: string, algorithm: JwtAlgorithm): KeyObject {
	let key: KeyObject;
	try {
		key = createPrivateKey(normalizePrivateKey(privateKeyPem));
	} catch {
		// eslint-disable-next-line @n8n/community-nodes/require-node-api-error -- runs inside credential preAuthentication, where no node context exists
		throw new Error('The private key is not a valid PEM-encoded key');
	}

	if (algorithm === 'RS256' && key.asymmetricKeyType !== 'rsa') {
		throw new Error(
			`RS256 requires an RSA private key, but got a "${key.asymmetricKeyType}" key. Use the private key from the service account JSON file.`,
		);
	}
	if (algorithm === 'ES256' && key.asymmetricKeyType !== 'ec') {
		throw new Error(
			`ES256 requires an EC (P-256) private key, but got a "${key.asymmetricKeyType}" key. Use the contents of the .p8 file downloaded from App Store Connect.`,
		);
	}
	return key;
}

export function signJwt(
	header: Record<string, unknown>,
	payload: Record<string, unknown>,
	privateKeyPem: string,
	algorithm: JwtAlgorithm,
): string {
	const key = parsePrivateKey(privateKeyPem, algorithm);
	const signingInput = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(payload))}`;

	const signature =
		algorithm === 'RS256'
			? sign('RSA-SHA256', Buffer.from(signingInput), key)
			: // ES256 must use the raw (r || s) JOSE signature format, not ASN.1 DER
				sign('sha256', Buffer.from(signingInput), { key, dsaEncoding: 'ieee-p1363' });

	return `${signingInput}.${base64UrlEncode(signature)}`;
}
