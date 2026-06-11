import { ExitFailedError } from './errors';

export function handleDeprecatedCommand(
  _oldCommand: string,
  newCommand: string
): void {
  throw new ExitFailedError(`Run \`gt ${newCommand}\` instead.`);
}

export function handleDeprecatedCommandGroup(message: string): void {
  throw new ExitFailedError(message);
}
