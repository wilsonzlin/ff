import {execFile, spawn} from 'child_process';
import {ifDefined} from 'extlib/js/optional/cond';
import {mapDefined} from 'extlib/js/optional/map';

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
    bitRate: number;
    sampleRate: number;
  };
  duration: number;
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
  runCommandWithoutStdout: (command: string, args: string[]) => Promise<void>;
  runCommandWithStdout: (command: string, args: string[]) => Promise<string>;
}

const createCfg = ({
  ffmpegCommand = 'ffmpeg',
  ffprobeCommand = 'ffprobe',
  logLevel = FfmpegLogLevel.ERROR,
  runCommandWithoutStdout = job,
  runCommandWithStdout = cmd,
}: Partial<FfConfig>): FfConfig => ({
  ffmpegCommand,
  ffprobeCommand,
  logLevel,
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
    const raw = (await cmd(
      this.cfg.ffprobeCommand,
      [
        `-v`, `error`,
        `-show_entries`, `stream=codec_type,codec_name,width,height,r_frame_rate:format=duration`,
        `-ignore_chapters`, 1,
        file,
      ].map(String),
    )).trim();

    const properties = {} as MediaFileProperties;
    for (const [_, sectionName, sectionData] of raw.matchAll(/\[([A-Z]+)]([^\[]*)\[\/\1]/g)) {
      const values: { [key: string]: string } = Object.fromEntries(
        sectionData
          .trim()
          .split(/[\r\n]+/)
          .map(kv => kv.split('=', 2)),
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
            bitRate: Number.parseInt(values.bit_rate, 10),
            channels: Number.parseInt(values.channels, 10),
            sampleRate: Number.parseInt(values.sample_rate, 10),
          };
          break;
        }
        break;
      case 'FORMAT':
        properties.duration = Number.parseFloat(values.duration);
        break;
      }
    }
    return properties;
  };

  extractFrame = async ({
    input,
    timestamp,
    output,
    scaleWidth,
    // Do not use a default value, as not all formats use this.
    quality,
  }: {
    input: string,
    timestamp: number,
    output: string,
    scaleWidth?: number,
    quality?: number,
  }): Promise<void> =>
    this.ffmpeg(
      `-loglevel`, this.cfg.logLevel,
      `-ss`, timestamp.toFixed(3),
      `-i`, input,
      ...mapDefined(scaleWidth, scaleWidth => [`-filter:v`, `scale=${scaleWidth}:-1`]) ?? [],
      `-frames:v`, 1,
      ...mapDefined(quality, quality => [`-q:v`, quality]) ?? [],
      output,
    );

  convert = async ({
    logLevel = this.cfg.logLevel,
    input,
    metadata,
    video,
    audio,
    output,
  }: {
    logLevel?: FfmpegLogLevel,
    input: {
      file: string;
      start?: number;
      duration?: number;
    };
    metadata: boolean;
    video: boolean | ({
      fps?: number;
      resize?: { width: number };
    } & ({
      codec: 'libx264';
      preset: 'ultrafast' | 'superfast' | 'veryfast' | 'faster' | 'fast' | 'medium' | 'slow' | 'slower' | 'veryslow';
      crf: number;
      faststart: boolean;
    } | {
      codec: 'gif';
      loop: boolean | number;
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
      ifDefined(video.resize, ({width}) => filters.push(`scale=${width}:-2`));
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
    await job(this.cfg.ffmpegCommand, [`-hide_banner`, `-y`, ...args.map(String)]);
  }
}
