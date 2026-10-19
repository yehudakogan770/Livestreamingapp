p='editor/app/src/player/engine.ts'
s=open(p).read()
a="""<<<<<<< HEAD
import { frameOps, videoNeeds, type Layer, type Op } from '../render/frame';
import { matteFor, mattes } from '../vision/mattes';
=======
import { allLayers, frameOps, sourceAt, videoNeeds, type Layer, type Op } from '../render/frame';
>>>>>>> 103ca8f (Lumora Studio: faster 4K playback, any camera format, and motion title templates)
"""
assert s.count(a)==1
s=s.replace(a,"""import { allLayers, frameOps, sourceAt, videoNeeds, type Layer, type Op } from '../render/frame';
import { matteFor, mattes } from '../vision/mattes';
""")
assert '<<<<<<<' not in s
open(p,'w').write(s)
print('ok')
