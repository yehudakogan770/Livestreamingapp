//! Keeping a seat's copy of the show the same as the show computer's: the
//! whole thing when a seat joins, then only what changed.
//!
//! A change is a list of steps, each a path into the JSON and the new value
//! there (or "gone"). Lists that changed length are sent whole.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

/// One step of a change.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Op {
    /// Object keys (strings) and list places (numbers), from the top.
    pub p: Vec<Value>,
    /// The new value (ignored when `d`).
    #[serde(default)]
    pub v: Value,
    /// This key is gone.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub d: bool,
}

/// What changed from `before` to `after`.
#[must_use]
pub fn diff(before: &Value, after: &Value) -> Vec<Op> {
    let mut ops = Vec::new();
    let mut path = Vec::new();
    walk(before, after, &mut path, &mut ops);
    ops
}

fn walk(a: &Value, b: &Value, path: &mut Vec<Value>, ops: &mut Vec<Op>) {
    if a == b {
        return;
    }
    match (a, b) {
        (Value::Object(ma), Value::Object(mb)) => {
            for k in ma.keys() {
                if !mb.contains_key(k) {
                    let mut p = path.clone();
                    p.push(Value::String(k.clone()));
                    ops.push(Op {
                        p,
                        v: Value::Null,
                        d: true,
                    });
                }
            }
            for (k, vb) in mb {
                path.push(Value::String(k.clone()));
                match ma.get(k) {
                    Some(va) => walk(va, vb, path, ops),
                    None => ops.push(Op {
                        p: path.clone(),
                        v: vb.clone(),
                        d: false,
                    }),
                }
                path.pop();
            }
        }
        (Value::Array(la), Value::Array(lb)) if la.len() == lb.len() => {
            for (i, (va, vb)) in la.iter().zip(lb).enumerate() {
                path.push(Value::from(i));
                walk(va, vb, path, ops);
                path.pop();
            }
        }
        _ => ops.push(Op {
            p: path.clone(),
            v: b.clone(),
            d: false,
        }),
    }
}

/// The change does not fit this copy (it missed one): ask for the whole show.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Mismatch;

fn step<'a>(v: &'a mut Value, seg: &Value) -> Result<&'a mut Value, Mismatch> {
    match (v, seg) {
        (Value::Object(m), Value::String(k)) => m.get_mut(k).ok_or(Mismatch),
        (Value::Array(l), Value::Number(n)) => {
            let i = usize::try_from(n.as_u64().ok_or(Mismatch)?).map_err(|_| Mismatch)?;
            l.get_mut(i).ok_or(Mismatch)
        }
        _ => Err(Mismatch),
    }
}

/// Make the change on `doc`. On a mismatch `doc` may be half changed: ask
/// for the whole show again.
///
/// # Errors
/// A path that is not there.
pub fn apply(doc: &mut Value, ops: &[Op]) -> Result<(), Mismatch> {
    for op in ops {
        let Some((last, parents)) = op.p.split_last() else {
            if op.d {
                return Err(Mismatch);
            }
            *doc = op.v.clone();
            continue;
        };
        let mut at = &mut *doc;
        for seg in parents {
            at = step(at, seg)?;
        }
        match (at, last) {
            (Value::Object(m), Value::String(k)) => {
                if op.d {
                    m.remove(k);
                } else {
                    m.insert(k.clone(), op.v.clone());
                }
            }
            (Value::Array(l), Value::Number(n)) if !op.d => {
                let i = usize::try_from(n.as_u64().ok_or(Mismatch)?).map_err(|_| Mismatch)?;
                *l.get_mut(i).ok_or(Mismatch)? = op.v.clone();
            }
            _ => return Err(Mismatch),
        }
    }
    Ok(())
}

/// The document a seat keeps: the show, its revision, and what the show
/// computer's control window says is running (recording, stream…).
#[must_use]
pub fn document(revision: u64, show: Value, app: Value) -> Value {
    let mut m = Map::new();
    m.insert("revision".into(), Value::from(revision));
    m.insert("show".into(), show);
    m.insert("app".into(), app);
    Value::Object(m)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn round_trip(a: &Value, b: &Value) -> usize {
        let ops = diff(a, b);
        let mut c = a.clone();
        apply(&mut c, &ops).unwrap();
        assert_eq!(&c, b, "{ops:?}");
        // The steps survive being sent.
        let sent: Vec<Op> = serde_json::from_str(&serde_json::to_string(&ops).unwrap()).unwrap();
        assert_eq!(sent, ops);
        ops.len()
    }

    #[test]
    fn small_changes_send_small_steps() {
        let a = json!({"screens": {"live": {"program": "cam1", "preview": "cam2"}}, "sources": [{"id": "cam1", "name": "Wide"}, {"id": "cam2", "name": "Close"}]});
        let mut b = a.clone();
        b["screens"]["live"]["program"] = json!("cam2");
        assert_eq!(round_trip(&a, &b), 1);
        let ops = diff(&a, &b);
        assert_eq!(
            ops[0].p,
            vec![json!("screens"), json!("live"), json!("program")]
        );
        let mut c = a.clone();
        c["sources"][1]["name"] = json!("Pulpit");
        assert_eq!(round_trip(&a, &c), 1);
        assert_eq!(round_trip(&a, &a), 0);
    }

    #[test]
    fn keys_added_and_removed_lists_resized_nulls_and_types() {
        let a = json!({"a": 1, "b": [1, 2, 3], "c": {"x": null}, "d": "text"});
        let b = json!({"b": [1, 2], "c": {"x": 5, "y": null}, "d": {"now": "an object"}, "e": []});
        round_trip(&a, &b);
        round_trip(&b, &a);
        round_trip(&json!(null), &json!({"x": 1}));
        round_trip(&json!([1, {"a": [true]}]), &json!([1, {"a": [false]}]));
    }

    #[test]
    fn a_change_for_another_version_is_noticed() {
        let a = json!({"sources": [{"id": "x"}]});
        let b = json!({"sources": [{"id": "y"}]});
        let ops = diff(&a, &b);
        let mut other = json!({"sources": []});
        assert_eq!(apply(&mut other, &ops), Err(Mismatch));
        let mut other = json!({});
        assert_eq!(apply(&mut other, &ops), Err(Mismatch));
    }

    #[test]
    fn many_random_edits_round_trip() {
        // A small deterministic generator (no extra crates).
        let mut seed = 0x2545_F491_4F6C_DD1Du64;
        let mut next = move || {
            seed ^= seed << 13;
            seed ^= seed >> 7;
            seed ^= seed << 17;
            seed
        };
        fn make(depth: u32, r: &mut dyn FnMut() -> u64) -> Value {
            match if depth == 0 { r() % 4 } else { r() % 6 } {
                0 => Value::Null,
                1 => Value::from(r() % 10),
                2 => Value::from(format!("s{}", r() % 5)),
                3 => Value::Bool(r().is_multiple_of(2)),
                4 => Value::Array((0..r() % 4).map(|_| make(depth - 1, r)).collect()),
                _ => Value::Object(
                    (0..r() % 4)
                        .map(|_| (format!("k{}", r() % 5), make(depth - 1, r)))
                        .collect(),
                ),
            }
        }
        for _ in 0..500 {
            let a = make(4, &mut next);
            let b = make(4, &mut next);
            round_trip(&a, &b);
        }
    }

    #[test]
    fn the_document_holds_revision_show_and_app() {
        let d = document(7, json!({"x": 1}), json!({"recording": true}));
        assert_eq!(d["revision"], 7);
        assert_eq!(d["show"]["x"], 1);
        assert_eq!(d["app"]["recording"], true);
    }
}
