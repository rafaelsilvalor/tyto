/**
 * `@tyto/command-line/relay`: the relay to a running window and nothing else (TYTO-567, ADR
 * 0181). The desktop builds it into the one-file relay an agent in a Tyto terminal starts, on
 * the bundled Node; the package's root would bring the whole command tree, and its renderer
 * with it.
 */
export { namedGoneLine, relayToWindow } from './mcp/relay.js';
export { WINDOW_PID_VARIABLE, windowPidOf } from './mcp/window-endpoint.js';
