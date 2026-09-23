#!/usr/bin/env node
/** CLI entry: parse flags, then start the stdio language server. */
import { createConnection } from 'vscode-languageserver/node.js';
import { DEFAULT_CONFIG } from './config.js';
import { createLogger, isLogLevel, type Logger, type LogLevel } from './log.js';
import { createServer } from './server.js';
import { VERSION } from './version.js';

const USAGE = `Usage: placitum-lsp [--stdio] [--version] [--help]
                   [--log-level=<error|info|debug|trace>] [--log-file=<path>]

Language server for Placitum. Only the stdio transport is supported; stdout
carries JSON-RPC frames exclusively, all logs go to stderr (or --log-file).
`;

interface CliOptions {
  level: LogLevel;
  file: string | undefined;
}

function parseArgs(argv: string[]): CliOptions | number {
  let level: LogLevel = 'info';
  let file: string | undefined;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === undefined) continue;
    if (arg === '--stdio') continue;
    if (arg === '--version' || arg === '-v') {
      process.stdout.write(`placitum-lsp ${VERSION}\n`);
      return 0;
    }
    if (arg === '--help' || arg === '-h') {
      process.stdout.write(USAGE);
      return 0;
    }
    if (arg === '--node-ipc' || arg === '--socket' || arg.startsWith('--socket=') || arg.startsWith('--pipe=')) {
      process.stderr.write(`placitum-lsp: unsupported transport option ${arg}; only --stdio is supported.\n`);
      return 2;
    }
    if (arg.startsWith('--log-level=')) {
      const value = arg.slice('--log-level='.length);
      if (!isLogLevel(value)) {
        process.stderr.write(`placitum-lsp: invalid log level ${value}\n`);
        return 2;
      }
      level = value;
      continue;
    }
    if (arg === '--log-level') {
      const value = argv[++index];
      if (value === undefined || !isLogLevel(value)) {
        process.stderr.write('placitum-lsp: --log-level needs error|info|debug|trace\n');
        return 2;
      }
      level = value;
      continue;
    }
    if (arg.startsWith('--log-file=')) {
      file = arg.slice('--log-file='.length);
      continue;
    }
    if (arg === '--log-file') {
      file = argv[++index];
      if (file === undefined) {
        process.stderr.write('placitum-lsp: --log-file needs a path\n');
        return 2;
      }
      continue;
    }
    process.stderr.write(`placitum-lsp: unknown option ${arg}\n${USAGE}`);
    return 2;
  }
  return { level, file };
}

function main(argv: string[]): number {
  const parsed = parseArgs(argv);
  if (typeof parsed === 'number') return parsed;
  const log: Logger = createLogger(parsed.level, parsed.file);
  process.on('uncaughtException', (error) => log.error('uncaught exception', error));
  process.on('unhandledRejection', (reason) => log.error('unhandled rejection', reason));
  const connection = createConnection(process.stdin, process.stdout);
  createServer(connection, { log, config: DEFAULT_CONFIG });
  connection.listen();
  log.info(`placitum-lsp ${VERSION} listening on stdio`);
  return 0;
}

process.exitCode = main(process.argv.slice(2));
