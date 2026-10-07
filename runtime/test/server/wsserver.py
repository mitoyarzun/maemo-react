#!/usr/bin/env python3
"""The WebSocket test server for the maemo:ws and WebSocket tests.

    wsserver.py <port> <cert.pem> <key.pem>   wss on the port
    wsserver.py <port>                        ws, without TLS

Every path takes the first protocol that the client offers, except
/badproto, which answers with a protocol that the client did not offer.
"""
import socket
import ssl
import struct
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from wsproto import BINARY, CLOSE, PING, PONG, TEXT, Closed, offered_protocols, upgrade


def echo(ws):
    while True:
        kind, data = ws.recv_message()
        if kind == TEXT:
            ws.send_text(data.decode())
        else:
            ws.send_binary(data)


def wait_for_close(ws):
    try:
        while True:
            ws.recv_message()
    except Closed:
        pass


class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def log_message(self, *args):
        pass

    def do_GET(self):
        path = self.path.split('?')[0]
        if path == '/reject':
            body = b'no'
            self.send_response(403)
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if path == '/hang':
            time.sleep(10)  # the request is read; the answer never comes
            return
        offered = offered_protocols(self)
        protocol = 'nope' if path == '/badproto' else (offered[0] if offered else None)
        ws = upgrade(self, protocol)
        if ws is None:
            return
        try:
            self.serve(path, ws)
        except (Closed, ConnectionError, OSError):
            pass

    def serve(self, path, ws):
        if path == '/fragments':
            ws.send_text('abc', fin=False)
            ws.send_text('def', fin=False, cont=True)
            ws.send_ping(b'between')
            ws.send_text('ghi', fin=True, cont=True)
            block = bytes(range(256)) * 4  # 1024 bytes
            ws.send_binary(block, fin=False)
            ws.send_binary(block, fin=True, cont=True)
            ws.send_close(1000, 'done')
            wait_for_close(ws)
        elif path == '/big':
            ws.send_text('x' * (1024 * 1024))
            while True:
                kind, data = ws.recv_message()
                ws.send_text('len:%d' % len(data))
        elif path == '/many':
            for i in range(500):
                ws.send_text('n:%d' % i)
            ws.send_close(1000, 'done')
            wait_for_close(ws)
        elif path == '/close':
            ws.send_close(4000, 'bye')
            wait_for_close(ws)
        elif path == '/drop':
            ws.send_text('hi')
            self.connection.close()  # no close frame: the TCP connection ends
        elif path == '/ping':
            ws.send_ping(b'hi')
            self.connection.settimeout(3)
            try:
                while not ws.pongs:
                    fin, opcode, data = ws.read_frame()
                    if opcode == PONG:
                        ws.pongs.append(data)
                    elif opcode == CLOSE:
                        raise Closed()
            except (OSError, Closed):
                pass
            self.connection.settimeout(None)
            ws.send_text('pong ok' if ws.pongs == [b'hi'] else 'pong missing')
            echo(ws)
        elif path == '/split':
            # A ping and a close frame that arrive in two pieces each.
            self.connection.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
            ws.send_frame_split(PING, b'0123456789', 5)
            self.connection.settimeout(1)
            try:
                while not ws.pongs:
                    fin, opcode, data = ws.read_frame()
                    if opcode == PONG:
                        ws.pongs.append(data)
                time.sleep(0.3)  # a second, wrong pong would arrive in this time
                self.connection.settimeout(0.3)
                try:
                    while True:
                        fin, opcode, data = ws.read_frame()
                        if opcode == PONG:
                            ws.pongs.append(data)
                except (OSError, Closed):
                    pass
            except (OSError, Closed):
                pass
            self.connection.settimeout(None)
            ws.send_text('pongs:' + ','.join(p.decode() for p in ws.pongs))
            ws.send_frame_split(CLOSE, struct.pack('>H', 4001) + b'split reason', 6)
            wait_for_close(ws)
        elif path == '/slow-close':
            ws.answer_close = False
            try:
                echo(ws)
            except Closed:
                time.sleep(8)  # the client gives up after 5 s
        else:
            echo(ws)


def main():
    port = int(sys.argv[1])
    server = ThreadingHTTPServer(('127.0.0.1', port), Handler)
    server.daemon_threads = True
    if len(sys.argv) > 3:
        tls = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        tls.load_cert_chain(sys.argv[2], sys.argv[3])
        server.socket = tls.wrap_socket(server.socket, server_side=True)
    server.serve_forever()


main()
