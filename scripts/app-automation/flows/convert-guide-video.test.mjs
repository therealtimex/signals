import assert from "node:assert/strict";
import test from "node:test";
import {
  CONVERT_GUIDE_VIDEO_FLOW_NAME,
  DEFAULT_CRF,
  INSTALL_HINT,
  assertUsableOutput,
  createHelpText,
  discoverSources,
  ffmpegArgs,
  ffmpegAvailable,
  ffprobeArgs,
  DEFAULT_MUSIC_GAIN,
  DEFAULT_MUSIC_PATH,
  musicFilter,
  outputFileName,
  parseArgs,
  partialPath,
  resolveFfprobe,
  probeSummary,
  runConvertGuideVideoFlow,
  selectSources,
} from "./convert-guide-video.mjs";
import { join } from "node:path";
import { DEFAULT_VIDEO_DIR, GUIDE_JOURNEYS, videoFileName } from "./record-guide-tour.mjs";

const OK_PROBE = JSON.stringify({
  streams: [
    { codec_type: "video", codec_name: "h264", width: 1440, height: 900, pix_fmt: "yuv420p" },
    { codec_type: "audio", codec_name: "aac" },
  ],
  format: { duration: "41.06" },
});

/** A run() double that answers -version, ffmpeg and ffprobe, recording each call. */
function fakeRun({ probe = OK_PROBE, failOn = null } = {}) {
  const calls = [];
  const run = async (binary, args) => {
    calls.push({ binary, args });
    if (failOn && args.some((a) => typeof a === "string" && a.includes(failOn))) {
      throw new Error(`ffmpeg exploded on ${failOn}`);
    }
    if (binary === "ffprobe") return { stdout: probe, stderr: "" };
    return { stdout: "", stderr: "" };
  };
  return { run, calls };
}

function flowDeps(overrides = {}) {
  const { run } = fakeRun();
  return {
    run,
    listSources: () => ["product-tour.webm"],
    ensureDir: () => {},
    sizeOf: () => 2_000_000,
    move: () => {},
    discard: () => {},
    fileExists: () => false,
    ...overrides,
  };
}

test("output name swaps the container, keeping the journey id", () => {
  assert.equal(outputFileName("product-tour.webm"), "product-tour.mp4");
  assert.equal(outputFileName("contact-deep-dive.webm"), "contact-deep-dive.mp4");
});

test("every recorded journey converts to a predictable mp4 name", () => {
  for (const journey of GUIDE_JOURNEYS) {
    assert.equal(outputFileName(videoFileName(journey.id)), `${journey.id}.mp4`);
  }
});

test("discovery picks up webm only, and ignores mp4 it already produced", () => {
  const readdir = () => ["b.webm", "a.webm", "a.mp4", "notes.md", ".DS_Store"];
  assert.deepEqual(discoverSources("guide/video", { readdir }), ["a.webm", "b.webm"]);
});

test("discovery is case-insensitive on the extension", () => {
  const readdir = () => ["Tour.WEBM"];
  assert.deepEqual(discoverSources("guide/video", { readdir }), ["Tour.WEBM"]);
});

test("no --only converts everything found", () => {
  const sources = ["a.webm", "b.webm"];
  assert.deepEqual(selectSources([], sources), sources);
});

test("--only selects by journey id", () => {
  assert.deepEqual(selectSources(["b"], ["a.webm", "b.webm"]), ["b.webm"]);
});

test("--only with an unrecorded id is an error, not a silent empty run", () => {
  assert.throws(
    () => selectSources(["nope"], ["product-tour.webm"]),
    /No recording for: nope[\s\S]*product-tour/,
  );
});

test("encode pins the settings that decide whether an upload is accepted", () => {
  const args = ffmpegArgs({ input: "in.webm", output: "out.mp4" });
  const pairs = (flag) => args[args.indexOf(flag) + 1];
  assert.equal(pairs("-c:v"), "libx264");
  // Without these two an mp4 is produced that Safari/QuickTime refuse or that
  // must download fully before the first frame.
  assert.equal(pairs("-pix_fmt"), "yuv420p");
  assert.equal(pairs("-movflags"), "+faststart");
  assert.equal(pairs("-crf"), String(DEFAULT_CRF));
  assert.equal(args.at(-1), "out.mp4");
});

test("encode forces even dimensions so an odd viewport cannot fail the encode", () => {
  const args = ffmpegArgs({ input: "in.webm", output: "out.mp4" });
  assert.match(args[args.indexOf("-vf") + 1], /trunc\(iw\/2\)\*2:trunc\(ih\/2\)\*2/);
});

test("a silent aac track is added by default, and --no-silent-audio drops it", () => {
  const withAudio = ffmpegArgs({ input: "in.webm", output: "out.mp4" });
  assert.ok(withAudio.includes("anullsrc=channel_layout=stereo:sample_rate=44100"));
  assert.equal(withAudio[withAudio.indexOf("-c:a") + 1], "aac");
  // -shortest matters: without it the infinite silent source never ends.
  assert.ok(withAudio.includes("-shortest"));

  const silent = ffmpegArgs({ input: "in.webm", output: "out.mp4", silentAudio: false });
  assert.ok(silent.includes("-an"));
  assert.ok(!silent.includes("-c:a"));
});

test("crf and preset are overridable", () => {
  const args = ffmpegArgs({ input: "i", output: "o", crf: 28, preset: "veryfast" });
  assert.equal(args[args.indexOf("-crf") + 1], "28");
  assert.equal(args[args.indexOf("-preset") + 1], "veryfast");
});

test("probe reads codec, geometry and duration out of ffprobe json", () => {
  assert.deepEqual(probeSummary(OK_PROBE), {
    codec: "h264",
    width: 1440,
    height: 900,
    pixelFormat: "yuv420p",
    audioCodec: "aac",
    durationSec: 41.06,
  });
});

test("probe survives a file ffprobe could not read", () => {
  assert.deepEqual(probeSummary("{}"), {
    codec: null,
    width: null,
    height: null,
    pixelFormat: null,
    audioCodec: null,
    durationSec: 0,
  });
});

test("ffprobe is asked for every stream, so the audio can be checked too", () => {
  // It used to select v:0 only; the audio is the half that can silently vanish
  // when a filter graph is wrong.
  const args = ffprobeArgs("out.mp4");
  assert.ok(!args.includes("-select_streams"));
  assert.match(args[args.indexOf("-show_entries") + 1], /codec_type/);
  assert.equal(args.at(-1), "out.mp4");
});

test("a zero-duration output is a failure, not a success", () => {
  assert.throws(
    () => assertUsableOutput({ codec: "h264", pixelFormat: "yuv420p", durationSec: 0 }),
    /no duration/,
  );
});

test("an output that is not h264 or not yuv420p is a failure", () => {
  assert.throws(
    () => assertUsableOutput({ codec: "vp8", pixelFormat: "yuv420p", durationSec: 5 }),
    /expected an h264 stream/,
  );
  assert.throws(
    () => assertUsableOutput({ codec: "h264", pixelFormat: "yuv444p", durationSec: 5 }),
    /players will refuse this/,
  );
});

test("a good output passes the check", () => {
  assert.doesNotThrow(() =>
    assertUsableOutput({ codec: "h264", pixelFormat: "yuv420p", durationSec: 41 }),
  );
});

test("args default to the recorder's own output directory", () => {
  assert.equal(parseArgs([]).videoDir, DEFAULT_VIDEO_DIR);
  assert.equal(parseArgs([]).silentAudio, true);
  assert.equal(parseArgs([]).ffmpeg, "ffmpeg");
});

test("SIGNALS_FFMPEG points at a binary off PATH", () => {
  assert.equal(parseArgs([], { SIGNALS_FFMPEG: "/opt/x/ffmpeg" }).ffmpeg, "/opt/x/ffmpeg");
});

test("args parse in both --flag value and --flag=value form", () => {
  assert.deepEqual(parseArgs(["--only", "a,b"]).only, ["a", "b"]);
  assert.deepEqual(parseArgs(["--only=a,b"]).only, ["a", "b"]);
  assert.equal(parseArgs(["--crf=18"]).crf, 18);
  assert.equal(parseArgs(["--video-dir", "tmp/v"]).videoDir, "tmp/v");
});

test("an out-of-range crf is rejected at parse time", () => {
  assert.throws(() => parseArgs(["--crf", "60"]), /--crf must be an integer/);
  assert.throws(() => parseArgs(["--crf", "x"]), /--crf must be an integer/);
});

test("an unknown option is an error rather than being ignored", () => {
  assert.throws(() => parseArgs(["--fps", "30"]), /Unknown option: --fps/);
});

test("help names the flow and the ffmpeg requirement", () => {
  const help = createHelpText();
  assert.match(help, new RegExp(CONVERT_GUIDE_VIDEO_FLOW_NAME));
  assert.match(help, /Requires ffmpeg; recording tours does not/);
  assert.match(help, /--no-silent-audio/);
});

test("missing ffmpeg is a named failure that says how to install it", async () => {
  const result = await runConvertGuideVideoFlow(parseArgs([]), {
    ...flowDeps(),
    run: async () => {
      throw Object.assign(new Error("spawn ffmpeg ENOENT"), { code: "ENOENT" });
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "ffmpeg_missing");
  assert.ok(result.message.endsWith(INSTALL_HINT), result.message);
  assert.match(result.message, /^ffmpeg is not runnable/);
  assert.match(result.message, /brew install ffmpeg/);
  // The point of keeping ffmpeg optional: this must not read as "recording broke".
  assert.match(result.message, /Recording tours does not need ffmpeg/);
});

test("ffmpegAvailable reports true when the binary answers -version", async () => {
  const { run, calls } = fakeRun();
  assert.equal(await ffmpegAvailable("ffmpeg", { run }), true);
  assert.deepEqual(calls[0], { binary: "ffmpeg", args: ["-version"] });
});

test("an empty video directory is a failure that points at the recorder", async () => {
  const result = await runConvertGuideVideoFlow(parseArgs([]), {
    ...flowDeps({ listSources: () => [] }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "no_recordings");
  assert.match(result.message, /automation:record-guide-tour/);
});

test("a successful run converts, probes, and reports geometry", async () => {
  const { run, calls } = fakeRun();
  const result = await runConvertGuideVideoFlow(parseArgs([]), { ...flowDeps({ run }) });
  assert.equal(result.ok, true);
  assert.equal(result.code, "converted");
  assert.equal(result.converted.length, 1);
  assert.deepEqual(result.converted[0], {
    source: "product-tour.webm",
    path: `${DEFAULT_VIDEO_DIR}/product-tour.mp4`,
    bytes: 2_000_000,
    music: null,
    codec: "h264",
    width: 1440,
    height: 900,
    pixelFormat: "yuv420p",
    audioCodec: "aac",
    durationSec: 41.06,
  });
  // Probed, not assumed: exit 0 alone is not evidence the file plays.
  assert.ok(calls.some((call) => call.binary === "ffprobe"));
});

test("a file that encodes to nothing is reported as a failure", async () => {
  const { run } = fakeRun({
    probe: JSON.stringify({ streams: [{ codec_type: "video", codec_name: "h264", pix_fmt: "yuv420p" }], format: { duration: "0" } }),
  });
  const result = await runConvertGuideVideoFlow(parseArgs([]), { ...flowDeps({ run }) });
  assert.equal(result.ok, false);
  assert.equal(result.code, "partial");
  assert.match(result.failures[0].error, /no duration/);
});

test("one bad recording does not abandon the others", async () => {
  const { run } = fakeRun({ failOn: "bad.webm" });
  const result = await runConvertGuideVideoFlow(parseArgs([]), {
    ...flowDeps({ run, listSources: () => ["bad.webm", "good.webm"] }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.converted.length, 1);
  assert.equal(result.converted[0].source, "good.webm");
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].source, "bad.webm");
});

test("--only for an unrecorded journey fails before ffmpeg is invoked", async () => {
  const { run, calls } = fakeRun();
  const result = await runConvertGuideVideoFlow(parseArgs(["--only", "ghost"]), {
    ...flowDeps({ run }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "no_such_recording");
  assert.equal(calls.filter((call) => call.args.includes("-c:v")).length, 0);
});

test("a missing video directory is an empty set, not an ENOENT", () => {
  // guide/video is gitignored, so on a fresh checkout it does not exist at all.
  const readdir = () => {
    throw Object.assign(new Error("ENOENT: no such file or directory, scandir"), { code: "ENOENT" });
  };
  assert.deepEqual(discoverSources("guide/video", { readdir }), []);
});

test("a directory that fails for any other reason still throws", () => {
  const readdir = () => {
    throw Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
  };
  assert.throws(() => discoverSources("guide/video", { readdir }), /EACCES/);
});

test("a fresh checkout is told to record, not shown a scandir error", async () => {
  const result = await runConvertGuideVideoFlow(parseArgs([]), {
    ...flowDeps({
      listSources: (dir) => discoverSources(dir, {
        readdir: () => {
          throw Object.assign(new Error("ENOENT: scandir"), { code: "ENOENT" });
        },
      }),
    }),
  });
  assert.equal(result.code, "no_recordings");
  assert.match(result.message, /automation:record-guide-tour/);
  assert.doesNotMatch(result.message, /ENOENT|scandir/);
});

test("ffprobe is resolved beside ffmpeg, so SIGNALS_FFMPEG off PATH works", () => {
  assert.equal(resolveFfprobe("ffmpeg", {}), "ffprobe");
  assert.equal(resolveFfprobe("/opt/x/bin/ffmpeg", {}), "/opt/x/bin/ffprobe");
  assert.equal(resolveFfprobe("/opt/x/bin/ffmpeg", { SIGNALS_FFPROBE: "/usr/bin/ffprobe" }), "/usr/bin/ffprobe");
});

test("parseArgs carries the resolved ffprobe alongside ffmpeg", () => {
  const args = parseArgs([], { SIGNALS_FFMPEG: "/opt/x/bin/ffmpeg" });
  assert.equal(args.ffmpeg, "/opt/x/bin/ffmpeg");
  assert.equal(args.ffprobe, "/opt/x/bin/ffprobe");
});

test("the flow probes with the resolved ffprobe, not the literal name", async () => {
  const { run, calls } = fakeRun();
  const args = parseArgs([], { SIGNALS_FFMPEG: "/opt/x/bin/ffmpeg" });
  // fakeRun answers -version for anything, and the probe branch keys on binary.
  const probing = async (binary, argv) => {
    calls.push({ binary, args: argv });
    if (argv.includes("-show_entries")) return { stdout: OK_PROBE, stderr: "" };
    return { stdout: "", stderr: "" };
  };
  const result = await runConvertGuideVideoFlow(args, { ...flowDeps({ run: probing }) });
  assert.equal(result.ok, true);
  assert.ok(calls.some((call) => call.binary === "/opt/x/bin/ffprobe"));
  assert.ok(!calls.some((call) => call.binary === "ffprobe"));
  void run;
});

test("a missing ffprobe fails up front, before any encode runs", async () => {
  const calls = [];
  const run = async (binary, argv) => {
    calls.push({ binary, args: argv });
    if (binary.endsWith("ffprobe")) throw new Error("spawn ffprobe ENOENT");
    return { stdout: "", stderr: "" };
  };
  const result = await runConvertGuideVideoFlow(parseArgs([]), { ...flowDeps({ run }) });
  assert.equal(result.code, "ffmpeg_missing");
  assert.match(result.message, /ffprobe is not runnable/);
  // The expensive part must not have run only to be rejected afterwards.
  assert.equal(calls.filter((call) => call.args.includes("-c:v")).length, 0);
});

test("the partial file is a hidden sibling that discovery ignores", () => {
  assert.equal(partialPath("guide/video/product-tour.mp4"), "guide/video/.product-tour.part.mp4");
  // Still .mp4, because ffmpeg picks the container from the extension.
  assert.ok(partialPath("a/b.mp4").endsWith(".mp4"));
  assert.deepEqual(discoverSources("d", { readdir: () => [".product-tour.part.mp4", "x.webm"] }), ["x.webm"]);
});

test("the encode lands on a partial path and is promoted only after it validates", async () => {
  const { run, calls } = fakeRun();
  const moves = [];
  const result = await runConvertGuideVideoFlow(parseArgs([]), {
    ...flowDeps({ run, move: (from, to) => moves.push([from, to]) }),
  });
  assert.equal(result.ok, true);
  const encode = calls.find((call) => call.args.includes("-c:v"));
  assert.equal(encode.args.at(-1), "guide/video/.product-tour.part.mp4");
  assert.deepEqual(moves, [["guide/video/.product-tour.part.mp4", "guide/video/product-tour.mp4"]]);
});

test("a failed encode discards the partial and leaves the previous mp4 intact", async () => {
  const { run } = fakeRun({ failOn: "product-tour" });
  const moves = [];
  const discarded = [];
  const result = await runConvertGuideVideoFlow(parseArgs([]), {
    ...flowDeps({ run, move: (from, to) => moves.push([from, to]), discard: (f) => discarded.push(f) }),
  });
  assert.equal(result.ok, false);
  // Nothing was promoted, so a previously good upload artifact survives.
  assert.deepEqual(moves, []);
  assert.deepEqual(discarded, ["guide/video/.product-tour.part.mp4"]);
});

test("a zero-duration encode is never promoted over the real file", async () => {
  const { run } = fakeRun({
    probe: JSON.stringify({ streams: [{ codec_type: "video", codec_name: "h264", pix_fmt: "yuv420p" }], format: { duration: "0" } }),
  });
  const moves = [];
  const result = await runConvertGuideVideoFlow(parseArgs([]), {
    ...flowDeps({ run, move: (from, to) => moves.push([from, to]) }),
  });
  assert.equal(result.ok, false);
  assert.deepEqual(moves, []);
});

test("an explicit relative ffmpeg keeps an explicit relative ffprobe", () => {
  // dirname("./ffmpeg") is ".", which join() would normalise away into a bare
  // name — silently turning a configured binary into a PATH lookup.
  assert.equal(resolveFfprobe("./ffmpeg", {}), "./ffprobe");
  assert.equal(resolveFfprobe("../bin/ffmpeg", {}), "../bin/ffprobe");
  assert.equal(resolveFfprobe("C:\\tools\\ffmpeg", {}), "C:\\tools\\ffprobe");
  // Still a bare name when it was one, so PATH lookup keeps working.
  assert.equal(resolveFfprobe("ffmpeg", {}), "ffprobe");
});

test("the validated partial is promoted, and nothing else is touched", async () => {
  const { run } = fakeRun();
  const fsCalls = [];
  await runConvertGuideVideoFlow(parseArgs([]), {
    ...flowDeps({
      run,
      move: (from, to) => fsCalls.push(["move", from, to]),
      discard: (file) => fsCalls.push(["discard", file]),
    }),
  });
  assert.deepEqual(fsCalls, [
    ["move", partialPath(join(DEFAULT_VIDEO_DIR, "product-tour.mp4")), join(DEFAULT_VIDEO_DIR, "product-tour.mp4")],
  ]);
});

test("the default move is a bare rename, with no unlink to fall between", async () => {
  // Asserted on the default itself rather than through a stub that replaces it:
  // rename() overwrites atomically, so unlinking the destination first would
  // reopen the window where a crash leaves neither file in place.
  const calls = [];
  const { run } = fakeRun();
  await runConvertGuideVideoFlow(parseArgs([]), {
    ...flowDeps({
      run,
      move: undefined,
      discard: () => {},
    }),
    renameImpl: (from, to) => calls.push(["rename", from, to]),
    unlinkImpl: (file) => calls.push(["unlink", file]),
  });
  assert.deepEqual(calls, [
    ["rename", partialPath(join(DEFAULT_VIDEO_DIR, "product-tour.mp4")), join(DEFAULT_VIDEO_DIR, "product-tour.mp4")],
  ]);
});

test("the bed is trimmed to the take and faded at the end", () => {
  const filter = musicFilter({ durationSec: 40.64 });
  assert.match(filter, /^\[1:a\]volume=0\.12/);
  assert.match(filter, /atrim=0:40\.640/);
  // Restamped after the trim, so the fade is measured from the clip start
  // rather than from wherever the loop happened to be.
  assert.match(filter, /asetpts=N\/SR\/TB/);
  assert.match(filter, /afade=t=out:st=39\.140:d=1\.500\[a\]$/);
});

test("the fade cannot exceed half a short take", () => {
  // A 2s clip with a 1.5s fade would be audibly fading almost from the start.
  const filter = musicFilter({ durationSec: 2 });
  assert.match(filter, /afade=t=out:st=1\.000:d=1\.000/);
});

test("music loops, so a bed shorter than the tour still covers it", () => {
  const args = ffmpegArgs({ input: "in.webm", output: "out.mp4", music: "bed.mp3", durationSec: 40 });
  assert.equal(args[args.indexOf("-stream_loop") + 1], "-1");
  assert.equal(args[args.indexOf("-stream_loop") + 3], "bed.mp3");
  assert.equal(args[args.indexOf("-c:a") + 1], "aac");
  // The video is taken from the source and the audio from the filter graph.
  assert.ok(args.includes("-filter_complex"));
  assert.equal(args[args.indexOf("-map") + 1], "0:v");
  assert.equal(args.at(args.indexOf("-map", args.indexOf("-map") + 1) + 1), "[a]");
});

test("music without a known duration falls back to silence, not a wrong fade", () => {
  // The fade position comes from the probed duration; guessing it would put the
  // fade in the wrong place, which is worse than no music.
  const args = ffmpegArgs({ input: "in.webm", output: "out.mp4", music: "bed.mp3", durationSec: 0 });
  assert.ok(!args.includes("-stream_loop"));
  assert.ok(args.includes("anullsrc=channel_layout=stereo:sample_rate=44100"));
});

test("no music keeps exactly the previous silent-track behaviour", () => {
  const args = ffmpegArgs({ input: "in.webm", output: "out.mp4" });
  assert.ok(!args.includes("-stream_loop"));
  assert.ok(!args.includes("-filter_complex"));
  assert.ok(args.includes("anullsrc=channel_layout=stereo:sample_rate=44100"));
  assert.equal(args[args.indexOf("-c:a") + 1], "aac");
});

test("music gain is overridable", () => {
  assert.match(musicFilter({ durationSec: 10, gain: 0.3 }), /volume=0\.3/);
  assert.equal(parseArgs(["--music-gain=0.25"]).musicGain, 0.25);
  assert.throws(() => parseArgs(["--music-gain", "9"]), /--music-gain must be between 0 and 2/);
});

test("music args default to the committed bed and can be turned off", () => {
  assert.equal(parseArgs([]).music, DEFAULT_MUSIC_PATH);
  assert.equal(parseArgs([]).musicGain, DEFAULT_MUSIC_GAIN);
  assert.equal(parseArgs(["--no-music"]).music, null);
  assert.equal(parseArgs(["--music", "x.mp3"]).music, "x.mp3");
  assert.equal(parseArgs([], { SIGNALS_TOUR_MUSIC: "env.mp3" }).music, "env.mp3");
});

test("an absent bed is a silent track, not a failure", async () => {
  // guide/video/audio may not be fetched in a fresh clone; converting must
  // still work rather than dying on a missing optional asset.
  const { run, calls } = fakeRun();
  const result = await runConvertGuideVideoFlow(parseArgs([]), {
    ...flowDeps({ run, fileExists: () => false }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.converted[0].music, null);
  assert.ok(!calls.some((call) => call.args.includes("-stream_loop")));
});

test("the source is probed for its duration before a bed is mixed", async () => {
  const calls = [];
  const run = async (binary, argv) => {
    calls.push({ binary, args: argv });
    if (argv.includes("-show_entries")) return { stdout: OK_PROBE, stderr: "" };
    return { stdout: "", stderr: "" };
  };
  const result = await runConvertGuideVideoFlow(parseArgs([]), {
    ...flowDeps({ run, fileExists: () => true }),
  });
  assert.equal(result.ok, true);
  const probes = calls.filter((call) => call.args.includes("-show_entries"));
  // One for the source (to place the fade), one for the output (to validate it).
  assert.equal(probes.length, 2);
  assert.ok(probes[0].args.includes("guide/video/product-tour.webm"));
});

test("probe reads the audio stream, and finds video wherever it sits", () => {
  const summary = probeSummary(OK_PROBE);
  assert.equal(summary.audioCodec, "aac");
  assert.equal(summary.codec, "h264");
  // Audio listed first must not be mistaken for the video stream.
  const reordered = probeSummary(JSON.stringify({
    streams: [
      { codec_type: "audio", codec_name: "aac" },
      { codec_type: "video", codec_name: "h264", width: 1440, height: 900, pix_fmt: "yuv420p" },
    ],
    format: { duration: "10" },
  }));
  assert.equal(reordered.codec, "h264");
  assert.equal(reordered.width, 1440);
});

test("music silently dropped by a bad filter graph is a failure", () => {
  // The mp4 is still valid and watchable without it — the failure that looks
  // like success, so it is checked rather than trusted.
  assert.throws(
    () => assertUsableOutput(
      { codec: "h264", pixelFormat: "yuv420p", durationSec: 40, audioCodec: null },
      { expectAudio: true },
    ),
    /the music was dropped/,
  );
  assert.doesNotThrow(() => assertUsableOutput(
    { codec: "h264", pixelFormat: "yuv420p", durationSec: 40, audioCodec: null },
    { expectAudio: false },
  ));
});
