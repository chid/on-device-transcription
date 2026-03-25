<script lang="ts">
	// Svelte
	import { onMount } from "svelte";

	// Libs
	import WaveSurfer from "wavesurfer.js";
	import RegionsPlugin from "wavesurfer.js/plugins/regions";
	import type { Segment } from "$lib/ratchet/ratchet-web";
	import {
		areSegmentsChronological,
		findSegmentIndexByTime,
		findSegmentIndexByTimeLinear,
	} from "$lib/utils/segments";

	// Props
	export let blobURL: string;
	export let segments: Segment[] = [];

	// Variables
	let waveSurfer: WaveSurfer | null = null;
	let regionPlugin: RegionsPlugin | null = null;
	let container: HTMLDivElement;
	let isAudioPlaying = false;
	let region: any;
	let currentSegmentIndex = -1;
	$: canUseIndexedLookup = areSegmentsChronological(segments);

	function scrollToSegment(index: number) {
		const segmentElement = document.getElementById(`segment-${index}`);
		if (segmentElement) {
			segmentElement.scrollIntoView({ behavior: "smooth", block: "center" });
		}
	}

	onMount(() => {
		waveSurfer = WaveSurfer.create({
			container,
			waveColor: "#000000",
			progressColor: "#7F7F7F",
			barWidth: 2,
			barRadius: 100,
			url: blobURL,
		});
		regionPlugin = waveSurfer.registerPlugin(RegionsPlugin.create());

		waveSurfer.on("timeupdate", scroll);
		waveSurfer.on("play", () => {
			isAudioPlaying = true;
		});
		waveSurfer.on("pause", () => {
			isAudioPlaying = false;
		});
		waveSurfer.on("finish", () => {
			isAudioPlaying = false;
			currentSegmentIndex = -1;
		});

		return () => {
			waveSurfer?.destroy();
		};
	});

	function handleAudioPlayPause() {
		if (!waveSurfer) {
			return;
		}
		if (waveSurfer.isPlaying()) {
			waveSurfer.pause();
			isAudioPlaying = false;
		} else {
			waveSurfer.play();
			isAudioPlaying = true;
		}
	}

	export function playSegment() {
		if (!waveSurfer || !region) return;
		region.play();
	}

	export function selectRegion(segment: Segment) {
		if (!waveSurfer || !regionPlugin) return;
		regionPlugin.clearRegions();
		region = regionPlugin.addRegion({
			start: segment.start,
			end: segment.stop,
			color: "hsla(400, 100%, 30%, 0.1)",
		});
	}

	function scroll() {
		if (!waveSurfer) return;

		const currentTime = waveSurfer.getCurrentTime();
		const nextSegmentIndex = canUseIndexedLookup
			? findSegmentIndexByTime(segments, currentTime)
			: findSegmentIndexByTimeLinear(segments, currentTime);
		if (nextSegmentIndex === -1) {
			currentSegmentIndex = -1;
			return;
		}

		if (nextSegmentIndex !== currentSegmentIndex) {
			currentSegmentIndex = nextSegmentIndex;
			scrollToSegment(nextSegmentIndex);
		}
	}

	export function clearRegions() {
		if (!regionPlugin) return;
		regionPlugin.clearRegions();
		region = null;
	}
</script>

<!-- Main container -->
<div class="flex flex-row justify-center w-full items-center space-x-3 mt-12">
	{#if waveSurfer}
		<button on:click={handleAudioPlayPause}>
			<img src={`images/${isAudioPlaying ? "pause" : "play"}.svg`} alt="Audio button" height="32" width="32" />
		</button>
	{/if}
	<div bind:this={container} class="w-full"></div>
</div>
