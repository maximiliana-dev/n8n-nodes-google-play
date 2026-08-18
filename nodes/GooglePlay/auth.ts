import type { IHttpRequestHelper } from 'n8n-workflow';

import { signJwt } from '../shared/jwt';

const REQUEST_TIMEOUT_MS = 30_000;

export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const ANDROID_PUBLISHER_SCOPE = 'https://www.googleapis.com/auth/androidpublisher';

const TOKEN_LIFETIME_SECONDS = 3600;

export interface GooglePlayCredentials {
	serviceAccountEmail: string;
	privateKey: string;
}

/**
 * Builds the RS256-signed JWT assertion for the OAuth2 service account flow
 * (urn:ietf:params:oauth:grant-type:jwt-bearer).
 */
export function createServiceAccountAssertion(
	credentials: GooglePlayCredentials,
	nowSeconds: number,
): string {
	const email = credentials.serviceAccountEmail.trim();
	if (email === '') {
		throw new Error('The service account email is empty');
	}

	return signJwt(
		{ alg: 'RS256', typ: 'JWT' },
		{
			iss: email,
			scope: ANDROID_PUBLISHER_SCOPE,
			aud: GOOGLE_TOKEN_URL,
			iat: nowSeconds,
			exp: nowSeconds + TOKEN_LIFETIME_SECONDS,
		},
		credentials.privateKey,
		'RS256',
	);
}

interface TokenResponse {
	body: { access_token?: unknown; error?: unknown; error_description?: unknown };
	statusCode: number;
}

export async function acquireAccessToken(
	http: IHttpRequestHelper,
	credentials: GooglePlayCredentials,
): Promise<string> {
	const assertion = createServiceAccountAssertion(credentials, Math.floor(Date.now() / 1000));

	const response = (await http.helpers.httpRequest({
		method: 'POST',
		url: GOOGLE_TOKEN_URL,
		body: {
			grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
			assertion,
		},
		json: true,
		returnFullResponse: true,
		ignoreHttpStatusErrors: true,
		timeout: REQUEST_TIMEOUT_MS,
	})) as TokenResponse;

	const accessToken = response.statusCode === 200 ? response.body?.access_token : undefined;
	if (typeof accessToken !== 'string' || accessToken === '') {
		const detail =
			typeof response.body?.error_description === 'string'
				? response.body.error_description
				: typeof response.body?.error === 'string'
					? response.body.error
					: 'unknown error';
		throw new Error(
			`Google did not issue an access token (HTTP ${response.statusCode}): ${detail}. Check the service account email and private key.`,
		);
	}

	return accessToken;
}
