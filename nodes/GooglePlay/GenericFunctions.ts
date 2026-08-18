import type { IDataObject, IHttpRequestMethods, IHttpRequestOptions } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { toSanitizedApiError, type RequestContext } from '../shared/errors';
import { extractGoogleErrorMessage, isValidPackageName, type GoogleReview } from './reviews';

const BASE_URL = 'https://androidpublisher.googleapis.com/androidpublisher/v3';
const REQUEST_TIMEOUT_MS = 30_000;
const PAGE_SIZE = 100;

export const GOOGLE_REPLY_MAX_LENGTH = 350;

export function assertPackageName(this: RequestContext, value: string, itemIndex?: number): string {
	const trimmed = value.trim();
	if (!isValidPackageName(trimmed)) {
		throw new NodeOperationError(
			this.getNode(),
			`"${trimmed}" is not a valid Android package name`,
			{ itemIndex },
		);
	}
	return trimmed;
}

export function assertReviewId(this: RequestContext, value: string, itemIndex?: number): string {
	const trimmed = value.trim();
	if (trimmed === '') {
		throw new NodeOperationError(this.getNode(), 'The review ID is empty', { itemIndex });
	}
	return trimmed;
}

export function assertReplyText(this: RequestContext, value: string, itemIndex?: number): string {
	const text = value.trim();
	if (text === '') {
		throw new NodeOperationError(this.getNode(), 'The reply text is empty', { itemIndex });
	}
	if (text.length > GOOGLE_REPLY_MAX_LENGTH) {
		throw new NodeOperationError(
			this.getNode(),
			`Google Play limits replies to ${GOOGLE_REPLY_MAX_LENGTH} characters (got ${text.length})`,
			{ itemIndex },
		);
	}
	return text;
}

export async function googlePlayApiRequest(
	this: RequestContext,
	method: IHttpRequestMethods,
	endpoint: string,
	{ body, qs, itemIndex }: { body?: IDataObject; qs?: IDataObject; itemIndex?: number } = {},
): Promise<IDataObject> {
	const options: IHttpRequestOptions = {
		method,
		url: `${BASE_URL}${endpoint}`,
		json: true,
		timeout: REQUEST_TIMEOUT_MS,
		...(body !== undefined ? { body } : {}),
		...(qs !== undefined ? { qs } : {}),
	};

	try {
		const response = await this.helpers.httpRequestWithAuthentication.call(
			this,
			'googlePlayApi',
			options,
		);
		return (response ?? {}) as IDataObject;
	} catch (error) {
		throw toSanitizedApiError(this, error, extractGoogleErrorMessage, 'Google Play', itemIndex);
	}
}

interface ReviewsListResponse {
	reviews?: GoogleReview[];
	tokenPagination?: { nextPageToken?: string };
}

/**
 * Collects reviews from GET /applications/{packageName}/reviews following the
 * token-based pagination. The API only returns reviews that include a text
 * comment and were created or modified within the last week, most recent first.
 *
 * `shouldStop` lets the polling trigger cut pagination as soon as a page
 * reaches reviews older than its window.
 */
export async function googlePlayListReviews(
	this: RequestContext,
	packageName: string,
	{
		qs = {},
		maxReviews = Number.POSITIVE_INFINITY,
		itemIndex,
		shouldStop,
	}: {
		qs?: IDataObject;
		maxReviews?: number;
		itemIndex?: number;
		shouldStop?: (review: GoogleReview) => boolean;
	} = {},
): Promise<GoogleReview[]> {
	const collected: GoogleReview[] = [];
	let nextPageToken: string | undefined;

	do {
		const response = (await googlePlayApiRequest.call(
			this,
			'GET',
			`/applications/${encodeURIComponent(packageName)}/reviews`,
			{
				qs: {
					...qs,
					maxResults: Math.min(PAGE_SIZE, Math.max(1, maxReviews - collected.length)),
					...(nextPageToken !== undefined ? { token: nextPageToken } : {}),
				},
				itemIndex,
			},
		)) as ReviewsListResponse;

		const page = Array.isArray(response.reviews) ? response.reviews : [];
		for (const review of page) {
			if (shouldStop?.(review) === true) {
				return collected;
			}
			collected.push(review);
			if (collected.length >= maxReviews) {
				return collected;
			}
		}

		nextPageToken = response.tokenPagination?.nextPageToken;
	} while (nextPageToken !== undefined && nextPageToken !== '');

	return collected;
}
