import { assert, describe, it } from 'vitest';

import {
	extractGoogleErrorMessage,
	googleReviewTimestampMs,
	isValidPackageName,
	simplifyGoogleReview,
	type GoogleReview,
} from '../nodes/GooglePlay/reviews';

const review: GoogleReview = {
	reviewId: 'gp:AOqpTOE',
	authorName: 'Jane',
	comments: [
		{
			userComment: {
				text: '\tGreat app for my grandmother',
				lastModified: { seconds: '1755000000', nanos: 123000000 },
				starRating: 5,
				reviewerLanguage: 'es',
				device: 'a54x',
				androidOsVersion: 34,
				appVersionCode: 210,
				appVersionName: '2.1.0',
				thumbsUpCount: 3,
				thumbsDownCount: 0,
			},
		},
		{
			developerComment: {
				text: 'Thanks!',
				lastModified: { seconds: 1755003600 },
			},
		},
	],
};

describe('googleReviewTimestampMs', () => {
	it('uses the user comment last modification', () => {
		assert.equal(googleReviewTimestampMs(review), 1_755_000_000_000);
	});

	it('returns 0 when there is no usable timestamp', () => {
		assert.equal(googleReviewTimestampMs({ reviewId: 'x' }), 0);
		assert.equal(
			googleReviewTimestampMs({
				reviewId: 'x',
				comments: [{ userComment: { lastModified: { seconds: 'nope' } } }],
			}),
			0,
		);
	});
});

describe('simplifyGoogleReview', () => {
	it('flattens the user and developer comments', () => {
		assert.deepEqual(simplifyGoogleReview(review), {
			reviewId: 'gp:AOqpTOE',
			authorName: 'Jane',
			rating: 5,
			text: '\tGreat app for my grandmother',
			lastModifiedDate: '2025-08-12T12:00:00.000Z',
			reviewerLanguage: 'es',
			device: 'a54x',
			androidOsVersion: 34,
			appVersionCode: 210,
			appVersionName: '2.1.0',
			thumbsUpCount: 3,
			thumbsDownCount: 0,
			developerReplyText: 'Thanks!',
			developerReplyDate: '2025-08-12T13:00:00.000Z',
		});
	});

	it('tolerates reviews without comments', () => {
		const simplified = simplifyGoogleReview({ reviewId: 'x' });
		assert.equal(simplified.reviewId, 'x');
		assert.equal(simplified.text, '');
		assert.equal(simplified.developerReplyText, undefined);
	});
});

describe('isValidPackageName', () => {
	it('accepts standard package names', () => {
		assert.ok(isValidPackageName('com.example.app'));
		assert.ok(isValidPackageName('es.maximiliana.launcher_2'));
	});

	it('rejects malformed package names', () => {
		assert.ok(!isValidPackageName('com'));
		assert.ok(!isValidPackageName('com..app'));
		assert.ok(!isValidPackageName('com.1app'));
		assert.ok(!isValidPackageName('com.example.app; rm -rf /'));
		assert.ok(!isValidPackageName(''));
	});
});

describe('extractGoogleErrorMessage', () => {
	it('extracts the standard Google error message', () => {
		assert.equal(
			extractGoogleErrorMessage({
				error: {
					code: 403,
					message: 'The caller does not have permission',
					status: 'PERMISSION_DENIED',
				},
			}),
			'The caller does not have permission',
		);
	});

	it('handles string errors', () => {
		assert.equal(extractGoogleErrorMessage({ error: 'invalid_grant' }), 'invalid_grant');
	});

	it('returns undefined for unknown shapes', () => {
		assert.equal(extractGoogleErrorMessage(undefined), undefined);
		assert.equal(extractGoogleErrorMessage('<html>'), undefined);
		assert.equal(extractGoogleErrorMessage({ error: {} }), undefined);
	});
});
