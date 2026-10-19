root='/home/user/Livestreamingapp/.claude/worktrees/agent-aa20d25c9832f0a41/'
p=root+'crates/titler-host/src/lib.rs'
lines=open(p).read().split('\n')
out=[];cmd=[]
i=0
while i<len(lines):
    l=lines[i]
    if l.strip()=='#[tauri::command]':
        # include preceding doc comments
        docs=[]
        while out and out[-1].startswith('///'):
            docs.insert(0,out.pop())
        j=i
        while lines[j]!='}':
            j+=1
        cmd.extend(docs+lines[i:j+1]+[''])
        i=j+1
        # drop one blank line after
        if i<len(lines) and lines[i]=='':
            i+=1
        continue
    out.append(l)
    i+=1
src='\n'.join(out)
src=src.replace("use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindowBuilder};","use tauri::{AppHandle, Manager};\n\npub mod cmd;")
open(p,'w').write(src)
header='''//! The commands the apps register (`titler_host::cmd::…` in their
//! `generate_handler!`). Kept in their own module: Tauri's command glue can't
//! be public at a crate's root.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Stdio;

use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindowBuilder};

use super::{
    autosave_path, encode_args, find_ffmpeg, free_path, is_title, library_dir, list, mime, quiet,
    write_atomic, Job, LibraryEntry, Renders, EXT, MAX_READ, WINDOW,
};

'''
open(root+'crates/titler-host/src/cmd.rs','w').write(header+'\n'.join(cmd))
for f in ['src-tauri/src/lib.rs','editor/src-tauri/src/lib.rs','titler/src-tauri/src/lib.rs']:
    s=open(root+f).read()
    s=s.replace('titler_host::titler_','titler_host::cmd::titler_')
    open(root+f,'w').write(s)
