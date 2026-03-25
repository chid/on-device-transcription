import { performance } from "node:perf_hooks";

import {
	findSegmentIndexByTime,
	findSegmentIndexByTimeLinear,
	type SegmentLike,
} from "../src/lib/utils/segments.ts";

function buildSegments(count: number): SegmentLike[] {
	return Array.from({ length: count }, (_, index) => {
		const start = index * 1.5;
		return {
			start,
			stop: start + 1,
		};
	});
}

function buildQueries(segments: SegmentLike[], queryCount: number): number[] {
	const maxTime = segments[segments.length - 1]?.stop ?? 0;

	return Array.from({ length: queryCount }, (_, index) => {
		const ratio = (index * 0.61803398875) % 1;
		return ratio * maxTime;
	});
}

function benchmark(
	label: string,
	lookup: (segments: SegmentLike[], seconds: number) => number,
	segments: SegmentLike[],
	queries: number[],
	iterations: number
) {
	let checksum = 0;
	const start = performance.now();

	for (let iteration = 0; iteration < iterations; iteration++) {
		for (const query of queries) {
			checksum += lookup(segments, query);
		}
	}

	const durationMs = performance.now() - start;
	return { label, durationMs, checksum };
}

function runSuite(segmentCount: number, queryCount: number, iterations: number) {
	const segments = buildSegments(segmentCount);
	const queries = buildQueries(segments, queryCount);

	const linear = benchmark("linear", findSegmentIndexByTimeLinear, segments, queries, iterations);
	const binary = benchmark("binary", findSegmentIndexByTime, segments, queries, iterations);
	const speedup = linear.durationMs / binary.durationMs;

	console.log(
		[
			`segments=${segmentCount}`,
			`queries=${queryCount}`,
			`iterations=${iterations}`,
			`${linear.label}=${linear.durationMs.toFixed(2)}ms`,
			`${binary.label}=${binary.durationMs.toFixed(2)}ms`,
			`speedup=${speedup.toFixed(2)}x`,
			`checksums-match=${linear.checksum === binary.checksum}`,
		].join(" ")
	);
}

console.log("Segment lookup benchmark");
runSuite(500, 2_000, 50);
runSuite(5_000, 2_000, 50);
runSuite(50_000, 2_000, 50);
