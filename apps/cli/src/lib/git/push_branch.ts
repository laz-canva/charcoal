import { runAsyncGitCommand } from './runner';

export async function pushBranch(opts: {
  remote: string;
  branchName: string;
  noVerify: boolean;
  forcePush: boolean;
}): Promise<void> {
  const forceOption = opts.forcePush ? '--force' : '--force-with-lease';

  // Runs async (rather than the sync spawnSync-based runGitCommand) and
  // streams output live: `git push` runs the pre-push hook (taz check --
  // lint/build/tests) as a child whose stdout/stderr would otherwise sit
  // buffered until the whole push finishes, making a slow-but-healthy hook
  // run indistinguishable from a hang.
  await runAsyncGitCommand({
    args: [
      `push`,
      `-u`,
      opts.remote,
      forceOption,
      opts.branchName,
      ...(opts.noVerify ? ['--no-verify'] : []),
    ],
    onError: 'throw',
    resource: 'pushBranch',
    stream: true,
  });
}
