import { Console } from 'node:console';
import { PassThrough, Writable } from 'node:stream';

import { launchPluginProcess } from '@tyto/command-line';
import { describe, expect, it } from 'vitest';

import { claimStdio, defaultEnvironment, defaultRasterizer, tytoHome } from './environment.js';

/** Where `tyto plugin install` writes. The desktop reads the same variable, and must agree. */
describe('tytoHome', () => {
  it('is TYTO_HOME when it is set', () => {
    expect(tytoHome({ TYTO_HOME: '/tmp/elsewhere' })).toBe('/tmp/elsewhere');
  });

  it('is ~/.tyto otherwise, and an empty variable counts as unset', () => {
    expect(tytoHome({})).toMatch(/[\\/]\.tyto$/u);
    expect(tytoHome({ TYTO_HOME: '' })).toMatch(/[\\/]\.tyto$/u);
  });

  it('is what the real environment hands every command', () => {
    const previous = process.env['TYTO_HOME'];
    process.env['TYTO_HOME'] = '/tmp/from-the-shell';
    try {
      expect(defaultEnvironment().home).toBe('/tmp/from-the-shell');
    } finally {
      if (previous === undefined) delete process.env['TYTO_HOME'];
      else process.env['TYTO_HOME'] = previous;
    }
  });
});

/**
 * The two ports a window fills differently (ADR 0159). The command tree chooses neither, so a
 * terminal that forgot one would start no plugin or raster nothing, and only here is it said.
 */
describe('defaultEnvironment', () => {
  it("starts a plugin's process with the terminal's fork launcher", () => {
    expect(defaultEnvironment().launch).toBe(launchPluginProcess);
  });

  it("rasters through Playwright's Chromium", () => {
    expect(defaultEnvironment().rasterizer).toBe(defaultRasterizer);
  });
});

/** `tyto mcp`'s streams: stdout carries the protocol and nothing else (ADR 0179). */
describe('claimStdio', () => {
  function streams() {
    const written = { stdout: '', stderr: '' };
    const sink = (name: 'stdout' | 'stderr') =>
      new Writable({
        write(chunk: Buffer, _encoding, done) {
          written[name] += chunk.toString('utf8');
          done();
        },
      });
    return {
      written,
      standard: { stdin: new PassThrough(), stdout: sink('stdout'), stderr: sink('stderr') },
    };
  }

  it('gives the protocol stdout, and sends every other write to stdout onto stderr', async () => {
    const { written, standard } = streams();
    // A console bound to the stream, as Node's global one is bound to process.stdout.
    const console = new Console({ stdout: standard.stdout, stderr: standard.stderr });
    const stdio = claimStdio(standard);

    await new Promise<void>((resolve) =>
      stdio.output.write('{"jsonrpc":"2.0"}\n', () => resolve()),
    );
    console.log('a stray line');
    standard.stdout.write('a library writing to stdout\n');

    expect(written.stdout).toBe('{"jsonrpc":"2.0"}\n');
    expect(written.stderr).toBe('a stray line\na library writing to stdout\n');
    expect(stdio.input).toBe(standard.stdin);
  });

  it('is the port the terminal hands tyto mcp', () => {
    expect(defaultEnvironment().stdio).toBeTypeOf('function');
  });
});
