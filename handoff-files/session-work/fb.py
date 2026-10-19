import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-ac66441c90a567d82')
p='crates/live-accounts/src/facebook.rs'
s=open(p).read()
def rep(old,new):
    global s
    assert old in s, old
    s=s.replace(old,new,1)
rep('''/// What Lumora asks for: list the Pages, post live videos to them.
pub const SCOPES: &str =
    "public_profile,pages_show_list,pages_read_engagement,pages_manage_posts,publish_video";''','''/// What Lumora asks for: list the Pages, post live videos to them, and read
/// the comments on those live videos (for the live chat).
pub const SCOPES: &str = "public_profile,pages_show_list,pages_read_engagement,\\
pages_read_user_content,pages_manage_posts,publish_video";''')
rep('''/// How a live video is doing.''','''/// The comments on a live video, oldest first, after `after` (a cursor from
/// the last answer; empty: from the start).
#[must_use]
pub fn comments(id: &str, after: &str) -> Request {
    let mut url = format!(
        "{GRAPH}/{}/comments?order=chronological&filter=stream&live_filter=no_filter\\
         &fields=id,message,from%7Bname%7D&limit=100",
        encode(id)
    );
    if !after.is_empty() {
        url.push_str("&after=");
        url.push_str(&encode(after));
    }
    Request::get(url)
}

/// One comment from a Facebook live video.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Comment {
    pub id: String,
    pub author: String,
    pub text: String,
}

/// The comments in an answer, and the cursor to ask from next time (the old
/// one when there was nothing new).
///
/// # Errors
/// Facebook refused, in words.
pub fn parse_comments(resp: &Response, after: &str) -> Result<(Vec<Comment>, String), AccountError> {
    let v = ok_json(resp)?;
    let list = v["data"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|c| {
                    let text = c["message"].as_str().unwrap_or_default().trim();
                    let id = c["id"].as_str().unwrap_or_default();
                    (!text.is_empty() && !id.is_empty()).then(|| Comment {
                        id: id.to_owned(),
                        author: c["from"]["name"]
                            .as_str()
                            .filter(|n| !n.trim().is_empty())
                            .unwrap_or("Facebook viewer")
                            .to_owned(),
                        text: text.to_owned(),
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    let next = v["paging"]["cursors"]["after"]
        .as_str()
        .filter(|c| !c.is_empty())
        .unwrap_or(after)
        .to_owned();
    Ok((list, next))
}

/// How a live video is doing.''')
rep('''    #[test]
    fn builds_the_sign_in_address() {''','''    #[test]
    fn reads_live_comments_and_keeps_the_place() {
        let r = comments("9876", "");
        assert!(r.url.starts_with("https://graph.facebook.com/v21.0/9876/comments?"));
        assert_eq!(r.query_value("order").unwrap(), "chronological");
        assert_eq!(r.query_value("live_filter").unwrap(), "no_filter");
        assert_eq!(r.query_value("fields").unwrap(), "id,message,from{name}");
        assert!(r.query_value("after").is_none());
        assert_eq!(comments("9876", "QVF+x").query_value("after").unwrap(), "QVF+x");

        let resp = Response::new(
            200,
            r#"{"data":[{"id":"1_2","message":" Hello from Ohio ","from":{"name":"Ana"}},
                {"id":"1_3","message":""},{"id":"1_4","message":"Great show"}],
                "paging":{"cursors":{"before":"b","after":"NEXT"}}}"#,
        );
        let (list, next) = parse_comments(&resp, "OLD").unwrap();
        assert_eq!(
            list,
            vec![
                Comment {
                    id: "1_2".into(),
                    author: "Ana".into(),
                    text: "Hello from Ohio".into()
                },
                Comment {
                    id: "1_4".into(),
                    author: "Facebook viewer".into(),
                    text: "Great show".into()
                },
            ]
        );
        assert_eq!(next, "NEXT");
        let (none, same) = parse_comments(&Response::new(200, r#"{"data":[]}"#), "OLD").unwrap();
        assert!(none.is_empty());
        assert_eq!(same, "OLD");
        let err = parse_comments(
            &Response::new(400, r#"{"error":{"code":190,"message":"expired"}}"#),
            "",
        )
        .unwrap_err();
        assert!(err.message.contains("Connect Facebook again"));
    }

    #[test]
    fn builds_the_sign_in_address() {''')
open(p,'w').write(s)

p='crates/live-accounts/src/service.rs'
s=open(p).read()
rep('''    /// How each connected destination is doing (the last stream's, after it stopped).''','''    /// The newest comments on the Facebook live video now on air through the
    /// account (after `after`, the cursor of the last answer), and the cursor
    /// for next time.
    ///
    /// # Errors
    /// Nothing is live on Facebook through the account, or Facebook refused.
    pub fn facebook_comments(
        &self,
        http: &dyn Http,
        after: &str,
    ) -> Result<(Vec<facebook::Comment>, String), AccountError> {
        let s = self
            .sessions
            .iter()
            .find(|s| !s.ended && s.view.provider == Provider::Facebook && !s.fb_token.is_empty())
            .ok_or_else(|| {
                AccountError::new(
                    "Facebook comments come in once you go live on Facebook through a connected \\
                     account (Settings → Recording and streaming).",
                )
            })?;
        let resp = http
            .send(&facebook::comments(&s.id, after).bearer(&s.fb_token))
            .map_err(|e| AccountError::offline("Facebook", &e))?;
        facebook::parse_comments(&resp, after)
    }

    /// How each connected destination is doing (the last stream's, after it stopped).''')
open(p,'w').write(s)
