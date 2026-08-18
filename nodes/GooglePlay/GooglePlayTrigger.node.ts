import type {
	IDataObject,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	IPollFunctions,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

import {
	computeWindowStartMs,
	selectReviewsToEmit,
	type ReviewPollState,
} from '../shared/reviewPolling';
import { assertPackageName, googlePlayListReviews } from './GenericFunctions';
import { googleReviewTimestampMs, simplifyGoogleReview, type GoogleReview } from './reviews';

const DEFAULT_LOOKBACK_MINUTES = 15;
const MAX_REVIEWS_PER_POLL = 500;
const MANUAL_MODE_REVIEWS = 10;

interface TriggerOptions {
	includeUpdated?: boolean;
	lookbackMinutes?: number;
	simplify?: boolean;
	translationLanguage?: string;
}

export class GooglePlayTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Google Play Trigger',
		name: 'googlePlayTrigger',
		icon: {
			light: 'file:icons/googlePlay.svg',
			dark: 'file:icons/googlePlay.dark.svg',
		},
		group: ['trigger'],
		version: 1,
		subtitle: '={{ $parameter["packageName"] }}',
		description: 'Starts the workflow when an app gets a new review on Google Play',
		defaults: {
			name: 'Google Play Trigger',
		},
		polling: true,
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'googlePlayApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Package Name',
				name: 'packageName',
				type: 'string',
				default: '',
				required: true,
				placeholder: 'e.g. com.example.app',
				description: 'Package name of the app in Google Play',
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add option',
				default: {},
				options: [
					{
						displayName: 'Include Updated Reviews',
						name: 'includeUpdated',
						type: 'boolean',
						default: false,
						description:
							'Whether to also trigger when an already-seen review is edited by its author',
					},
					{
						displayName: 'Lookback Margin (Minutes)',
						name: 'lookbackMinutes',
						type: 'number',
						typeOptions: {
							minValue: 0,
						},
						default: DEFAULT_LOOKBACK_MINUTES,
						description:
							'How far before the previous poll to look for reviews, to compensate for the delay with which Google Play surfaces them. Overlapping reviews are deduplicated.',
					},
					{
						displayName: 'Simplify',
						name: 'simplify',
						type: 'boolean',
						default: true,
						description:
							'Whether to return a simplified version of the review instead of the raw data',
					},
					{
						displayName: 'Translation Language',
						name: 'translationLanguage',
						type: 'string',
						default: '',
						placeholder: 'e.g. es',
						description:
							'BCP-47 language code to translate the review texts to, e.g. "es" or "en-GB"',
					},
				],
			},
		],
	};

	async poll(this: IPollFunctions): Promise<INodeExecutionData[][] | null> {
		const packageName = assertPackageName.call(
			this,
			this.getNodeParameter('packageName') as string,
		);
		const options = this.getNodeParameter('options', {}) as TriggerOptions;
		const simplify = options.simplify ?? true;

		const qs: IDataObject = {};
		if (options.translationLanguage !== undefined && options.translationLanguage.trim() !== '') {
			qs.translationLanguage = options.translationLanguage.trim();
		}

		const toItems = (reviews: GoogleReview[]): INodeExecutionData[][] => [
			reviews.map((review) => ({
				json: simplify ? simplifyGoogleReview(review) : (review as unknown as IDataObject),
			})),
		];

		if (this.getMode() === 'manual') {
			const reviews = await googlePlayListReviews.call(this, packageName, {
				qs,
				maxReviews: MANUAL_MODE_REVIEWS,
			});
			return reviews.length === 0 ? null : toItems(reviews);
		}

		const nowMs = Date.now();
		const state = this.getWorkflowStaticData('node') as ReviewPollState;

		// First poll: establish the baseline without emitting historical reviews
		if (state.lastPollMs === undefined) {
			state.lastPollMs = nowMs;
			state.seen = {};
			return null;
		}

		const marginMs = (options.lookbackMinutes ?? DEFAULT_LOOKBACK_MINUTES) * 60_000;
		const windowStartMs = computeWindowStartMs(state.lastPollMs, marginMs);

		// Reviews come sorted by last modification, newest first
		const reviews = await googlePlayListReviews.call(this, packageName, {
			qs,
			maxReviews: MAX_REVIEWS_PER_POLL,
			shouldStop: (review) => googleReviewTimestampMs(review) < windowStartMs,
		});

		const { toEmit, seen } = selectReviewsToEmit(
			reviews.map((review) => ({
				id: review.reviewId,
				timestampMs: googleReviewTimestampMs(review),
				data: review,
			})),
			state.seen ?? {},
			windowStartMs,
			options.includeUpdated ?? false,
		);

		state.seen = seen;
		state.lastPollMs = nowMs;

		return toEmit.length === 0 ? null : toItems(toEmit);
	}
}
