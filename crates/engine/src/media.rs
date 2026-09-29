//! The files an event uses (videos, pictures, logos, slides). The app keeps
//! its own copy of each, so an event carries on working when the original is
//! moved or deleted; this finds every file path in the show.

use crate::model::{Show, SourceId, SourceKind};
use crate::slideshow::Slide;

/// Visit every file path in the show (each may be changed).
pub fn for_each_path(show: &mut Show, mut f: impl FnMut(&mut String)) {
    if let Some(logo) = &mut show.event.logo {
        f(logo);
    }
    for st in &mut show.settings.stingers {
        if !st.path.is_empty() {
            f(&mut st.path);
        }
    }
    for src in &mut show.sources {
        match &mut src.kind {
            SourceKind::Video { path, .. } | SourceKind::Image { path } => f(path),
            SourceKind::Countdown {
                logo: Some(logo), ..
            } => f(logo),
            SourceKind::Slideshow(sh) => {
                for slide in &mut sh.slides {
                    if let Slide::Image { path } = slide {
                        f(path);
                    }
                }
            }
            SourceKind::Logo3d(l) if !l.path.is_empty() => f(&mut l.path),
            _ => {}
        }
    }
}

/// Every file path in the show, once each.
pub fn paths(show: &Show) -> Vec<String> {
    let mut copy = show.clone();
    let mut all = Vec::new();
    for_each_path(&mut copy, |p| {
        if !p.is_empty() && !all.contains(p) {
            all.push(p.clone());
        }
    });
    all
}

/// Point every use of `from` at `to`. True if anything changed.
pub fn relink(show: &mut Show, from: &str, to: &str) -> bool {
    let mut changed = false;
    for_each_path(show, |p| {
        if p == from {
            to.clone_into(p);
            changed = true;
        }
    });
    changed
}

/// Inputs shown inside another input.
fn inner_ids(kind: &SourceKind) -> Vec<SourceId> {
    match kind {
        SourceKind::Split(sp) => sp
            .boxes
            .iter()
            .filter_map(|b| b.source_id.clone())
            .collect(),
        SourceKind::Slideshow(sh) => sh
            .slides
            .iter()
            .filter_map(|sl| match sl {
                Slide::Input { source_id } => Some(source_id.clone()),
                Slide::Image { .. } => None,
            })
            .chain(sh.behind.clone())
            .collect(),
        SourceKind::Pesukim(p) => p.look.behind.iter().cloned().collect(),
        _ => Vec::new(),
    }
}

/// Files the audience may be watching now: inputs on air on the Live and
/// Back Screens (and the one a transition is leaving), overlays that are on,
/// and everything shown inside those.
pub fn on_air_paths(show: &Show) -> Vec<String> {
    let mut ids: Vec<SourceId> = [&show.screens.live, &show.screens.back]
        .into_iter()
        .flat_map(|sc| [sc.program.clone(), sc.previous.clone()])
        .flatten()
        .chain(
            show.overlays
                .iter()
                .filter(|o| o.on)
                .filter_map(|o| o.source_id.clone()),
        )
        .collect();
    let mut i = 0;
    while i < ids.len() {
        if let Some(src) = show.source(&ids[i]) {
            for inner in inner_ids(&src.kind) {
                if !ids.contains(&inner) {
                    ids.push(inner);
                }
            }
        }
        i += 1;
    }
    let mut shown = show.clone();
    // (The event logo stays in: the safe screen may be showing it.)
    shown.sources.retain(|s| ids.contains(&s.id));
    paths(&shown)
}
