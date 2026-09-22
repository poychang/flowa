import { createRelay } from './server.ts';
const relay = createRelay({ origins: (process.env.ALLOWED_ORIGINS ?? 'http://127.0.0.1:5173,http://localhost:5173').split(',') });
const port = await relay.listen(Number(process.env.PORT ?? 3001), process.env.HOST ?? '127.0.0.1');
console.log(`Flowa relay listening on ${port}`);
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { void relay.close().then(() => process.exit()); });
