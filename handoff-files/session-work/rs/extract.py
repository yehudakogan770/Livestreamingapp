import re, os
src = open('/home/user/Livestreamingapp/.claude/worktrees/agent-a155a6f1093a2d850/src-tauri/src/control.rs').read()

def grab(name):
    m = re.search(r'\n((?:pub )?fn ' + name + r'\b[^{]*\{)', src)
    assert m, name
    i = m.start(1)
    depth = 0
    j = src.index('{', i)
    k = j
    while True:
        c = src[k]
        if c == '{': depth += 1
        elif c == '}':
            depth -= 1
            if depth == 0: break
        k += 1
    return src[i:k+1]

tests_start = src.index('mod tests')
names = ['get', 'parse_query', 'decode', 'sources', 'input', 'now_ms', 'parse_clock', 'titler']
body = 'use serde_json::{json, Value};\n\n' + '\n\n'.join(grab(n) for n in names)
# test fixture show() and the titler test
t = src[tests_start:]
def grab_t(name):
    m = re.search(r'\n(\s*fn ' + name + r'\b[^{]*\{)', t)
    i = m.start(1); j = t.index('{', i); k = j; depth = 0
    while True:
        c = t[k]
        if c == '{': depth += 1
        elif c == '}':
            depth -= 1
            if depth == 0: break
        k += 1
    return t[i:k+1]
test = grab_t('titler_fields_rows_and_timers')
test = test.replace('assert!(serde_json::from_value::<Action>(titler(&s, &q("name=Lower+third&do=toggle"), 5.0).unwrap()).is_ok());', 'assert!(titler(&s, &q("name=Lower+third&do=toggle"), 5.0).is_ok());')
body += '\n\n#[cfg(test)]\nmod tests {\n    use super::*;\n' + grab_t('show') + '\n    #[test]' + test + '\n}\n'
os.makedirs('/tmp/claude-0/-home-user-Livestreamingapp/afbb1772-1200-52da-905a-12b6de33f858/scratchpad/rs/src', exist_ok=True)
open('/tmp/claude-0/-home-user-Livestreamingapp/afbb1772-1200-52da-905a-12b6de33f858/scratchpad/rs/src/lib.rs', 'w').write(body)
open('/tmp/claude-0/-home-user-Livestreamingapp/afbb1772-1200-52da-905a-12b6de33f858/scratchpad/rs/Cargo.toml', 'w').write('[package]\nname = "ctl"\nversion = "0.1.0"\nedition = "2021"\n\n[dependencies]\nserde_json = "1"\n\n[workspace]\n')
print('ok')
