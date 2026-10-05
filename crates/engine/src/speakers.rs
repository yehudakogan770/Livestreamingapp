//! Automatic speaker names: each microphone has the name (and title) of
//! the person who speaks into it; when they start talking, their name title
//! comes on by itself for a few seconds. (The listening is done in the
//! control window; this is only how it is set up.)

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::model::{Source, SourceId};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Speaker {
    /// The microphone they speak into.
    pub mic: SourceId,
    pub name: String,
    /// The line under the name (e.g. "Guest speaker"); may be empty.
    #[serde(default)]
    pub title: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct SpeakerNames {
    pub on: bool,
    pub people: Vec<Speaker>,
    /// The overlay the name goes on (0 – 3, shown as 1 – 4).
    pub channel: usize,
    /// The text input whose look is used (a lower third).
    #[ts(optional = nullable)]
    pub title_source: Option<SourceId>,
    /// How long the name stays on, seconds.
    pub hold_s: f32,
    /// The same person's name comes on again only after this many minutes.
    pub again_min: f32,
}

impl Default for SpeakerNames {
    fn default() -> Self {
        SpeakerNames {
            on: false,
            people: Vec::new(),
            channel: 3,
            title_source: None,
            hold_s: 6.0,
            again_min: 3.0,
        }
    }
}

impl SpeakerNames {
    pub fn repair(&mut self, sources: &[Source]) {
        let fit =
            |v: f32, lo: f32, hi: f32, d: f32| if v.is_finite() { v.clamp(lo, hi) } else { d };
        let d = SpeakerNames::default();
        self.channel = self.channel.min(3);
        self.hold_s = fit(self.hold_s, 2.0, 30.0, d.hold_s);
        self.again_min = fit(self.again_min, 0.0, 60.0, d.again_min);
        let exists = |id: &SourceId| sources.iter().any(|s| &s.id == id);
        self.people.retain(|p| exists(&p.mic));
        for p in &mut self.people {
            p.name = p.name.trim().chars().take(80).collect();
            p.title = p.title.trim().chars().take(80).collect();
        }
        if self.title_source.as_ref().is_some_and(|id| !exists(id)) {
            self.title_source = None;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn people_on_microphones_that_are_gone_are_left_out() {
        let mut s = SpeakerNames {
            people: vec![Speaker {
                mic: SourceId::new("gone"),
                name: " Sarah ".into(),
                title: String::new(),
            }],
            channel: 9,
            hold_s: 999.0,
            ..SpeakerNames::default()
        };
        s.repair(&[]);
        assert!(s.people.is_empty());
        assert_eq!(s.channel, 3);
        assert!((s.hold_s - 30.0).abs() < f32::EPSILON);
    }
}
