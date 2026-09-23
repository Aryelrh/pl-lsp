/** In-process LSP client over PassThrough streams: a real connection, no subprocess. */
import { PassThrough } from 'node:stream';
import {
  createConnection,
  type ClientCapabilities,
  type Connection,
  type InitializeResult,
} from 'vscode-languageserver/node.js';
import { createLogger } from '../../src/log.js';
import { createServer } from '../../src/server.js';

export interface TestClient {
  connection: Connection;
  initialize(
    capabilities?: ClientCapabilities,
    initializationOptions?: unknown,
    rootUri?: string | null,
  ): Promise<InitializeResult>;
  dispose(): void;
}

export function createTestClient(): TestClient {
  const clientToServer = new PassThrough();
  const serverToClient = new PassThrough();
  const serverSide = createConnection(clientToServer, serverToClient);
  createServer(serverSide, { log: createLogger('error') });
  serverSide.listen();
  const connection = createConnection(serverToClient, clientToServer);
  connection.listen();
  return {
    connection,
    async initialize(
      capabilities: ClientCapabilities = {},
      initializationOptions?: unknown,
      rootUri: string | null = null,
    ): Promise<InitializeResult> {
      const result = await connection.sendRequest<InitializeResult>('initialize', {
        processId: null,
        rootUri,
        capabilities,
        initializationOptions,
      });
      connection.sendNotification('initialized', {});
      return result;
    },
    dispose(): void {
      connection.dispose();
      serverSide.dispose();
    },
  };
}
