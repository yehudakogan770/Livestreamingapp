import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-ac66441c90a567d82')
def rep(p, old, new):
    s = open(p).read()
    assert old in s, (p, old)
    s = s.replace(old, new, 1)
    open(p, 'w').write(s)

rep('src-tauri/src/accounts.rs', '''/// How each connected destination is doing.
#[tauri::command]''', '''/// New comments on the Facebook live video on air through the account.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FacebookComments {
    pub comments: Vec<facebook::Comment>,
    /// Ask from here next time.
    pub after: String,
}

/// The live chat reads Facebook comments: those after `after` (empty: from the start).
#[tauri::command]
pub async fn accounts_facebook_comments(
    app: AppHandle,
    after: String,
) -> Result<FacebookComments, String> {
    blocking(app, move |la| {
        lock(&la.accounts)
            .facebook_comments(&la.net, &after)
            .map(|(comments, after)| FacebookComments { comments, after })
            .map_err(|e| e.message)
    })
    .await
}

/// How each connected destination is doing.
#[tauri::command]''')
rep('src-tauri/src/lib.rs', '''            accounts::accounts_sessions,''', '''            accounts::accounts_sessions,
            accounts::accounts_facebook_comments,''')
