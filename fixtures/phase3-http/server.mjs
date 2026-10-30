import { createServer } from 'node:http';

const flag = process.env.CYBER_RANGE_FLAG;
if (!flag) throw new Error('The disposable target requires a runtime flag');

createServer((request, response) => {
  if (request.url === '/health') {
    response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('ok\n');
    return;
  }

  if (request.url === '/solve') {
    response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
    response.end(`${flag}\n`);
    return;
  }

  response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  response.end('not found\n');
}).listen(8080, '0.0.0.0');
