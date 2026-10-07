#!/usr/bin/env python3
"""A local HTTPS server for the maemo:http and fetch tests.

    server.py <port> <cert.pem> <key.pem>
"""
import gzip
import json
import ssl
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def log_message(self, *args):
        pass

    def send(self, status, body, ctype='application/json', extra=()):
        self.send_response(status)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        for k, v in extra:
            self.send_header(k, v)
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(body)

    def echo(self):
        n = int(self.headers.get('Content-Length') or 0)
        body = self.rfile.read(n) if n else b''
        self.send(200, json.dumps({
            'method': self.command,
            'path': self.path,
            'headers': {k.lower(): v for k, v in self.headers.items()},
            'body': body.decode('utf-8', 'replace'),
        }).encode())

    def do_GET(self):
        if self.path == '/json':
            self.send(200, b'{"hello":"world","n":42}')
        elif self.path.startswith('/echo'):
            self.echo()
        elif self.path == '/redirect':
            self.send(302, b'', 'text/plain', [('Location', '/json')])
        elif self.path == '/redirect-file':
            self.send(302, b'', 'text/plain', [('Location', 'file:///etc/hosts')])
        elif self.path == '/slow':
            time.sleep(3)
            self.send(200, b'slow')
        elif self.path == '/big':
            self.send(200, b'x' * (1024 * 1024), 'application/octet-stream')
        elif self.path == '/gzip':
            self.send(200, gzip.compress(b'compressed text ' * 100), 'text/plain',
                      [('Content-Encoding', 'gzip')])
        elif self.path == '/status/404':
            self.send(404, b'{"error":"not found"}')
        else:
            self.send(404, b'{}')

    do_HEAD = do_GET

    def do_POST(self):
        self.echo()

    do_PUT = do_POST
    do_DELETE = do_POST


def main():
    port, cert, key = int(sys.argv[1]), sys.argv[2], sys.argv[3]
    server = ThreadingHTTPServer(('127.0.0.1', port), Handler)
    tls = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    tls.load_cert_chain(cert, key)
    server.socket = tls.wrap_socket(server.socket, server_side=True)
    server.serve_forever()


main()
