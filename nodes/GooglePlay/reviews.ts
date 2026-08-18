import type { IDataObject } from 'n8n-workflow';

import { truncateErrorMessage } from '../shared/errors';

interface GoogleTimestamp {
	seconds?: string | number;
	nanos?: number;
}

interface GoogleUserComment {
	text?: string;
	lastModified?: GoogleTimestamp;
	starRating?: number;
	reviewerLanguage?: string;
	device?: string;
	androidOsVersion?: number;
	appVersionCode?: number;
	appVersionName?: string;
	thumbsUpCount?: number;
	thumbsDownCount?: number;
}

interface GoogleDeveloperComment {
	text?: string;
	lastModified?: GoogleTimestamp;
}

export interface GoogleReview {
	reviewId: string;
	authorName?: string;
	comments?: Array<{
		userComment?: GoogleUserComment;
		developerComment?: GoogleDeveloperComment;
	}>;
}

function timestampToMs(timestamp: GoogleTimestamp | undefined): number | undefined {
	const seconds = Number(timestamp?.seconds);
	if (!Number.isFinite(seconds) || seconds <= 0) {
		return undefined;
	}
	return seconds * 1000;
}

function toIsoDate(timestamp: GoogleTimestamp | undefined): string | undefined {
	const ms = timestampToMs(timestamp);
	return ms === undefined ? undefined : new Date(ms).toISOString();
}

function findUserComment(review: GoogleReview): GoogleUserComment | undefined {
	return review.comments?.find((comment) => comment.userComment !== undefined)?.userComment;
}

function findDeveloperComment(review: GoogleReview): GoogleDeveloperComment | undefined {
	return review.comments?.find((comment) => comment.developerComment !== undefined)
		?.developerComment;
}

/** Timestamp used by the polling trigger: when the user last touched the review. */
export function googleReviewTimestampMs(review: GoogleReview): number {
	return timestampToMs(findUserComment(review)?.lastModified) ?? 0;
}

export function simplifyGoogleReview(review: GoogleReview): IDataObject {
	const userComment = findUserComment(review);
	const developerComment = findDeveloperComment(review);

	return {
		reviewId: review.reviewId,
		authorName: review.authorName ?? '',
		rating: userComment?.starRating,
		text: userComment?.text ?? '',
		lastModifiedDate: toIsoDate(userComment?.lastModified),
		reviewerLanguage: userComment?.reviewerLanguage,
		device: userComment?.device,
		androidOsVersion: userComment?.androidOsVersion,
		appVersionCode: userComment?.appVersionCode,
		appVersionName: userComment?.appVersionName,
		thumbsUpCount: userComment?.thumbsUpCount,
		thumbsDownCount: userComment?.thumbsDownCount,
		developerReplyText: developerComment?.text,
		developerReplyDate: toIsoDate(developerComment?.lastModified),
	};
}

// https://developer.android.com/build/configure-app-module: segments start with
// a letter and contain only letters, digits and underscores.
const PACKAGE_NAME_REGEX = /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/;

export function isValidPackageName(value: string): boolean {
	return PACKAGE_NAME_REGEX.test(value);
}

interface GoogleErrorBody {
	error?: { message?: unknown; status?: unknown } | string;
}

export function extractGoogleErrorMessage(body: unknown): string | undefined {
	if (typeof body !== 'object' || body === null) {
		return undefined;
	}
	const error = (body as GoogleErrorBody).error;
	if (typeof error === 'string' && error.trim() !== '') {
		return truncateErrorMessage(error.trim());
	}
	if (typeof error === 'object' && error !== null && typeof error.message === 'string') {
		const message = error.message.trim();
		return message === '' ? undefined : truncateErrorMessage(message);
	}
	return undefined;
}
