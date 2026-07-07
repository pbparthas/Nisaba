// A minimal in-process mock of the Google Drive v3 surface our client uses:
// files.list (q on name/parents), files.get (metadata / alt=media), multipart
// create and update. Enough to exercise the whole sync path in tests.

import http from 'node:http';

export function startMockDrive() {
  const files = new Map(); // id -> {id, name, mimeType, parents, version, content(Buffer)}
  let nextId = 1;

  function parseMultipart(buf, contentType) {
    const boundary = contentType.match(/boundary=(.+)$/)[1];
    const parts = buf.toString('binary').split(`--${boundary}`).slice(1, -1);
    const [metaPart, contentPart] = parts;
    const meta = JSON.parse(metaPart.slice(metaPart.indexOf('\r\n\r\n') + 4));
    const raw = contentPart.slice(contentPart.indexOf('\r\n\r\n') + 4).replace(/\r\n$/, '');
    return { meta, content: Buffer.from(raw, 'binary') };
  }

  function matches(f, q) {
    // Supports the exact q patterns drive.js emits.
    const name = q.match(/name = '([^']+)'/)?.[1];
    const parent = q.match(/'([^']+)' in parents/)?.[1];
    const mime = q.match(/mimeType = '([^']+)'/)?.[1];
    if (name && f.name !== name) return false;
    if (parent && !f.parents.includes(parent)) return false;
    if (mime && f.mimeType !== mime) return false;
    return true;
  }

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const url = new URL(req.url, 'http://x');
      const json = (obj, code = 200) => {
        res.writeHead(code, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(obj));
      };

      if (!req.headers.authorization?.startsWith('Bearer ')) return json({ error: 'no token' }, 401);

      // files.list
      if (req.method === 'GET' && url.pathname === '/drive/v3/files') {
        const q = url.searchParams.get('q') || '';
        const found = [...files.values()].filter((f) => matches(f, q));
        return json({ files: found.map(({ id, name }) => ({ id, name })) });
      }
      // about
      if (req.method === 'GET' && url.pathname === '/drive/v3/about') {
        return json({ user: { emailAddress: 'mock@example.com' } });
      }
      // files.get — metadata or media
      const getMatch = url.pathname.match(/^\/drive\/v3\/files\/(.+)$/);
      if (req.method === 'GET' && getMatch) {
        const f = files.get(getMatch[1]);
        if (!f) return json({ error: 'not found' }, 404);
        if (url.searchParams.get('alt') === 'media') {
          res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
          return res.end(f.content);
        }
        return json({ id: f.id, version: String(f.version) });
      }
      // create folder (JSON POST)
      if (req.method === 'POST' && url.pathname === '/drive/v3/files') {
        const meta = JSON.parse(body.toString());
        const id = 'f' + nextId++;
        files.set(id, { id, ...meta, parents: meta.parents || [], version: 1, content: Buffer.alloc(0) });
        return json({ id });
      }
      // multipart upload create
      if (req.method === 'POST' && url.pathname === '/upload/drive/v3/files') {
        const { meta, content } = parseMultipart(body, req.headers['content-type']);
        const id = 'f' + nextId++;
        files.set(id, { id, name: meta.name, mimeType: 'file', parents: meta.parents || [], version: 1, content });
        return json({ id, version: '1' });
      }
      // multipart upload update
      const upMatch = url.pathname.match(/^\/upload\/drive\/v3\/files\/(.+)$/);
      if (req.method === 'PATCH' && upMatch) {
        const f = files.get(upMatch[1]);
        if (!f) return json({ error: 'not found' }, 404);
        const { content } = parseMultipart(body, req.headers['content-type']);
        f.content = content;
        f.version += 1;
        return json({ id: f.id, version: String(f.version) });
      }
      json({ error: 'unhandled ' + req.method + ' ' + url.pathname }, 500);
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        baseUrl: `http://127.0.0.1:${server.address().port}`,
        close: () => server.close(),
        _files: files,
      });
    });
  });
}
