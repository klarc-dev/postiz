import { createServer } from 'node:net';
import { waitForTemporal } from './wait-for-temporal';

describe('waitForTemporal', () => {
  it('retries until Temporal answers', async () => {
    let calls = 0;
    const probe = async () => ++calls >= 3;
    await expect(waitForTemporal('temporal:7233', 5000, 1, probe)).resolves.toBe(true);
    expect(calls).toBe(3);
  });

  it('gives up after the timeout instead of blocking forever', async () => {
    await expect(waitForTemporal('temporal:7233', 20, 5, async () => false)).resolves.toBe(false);
  });

  it('parses host and port and probes a real TCP listener', async () => {
    const server = createServer().listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const { port } = server.address() as { port: number };
    await expect(waitForTemporal(`127.0.0.1:${port}`, 3000, 10)).resolves.toBe(true);
    server.close();
  });
});
