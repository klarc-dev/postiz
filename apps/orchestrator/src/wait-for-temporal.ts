import { connect } from 'node:net';

// Klarc fork: after a host or Docker restart the orchestrator can boot before
// Temporal accepts connections; the worker connection then fails once and the
// process keeps running with no pollers, so nothing is ever published. Waiting
// for Temporal before Nest initialises the workers makes cold starts reliable.
export async function waitForTemporal(
  address = process.env.TEMPORAL_ADDRESS || 'localhost:7233',
  timeoutMs = Number(process.env.TEMPORAL_WAIT_TIMEOUT_MS || 300000),
  intervalMs = 2000,
  probe: (host: string, port: number) => Promise<boolean> = reachable
): Promise<boolean> {
  const [host, rawPort] = address.replace(/^[a-z]+:\/\//, '').split(':');
  const port = Number(rawPort || 7233);
  const deadline = Date.now() + timeoutMs;
  for (let attempt = 1; ; attempt++) {
    if (await probe(host, port)) {
      if (attempt > 1) {
        console.log(`Temporal reachable at ${host}:${port} after ${attempt} attempts`);
      }
      return true;
    }
    if (Date.now() + intervalMs > deadline) {
      console.warn(`Temporal not reachable at ${host}:${port} after ${timeoutMs}ms, starting anyway`);
      return false;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

function reachable(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(2000, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}
