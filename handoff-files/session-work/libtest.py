import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-ae2e4fb2496ef2830')
p = 'src-tauri/src/lib.rs'
s = open(p).read()
old = """        assert_eq!(snapshot_name(""), "Snapshot.png");
    }
}"""
assert s.rstrip().endswith(old)
s = s.rstrip()[: -len(old)] + """        assert_eq!(snapshot_name(""), "Snapshot.png");
    }

    /// Web page windows (`page-*`) show pages from the internet: no
    /// capability may cover them, and the screens get only their own window.
    #[test]
    fn web_page_windows_get_no_permissions() {
        for text in [
            include_str!("../capabilities/default.json"),
            include_str!("../capabilities/outputs.json"),
        ] {
            let v: serde_json::Value = serde_json::from_str(text).unwrap();
            for w in v["windows"].as_array().unwrap() {
                let w = w.as_str().unwrap();
                assert!(w == "control" || w == "output-*", "{w}");
            }
            assert!(v.get("remote").is_none(), "no web address may use Lumora's commands");
            if v["windows"][0] == "output-*" {
                let perms = v["permissions"].to_string();
                assert!(!perms.contains("dialog") && !perms.contains("updater") && !perms.contains("process"), "{perms}");
            }
        }
    }
}
"""
open(p, 'w').write(s)
