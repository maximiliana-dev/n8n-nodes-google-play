import type {
	IDataObject,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	IPollFunctions,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { MAIN_CONNECTION } from '../shared/connections';
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
	googlePlayGetProductionTrack,
	googlePlayListReviews,
} from './GenericFunctions';
import {
	getAppReleaseStates,
	liveReleases,
	releaseEventPayload,
	releaseFingerprint,
	selectReleaseEvents,
	type ReleaseEmitMode,
	type ReleaseEvent,
	type ReleaseTriggerState,
	type TrackRelease,
} from './releases';
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
		subtitle: '={{ $parameter["event"] === "newRelease" ? "new release" : "new review" }}',
		description:
			'Starts the workflow when an app gets a new review or a new production release on Google Play',
		defaults: {
			name: 'Google Play Trigger',
		},
		polling: true,
		inputs: [],
		outputs: [MAIN_CONNECTION],
		credentials: [
			{
				name: 'googlePlayApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Event',
				name: 'event',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'New Production Release',
						value: 'newRelease',
						description: 'Triggers when a release is rolled out to the production track',
					},
					{
						name: 'New Review',
						value: 'newReview',
						description: 'Triggers when an app gets a new review',
					},
				],
				default: 'newReview',
			},
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
					'The apps to watch. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			{
				displayName: 'Emit When',
				name: 'emitOn',
				type: 'options',
				displayOptions: {
					show: {
						event: ['newRelease'],
					},
				},
				options: [
					{
						name: 'Rollout Completes',
						value: 'rolloutCompleted',
						description: 'Only when the release reaches 100% of users',
					},
					{
						name: 'Rollout Starts',
						value: 'rolloutStarted',
						description:
							'As soon as the release appears in production, even at a partial rollout fraction',
					},
					{
						name: 'Rollout Starts and Completes',
						value: 'both',
						description:
							'Two events per staged release: one when it starts and another when it reaches 100%',
					},
				],
				default: 'rolloutStarted',
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add option',
				default: {},
				displayOptions: {
					show: {
						event: ['newReview'],
					},
				},
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

		if ((this.getNodeParameter('event', 'newReview') as string) === 'newRelease') {
			return await pollReleases.call(this, packageNames);
		}
		return await pollReviews.call(this, packageNames);
	}
}

/**
 * Resolves app display names through the Reporting API and caches them: they
 * rarely change. On failure the package name is used for this poll and the
 * lookup retries on the next one.
 */
async function resolveAppNames(
	context: IPollFunctions,
	state: { names?: Record<string, string> },
	packageNames: string[],
): Promise<Record<string, string>> {
	const names = (state.names ??= {});
	if (packageNames.some((packageName) => names[packageName] === undefined)) {
		try {
			Object.assign(names, await fetchAppNames.call(context));
		} catch (error) {
			context.logger.warn(
				`Google Play Trigger: could not resolve app display names: ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
		}
	}
	return names;
}

async function pollReviews(
	this: IPollFunctions,
	packageNames: string[],
): Promise<INodeExecutionData[][] | null> {
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
	const names = await resolveAppNames(this, multiState, packageNames);

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

async function pollReleases(
	this: IPollFunctions,
	packageNames: string[],
): Promise<INodeExecutionData[][] | null> {
	const emitOn = this.getNodeParameter('emitOn', 'rolloutStarted') as ReleaseEmitMode;

	const manual = this.getMode() === 'manual';
	const multiState = manual
		? ({} as ReleaseTriggerState & { names?: Record<string, string> })
		: (this.getWorkflowStaticData('node') as ReleaseTriggerState & {
				names?: Record<string, string>;
			});
	const appStates = getAppReleaseStates(multiState, packageNames);
	const names = await resolveAppNames(this, multiState, packageNames);

	const toItem = (
		packageName: string,
		release: TrackRelease,
		event: ReleaseEvent,
	): INodeExecutionData => ({
		json: releaseEventPayload(packageName, names[packageName] ?? packageName, release, event),
	});

	const items: INodeExecutionData[] = [];
	let firstFailure: unknown;
	let failureCount = 0;

	for (const packageName of packageNames) {
		try {
			const track = await googlePlayGetProductionTrack.call(this, packageName);
			const candidates = liveReleases(track).map((release) => ({
				key: releaseFingerprint(packageName, release),
				isCompleted: release.status === 'completed',
				data: release,
			}));

			if (manual) {
				items.push(
					...candidates.map((candidate) =>
						toItem(
							packageName,
							candidate.data,
							candidate.isCompleted ? 'rolloutCompleted' : 'rolloutStarted',
						),
					),
				);
				continue;
			}

			// First poll for this app: baseline the track without emitting history
			const previous = appStates[packageName];
			const { toEmit, state } = selectReleaseEvents(candidates, previous ?? {}, emitOn);
			appStates[packageName] = state;
			if (previous === undefined) {
				continue;
			}

			items.push(...toEmit.map(({ event, data }) => toItem(packageName, data, event)));
		} catch (error) {
			// A failing app keeps its previous state and retries on the next poll;
			// the other apps continue unaffected.
			firstFailure ??= error;
			failureCount += 1;
			this.logger.warn(
				`Google Play Trigger: polling releases of "${packageName}" did not complete: ${
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
