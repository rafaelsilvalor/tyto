import { readFile } from 'node:fs/promises';
import { type IncomingMessage, type Server, type ServerResponse, createServer } from 'node:http';
import { join } from 'node:path';

import { previewPage } from './page.ts';
import type { PreviewSession } from './session.ts';

/**
 * The HTTP side: the page, the state as JSON, a stream that says when it changed, and the
 * image files.
 *
 * **Bound to 127.0.0.1 and to nothing else.** The page shows unreleased artwork and the
 * server reads files off this machine, so it is not something a second computer on the
 * network should be able to open by accident. There is no option to widen it.
 */

export const PREVIEW_HOST = '127.0.0.1';

export interface PreviewServer {
  readonly server: Server;
  readonly url: string;
  close(): Promise<void>;
}

function send(response: ServerResponse, status: number, type: string, body: string | Buffer): void {
  response.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  response.end(body);
}

/** `/out/<generation>/<file>`, and only a file name: no separators, no `..`. */
const IMAGE_ROUTE = /^\/out\/(\d+)\/([^/\\]+)$/;

export async function startPreviewServer(
  session: PreviewSession,
  port: number,
): Promise<PreviewServer> {
  const streams = new Set<ServerResponse>();

  session.onChange((state) => {
    const event = `data: ${JSON.stringify({ generation: state.generation, status: state.status })}\n\n`;
    for (const stream of streams) stream.write(event);
  });

  const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname;

    if (path === '/') return send(response, 200, 'text/html; charset=utf-8', previewPage());

    if (path === '/api/state') {
      return send(
        response,
        200,
        'application/json; charset=utf-8',
        `${JSON.stringify(session.current(), null, 2)}\n`,
      );
    }

    if (path === '/events') {
      response.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-store',
        connection: 'keep-alive',
      });
      const state = session.current();
      response.write(
        `data: ${JSON.stringify({ generation: state.generation, status: state.status })}\n\n`,
      );
      streams.add(response);
      request.on('close', () => streams.delete(response));
      return;
    }

    const image = IMAGE_ROUTE.exec(path);
    if (image !== null) {
      const folder = session.servedFolder(Number(image[1]));
      const name = decodeURIComponent(image[2] ?? '');
      const entry = session.current().images.find((candidate) => candidate.url === path);
      if (folder === undefined || entry === undefined) {
        return send(response, 404, 'text/plain; charset=utf-8', 'not the generation on the page\n');
      }
      return send(response, 200, entry.mime, await readFile(join(folder, name)));
    }

    send(response, 404, 'text/plain; charset=utf-8', 'not found\n');
  };

  const server = createServer((request, response) => {
    handle(request, response).catch((cause: unknown) => {
      send(response, 500, 'text/plain; charset=utf-8', `${String(cause)}\n`);
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, PREVIEW_HOST, () => resolve());
  });

  const address = server.address();
  const bound = typeof address === 'object' && address !== null ? address.port : port;

  return {
    server,
    url: `http://${PREVIEW_HOST}:${String(bound)}/`,
    close: () =>
      new Promise((resolve) => {
        for (const stream of streams) stream.end();
        server.close(() => resolve());
      }),
  };
}
