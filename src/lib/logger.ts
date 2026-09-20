import type { FastifyServerOptions } from 'fastify';
import type { Config } from '../config.js';

/**
 * Paths pino blanks out before a log line is written.
 *
 * Fastify's default serializers already log only
 * `{method, url, version, host, remoteAddress, remotePort}` for requests and
 * `{statusCode}` for responses — headers are never logged out of the box — so
 * the header entries here are defence in depth for future log calls rather
 * than a fix for a current leak.
 *
 * `req.url` is the one that matters today: it is logged by default and it
 * includes the query string, which is where a token or a flag would land.
 */
const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  'password',
  'token',
  'accessToken',
  'refreshToken',
  'flag',
  'secret',
  '*.password',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.flag',
  '*.secret',
  'req.url',
];

/**
 * Keeps query parameter *names* and drops every value, so a log line still
 * shows the shape of a request without ever carrying its contents.
 *
 * Operates on the raw query string rather than `URLSearchParams` so that
 * percent-decoding cannot reintroduce newlines into a log line.
 */
export function scrubQuery(url: string): string {
  const separator = url.indexOf('?');
  if (separator === -1) return url;

  const path = url.slice(0, separator);
  const names = url
    .slice(separator + 1)
    .split('&')
    .map((pair) => pair.split('=')[0] ?? '')
    .filter((name) => name.length > 0);

  if (names.length === 0) return path;
  return `${path}?${[...new Set(names)].map((name) => `${name}=<redacted>`).join('&')}`;
}

function censor(value: unknown, path: string[]): unknown {
  if (path.join('.') === 'req.url') {
    return typeof value === 'string' ? scrubQuery(value) : value;
  }
  return '[Redacted]';
}

/**
 * Logging is off under `test` so the suite stays readable; `development` gets
 * debug level, production gets info.
 *
 * The return type excludes `undefined` deliberately: `exactOptionalPropertyTypes`
 * rejects assigning a possibly-undefined value to Fastify's optional `logger`.
 */
export function buildLoggerOptions(
  config: Config,
): NonNullable<FastifyServerOptions['logger']> {
  if (config.NODE_ENV === 'test') return false;

  return {
    level: config.NODE_ENV === 'development' ? 'debug' : 'info',
    redact: { paths: REDACT_PATHS, censor },
  };
}
