p='editor/app/src/export/exporter.ts'
s=open(p).read()
a="""<<<<<<< HEAD
import { isAiMask, matteFor, mattes } from '../vision/mattes';
=======
import { exportSources } from '../player/files';
>>>>>>> 103ca8f (Lumora Studio: faster 4K playback, any camera format, and motion title templates)
"""
assert s.count(a)==1
s=s.replace(a,"""import { isAiMask, matteFor, mattes } from '../vision/mattes';
import { exportSources } from '../player/files';
""")
assert '<<<<<<<' not in s
open(p,'w').write(s)
print('ok')
