#!/usr/bin/env python3
"""Стенд новой вкладки без установки расширения.

Отдаёт папку репозитория, в newtab.html подмешивает заглушку chrome.* API
(dev/mock-chrome.js) и дерево закладок (dev/fixture.js), на /_favicon/
рисует цветную плашку с буквой домена.

    python3 dev/serve.py [--port 8765] [--fixture путь/к/fixture.js]

Только стандартная библиотека.
"""
import argparse
import hashlib
import http.server
import os
import urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INJECT = '<script src="dev/fixture.js"></script>\n<script src="dev/mock-chrome.js"></script>\n'
PALETTE = ['#1E88E5', '#C62828', '#2E7D32', '#F08C00', '#6A1B9A', '#00838F', '#3A3A3A', '#D97757', '#4D6BFE', '#1868DB']


def favicon_svg(page_url):
    host = urllib.parse.urlparse(page_url).hostname or '?'
    host = host[4:] if host.startswith('www.') else host
    color = PALETTE[int(hashlib.md5(host.encode()).hexdigest(), 16) % len(PALETTE)]
    letter = host[:1].upper()
    return ('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">'
            f'<rect width="32" height="32" rx="7" fill="{color}"/>'
            '<text x="16" y="22" text-anchor="middle" font-family="-apple-system,Helvetica,Arial" '
            f'font-size="17" font-weight="700" fill="#fff">{letter}</text></svg>').encode()


class Handler(http.server.SimpleHTTPRequestHandler):
    fixture = None

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def send_body(self, body, content_type):
        self.send_response(200)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        url = urllib.parse.urlparse(self.path)
        if url.path.startswith('/_favicon/'):
            page = urllib.parse.parse_qs(url.query).get('pageUrl', [''])[0]
            return self.send_body(favicon_svg(page), 'image/svg+xml')
        if url.path in ('/', '/newtab.html'):
            with open(os.path.join(ROOT, 'newtab.html'), encoding='utf-8') as f:
                html = f.read().replace('<script src="newtab.js">', INJECT + '<script src="newtab.js">')
            return self.send_body(html.encode(), 'text/html; charset=utf-8')
        if url.path == '/dev/fixture.js' and self.fixture:
            with open(self.fixture, 'rb') as f:
                return self.send_body(f.read(), 'text/javascript; charset=utf-8')
        return super().do_GET()

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8765)
    parser.add_argument('--fixture', help='свой fixture.js вместо dev/fixture.js')
    args = parser.parse_args()
    Handler.fixture = os.path.abspath(args.fixture) if args.fixture else None
    server = http.server.ThreadingHTTPServer(('127.0.0.1', args.port), Handler)
    print(f'http://localhost:{args.port}/newtab.html')
    server.serve_forever()


if __name__ == '__main__':
    main()
