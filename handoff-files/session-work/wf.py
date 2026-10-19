import sys, yaml, os
wf = yaml.safe_load(open(sys.argv[1]))
outdir = sys.argv[2]
print("triggers:", list(wf[True].keys()) if True in wf else list(wf['on'].keys()))
for i, st in enumerate(wf['jobs']['backup']['steps']):
    print(i, st.get('name'), st.get('uses', ''))
    if 'run' in st:
        p = os.path.join(outdir, f'step{i}.sh')
        open(p, 'w').write('#!/bin/bash\n' + st['run'].replace('${{', '$X{{'))
