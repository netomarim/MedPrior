const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const files = new Map([
  ['/index.html', 'text/html; charset=utf-8'], ['/styles.css', 'text/css; charset=utf-8'],
  ['/config.js', 'text/javascript; charset=utf-8'], ['/cloud.js', 'text/javascript; charset=utf-8'],
  ['/app.js', 'text/javascript; charset=utf-8']
]);
const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const file = pathname === '/' ? '/index.html' : pathname;
  if (!files.has(file) || !['GET', 'HEAD'].includes(req.method)) {
    res.writeHead(404); res.end('Não encontrado'); return;
  }
  try {
    const content = await fs.readFile(path.join(__dirname, file.slice(1)));
    res.writeHead(200, {'Content-Type': files.get(file), 'Cache-Control': 'no-store', 'X-Content-Type-Options':'nosniff'});
    res.end(req.method === 'HEAD' ? undefined : content);
  } catch { res.writeHead(500); res.end('Não foi possível carregar o arquivo.'); }
});
server.on('error', error => {
  console.error(error.code === 'EADDRINUSE' ? 'A porta 3000 está ocupada. Feche a outra execução do MedPrior.' : 'Não foi possível iniciar o servidor.');
  process.exitCode = 1;
});
server.listen(3000, '127.0.0.1', () => console.log('MedPrior: http://127.0.0.1:3000\nMantenha este terminal aberto. Ctrl+C encerra o sistema.'));
