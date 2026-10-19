import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-ae2e4fb2496ef2830')
p = 'src-tauri/src/remote.rs'
s = open(p).read()


def rep(old, new):
    global s
    assert old in s, old[:80]
    s = s.replace(old, new)


rep("""    /// Where photos sent to a messages wall are kept.
    photos: Option<PathBuf>,
}""", """    /// Where photos sent to a messages wall are kept.
    photos: Option<PathBuf>,
    /// Wrong PINs, to stop anyone on the network guessing it.
    guesses: Mutex<HashMap<IpAddr, (u32, std::time::Instant)>>,
    /// Wrong PINs are answered one at a time (see `check_pin`).
    slow: Mutex<()>,
    /// When the last photos came (all phones together), so they can't fill the disk.
    photo_times: Mutex<std::collections::VecDeque<u64>>,
}""")
rep("""                photos: dir.map(|d| d.join("wall-photos")),
            }),""", """                photos: dir.map(|d| d.join("wall-photos")),
                guesses: Mutex::new(HashMap::new()),
                slow: Mutex::new(()),
                photo_times: Mutex::new(std::collections::VecDeque::new()),
            }),""")
new1 = """            if let Err(status) = check_pin(shared, &request, query) {
                return json(request, status, r#"{"code":"wrongPin"}"#);
            }"""
rep("""            if !authorised(shared, &request, query) {
                std::thread::sleep(Duration::from_millis(500));
                return json(request, 401, r#"{"code":"wrongPin"}"#);
            }""", new1)
rep("""            if !authorised(shared, &request, query) {
                // Slow down anyone guessing.
                std::thread::sleep(Duration::from_millis(500));
                return json(request, 401, r#"{"code":"wrongPin"}"#);
            }""", new1)
rep("""fn authorised(shared: &Shared, request: &Request, query: &str) -> bool {""", """/// Wrong PINs one address may send before it has to wait.
const FREE_GUESSES: u32 = 5;
/// The first wait; it doubles with every wrong PIN after that (up to `MAX_WAIT`).
const FIRST_WAIT: Duration = Duration::from_secs(60);
const MAX_WAIT: Duration = Duration::from_secs(15 * 60);

/// How long an address with this many wrong PINs must wait after the last one.
fn wait_after(wrong: u32) -> Duration {
    if wrong < FREE_GUESSES {
        return Duration::ZERO;
    }
    let doublings = (wrong - FREE_GUESSES).min(10);
    FIRST_WAIT.saturating_mul(1 << doublings).min(MAX_WAIT)
}

/// The PIN, checked so it can't be guessed: a phone (address) that sends
/// `FREE_GUESSES` wrong ones waits a minute, then longer each time; and
/// wrong PINs are answered one at a time, half a second each, so even many
/// phones together try at most two a second. 401: wrong; 429: wait.
fn check_pin(shared: &Shared, request: &Request, query: &str) -> Result<(), u16> {
    let ip = request
        .remote_addr()
        .map_or(IpAddr::from([0, 0, 0, 0]), SocketAddr::ip);
    let now = std::time::Instant::now();
    if let Some(&(wrong, last)) = lock(&shared.guesses).get(&ip) {
        if now.duration_since(last) < wait_after(wrong) {
            return Err(429);
        }
    }
    if authorised(shared, request, query) {
        lock(&shared.guesses).remove(&ip);
        return Ok(());
    }
    {
        let mut guesses = lock(&shared.guesses);
        // Forget addresses that stopped long ago (memory stays small).
        guesses.retain(|_, (_, last)| now.duration_since(*last) < MAX_WAIT * 2);
        let e = guesses.entry(ip).or_insert((0, now));
        *e = (e.0.saturating_add(1), now);
    }
    let _one_at_a_time = lock(&shared.slow);
    std::thread::sleep(Duration::from_millis(500));
    Err(401)
}

fn authorised(shared: &Shared, request: &Request, query: &str) -> bool {""")
rep("""    given.as_deref() == Some(pin.as_str())
}""", """    given.is_some_and(|g| same(g.as_bytes(), pin.as_bytes()))
}

/// Equal, taking the same time whichever character differs.
fn same(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |d, (x, y)| d | (x ^ y)) == 0
}""")
# Photos: at most PHOTOS_PER_MINUTE from all phones together.
rep("""    let photo = if body.is_empty() {
        None
    } else {
        // Only JPEG pictures are kept.
        if !body.starts_with(&[0xFF, 0xD8, 0xFF]) {
            return Err(415);
        }""", """    let photo = if body.is_empty() {
        None
    } else {
        // Only JPEG pictures are kept.
        if !body.starts_with(&[0xFF, 0xD8, 0xFF]) {
            return Err(415);
        }
        // The phone's name is its own choice, so also a limit for everyone.
        if !photo_allowed(&mut lock(&shared.photo_times), now) {
            return Err(429);
        }""")
rep("""/// Biggest photo from a phone (the page makes them smaller first).
const MAX_PHOTO: usize = 6_000_000;""", """/// Biggest photo from a phone (the page makes them smaller first).
const MAX_PHOTO: usize = 6_000_000;
/// Photos kept a minute, from all phones together (so the disk can't be filled).
const PHOTOS_PER_MINUTE: usize = 30;

/// Room for one more photo now (and it is counted)?
fn photo_allowed(times: &mut std::collections::VecDeque<u64>, now: u64) -> bool {
    while times.front().is_some_and(|&t| now.saturating_sub(t) >= 60_000) {
        times.pop_front();
    }
    if times.len() >= PHOTOS_PER_MINUTE {
        return false;
    }
    times.push_back(now);
    true
}""")
rep("""    #[test]
    fn a_phone_cannot_change_the_setup() {""", """    #[test]
    fn guessing_the_pin_is_stopped() {
        let (r, _) = remote();
        let st = r.set_enabled(true);
        let port = st.port.expect("listening");
        let wrong = if st.pin == "0000" { "1111" } else { "0000" };
        for _ in 0..FREE_GUESSES {
            assert_eq!(request(port, "POST", "/api/check", wrong, "").0, 401);
        }
        // Now even the right PIN must wait (from this address).
        assert_eq!(request(port, "POST", "/api/check", &st.pin, "").0, 429);
        assert_eq!(request(port, "GET", "/api/tally", &st.pin, "").0, 429);
        assert_eq!(wait_after(FREE_GUESSES - 1), Duration::ZERO);
        assert_eq!(wait_after(FREE_GUESSES), FIRST_WAIT);
        assert_eq!(wait_after(FREE_GUESSES + 1), FIRST_WAIT * 2);
        assert_eq!(wait_after(1000), MAX_WAIT);
        assert!(same(b"1234", b"1234") && !same(b"1234", b"1235") && !same(b"123", b"1234"));
    }

    #[test]
    fn photos_are_limited_for_everyone_together() {
        let mut times = std::collections::VecDeque::new();
        for _ in 0..PHOTOS_PER_MINUTE {
            assert!(photo_allowed(&mut times, 1_000));
        }
        assert!(!photo_allowed(&mut times, 30_000));
        assert!(photo_allowed(&mut times, 61_000));
    }

    #[test]
    fn a_phone_cannot_change_the_setup() {""")
open(p, 'w').write(s)
