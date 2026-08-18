import { assert, describe, it } from 'vitest';

import {
	getAppReleaseStates,
	liveReleases,
	pickLatestVersionCode,
	pickUniversalApk,
	releaseEventPayload,
	releaseFingerprint,
	releaseVersionCodes,
	selectReleaseEvents,
	type ReleaseCandidate,
	type ReleaseTriggerState,
	type Track,
	type TrackRelease,
} from '../nodes/GooglePlay/releases';

const inProgress: TrackRelease = {
	name: '2.1.0',
	versionCodes: ['210'],
	status: 'inProgress',
	userFraction: 0.2,
	releaseNotes: [{ language: 'es-ES', text: 'Mejoras varias' }],
};

const completed: TrackRelease = {
	name: '2.0.0',
	versionCodes: ['200'],
	status: 'completed',
};

function candidate(release: TrackRelease, isCompleted: boolean): ReleaseCandidate<string> {
	return {
		key: releaseFingerprint('com.example.app', release),
		isCompleted,
		data: release.name ?? '',
	};
}

describe('releaseVersionCodes', () => {
	it('normalizes to sorted numbers and drops invalid codes', () => {
		assert.deepEqual(releaseVersionCodes({ versionCodes: ['210', 30, 'nope', '-1'] }), [30, 210]);
		assert.deepEqual(releaseVersionCodes({}), []);
	});
});

describe('releaseFingerprint', () => {
	it('is stable regardless of version code order', () => {
		assert.equal(
			releaseFingerprint('com.example.app', { versionCodes: ['210', '211'] }),
			releaseFingerprint('com.example.app', { versionCodes: [211, 210] }),
		);
	});

	it('changes with the version codes and the package', () => {
		const base = releaseFingerprint('com.example.app', { versionCodes: ['210'] });
		assert.notEqual(base, releaseFingerprint('com.example.app', { versionCodes: ['211'] }));
		assert.notEqual(base, releaseFingerprint('com.other.app', { versionCodes: ['210'] }));
	});
});

describe('liveReleases', () => {
	it('excludes drafts and statusless releases', () => {
		const track: Track = {
			releases: [inProgress, { ...completed, status: 'draft' }, { versionCodes: ['1'] }],
		};
		assert.deepEqual(liveReleases(track), [inProgress]);
	});
});

describe('getAppReleaseStates', () => {
	it('initializes the slice map and prunes unselected apps', () => {
		const state: ReleaseTriggerState = {
			releaseApps: {
				'com.example.app': { abc: { startedEmitted: true, completedEmitted: true } },
				'com.old.app': { def: { startedEmitted: true, completedEmitted: false } },
			},
		};
		const slices = getAppReleaseStates(state, ['com.example.app', 'com.new.app']);
		assert.deepEqual(Object.keys(slices), ['com.example.app']);
		assert.equal(slices['com.new.app'], undefined);
	});
});

describe('selectReleaseEvents', () => {
	it('emits rolloutStarted for a new staged release', () => {
		const { toEmit, state } = selectReleaseEvents([candidate(inProgress, false)], {}, 'both');
		assert.deepEqual(toEmit, [{ event: 'rolloutStarted', data: '2.1.0' }]);
		assert.deepEqual(Object.values(state), [{ startedEmitted: true, completedEmitted: false }]);
	});

	it('collapses a release first seen at 100% into a single event', () => {
		const both = selectReleaseEvents([candidate(completed, true)], {}, 'both');
		assert.deepEqual(both.toEmit, [{ event: 'rolloutCompleted', data: '2.0.0' }]);

		const startedOnly = selectReleaseEvents([candidate(completed, true)], {}, 'rolloutStarted');
		assert.deepEqual(startedOnly.toEmit, [{ event: 'rolloutStarted', data: '2.0.0' }]);
	});

	it('emits rolloutCompleted when a known release reaches 100%', () => {
		const first = selectReleaseEvents([candidate(inProgress, false)], {}, 'rolloutCompleted');
		assert.deepEqual(first.toEmit, []);

		const second = selectReleaseEvents(
			[candidate(inProgress, true)],
			first.state,
			'rolloutCompleted',
		);
		assert.deepEqual(second.toEmit, [{ event: 'rolloutCompleted', data: '2.1.0' }]);
	});

	it('never emits twice for the same release', () => {
		const first = selectReleaseEvents([candidate(inProgress, false)], {}, 'both');
		const second = selectReleaseEvents([candidate(inProgress, false)], first.state, 'both');
		assert.deepEqual(second.toEmit, []);

		const third = selectReleaseEvents([candidate(inProgress, true)], second.state, 'both');
		assert.deepEqual(third.toEmit, [{ event: 'rolloutCompleted', data: '2.1.0' }]);

		const fourth = selectReleaseEvents([candidate(inProgress, true)], third.state, 'both');
		assert.deepEqual(fourth.toEmit, []);
	});

	it('does not emit rolloutStarted in completed-only mode', () => {
		const { toEmit } = selectReleaseEvents([candidate(inProgress, false)], {}, 'rolloutCompleted');
		assert.deepEqual(toEmit, []);
	});

	it('prunes releases that left the track', () => {
		const first = selectReleaseEvents(
			[candidate(completed, true), candidate(inProgress, false)],
			{},
			'both',
		);
		assert.equal(Object.keys(first.state).length, 2);

		const second = selectReleaseEvents([candidate(inProgress, true)], first.state, 'both');
		assert.deepEqual(Object.keys(second.state), [
			releaseFingerprint('com.example.app', inProgress),
		]);
	});

	it('baselines an existing track when run against an empty state', () => {
		const baseline = selectReleaseEvents(
			[candidate(completed, true), candidate(inProgress, false)],
			{},
			'both',
		);
		const next = selectReleaseEvents(
			[candidate(completed, true), candidate(inProgress, true)],
			baseline.state,
			'both',
		);
		assert.deepEqual(next.toEmit, [{ event: 'rolloutCompleted', data: '2.1.0' }]);
	});
});

describe('releaseEventPayload', () => {
	it('exposes release metadata with the rollout percentage', () => {
		assert.deepEqual(
			releaseEventPayload('com.example.app', 'Example App', inProgress, 'rolloutStarted'),
			{
				event: 'rolloutStarted',
				packageName: 'com.example.app',
				appName: 'Example App',
				track: 'production',
				releaseName: '2.1.0',
				status: 'inProgress',
				versionCodes: [210],
				versionCode: 210,
				rolloutPercentage: 20,
				releaseNotes: [{ language: 'es-ES', text: 'Mejoras varias' }],
				inAppUpdatePriority: undefined,
			},
		);
	});

	it('reports 100% and the highest version code for completed releases', () => {
		const payload = releaseEventPayload(
			'com.example.app',
			'Example App',
			{ ...completed, versionCodes: ['201', '200'] },
			'rolloutCompleted',
		);
		assert.equal(payload.rolloutPercentage, 100);
		assert.equal(payload.versionCode, 201);
		assert.deepEqual(payload.versionCodes, [200, 201]);
	});
});

describe('pickLatestVersionCode', () => {
	it('returns the highest live version code', () => {
		const track: Track = {
			releases: [completed, inProgress, { versionCodes: ['999'], status: 'draft' }],
		};
		assert.equal(pickLatestVersionCode(track), 210);
	});

	it('returns undefined for an empty track', () => {
		assert.equal(pickLatestVersionCode({}), undefined);
	});
});

describe('pickUniversalApk', () => {
	it('picks the first signing key with a universal APK', () => {
		assert.deepEqual(
			pickUniversalApk({
				generatedApksPerSigningKey: [
					{ certificateSha256Hash: 'aa' },
					{ certificateSha256Hash: 'bb', generatedUniversalApk: { downloadId: 'dl-1' } },
				],
			}),
			{ downloadId: 'dl-1', certificateSha256Hash: 'bb' },
		);
	});

	it('returns undefined when no universal APK was generated', () => {
		assert.equal(pickUniversalApk({}), undefined);
		assert.equal(
			pickUniversalApk({
				generatedApksPerSigningKey: [{ generatedUniversalApk: { downloadId: '' } }],
			}),
			undefined,
		);
	});
});
