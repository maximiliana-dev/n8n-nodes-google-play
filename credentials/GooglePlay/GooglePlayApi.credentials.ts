import type {
	ICredentialDataDecryptedObject,
	ICredentialTestRequest,
	ICredentialType,
	IHttpRequestHelper,
	IHttpRequestOptions,
	Icon,
	INodeProperties,
} from 'n8n-workflow';

import { acquireAccessToken, type GooglePlayCredentials } from '../../nodes/GooglePlay/auth';

export class GooglePlayApi implements ICredentialType {
	name = 'googlePlayApi';

	displayName = 'Google Play API';

	icon: Icon = {
		light: 'file:icons/googlePlay.svg',
		dark: 'file:icons/googlePlay.dark.svg',
	};

	documentationUrl = 'https://developers.google.com/android-publisher/getting_started';

	properties: INodeProperties[] = [
		{
			displayName: 'Service Account Email',
			name: 'serviceAccountEmail',
			type: 'string',
			default: '',
			placeholder: 'name@project.iam.gserviceaccount.com',
			required: true,
			description:
				'Email of a Google Cloud service account that has been granted access to the app in the Google Play Console (Users and Permissions → Reply to reviews)',
		},
		{
			displayName: 'Private Key',
			name: 'privateKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description:
				'Private key of the service account, from the "private_key" field of the downloaded JSON key file. Escaped newlines (\\n) are handled automatically.',
		},
		{
			displayName: 'Access Token',
			name: 'accessToken',
			type: 'hidden',
			typeOptions: { expirable: true, password: true },
			default: '',
		},
	];

	// Runs whenever the access token is missing or expired: exchanges a signed
	// JWT assertion for a one-hour OAuth2 access token.
	async preAuthentication(this: IHttpRequestHelper, credentials: ICredentialDataDecryptedObject) {
		const accessToken = await acquireAccessToken(
			this,
			credentials as unknown as GooglePlayCredentials,
		);
		return { accessToken };
	}

	// A function instead of a generic `={{...}}` header: expression evaluation
	// under N8N_EXPRESSION_ENGINE=vm races between concurrent pollers of the
	// same workflow ("No bridge acquired for this context").
	async authenticate(
		credentials: ICredentialDataDecryptedObject,
		requestOptions: IHttpRequestOptions,
	): Promise<IHttpRequestOptions> {
		return {
			...requestOptions,
			headers: {
				...requestOptions.headers,
				Authorization: `Bearer ${String(credentials.accessToken)}`,
			},
		};
	}

	test: ICredentialTestRequest = {
		request: {
			baseURL: 'https://oauth2.googleapis.com',
			url: '/tokeninfo',
			qs: {
				access_token: '={{$credentials.accessToken}}',
			},
		},
	};
}
