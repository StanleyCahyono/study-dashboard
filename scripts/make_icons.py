"""Generate the PWA icons (no external dependencies). Run: python scripts/make_icons.py"""

import math
import struct
import zlib
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / "frontend" / "public" / "icons"
BG = (31, 58, 95)
FG = (246, 247, 249)
ACCENT = (242, 179, 61)


def pixel(x: float, y: float) -> tuple[int, int, int]:
    # Normalised coords in [-1, 1]. A clock face with an accent hand: "what next?"
    r = math.hypot(x, y)
    if 0.52 <= r <= 0.62:
        return FG
    # Hour hand (up) and minute hand (to the right, accent colour).
    if abs(x) < 0.05 and -0.40 < y < 0.02:
        return FG
    if abs(y) < 0.05 and -0.02 < x < 0.32:
        return ACCENT
    if r < 0.08:
        return ACCENT
    return BG


def render(size: int, path: Path, ss: int = 3) -> None:
    rows = []
    for py in range(size):
        row = bytearray([0])
        for px in range(size):
            acc = [0, 0, 0]
            for sy in range(ss):
                for sx in range(ss):
                    x = ((px + (sx + 0.5) / ss) / size) * 2 - 1
                    y = ((py + (sy + 0.5) / ss) / size) * 2 - 1
                    c = pixel(x, y)
                    for i in range(3):
                        acc[i] += c[i]
            row.extend(int(a / (ss * ss)) for a in acc)
        rows.append(bytes(row))
    raw = zlib.compress(b"".join(rows), 9)

    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0))
    png += chunk(b"IDAT", raw) + chunk(b"IEND", b"")
    path.write_bytes(png)


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    render(192, OUT / "icon-192.png")
    render(512, OUT / "icon-512.png")
    render(180, OUT / "apple-touch-icon.png")
    print(f"Icons written to {OUT}")
