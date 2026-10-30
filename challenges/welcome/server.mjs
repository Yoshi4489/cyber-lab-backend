import { createServer } from 'node:http';
import { createWelcomeHandler } from './handler.mjs';

try {
  const server = createServer(createWelcomeHandler(process.env.CYBER_RANGE_FLAG));
  server.on('error', () => {
    process.stderr.write('Welcome target could not start\n');
    process.exitCode = 1;
  });
  server.listen(8080, '0.0.0.0');
} catch {
  process.stderr.write('Welcome target configuration is invalid\n');
  process.exitCode = 1;
}
