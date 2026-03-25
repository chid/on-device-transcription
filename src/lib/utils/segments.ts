export type SegmentLike = {
	start: number;
	stop: number;
};

export function areSegmentsChronological<T extends SegmentLike>(segments: T[]): boolean {
	for (let index = 0; index < segments.length; index++) {
		const segment = segments[index];
		const previousSegment = segments[index - 1];

		if (segment.stop < segment.start) {
			return false;
		}

		if (!previousSegment) {
			continue;
		}

		if (segment.start < previousSegment.start || segment.start < previousSegment.stop) {
			return false;
		}
	}

	return true;
}

export function findSegmentIndexByTimeLinear<T extends SegmentLike>(segments: T[], seconds: number): number {
	return segments.findIndex((segment) => segment.start <= seconds && segment.stop >= seconds);
}

export function findSegmentIndexByTime<T extends SegmentLike>(segments: T[], seconds: number): number {
	let low = 0;
	let high = segments.length - 1;

	while (low <= high) {
		const mid = low + ((high - low) >> 1);
		const segment = segments[mid];

		if (seconds < segment.start) {
			high = mid - 1;
			continue;
		}

		if (seconds > segment.stop) {
			low = mid + 1;
			continue;
		}

		return mid;
	}

	return -1;
}

export function findSegmentByTime<T extends SegmentLike>(segments: T[], seconds: number): T | undefined {
	const index = findSegmentIndexByTimeLinear(segments, seconds);
	return index === -1 ? undefined : segments[index];
}
