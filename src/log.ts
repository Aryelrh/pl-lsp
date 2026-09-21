/** stderr/file logging; stdout is reserved for JSON-RPC frames. */
import { appendFileSync } from 'node:fs';

export const LOG_LEVELS = ['error', 'info', 'debug', 'trace'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

const RANK: Record<LogLevel, number> = { error: 0, info: 1, debug: 2, trace: 3 };

export interface Logger {
  error(message: string, cause?: unknown): void;
  info(message: string): void;
  debug(message: string): void;
  trace(message: string): void;
}

function describe(message: string, cause: unknown): string {
  if (cause === undefined) return message;
  if (cause instanceof Error) return `${message}: ${cause.stack ?? cause.message}`;
  return `${message}: ${String(cause)}`;
}

export function isLogLevel(value: string): value is LogLevel {
  return (LOG_LEVELS as readonly string[]).includes(value);
}

export function createLogger(level: LogLevel = 'info', file?: string): Logger {
  const write = (at: LogLevel, message: string, cause?: unknown): void => {
    if (RANK[at] > RANK[level]) return;
    const line = `[placitum-lsp] ${new Date().toISOString()} ${at.toUpperCase()} ${describe(message, cause)}\n`;
    process.stderr.write(line);
    if (file !== undefined) {
      try {
        appendFileSync(file, line);
      } catch {
        // Logging must never take the server down.
      }
    }
  };
  return {
    error: (message, cause) => write('error', message, cause),
    info: (message) => write('info', message),
    debug: (message) => write('debug', message),
    trace: (message) => write('trace', message),
  };
}
