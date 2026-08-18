import { createHash } from 'node:crypto';

import type { IDataObject } from 'n8n-workflow';

export interface TrackReleaseNotes {
	language?: string;
	text?: string;
}

export interface TrackRelease {
	name?: string;
	versionCodes?: Array<string | number>;
	status?: string;
	userFraction?: number;
	releaseNotes?: TrackReleaseNotes[];
	inAppUpdatePriority?: number;
}

export interface Track {
	track?: string;
	releases?: TrackRelease[];
}

export type ReleaseEvent = 'rolloutStarted' | 'rolloutCompleted';
export type ReleaseEmitMode = ReleaseEvent | 'both';

export interface ReleaseSeenState {
	startedEmitted: boolean;
	completedEmitted: boolean;
}

export type ReleasePollState = Record<string, ReleaseSeenState>;

export interface ReleaseTriggerState {
	releaseApps?: Record<string, ReleasePollState>;
}

/**
 * Normalizes the trigger's static data into per-app release state slices and
 * drops slices of apps no longer selected. A missing slice means the app has
 * not been polled yet (baseline pending).
 */
export function getAppReleaseStates(
	state: ReleaseTriggerState,
	appKeys: string[],
): Record<string, ReleasePollState> {
	state.releaseApps ??= {};
	for (const key of Object.keys(state.releaseApps)) {
		if (!appKeys.includes(key)) {
			delete state.releaseApps[key];
		}
	}
	return state.releaseApps;
}

/** Releases visible to users: drafts are saved in the console but not rolled out. */
export function liveReleases(track: Track): TrackRelease[] {
	return (track.releases ?? []).filter(
		(release) => release.status !== undefined && release.status !== 'draft',
	);
}

export function releaseVersionCodes(release: TrackRelease): number[] {
	return (release.versionCodes ?? [])
		.map((code) => Number(code))
		.filter((code) => Number.isFinite(code) && code > 0)
		.sort((a, b) => a - b);
}

/**
 * Stable identity of a release for deduplication: the set of version codes it
 * ships. Hashed so the persisted state keys stay uniform and bounded in size.
 */
export function releaseFingerprint(packageName: string, release: TrackRelease): string {
	return createHash('sha256')
		.update(`${packageName}|${releaseVersionCodes(release).join(',')}`)
		.digest('hex');
}

export interface ReleaseCandidate<T> {
	key: string;
	isCompleted: boolean;
	data: T;
}

export interface ReleaseSelection<T> {
	toEmit: Array<{ event: ReleaseEvent; data: T }>;
	state: ReleasePollState;
}

/**
 * Selects which release events to emit and returns the next dedup state.
 *
 * Each release fires `rolloutStarted` at most once (when first observed in the
 * track) and `rolloutCompleted` at most once (when observed at 100%). A release
 * first observed already completed collapses into a single event: `completed`
 * when subscribed to it, `started` otherwise. The returned state only keeps
 * releases still present in the track: version codes are monotonic, so a
 * superseded release can never fire again.
 *
 * Running this against an empty previous state and discarding `toEmit` yields
 * the baseline for the first poll: everything marked as already emitted.
 */
export function selectReleaseEvents<T>(
	candidates: Array<ReleaseCandidate<T>>,
	previousState: ReleasePollState,
	emitMode: ReleaseEmitMode,
): ReleaseSelection<T> {
	const wantStarted = emitMode !== 'rolloutCompleted';
	const wantCompleted = emitMode !== 'rolloutStarted';

	const state: ReleasePollState = {};
	const toEmit: Array<{ event: ReleaseEvent; data: T }> = [];

	for (const candidate of candidates) {
		const previous = previousState[candidate.key];

		if (previous === undefined) {
			if (candidate.isCompleted) {
				if (wantCompleted) {
					toEmit.push({ event: 'rolloutCompleted', data: candidate.data });
				} else if (wantStarted) {
					toEmit.push({ event: 'rolloutStarted', data: candidate.data });
				}
				state[candidate.key] = { startedEmitted: true, completedEmitted: true };
			} else {
				if (wantStarted) {
					toEmit.push({ event: 'rolloutStarted', data: candidate.data });
				}
				state[candidate.key] = { startedEmitted: true, completedEmitted: false };
			}
			continue;
		}

		if (candidate.isCompleted && !previous.completedEmitted) {
			if (wantCompleted) {
				toEmit.push({ event: 'rolloutCompleted', data: candidate.data });
			}
			state[candidate.key] = { startedEmitted: true, completedEmitted: true };
			continue;
		}

		state[candidate.key] = previous;
	}

	return { toEmit, state };
}

export function releaseEventPayload(
	packageName: string,
	appName: string,
	release: TrackRelease,
	event: ReleaseEvent,
): IDataObject {
	const versionCodes = releaseVersionCodes(release);
	const rolloutPercentage =
		release.status === 'completed'
			? 100
			: release.userFraction === undefined
				? undefined
				: Math.round(release.userFraction * 100_000) / 1000;

	return {
		event,
		packageName,
		appName,
		track: 'production',
		releaseName: release.name ?? '',
		status: release.status ?? '',
		versionCodes,
		versionCode: versionCodes.length > 0 ? versionCodes[versionCodes.length - 1] : undefined,
		rolloutPercentage,
		releaseNotes: (release.releaseNotes ?? []).map((note) => ({
			language: note.language ?? '',
			text: note.text ?? '',
		})),
		inAppUpdatePriority: release.inAppUpdatePriority,
	};
}

/** Highest version code rolled out on the track, across all live releases. */
export function pickLatestVersionCode(track: Track): number | undefined {
	const codes = liveReleases(track).flatMap((release) => releaseVersionCodes(release));
	return codes.length === 0 ? undefined : Math.max(...codes);
}

export interface GeneratedApksListResponse {
	/** One entry per app signing key (items are of type GeneratedApksPerSigningKey). */
	generatedApks?: Array<{
		certificateSha256Hash?: string;
		generatedUniversalApk?: { downloadId?: string };
	}>;
}

export interface UniversalApkRef {
	downloadId: string;
	certificateSha256Hash?: string;
}

/**
 * Google returns one entry per app signing key; only bundles processed with
 * Play App Signing get a generated universal APK.
 */
export function pickUniversalApk(response: GeneratedApksListResponse): UniversalApkRef | undefined {
	for (const entry of response.generatedApks ?? []) {
		const downloadId = entry.generatedUniversalApk?.downloadId;
		if (typeof downloadId === 'string' && downloadId !== '') {
			return { downloadId, certificateSha256Hash: entry.certificateSha256Hash };
		}
	}
	return undefined;
}
