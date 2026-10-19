import sys
p, links = sys.argv[1], open(sys.argv[2]).read().rstrip('\n')
s = open(p).read()
a = '    <link rel="manifest" href="./manifest.webmanifest" />\n'
assert a in s
s = s.replace(a, a + '    <!-- iPhone launch screens (made from the boot screen below), light and dark. -->\n' + links + '\n', 1)
b = "      /* Before the app has loaded: the mark and the name, on the app's own background. */\n"
assert b in s
s = s.replace(b, "      html { background: #f5f5f4; }\n      @media (prefers-color-scheme: dark) { html { background: #141413; } }\n" + b, 1)
open(p, 'w').write(s)
