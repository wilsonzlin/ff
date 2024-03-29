import defined from "@xtjs/lib/js/defined";
import exec from "@xtjs/lib/js/exec";
import ifDefined from "@xtjs/lib/js/ifDefined";
import mapDefined from "@xtjs/lib/js/mapDefined";
import nativeOrdering from "@xtjs/lib/js/nativeOrdering";
import UnreachableError from "@xtjs/lib/js/UnreachableError";

// ffmpeg and ffprobe often emit stderr messages and exit with non-zero codes
// but still output (mostly) usable/correct data, so don't throw on stderr or bad status.
// Instead, users of this library should check the output contents for validation.
const cmd = (
  command: string,
  args: string[],
  stream: "stdout" | "stderr"
): Promise<string> =>
  exec(command, ...args)
    .throwOnBadStatus(false)
    .text()
    .output(stream == "stderr", stream == "stdout");

const job = (command: string, args: string[]): Promise<unknown> =>
  exec(command, ...args)
    .throwOnBadStatus(false)
    .status();

export type ffprobeAudioStream = {
  index: number;
  codec_name: string;
  codec_long_name: string;
  profile: string;
  codec_type: "audio";
  codec_time_base: string;
  codec_tag_string: string;
  codec_tag: string;
  sample_fmt: string;
  sample_rate: string;
  channels: number;
  channel_layout: string;
  bits_per_sample: number;
  r_frame_rate: string;
  avg_frame_rate: string;
  time_base: string;
  duration_ts: number;
  duration: string;
  bit_rate: string;
  disposition: {
    default: number;
    dub: number;
    original: number;
    comment: number;
    lyrics: number;
    karaoke: number;
    forced: number;
    hearing_impaired: number;
    visual_impaired: number;
    clean_effects: number;
    attached_pic: number;
    timed_thumbnails: number;
  };
  tags?: {
    [name: string]: string;
  };
};

export type ffprobeVideoStream = {
  index: number;
  codec_name: string;
  codec_long_name: string;
  profile: string;
  codec_type: "video";
  codec_time_base: string;
  codec_tag_string: string;
  codec_tag: string;
  width: number;
  height: number;
  coded_width: number;
  coded_height: number;
  has_b_frames: number;
  sample_aspect_ratio: string;
  display_aspect_ratio: string;
  pix_fmt: string;
  level: number;
  chroma_location: string;
  refs: number;
  is_avc: string;
  nal_length_size: string;
  r_frame_rate: string;
  avg_frame_rate: string;
  time_base: string;
  start_pts: number;
  start_time: string;
  duration_ts: number;
  duration: string;
  bit_rate?: string;
  bits_per_raw_sample: string;
  disposition: {
    default: number;
    dub: number;
    original: number;
    comment: number;
    lyrics: number;
    karaoke: number;
    forced: number;
    hearing_impaired: number;
    visual_impaired: number;
    clean_effects: number;
    attached_pic: number;
    timed_thumbnails: number;
  };
  tags?: {
    [name: string]: string;
  };
};

export type ffprobeFormat = {
  filename: string;
  nb_streams: number;
  nb_programs: number;
  format_name: string;
  format_long_name: string;
  start_time: string;
  duration: string;
  size: string;
  bit_rate: string;
  probe_score: number;
  tags?: {
    [name: string]: string;
  };
};

export type ffprobeOutput = {
  // ffprobe outputs an empty object for invalid formats.
  streams?: Array<ffprobeAudioStream | ffprobeVideoStream>;
  format?: ffprobeFormat;
};

export const isFfprobeAudioStream = (
  val: ffprobeAudioStream | ffprobeVideoStream
): val is ffprobeAudioStream => val.codec_type == "audio";
export const isFfprobeVideoStream = (
  val: ffprobeAudioStream | ffprobeVideoStream
): val is ffprobeVideoStream => val.codec_type == "video";

export enum FfmpegLogLevel {
  QUIET = "quiet",
  PANIC = "panic",
  FATAL = "fatal",
  ERROR = "error",
  WARNING = "warning",
  INFO = "info",
  VERBOSE = "verbose",
  DEBUG = "debug",
  TRACE = "trace",
}

export type FfConfig = {
  ffprobeCommand: string;
  ffmpegCommand: string;
  logLevel: FfmpegLogLevel;
  logCommandBeforeRunning: boolean | ((args: string[]) => void);
  runCommandWithoutOutput: (
    command: string,
    args: string[]
  ) => Promise<unknown>;
  runCommandWithOutput: (
    command: string,
    args: string[],
    stream: "stdout" | "stderr"
  ) => Promise<string>;
};

const createCfg = ({
  ffmpegCommand = "ffmpeg",
  ffprobeCommand = "ffprobe",
  logLevel = FfmpegLogLevel.ERROR,
  logCommandBeforeRunning = false,
  runCommandWithoutOutput = job,
  runCommandWithOutput = cmd,
}: Partial<FfConfig>): FfConfig => ({
  ffmpegCommand,
  ffprobeCommand,
  logLevel,
  logCommandBeforeRunning,
  runCommandWithoutOutput,
  runCommandWithOutput,
});

type ExtractFrameOpts = {
  input: string;
  output: string | { path: string; format: string };
  quality?: number;
  scaleWidth?: number;
  timestamp?: number;
};

type ConvertOpts = {
  threads?: number;
  input: {
    file: string;
    start?: number;
    copyTimestamps?: boolean;
  } & (
    | {
        duration?: number;
      }
    | {
        end?: number;
      }
  );
  map?: readonly {
    exclude?: boolean;
    input: number;
    type?: "a" | "v";
    stream?: number;
    optional?: boolean;
  }[];
  metadata: boolean;
  video?:
    | boolean
    | ({
        filter?: string;
      } & (
        | {
            codec: "copy";
          }
        | ({
            fps?: number;
            vsync?: "passthrough" | "cfr" | "vfr" | "drop" | "auto";
            resize?: {
              height?: number;
              width?: number;
            };
          } & (
            | {
                codec: "libtheora";
                quality: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
              }
            | {
                codec: "libx264";
                preset:
                  | "ultrafast"
                  | "superfast"
                  | "veryfast"
                  | "faster"
                  | "fast"
                  | "medium"
                  | "slow"
                  | "slower"
                  | "veryslow";
                crf: number;
              }
            | ({
                codec: "vp9";
                multithreading?: boolean;
              } & (
                | {}
                | {
                    deadline: "good" | "best";
                    cpuUsed?: 0 | 1 | 2 | 3 | 4 | 5;
                  }
                | {
                    deadline: "realtime";
                    cpuUsed?:
                      | -8
                      | -7
                      | -6
                      | -5
                      | -4
                      | -3
                      | -2
                      | -1
                      | 0
                      | 1
                      | 2
                      | 3
                      | 4
                      | 5
                      | 6
                      | 7
                      | 8;
                  }
              ) &
                (
                  | {
                      // Average Bitrate mode.
                      mode: "average-bitrate";
                      bitrate: number;
                    }
                  | {
                      // Constant Quality mode.
                      mode: "constant-quality";
                      crf: number;
                    }
                  | {
                      // Constrained Quality mode with CRF.
                      mode: "constrained-quality";
                      crf: number;
                      bitrate: string;
                    }
                  | {
                      // Constrained Quality mode with bounded bitrate.
                      mode: "constrained-quality";
                      minBitrate: string;
                      targetBitrate: string;
                      maxBitrate: string;
                    }
                  | {
                      // Constant Bitrate mode.
                      mode: "constant-bitrate";
                      bitrate: string;
                    }
                  | {
                      // Lossless mode;
                      mode: "lossless";
                    }
                ))
            | {
                codec: "gif";
                loop: boolean | number;
              }
          ))
      ));
  audio?:
    | boolean
    | ({
        samplingRate?: number;
        // Mix a single stereo stream into a mono stream.
        downmix?: boolean;
        filter?: string;
      } & (
        | {
            codec: "aac";
          }
        | {
            codec: "flac";
          }
        | {
            codec: "libmp3lame";
            quality: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
          }
        | {
            codec: "libopus";
          }
        | {
            codec: "libvorbis";
            quality: -1 | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
          }
        | {
            codec: "pcm";
            signedness: "s" | "u";
            bits: 8 | 16 | 24 | 32 | 64;
            // Omit if 8 bits.
            endianness?: "be" | "le";
          }
        | {
            codec: "copy";
          }
      ));
  output: {
    format?: string;
    file: string;
    start?: number;
    duration?: number;
    movflags?: (
      | "default_base_moof"
      | "disable_chpl"
      | "empty_moov"
      | "faststart"
      | "frag_every_frame"
      | "frag_keyframe"
      | "negative_cts_offsets"
      | "omit_tfhd_offset"
      | "rtphint"
      | "separate_moof"
      | "skip_sidx"
    )[];
  };
};

export class Ff {
  private readonly cfg: FfConfig;

  constructor(cfg: Partial<FfConfig> = {}) {
    this.cfg = createCfg(cfg);
  }

  private commandLogger(args: string[]) {
    if (typeof this.cfg.logCommandBeforeRunning == "function") {
      this.cfg.logCommandBeforeRunning(args);
    } else if (this.cfg.logCommandBeforeRunning) {
      console.debug("+", ...args);
    }
  }

  probe = async (file: string): Promise<ffprobeOutput> =>
    JSON.parse(
      await this.ffprobe(
        `-print_format`,
        `json`,
        `-show_streams`,
        `-show_format`,
        file
      )
    );

  getKeyframeTimestamps = async (file: string) => {
    const raw = await this.ffprobe(
      `-select_streams`,
      `v`,
      `-skip_frame`,
      `nokey`,
      `-show_entries`,
      `frame=pkt_pts_time`,
      `-of`,
      `default=noprint_wrappers=1:nokey=1`,
      file
    );
    if (!raw) {
      return [];
    }
    return raw
      .split(/\s+/)
      .map((ts) => +ts)
      .sort(nativeOrdering);
  };

  buildExtractFrameArgs = ({
    input,
    output,
    scaleWidth,
    timestamp,
    // Do not use a default value, as not all formats use this.
    quality,
  }: ExtractFrameOpts) =>
    [
      ...(mapDefined(timestamp, (timestamp) => [`-ss`, timestamp.toFixed(3)]) ??
        []),
      `-i`,
      input,
      ...(mapDefined(scaleWidth, (scaleWidth) => [
        `-filter:v`,
        `scale=${scaleWidth}:-1`,
      ]) ?? []),
      `-frames:v`,
      1,
      ...(mapDefined(quality, (quality) => [`-q:v`, quality]) ?? []),
      ...(typeof output == "string"
        ? [output]
        : ["-f", output.format, output.path]),
    ].map(String);

  extractFrame = async ({
    logLevel,
    ...opts
  }: ExtractFrameOpts & {
    logLevel?: FfmpegLogLevel;
  }) => this.ffmpeg(logLevel, ...this.buildExtractFrameArgs(opts));

  extractFrames = async ({
    threads,
    fps,
    input,
    output,
    scaleWidth,
    startTime,
    // Do not use a default value, as not all formats use this.
    quality,
  }: {
    threads?: number;
    // This will duplicate frames if source FPS is lower. To use an upper bound instead, calculate the FPS of the input beforehand, and use Math.min.
    fps?: number | [number, number];
    input: string;
    output: string | { path: string; format: string };
    quality?: number;
    scaleWidth?: number;
    startTime?: number;
  }) => {
    const args = [
      `-hide_banner`,
      `-nostdin`,
      `-y`,
      ...(mapDefined(threads, (t) => [`-threads`, t]) ?? []),
      `-loglevel`,
      // INFO is required to show output of showinfo filter.
      FfmpegLogLevel.INFO,
      ...(mapDefined(startTime, (timestamp) => [`-ss`, timestamp.toFixed(3)]) ??
        []),
      `-i`,
      input,
      `-filter:v`,
      // Place FPS filter before other filters so that others don't have to run on dropped frames.
      [
        mapDefined(fps, (fps) => [
          `fps=${Array.isArray(fps) ? fps.join("/") : fps}`,
        ]),
        mapDefined(scaleWidth, (scaleWidth) => [`scale=${scaleWidth}:-1`]),
        "showinfo",
      ]
        .filter(defined)
        .join(","),
      ...(mapDefined(quality, (quality) => [`-q:v`, quality]) ?? []),
      ...(typeof output == "string"
        ? [output]
        : ["-f", output.format, output.path]),
    ].map(String);
    this.commandLogger([this.cfg.ffmpegCommand, ...args]);
    const out = await this.cfg.runCommandWithOutput(
      this.cfg.ffmpegCommand,
      args,
      "stderr"
    );
    const frames = [];
    for (const line of out.split(/[\r\n]+/)) {
      if (!line.startsWith("[Parsed_showinfo_")) {
        continue;
      }
      const m = /\spts_time:\s*([0-9]+(?:\.[0-9]+)?)/.exec(line);
      if (!m) {
        continue;
      }
      frames.push({ timestamp: +m[1] });
    }
    return {
      frames,
    };
  };

  concat = async ({
    logLevel,
    filesListFile,
    output,
  }: {
    logLevel?: FfmpegLogLevel;
    filesListFile: string;
    output: string | { path: string; format: string };
  }) =>
    this.ffmpeg(
      logLevel,
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      filesListFile,
      "-c",
      "copy",
      ...(typeof output == "string"
        ? [output]
        : ["-f", output.format, output.path])
    );

  buildConvertArgs = ({
    threads,
    input,
    map,
    metadata,
    video,
    audio,
    output,
  }: ConvertOpts) => {
    const args = new Array<string | number>();

    ifDefined(threads, (t) => args.push(`-threads`, t));

    // Input.
    ifDefined(input.copyTimestamps, (ss) => args.push(`-copyts`));
    ifDefined(input.start, (ss) => args.push(`-ss`, ss.toFixed(3)));
    if ("duration" in input) {
      ifDefined(input.duration, (t) => args.push(`-t`, t.toFixed(3)));
    }
    if ("end" in input) {
      ifDefined(input.end, (t) => args.push(`-to`, t.toFixed(3)));
    }
    args.push(`-i`, input.file);

    // Metadata.
    !metadata && args.push(`-map_metadata`, -1);

    // Map.
    for (const m of map ?? []) {
      args.push(
        "-map",
        [
          m.exclude ? "-" : "",
          m.input,
          mapDefined(m.type, (t) => `:${t}`),
          mapDefined(m.stream, (s) => `:${s}`),
          m.optional ? "?" : "",
        ].join("")
      );
    }

    // Video.
    if (typeof video == "boolean") {
      video ? args.push(`-c:v`, `copy`) : args.push(`-vn`);
    } else if (video !== undefined) {
      if (video.codec == "copy") {
        ifDefined(video.filter, (filter) => args.push("-filter:v", filter));
        args.push(`-c:v`, `copy`);
      } else {
        const filters = new Array<string>();
        ifDefined(video.fps, (fps) => filters.push(`fps=${fps}`));
        // `-2` means proportional width/height.
        ifDefined(video.resize, ({ width = -2, height = -2 }) =>
          filters.push(`scale=${width}:${height}`)
        );
        ifDefined(video.filter, (f) => filters.push(f));
        if (filters.length) {
          args.push(`-filter:v`, filters.join(","));
        }
        ifDefined(video.vsync, (vsync) => args.push(`-vsync`, vsync));

        args.push(`-c:v`, video.codec);
        switch (video.codec) {
          case "libtheora":
            args.push("-q:v", video.quality);
            break;
          case "libx264":
            args.push(`-preset`, video.preset);
            args.push(`-crf`, video.crf);
            args.push(`-max_muxing_queue_size`, 1048576);
            break;
          case "gif":
            if (typeof video.loop == "boolean") {
              args.push(`-loop`, video.loop ? 0 : -1);
            } else {
              args.push(`-loop`, video.loop);
            }
            break;
          case "vp9":
            if ("cpuUsed" in video) {
              ifDefined(video.cpuUsed, (c) => args.push("-cpu-used", c));
            }
            if ("deadline" in video) {
              ifDefined(video.deadline, (d) => args.push("-deadline", d));
            }
            ifDefined(
              video.multithreading,
              (t) => t && args.push("-row-mt", 1)
            );
            switch (video.mode) {
              case "average-bitrate":
                args.push("-b:v", video.bitrate);
                break;
              case "constant-bitrate":
                for (const a of ["-minrate", "-b:v", "-maxrate"]) {
                  args.push(a, video.bitrate);
                }
                break;
              case "constant-quality":
                args.push("-crf", video.crf, "-b:v", 0);
                break;
              case "constrained-quality":
                if ("crf" in video) {
                  args.push("-crf", video.crf, "-b:v", video.bitrate);
                } else {
                  args.push("-minrate", video.minBitrate);
                  args.push("-b:v", video.targetBitrate);
                  args.push("-maxrate", video.maxBitrate);
                }
                break;
              case "lossless":
                args.push("-lossless", 1);
                break;
              default:
                throw new UnreachableError(video);
            }
            break;
        }
      }
    }

    // Audio.
    if (typeof audio == "boolean") {
      audio ? args.push(`-c:a`, `copy`) : args.push(`-an`);
    } else if (audio !== undefined) {
      ifDefined(audio.filter, (f) => args.push(`-af`, f));
      args.push(
        `-c:a`,
        audio.codec == "pcm"
          ? `pcm_${audio.signedness}${audio.bits}${audio.endianness ?? ""}`
          : audio.codec
      );
      audio.downmix && args.push(`-ac`, 1);
      audio.samplingRate && args.push(`-ar`, audio.samplingRate);
      if (audio.codec == "libmp3lame" || audio.codec == "libvorbis") {
        args.push(`-q:a`, audio.quality);
      }
    }

    // Output.
    if (output.movflags?.length) {
      args.push(`-movflags`, output.movflags.join("+"));
    }
    ifDefined(output.format, (format) => args.push(`-f`, format));
    ifDefined(output.start, (ss) => args.push(`-ss`, ss.toFixed(3)));
    ifDefined(output.duration, (t) => args.push(`-t`, t.toFixed(3)));
    args.push(output.file);

    return args.map(String);
  };

  convert = async ({
    logLevel,
    ...opts
  }: ConvertOpts & {
    logLevel?: FfmpegLogLevel;
  }) => {
    const args = this.buildConvertArgs(opts);
    await this.ffmpeg(logLevel, ...args);
  };

  private async ffmpeg(
    logLevel: FfmpegLogLevel = this.cfg.logLevel,
    ...args: string[]
  ) {
    const fullArgs = [
      `-hide_banner`,
      `-nostdin`,
      `-y`,
      `-loglevel`,
      logLevel,
      ...args,
    ];
    this.commandLogger([this.cfg.ffmpegCommand, ...fullArgs]);
    await this.cfg.runCommandWithoutOutput(this.cfg.ffmpegCommand, fullArgs);
  }

  private async ffprobe(...args: string[]) {
    const fullArgs = [`-v`, `error`, ...args];
    this.commandLogger([this.cfg.ffprobeCommand, ...fullArgs]);
    const raw = await this.cfg.runCommandWithOutput(
      this.cfg.ffprobeCommand,
      fullArgs,
      "stdout"
    );
    return raw.trim();
  }
}
