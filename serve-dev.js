'use strict';
// เซิร์ฟเวอร์ไฟล์ static ไว้พรีวิวบนเครื่อง: node serve-dev.js แล้วเปิด http://localhost:8765/?mock=1
const http = require('http');
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const PORT = Number(process.env.PORT || 8765);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };
http.createServer((req, res) => {
  // /dev/flaky?days=7 จำลอง Apps Script: ช้า 0-20 วินาทีแบบสุ่ม และตอบ 404 HTML 25%
  if (req.url.startsWith('/dev/flaky')) {
    const q = new URL(req.url, 'http://x').searchParams;
    const delay = Math.random() < 0.4 ? 8000 + Math.random() * 12000 : Math.random() * 2500;
    const fail = Math.random() < 0.25;
    return setTimeout(() => {
      if (fail) { res.writeHead(404, { 'Content-Type': 'text/html' }); return res.end('<!DOCTYPE html><html>error</html>'); }
      fs.readFile(path.join(ROOT, 'dev', `sample-${q.get('days') || 7}.json`), (e, b) => {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' });
        res.end(b);
      });
    }, delay);
  }
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(buf);
  });
}).listen(PORT, () => console.log(`http://localhost:${PORT}/?mock=1`));
