import {
  spawn,
  SpawnOptions,
  spawnSync,
  SpawnSyncOptions,
} from 'child_process';
import { cuteString } from '../utils/cute_string';
import { tracer } from '../utils/tracer';

export function runGitCommandAndSplitLines(
  params: TRunGitCommandParameters
): string[] {
  return runGitCommand(params)
    .split('\n')
    .filter((l) => l.length > 0);
}

export async function runAsyncGitCommandAndSplitLines(
  params: TRunGitCommandParameters
): Promise<string[]> {
  const output = await runAsyncGitCommand(params);
  return output.split('\n').filter((l) => l.length > 0);
}

export type TRunGitCommandParameters = {
  args: string[];
  options?: Omit<SpawnSyncOptions, 'encoding' | 'maxBuffer'> & {
    noTrim?: boolean;
  };
  onError: 'throw' | 'ignore';
  resource: string | null;
};

export function runGitCommand(params: TRunGitCommandParameters): string {
  // Only measure if we're with an existing span.
  return params.resource && tracer.currentSpanId
    ? tracer.spanSync(
        {
          name: 'spawnedCommand',
          resource: params.resource,
          meta: { runCommandArgs: cuteString(params) },
        },
        () => {
          return runGitCommandInternal(params);
        }
      )
    : runGitCommandInternal(params);
}

export type TRunAsyncGitCommandParameters = {
  args: string[];
  options?: SpawnOptions & {
    noTrim?: boolean;
  };
  onError: 'throw' | 'ignore';
  resource: string | null;
  // Tee the child's stdout/stderr to our own as it arrives (in addition to
  // the usual buffering), so a long-running command with a chatty child
  // (e.g. a pre-push hook running lint/build steps) shows live progress
  // instead of going silent until it exits.
  stream?: boolean;
};

export function runAsyncGitCommand(
  params: TRunAsyncGitCommandParameters
): Promise<string> {
  // Only measure if we're with an existing span.
  return params.resource && tracer.currentSpanId
    ? tracer.span(
        {
          name: 'spawnedCommand',
          resource: params.resource,
          meta: { runCommandArgs: cuteString(params) },
        },
        () => {
          return runAsyncGitCommandInternal(params);
        }
      )
    : runAsyncGitCommandInternal(params);
}

function runGitCommandInternal(params: TRunGitCommandParameters): string {
  const spawnSyncOutput = spawnSync('git', params.args, {
    ...params.options,
    encoding: 'utf-8',
    // 1MB should be enough to never have to worry about this
    maxBuffer: 1024 * 1024 * 1024,
    windowsHide: true,
  });

  // this is a syscall failure, not a command failure
  if (spawnSyncOutput.error) {
    throw spawnSyncOutput.error;
  }

  // if killed with a signal
  if (spawnSyncOutput.signal) {
    throw new CommandKilledError({
      command: 'git',
      args: params.args,
      signal: spawnSyncOutput.signal,
      stdout: spawnSyncOutput.stdout,
      stderr: spawnSyncOutput.stderr,
    });
  }

  // command succeeded, return output
  if (!spawnSyncOutput.status) {
    return (
      (params.options?.noTrim
        ? spawnSyncOutput.stdout
        : spawnSyncOutput.stdout?.trim()) || ''
    );
  }

  // command failed but we ignore it
  if (params.onError === 'ignore') {
    return '';
  }

  throw new CommandFailedError({
    command: 'git',
    args: params.args,
    status: spawnSyncOutput.status,
    stdout: spawnSyncOutput.stdout,
    stderr: spawnSyncOutput.stderr,
  });
}

function runAsyncGitCommandInternal(
  params: TRunAsyncGitCommandParameters
): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('git', params.args, {
      ...params.options,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Nothing writes to the child's stdin here; close it right away so a
    // hook that reads from stdin (e.g. pre-push) sees immediate EOF instead
    // of blocking, matching spawnSync's implicit behavior when no `input`
    // is given.
    proc.stdin.end();

    let stdout = '';
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', function (data) {
      stdout += data.toString();
      if (params.stream) {
        process.stdout.write(data);
      }
    });

    let stderr = '';
    proc.stderr.setEncoding('utf8');
    proc.stderr.on('data', function (data) {
      stderr += data.toString();
      if (params.stream) {
        process.stderr.write(data);
      }
    });

    proc.addListener('close', (code, signal) => {
      if (signal) {
        reject(
          new CommandKilledError({
            command: 'git',
            args: params.args,
            signal: signal,
            stdout: stdout,
            stderr: stderr,
          })
        );
      }

      if (code === 0) {
        resolve(params.options?.noTrim ? stdout : stdout.trim());
      }

      if (params.onError === 'ignore') {
        resolve('');
      }

      reject(
        new CommandFailedError({
          command: 'git',
          args: params.args,
          status: code || 1,
          stdout,
          stderr,
        })
      );
    });
  });
}

export class CommandFailedError extends Error {
  constructor(failure: {
    command: string;
    args: string[];
    status: number;
    errno?: number;
    code?: string;
    stdout: string;
    stderr: string;
  }) {
    super(
      [
        failure.errno && failure.code
          ? `Command failed with error ${failure.code} (${failure.errno}), exit code ${failure.status}:`
          : `Command failed with error exit code ${failure.status}:`,
        [failure.command].concat(failure.args).join(' '),
        failure.stdout,
        failure.stderr,
      ].join('\n')
    );
    this.name = 'CommandFailed';
  }
}

export class CommandKilledError extends Error {
  constructor(failure: {
    command: string;
    args: string[];
    signal: string;
    stdout: string;
    stderr: string;
  }) {
    super(
      [
        `Command killed with signal ${failure.signal}:`,
        [failure.command].concat(failure.args).join(' '),
        failure.stdout,
        failure.stderr,
      ].join('\n')
    );
    this.name = 'CommandKilled';
  }
}
