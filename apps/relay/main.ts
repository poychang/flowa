import { createRelay } from './server.ts';
import { relayConfig } from './config.ts';

async function main() {
  const config = relayConfig();
  const relay = createRelay({ origins: config.origins });
  try {
    const port = await relay.listen(config.port, config.host);
    console.log(`Flowa relay listening on ${port}`);
  } catch (error) { await relay.close(); throw error; }
  let stopping = false;
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    const deadline = setTimeout(() => process.exit(1), 5000); deadline.unref();
    void relay.close().then(() => { clearTimeout(deadline); process.exit(0); });
  });
}
main().catch(error => { console.error(`Relay startup failed: ${error.message}`); process.exitCode = 1; });
