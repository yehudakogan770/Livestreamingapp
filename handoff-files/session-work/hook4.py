import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-aba3a6fa63da8b178')
p='src-tauri/src/atem.rs'
s=open(p).read()
old='''pub fn mirror_tally(tally: &mut Value, show: &Value) {
    let m = lock(mirror()).clone();
    tally["atem"] = json!({'''
assert old in s
s=s.replace(old,'''pub fn mirror_tally(tally: &mut Value, show: &Value) {
    let m = lock(mirror()).clone();
    mirror_into(tally, show, &m);
}

fn mirror_into(tally: &mut Value, show: &Value, m: &Mirror) {
    // Nothing added while no switcher is in use (the tally stays as it always was).
    if !m.settings.connect {
        return;
    }
    tally["atem"] = json!({''')
s=s.replace('''        *lock(mirror()) = Mirror { connected: true, settings: s.clone(), state: atem(1, 2) };
        let mut t = base.clone();
        mirror_tally(&mut t, &show);''','''        let m = Mirror { connected: true, settings: s.clone(), state: atem(1, 2) };
        let mut t = base.clone();
        mirror_into(&mut t, &show, &m);''')
s=s.replace('''        t["inputs"][2]["program"] = json!(false);
        mirror_tally(&mut t, &show);''','''        t["inputs"][2]["program"] = json!(false);
        mirror_into(&mut t, &show, &m);''')
s=s.replace('''        s.follow = false;
        *lock(mirror()) = Mirror { connected: true, settings: s, state: atem(1, 2) };
        let mut t = base.clone();
        mirror_tally(&mut t, &show);
        assert_eq!(t["inputs"][0]["program"], false);
        assert_eq!(t["atem"]["connected"], true);
        *lock(mirror()) = Mirror::default();''','''        s.follow = false;
        let m = Mirror { connected: true, settings: s.clone(), state: atem(1, 2) };
        let mut t = base.clone();
        mirror_into(&mut t, &show, &m);
        assert_eq!(t["inputs"][0]["program"], false);
        assert_eq!(t["atem"]["connected"], true);
        // No switcher in use: the tally is untouched.
        s.connect = false;
        let m = Mirror { connected: false, settings: s, state: SwitcherState::default() };
        let mut t = base.clone();
        mirror_into(&mut t, &show, &m);
        assert_eq!(t, base);''')
open(p,'w').write(s)
