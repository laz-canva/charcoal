import chalk from 'chalk';
import { TContext } from '../../lib/context';
import { TScopeSpec } from '../../lib/engine/scope_spec';
import { ExitFailedError, KilledError } from '../../lib/errors';
import { CommandFailedError } from '../../lib/git/runner';
import { getPRInfoForBranches } from './prepare_branches';
import { validateBranchesToSubmit } from './validate_branches';
import { submitPullRequest } from './submit_prs';
import {
  countPrsInStack,
  createPrBodyFooter,
  footerFooter,
  footerTitle,
} from '../create_pr_body_footer';
import { execFileSync } from 'child_process';
import { restackBranches } from '../restack';

/**
 * Determine the effective out-of-sync trunk behavior based on precedence:
 * 1. CLI flag (--ignore-out-of-sync-trunk)
 * 2. Environment variable (GT_IGNORE_OUT_OF_SYNC_TRUNK)
 * 3. User config (ignoreOutOfSyncTrunk)
 * 4. Default ('prompt')
 */
function determineOutOfSyncBehavior(
  cliFlag: boolean | undefined,
  context: TContext
): 'prompt' | 'ignore' | 'warn' {
  // CLI flag takes highest priority
  if (cliFlag === true) {
    return 'ignore';
  }

  // Check environment variable
  const envVar = process.env.GT_IGNORE_OUT_OF_SYNC_TRUNK;
  if (envVar) {
    const normalized = envVar.toLowerCase();
    if (
      normalized === 'ignore' ||
      normalized === 'warn' ||
      normalized === 'prompt'
    ) {
      return normalized as 'prompt' | 'ignore' | 'warn';
    }
    context.splog.warn(
      chalk.yellow(
        `Invalid GT_IGNORE_OUT_OF_SYNC_TRUNK value: "${envVar}". ` +
          `Expected 'prompt', 'ignore', or 'warn'. Using default.`
      )
    );
  }

  // Check user config
  const userConfigValue = context.userConfig.data.ignoreOutOfSyncTrunk;
  if (userConfigValue) {
    return userConfigValue;
  }

  // Default behavior
  return 'prompt';
}

export type SubmitResult = {
  submittedPrUrls: string[];
  submittedPrNumbers: number[];
};

// eslint-disable-next-line max-lines-per-function
export async function submitAction(
  args: {
    scope: TScopeSpec;
    editPRFieldsInline: boolean | undefined;
    editTitle?: boolean | undefined;
    noEditTitle?: boolean | undefined;
    editDescription?: boolean | undefined;
    noEditDescription?: boolean | undefined;
    draft: boolean;
    publish: boolean;
    dryRun: boolean;
    updateOnly: boolean;
    reviewers: string | undefined;
    teamReviewers?: string | undefined;
    confirm: boolean;
    forcePush: boolean;
    select: boolean;
    always: boolean;
    branch: string | undefined;
    restack?: boolean | undefined;
    view?: boolean | undefined;
    web?: boolean | undefined;
    comment?: string | undefined;
    mergeWhenReady?: boolean | undefined;
    rerequestReview?: boolean | undefined;
    targetTrunk?: string | undefined;
    cli?: boolean | undefined;
    ignoreOutOfSyncTrunk?: boolean | undefined;
  },
  context: TContext
): Promise<SubmitResult> {
  const result: SubmitResult = {
    submittedPrUrls: [],
    submittedPrNumbers: [],
  };
  // Check CLI pre-condition to warn early
  if (args.draft && args.publish) {
    throw new ExitFailedError(
      `Can't use both --publish and --draft flags in one command`
    );
  }
  const populateRemoteShasPromise = context.engine.populateRemoteShas();

  // Check if trunk is out of sync with remote
  await populateRemoteShasPromise;
  const trunkOutOfSync = !context.engine.branchMatchesRemote(
    context.engine.trunk
  );

  if (trunkOutOfSync) {
    const behavior = determineOutOfSyncBehavior(
      args.ignoreOutOfSyncTrunk,
      context
    );

    switch (behavior) {
      case 'ignore':
        // Skip check entirely (no warning, no prompt)
        break;

      case 'warn':
        // Show warning but proceed
        context.splog.warn(
          chalk.yellow(
            `Your local trunk (${context.engine.trunk}) is out of sync with remote.`
          )
        );
        context.splog.info(
          chalk.blueBright(
            'Consider running `gt sync` to update your trunk. ' +
              '(Use --ignore-out-of-sync-trunk or set `gt config ignore-out-of-sync-trunk --set ignore` to skip this warning)'
          )
        );
        break;

      case 'prompt':
        // Current behavior - prompt in interactive, error in non-interactive
        context.splog.warn(
          chalk.yellow(
            `Your local trunk (${context.engine.trunk}) is out of sync with remote.`
          )
        );
        if (context.interactive) {
          const proceed = (
            await context.prompts({
              type: 'confirm',
              name: 'value',
              message:
                'Do you want to continue anyway? (Use --ignore-out-of-sync-trunk to skip this warning)',
              initial: false,
            })
          ).value;
          if (!proceed) {
            context.splog.info(
              chalk.blueBright(
                'Run `gt sync` to update your trunk before submitting.'
              )
            );
            throw new KilledError();
          }
        } else {
          throw new ExitFailedError(
            `Trunk is out of sync with remote. Run \`gt sync\` or use --ignore-out-of-sync-trunk to proceed anyway.`
          );
        }
        break;
    }
  }
  if (args.dryRun) {
    context.splog.info(
      chalk.yellow(
        `Running submit in 'dry-run' mode. No branches will be pushed and no PRs will be opened or updated.`
      )
    );
    context.splog.newline();
    args.editPRFieldsInline = false;
  }

  if (!context.interactive) {
    args.editPRFieldsInline = false;
    args.reviewers = undefined;

    context.splog.info(
      `Running in non-interactive mode. Inline prompts to fill PR fields will be skipped${
        !(args.draft || args.publish)
          ? ' and new PRs will be created in draft mode'
          : ''
      }.`
    );
    context.splog.newline();
  }

  const allBranchNames = context.engine
    .getRelativeStack(context.engine.currentBranchPrecondition, args.scope)
    .filter((branchName) => !context.engine.isTrunk(branchName));

  const branchNames = args.select
    ? await selectBranches(context, allBranchNames)
    : allBranchNames;

  if (args.restack) {
    context.splog.info(
      chalk.blueBright('🔄 Restacking branches before submitting...')
    );
    context.splog.newline();
    try {
      restackBranches([...branchNames], context);
    } catch (err) {
      context.splog.warn(
        'Some branches could not be restacked due to conflicts. Continuing with submission...'
      );
    }
    context.splog.newline();
  }

  context.splog.info(
    chalk.blueBright(
      `🥞 Validating that this Charcoal stack is ready to submit...`
    )
  );
  context.splog.newline();
  await validateBranchesToSubmit(branchNames, context);

  context.splog.info(
    chalk.blueBright(
      '✏️  Preparing to submit PRs for the following branches...'
    )
  );
  const submissionInfos = await getPRInfoForBranches(
    {
      branchNames: branchNames,
      editPRFieldsInline: args.editPRFieldsInline && context.interactive,
      draft: args.draft,
      publish: args.publish,
      updateOnly: args.updateOnly,
      reviewers: args.reviewers,
      teamReviewers: args.teamReviewers,
      dryRun: args.dryRun,
      select: args.select,
      always: args.always,
    },
    context
  );

  if (
    await shouldAbort(
      { ...args, hasAnyPrs: submissionInfos.length > 0 },
      context
    )
  ) {
    // Even if no branches need pushing, update dependency trees for existing PRs
    context.splog.info(
      chalk.blueBright('\n🌳 Updating dependency trees in PR bodies...')
    );
    for (const branch of branchNames) {
      const prInfo = context.engine.getPrInfo(branch);
      if (!prInfo?.number) {
        continue;
      }
      const updatedBody = resolveUpdatedPrBody(context, branch, prInfo.body);
      const prFooterChanged = updatedBody !== prInfo.body;
      if (prFooterChanged && !args.dryRun) {
        execFileSync('gh', [
          'pr',
          'edit',
          `${prInfo.number}`,
          '--body',
          updatedBody,
        ]);
      }
      context.splog.info(
        `${chalk.green(branch)}: ${prInfo.url} (${
          prFooterChanged ? chalk.yellow('Updated') : 'No-op'
        })`
      );
    }
    return result;
  }

  context.splog.info(
    chalk.blueBright('📨 Pushing to remote and creating/updating PRs...')
  );

  for (const submissionInfo of submissionInfos) {
    try {
      context.engine.pushBranch(submissionInfo.head, args.forcePush);
    } catch (err) {
      if (
        err instanceof CommandFailedError &&
        err.message.includes('stale info')
      ) {
        throw new ExitFailedError(
          [
            `Force-with-lease push of ${chalk.yellow(
              submissionInfo.head
            )} failed due to external changes to the remote branch.`,
            'If you are collaborating on this stack, try `gt get --downstack` to pull in changes.',
            'Alternatively, use the `--force` option of this command to bypass the stale info warning.',
          ].join('\n')
        );
      }
      throw err;
    }

    const prResult = await submitPullRequest([submissionInfo], context);
    if (prResult) {
      result.submittedPrUrls.push(prResult.prUrl);
      result.submittedPrNumbers.push(prResult.prNumber);
    }
  }

  // Update dependency trees AFTER all PRs have been created/updated
  // so that newly created PRs are included in the tree
  context.splog.info(
    chalk.blueBright('\n🌳 Updating dependency trees in PR bodies...')
  );
  for (const branch of branchNames) {
    const prInfo = context.engine.getPrInfo(branch);
    if (!prInfo?.number) {
      continue;
    }
    const updatedBody = resolveUpdatedPrBody(context, branch, prInfo.body);
    const prFooterChanged = updatedBody !== prInfo.body;
    if (prFooterChanged && !args.dryRun) {
      execFileSync('gh', [
        'pr',
        'edit',
        `${prInfo.number}`,
        '--body',
        updatedBody,
      ]);
    }
    context.splog.info(
      `${chalk.green(branch)}: ${prInfo.url} (${
        prFooterChanged ? chalk.yellow('Updated') : 'No-op'
      })`
    );
  }

  if (args.comment && result.submittedPrNumbers.length > 0) {
    context.splog.info(chalk.blueBright('\n💬 Adding comments to PRs...'));
    for (const prNumber of result.submittedPrNumbers) {
      try {
        execFileSync('gh', [
          'pr',
          'comment',
          `${prNumber}`,
          '--body',
          args.comment,
        ]);
        context.splog.info(`Added comment to PR #${prNumber}`);
      } catch (err) {
        context.splog.warn(`Failed to add comment to PR #${prNumber}`);
      }
    }
  }

  if (args.mergeWhenReady && result.submittedPrNumbers.length > 0) {
    context.splog.info(chalk.blueBright('\n🔀 Enabling auto-merge for PRs...'));
    for (const prNumber of result.submittedPrNumbers) {
      try {
        execFileSync('gh', [
          'pr',
          'merge',
          `${prNumber}`,
          '--auto',
          '--squash',
        ]);
        context.splog.info(`Enabled auto-merge for PR #${prNumber}`);
      } catch (err) {
        context.splog.warn(
          `Failed to enable auto-merge for PR #${prNumber}. ` +
            'This may require admin settings to be enabled on the repository.'
        );
      }
    }
  }

  if (args.rerequestReview && result.submittedPrNumbers.length > 0) {
    context.splog.info(
      chalk.blueBright('\n🔄 Re-requesting reviews for PRs...')
    );
    for (const prNumber of result.submittedPrNumbers) {
      try {
        execFileSync('gh', [
          'api',
          '--method',
          'POST',
          `/repos/{owner}/{repo}/pulls/${prNumber}/requested_reviewers`,
          '-f',
          'reviewers=[]',
        ]);
        context.splog.info(`Re-requested reviews for PR #${prNumber}`);
      } catch (err) {
        context.splog.warn(
          `Failed to re-request reviews for PR #${prNumber}. ` +
            'You may need to manually re-request reviews.'
        );
      }
    }
  }

  if (!context.interactive) {
    return result;
  }

  return result;
}

export function stripPrBodyFooter(body: string | undefined): string {
  if (!body) {
    return '';
  }

  // Get the core title and footer text without extra whitespace
  const titleText = footerTitle.trim().replace(/^\s*\n+|\n+\s*$/g, '');
  const footerText = footerFooter.trim().replace(/^\s*\n+|\n+\s*$/g, '');

  const escapedTitleText = titleText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escapedFooterText = footerText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Remove ALL instances of the footer section globally.
  // This handles cases where external tools (e.g., Jira bot) insert content
  // after the footer, causing duplicates on subsequent runs.
  // Match optional leading newlines before the title to preserve formatting.
  const footerPattern = new RegExp(
    `\\n*${escapedTitleText}[\\s\\S]*?${escapedFooterText}`,
    'g'
  );

  return body.replace(footerPattern, '');
}

export function updatePrBodyFooter(
  body: string | undefined,
  footer: string
): string {
  if (!body) {
    return footer;
  }
  return stripPrBodyFooter(body) + footer;
}

function resolveUpdatedPrBody(
  context: TContext,
  branch: string,
  currentBody: string | undefined
): string {
  const showFooter =
    countPrsInStack(context, branch) > 1 ||
    context.userConfig.data.submitFooterOnSinglePr === true;

  if (showFooter) {
    return updatePrBodyFooter(currentBody, createPrBodyFooter(context, branch));
  }
  return stripPrBodyFooter(currentBody);
}

async function selectBranches(
  context: TContext,
  branchNames: string[]
): Promise<string[]> {
  const result = [];
  for (const branchName of branchNames) {
    const selected = (
      await context.prompts({
        name: 'value',
        initial: true,
        type: 'confirm',
        message: `Would you like to submit ${chalk.cyan(branchName)}?`,
      })
    ).value;
    // Clear the prompt result
    process.stdout.moveCursor(0, -1);
    process.stdout.clearLine(1);
    if (selected) {
      result.push(branchName);
    }
  }
  return result;
}

async function shouldAbort(
  args: { dryRun: boolean; confirm: boolean; hasAnyPrs: boolean },
  context: TContext
): Promise<boolean> {
  if (args.dryRun) {
    context.splog.info(chalk.blueBright('✅ Dry run complete.'));
    return true;
  }

  if (!args.hasAnyPrs) {
    context.splog.info(chalk.blueBright('🆗 All PRs up to date.'));
    return true;
  }

  if (
    context.interactive &&
    args.confirm &&
    !(
      await context.prompts({
        type: 'confirm',
        name: 'value',
        message: 'Continue with this submit operation?',
        initial: true,
      })
    ).value
  ) {
    context.splog.info(chalk.blueBright('🛑 Aborted submit.'));
    throw new KilledError();
  }

  return false;
}
