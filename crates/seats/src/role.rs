//! Seats and what each may do. Checked on the show computer for every
//! request a seat sends: the joining computer is never trusted.

use lumora_engine::action::Action;
use serde::{Deserialize, Serialize};

/// A group of things an operator can do. A seat's role is a set of groups.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Group {
    /// TAKE, CUT, the fader, transitions, blank, fade to black, panic, presets.
    Switching,
    /// What is lined up in Next.
    Preview,
    /// PTZ and each camera's own settings.
    Cameras,
    /// Overlay channels: choose, set up, on and off.
    Overlays,
    /// Titles, lower thirds, designed graphics, credits, scripture, comments.
    Titles,
    Scoreboards,
    Countdowns,
    Lyrics,
    Slides,
    /// Which row of the data file titles show.
    Data,
    /// Polls, raffles, fundraisers, the messages wall, auctions, trivia, Q&A.
    Audience,
    /// The mixer.
    Audio,
    /// Instant replay.
    Replay,
    /// Recording and going live.
    Recording,
    /// Playing, pausing and seeking videos and playlists.
    Playback,
    /// Adding, changing and removing inputs.
    Inputs,
    /// Run of show, cues, macros and triggers.
    RunOfShow,
    /// Stage monitor, teleprompter and stage visuals.
    Stage,
    /// The event's settings, look, captions, backup lineup and multiview.
    EventSettings,
}

impl Group {
    pub const ALL: [Group; 19] = [
        Group::Switching,
        Group::Preview,
        Group::Cameras,
        Group::Overlays,
        Group::Titles,
        Group::Scoreboards,
        Group::Countdowns,
        Group::Lyrics,
        Group::Slides,
        Group::Data,
        Group::Audience,
        Group::Audio,
        Group::Replay,
        Group::Recording,
        Group::Playback,
        Group::Inputs,
        Group::RunOfShow,
        Group::Stage,
        Group::EventSettings,
    ];
}

/// A seat's role, chosen by the show operator when approving it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Role {
    /// Everything a seat can do.
    Director,
    /// Overlays, titles, lower thirds, scoreboards, countdowns, lyrics,
    /// slides and data titles. No camera cuts, going live or recording.
    Graphics,
    /// The mixer only.
    Audio,
    /// Instant replay only.
    Replay,
    /// PTZ and camera controls, and what is lined up in Next.
    Cameras,
    /// The groups ticked by the operator.
    Custom { groups: Vec<Group> },
}

impl Role {
    /// The groups this role includes.
    #[must_use]
    pub fn groups(&self) -> Vec<Group> {
        match self {
            Role::Director => Group::ALL.to_vec(),
            Role::Graphics => vec![
                Group::Overlays,
                Group::Titles,
                Group::Scoreboards,
                Group::Countdowns,
                Group::Lyrics,
                Group::Slides,
                Group::Data,
            ],
            Role::Audio => vec![Group::Audio],
            Role::Replay => vec![Group::Replay],
            Role::Cameras => vec![Group::Cameras, Group::Preview],
            Role::Custom { groups } => {
                let mut g = groups.clone();
                g.sort();
                g.dedup();
                g
            }
        }
    }

    #[must_use]
    pub fn allows(&self, group: Group) -> bool {
        match self {
            Role::Director => true,
            Role::Custom { groups } => groups.contains(&group),
            other => other.groups().contains(&group),
        }
    }

    /// The role's name, for the operator.
    #[must_use]
    pub fn label(&self) -> &'static str {
        match self {
            Role::Director => "Director",
            Role::Graphics => "Graphics",
            Role::Audio => "Audio",
            Role::Replay => "Replay",
            Role::Cameras => "Cameras",
            Role::Custom { .. } => "Custom",
        }
    }
}

/// What a seat may ask of the show computer's control window. The same
/// shape as the app's `AppCommand` (recording, streaming, replay).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "command", rename_all = "camelCase", deny_unknown_fields)]
pub enum SeatCommand {
    Record {
        on: bool,
    },
    Stream {
        on: bool,
    },
    Rehearsal {
        on: bool,
    },
    ReplayBuffer {
        on: bool,
    },
    Replay {
        seconds: u32,
        #[serde(default)]
        slow: bool,
    },
}

impl SeatCommand {
    #[must_use]
    pub fn group(&self) -> Group {
        match self {
            SeatCommand::Record { .. }
            | SeatCommand::Stream { .. }
            | SeatCommand::Rehearsal { .. } => Group::Recording,
            SeatCommand::ReplayBuffer { .. } | SeatCommand::Replay { .. } => Group::Replay,
        }
    }

    /// Numbers in range (the replay buffer keeps one minute).
    #[must_use]
    pub fn valid(&self) -> bool {
        match self {
            SeatCommand::Replay { seconds, .. } => (1..=60).contains(seconds),
            _ => true,
        }
    }
}

/// Why the show computer said no.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Refusal {
    /// Outside this seat's role.
    NotYourSeat,
    /// Only the show computer itself does this (its files, windows, devices).
    ShowComputerOnly,
    /// The show operator locked this seat.
    Locked,
    /// Too many requests at once.
    TooFast,
}

impl Refusal {
    /// What the operator at the seat reads.
    #[must_use]
    pub fn message(self) -> &'static str {
        match self {
            Refusal::NotYourSeat => "Your seat can’t do this.",
            Refusal::ShowComputerOnly => "Only the show computer can do this.",
            Refusal::Locked => "The show operator has locked your seat for now.",
            Refusal::TooFast => "Too many changes at once. Wait a moment and try again.",
        }
    }
}

/// Only changes the volume, mute or routing of an input.
fn audio_only(patch: &lumora_engine::SourcePatch) -> bool {
    let has_audio = patch.volume.is_some() || patch.muted.is_some() || patch.audio.is_some();
    has_audio
        && *patch
            == lumora_engine::SourcePatch {
                volume: patch.volume,
                muted: patch.muted,
                audio: patch.audio.clone(),
                ..Default::default()
            }
}

/// The group a new input belongs to, by what it is.
fn new_source_group(kind: &lumora_engine::SourceKind) -> Group {
    let tag = serde_json::to_value(kind)
        .ok()
        .and_then(|v| v.get("type").and_then(|t| t.as_str()).map(str::to_owned))
        .unwrap_or_default();
    match tag.as_str() {
        "text" | "graphic" | "titler" | "credits" => Group::Titles,
        "countdown" => Group::Countdowns,
        "scoreboard" => Group::Scoreboards,
        "lyrics" => Group::Lyrics,
        _ => Group::Inputs,
    }
}

/// The group an action belongs to; `None`: only the show computer itself
/// (or a phone through the phone remote) sends it, never a seat.
///
/// Every action is named here (no catch-all), so a new action has to be
/// placed in a group before Lumora builds.
#[must_use]
#[allow(clippy::too_many_lines)]
pub fn group_of(action: &Action) -> Option<Group> {
    use Action as A;
    use Group as G;
    Some(match action {
        // Inputs: an audio-only change is the mixer's.
        A::UpdateSource { patch, .. } if audio_only(patch) => G::Audio,
        A::AddSource { source } => new_source_group(&source.kind),
        A::UpdateSource { .. }
        | A::RemoveSource { .. }
        | A::MoveSource { .. }
        | A::UpdateStream { .. }
        | A::UpdateBrowser { .. }
        | A::UpdateLogo3d { .. }
        | A::UpdateSplit { .. }
        | A::UpdateScreenCapture { .. }
        | A::ReloadGuest { .. } => G::Inputs,

        A::SetPreview { .. } => G::Preview,
        A::Take { .. }
        | A::CutTo { .. }
        | A::PlayNow { .. }
        | A::SetTbar { .. }
        | A::SetTransition { .. }
        | A::SetBlank { .. }
        | A::FadeToBlack { .. }
        | A::Panic { .. }
        | A::SetStinger { .. }
        | A::SetFadeToBlackLength { .. }
        | A::SetFavouriteTransition { .. }
        | A::SetBackFollowsLive { .. }
        | A::SetAutoPlayOnTake { .. }
        | A::AddPreset { .. }
        | A::UpdatePreset { .. }
        | A::RemovePreset { .. }
        | A::MovePreset { .. }
        | A::PickPreset { .. }
        | A::NextPreset
        | A::PreviousPreset
        | A::RunSteps { .. }
        | A::StopSteps
        | A::UpdateAutoSwitch { .. } => G::Switching,

        A::SetPtz { .. } | A::SetCameraControls { .. } => G::Cameras,

        A::SetOverlaySource { .. }
        | A::UpdateOverlay { .. }
        | A::SetOverlayOn { .. }
        | A::SetOverlayInNext { .. }
        | A::OverlaysOff => G::Overlays,

        A::UpdateText { .. }
        | A::UpdateGraphic { .. }
        | A::UpdateTitler { .. }
        | A::SetTitlerValues { .. }
        | A::SetTitlerData { .. }
        | A::TitlerDataRow { .. }
        | A::TitlerDataStep { .. }
        | A::UpdateCredits { .. }
        | A::CreditsPlay { .. }
        | A::CreditsRestart { .. }
        | A::CreditsSpeed { .. }
        | A::UpdateScripture { .. }
        | A::ScriptureStep { .. }
        | A::ScriptureGo { .. }
        | A::ScriptureBlank { .. }
        | A::UpdateZmanim { .. }
        | A::UpdateSeating { .. }
        | A::ShowComment { .. }
        | A::UpdateCommentCard { .. }
        | A::DrawStroke { .. }
        | A::DrawUndo { .. }
        | A::DrawClear { .. }
        | A::PesukimNext { .. }
        | A::PesukimBack { .. }
        | A::PesukimGo { .. }
        | A::PesukimWhole { .. }
        | A::PesukimBlank { .. }
        | A::UpdatePesukim { .. } => G::Titles,

        A::UpdateScoreboard { .. }
        | A::Score { .. }
        | A::ScoreReset { .. }
        | A::ScoreClock { .. }
        | A::ScoreClockSet { .. } => G::Scoreboards,

        A::UpdateCountdown { .. }
        | A::SetCountdownLength { .. }
        | A::StartCountdown { .. }
        | A::PauseCountdown { .. }
        | A::ResetCountdown { .. }
        | A::AddCountdownTime { .. }
        | A::SetCountdownRemaining { .. }
        | A::CountdownTo { .. } => G::Countdowns,

        A::UpdateLyrics { .. }
        | A::LyricsGo { .. }
        | A::LyricsNext { .. }
        | A::LyricsPrevious { .. }
        | A::LyricsBlank { .. } => G::Lyrics,

        A::SlideNext { .. }
        | A::SlidePrevious { .. }
        | A::SlideGo { .. }
        | A::SlideBlack { .. }
        | A::UpdateSlideshow { .. } => G::Slides,

        A::DataRow { .. } | A::DataStep { .. } => G::Data,

        A::UpdateRaffle { .. }
        | A::RaffleOpen { .. }
        | A::RaffleAdd { .. }
        | A::RaffleRemove { .. }
        | A::RaffleDraw { .. }
        | A::RaffleReset { .. }
        | A::UpdateFundraiser { .. }
        | A::FundraiserOpen { .. }
        | A::AddDonation { .. }
        | A::PledgeApprove { .. }
        | A::PledgeRemove { .. }
        | A::UpdateTrivia { .. }
        | A::TriviaAsk { .. }
        | A::TriviaReveal { .. }
        | A::TriviaBoard { .. }
        | A::TriviaReset { .. }
        | A::UpdateAuction { .. }
        | A::AuctionSetItem { .. }
        | A::AuctionRemoveItem { .. }
        | A::AuctionGo { .. }
        | A::AuctionOpen { .. }
        | A::AuctionTimer { .. }
        | A::AuctionRoomBid { .. }
        | A::AuctionSold { .. }
        | A::AuctionRemoveBid { .. }
        | A::UpdateWall { .. }
        | A::WallOpen { .. }
        | A::WallAdd { .. }
        | A::WallApprove { .. }
        | A::WallPin { .. }
        | A::WallRemove { .. }
        | A::QnaOpen { .. }
        | A::QnaShow { .. }
        | A::QnaRemove { .. }
        | A::UpdatePoll { .. }
        | A::PollOpen { .. }
        | A::PollShowResults { .. }
        | A::PollReset { .. } => G::Audience,

        A::SetMasterVolume { .. }
        | A::SetMasterMuted { .. }
        | A::UpdateBus { .. }
        | A::SetSolo { .. } => G::Audio,

        A::Play { .. }
        | A::Pause { .. }
        | A::Seek { .. }
        | A::SetSpeed { .. }
        | A::SetPlaylist { .. }
        | A::PlaylistGo { .. } => G::Playback,

        A::SetCues { .. }
        | A::StartShow { .. }
        | A::StopShow
        | A::PauseShow { .. }
        | A::NextCue
        | A::GoCue { .. }
        | A::SetTriggers { .. }
        | A::FireTrigger { .. }
        | A::SetMacros { .. }
        | A::RunMacro { .. } => G::RunOfShow,

        // Recording / going live / replay left for the control window.
        A::RequestApp { step } => match step {
            // Marking a moment is the replay seat's job too (highlights).
            lumora_engine::macros::AppStep::Replay { .. } | lumora_engine::macros::AppStep::Mark => {
                G::Replay
            }
            _ => G::Recording,
        },

        A::UpdatePrompter { .. }
        | A::PrompterRun { .. }
        | A::PrompterJump { .. }
        | A::PrompterSpeed { .. }
        | A::UpdateMonitor { .. }
        | A::SetQuickMessage { .. }
        | A::MonitorFlash
        | A::VisualsScene { .. }
        | A::VisualsStep { .. }
        | A::VisualsTempo { .. }
        | A::VisualsSync
        | A::VisualsFlash
        | A::UpdateVisuals { .. }
        | A::VisualsLook { .. } => G::Stage,

        A::UpdateEvent { .. }
        | A::ApplyBrand { .. }
        | A::SetBackupOn { .. }
        | A::SetMultiview { .. }
        | A::SetCaptions { .. }
        | A::SetSpeakerNames { .. } => G::EventSettings,

        // The show computer's own: its files, screens, sound devices, and what
        // its media layer and control window report.
        A::SetDisplay { .. }
        | A::SetAudioOutput { .. }
        | A::SetDataFile { .. }
        | A::DataRows { .. }
        | A::RelinkMedia { .. }
        | A::SetDuration { .. }
        | A::SetNoSignal { .. }
        // Sent by the phone remote's server for the audience, never by an operator.
        | A::RaffleJoin { .. }
        | A::Pledge { .. }
        | A::TriviaAnswer { .. }
        | A::AuctionBid { .. }
        | A::WallPost { .. }
        | A::QnaAsk { .. }
        | A::PollVote { .. } => return None,
    })
}

/// May a seat with this role do this? Checked on the show computer.
///
/// # Errors
/// Why not.
pub fn seat_may(action: &Action, role: &Role, locked: bool) -> Result<(), Refusal> {
    if locked {
        return Err(Refusal::Locked);
    }
    match group_of(action) {
        None => Err(Refusal::ShowComputerOnly),
        Some(g) if role.allows(g) => Ok(()),
        Some(_) => Err(Refusal::NotYourSeat),
    }
}

/// May a seat ask the control window for this?
///
/// # Errors
/// Why not.
pub fn seat_may_command(command: &SeatCommand, role: &Role, locked: bool) -> Result<(), Refusal> {
    if locked {
        return Err(Refusal::Locked);
    }
    if role.allows(command.group()) {
        Ok(())
    } else {
        Err(Refusal::NotYourSeat)
    }
}
