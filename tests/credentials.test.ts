import { assert, describe, it } from 'vitest';

import { GooglePlayApi } from '../credentials/GooglePlay/GooglePlayApi.credentials';

describe('GooglePlayApi.authenticate', () => {
	it('adds the bearer header without dropping existing ones', async () => {
		const options = await new GooglePlayApi().authenticate(
			{ accessToken: 'ya29.token' },
			{ url: 'https://androidpublisher.googleapis.com', headers: { Accept: 'application/json' } },
		);
		assert.deepEqual(options.headers, {
			Accept: 'application/json',
			Authorization: 'Bearer ya29.token',
		});
		assert.equal(options.url, 'https://androidpublisher.googleapis.com');
	});
});
