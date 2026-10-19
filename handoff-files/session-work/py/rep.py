"""Tiny exact-replace helper: apply(path, [(old, new), ...]) asserting each old occurs once."""
import sys


def apply(path, pairs):
    s = open(path).read()
    for a, b in pairs:
        n = s.count(a)
        if n != 1:
            sys.exit(f"{path}: expected 1 match, found {n}: {a[:80]!r}")
        s = s.replace(a, b, 1)
    open(path, 'w').write(s)
