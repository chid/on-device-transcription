<script lang="ts">
	// Svelte
	import { onDestroy, onMount } from "svelte";

	// Libs
	import {
		Model,
		DecodingOptionsBuilder,
		default as init,
		Task,
		Quantization,
		type Segment,
	} from "$lib/ratchet/ratchet-web";
	import type { FFmpeg } from "@ffmpeg/ffmpeg";
	import toast from "svelte-french-toast";

	// Components
	import SoundWave from "$lib/components/SoundWave.svelte";
	import FancyLoading from "$lib/components/FancyLoading.svelte";
	import BasicLoading from "$lib/components/BasicLoading.svelte";

	// Variables
	const configOptions = {
		language: null,
		task: Task.Transcribe,
		suppress_non_speech: true,
	};
	let ffmpeg: FFmpeg | null = null;
	let toBlobURL: Function | null = null;
	let model: Model | null = null;
	let audioData: Float32Array | null = null;
	let soundWaveRef: SoundWave | null = null;
	let result: any = null;
	let isffmpegLoaded = false;
	let blobURL = "";
	let currentBlobURL = "";
	let isGenerating = false;
	let segments: Segment[] = [];
	let showSoundWave = false;
	let loadingPercentage = 0;
	let errorOccurred = false;
	const FILE_INPUT_ID_INITIAL = "file-upload-initial";
	const FILE_INPUT_ID_RESULTS = "file-upload-results";
	const FFMPEG_INPUT_PATH = "input";
	const FFMPEG_OUTPUT_PATH = "output.pcm";
	$: isReady = model !== null && ffmpeg !== null && toBlobURL !== null;

	onDestroy(() => {
		if (currentBlobURL) {
			URL.revokeObjectURL(currentBlobURL);
		}
	});

	function setBlobURL(nextBlobURL: string) {
		if (currentBlobURL) {
			URL.revokeObjectURL(currentBlobURL);
		}
		currentBlobURL = nextBlobURL;
		blobURL = nextBlobURL;
	}

	onMount(() => {
		const setupPromise = setup();
		setupPromise.catch((e) => {
			if (e instanceof Error) {
				console.log(`Error: ${e.message}`);
				errorOccurred = true;
			}
		});
		toast.promise(
			setupPromise,
			{
				loading: `Loading model...`,
				success: "Model loaded!",
				error: (e) => `${e.message}`,
			},
			{
				style: "background: #FFFFFF; color: #000000; font-weight: 500;",
			}
		);
	});

	async function setup() {
		if (!navigator.gpu) throw new Error("WebGPU not available.");
		model = await loadModel();
		if (!model) throw new Error("Unable to load the model.");
		loadingPercentage = 100;
		({ ffmpeg, toBlobURL } = await loadFFmpegPkg());
	}

	async function loadModel() {
		await init("pkg/ratchet-web/ratchet-web_bg.wasm");
		const model = await Model.load({ Whisper: "tiny" }, Quantization.F32, (p: number) => {
			loadingPercentage = p;
			console.log(p);
		});
		return model;
	}

	async function loadFFmpegPkg() {
		const ffmpegPkg = await import("@ffmpeg/ffmpeg");
		const ffmpegUtilPkg = await import("@ffmpeg/util");
		const ffmpeg = new ffmpegPkg.FFmpeg();
		const toBlobURL = ffmpegUtilPkg.toBlobURL;
		return { ffmpeg, toBlobURL };
	}

	async function loadFFMPEG() {
		if (!ffmpeg || !toBlobURL) return;
		console.log("Loading ffmpeg...");
		const baseURL = "https://unpkg.com/@ratchet-ml/ffmpeg-core@0.0.12/dist/esm";

		await ffmpeg.load({
			coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
			wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm"),
		});
		console.log("FFMPEG loaded.");
		isffmpegLoaded = true;
	}

	function pcm16ToIntFloat32(pcmData: ArrayBuffer) {
		const int16Array = new Int16Array(pcmData);
		const float32Array = new Float32Array(int16Array.length);
		for (let i = 0; i < int16Array.length; i++) {
			float32Array[i] = int16Array[i] / 32768.0;
		}
		return float32Array;
	}

	async function cleanupFFmpegFiles(paths: string[]) {
		if (!ffmpeg) {
			return;
		}

		await Promise.allSettled(paths.map((path) => ffmpeg?.deleteFile(path)));
	}

	async function transcode(audioData: Uint8Array) {
		if (!ffmpeg) return;
		if (!isffmpegLoaded) {
			await loadFFMPEG();
		}

		const logStore: Array<{ type: string; message: string }> = [];
		const handleLog = ({ type, message }: { type: string; message: string }) => {
			logStore.push({ type, message });
		};
		ffmpeg.on("log", handleLog);

		try {
			await ffmpeg.writeFile(FFMPEG_INPUT_PATH, audioData);

			const cmd = [
				"-nostdin",
				"-threads",
				"0",
				"-i",
				FFMPEG_INPUT_PATH,
				"-f",
				"s16le",
				"-ac",
				"1",
				"-acodec",
				"pcm_s16le",
				"-loglevel",
				"error",
				"-ar",
				"16000",
				FFMPEG_OUTPUT_PATH,
			];

			const execResult = await ffmpeg.exec(cmd);
			if (execResult !== 0) {
				console.log("FFMPEG Error.");
				logStore.forEach((log) => console.error(log));
				return;
			}

			const data = (await ffmpeg.readFile(FFMPEG_OUTPUT_PATH)) as Uint8Array;
			return data.buffer;
		} finally {
			ffmpeg.off("log", handleLog);
			await cleanupFFmpegFiles([FFMPEG_INPUT_PATH, FFMPEG_OUTPUT_PATH]);
		}
	}

	async function runModel() {
		if (!model || !audioData) {
			return;
		}
		segments = [];
		const builder = new DecodingOptionsBuilder();
		const options = builder
			.setLanguage(configOptions.language ? configOptions.language : "en")
			.setTask(configOptions.task)
			.setSuppressBlank(configOptions.suppress_non_speech)
			.build();
		console.log("Options: ", options);
		const callback = (segment: Segment) => {
			if (segment.last) {
				showSoundWave = true;
				return;
			}
			segments = [...segments, segment];
		};
		const results = await model.run({ audio: audioData, decode_options: options, callback });
		return results;
	}

	async function handleAudioFile(event: Event) {
		const target = event.target as HTMLInputElement;
		const file = target.files?.[0];
		if (!file) {
			return;
		}
		setBlobURL("");
		errorOccurred = false;
		result = null;
		segments = [];
		showSoundWave = false;
		isGenerating = true;

		const reader = new FileReader();
		reader.onload = async () => {
			try {
				const audioBytes = new Uint8Array(reader.result as ArrayBuffer);
				const transcoded = await transcode(audioBytes);
				if (!(transcoded instanceof ArrayBuffer)) {
					isGenerating = false;
					return;
				}
				audioData = pcm16ToIntFloat32(transcoded);
				setBlobURL(URL.createObjectURL(file));
				result = await runModel();
			} catch (e) {
				if (e instanceof Error) {
					console.log(`Error: ${e.message}`);
					toast.error("Error", {
						style: "background: #FFFFFF; color: #000000; font-weight: 500;",
						duration: 10000,
					});
					errorOccurred = true;
				}
			} finally {
				isGenerating = false;
				target.value = "";
			}
		};
		reader.readAsArrayBuffer(file);
	}

	function handleSegmentHover(segment: Segment) {
		soundWaveRef?.selectRegion(segment);
	}

	function handleSegmentLeave() {
		soundWaveRef?.clearRegions();
	}

	function handlePlaySegment() {
		soundWaveRef?.playSegment();
	}

	function handleDownload() {
		if (!result) return;
		const toRemove: keyof Segment = "last";
		const segmentsCleaned = segments.map(({ [toRemove]: _, ...rest }) => rest);
		const data = JSON.stringify(segmentsCleaned, null, 4);
		const blob = new Blob([data], { type: "application/json" });
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = `transcription_${Date.now()}.json`;
		a.click();
		URL.revokeObjectURL(url);
	}
</script>

<!-- Main container -->
<div class="flex flex-col justify-start items-center">
	<!-- Title bar (Electron) -->
	<div class="titleBar flex absolute top-0"></div>

	<!--- Title container -->
	<div class="mt-12 space-x-2 flex flex-row justify-center items-end">
		<img src="images/ratchet.png" alt="Ratchet logo" class="h-12" />
		<img src="images/whisper.svg" alt="Whisper logo" class="h-8" />
	</div>

	<!-- Content container -->
	<div class="w-[500px] h-full flex flex-col items-center justify-start">
		<!-- Audio player -->
		{#if blobURL && showSoundWave}
			<SoundWave bind:this={soundWaveRef} {blobURL} {segments}/> 
		{/if}

		{#if errorOccurred}
			<p class="mt-64">Error :/</p>
		{:else if isReady}
			<!-- Content container -->
			{#if !isGenerating && !result}
				<!-- Import section -->
				<div class="flex flex-col justify-center items-center w-full mt-64 space-y-8">
					<p class="text-xl text-center">Upload an audio file to get the transcript.</p>
					<div class="rounded-3xl p-[2px] bg-gradient-to-r from-[#985D86] to-[#A9B540]">
						<!-- Input -->
						<div class="bg-white rounded-[22px]">
							<input
								on:change={handleAudioFile}
								id={FILE_INPUT_ID_INITIAL}
								type="file"
								aria-hidden="true"
								accept=".wav,.aac,.m4a,.mp4,.mp3"
								class="hidden"
								disabled={!isReady}
							/>
							<label
								for={FILE_INPUT_ID_INITIAL}
								class="flex {isReady
									? 'cursor-pointer'
									: 'cursor-not-allowed'} flex-row items-center justify-center space-x-1 px-5 py-1"
							>
								<p class="font-[500] text-lg">Upload</p>
								<img src="images/upload.svg" alt="Import icon" height="24" width="24" />
							</label>
						</div>
					</div>
				</div>
			{:else if isGenerating}
				<FancyLoading />
			{:else}
				<!-- Results -->
				<div class="relative w-full flex flex-col mt-8">
					<!-- Shadow top -->
					<div
						class="absolute top-0 left-0 w-full bg-gradient-to-b from-white to-transparent h-12 pointer-events-none"
					></div>
					<!-- Result segments -->
					<div class="flex flex-col items-center space-y-3 h-[400px] overflow-y-scroll w-full overflow-x-hidden py-12">
						{#each segments as segment, i}
							<button
                                id={`segment-${i}`}
								class="w-full flex justify-center items-center"
								on:mouseover={() => {
									handleSegmentHover(segment);
								}}
								on:mouseleave={handleSegmentLeave}
								on:click={handlePlaySegment}
								on:focus={() => {}}
							>
								<p class="text-2xl text-center">{segment.text}</p>
							</button>
						{/each}
					</div>
					<!-- Shadow bottom -->
					<div
						class="absolute bottom-0 left-0 w-full bg-gradient-to-b from-transparent to-white h-12 pointer-events-none"
					></div>
				</div>
				<!-- Action buttons -->
				<div class="flex flex-row justify-center items-center mt-16">
					<button
						on:click={handleDownload}
						class="font-[500] text-lg flex flex-row justify-center items-center space-x-1 px-5 py-1"
					>
						<p>Download</p>
						<img src="images/textFile.svg" alt="Download icon" height="24" width="24" />
					</button>
					<div>
						<input
							on:change={handleAudioFile}
							id={FILE_INPUT_ID_RESULTS}
							type="file"
							aria-hidden="true"
							accept=".wav,.aac,.m4a,.mp4,.mp3"
							class="hidden"
							disabled={!isReady}
						/>
						<label
							for={FILE_INPUT_ID_RESULTS}
							class="flex {isReady
								? 'cursor-pointer'
								: 'cursor-not-allowed'} flex-row items-center justify-center space-x-1 px-5 py-1"
						>
							<p class="font-[500] text-lg">Upload</p>
							<img src="images/upload.svg" alt="Upload icon" height="24" width="24" />
						</label>
					</div>
				</div>
			{/if}
		{:else}
			<BasicLoading percentage={loadingPercentage} />
		{/if}
	</div>

	<!-- Credits -->
	<div class="absolute bottom-6 flex flex-col items-center space-y-1 justify-center text-sm text-gray-500">
		<p>
			<a href="https://github.com/huggingface/ratchet" target="_blank" class="underline">Ratchet</a> is a toolkit to run
			models on-device made by
			<a href="https://fleetwood.dev/" target="_blank" class="underline">Christopher Fleetwood.</a>
		</p>
		<p>Built by <a href="https://www.hugoduprez.com/" target="_blank" class="underline">Hugo Duprez</a></p>
	</div>
</div>

<style>
	.titleBar {
		-webkit-app-select: none;
		-webkit-app-region: drag;
		background-color: #ffffff;
		width: 100%;
		height: 32px;
	}

	::-webkit-scrollbar {
		width: 0px;
	}

	/* Track */
	::-webkit-scrollbar-track {
		background: transparent;
		border: solid 3px transparent;
		box-sizing: border-box;
	}

	/* Handle */
	::-webkit-scrollbar-thumb {
		background: #a8a8a8;
		border-radius: 100px;
	}

	/* Handle on hover */
	::-webkit-scrollbar-thumb:hover {
		background: #303850;
	}
</style>
