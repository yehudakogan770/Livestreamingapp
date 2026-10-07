//! The WebView's sound mixes, on their way into the engine's encoder feeds.
//!
//! The control window's sound engine (`app/src/audio/soundEngine.ts`) taps
//! a mix — the Stream mix, or the Recording mix — with an audio worklet and
//! sends it here in short chunks of 16-bit stereo, each stamped with the
//! wall-clock time of its first sample (`app/src/audio/engineTap.ts`). Every
//! feed that wants that mix gets every chunk; a feed that fell far behind or
//! ended is dropped. Nothing is kept: a feed hears from when it started.

use std::collections::HashMap;
use std::sync::mpsc::{sync_channel, Receiver, SyncSender};
use std::sync::{Mutex, PoisonError};

use crate::encoder::PcmChunk;

/// How many chunks may wait for one feed (about 5 s of 40 ms chunks).
const BACKLOG: usize = 128;

#[derive(Default)]
pub struct AudioBus {
    subs: Mutex<HashMap<String, Vec<SyncSender<PcmChunk>>>>,
}

impl AudioBus {
    /// Hear mix `mix` from now on.
    pub fn subscribe(&self, mix: &str) -> Receiver<PcmChunk> {
        let (tx, rx) = sync_channel(BACKLOG);
        self.subs
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .entry(mix.to_owned())
            .or_default()
            .push(tx);
        rx
    }

    /// A chunk of mix `mix`, to everyone listening to it.
    pub fn push(&self, mix: &str, chunk: &PcmChunk) {
        let mut subs = self.subs.lock().unwrap_or_else(PoisonError::into_inner);
        if let Some(list) = subs.get_mut(mix) {
            list.retain(|tx| tx.try_send(chunk.clone()).is_ok());
            if list.is_empty() {
                subs.remove(mix);
            }
        }
    }

    /// The mixes someone is listening to (the WebView taps only these).
    pub fn wanted(&self) -> Vec<String> {
        let mut v: Vec<String> = self
            .subs
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .keys()
            .cloned()
            .collect();
        v.sort();
        v
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    fn chunk(at: f64) -> PcmChunk {
        PcmChunk {
            at_ms: at,
            rate: 48_000,
            pcm: Arc::new(vec![0; 16]),
        }
    }

    #[test]
    fn every_listener_of_a_mix_hears_it_and_gone_ones_are_dropped() {
        let bus = AudioBus::default();
        let a = bus.subscribe("master");
        let b = bus.subscribe("master");
        let c = bus.subscribe("b");
        bus.push("master", &chunk(1.0));
        assert_eq!(a.try_recv().unwrap().at_ms, 1.0);
        assert_eq!(b.try_recv().unwrap().at_ms, 1.0);
        assert!(c.try_recv().is_err(), "another mix");
        assert_eq!(bus.wanted(), vec!["b".to_owned(), "master".to_owned()]);
        drop((a, b));
        bus.push("master", &chunk(2.0));
        assert_eq!(bus.wanted(), vec!["b".to_owned()]);
    }

    #[test]
    fn a_listener_that_stopped_reading_is_let_go() {
        let bus = AudioBus::default();
        let _stuck = bus.subscribe("master");
        for i in 0..=BACKLOG {
            bus.push("master", &chunk(i as f64));
        }
        assert!(bus.wanted().is_empty());
    }
}
