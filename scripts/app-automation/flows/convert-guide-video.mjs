/**
 * Convert recorded tours from Playwright's webm into mp4 for publishing.
 *
 * `record-guide-tour.mjs` deliberately needs no ffmpeg: Playwright writes VP8
 * webm from the browser itself, so recording runs headless anywhere with no
 * system dependency. That property is worth keeping, so the ffmpeg dependency
 * lives here instead — at the publish boundary, where X and LinkedIn want
 * H.264 mp4 and webm is not accepted.
 *
 * Which means ffmpeg is optional for the repo as a whole. Anyone can record;
 * only whoever publishes needs to install it, and this flow says so by name
 * rather than dying on a spawn ENOENT.
 *
 * Side-effect free on import (see README): the CLI is guarded on argv[1].
 */
import { execFile } from "node:child_process";
import { mkdirSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { DEFAULT_VIDEO_DIR } from "./record-guide-tour.mjs";

const execFileAsync = promisify(execFile);

export const CONVERT_GUIDE_VIDEO_FLOW_NAME = "convert-guide-video";

/**
 * Visually lossless for a screen recording without bloating the file. Tours are
 * flat UI with hard text edges, which x264 encodes cheaply; there is no grain
 * budget to spend, so a lower CRF buys nothing but megabytes.
 */
export const DEFAULT_CRF = 20;
export const DEFAULT_PRESET = "slow";

/** Composed after the name of whichever binary was missing, so it must not name one itself. */
export const INSTALL_HINT =
  "Install ffmpeg with `brew install ffmpeg` (macOS) or `apt-get install ffmpeg` (Linux), " +
  "or point SIGNALS_FFMPEG / SIGNALS_FFPROBE at binaries. " +
  "Recording tours does not need ffmpeg — only converting them for upload does.";

/**
 * The ffprobe that belongs to this ffmpeg.
 *
 * SIGNALS_FFMPEG exists so a binary off PATH can be used, so hardcoding the
 * literal `ffprobe` would break exactly the setup that flag is for — and break
 * it at validation, after every expensive encode had already run. ffmpeg ships
 * ffprobe beside itself, so a path implies its sibling.
 */
export function resolveFfprobe(ffmpeg, env = process.env) {
  if (env.SIGNALS_FFPROBE) return env.SIGNALS_FFPROBE;
  // A bare name means "search PATH", so the sibling is a bare name too. Anything
  // with a separator is an explicit location and must stay one: `./ffmpeg` has a
  // dirname of ".", which join() would normalise away into a PATH lookup.
  //
  // Sliced rather than dirname()'d because dirname() is POSIX-only in this
  // process and reads a Windows path as one long filename.
  const cut = Math.max(ffmpeg.lastIndexOf("/"), ffmpeg.lastIndexOf("\\"));
  return cut === -1 ? "ffprobe" : `${ffmpeg.slice(0, cut + 1)}ffprobe`;
}

/** Where the encode lands before it has earned the real name. */
export function partialPath(output) {
  return join(dirname(output), `.${basename(output, ".mp4")}.part.mp4`);
}

export function outputFileName(source) {
  return `${basename(source, extname(source))}.mp4`;
}

/**
 * Every recorded take in the directory, in stable order.
 *
 * A missing directory is an empty set rather than an error: `guide/video` is
 * gitignored, so on a fresh checkout it does not exist at all, and a raw
 * `ENOENT: scandir` there would bury the one thing the caller needs to be told
 * — that they should record something first.
 */
export function discoverSources(videoDir, { readdir = readdirSync } = {}) {
  let entries;
  try {
    entries = readdir(videoDir);
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  return entries.filter((name) => name.toLowerCase().endsWith(".webm")).sort();
}

export function selectSources(only, sources) {
  if (!only || only.length === 0) return sources;
  const wanted = new Set(only);
  const matched = sources.filter((name) => wanted.has(basename(name, extname(name))));
  const missing = [...wanted].filter(
    (id) => !sources.some((name) => basename(name, extname(name)) === id),
  );
  // An unknown id is an error rather than an empty run that exits 0 having
  // converted nothing — the same contract selectJourneys keeps.
  if (missing.length > 0) {
    throw new Error(
      `No recording for: ${missing.join(", ")}. ` +
        `Found: ${sources.map((n) => basename(n, extname(n))).join(", ") || "(none)"}. ` +
        "Record one first with `npm run automation:record-guide-tour`.",
    );
  }
  return matched;
}

/**
 * The encode.
 *
 * `yuv420p` and `+faststart` are the two settings that decide whether an upload
 * is accepted rather than merely produced: without the pixel format, x264 can
 * emit 4:4:4 from VP8 that Safari and QuickTime refuse to decode; without
 * faststart the moov atom sits at the end of the file and players must fetch
 * the whole thing before showing a frame.
 *
 * The scale filter forces even dimensions. GUIDE_VIEWPORT is 1440x900 today, so
 * it is a no-op — but an odd viewport would otherwise fail the encode outright
 * with "width not divisible by 2", far from the line that changed it.
 */
export function ffmpegArgs({ input, output, crf = DEFAULT_CRF, preset = DEFAULT_PRESET, silentAudio = true }) {
  return [
    "-y",
    "-i", input,
    // A silent AAC track. Tours have no audio, and some upload pipelines reject
    // or mis-transcode a video with no audio stream at all; an empty track is
    // a few KB and removes the failure mode.
    ...(silentAudio ? ["-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100", "-shortest"] : []),
    "-c:v", "libx264",
    "-preset", preset,
    "-crf", String(crf),
    "-pix_fmt", "yuv420p",
    "-profile:v", "high",
    "-level", "4.0",
    "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
    ...(silentAudio ? ["-c:a", "aac", "-b:a", "128k"] : ["-an"]),
    "-movflags", "+faststart",
    output,
  ];
}

export function ffprobeArgs(file) {
  return [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=codec_name,width,height,pix_fmt",
    "-show_entries", "format=duration",
    "-of", "json",
    file,
  ];
}

export function probeSummary(raw) {
  const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  const stream = parsed.streams?.[0] ?? {};
  return {
    codec: stream.codec_name ?? null,
    width: stream.width ?? null,
    height: stream.height ?? null,
    pixelFormat: stream.pix_fmt ?? null,
    durationSec: Number(parsed.format?.duration ?? 0),
  };
}

/**
 * An mp4 that exists is not an mp4 that plays.
 *
 * ffmpeg exits 0 having written a zero-frame file if the input was truncated,
 * so the conversion is only done once the output has been probed — the same
 * reason the capture flow settles before it believes a screenshot.
 */
export function assertUsableOutput(summary, { source } = {}) {
  const label = source ? `${source}: ` : "";
  if (summary.codec !== "h264") {
    throw new Error(`${label}expected an h264 stream, got ${summary.codec ?? "none"}`);
  }
  if (summary.pixelFormat !== "yuv420p") {
    throw new Error(`${label}expected yuv420p, got ${summary.pixelFormat ?? "none"} — players will refuse this`);
  }
  if (!(summary.durationSec > 0)) {
    throw new Error(`${label}converted file has no duration`);
  }
}

export function parseArgs(argv = [], env = process.env) {
  const args = {
    only: [],
    videoDir: DEFAULT_VIDEO_DIR,
    crf: DEFAULT_CRF,
    preset: DEFAULT_PRESET,
    silentAudio: true,
    ffmpeg: env.SIGNALS_FFMPEG || "ffmpeg",
    ffprobe: resolveFfprobe(env.SIGNALS_FFMPEG || "ffmpeg", env),
    json: false,
    quiet: false,
    help: false,
  };

  const readValue = (index, rawArg) => {
    if (rawArg.includes("=")) return rawArg.split(/=(.*)/s)[1];
    if (index + 1 >= argv.length) throw new Error(`Missing value for ${rawArg}`);
    return argv[index + 1];
  };

  for (let index = 0; index < argv.length; index += 1) {
    const rawArg = argv[index];
    const key = rawArg.includes("=") ? rawArg.split("=")[0] : rawArg;
    switch (key) {
      case "--help":
      case "-h":
        args.help = true;
        break;
      case "--json":
        args.json = true;
        break;
      case "--quiet":
        args.quiet = true;
        break;
      case "--no-silent-audio":
        args.silentAudio = false;
        break;
      case "--only":
        args.only.push(
          ...readValue(index, rawArg).split(",").map((v) => v.trim()).filter(Boolean),
        );
        if (!rawArg.includes("=")) index += 1;
        break;
      case "--video-dir":
        args.videoDir = readValue(index, rawArg);
        if (!rawArg.includes("=")) index += 1;
        break;
      case "--preset":
        args.preset = readValue(index, rawArg);
        if (!rawArg.includes("=")) index += 1;
        break;
      case "--crf": {
        const value = Number(readValue(index, rawArg));
        if (!Number.isInteger(value) || value < 0 || value > 51) {
          throw new Error(`--crf must be an integer 0-51: ${rawArg}`);
        }
        args.crf = value;
        if (!rawArg.includes("=")) index += 1;
        break;
      }
      default:
        throw new Error(`Unknown option: ${rawArg}`);
    }
  }
  return args;
}

export function createHelpText() {
  return [
    `Usage: node scripts/app-automation/flows/${CONVERT_GUIDE_VIDEO_FLOW_NAME}.mjs [options]`,
    "",
    "Convert recorded tours from webm to H.264 mp4 for upload to X and LinkedIn.",
    "Requires ffmpeg; recording tours does not.",
    "",
    "Options:",
    "  --only <ids>        Comma-separated journey ids. Default: every recording found.",
    `  --video-dir <dir>   Default: ${DEFAULT_VIDEO_DIR}`,
    `  --crf <0-51>        Quality; lower is bigger. Default: ${DEFAULT_CRF}`,
    `  --preset <name>     x264 speed/size tradeoff. Default: ${DEFAULT_PRESET}`,
    "  --no-silent-audio   Emit no audio track at all.",
    "  --json              Emit the result as JSON on stdout.",
    "  --quiet             Suppress progress on stderr.",
    "  -h, --help          Show this help.",
    "",
    "Environment:",
    "  SIGNALS_FFMPEG      ffmpeg binary to use. ffprobe is taken from beside it.",
    "  SIGNALS_FFPROBE     Override that, if ffprobe lives elsewhere.",
  ].join("\n");
}

export async function ffmpegAvailable(binary, { run = execFileAsync } = {}) {
  try {
    await run(binary, ["-version"]);
    return true;
  } catch {
    return false;
  }
}

export async function runConvertGuideVideoFlow(args, dependencies = {}) {
  const {
    run = execFileAsync,
    listSources = discoverSources,
    ensureDir = (dir) => mkdirSync(dir, { recursive: true }),
    sizeOf = (file) => statSync(file).size,
    // Seams, so a test can assert on the default policy rather than on a stub
    // that replaces it — the bug here was in the default, not at the call site.
    renameImpl = renameSync,
    unlinkImpl = (file) => rmSync(file, { force: true }),
    // rename() overwrites the destination atomically on the same filesystem.
    // Unlinking first would reopen the very window the partial file closes: die
    // between the two calls and the good artifact is gone while the validated
    // replacement is still under a name nothing looks for.
    move = (from, to) => renameImpl(from, to),
    discard = (file) => unlinkImpl(file),
    log = () => {},
  } = dependencies;

  // Both, up front. ffprobe missing only at validation time would mean every
  // encode runs and then every file is rejected.
  for (const binary of [args.ffmpeg, args.ffprobe]) {
    if (!(await ffmpegAvailable(binary, { run }))) {
      return {
        ok: false,
        flow: CONVERT_GUIDE_VIDEO_FLOW_NAME,
        code: "ffmpeg_missing",
        message: `${binary} is not runnable. ${INSTALL_HINT}`,
      };
    }
  }

  let sources;
  try {
    sources = selectSources(args.only, listSources(args.videoDir));
  } catch (error) {
    return {
      ok: false,
      flow: CONVERT_GUIDE_VIDEO_FLOW_NAME,
      code: "no_such_recording",
      message: error.message,
    };
  }

  if (sources.length === 0) {
    return {
      ok: false,
      flow: CONVERT_GUIDE_VIDEO_FLOW_NAME,
      code: "no_recordings",
      message:
        `No .webm recordings in ${args.videoDir}. ` +
        "Record one first with `npm run automation:record-guide-tour`.",
    };
  }

  ensureDir(args.videoDir);
  const converted = [];
  const failures = [];

  for (const source of sources) {
    const input = join(args.videoDir, source);
    const output = join(args.videoDir, outputFileName(source));
    // Encode beside the real file, not onto it. Re-converting otherwise
    // destroys the last good upload artifact the moment ffmpeg starts writing,
    // so a truncated input would leave a partial file where a working one was.
    const partial = partialPath(output);
    log(`${source} -> ${basename(output)}`);
    try {
      await run(args.ffmpeg, ffmpegArgs({
        input,
        output: partial,
        crf: args.crf,
        preset: args.preset,
        silentAudio: args.silentAudio,
      }));
      const { stdout } = await run(args.ffprobe, ffprobeArgs(partial));
      const summary = probeSummary(stdout);
      assertUsableOutput(summary, { source });
      move(partial, output);
      converted.push({
        source,
        path: output,
        bytes: sizeOf(output),
        ...summary,
      });
    } catch (error) {
      discard(partial);
      failures.push({ source, error: error.message });
    }
  }

  return {
    ok: failures.length === 0,
    flow: CONVERT_GUIDE_VIDEO_FLOW_NAME,
    code: failures.length === 0 ? "converted" : "partial",
    videoDir: args.videoDir,
    converted,
    failures,
  };
}

async function main(argv) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
    return;
  }
  if (args.help) {
    process.stdout.write(`${createHelpText()}\n`);
    return;
  }

  let result;
  try {
    result = await runConvertGuideVideoFlow(args, {
      log: args.quiet ? () => {} : (line) => process.stderr.write(`${line}\n`),
    });
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
    return;
  }

  if (args.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!args.json && !args.quiet) {
    for (const item of result.converted ?? []) {
      const mb = (item.bytes / 1_048_576).toFixed(1);
      process.stderr.write(
        `  ${basename(item.path)}  ${item.width}x${item.height}  ${item.durationSec.toFixed(1)}s  ${mb}M\n`,
      );
    }
  }
  if (!result.ok) {
    if (result.message) process.stderr.write(`\n${result.message}\n`);
    for (const failure of result.failures ?? []) {
      process.stderr.write(`${failure.source}: ${failure.error}\n`);
    }
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main(process.argv.slice(2));
}
