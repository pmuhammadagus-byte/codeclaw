import http from 'http';
import { setTimeout as wait } from 'timers/promises';

const server = http.createServer(async (req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true }));
  }
  await wait(10);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true, method: req.method }));
});

server.listen(0, () => {
  const port = server.address().port;
  const httpReq = http.request({ port, path: '/' }, (res) => {
    let data = '';
    res.on('data', d => data += d);
    res.on('end', () => {
      console.log('RESP:', data);
      server.close(() => process.exit(0));
    });
  });
  httpReq.end();
});

process.on('unhandledRejection', (e) => console.error('unhandledRejection', e));