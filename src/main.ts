import { execFile, spawn } from "child_process";
import ifDefined from "extlib/js/ifDefined";
import mapDefined from "extlib/js/mapDefined";

const cmd = async (
  command: string,
  args: string[],
  throwOnStderr: boolean
): Promise<string> =>
  new Promise((resolve, reject) =>
    execFile(command, args, (error, stdout, stderr) => {
      if (error) {
        reject(error);
      } else if (stderr && throwOnStderr) {
        reject(new Error(`stderr: ${stderr}`));
      } else {
        resolve(stdout);
      }
    })
  );

const job = async (command: string, args: string[]): Promise<void> =>
  new Promise((resolve) => {
    const proc = spawn(command, args.map(String), {
      stdio: ["ignore", "inherit", "inherit"],
    });
    proc.on("error", console.error);
    proc.on("exit", () => resolve());
  });

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
  tags: {
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
  bit_rate: string;
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
  tags: {
    [name: string]: string;
  };
};

export type ffprobeOutput = {
  streams: Array<ffprobeAudioStream | ffprobeVideoStream>;
  format: {
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
    tags: {
      [name: string]: string;
    };
  };
};

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
  logCommandBeforeRunning: boolean;
  runCommandWithoutStdout: (command: string, args: string[]) => Promise<void>;
  runCommandWithStdout: (
    command: string,
    args: string[],
    throwOnStdout: boolean
  ) => Promise<string>;
};

const createCfg = ({
  ffmpegCommand = "ffmpeg",
  ffprobeCommand = "ffprobe",
  logLevel = FfmpegLogLevel.ERROR,
  logCommandBeforeRunning = false,
  runCommandWithoutStdout = job,
  runCommandWithStdout = cmd,
}: Partial<FfConfig>): FfConfig => ({
  ffmpegCommand,
  ffprobeCommand,
  logLevel,
  logCommandBeforeRunning,
  runCommandWithoutStdout,
  runCommandWithStdout,
});

export class Ff {
  private readonly cfg: FfConfig;

  constructor(cfg: Partial<FfConfig> = {}) {
    this.cfg = createCfg(cfg);
  }

  probe = async (
    file: string,
    throwOnStderr: boolean = false
  ): Promise<ffprobeOutput> => {
    const raw = (
      await this.cfg.runCommandWithStdout(
        this.cfg.ffprobeCommand,
        [
          `-v`,
          `error`,
          `-print_format`,
          `json`,
          `-show_streams`,
          `-show_format`,
          file,
        ].map(String),
        throwOnStderr
      )
    ).trim();
    return JSON.parse(raw);
  };

  extractFrame = async ({
    fps,
    input,
    output,
    scaleWidth,
    timestamp,
    // Do not use a default value, as not all formats use this.
    quality,
  }: {
    fps?: number | [number, number];
    input: string;
    output: string;
    quality?: number;
    scaleWidth?: number;
    timestamp?: number;
  }): Promise<void> =>
    this.ffmpeg(
      `-loglevel`,
      this.cfg.logLevel,
      ...(mapDefined(timestamp, (timestamp) => [`-ss`, timestamp.toFixed(3)]) ??
        []),
      `-i`,
      input,
      ...(mapDefined(scaleWidth, (scaleWidth) => [
        `-filter:v`,
        `scale=${scaleWidth}:-1`,
      ]) ?? []),
      ...(mapDefined(fps, (fps) => [
        "-vf",
        `fps=${Array.isArray(fps) ? fps.join("/") : fps}`,
      ]) ?? [`-frames:v`, 1]),
      ...(mapDefined(quality, (quality) => [`-q:v`, quality]) ?? []),
      output
    );

  convert = async ({
    threads,
    logLevel = this.cfg.logLevel,
    input,
    metadata,
    video,
    audio,
    output,
  }: {
    threads?: number;
    logLevel?: FfmpegLogLevel;
    input: {
      file: string;
      start?: number;
      duration?: number;
    };
    metadata: boolean;
    video:
      | boolean
      | ({
          filter?: string;
        } & (
          | {
              codec: "copy";
            }
          | ({
              fps?: number;
              resize?: {
                height?: number;
                width?: number;
              };
            } & (
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
                  movflags: (
                    | "default_base_moof"
                    | "empty_moov"
                    | "faststart"
                    | "frag_every_frame"
                    | "frag_keyframe"
                  )[];
                }
              | {
                  codec: "gif";
                  loop: boolean | number;
                }
            ))
        ));
    audio:
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
              codec: "libvorbis";
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
    };
  }): Promise<void> => {
    const args = new Array<string | number>();
    args.push(`-loglevel`, logLevel);

    ifDefined(threads, (t) => args.push(`-threads`, t));

    // Input.
    ifDefined(input.start, (ss) => args.push(`-ss`, ss.toFixed(3)));
    ifDefined(input.duration, (t) => args.push(`-t`, t.toFixed(3)));
    args.push(`-i`, input.file);

    // Metadata.
    !metadata && args.push(`-map_metadata`, -1);

    // Video.
    if (typeof video == "boolean") {
      video ? args.push(`-c:v`, `copy`) : args.push(`-vn`);
    } else {
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

        args.push(`-c:v`, video.codec);
        switch (video.codec) {
          case "libx264":
            args.push(`-preset`, video.preset);
            args.push(`-crf`, video.crf);
            if (video.movflags.length) {
              args.push(`-movflags`, video.movflags.join("+"));
            }
            args.push(`-max_muxing_queue_size`, 1048576);
            break;
          case "gif":
            if (typeof video.loop == "boolean") {
              args.push(`-loop`, video.loop ? 0 : -1);
            } else {
              args.push(`-loop`, video.loop);
            }
            break;
        }
      }
    }

    // Audio.
    if (typeof audio == "boolean") {
      audio ? args.push(`-c:a`, `copy`) : args.push(`-an`);
    } else {
      ifDefined(audio.filter, (f) => args.push(`-af`, f));
      args.push(
        `-c:a`,
        audio.codec == "pcm"
          ? `pcm_${audio.signedness}${audio.bits}${audio.endianness ?? ""}`
          : audio.codec
      );
      audio.downmix && args.push(`-ac`, 1);
      audio.samplingRate && args.push(`-ar`, audio.samplingRate);
      if (audio.codec == "libmp3lame") {
        args.push(`-q:a`, audio.quality);
      }
    }

    // Output.
    ifDefined(output.format, (format) => args.push(`-f`, format));
    ifDefined(output.start, (ss) => args.push(`-ss`, ss.toFixed(3)));
    ifDefined(output.duration, (t) => args.push(`-t`, t.toFixed(3)));
    args.push(output.file);

    await this.ffmpeg(...args);
  };

  private async ffmpeg(...args: (string | number)[]): Promise<void> {
    const fullArgs = [`-hide_banner`, `-y`, ...args.map(String)];
    if (this.cfg.logCommandBeforeRunning) {
      console.debug("+", this.cfg.ffmpegCommand, ...fullArgs);
    }
    await this.cfg.runCommandWithoutStdout(this.cfg.ffmpegCommand, fullArgs);
  }
}
