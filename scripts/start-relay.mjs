// Use compiled JavaScript and enforce production validation even if NODE_ENV is absent.
process.env.NODE_ENV = 'production';
await import('../dist-relay/apps/relay/main.js');
