import type {
	IDataObject,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	IPollFunctions,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import {
	computeWindowStartMs,
	getAppStates,
	selectReviewsToEmit,
	type MultiAppPollState,
} from '../shared/reviewPolling';
import {
	assertPackageName,
	fetchAppNames,
	getApps,
	googlePlayListReviews,
} from './GenericFunctions';
import { googleReviewTimestampMs, simplifyGoogleReview, type GoogleReview } from './reviews';

const DEFAULT_LOOKBACK_MINUTES = 15;
const MAX_REVIEWS_PER_POLL = 500;
const MANUAL_MODE_REVIEWS = 5;

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
		subtitle: 'new review',
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
				displayName: 'App Names or IDs',
				name: 'packageNames',
				type: 'multiOptions',
				typeOptions: {
					loadOptionsMethod: 'getApps',
				},
				default: [],
				required: true,
				description:
					'The apps whose reviews to watch. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
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

	methods = {
		loadOptions: {
			getApps,
		},
	};

	async poll(this: IPollFunctions): Promise<INodeExecutionData[][] | null> {
		const rawPackageNames = this.getNodeParameter('packageNames') as string[];
		const packageNames = rawPackageNames.map((name) => assertPackageName.call(this, name));
		if (packageNames.length === 0) {
			throw new NodeOperationError(this.getNode(), 'Select at least one app to watch');
		}
		const options = this.getNodeParameter('options', {}) as TriggerOptions;
		const simplify = options.simplify ?? true;

		const qs: IDataObject = {};
		if (options.translationLanguage !== undefined && options.translationLanguage.trim() !== '') {
			qs.translationLanguage = options.translationLanguage.trim();
		}

		const manual = this.getMode() === 'manual';
		const multiState = manual
			? ({} as MultiAppPollState)
			: (this.getWorkflowStaticData('node') as MultiAppPollState);
		const appStates = getAppStates(multiState, packageNames);

		// Display names come from the Reporting API and rarely change: resolve
		// missing ones once and cache them; on failure fall back to the package
		// name for this poll and retry on the next one.
		const names = (multiState.names ??= {});
		if (packageNames.some((packageName) => names[packageName] === undefined)) {
			try {
				Object.assign(names, await fetchAppNames.call(this));
			} catch (error) {
				this.logger.warn(
					`Google Play Trigger: could not resolve app display names: ${
						error instanceof Error ? error.message : String(error)
					}`,
				);
			}
		}

		const toItem = (review: GoogleReview, packageName: string): INodeExecutionData => {
			const appName = names[packageName] ?? packageName;
			return {
				json: simplify
					? { packageName, appName, ...simplifyGoogleReview(review) }
					: { packageName, appName, ...(review as unknown as IDataObject) },
			};
		};

		if (manual) {
			const items: INodeExecutionData[] = [];
			for (const packageName of packageNames) {
				const reviews = await googlePlayListReviews.call(this, packageName, {
					qs,
					maxReviews: MANUAL_MODE_REVIEWS,
				});
				items.push(...reviews.map((review) => toItem(review, packageName)));
			}
			return items.length === 0 ? null : [items];
		}

		const nowMs = Date.now();
		const marginMs = (options.lookbackMinutes ?? DEFAULT_LOOKBACK_MINUTES) * 60_000;

		const items: INodeExecutionData[] = [];
		let firstFailure: unknown;
		let failureCount = 0;

		for (const packageName of packageNames) {
			const state = appStates[packageName];

			// First poll for this app: establish the baseline without emitting history
			if (state?.lastPollMs === undefined) {
				appStates[packageName] = { lastPollMs: nowMs, seen: {} };
				continue;
			}

			try {
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

				appStates[packageName] = { lastPollMs: nowMs, seen };
				items.push(...toEmit.map((review) => toItem(review, packageName)));
			} catch (error) {
				// A failing app keeps its previous state and retries its own window
				// on the next poll; the other apps continue unaffected.
				firstFailure ??= error;
				failureCount += 1;
				this.logger.warn(
					`Google Play Trigger: polling reviews of "${packageName}" did not complete: ${
						error instanceof Error ? error.message : String(error)
					}`,
				);
			}
		}

		if (failureCount === packageNames.length && failureCount > 0) {
			throw firstFailure;
		}

		return items.length === 0 ? null : [items];
	}
}
