"""Apply exact replacements: rep.py FILE SPEC.

SPEC: blocks, each starting with a line '@@@' (or '@@@ N' for N occurrences),
then the old text, a line '===', the new text."""
import sys

path, spec = sys.argv[1], sys.argv[2]
s = open(path).read()
text = open(spec).read()
assert text.startswith("@@@"), "spec starts with @@@"
blocks = ("\n" + text).split("\n@@@")[1:]
for b in blocks:
    head, _, rest = b.partition("\n")
    head = head.strip()
    cnt = int(head) if head.isdigit() else 1
    old, sep, new = rest.partition("\n===\n")
    if not sep:
        print("BAD BLOCK", rest[:80])
        sys.exit(1)
    if new.endswith("\n"):
        new = new[:-1]
    n = s.count(old)
    if n != cnt:
        print("MISMATCH want", cnt, "got", n, ":", old[:160])
        sys.exit(1)
    s = s.replace(old, new)
open(path, "w").write(s)
print("ok", len(blocks))
