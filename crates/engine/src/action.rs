//! Everything the operator (or a remote, or a cue) can ask the engine to do.

use serde::{Deserialize, Serialize};
use thiserror::Error;
use ts_rs::TS;

use crate::audio::{AudioOutputId, BusId, BusPatch, SourceAudio, SourceAudioPatch};
use crate::browser::BrowserInput;
use crate::credits::Credits;
use crate::cues::Cue;
use crate::event::EventPatch;
use crate::logo3d::Logo3d;
use crate::model::{Fit, Millis, ScreenId, SourceId, SourceKind, Transition, TransitionKind};
use crate::overlays::OverlayPatch;
use crate::pesukim::{Pasuk, PesukimLook};
use crate::presets::{Preset, Step};
use crate::slideshow::Slideshow;
use crate::split::Split;
use crate::stage::{AtZero, MonitorLayout, TextSize, TimerFormat};
use crate::text::TextInput;
use crate::triggers::Trigger;
use crate::visuals::{SceneRef, VisualsPatch};

/// A new source as requested by the UI. The engine fills in and cleans up the
/// rest (id, limits, play state).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct NewSource {
    /// Leave empty to let the engine choose an id.
    #[serde(default)]
    #[ts(optional)]
    pub id: Option<SourceId>,
    pub name: String,
    pub kind: SourceKind,
    #[serde(default)]
    #[ts(optional)]
    pub volume: Option<f32>,
    #[serde(default)]
    #[ts(optional)]
    pub muted: Option<bool>,
    #[serde(default)]
    #[ts(optional)]
    pub looping: Option<bool>,
    #[serde(default)]
    #[ts(optional)]
    pub fit: Option<Fit>,
    /// Leave empty for the usual: videos follow the picture, microphones are always live.
    #[serde(default)]
    #[ts(optional)]
    pub audio: Option<SourceAudio>,
    /// Green screen settings (off when left out).
    #[serde(default)]
    #[ts(optional)]
    pub key: Option<crate::model::ChromaKey>,
}

/// Changes to an existing source. Fields left out stay as they are.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SourcePatch {
    #[serde(default)]
    #[ts(optional)]
    pub name: Option<String>,
    #[serde(default)]
    #[ts(optional)]
    pub volume: Option<f32>,
    #[serde(default)]
    #[ts(optional)]
    pub muted: Option<bool>,
    #[serde(default)]
    #[ts(optional)]
    pub looping: Option<bool>,
    #[serde(default)]
    #[ts(optional)]
    pub fit: Option<Fit>,
    /// Only for colour sources.
    #[serde(default)]
    #[ts(optional)]
    pub color: Option<String>,
    #[serde(default)]
    #[ts(optional)]
    pub audio: Option<SourceAudioPatch>,
    /// Green screen settings (cameras, videos and pictures).
    #[serde(default)]
    #[ts(optional)]
    pub key: Option<crate::model::ChromaKey>,
    /// Light, colour, crop and effects (cameras, videos and pictures).
    #[serde(default)]
    #[ts(optional)]
    pub adjust: Option<crate::adjust::Adjust>,
    /// Only for countdown inputs: the event logo picture ("" removes it).
    #[serde(default)]
    #[ts(optional)]
    pub logo: Option<String>,
}

/// Changes to the stage monitor. Fields left out stay as they are.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct MonitorPatch {
    #[serde(default)]
    #[ts(optional)]
    pub message: Option<String>,
    #[serde(default)]
    #[ts(optional)]
    pub message_on: Option<bool>,
    #[serde(default)]
    #[ts(optional)]
    pub layout: Option<MonitorLayout>,
    #[serde(default)]
    #[ts(optional)]
    pub show_clock: Option<bool>,
    #[serde(default)]
    #[ts(optional)]
    pub show_timer: Option<bool>,
    #[serde(default)]
    #[ts(optional)]
    pub show_lyrics: Option<bool>,
    #[serde(default)]
    #[ts(optional)]
    pub text_size: Option<TextSize>,
    #[serde(default)]
    #[ts(optional)]
    pub clock_24h: Option<bool>,
}

/// Changes to how the countdown looks and ends. Fields left out stay as they are.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CountdownPatch {
    #[serde(default)]
    #[ts(optional)]
    pub label: Option<String>,
    #[serde(default)]
    #[ts(optional)]
    pub end_text: Option<String>,
    #[serde(default)]
    #[ts(optional)]
    pub format: Option<TimerFormat>,
    #[serde(default)]
    #[ts(optional)]
    pub at_zero: Option<AtZero>,
}

/// One request to change the show.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export)]
pub enum Action {
    // ----- sources -----
    AddSource {
        source: NewSource,
    },
    UpdateSource {
        id: SourceId,
        patch: SourcePatch,
    },
    RemoveSource {
        id: SourceId,
    },
    MoveSource {
        id: SourceId,
        index: usize,
    },

    // ----- switching -----
    /// Line a source up in a screen's preview (or clear it with `null`).
    SetPreview {
        screen: ScreenId,
        source_id: Option<SourceId>,
    },
    /// Send the preview to air with a transition (the show's default if omitted).
    Take {
        screen: ScreenId,
        #[serde(default)]
        #[ts(optional)]
        transition: Option<TransitionKind>,
        #[serde(default)]
        #[ts(optional)]
        duration_ms: Option<u32>,
    },
    /// Send a source straight to air with a cut, keeping the preview as it is.
    CutTo {
        screen: ScreenId,
        source_id: SourceId,
    },
    /// Quick play: send an input to air now with its own transition (what is
    /// lined up in Next stays there).
    PlayNow {
        screen: ScreenId,
        source_id: SourceId,
        transition: Transition,
    },
    /// Move the manual fader (0.0 – 1.0). Reaching the end completes the take.
    SetTbar {
        screen: ScreenId,
        value: f32,
    },
    /// Choose the transition TAKE uses.
    SetTransition {
        #[serde(default)]
        #[ts(optional)]
        kind: Option<TransitionKind>,
        #[serde(default)]
        #[ts(optional)]
        duration_ms: Option<u32>,
    },

    // ----- safety -----
    SetBlank {
        screens: Vec<ScreenId>,
        value: bool,
        /// How long to fade (Fade to black); left out: the usual quick fade.
        #[serde(default)]
        #[ts(optional)]
        fade_ms: Option<u32>,
    },
    /// Fade to black (or back) on a screen, taking the chosen length.
    FadeToBlack {
        screen: ScreenId,
    },
    /// Where the multiview screen goes, and its layout.
    SetMultiview {
        multiview: crate::model::Multiview,
    },
    /// Make a video input a playlist, change its list, or (None) make it a single video again.
    SetPlaylist {
        id: SourceId,
        #[ts(optional)]
        playlist: Option<crate::playlist::Playlist>,
    },
    /// Play item `index` of a playlist from its start.
    PlaylistGo {
        id: SourceId,
        index: usize,
    },
    /// Play a video faster or slower (0.25 – 2; 1 is normal).
    SetSpeed {
        id: SourceId,
        speed: f32,
    },
    /// Change a raffle's title, prize and look (entries and winners stay).
    UpdateRaffle {
        id: SourceId,
        raffle: crate::audience::Raffle,
    },
    /// Let phones enter a raffle (or stop them).
    RaffleOpen {
        id: SourceId,
        value: bool,
    },
    /// Someone entered from their phone (sent by the app's server).
    RaffleJoin {
        id: SourceId,
        name: String,
    },
    /// The operator adds names (one each).
    RaffleAdd {
        id: SourceId,
        names: Vec<String>,
    },
    /// Take one entry out, or (with none) start the raffle again from nobody.
    RaffleRemove {
        id: SourceId,
        #[ts(optional)]
        entry: Option<u32>,
    },
    /// Draw a winner (shown after the spin).
    RaffleDraw {
        id: SourceId,
    },
    /// Forget the winners (everyone can win again).
    RaffleReset {
        id: SourceId,
    },
    /// Change a fundraiser's title, goal and look (pledges stay).
    UpdateFundraiser {
        id: SourceId,
        fundraiser: crate::audience::Fundraiser,
    },
    /// Let phones pledge (or stop them).
    FundraiserOpen {
        id: SourceId,
        value: bool,
    },
    /// A pledge from a phone (sent by the app's server).
    Pledge {
        id: SourceId,
        name: String,
        #[ts(type = "number")]
        amount: u64,
        message: String,
    },
    /// The operator adds a donation (counted straight away).
    AddDonation {
        id: SourceId,
        name: String,
        #[ts(type = "number")]
        amount: u64,
        message: String,
    },
    /// Count a pledge in the total (or not).
    PledgeApprove {
        id: SourceId,
        pledge: u32,
        value: bool,
    },
    PledgeRemove {
        id: SourceId,
        pledge: u32,
    },
    /// Change how the zmanim input looks.
    UpdateZmanim {
        id: SourceId,
        zmanim: crate::zmanim::ZmanimCard,
    },
    /// Change an auction's title, currency and look (items and bids stay).
    UpdateAuction {
        id: SourceId,
        auction: crate::auction::Auction,
    },
    /// Add an item (id 0) or change one (its bids stay).
    AuctionSetItem {
        id: SourceId,
        item: crate::auction::AuctionItem,
    },
    AuctionRemoveItem {
        id: SourceId,
        item: u32,
    },
    /// Sell this item now (by its place in the list).
    AuctionGo {
        id: SourceId,
        index: usize,
    },
    /// Let phones bid (or stop them).
    AuctionOpen {
        id: SourceId,
        value: bool,
    },
    /// Bidding on this item ends in this many seconds, or (with none) when the operator says "Sold".
    AuctionTimer {
        id: SourceId,
        #[ts(optional)]
        seconds: Option<u32>,
    },
    /// A bid from a phone (sent by the app's server) on the item being sold.
    AuctionBid {
        id: SourceId,
        item: u32,
        name: String,
        #[ts(type = "number")]
        amount: u64,
    },
    /// A bid taken in the room (a raised hand), typed by the operator.
    AuctionRoomBid {
        id: SourceId,
        name: String,
        #[ts(type = "number")]
        amount: u64,
    },
    /// Sold to the highest bid (or take that back).
    AuctionSold {
        id: SourceId,
        value: bool,
    },
    /// Take a bid out (a mistake, a joke).
    AuctionRemoveBid {
        id: SourceId,
        item: u32,
        bid: u32,
    },
    /// Change a messages wall's title, question and look (the messages stay).
    UpdateWall {
        id: SourceId,
        wall: crate::wall::Wall,
    },
    /// Let phones send messages (or stop them).
    WallOpen {
        id: SourceId,
        value: bool,
    },
    /// A message from a phone (sent by the app's server).
    WallPost {
        id: SourceId,
        name: String,
        text: String,
        /// A photo saved by the app's server.
        #[ts(optional)]
        photo: Option<String>,
    },
    /// The operator types a message (shown straight away).
    WallAdd {
        id: SourceId,
        name: String,
        text: String,
    },
    /// Let a message through to the screen (or hold it back).
    WallApprove {
        id: SourceId,
        message: u32,
        value: bool,
    },
    /// Keep one message on screen, or (with none) let them take turns again.
    WallPin {
        id: SourceId,
        #[ts(optional)]
        message: Option<u32>,
    },
    /// Take one message out, or (with none) all of them.
    WallRemove {
        id: SourceId,
        #[ts(optional)]
        message: Option<u32>,
    },
    /// Start or stop taking audience questions.
    QnaOpen {
        value: bool,
    },
    /// A question from a phone (sent by the app's server, never by the operator).
    QnaAsk {
        author: String,
        text: String,
    },
    /// Put a question on screen through a chat comments input.
    QnaShow {
        question: u32,
        id: SourceId,
    },
    /// Forget one question, or (with none) all of them.
    QnaRemove {
        #[ts(optional)]
        question: Option<u32>,
    },
    /// Reload a guest's picture (if it froze or they rejoined).
    ReloadGuest {
        id: SourceId,
    },
    /// Show a chat comment (or, with none, take it off).
    ShowComment {
        id: SourceId,
        #[ts(optional)]
        comment: Option<crate::chat::ChatComment>,
    },
    /// Change how a comment input looks.
    UpdateCommentCard {
        id: SourceId,
        place: crate::chat::CommentPlace,
        accent: String,
    },
    /// Set (or, with none, forget) where a camera's PTZ control is.
    SetPtz {
        id: SourceId,
        #[ts(optional)]
        ptz: Option<crate::ptz::Ptz>,
    },
    /// Change a poll's question, answers and look (new answers start the votes again).
    UpdatePoll {
        id: SourceId,
        poll: crate::poll::Poll,
    },
    /// Open or close a poll for votes.
    PollOpen {
        id: SourceId,
        value: bool,
    },
    /// Show or hide a poll's results on screen.
    PollShowResults {
        id: SourceId,
        value: bool,
    },
    /// Start a poll's votes again.
    PollReset {
        id: SourceId,
    },
    /// A vote from a phone (sent by the app's server, never by the operator).
    PollVote {
        id: SourceId,
        round: u32,
        option: usize,
        #[ts(optional)]
        previous: Option<usize>,
    },
    /// Set the event's look and put it on every title, song and scoreboard.
    ApplyBrand {
        brand: crate::event::Brand,
    },
    /// Change a song's words, title and look (the slide showing is kept if it still exists).
    UpdateLyrics {
        id: SourceId,
        lyrics: crate::lyrics::Lyrics,
    },
    /// Show slide `index` of a song.
    LyricsGo {
        id: SourceId,
        index: usize,
    },
    LyricsNext {
        id: SourceId,
    },
    LyricsPrevious {
        id: SourceId,
    },
    /// Hide (or bring back) a song's words.
    LyricsBlank {
        id: SourceId,
        value: bool,
    },
    /// Change what a screen capture input captures.
    UpdateScreenCapture {
        id: SourceId,
        capture: crate::screen::ScreenCapture,
    },
    /// Change a scoreboard's teams, colours, period and look (scores and clock stay).
    UpdateScoreboard {
        id: SourceId,
        scoreboard: crate::score::Scoreboard,
    },
    /// Add to (or take from) a team's score.
    Score {
        id: SourceId,
        side: crate::score::Side,
        delta: i32,
    },
    /// Set both scores back to 0.
    ScoreReset {
        id: SourceId,
    },
    /// Start or stop the game clock.
    ScoreClock {
        id: SourceId,
        run: bool,
    },
    /// Make the game clock show this time.
    ScoreClockSet {
        id: SourceId,
        #[ts(type = "number")]
        ms: u64,
    },
    /// Set up stinger slot 0 or 1 (an empty path clears it).
    SetStinger {
        index: usize,
        stinger: crate::model::Stinger,
    },
    /// How long Fade to black takes.
    SetFadeToBlackLength {
        ms: u32,
    },
    /// Change one of the four favourite transition buttons (0 – 3).
    SetFavouriteTransition {
        index: usize,
        transition: Transition,
    },
    /// Everything black except the monitor, which dims.
    Panic {
        value: bool,
    },
    /// Flash the stage monitor to get attention.
    MonitorFlash,

    // ----- video playback -----
    Play {
        id: SourceId,
    },
    Pause {
        id: SourceId,
    },
    Seek {
        id: SourceId,
        pos_s: f64,
    },
    /// Reported by the media layer once a file's length is known.
    SetDuration {
        id: SourceId,
        duration_s: f64,
    },

    // ----- audio -----
    SetMasterVolume {
        value: f32,
    },
    SetMasterMuted {
        value: bool,
    },
    UpdateBus {
        bus: BusId,
        patch: BusPatch,
    },
    /// Hear one source on its own in the headphones (or `null` for the Stream mix).
    SetSolo {
        source_id: Option<SourceId>,
    },
    /// Choose the sound device a mix plays on (`null`: the computer's default).
    SetAudioOutput {
        output: AudioOutputId,
        #[serde(default)]
        #[ts(optional)]
        device_id: Option<String>,
    },

    // ----- settings -----
    SetDisplay {
        screen: ScreenId,
        #[serde(default)]
        #[ts(optional)]
        display_id: Option<String>,
    },
    /// Make the Back Screen show whatever is on the Live Screen (or stop).
    SetBackFollowsLive {
        value: bool,
    },
    SetAutoPlayOnTake {
        value: bool,
    },

    // ----- presets -----
    /// Add a preset (an empty id gets one chosen by the engine).
    AddPreset {
        preset: Preset,
    },
    /// Replace a preset with an edited version (same id).
    UpdatePreset {
        preset: Preset,
    },
    RemovePreset {
        id: String,
    },
    MovePreset {
        id: String,
        index: usize,
    },
    /// Pick a preset (or none): its inputs, transition and first input in Next.
    PickPreset {
        #[serde(default)]
        #[ts(optional)]
        id: Option<String>,
    },
    /// Pick the next preset in the list (run the show in order).
    NextPreset,
    PreviousPreset,
    /// Run steps in order (a preset button). Waits are resumed by the heartbeat.
    RunSteps {
        name: String,
        steps: Vec<Step>,
    },
    /// Stop every running button.
    StopSteps,

    // ----- the event -----
    UpdateEvent {
        patch: EventPatch,
    },

    // ----- stage monitor -----
    UpdateMonitor {
        patch: MonitorPatch,
    },
    /// Change one of the quick messages (0 – 7).
    SetQuickMessage {
        index: usize,
        text: String,
    },

    // ----- countdown -----
    // Each names the countdown input it is for (`id`).
    UpdateCountdown {
        id: SourceId,
        patch: CountdownPatch,
    },
    /// Set the length and get ready to start from it (stops the countdown).
    SetCountdownLength {
        id: SourceId,
        #[ts(type = "number")]
        length_ms: u64,
    },
    StartCountdown {
        id: SourceId,
    },
    PauseCountdown {
        id: SourceId,
    },
    ResetCountdown {
        id: SourceId,
    },
    /// Add time (negative takes time away). Works at any moment, even after zero.
    AddCountdownTime {
        id: SourceId,
        #[ts(type = "number")]
        ms: i64,
    },
    /// Jump to a time left, e.g. the last 10 seconds.
    SetCountdownRemaining {
        id: SourceId,
        #[ts(type = "number")]
        ms: u64,
    },
    /// Count down to a clock time ("starts at 19:30"). Starts it running.
    CountdownTo {
        id: SourceId,
        #[ts(type = "number")]
        at: Millis,
    },

    // ----- run of show -----
    /// Replace the cues (where the show is stays, if it can).
    SetCues {
        cues: Vec<Cue>,
    },
    /// Start the run of show: cues on the clock and "after the previous"
    /// run by themselves from now. `utc_offset_min`: this computer's time zone.
    StartShow {
        utc_offset_min: i32,
    },
    StopShow,
    /// Hold (nothing runs by itself) or carry on.
    PauseShow {
        value: bool,
    },
    /// Run the next cue now.
    NextCue,
    /// Run a cue now (and carry on from there).
    GoCue {
        index: usize,
    },

    // ----- text -----
    /// Replace a text input's words, layout and style.
    UpdateText {
        id: SourceId,
        text: TextInput,
    },

    // ----- stage visuals -----
    /// Start a scene (on the next beat or bar, as set).
    VisualsScene {
        scene: SceneRef,
    },
    /// Next (1) or previous (-1) scene in the same music type.
    VisualsStep {
        #[ts(type = "number")]
        step: i64,
    },
    VisualsTempo {
        bpm: f64,
    },
    /// Now is beat 1.
    VisualsSync,
    /// One white flash.
    VisualsFlash,
    UpdateVisuals {
        patch: VisualsPatch,
    },
    /// Keep the scene and effects in a slot (0 – 7), or bring them back.
    VisualsLook {
        slot: usize,
        store: bool,
    },

    // ----- files -----
    /// A file now lives somewhere else (the app's own copy): use it there.
    RelinkMedia {
        from: String,
        to: String,
    },

    // ----- triggers -----
    /// Replace the triggers.
    SetTriggers {
        triggers: Vec<Trigger>,
    },
    /// Run a trigger's steps now (to try it).
    FireTrigger {
        id: String,
    },

    // ----- stream input -----
    /// Change a stream input's address or buffer.
    UpdateStream {
        id: SourceId,
        stream: crate::stream::StreamInput,
    },

    // ----- web page -----
    /// Change a web page input (address, size, zoom…). The address is
    /// cleaned up (`example.com` → `https://example.com`).
    UpdateBrowser {
        id: SourceId,
        browser: BrowserInput,
    },

    // ----- 3D logo -----
    /// Replace a 3D logo's look and motion.
    UpdateLogo3d {
        id: SourceId,
        logo: Logo3d,
    },

    // ----- slideshow -----
    SlideNext {
        id: SourceId,
    },
    SlidePrevious {
        id: SourceId,
    },
    /// Go to a slide (0-based).
    SlideGo {
        id: SourceId,
        index: usize,
    },
    /// Replace the slides and settings (the slide showing is kept if it can be).
    UpdateSlideshow {
        id: SourceId,
        slideshow: Slideshow,
    },

    // ----- split screen -----
    /// Replace the layout and the inputs in its boxes (works on air too).
    UpdateSplit {
        id: SourceId,
        split: Split,
    },

    // ----- credits -----
    /// Replace the names, title and look (where it is rolling is kept).
    UpdateCredits {
        id: SourceId,
        credits: Credits,
    },
    CreditsPlay {
        id: SourceId,
        value: bool,
    },
    /// Back to the top.
    CreditsRestart {
        id: SourceId,
    },
    CreditsSpeed {
        id: SourceId,
        speed: u32,
    },

    // ----- overlays (channels 0 – 3, shown as 1 – 4) -----
    /// Choose the input on an overlay channel (`null` empties it).
    SetOverlaySource {
        channel: usize,
        source_id: Option<SourceId>,
    },
    UpdateOverlay {
        channel: usize,
        patch: OverlayPatch,
    },
    /// Put an overlay on air (with its animation) or take it off.
    SetOverlayOn {
        channel: usize,
        value: bool,
    },
    /// Show an overlay on the Next monitors to set it up.
    SetOverlayInNext {
        channel: usize,
        value: bool,
    },
    /// Take every overlay off.
    OverlaysOff,

    // ----- 12 Pesukim -----
    /// Next word (after the last word, the next pasuk).
    PesukimNext {
        id: SourceId,
    },
    /// Back a word.
    PesukimBack {
        id: SourceId,
    },
    /// Jump to a word (0-based pasuk and word).
    PesukimGo {
        id: SourceId,
        pasuk: usize,
        word: usize,
    },
    /// Show the whole pasuk (until the next word).
    PesukimWhole {
        id: SourceId,
        value: bool,
    },
    /// Hide the words; the background stays.
    PesukimBlank {
        id: SourceId,
        value: bool,
    },
    /// Change the words or the look (left out: unchanged).
    UpdatePesukim {
        id: SourceId,
        #[serde(default)]
        #[ts(optional)]
        pesukim: Option<Vec<Pasuk>>,
        #[serde(default)]
        #[ts(optional)]
        look: Option<PesukimLook>,
    },
}

/// Why an action was refused. The show is never changed when this happens.
#[derive(Debug, Clone, PartialEq, Error, Serialize, Deserialize, TS)]
#[serde(
    tag = "code",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export)]
pub enum ActionError {
    #[error("there is no source with id {id}")]
    UnknownSource { id: SourceId },
    #[error("a source with id {id} already exists")]
    DuplicateSource { id: SourceId },
    #[error("{id} is not a video")]
    NotAVideo { id: SourceId },
    #[error("nothing is lined up in the preview of the {screen:?} screen")]
    NothingInPreview { screen: ScreenId },
    #[error("the Monitor shows text only; it cannot show sources")]
    MonitorIsTextOnly,
    #[error("{id} is sound only; it cannot go on a screen")]
    SoundOnly { id: SourceId },
    #[error("{field} is not valid: {reason}")]
    InvalidValue { field: String, reason: String },
}

impl ActionError {
    pub(crate) fn invalid(field: &str, reason: &str) -> Self {
        ActionError::InvalidValue {
            field: field.to_owned(),
            reason: reason.to_owned(),
        }
    }
}
