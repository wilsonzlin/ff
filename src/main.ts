import {execFile, spawn} from 'child_process';
import ifDefined from 'extlib/js/ifDefined';
import mapDefined from 'extlib/js/mapDefined';
import splitString from 'extlib/js/splitString';

const cmd = async (command: string, args: string[]): Promise<string> =>
  new Promise((resolve, reject) =>
    execFile(command, args, (error, stdout, stderr) => {
      if (error) {
        reject(error);
      } else if (stderr) {
        reject(new Error(`stderr: ${stderr}`));
      } else {
        resolve(stdout);
      }
    }));

const job = async (command: string, args: string[]): Promise<void> =>
  new Promise(resolve => {
    const proc = spawn(command, args.map(String), {stdio: ['ignore', 'inherit', 'inherit']});
    proc.on('error', console.error);
    proc.on('exit', () => resolve());
  });


export type MediaFileProperties = {
  video?: {
    codec: string;
    height: number;
    width: number;
    fps: number;
  };
  audio?: {
    codec: string;
    channels: number;
    bitRate?: number;
    sampleRate: number;
  };
  duration: number;
  format: string;
  size: number;
  metadata: {
    [name: string]: string;
  }
};

export enum FfmpegLogLevel {
  QUIET = 'quiet',
  PANIC = 'panic',
  FATAL = 'fatal',
  ERROR = 'error',
  WARNING = 'warning',
  INFO = 'info',
  VERBOSE = 'verbose',
  DEBUG = 'debug',
  TRACE = 'trace',
}

export type FfConfig = {
  ffprobeCommand: string;
  ffmpegCommand: string;
  logLevel: FfmpegLogLevel;
  logCommandBeforeRunning: boolean;
  runCommandWithoutStdout: (command: string, args: string[]) => Promise<void>;
  runCommandWithStdout: (command: string, args: string[]) => Promise<string>;
}

const createCfg = ({
  ffmpegCommand = 'ffmpeg',
  ffprobeCommand = 'ffprobe',
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

  constructor (
    cfg: Partial<FfConfig> = {},
  ) {
    this.cfg = createCfg(cfg);
  }

  probe = async (file: string): Promise<MediaFileProperties> => {
    const raw = (await this.cfg.runCommandWithStdout(
      this.cfg.ffprobeCommand,
      [
        `-v`,
        `error`,
        `-show_entries`,
        `stream=codec_type,codec_name,width,height,r_frame_rate,bit_rate,channels,sample_rate:format=duration,size,format_name:format_tags`,
        // TODO We originally used ignore_chapters to suppress errors with some corrupted videos, but the option will cause an error on codecs that don't have the concept of chapters (e.g. AAC).
        file,
      ].map(String),
    )).trim();

    const properties = {} as MediaFileProperties;
    for (const [, , sectionName, sectionData] of raw.matchAll(/(^|\n)\[([A-Z]+)](.*?)\n\[\/\2]/g)) {
      const values: { [key: string]: string } = Object.fromEntries(
        sectionData
          .trim()
          .split(/[\r\n]+/)
          .map(kv => splitString(kv, '=', 2)),
      );
      switch (sectionName) {
      case 'STREAM':
        switch (values.codec_type) {
        case 'video':
          properties.video = {
            codec: values.codec_name,
            height: Number.parseInt(values.height, 10),
            width: Number.parseInt(values.width, 10),
            fps: values.r_frame_rate
              .split('/')
              .map(p => Number.parseInt(p, 10))
              .reduce((numerator, denominator) => numerator / denominator),
          };
          break;
        case 'audio':
          properties.audio = {
            codec: values.codec_name,
            bitRate: values.bit_rate === 'N/A' ? undefined : Number.parseInt(values.bit_rate, 10),
            channels: Number.parseInt(values.channels, 10),
            sampleRate: Number.parseInt(values.sample_rate, 10),
          };
          break;
        }
        break;
      case 'FORMAT':
        properties.duration = Number.parseFloat(values.duration);
        properties.format = values.format_name;
        properties.size = Number.parseInt(values.size);
        properties.metadata = Object.create(null);
        for (const [prop, val] of Object.entries(values)) {
          if (prop.startsWith('TAG:')) {
            properties.metadata[prop.slice(4)] = val;
          }
        }
        break;
      }
    }
    return properties;
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
    fps?: number | [number, number],
    input: string,
    output: string,
    quality?: number,
    scaleWidth?: number,
    timestamp?: number,
  }): Promise<void> =>
    this.ffmpeg(
      `-loglevel`, this.cfg.logLevel,
      ...mapDefined(timestamp, timestamp => [`-ss`, timestamp.toFixed(3)]) ?? [],
      `-i`, input,
      ...mapDefined(scaleWidth, scaleWidth => [`-filter:v`, `scale=${scaleWidth}:-1`]) ?? [],
      ...mapDefined(fps, fps => ['-vf', `fps=${Array.isArray(fps) ? fps.join('/') : fps}`]) ?? [`-frames:v`, 1],
      ...mapDefined(quality, quality => [`-q:v`, quality]) ?? [],
      output,
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
    threads?: number,
    logLevel?: FfmpegLogLevel,
    input: {
      file: string;
      start?: number;
      duration?: number;
    };
    metadata: boolean;
    video: boolean | ({
      fps?: number;
      resize?: {
        height?: number;
        width?: number;
      };
    } & ({
      codec: 'libx264';
      preset: 'ultrafast' | 'superfast' | 'veryfast' | 'faster' | 'fast' | 'medium' | 'slow' | 'slower' | 'veryslow';
      crf: number;
      faststart: boolean;
    } | {
      codec: 'gif';
      loop: boolean | number;
    } | {
      codec: 'copy';
    }));
    audio: boolean | {
      samplingRate?: number;
      // Mix a single stereo stream into a mono stream.
      downmix?: boolean;
    } & ({
      codec: 'aac';
    } | {
      codec: 'flac';
    } | {
      codec: 'libmp3lame';
      quality: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
    } | {
      codec: 'pcm';
      signedness: 's' | 'u';
      bits: 8 | 16 | 24 | 32 | 64;
      // Omit if 8 bits.
      endianness?: 'be' | 'le';
    } | {
      codec: 'copy';
    });
    output: {
      format?: string;
      file: string;
      start?: number;
      duration?: number;
    };
  }): Promise<void> => {
    const args = new Array<string | number>();
    args.push(`-loglevel`, logLevel);

    ifDefined(threads, t => args.push(`-threads`, t));

    // Input.
    ifDefined(input.start, ss => args.push(`-ss`, ss.toFixed(3)));
    ifDefined(input.duration, t => args.push(`-t`, t.toFixed(3)));
    args.push(`-i`, input.file);

    // Metadata.
    !metadata && args.push(`-map_metadata`, -1);

    // Video.
    if (typeof video == 'boolean') {
      video ? args.push(`-c:v`, `copy`) : args.push(`-vn`);
    } else {
      const filters = new Array<string>();
      ifDefined(video.fps, (fps) => filters.push(`fps=${fps}`));
      // `-2` means proportional width/height.
      ifDefined(video.resize, ({width = -2, height = -2}) => filters.push(`scale=${width}:${height}`));
      if (filters.length) {
        args.push(`-filter:v`, filters.join(','));
      }

      args.push(`-c:v`, video.codec);
      switch (video.codec) {
      case 'libx264':
        args.push(`-preset`, video.preset);
        args.push(`-crf`, video.crf);
        video.faststart && args.push(`-movflags`, `faststart`);
        args.push(`-max_muxing_queue_size`, 1048576);
        break;
      case 'gif':
        if (typeof video.loop == 'boolean') {
          args.push(`-loop`, video.loop ? 0 : -1);
        } else {
          args.push(`-loop`, video.loop);
        }
        break;
      }
    }

    // Audio.
    if (typeof audio == 'boolean') {
      audio ? args.push(`-c:a`, `copy`) : args.push(`-an`);
    } else {
      args.push(`-c:a`, audio.codec == 'pcm' ? `pcm_${audio.signedness}${audio.bits}${audio.endianness ?? ''}` : audio.codec);
      audio.downmix && args.push(`-ac`, 1);
      audio.samplingRate && args.push(`-ar`, audio.samplingRate);
      if (audio.codec == 'libmp3lame') {
        args.push(`-q:a`, audio.quality);
      }
    }

    // Output.
    ifDefined(output.format, format => args.push(`-f`, format));
    ifDefined(output.start, ss => args.push(`-ss`, ss.toFixed(3)));
    ifDefined(output.duration, t => args.push(`-t`, t.toFixed(3)));
    args.push(output.file);

    await this.ffmpeg(...args);
  };

  private async ffmpeg (...args: (string | number)[]): Promise<void> {
    const fullArgs = [`-hide_banner`, `-y`, ...args.map(String)];
    if (this.cfg.logCommandBeforeRunning) {
      console.debug('+', this.cfg.ffmpegCommand, ...fullArgs);
    }
    await this.cfg.runCommandWithoutStdout(this.cfg.ffmpegCommand, fullArgs);
  }
}
