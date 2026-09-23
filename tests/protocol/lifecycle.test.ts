import { describe, expect, it } from 'vitest';
import { createTestClient } from './harness.js';

describe('lifecycle', () => {
  it('initializes a minimal client with the documented capabilities', async () => {
    const server = createTestClient();
    const result = await server.initialize();
    expect(result.serverInfo).toEqual({ name: 'placitum-lsp', version: '0.1.0' });
    expect(result.capabilities.positionEncoding).toBe('utf-16');
    expect(result.capabilities.textDocumentSync).toEqual({
      openClose: true,
      change: 2,
      save: { includeText: false },
    });
    server.dispose();
  });

  it('answers shutdown with null', async () => {
    const server = createTestClient();
    await server.initialize();
    await expect(server.connection.sendRequest('shutdown')).resolves.toBeNull();
    server.dispose();
  });

  it('answers unknown requests with MethodNotFound', async () => {
    const server = createTestClient();
    await server.initialize();
    await expect(server.connection.sendRequest('placitum/doesNotExist')).rejects.toMatchObject({ code: -32601 });
    server.dispose();
  });
});
