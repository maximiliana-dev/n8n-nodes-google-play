import { sleep } from 'n8n-workflow';

const TRANSIENT_NETWORK_CODES = new Set([
	'ECONNABORTED',
	'ECONNREFUSED',
	'ECONNRESET',
	'EAI_AGAIN',
	'EHOSTUNREACH',
	'ENETUNREACH',
	'ENOTFOUND',
	'EPIPE',
	'ESOCKETTIMEDOUT',
	'ETIMEDOUT',
	'UND_ERR_CONNECT_TIMEOUT',
	'UND_ERR_SOCKET',
]);

const TRANSIENT_HTTP_STATUSES = new Set(['408', '429', '500', '502', '503', '504']);

const MAX_CAUSE_DEPTH = 5;

export const DEFAULT_RETRY_DELAYS_MS = [2_000, 5_000, 10_000];

/**
 * Consecutive polls that may fail only with transient errors before the
 * trigger surfaces the failure. With one-minute polling this tolerates short
 * outages while still reporting sustained ones.
 */
export const MAX_TOLERATED_TRANSIENT_POLL_FAILURES = 10;

function isTransientCode(value: unknown): boolean {
	if (typeof value !== 'string' && typeof value !== 'number') {
		return false;
	}
	const code = String(value).toUpperCase();
	return TRANSIENT_NETWORK_CODES.has(code) || TRANSIENT_HTTP_STATUSES.has(code);
}

/**
 * Whether a request failure is worth retrying: network-level failures and
 * the HTTP statuses that signal a temporary condition (timeouts, throttling,
 * server-side hiccups). Walks the `cause` chain, since n8n wraps the original
 * transport error in a NodeApiError.
 */
export function isTransientError(error: unknown): boolean {
	let current: unknown = error;
	for (
		let depth = 0;
		depth < MAX_CAUSE_DEPTH && typeof current === 'object' && current !== null;
		depth++
	) {
		const candidate = current as {
			code?: unknown;
			httpCode?: unknown;
			status?: unknown;
			statusCode?: unknown;
			response?: { status?: unknown; statusCode?: unknown };
			cause?: unknown;
		};
		const codes = [
			candidate.code,
			candidate.httpCode,
			candidate.status,
			candidate.statusCode,
			candidate.response?.status,
			candidate.response?.statusCode,
		];
		if (codes.some(isTransientCode)) {
			return true;
		}
		current = candidate.cause;
	}
	return false;
}

export interface RetryOptions {
	delaysMs?: readonly number[];
	wait?: (ms: number) => Promise<void>;
}

/**
 * Runs `operation`, retrying it after each delay while it fails with a
 * transient error. The final failure is thrown through `toError`, so callers
 * surface it as a typed n8n error. Only use it for requests that are safe to
 * repeat.
 */
export async function withTransientRetry<T>(
	operation: () => Promise<T>,
	toError: (error: unknown) => Error,
	{ delaysMs = DEFAULT_RETRY_DELAYS_MS, wait = sleep }: RetryOptions = {},
): Promise<T> {
	for (let attempt = 0; ; attempt++) {
		try {
			return await operation();
		} catch (error) {
			if (attempt >= delaysMs.length || !isTransientError(error)) {
				throw toError(error);
			}
			await wait(delaysMs[attempt]);
		}
	}
}

export interface TransientFailureState {
	consecutiveTransientFailures?: number;
}

/**
 * Decides whether a poll where every app failed should surface its error.
 * Transient failures are absorbed until they persist for
 * MAX_TOLERATED_TRANSIENT_POLL_FAILURES consecutive polls; any other failure
 * surfaces immediately. Mutates the counter kept in the polling state.
 */
export function shouldSurfacePollFailure(state: TransientFailureState, error: unknown): boolean {
	if (!isTransientError(error)) {
		delete state.consecutiveTransientFailures;
		return true;
	}
	const failures = (state.consecutiveTransientFailures ?? 0) + 1;
	if (failures >= MAX_TOLERATED_TRANSIENT_POLL_FAILURES) {
		delete state.consecutiveTransientFailures;
		return true;
	}
	state.consecutiveTransientFailures = failures;
	return false;
}

export function resetPollFailures(state: TransientFailureState): void {
	delete state.consecutiveTransientFailures;
}
