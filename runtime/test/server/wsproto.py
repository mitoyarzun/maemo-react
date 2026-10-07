"""RFC 6455 framing and handshake for the test servers, on the stdlib only
(the dev image has no `websockets` package). Server side: the server reads
masked frames and sends unmasked frames.

    ws = upgrade(handler)        # in a BaseHTTPRequestHandler method
    kind, data = ws.recv_message()
    ws.send_text('hi')
"""
import base64
import hashlib
import struct
import threading
import time

GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'
CONT, TEXT, BINARY, CLOSE, PING, PONG = 0, 1, 2, 8, 9, 10


class Closed(Exception):
    """The peer sent a close frame, or the stream ended."""


def accept_key(key):
    return base64.b64encode(hashlib.sha1((key + GUID).encode()).digest()).decode()


def unmask(data, mask):
    n = len(data)
    if n == 0:
        return data
    m = int.from_bytes(mask * (n // 4 + 1), 'little') & ((1 << (8 * n)) - 1)
    return (int.from_bytes(data, 'little') ^ m).to_bytes(n, 'little')


class WebSocket:
    """One server-side connection over the rfile and wfile of a request handler."""

    def __init__(self, rfile, wfile):
        self.rfile = rfile
        self.wfile = wfile
        self.pongs = []
        self.close_sent = False
        self.close_code = None
        self.close_reason = ''
        # When False, recv_message does not answer the close frame of the peer.
        self.answer_close = True
        # The fake Home Assistant sends events from other threads.
        self.send_lock = threading.Lock()

    def send_frame(self, opcode, payload=b'', fin=True):
        head = bytes([(0x80 if fin else 0) | opcode])
        n = len(payload)
        if n < 126:
            head += bytes([n])
        elif n < 65536:
            head += struct.pack('>BH', 126, n)
        else:
            head += struct.pack('>BQ', 127, n)
        with self.send_lock:
            self.wfile.write(head + payload)
            self.wfile.flush()

    def send_frame_split(self, opcode, payload, at, pause=0.1):
        """Send one unfragmented frame in two TCP writes, `at` bytes into the
        frame, with a pause between them. A client reads the frame in two pieces."""
        frame = bytes([0x80 | opcode, len(payload)]) + payload
        with self.send_lock:
            self.wfile.write(frame[:at])
            self.wfile.flush()
            time.sleep(pause)
            self.wfile.write(frame[at:])
            self.wfile.flush()

    def send_text(self, text, fin=True, cont=False):
        self.send_frame(CONT if cont else TEXT, text.encode(), fin)

    def send_binary(self, data, fin=True, cont=False):
        self.send_frame(CONT if cont else BINARY, data, fin)

    def send_ping(self, payload=b''):
        self.send_frame(PING, payload)

    def send_pong(self, payload=b''):
        self.send_frame(PONG, payload)

    def send_close(self, code=1000, reason=''):
        self.close_sent = True
        self.send_frame(CLOSE, struct.pack('>H', code) + reason.encode() if code else b'')

    def read_frame(self):
        """(fin, opcode, payload). Raises Closed at the end of the stream."""
        head = self.rfile.read(2)
        if len(head) < 2:
            raise Closed()
        fin = bool(head[0] & 0x80)
        opcode = head[0] & 0x0F
        masked = bool(head[1] & 0x80)
        n = head[1] & 0x7F
        if n == 126:
            n = struct.unpack('>H', self.rfile.read(2))[0]
        elif n == 127:
            n = struct.unpack('>Q', self.rfile.read(8))[0]
        mask = self.rfile.read(4) if masked else b''
        data = self.rfile.read(n)
        if len(data) < n:
            raise Closed()
        return fin, opcode, unmask(data, mask) if masked else data

    def recv_message(self):
        """The next data message as (opcode, bytes), with its fragments joined.
        Answers a ping. Keeps a pong in self.pongs. A close frame gets an
        answer (when answer_close is True) and raises Closed."""
        buf = b''
        kind = None
        while True:
            fin, opcode, data = self.read_frame()
            if opcode == PING:
                self.send_pong(data)
                continue
            if opcode == PONG:
                self.pongs.append(data)
                continue
            if opcode == CLOSE:
                has_code = len(data) >= 2
                self.close_code = struct.unpack('>H', data[:2])[0] if has_code else 1005
                self.close_reason = data[2:].decode('utf-8', 'replace')
                if self.answer_close and not self.close_sent:
                    self.send_close(self.close_code if has_code else 0, self.close_reason)
                raise Closed()
            if opcode in (TEXT, BINARY):
                kind = opcode
                buf = data
            elif opcode == CONT:
                buf += data
            if fin:
                return kind, buf


def upgrade(handler, protocol=None):
    """Answer the Upgrade request of a BaseHTTPRequestHandler. Returns a
    WebSocket, or None after a 400 for a request that is not an upgrade."""
    key = handler.headers.get('Sec-WebSocket-Key')
    if handler.headers.get('Upgrade', '').lower() != 'websocket' or not key:
        handler.send_response(400)
        handler.send_header('Content-Length', '0')
        handler.end_headers()
        return None
    handler.send_response(101)
    handler.send_header('Upgrade', 'websocket')
    handler.send_header('Connection', 'Upgrade')
    handler.send_header('Sec-WebSocket-Accept', accept_key(key))
    if protocol:
        handler.send_header('Sec-WebSocket-Protocol', protocol)
    handler.end_headers()
    handler.close_connection = True
    return WebSocket(handler.rfile, handler.wfile)


def offered_protocols(handler):
    """The protocols that the client offered, in order."""
    line = handler.headers.get('Sec-WebSocket-Protocol', '')
    return [p.strip() for p in line.split(',') if p.strip()]
