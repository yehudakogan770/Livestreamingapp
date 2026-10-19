import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-ae2e4fb2496ef2830')
p = 'src-tauri/src/remote.rs'
s = open(p).read()
old = """            if let Err(status) = check_pin(shared, &request, query) {
                return json(request, status, r#"{"code":"wrongPin"}"#);
            }"""
assert s.count(old) == 2
s = s.replace(old, """            if let Err(status) = check_pin(shared, &request, query) {
                return json(request, status, pin_refused(status));
            }""")
s = s.replace("""fn authorised(shared: &Shared, request: &Request, query: &str) -> bool {""", """/// What a phone is told when its PIN is refused.
fn pin_refused(status: u16) -> &'static str {
    if status == 429 {
        r#"{"code":"tooManyTries"}"#
    } else {
        r#"{"code":"wrongPin"}"#
    }
}

fn authorised(shared: &Shared, request: &Request, query: &str) -> bool {""", 1)
open(p, 'w').write(s)

p = 'src-tauri/remote/remote.js'
s = open(p).read()
old = """      case 'wrongPin':
        return 'The PIN was changed on the computer.';"""
assert old in s
s = s.replace(old, old + """
      case 'tooManyTries':
        return 'Too many wrong PINs from this phone. Wait a few minutes, then try again.';""")
old = """      if (res.status === 401) return needPin(describe(err));"""
assert old in s
s = s.replace(old, """      if (res.status === 401 || res.status === 429) return needPin(describe(err));""")
old = """      if (res.status === 401) return needPin(pin ? 'That PIN is not right. Look at the computer: Settings → Phone remote.' : '');"""
assert old in s
s = s.replace(old, old + """
      if (res.status === 429) return needPin('Too many wrong PINs from this phone. Wait a few minutes, then try again.');""")
open(p, 'w').write(s)
