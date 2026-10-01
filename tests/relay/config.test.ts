import test from 'node:test';
import assert from 'node:assert/strict';
import { relayConfig } from '../../apps/relay/config.ts';

test('development defaults stay local; production requires explicit port and HTTPS origins', () => {
  assert.deepEqual(relayConfig({}), { host: '127.0.0.1', port: 3001, origins: ['http://127.0.0.1:5173', 'http://localhost:5173'] });
  assert.throws(() => relayConfig({ NODE_ENV: 'production' }), /PORT/);
  assert.throws(() => relayConfig({ NODE_ENV: 'production', PORT: '8080' }), /ALLOWED_ORIGINS/);
  assert.deepEqual(relayConfig({ NODE_ENV: 'production', PORT: '8080', ALLOWED_ORIGINS: ' https://flowa.example/,https://flowa.example:443 ' }),
    { host: '0.0.0.0', port: 8080, origins: ['https://flowa.example'] });
});

test('production rejects unsafe origins and malformed listening addresses', () => {
  const env = { NODE_ENV: 'production', PORT: '8080', ALLOWED_ORIGINS: 'https://flowa.example' };
  for (const origin of ['', '*', 'https://*.example', 'http://flowa.example', 'https://user:secret@flowa.example', 'https://flowa.example/path', 'https://flowa.example?q=1', 'https://flowa.example#token', 'https://0.0.0.0', 'https://flowa.example:0', 'https://flowa.example,'])
    assert.throws(() => relayConfig({ ...env, ALLOWED_ORIGINS: origin }), /ALLOWED_ORIGINS/);
  for (const port of ['', '0', '-1', '1.5', '8080x', '65536', '\\\\.\\pipe\\node'])
    assert.throws(() => relayConfig({ ...env, PORT: port }), /PORT/);
  assert.throws(() => relayConfig({ ...env, HOST: 'https://host.example' }), /HOST/);
  assert.equal(relayConfig({ ...env, HOST: '::' }).host, '::');
});
