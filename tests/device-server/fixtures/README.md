These PEM files are public automated-test fixtures, valid 2025-01-01 through
2035-01-01, for `localhost` and `127.0.0.1` only. The private key is deliberately
public. Never use it for a running device environment or import this certificate
into an OS/browser trust store. Tests pass it explicitly as their HTTPS/WSS CA;
certificate verification remains enabled. Renew the fixtures before expiry.
