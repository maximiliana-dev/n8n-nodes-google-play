export interface ReviewPollState {
	lastPollMs?: number;
	seen?: Record<string, number>;
}

export interface ReviewCandidate<T> {
	id: string;
	timestampMs: number;
	data: T;
}

export interface ReviewSelection<T> {
	toEmit: T[];
	seen: Record<string, number>;
}

/**
 * The poll window starts a configurable margin before the previous poll, so
 * reviews the store APIs surface with a delay are not missed. Overlap between
 * consecutive windows is deduplicated through the `seen` map.
 */
export function computeWindowStartMs(lastPollMs: number, marginMs: number): number {
	return lastPollMs - Math.max(0, marginMs);
}

/**
 * Selects which polled reviews to emit and returns the next `seen` map.
 *
 * A review is emitted when it falls inside the window and either its ID was
 * never seen, or it was seen with an older timestamp and `includeUpdated` is
 * enabled. The returned map only keeps entries still inside the window: older
 * entries can no longer produce duplicates and would grow unbounded.
 */
export function selectReviewsToEmit<T>(
	candidates: Array<ReviewCandidate<T>>,
	previousSeen: Record<string, number>,
	windowStartMs: number,
	includeUpdated: boolean,
): ReviewSelection<T> {
	const seen: Record<string, number> = {};
	for (const [id, timestampMs] of Object.entries(previousSeen)) {
		if (timestampMs >= windowStartMs) {
			seen[id] = timestampMs;
		}
	}

	const toEmit: T[] = [];
	for (const candidate of candidates) {
		if (candidate.timestampMs < windowStartMs) {
			continue;
		}
		const seenTimestampMs = seen[candidate.id];
		const isNew = seenTimestampMs === undefined;
		const isUpdated = seenTimestampMs !== undefined && candidate.timestampMs > seenTimestampMs;

		if (isNew || (isUpdated && includeUpdated)) {
			toEmit.push(candidate.data);
		}
		seen[candidate.id] = Math.max(candidate.timestampMs, seenTimestampMs ?? 0);
	}

	return { toEmit, seen };
}
