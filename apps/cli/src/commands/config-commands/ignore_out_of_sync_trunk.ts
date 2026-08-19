import chalk from 'chalk';
import yargs from 'yargs';
import { graphiteWithoutRepo } from '../../lib/runner';

const args = {
  set: {
    demandOption: false,
    default: '',
    type: 'string',
    describe:
      "Set behavior when trunk is out of sync: 'prompt' (ask user), 'ignore' (skip check), 'warn' (show warning but proceed). eg --set ignore.",
    choices: ['prompt', 'ignore', 'warn'],
  },
  unset: {
    demandOption: false,
    default: false,
    type: 'boolean',
    describe:
      'Unset out-of-sync trunk behavior. Will default to prompting user.',
  },
} as const;

type argsT = yargs.Arguments<yargs.InferredOptionTypes<typeof args>>;
export const command = 'ignore-out-of-sync-trunk';
export const description =
  'Configure behavior when local trunk is out of sync with remote.';
export const canonical = 'config ignore-out-of-sync-trunk';
export const builder = args;
export const handler = async (argv: argsT): Promise<void> => {
  return graphiteWithoutRepo(argv, canonical, async (context) => {
    if (argv.set) {
      const value = argv.set as 'prompt' | 'ignore' | 'warn';
      context.userConfig.update((data) => (data.ignoreOutOfSyncTrunk = value));
      context.splog.info(
        `Out-of-sync trunk behavior set to ${chalk.cyan(value)}`
      );
      if (value === 'prompt') {
        context.splog.info(
          `  ${chalk.gray(
            '→ Will prompt for confirmation when trunk is out of sync'
          )}`
        );
      } else if (value === 'ignore') {
        context.splog.info(
          `  ${chalk.gray('→ Will skip out-of-sync trunk check entirely')}`
        );
      } else if (value === 'warn') {
        context.splog.info(
          `  ${chalk.gray('→ Will show warning but proceed anyway')}`
        );
      }
    } else if (argv.unset) {
      context.userConfig.update(
        (data) => (data.ignoreOutOfSyncTrunk = undefined)
      );
      context.splog.info(
        `Out-of-sync trunk behavior unset. Will default to ${chalk.cyan(
          'prompt'
        )}`
      );
    } else {
      const currentValue =
        context.userConfig.data.ignoreOutOfSyncTrunk ?? 'prompt';
      context.splog.info(
        `Current setting: ${chalk.cyan(currentValue)}${
          context.userConfig.data.ignoreOutOfSyncTrunk === undefined
            ? chalk.gray(' (default)')
            : ''
        }`
      );
      if (currentValue === 'prompt') {
        context.splog.info(
          `  ${chalk.gray(
            '→ Will prompt for confirmation when trunk is out of sync'
          )}`
        );
      } else if (currentValue === 'ignore') {
        context.splog.info(
          `  ${chalk.gray('→ Will skip out-of-sync trunk check entirely')}`
        );
      } else if (currentValue === 'warn') {
        context.splog.info(
          `  ${chalk.gray('→ Will show warning but proceed anyway')}`
        );
      }
      context.splog.newline();
      context.splog.info(
        `To change: ${chalk.cyan(
          'gt config ignore-out-of-sync-trunk --set <prompt|ignore|warn>'
        )}`
      );
      context.splog.info(
        `One-time override: ${chalk.cyan(
          'GT_IGNORE_OUT_OF_SYNC_TRUNK=ignore gt submit'
        )}`
      );
      context.splog.info(
        `Or use CLI flag: ${chalk.cyan('gt submit --ignore-out-of-sync-trunk')}`
      );
    }
  });
};
