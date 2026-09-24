/* eslint-disable no-console -- This is the CLI's user-facing output module; writing to stdout/stderr is its job. */

/**
 * Tiny output helpers for the `create-iskra` CLI. All user-facing terminal
 * output is funneled through here so that the rest of the codebase stays free
 * of raw `console.*` calls (and the `no-console` lint rule).
 */

export function info(message: string): void {
    console.log(message);
}

export function error(message: string): void {
    console.error(message);
}

export function blank(): void {
    console.log('');
}
