import struct, sys
W, H = 1920, 1080
layers = [
    # name, (top,left,bottom,right), rgba
    ("Backplate", (820, 120, 960, 900), (18, 22, 30, 235)),
    ("Accent", (820, 104, 960, 116), (210, 50, 45, 255)),
    ("Logo", (60, 1640, 160, 1840), (240, 240, 240, 255)),
]
recs = b""
data = b""
for name, (t, l, b, r), col in layers:
    w, h = r - l, b - t
    chans = []
    for cid, ci in ((-1, 3), (0, 0), (1, 1), (2, 2)):
        # RLE rows of a flat value
        rows = []
        for _ in range(h):
            row = b""
            n = w
            while n > 0:
                k = min(128, n)
                row += bytes([257 - k if k > 1 else 0, col[ci]])
                n -= k
            rows.append(row)
        d = struct.pack(">H", 1) + b"".join(struct.pack(">H", len(x)) for x in rows) + b"".join(rows)
        chans.append((cid, d))
    rec = struct.pack(">iiiiH", t, l, b, r, 4)
    for cid, d in chans:
        rec += struct.pack(">hI", cid, len(d))
    nm = name.encode()
    pas = bytes([len(nm)]) + nm
    while len(pas) % 4:
        pas += b"\0"
    extra = struct.pack(">II", 0, 0) + pas
    rec += b"8BIMnorm" + bytes([255, 0, 0, 0]) + struct.pack(">I", len(extra)) + extra
    recs += rec
    data += b"".join(d for _, d in chans)
info = struct.pack(">h", len(layers)) + recs + data
if len(info) % 2:
    info += b"\0"
lm = struct.pack(">I", len(info)) + info + struct.pack(">I", 0)
out = b"8BPS" + struct.pack(">H", 1) + b"\0" * 6 + struct.pack(">HIIHH", 4, H, W, 8, 3) + struct.pack(">I", 0) + struct.pack(">I", 0) + struct.pack(">I", len(lm)) + lm
open(sys.argv[1], "wb").write(out)
