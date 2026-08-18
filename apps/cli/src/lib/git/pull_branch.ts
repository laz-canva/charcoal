import { getCurrentBranchName } from './branch_ops';
import { getShaOrThrow } from './get_sha';
import { getMergeBase } from './merge_base';
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

// Disposable ref `pullBranchDetached` fetches into before comparing/moving
// `branchName`. Never a real branch, so nothing ever has it checked out.
const DETACHED_PULL_HEAD = 'refs/gt-metadata/DETACHED_PULL_HEAD';

/**
 * Fast-forwards the local `branchName` ref to `remote`'s tip via a direct
 * ref update, without ever checking `branchName` out. Unlike `pullBranch`,
 * this works from any worktree and does not conflict with `branchName`
 * being checked out in a *different* worktree (e.g. a dedicated trunk
 * checkout) — the underlying `update-ref` moves the ref directly, and its
 * compare-and-swap form makes concurrent callers (two worktrees running
 * `gt sync` at once) race safely instead of corrupting each other.
 *
 * Returns 'CHECKED_OUT_HERE' when `branchName` is the *current* worktree's
 * checked-out branch: moving the ref out from under it here would desync
 * the working tree/index from their own branch pointer, so the caller
 * should fall back to `pullBranch` + `switchBranch` instead.
 */
export function pullBranchDetached(
  remote: string,
  branchName: string
): 'OK' | 'UNNEEDED' | 'CONFLICT' | 'CHECKED_OUT_HERE' {
  if (getCurrentBranchName() === branchName) {
    return 'CHECKED_OUT_HERE';
  }

  runGitCommand({
    args: [`fetch`, `-f`, remote, `${branchName}:${DETACHED_PULL_HEAD}`],
    options: { stdio: 'pipe' },
    onError: 'throw',
    resource: 'pullBranchDetached',
  });

  const oldSha = getShaOrThrow(branchName);
  const newSha = getShaOrThrow(DETACHED_PULL_HEAD);
  if (oldSha === newSha) {
    return 'UNNEEDED';
  }
  if (getMergeBase(oldSha, newSha) !== oldSha) {
    return 'CONFLICT';
  }

  try {
    // The trailing <old-value> makes this a compare-and-swap: git refuses
    // (and we report a CONFLICT) if something else moved branchName since
    // oldSha was read above, rather than silently clobbering it.
    runGitCommand({
      args: [`update-ref`, `refs/heads/${branchName}`, newSha, oldSha],
      options: { stdio: 'pipe' },
      onError: 'throw',
      resource: 'pullBranchDetached',
    });
  } catch (e: unknown) {
    if (e instanceof CommandFailedError) {
      return 'CONFLICT';
    }
    throw e;
  }
  return 'OK';
}
