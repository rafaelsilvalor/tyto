import { fsPluginStore, listenForCallback } from '@tyto/io';
import {
  type HostCapabilities,
  type SigninDeclaration,
  type SigninService,
  createSigninService,
  installedSigninDeclarations,
  parsePluginManifest,
} from '@tyto/plugin-api';

import type { CliEnvironment } from './environment.js';
import { EXIT_DIAGNOSTICS, EXIT_OK, type ExitCode } from './exit.js';
import { tokenFetch } from './plugins/capabilities.js';

/**
 * Browser sign-in from a terminal (ADR 0194): `tyto signin` and `tyto signout`, and the port a
 * plugin's `host.signin.accessToken` reaches in every command that loads plugins.
 *
 * The flow is the desktop's, shared through `@tyto/plugin-api` (ADR 0174 decision 8): PKCE on a
 * loopback port, only the refresh token stored, the access token in this process's memory. What
 * differs is where the refresh token is kept — the system keychain through the app's
 * {@link CliEnvironment.signin} port, never the desktop's store — and who starts a sign-in: a
 * person typing `tyto signin`, never a plugin (ADR 0174 decision 6).
 */

/** One service per environment, so a run refreshes a token once and every plugin shares it. */
const services = new WeakMap<CliEnvironment, SigninService>();

/** The shared sign-in service, composed for this terminal, or `undefined` when it cannot sign in. */
export function cliSigninService(environment: CliEnvironment): SigninService | undefined {
  const { signin, home } = environment;
  if (signin === undefined || home === undefined) return undefined;
  const known = services.get(environment);
  if (known !== undefined) return known;
  const service = createSigninService({
    credentials: signin.secrets,
    declarationOf: installedSigninDeclarations(fsPluginStore(home)),
    fetch: tokenFetch,
    now: () => Date.now(),
    openBrowser: async (url) => {
      // Printed first: a server with no browser to open is still a sign-in, finished from a
      // browser anywhere that reaches this machine's loopback port, which is this machine.
      environment.console.err(`If your browser did not open, open this address in it:
${url}
`);
      await signin.openBrowser(url);
    },
    listen: signin.listen ?? listenForCallback,
  });
  services.set(environment, service);
  return service;
}

/** How a person signs in from a terminal, for the `E_SIGNIN_REQUIRED` message. */
export function signinCommandLine(plugin: string, id: string): string {
  return `run tyto signin ${plugin} ${id}`;
}

/**
 * What a command lends plugins for `host.signin` (ADR 0194): the token port and how to sign in,
 * or nothing on a terminal that cannot sign in, which answers `E_SIGNIN_UNAVAILABLE`.
 */
export function cliSigninCapabilities(
  environment: CliEnvironment,
): Pick<HostCapabilities, 'signinAccessToken' | 'describeSignin'> | undefined {
  const service = cliSigninService(environment);
  if (service === undefined) return undefined;
  return {
    signinAccessToken: (plugin, id) => service.accessToken(plugin, id),
    describeSignin: signinCommandLine,
  };
}

const CANNOT_SIGN_IN =
  'This terminal cannot sign in: no system keychain was composed for it (ADR 0194).';

type Declared =
  | { readonly ok: true; readonly id: string; readonly declaration: SigninDeclaration }
  | { readonly ok: false; readonly message: string };

/**
 * The sign-in a command line names: the installed plugin's `signin.<id>`, or its only one when
 * no id is typed. Every refusal names what there is to choose from.
 */
async function declared(home: string, plugin: string, id: string | undefined): Promise<Declared> {
  const stored = (await fsPluginStore(home).list()).find((entry) => entry.folder === plugin);
  if (stored?.manifestSource === undefined) {
    return { ok: false, message: `No installed plugin is named '${plugin}'.` };
  }
  const parsed = parsePluginManifest(stored.manifestSource);
  if (!parsed.ok) {
    const reason = parsed.error.map((problem) => problem.message).join(' ');
    return { ok: false, message: `The manifest of '${plugin}' does not read: ${reason}` };
  }
  const signins = parsed.value.signin ?? {};
  const ids = Object.keys(signins);
  if (ids.length === 0) {
    return { ok: false, message: `'${plugin}' declares no sign-in.` };
  }
  const chosen = id ?? (ids.length === 1 ? ids[0] : undefined);
  if (chosen === undefined) {
    return {
      ok: false,
      message: `'${plugin}' declares more than one sign-in; name one: ${ids.join(', ')}.`,
    };
  }
  const declaration = signins[chosen];
  if (declaration === undefined) {
    return {
      ok: false,
      message: `'${plugin}' declares no sign-in '${chosen}'; it declares: ${ids.join(', ')}.`,
    };
  }
  return { ok: true, id: chosen, declaration };
}

function refuse(environment: CliEnvironment, message: string): ExitCode {
  environment.console.err(`${message}\n`);
  return EXIT_DIAGNOSTICS;
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * Asks for the OAuth client a manifest leaves to the person (ADR 0192) and stores it, which ends
 * the sign-in made with the client before. The secret is optional and is not echoed.
 */
async function askForClient(
  environment: CliEnvironment,
  service: SigninService,
  plugin: string,
  id: string,
): Promise<ExitCode | undefined> {
  const { ask } = environment;
  if (ask === undefined) {
    return refuse(environment, 'Nobody is at a terminal to type the client; run it in one.');
  }
  const clientId = (await ask('OAuth client ID: ')).trim();
  if (clientId === '') return refuse(environment, 'No client ID was typed; nothing was stored.');
  const clientSecret = (
    await ask('OAuth client secret (leave empty if there is none): ', { secret: true })
  ).trim();
  try {
    await service.setClient(plugin, id, {
      clientId,
      ...(clientSecret === '' ? {} : { clientSecret }),
    });
  } catch (cause) {
    return refuse(environment, `The client was not stored: ${messageOf(cause)}.`);
  }
  environment.console.err('OAuth client stored.\n');
  return undefined;
}

export interface SigninCommandOptions {
  /** Ask for the OAuth client first (ADR 0192), for a manifest that names none. */
  readonly client?: boolean;
}

/** `tyto signin <plugin> [id]`: a browser sign-in, its refresh token kept in the keychain. */
export async function signinCommand(
  plugin: string,
  id: string | undefined,
  options: SigninCommandOptions,
  environment: CliEnvironment,
): Promise<ExitCode> {
  const service = cliSigninService(environment);
  if (service === undefined || environment.home === undefined) {
    return refuse(environment, CANNOT_SIGN_IN);
  }
  const found = await declared(environment.home, plugin, id);
  if (!found.ok) return refuse(environment, found.message);
  const manifestClient = found.declaration.clientId !== undefined;

  try {
    if (options.client === true) {
      if (manifestClient) {
        return refuse(
          environment,
          `'${plugin}' names the client of its sign-in '${found.id}' itself; there is none to type.`,
        );
      }
      const refused = await askForClient(environment, service, plugin, found.id);
      if (refused !== undefined) return refused;
    } else if (!manifestClient && !(await service.hasClient(plugin, found.id))) {
      return refuse(
        environment,
        `No OAuth client is set for the sign-in '${found.id}' of ${plugin}; ` +
          `run tyto signin ${plugin} ${found.id} --client to type one.`,
      );
    }

    environment.console.err(
      `Opening your browser to sign in to '${found.id}' of ${plugin}. ` +
        'Finish there within five minutes, or press Ctrl+C to give up.\n',
    );
    const outcome = await service.start(plugin, found.id);
    if (!outcome.ok) return refuse(environment, `Not signed in: ${outcome.message}.`);
    environment.console.out(`Signed in to '${found.id}' of ${plugin} as ${outcome.label}.\n`);
    return EXIT_OK;
  } catch (cause) {
    // The keychain is the usual one: a Linux session with no Secret Service answers here.
    return refuse(environment, `Not signed in: ${messageOf(cause)}.`);
  }
}

export interface SignoutCommandOptions {
  /** Also forget the OAuth client the person typed (ADR 0192). */
  readonly client?: boolean;
}

/**
 * `tyto signout <plugin> [id]`: forgets the sign-in, and with `--client` the client too. An id
 * typed whole needs no installed manifest, so a sign-in outlives nothing it cannot be forgotten
 * from: a plugin removed before signing out still signs out by name.
 */
export async function signoutCommand(
  plugin: string,
  id: string | undefined,
  options: SignoutCommandOptions,
  environment: CliEnvironment,
): Promise<ExitCode> {
  const service = cliSigninService(environment);
  if (service === undefined || environment.home === undefined) {
    return refuse(environment, CANNOT_SIGN_IN);
  }
  let chosen = id;
  if (chosen === undefined) {
    const found = await declared(environment.home, plugin, undefined);
    if (!found.ok) return refuse(environment, found.message);
    chosen = found.id;
  }
  try {
    const signedOut = await service.signOut(plugin, chosen);
    environment.console.out(
      signedOut
        ? `Signed out of '${chosen}' of ${plugin}.\n`
        : `Nobody was signed in to '${chosen}' of ${plugin}.\n`,
    );
  } catch (cause) {
    return refuse(environment, `Not signed out: ${messageOf(cause)}.`);
  }
  if (options.client !== true) return EXIT_OK;
  try {
    const cleared = await service.clearClient(plugin, chosen);
    environment.console.out(
      cleared ? 'OAuth client forgotten.\n' : 'No OAuth client was stored.\n',
    );
    return EXIT_OK;
  } catch (cause) {
    // An installed manifest must still declare the sign-in, without a client of its own.
    return refuse(environment, `The OAuth client was not forgotten: ${messageOf(cause)}.`);
  }
}
