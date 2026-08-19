import chalk from 'chalk';
import { TContext } from '../../lib/context';
import { SCOPE } from '../../lib/engine/scope_spec';
import { KilledError } from '../../lib/errors';
import { uncommittedTrackedChangesPrecondition } from '../../lib/preconditions';
import { restackBranches } from '../restack';
import { cleanBranches } from './clean_branches';
import { syncPrInfo } from '../sync_pr_info';

export async function syncAction(
  opts: {
    pull: boolean;
    force: boolean;
    delete: boolean;
    showDeleteProgress: boolean;
    restack: boolean;
    all?: boolean;
  },
  context: TContext
): Promise<void> {
  // Note: --all flag is accepted but only single trunk is currently supported
  uncommittedTrackedChangesPrecondition();

  if (opts.pull) {
    await pullTrunk(opts.force, context);
  }

  const branchesToRestack: string[] = [];

  await syncPrInfo(context.engine.allBranchNames, context);

  if (opts.delete) {
    context.splog.info(
      `🧹 Checking if any branches have been merged/closed and can be deleted...`
    );
    const branchesWithNewParents = await cleanBranches(
      { showDeleteProgress: opts.showDeleteProgress, force: opts.force },
      context
    );
    if (!opts.force) {
      context.splog.tip(
        'Try the `--force` flag to delete merged branches without prompting for each.'
      );
    }
    if (!opts.restack) {
      return;
    }

    branchesWithNewParents
      .flatMap((branchName) =>
        context.engine.getRelativeStack(branchName, SCOPE.UPSTACK)
      )
      .forEach((branchName) => branchesToRestack.push(branchName));
  }
  if (!opts.restack) {
    return;
  }

  const currentBranch = context.engine.currentBranch;

  // The below conditional doesn't handle the trunk case because
  // isBranchTracked returns false for trunk.  Also, in this case
  // we don't want to append to our existing branchesToRestack
  // because trunk's stack will include everything anyway.
  if (currentBranch && context.engine.isTrunk(currentBranch)) {
    restackBranches(
      context.engine.getRelativeStack(currentBranch, SCOPE.STACK),
      context
    );
    return;
  }

  if (
    currentBranch &&
    context.engine.isBranchTracked(currentBranch) &&
    !branchesToRestack.includes(currentBranch)
  ) {
    context.engine
      .getRelativeStack(currentBranch, SCOPE.STACK)
      .forEach((branchName) => branchesToRestack.push(branchName));
  }

  restackBranches(branchesToRestack, context);
}

export async function pullTrunk(
  force: boolean,
  context: TContext
): Promise<void> {
  context.splog.info(
    `🌲 Pulling ${chalk.cyan(context.engine.trunk)} from remote...`
  );
  const pullResult = context.engine.pullTrunk();
  if (pullResult === 'PULL_SKIPPED') {
    context.splog.info(
      `${chalk.yellow(
        context.engine.trunk
      )} is checked out in another worktree — skipping, it'll catch up next sync from there.`
    );
    return;
  }
  if (pullResult !== 'PULL_CONFLICT') {
    context.splog.info(
      pullResult === 'PULL_UNNEEDED'
        ? `${chalk.green(context.engine.trunk)} is up to date.`
        : `${chalk.green(context.engine.trunk)} fast-forwarded to ${chalk.gray(
            context.engine.getRevision(context.engine.trunk)
          )}.`
    );
    return;
  }

  // If trunk cannot be fast-forwarded, prompt the user to reset to remote
  context.splog.warn(
    `${chalk.blueBright(context.engine.trunk)} could not be fast-forwarded.`
  );
  if (
    force ||
    (context.interactive &&
      (
        await context.prompts({
          type: 'confirm',
          name: 'value',
          message: `Overwrite ${chalk.yellow(
            context.engine.trunk
          )} with the version from remote?`,
          initial: true,
        })
      ).value)
  ) {
    context.engine.resetTrunkToRemote();
    context.splog.info(
      `${chalk.green(context.engine.trunk)} set to ${chalk.gray(
        context.engine.getRevision(context.engine.trunk)
      )}.`
    );
  } else {
    throw new KilledError();
  }
}
