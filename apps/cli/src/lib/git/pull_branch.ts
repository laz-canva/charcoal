import { getCurrentBranchName } from './branch_ops';
import { getShaOrThrow } from './get_sha';
import { CommandFailedError, runGitCommand } from './runner';

/**
 * Returns OK if the branch was fast-forwarded successfully
 * Returns CONFLICT if it could not be fast-forwarded
 */
export function pullBranch(
  remote: string,
  branchName: string
): 'OK' | 'CONFLICT' {
  try {
    runGitCommand({
      args: [`pull`, `--ff-only`, remote, branchName],
      options: { stdio: 'pipe' },
      onError: 'throw',
      resource: 'pullBranch',
    });
    return 'OK';
  } catch (e: unknown) {
    if (
      e instanceof CommandFailedError &&
      e.message.includes('fatal: Not possible to fast-forward, aborting.')
    ) {
      return 'CONFLICT';
    }
    throw e;
  }
}

/**
 * Fast-forwards the local `branchName` ref to `remote`'s tip via a plain
 * fetch refspec, without ever checking `branchName` out here. Unlike
 * `pullBranch`, this works from any worktree — and unlike a hand-rolled
 * `update-ref`, a non-force fetch refspec update is inherently fast-forward-
 * only *and* git itself refuses it outright when `branchName` is checked out
 * in a *different* worktree (reported as 'CHECKED_OUT_ELSEWHERE'), so an
 * attached trunk checkout elsewhere can never be silently desynced.
 *
 * Returns 'CHECKED_OUT_HERE' when `branchName` is the *current* worktree's
 * checked-out branch: fetching into it directly would desync the working
 * tree/index from their own branch pointer, so the caller should fall back
 * to `pullBranch` + `switchBranch` instead.
 */
export function pullBranchDetached(
  remote: string,
  branchName: string
):
  | 'OK'
  | 'UNNEEDED'
  | 'CONFLICT'
  | 'CHECKED_OUT_HERE'
  | 'CHECKED_OUT_ELSEWHERE' {
  if (getCurrentBranchName() === branchName) {
    return 'CHECKED_OUT_HERE';
  }

  const oldSha = getShaOrThrow(branchName);
  try {
    runGitCommand({
      args: [`fetch`, remote, `${branchName}:${branchName}`],
      options: { stdio: 'pipe' },
      onError: 'throw',
      resource: 'pullBranchDetached',
    });
  } catch (e: unknown) {
    if (e instanceof CommandFailedError) {
      return e.message.includes('refusing to fetch into branch')
        ? 'CHECKED_OUT_ELSEWHERE'
        : 'CONFLICT';
    }
    throw e;
  }

  const newSha = getShaOrThrow(branchName);
  return oldSha === newSha ? 'UNNEEDED' : 'OK';
}
