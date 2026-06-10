import { spawnSync } from 'child_process';
import chalk from 'chalk';
import { TContext } from '../lib/context';
import { SCOPE } from '../lib/engine/scope_spec';
import { ExitFailedError, RebaseConflictError } from '../lib/errors';
import { rebaseInProgress } from '../lib/git/rebase_in_progress';
import { runGitCommand } from '../lib/git/runner';
import { persistContinuation } from './persist_continuation';
import { printConflictStatus } from './print_conflict_status';
import { restackBranches } from './restack';

function checkGitAbsorbInstalled(): void {
  const checkAbsorb = spawnSync('git', ['absorb', '--version'], {
    stdio: 'pipe',
  });
  if (checkAbsorb.status !== 0) {
    throw new ExitFailedError(
      [
        `git-absorb is not installed.`,
        `Please install it to use this command: https://github.com/tummychow/git-absorb#installation`,
      ].join('\n')
    );
  }
}

function stageChanges(opts: { all: boolean; patch: boolean }): void {
  if (opts.all) {
    spawnSync('git', ['add', '-u'], { stdio: 'inherit' });
  }
  if (opts.patch) {
    spawnSync('git', ['add', '-p'], { stdio: 'inherit' });
  }
}

function hasStagedChanges(): boolean {
  const result = spawnSync('git', ['diff', '--cached', '--quiet'], {
    stdio: 'pipe',
  });
  return result.status !== 0;
}

interface DryRunResult {
  wouldCommitLines: string[];
  hasWarnings: boolean;
  rawOutput: string;
}

function runDryRun(base: string): DryRunResult {
  const result = spawnSync('git', ['absorb', '--base', base, '--force-author', '--dry-run'], {
    stdio: 'pipe',
    encoding: 'utf-8',
  });

  const rawOutput = (result.stderr || '').trim();
  const lines = rawOutput.split('\n');

  return {
    wouldCommitLines: lines.filter((line) =>
      line.includes('would have committed')
    ),
    hasWarnings: lines.some((line) => line.includes('WARN')),
    rawOutput,
  };
}

function displayAbsorbPlan(dryRun: DryRunResult, context: TContext): void {
  context.splog.info(
    `Found ${chalk.cyan(dryRun.wouldCommitLines.length)} hunk(s) to absorb:`
  );
  context.splog.newline();

  for (const line of dryRun.wouldCommitLines) {
    const match = line.match(/fixup:\s*(.+)$/);
    if (match) {
      context.splog.info(`  ${chalk.green('→')} ${match[1]}`);
    }
  }

  context.splog.newline();

  if (dryRun.hasWarnings) {
    context.splog.warn(
      'Some hunks could not be matched and will remain staged.'
    );
  }
}

type ExecuteAbsorbResult = 'DONE' | 'CONFLICT';

function executeAbsorb(base: string): ExecuteAbsorbResult {
  // Run git absorb without --and-rebase so we can control the rebase ourselves
  const absorbResult = spawnSync('git', ['absorb', '--base', base, '--force-author'], {
    stdio: 'inherit',
  });

  if (absorbResult.status !== 0) {
    throw new ExitFailedError('git absorb failed');
  }

  // Run rebase with autosquash and update-refs to squash fixup commits
  // and update intermediate branch refs in the stack
  const rebaseResult = spawnSync(
    'git',
    ['rebase', '--autosquash', '--update-refs', '-i', base],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        GIT_SEQUENCE_EDITOR: ':',
      },
    }
  );

  if (rebaseResult.status !== 0) {
    if (rebaseInProgress()) {
      return 'CONFLICT';
    }
    throw new ExitFailedError('git rebase failed');
  }

  return 'DONE';
}

export async function absorbAction(
  opts: {
    all: boolean;
    dryRun: boolean;
    force: boolean;
    patch: boolean;
  },
  context: TContext
): Promise<void> {
  checkGitAbsorbInstalled();
  stageChanges(opts);

  if (!hasStagedChanges()) {
    context.splog.info('No staged changes to absorb.');
    return;
  }

  const trunk = context.engine.trunk;
  const dryRun = runDryRun(trunk);

  if (dryRun.wouldCommitLines.length === 0) {
    context.splog.info(
      'No hunks could be matched to commits. Changes remain staged.'
    );
    if (dryRun.rawOutput) {
      context.splog.info(chalk.dim(dryRun.rawOutput));
    }
    return;
  }

  displayAbsorbPlan(dryRun, context);

  if (opts.dryRun) {
    return;
  }

  if (!opts.force && context.interactive) {
    const response = await context.prompts({
      type: 'confirm',
      name: 'value',
      message: 'Absorb these changes?',
      initial: true,
    });

    if (response.value !== true) {
      context.splog.info('Aborted.');
      return;
    }
  }

  // Save the current branch and stack info BEFORE absorb
  // because the rebase will invalidate the metadata
  const currentBranch = context.engine.currentBranchPrecondition;
  const fullStack = context.engine.getRelativeStack(currentBranch, SCOPE.STACK);

  const absorbResult = executeAbsorb(trunk);

  if (absorbResult === 'CONFLICT') {
    const trunkSha = runGitCommand({
      args: ['rev-parse', trunk],
      onError: 'throw',
      resource: null,
    });
    persistContinuation(
      {
        branchesToRestack: fullStack,
        rebasedBranchBase: trunkSha,
        rebuildAfterContinue: true,
      },
      context
    );
    printConflictStatus(
      `Hit conflict during absorb rebase.`,
      context
    );
    throw new RebaseConflictError();
  }

  context.engine.rebuild();

  // Restack the entire stack to fix metadata after rebase
  // The --update-refs flag updated git branch refs, but gt metadata needs fixing
  if (fullStack.length > 0) {
    context.splog.info(`Restacking ${fullStack.length} branch(es)...`);
    restackBranches(fullStack, context);
  }

  context.splog.info(
    `Absorbed ${chalk.cyan(dryRun.wouldCommitLines.length)} hunk(s).`
  );
}
