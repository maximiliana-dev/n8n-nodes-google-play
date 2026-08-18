import type {
	IAuthenticateGeneric,
	ICredentialDataDecryptedObject,
	ICredentialTestRequest,
	ICredentialType,
	IHttpRequestHelper,
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

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.accessToken}}',
			},
		},
	};

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
