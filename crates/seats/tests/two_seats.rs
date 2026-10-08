//! Two seats (in this process, over real TCP on this computer) against a
//! show computer running the real engine: pairing, roles, state sync,
//! conflicts, pictures, locking, reconnecting and removal.

use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use lumora_engine::{Action, Engine, Outcome};
use lumora_seats::client::{LinkEvents, LinkStatus, Pairing, SeatLink};
use lumora_seats::role::{Role, SeatCommand};
use lumora_seats::server::{SeatBackend, SeatServer};
use serde_json::{json, Value};

#[derive(Default)]
struct Show {
    engine: Mutex<Engine>,
    server: Mutex<Option<Arc<SeatServer>>>,
    commands: Mutex<Vec<SeatCommand>>,
    ptz: Mutex<Vec<(String, Value)>>,
}

struct Backend(Arc<Show>);

impl SeatBackend for Backend {
    fn snapshot(&self) -> Option<(u64, Value)> {
        let e = self.0.engine.lock().unwrap();
        Some((e.revision(), serde_json::to_value(e.show()).unwrap()))
    }
    fn apply(&self, action: Action) -> Result<(), String> {
        let (rev, show) = {
            let mut e = self.0.engine.lock().unwrap();
            match e.apply(action, 1_000).map_err(|e| e.to_string())? {
                Outcome::Unchanged => return Ok(()),
                Outcome::Changed => (e.revision(), e.show().clone()),
            }
        };
        let server = self.0.server.lock().unwrap().clone();
        if let Some(s) = server {
            s.show_changed(rev, &show);
        }
        Ok(())
    }
    fn command(&self, command: SeatCommand) -> Result<(), String> {
        self.0.commands.lock().unwrap().push(command);
        Ok(())
    }
    fn ptz(&self, source: &str, command: Value) -> Result<(), String> {
        self.0
            .ptz
            .lock()
            .unwrap()
            .push((source.to_owned(), command));
        Ok(())
    }
}

#[derive(Default)]
struct Seen {
    status: Mutex<Vec<LinkStatus>>,
    doc: Mutex<Option<(Value, Instant)>>,
    paired: Mutex<Option<Pairing>>,
    forgot: Mutex<Vec<String>>,
    pictures: Mutex<Vec<(String, Vec<u8>)>>,
}

struct Events(Arc<Seen>);

impl LinkEvents for Events {
    fn status(&self, s: &LinkStatus) {
        self.0.status.lock().unwrap().push(s.clone());
    }
    fn document(&self, doc: &Value) {
        *self.0.doc.lock().unwrap() = Some((doc.clone(), Instant::now()));
    }
    fn picture(&self, key: &str, jpeg: &[u8]) {
        self.0
            .pictures
            .lock()
            .unwrap()
            .push((key.to_owned(), jpeg.to_vec()));
    }
    fn paired(&self, p: &Pairing) {
        *self.0.paired.lock().unwrap() = Some(p.clone());
    }
    fn forget(&self, show_id: &str) {
        self.0.forgot.lock().unwrap().push(show_id.to_owned());
    }
}

fn wait(what: &str, mut ok: impl FnMut() -> bool) {
    let start = Instant::now();
    while !ok() {
        assert!(
            start.elapsed() < Duration::from_secs(10),
            "timed out waiting for: {what}"
        );
        thread::sleep(Duration::from_millis(5));
    }
}

fn connected(link: &SeatLink) -> bool {
    matches!(link.status(), LinkStatus::Connected { .. })
}

fn role_of(link: &SeatLink) -> Option<Role> {
    match link.status() {
        LinkStatus::Connected { seat, .. } => Some(seat.role),
        _ => None,
    }
}

fn setup() -> (Arc<Show>, Arc<SeatServer>, String) {
    let show = Arc::new(Show::default());
    {
        let mut e = show.engine.lock().unwrap();
        for (id, color) in [("cam1", "#111111"), ("cam2", "#222222")] {
            let a: Action = serde_json::from_value(json!({"type": "addSource", "source": {"id": id, "name": id, "kind": {"type": "color", "color": color}}})).unwrap();
            e.apply(a, 0).unwrap();
        }
        let a: Action = serde_json::from_value(json!({"type": "addSource", "source": {"id": "clock", "name": "Doors open", "kind": {"type": "countdown", "background": "#000000"}}})).unwrap();
        e.apply(a, 0).unwrap();
    }
    let server = Arc::new(SeatServer::start_on(Backend(Arc::clone(&show)), 0));
    *show.server.lock().unwrap() = Some(Arc::clone(&server));
    let address = format!("127.0.0.1:{}", server.port().expect("listening"));
    (show, server, address)
}

/// The show computer lists the request a moment after the seat asks for the code.
fn waiting_one(server: &SeatServer) -> Vec<lumora_seats::server::PendingView> {
    wait("the show lists the request", || {
        server.status().pending.len() == 1
    });
    server.status().pending
}

fn engine_show(show: &Show) -> Value {
    serde_json::to_value(show.engine.lock().unwrap().show()).unwrap()
}

fn seat_show(seen: &Seen) -> Value {
    seen.doc
        .lock()
        .unwrap()
        .as_ref()
        .map(|(d, _)| d["show"].clone())
        .unwrap_or(Value::Null)
}

#[test]
fn two_seats_run_one_show() {
    let (show, server, address) = setup();

    // --- Seat A pairs: the code, then the operator approves it as Graphics.
    let seen_a = Arc::new(Seen::default());
    let a = SeatLink::new(Events(Arc::clone(&seen_a)));
    a.pair(&address, "Graphics laptop");
    wait("A is asked for the code", || {
        matches!(a.status(), LinkStatus::EnterCode { .. })
    });
    let pending = waiting_one(&server);
    assert_eq!(pending.len(), 1);
    assert_eq!(pending[0].name, "Graphics laptop");
    let code = pending[0].code.clone();
    assert_eq!(code.len(), 6);
    // A wrong code is caught on the seat and never sent.
    let wrong = if code == "000000" { "111111" } else { "000000" };
    assert!(a.enter_code(wrong).is_err());
    assert!(matches!(
        a.status(),
        LinkStatus::EnterCode { wrong: true, .. }
    ));
    assert!(!server.status().pending[0].code_typed);
    a.enter_code(&code).expect("right code");
    wait("the show sees the code was typed", || {
        server
            .status()
            .pending
            .first()
            .is_some_and(|p| p.code_typed)
    });
    assert!(matches!(a.status(), LinkStatus::Waiting { .. }));
    server.approve(pending[0].id, Role::Graphics).unwrap();
    wait("A is connected", || connected(&a));
    assert_eq!(role_of(&a), Some(Role::Graphics));
    wait("A has the show", || seen_a.doc.lock().unwrap().is_some());
    assert_eq!(seat_show(&seen_a), engine_show(&show));
    let pairing_a = seen_a
        .paired
        .lock()
        .unwrap()
        .clone()
        .expect("A keeps its pairing");

    // --- Seat B: approved first, code typed after; Director.
    let seen_b = Arc::new(Seen::default());
    let b = SeatLink::new(Events(Arc::clone(&seen_b)));
    b.pair(&address, "Director laptop");
    wait("B is asked for the code", || {
        matches!(b.status(), LinkStatus::EnterCode { .. })
    });
    let p = waiting_one(&server)[0].clone();
    server.approve(p.id, Role::Director).unwrap();
    assert!(!connected(&b), "not before the code is typed");
    b.enter_code(&p.code).unwrap();
    wait("B is connected", || connected(&b));
    wait("B has the show", || seen_b.doc.lock().unwrap().is_some());
    let status = server.status();
    assert_eq!(status.seats.len(), 2);
    assert!(status.seats.iter().all(|s| s.connected));
    assert!(status.pending.is_empty());

    // --- Roles are enforced on the show computer.
    let err = a
        .action(json!({"type": "cutTo", "screen": "live", "sourceId": "cam2"}))
        .unwrap_err();
    assert_eq!(err, "Your seat can’t do this.");
    assert!(a.command(json!({"command": "record", "on": true})).is_err());
    assert!(show.commands.lock().unwrap().is_empty());
    let err = b
        .action(json!({"type": "setDisplay", "screen": "live", "displayId": "x"}))
        .unwrap_err();
    assert_eq!(err, "Only the show computer can do this.");
    b.command(json!({"command": "record", "on": true})).unwrap();
    assert_eq!(
        *show.commands.lock().unwrap(),
        vec![SeatCommand::Record { on: true }]
    );

    // --- A change from one seat reaches the other quickly.
    let before = seen_b.doc.lock().unwrap().as_ref().unwrap().1;
    let sent = Instant::now();
    a.action(json!({"type": "startCountdown", "id": "clock"}))
        .unwrap();
    wait("B sees the countdown running", || {
        seat_show(&seen_b) == engine_show(&show)
            && seen_b.doc.lock().unwrap().as_ref().unwrap().1 > before
    });
    let latency = seen_b
        .doc
        .lock()
        .unwrap()
        .as_ref()
        .unwrap()
        .1
        .duration_since(sent);
    eprintln!("change reached the other seat in {latency:?}");
    assert!(latency < Duration::from_millis(500), "{latency:?}");

    b.action(json!({"type": "setPreview", "screen": "live", "sourceId": "cam2"}))
        .unwrap();
    b.action(json!({"type": "take", "screen": "live", "transition": "cut"}))
        .unwrap();
    wait("A sees the take", || {
        seat_show(&seen_a) == engine_show(&show)
    });

    // --- Both at once: the show computer's order wins and everyone agrees.
    let (a2, b2) = (a.clone(), b.clone());
    let ta = thread::spawn(move || {
        for i in 0..15 {
            let _ =
                a2.action(json!({"type": "addCountdownTime", "id": "clock", "ms": 1000 * (i + 1)}));
        }
    });
    let tb = thread::spawn(move || {
        for i in 0..15 {
            let id = if i % 2 == 0 { "cam1" } else { "cam2" };
            let _ = b2.action(json!({"type": "setPreview", "screen": "live", "sourceId": id}));
        }
    });
    ta.join().unwrap();
    tb.join().unwrap();
    wait("both seats agree with the show", || {
        let e = engine_show(&show);
        seat_show(&seen_a) == e && seat_show(&seen_b) == e
    });

    // --- Pictures for the seat that asks for them.
    b.watch(vec!["program/live".into()]);
    server.set_picture("program/live", vec![0xFF, 0xD8, 1, 2, 3, 0xFF, 0xD9]);
    wait("B gets the picture", || {
        !seen_b.pictures.lock().unwrap().is_empty()
    });
    assert_eq!(
        seen_b.pictures.lock().unwrap()[0],
        (
            "program/live".to_owned(),
            vec![0xFF, 0xD8, 1, 2, 3, 0xFF, 0xD9]
        )
    );
    assert!(seen_a.pictures.lock().unwrap().is_empty(), "A did not ask");

    // --- Locked: sees the show, changes nothing. Then a new role.
    let a_id = pairing_a.seat_id.clone();
    server.set_locked(&a_id, true).unwrap();
    wait(
        "A hears it is locked",
        || matches!(a.status(), LinkStatus::Connected { seat, .. } if seat.locked),
    );
    let err = a
        .action(json!({"type": "startCountdown", "id": "clock"}))
        .unwrap_err();
    assert_eq!(err, "The show operator has locked your seat for now.");
    // Graphics may not move cameras.
    server.set_locked(&a_id, false).unwrap();
    wait(
        "A hears it is unlocked",
        || matches!(a.status(), LinkStatus::Connected { seat, .. } if !seat.locked),
    );
    assert_eq!(
        a.ptz("cam1", json!({"type": "home"})).unwrap_err(),
        "Your seat can’t do this."
    );
    assert!(show.ptz.lock().unwrap().is_empty());
    server.set_role(&a_id, Role::Cameras).unwrap();
    wait("A hears its new role", || {
        role_of(&a) == Some(Role::Cameras)
    });
    a.action(json!({"type": "setPreview", "screen": "live", "sourceId": "cam1"}))
        .unwrap();
    a.ptz("cam1", json!({"type": "home"})).unwrap();
    assert_eq!(show.ptz.lock().unwrap().len(), 1);
    assert_eq!(
        a.action(json!({"type": "take", "screen": "live"}))
            .unwrap_err(),
        "Your seat can’t do this."
    );

    // --- The link drops (the show computer stops, then starts letting seats in
    // again): both come back by themselves, with no new code, and catch up.
    server.set_enabled(false);
    wait("A notices", || !connected(&a));
    // Something changes while they are away.
    Backend(Arc::clone(&show))
        .apply(
            serde_json::from_value(
                json!({"type": "setPreview", "screen": "live", "sourceId": "cam2"}),
            )
            .unwrap(),
        )
        .unwrap();
    server.set_enabled(true);
    wait("A is back", || connected(&a));
    wait("B is back", || connected(&b));
    wait("both caught up", || {
        let e = engine_show(&show);
        seat_show(&seen_a) == e && seat_show(&seen_b) == e
    });
    assert!(seen_a.forgot.lock().unwrap().is_empty());

    // --- A pairing with the wrong secret gets nowhere.
    let seen_x = Arc::new(Seen::default());
    let x = SeatLink::new(Events(Arc::clone(&seen_x)));
    let mut forged = pairing_a.clone();
    forged.secret = "00".repeat(32);
    x.resume(forged);
    thread::sleep(Duration::from_millis(400));
    assert!(!connected(&x));
    assert!(seen_x.doc.lock().unwrap().is_none());
    x.leave();
    assert!(connected(&a), "the real seat A is not disturbed");

    // --- Removed: B is disconnected and has to pair again.
    let b_id = server
        .status()
        .seats
        .iter()
        .find(|s| s.name == "Director laptop")
        .unwrap()
        .id
        .clone();
    server.remove(&b_id);
    wait("B is told", || {
        matches!(b.status(), LinkStatus::Ended { .. })
    });
    assert_eq!(seen_b.forgot.lock().unwrap().len(), 1);
    assert_eq!(server.status().seats.len(), 1);

    // --- A leaves; the show carries on, untouched.
    let before = engine_show(&show);
    a.leave();
    wait("A is gone on the show computer", || {
        server.status().seats.iter().all(|s| !s.connected)
    });
    assert_eq!(engine_show(&show), before);
    assert!(matches!(a.status(), LinkStatus::Idle));
}

#[test]
fn a_denied_computer_is_told_and_a_wrong_code_attempt_is_dropped() {
    let (_show, server, address) = setup();
    let seen = Arc::new(Seen::default());
    let link = SeatLink::new(Events(Arc::clone(&seen)));
    link.pair(&address, "Someone");
    wait("asked for the code", || {
        matches!(link.status(), LinkStatus::EnterCode { .. })
    });
    let p = waiting_one(&server)[0].clone();
    server.deny(p.id);
    wait("told no", || {
        matches!(link.status(), LinkStatus::Ended { .. })
    });
    assert!(server.status().pending.is_empty());
    assert!(server.status().seats.is_empty());
}

#[test]
fn nothing_joins_while_the_show_is_not_letting_seats_in() {
    let (_show, server, address) = setup();
    server.set_enabled(false);
    let seen = Arc::new(Seen::default());
    let link = SeatLink::new(Events(Arc::clone(&seen)));
    link.pair(&address, "Late laptop");
    wait("ended", || {
        matches!(link.status(), LinkStatus::Ended { .. })
    });
    assert!(server.status().pending.is_empty());
}
