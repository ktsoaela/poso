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


def pixel(x: int, y: int, size: int) -> tuple[int, int, int, int]:
    green = (14, 107, 82, 255)
    paper = (247, 244, 239, 255)
    business = (29, 78, 137, 255)
    personal = (141, 74, 50, 255)
    margin = size * 0.08
    radius = size * 0.22
    inside = margin <= x <= size - margin and margin <= y <= size - margin
    if inside:
        for cx, cy in ((margin, margin), (size - margin, margin), (margin, size - margin), (size - margin, size - margin)):
            if (x - cx) ** 2 + (y - cy) ** 2 > radius**2 and (
                (x < margin + radius and y < margin + radius)
                or (x > size - margin - radius and y < margin + radius)
                or (x < margin + radius and y > size - margin - radius)
                or (x > size - margin - radius and y > size - margin - radius)
            ):
                inside = False
    base = green if inside else (0, 0, 0, 0)
    if not inside:
        return base
    left, top, right, bottom = size * 0.22, size * 0.34, size * 0.78, size * 0.72
    if left <= x <= right and top <= y <= bottom:
        base = paper
        flap_y = top + (x - left) * 0.42 if x < size / 2 else top + (right - x) * 0.42
        if top <= y <= flap_y + size * 0.02:
            base = green
    for cx, cy, rad, color in (
        (size * 0.68, size * 0.30, size * 0.09, business),
        (size * 0.78, size * 0.40, size * 0.065, personal),
    ):
        if (x - cx) ** 2 + (y - cy) ** 2 <= rad**2:
            base = color
    return base


def write_png(path: Path, size: int = 1024) -> None:
    raw = bytearray()
    for y in range(size):
        raw.append(0)
        for x in range(size):
            red, green, blue, alpha = pixel(x, y, size)
            raw.extend((red, green, blue, alpha))
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(bytes(raw), 9)) + chunk(b"IEND", b"")
    path.write_bytes(png)


if __name__ == "__main__":
    root = Path(__file__).resolve().parents[1]
    write_png(root / "docs" / "icon.png")
