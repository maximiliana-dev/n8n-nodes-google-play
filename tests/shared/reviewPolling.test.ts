import { assert, describe, it } from 'vitest';

import { computeWindowStartMs, selectReviewsToEmit } from '../../nodes/shared/reviewPolling';

const MINUTE = 60_000;

function candidate(id: string, timestampMs: number) {
	return { id, timestampMs, data: id };
}

describe('computeWindowStartMs', () => {
	it('subtracts the margin from the previous poll', () => {
		assert.equal(computeWindowStartMs(100 * MINUTE, 15 * MINUTE), 85 * MINUTE);
	});

	it('ignores negative margins', () => {
		assert.equal(computeWindowStartMs(100 * MINUTE, -5 * MINUTE), 100 * MINUTE);
	});
});

describe('selectReviewsToEmit', () => {
	it('emits unseen reviews inside the window', () => {
		const { toEmit, seen } = selectReviewsToEmit(
			[candidate('a', 90 * MINUTE), candidate('b', 95 * MINUTE)],
			{},
			85 * MINUTE,
			false,
		);
		assert.deepEqual(toEmit, ['a', 'b']);
		assert.deepEqual(seen, { a: 90 * MINUTE, b: 95 * MINUTE });
	});

	it('skips reviews older than the window', () => {
		const { toEmit } = selectReviewsToEmit([candidate('old', 80 * MINUTE)], {}, 85 * MINUTE, false);
		assert.deepEqual(toEmit, []);
	});

	it('deduplicates reviews already seen in the overlap', () => {
		const { toEmit } = selectReviewsToEmit(
			[candidate('a', 90 * MINUTE)],
			{ a: 90 * MINUTE },
			85 * MINUTE,
			false,
		);
		assert.deepEqual(toEmit, []);
	});

	it('ignores edits when includeUpdated is disabled', () => {
		const { toEmit, seen } = selectReviewsToEmit(
			[candidate('a', 95 * MINUTE)],
			{ a: 90 * MINUTE },
			85 * MINUTE,
			false,
		);
		assert.deepEqual(toEmit, []);
		// The newer timestamp is still recorded to avoid re-emitting later
		assert.deepEqual(seen, { a: 95 * MINUTE });
	});

	it('emits edits when includeUpdated is enabled', () => {
		const { toEmit } = selectReviewsToEmit(
			[candidate('a', 95 * MINUTE)],
			{ a: 90 * MINUTE },
			85 * MINUTE,
			true,
		);
		assert.deepEqual(toEmit, ['a']);
	});

	it('prunes seen entries that fell out of the window', () => {
		const { seen } = selectReviewsToEmit(
			[],
			{ stale: 80 * MINUTE, kept: 90 * MINUTE },
			85 * MINUTE,
			false,
		);
		assert.deepEqual(seen, { kept: 90 * MINUTE });
	});

	it('handles the full overlap cycle across two polls', () => {
		// Poll 1: review appears
		const poll1 = selectReviewsToEmit([candidate('r1', 100 * MINUTE)], {}, 95 * MINUTE, false);
		assert.deepEqual(poll1.toEmit, ['r1']);

		// Poll 2: same review still inside the overlap window, plus a new one
		const poll2 = selectReviewsToEmit(
			[candidate('r2', 108 * MINUTE), candidate('r1', 100 * MINUTE)],
			poll1.seen,
			100 * MINUTE,
			false,
		);
		assert.deepEqual(poll2.toEmit, ['r2']);
		assert.deepEqual(poll2.seen, { r1: 100 * MINUTE, r2: 108 * MINUTE });
	});
});
