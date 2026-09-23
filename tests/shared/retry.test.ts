import { NodeApiError, type INode, type JsonObject } from 'n8n-workflow';
import { assert, describe, it } from 'vitest';

import { toSanitizedApiError, type RequestContext } from '../../nodes/shared/errors';
import {
	DEFAULT_RETRY_DELAYS_MS,
	isTransientError,
	MAX_TOLERATED_TRANSIENT_POLL_FAILURES,
	resetPollFailures,
	shouldSurfacePollFailure,
	withTransientRetry,
	type TransientFailureState,
} from '../../nodes/shared/retry';

const node: INode = {
	id: 'node',
	name: 'Node',
	type: 'test',
	typeVersion: 1,
	position: [0, 0],
	parameters: {},
};
const context = { getNode: () => node } as unknown as RequestContext;

function networkError(code: string): Error {
	return Object.assign(new Error(`connect ${code}`), { code, isAxiosError: true });
}

function httpError(status: number): Error {
	return Object.assign(new Error(`Request failed with status code ${status}`), {
		response: { status, data: { error: { message: 'boom' } } },
	});
}

function wrappedByN8n(error: Error): NodeApiError {
	return new NodeApiError(node, error as unknown as JsonObject);
}

function sanitized(error: unknown): NodeApiError {
	return toSanitizedApiError(context, error, () => undefined, 'Store');
}

const noWait = async () => {};

describe('isTransientError', () => {
	it('detects network failures, raw and wrapped by n8n', () => {
		for (const code of ['ECONNABORTED', 'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN']) {
			assert.isTrue(isTransientError(networkError(code)), code);
			assert.isTrue(isTransientError(wrappedByN8n(networkError(code))), `wrapped ${code}`);
		}
	});

	it('still detects network failures after sanitizing', () => {
		assert.isTrue(isTransientError(sanitized(wrappedByN8n(networkError('ECONNABORTED')))));
	});

	it('detects throttling and server-side statuses', () => {
		for (const status of [408, 429, 500, 502, 503, 504]) {
			assert.isTrue(isTransientError(httpError(status)), String(status));
			assert.isTrue(isTransientError(sanitized(wrappedByN8n(httpError(status)))), `s${status}`);
		}
	});

	it('rejects client errors and plain errors', () => {
		for (const status of [400, 401, 403, 404]) {
			assert.isFalse(isTransientError(httpError(status)), String(status));
			assert.isFalse(isTransientError(sanitized(wrappedByN8n(httpError(status)))), `s${status}`);
		}
		assert.isFalse(isTransientError(new Error('nope')));
		assert.isFalse(isTransientError(undefined));
	});
});

describe('withTransientRetry', () => {
	it('retries transient failures until the operation succeeds', async () => {
		let calls = 0;
		const waits: number[] = [];
		const result = await withTransientRetry(
			async () => {
				calls++;
				if (calls < 3) throw networkError('ECONNRESET');
				return 'ok';
			},
			(error) => error as Error,
			{ wait: async (ms) => void waits.push(ms) },
		);
		assert.equal(result, 'ok');
		assert.equal(calls, 3);
		assert.deepEqual(waits, DEFAULT_RETRY_DELAYS_MS.slice(0, 2));
	});

	it('gives up after the last delay and maps the error', async () => {
		let calls = 0;
		const error = await withTransientRetry(
			async () => {
				calls++;
				throw networkError('ECONNABORTED');
			},
			() => new Error('mapped'),
			{ wait: noWait },
		).catch((e: unknown) => e as Error);
		assert.equal(error.message, 'mapped');
		assert.equal(calls, DEFAULT_RETRY_DELAYS_MS.length + 1);
	});

	it('does not retry non-transient failures', async () => {
		let calls = 0;
		await withTransientRetry(
			async () => {
				calls++;
				throw httpError(403);
			},
			(e) => e as Error,
			{ wait: noWait },
		).catch(() => undefined);
		assert.equal(calls, 1);
	});

	it('does not retry when no delays are given', async () => {
		let calls = 0;
		await withTransientRetry(
			async () => {
				calls++;
				throw networkError('ECONNRESET');
			},
			(e) => e as Error,
			{ delaysMs: [], wait: noWait },
		).catch(() => undefined);
		assert.equal(calls, 1);
	});
});

describe('shouldSurfacePollFailure', () => {
	it('absorbs transient failures until the threshold', () => {
		const state: TransientFailureState = {};
		for (let i = 1; i < MAX_TOLERATED_TRANSIENT_POLL_FAILURES; i++) {
			assert.isFalse(shouldSurfacePollFailure(state, networkError('ECONNRESET')));
			assert.equal(state.consecutiveTransientFailures, i);
		}
		assert.isTrue(shouldSurfacePollFailure(state, networkError('ECONNRESET')));
		assert.isUndefined(state.consecutiveTransientFailures);
	});

	it('surfaces non-transient failures immediately', () => {
		const state: TransientFailureState = { consecutiveTransientFailures: 3 };
		assert.isTrue(shouldSurfacePollFailure(state, httpError(401)));
		assert.isUndefined(state.consecutiveTransientFailures);
	});

	it('restarts counting after a successful poll', () => {
		const state: TransientFailureState = { consecutiveTransientFailures: 7 };
		resetPollFailures(state);
		assert.isUndefined(state.consecutiveTransientFailures);
	});
});
