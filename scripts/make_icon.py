"""Draw the Session mark as a PNG the Tauri icon command can consume."""

from __future__ import annotations

import struct
import zlib
from pathlib import Path


def chunk(tag: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)


def blend(color: tuple[int, int, int, int], over: tuple[int, int, int, int]) -> tuple[int, int, int, int]:
    alpha = color[3] / 255
    return tuple(int(color[i] * alpha + over[i] * (1 - alpha)) for i in range(3)) + (255,)  # type: ignore[return-value]


def in_round_rect(x: float, y: float, left: float, top: float, right: float, bottom: float, radius: float) -> bool:
    if x < left or x > right or y < top or y > bottom:
        return False
    if x < left + radius and y < top + radius:
        return (x - (left + radius)) ** 2 + (y - (top + radius)) ** 2 <= radius**2
    if x > right - radius and y < top + radius:
        return (x - (right - radius)) ** 2 + (y - (top + radius)) ** 2 <= radius**2
    if x < left + radius and y > bottom - radius:
        return (x - (left + radius)) ** 2 + (y - (bottom - radius)) ** 2 <= radius**2
    if x > right - radius and y > bottom - radius:
        return (x - (right - radius)) ** 2 + (y - (bottom - radius)) ** 2 <= radius**2
    return True


def segment_distance(x: float, y: float, ax: float, ay: float, bx: float, by: float) -> float:
    dx, dy = bx - ax, by - ay
    length_sq = dx * dx + dy * dy
    if length_sq == 0:
        return ((x - ax) ** 2 + (y - ay) ** 2) ** 0.5
    t = max(0.0, min(1.0, ((x - ax) * dx + (y - ay) * dy) / length_sq))
    return ((x - (ax + t * dx)) ** 2 + (y - (ay + t * dy)) ** 2) ** 0.5


def pixel(x: int, y: int, size: int) -> tuple[int, int, int, int]:
    green = (14, 107, 82, 255)
    paper = (247, 244, 239, 255)
    business = (29, 78, 137, 255)
    personal = (141, 74, 50, 255)
    scale = 128 / size
    sx = (x + 0.5) * scale
    sy = (y + 0.5) * scale
    if not in_round_rect(sx, sy, 0, 0, 128, 128, 28):
        return (0, 0, 0, 0)
    color = green
    if in_round_rect(sx, sy, 22, 38, 106, 92, 10):
        color = paper
    flap = min(segment_distance(sx, sy, 28, 46, 64, 70), segment_distance(sx, sy, 64, 70, 100, 46))
    if flap <= 2.4:
        color = green
    if (sx - 86) ** 2 + (sy - 34) ** 2 <= 11**2:
        color = business
    if (sx - 100) ** 2 + (sy - 46) ** 2 <= 8**2:
        color = personal
    return color


def png_bytes(size: int) -> bytes:
    raw = bytearray()
    for y in range(size):
        raw.append(0)
        for x in range(size):
            red, green, blue, alpha = pixel(x, y, size)
            raw.extend((red, green, blue, alpha))
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(bytes(raw), 9)) + chunk(b"IEND", b"")


def write_png(path: Path, size: int = 1024) -> None:
    path.write_bytes(png_bytes(size))


def write_ico(path: Path, sizes: tuple[int, ...] = (16, 24, 32, 48, 64, 128, 256)) -> None:
    images = [(size, png_bytes(size)) for size in sizes]
    header = struct.pack("<HHH", 0, 1, len(images))
    entries = bytearray()
    blobs = bytearray()
    offset = 6 + 16 * len(images)
    for size, data in images:
        dimension = 0 if size >= 256 else size
        entries.extend(struct.pack("<BBBBHHII", dimension, dimension, 0, 0, 1, 32, len(data), offset))
        blobs.extend(data)
        offset += len(data)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(header + entries + blobs)


if __name__ == "__main__":
    root = Path(__file__).resolve().parents[1]
    write_png(root / "docs" / "icon.png", 256)
    write_ico(root / "desktop" / "electron" / "icon.ico")
    write_ico(root / "desktop" / "src-tauri" / "icons" / "icon.ico")
