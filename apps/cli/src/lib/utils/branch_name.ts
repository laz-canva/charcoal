import { TContext, TContextLite } from '../context';

// 255 minus 21 (for 'refs/branch-metadata/')
const MAX_BRANCH_NAME_BYTE_LENGTH = 234;
// Base regex allows alphanumeric, dash, underscore, dot, slash
const BRANCH_NAME_REPLACE_REGEX_WITH_SLASH = /[^-_/.a-zA-Z0-9]+/g;
// When replacing slashes, don't allow them
const BRANCH_NAME_REPLACE_REGEX_NO_SLASH = /[^-_.a-zA-Z0-9]+/g;
const BRANCH_NAME_IGNORE_REGEX = /[/.]*$/;
// Separators that are interchangeable for prefix-dedup purposes: an explicit
// branch name of "user_foo" or "user/foo" both already carry a "user"-style
// prefix, even after slash-replacement has rewritten "/" to "_".
const SEPARATOR_NORMALIZE_REGEX = /[-_/.]/g;

export function replaceUnsupportedCharacters(
  input: string,
  context: TContextLite
): string {
  const strippedInput = removeUnsupportedTrailingCharacters(input);

  // Replace slashes if enabled (default: true)
  const replaceSlashes = context.userConfig.data.branchReplaceSlashes ?? true;
  const regex = replaceSlashes
    ? BRANCH_NAME_REPLACE_REGEX_NO_SLASH
    : BRANCH_NAME_REPLACE_REGEX_WITH_SLASH;

  let result = strippedInput.replace(regex, getBranchReplacement(context));

  // Convert to lowercase if enabled (default: true)
  const lowercase = context.userConfig.data.branchLowercase ?? true;
  if (lowercase) {
    result = result.toLowerCase();
  }

  return result;
}

export function removeUnsupportedTrailingCharacters(input: string): string {
  return input.replace(BRANCH_NAME_IGNORE_REGEX, '');
}

export function getBranchReplacement(context: TContextLite): string {
  return context.userConfig.data.branchReplacement ?? '_';
}

// Compares with separators normalized so a prefix check isn't fooled by
// slash-replacement (or by the caller having typed the prefix with a
// different separator) into re-adding a prefix that's already there.
function alreadyHasPrefix(sanitized: string, branchPrefix: string): boolean {
  const normalize = (s: string) => s.replace(SEPARATOR_NORMALIZE_REGEX, '_');
  return normalize(sanitized).startsWith(normalize(branchPrefix));
}

export function newBranchName(
  branchName: string | undefined,
  commitMessage: string | undefined,
  context: TContext
): string | undefined {
  const branchPrefix = context.userConfig.data.branchPrefix || '';

  if (branchName) {
    const sanitized = replaceUnsupportedCharacters(branchName, context);
    // Apply prefix to explicit branch names if enabled (default: true)
    const applyPrefixToExplicit =
      context.userConfig.data.branchPrefixExplicit ?? true;
    if (
      applyPrefixToExplicit &&
      branchPrefix &&
      !alreadyHasPrefix(sanitized, branchPrefix)
    ) {
      return (branchPrefix + sanitized).slice(0, MAX_BRANCH_NAME_BYTE_LENGTH);
    }
    return sanitized;
  }

  if (!commitMessage) {
    return undefined;
  }

  const date = new Date();
  const branchDate = getBranchDateEnabled(context)
    ? `${('0' + (date.getMonth() + 1)).slice(-2)}-${(
        '0' + date.getDate()
      ).slice(-2)}-`
    : '';

  const branchMessage = replaceUnsupportedCharacters(commitMessage, context);

  // https://stackoverflow.com/questions/60045157/what-is-the-maximum-length-of-a-github-branch-name
  // GitHub's max branch name size is computed based on a maximum ref name length of 256 bytes.
  // We only allow single-byte characters in branch names
  return (branchPrefix + branchDate + branchMessage).slice(
    0,
    MAX_BRANCH_NAME_BYTE_LENGTH
  );
}

export function setBranchPrefix(
  newPrefix: string,
  context: TContextLite
): string {
  const prefix = replaceUnsupportedCharacters(newPrefix, context);
  context.userConfig.update((data) => (data.branchPrefix = prefix));
  return prefix;
}

export function getBranchDateEnabled(context: TContextLite): boolean {
  return context.userConfig.data.branchDate ?? true;
}
