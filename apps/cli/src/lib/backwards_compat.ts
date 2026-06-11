function exitWithError(message: string): never {
  process.stderr.write(`ERROR: ${message}\n`);
  process.exit(1);
}

export function handleDeprecatedCommand(
  _oldCommand: string,
  newCommand: string
): never {
  exitWithError(`Run \`gt ${newCommand}\` instead.`);
}

export function handleDeprecatedCommandGroup(message: string): never {
  exitWithError(message);
}
