"""Dependency-free generation of a vector-like application icon."""
import struct
import zlib
from pathlib import Path

size = 512
polygons = [
    ([(92, 271), (256, 359), (420, 271), (420, 312), (256, 400), (92, 312)], (55, 114, 111)),
    ([(92, 214), (256, 302), (420, 214), (420, 255), (256, 343), (92, 255)], (79, 166, 151)),
    ([(92, 174), (256, 86), (420, 174), (256, 262)], (107, 221, 191)),
    ([(256, 114), (371, 175), (256, 237), (141, 175)], (28, 68, 68)),
]

def inside(poly, x, y):
    result = False
    previous = poly[-1]
    for point in poly:
        ax, ay = previous; bx, by = point
        if (ay > y) != (by > y) and x < (bx - ax) * (y - ay) / (by - ay) + ax:
            result = not result
        previous = point
    return result

pixels = bytearray()
for y in range(size):
    pixels.append(0)
    for x in range(size):
        color = (17, 29, 44)
        alpha = 255
        dx, dy = max(45 - x, 0, x - 466), max(45 - y, 0, y - 466)
        if dx * dx + dy * dy > 45 * 45: alpha = 0
        for polygon, paint in polygons:
            if inside(polygon, x + .5, y + .5): color = paint
        pixels.extend((*color, alpha))

def chunk(kind, data):
    return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)

png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(bytes(pixels))) + chunk(b'IEND', b'')
folder = Path(__file__).resolve().parent.parent / 'build'; folder.mkdir(exist_ok=True)
(folder / 'icon.png').write_bytes(png)
ico = struct.pack('<HHH', 0, 1, 1) + struct.pack('<BBBBHHII', 0, 0, 0, 0, 1, 32, len(png), 22) + png
(folder / 'icon.ico').write_bytes(ico)
print('Application icons generated.')
