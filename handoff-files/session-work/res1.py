import re
p='editor/app/src/render/compositor.ts'
s=open(p).read()
a="""<<<<<<< HEAD
import { CUTOUT_FS, LIMIT_FS } from './maskfx';
import { drawText } from './text';
=======
import { drawText, textStamp } from './text';
>>>>>>> 103ca8f (Lumora Studio: faster 4K playback, any camera format, and motion title templates)
"""
assert s.count(a)==1
s=s.replace(a,"""import { CUTOUT_FS, LIMIT_FS } from './maskfx';
import { drawText, textStamp } from './text';
""")
i=s.index("<<<<<<< HEAD\n    this.place(tex")
j=s.index("=======\n",i)
k=s.index(">>>>>>> 103ca8f",j)
k2=s.index("\n",k)+1
head=s[i+len("<<<<<<< HEAD\n"):j]
head=head.replace("const data = new Float32Array(24);","const data = this.quadData;")
s=s[:i]+head+s[k2:]
assert '<<<<<<<' not in s and '>>>>>>>' not in s, 'more conflicts'
open(p,'w').write(s)
print('ok')
