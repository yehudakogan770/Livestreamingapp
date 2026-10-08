//! The connected accounts and the broadcasts Lumora runs on them.

use serde::{Deserialize, Serialize};

use crate::facebook::{self, LiveSettings, Target, UserToken};
use crate::oauth::{self, GoogleClient, TokenKeeper};
use crate::pkce::{random_state, Pkce};
use crate::youtube::{self, Broadcast, BroadcastSettings, Channel, Health, LiveStream, Phase};
use crate::{AccountError, Http, Request, Response, Secrets};

/// The credential names (the values never leave the credential store but to the provider).
pub const YOUTUBE_SECRET: &str = "youtube-refresh-token";
pub const FACEBOOK_SECRET: &str = "facebook-user-token";

/// The owner's app registrations (none of these are secrets: see docs/LIVE_ACCOUNTS.md).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Config {
    pub youtube: Option<GoogleClient>,
    pub facebook_app_id: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Provider {
    Youtube,
    Facebook,
}

impl Provider {
    #[must_use]
    pub fn name(self) -> &'static str {
        match self {
            Provider::Youtube => "YouTube",
            Provider::Facebook => "Facebook",
        }
    }
}

/// A destination set up through a connected account (kept with the destination).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "provider", rename_all = "camelCase")]
pub enum AccountLink {
    Youtube(YoutubeLink),
    Facebook(FacebookLink),
}

impl AccountLink {
    #[must_use]
    pub fn provider(&self) -> Provider {
        match self {
            AccountLink::Youtube(_) => Provider::Youtube,
            AccountLink::Facebook(_) => Provider::Facebook,
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct YoutubeLink {
    /// A broadcast made ahead of time (in Lumora or YouTube Studio); empty:
    /// a new one is made with `settings` each time Lumora goes live.
    pub broadcast_id: String,
    pub settings: BroadcastSettings,
    /// A picture file for a new broadcast's thumbnail (empty: none).
    pub thumbnail: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct FacebookLink {
    /// A Page id, or `me`.
    pub target_id: String,
    pub target_name: String,
    pub settings: LiveSettings,
}

/// One provider, for the settings.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderInfo {
    /// The owner put the app registration in this build.
    pub set_up: bool,
    pub connected: bool,
    /// The channel's or person's name (when known).
    pub name: String,
    /// When the connection runs out (Facebook), seconds since 1970; 0: it doesn't.
    pub expires_at: u64,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountsInfo {
    pub youtube: ProviderInfo,
    pub facebook: ProviderInfo,
}

/// A sign-in in progress (between opening the browser and its answer).
pub struct Pending {
    pub provider: Provider,
    pub state: String,
    verifier: String,
    pub redirect_uri: String,
}

impl std::fmt::Debug for Pending {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Pending")
            .field("provider", &self.provider)
            .field("redirect_uri", &self.redirect_uri)
            .finish_non_exhaustive()
    }
}

/// Where one destination sends, once prepared.
#[derive(Clone, PartialEq, Eq)]
pub struct Prepared {
    pub dest_id: String,
    pub server: String,
    pub backup_server: String,
    pub key: String,
}

impl std::fmt::Debug for Prepared {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Prepared")
            .field("dest_id", &self.dest_id)
            .field("server", &self.server)
            .finish_non_exhaustive()
    }
}

/// A destination that couldn't be prepared.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Failed {
    pub dest_id: String,
    pub provider: Provider,
    pub error: AccountError,
}

/// How a connected destination is doing, for the settings and the status.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionView {
    pub dest_id: String,
    pub provider: Provider,
    pub phase: Phase,
    pub health: Health,
    pub watch_url: String,
    pub title: String,
    /// The last problem (cleared when things work again).
    pub message: Option<String>,
    /// YouTube's notes about the stream.
    pub issues: Vec<String>,
}

#[derive(Debug)]
struct Session {
    view: SessionView,
    /// The YouTube broadcast or the Facebook live video.
    id: String,
    stream_id: String,
    starting: bool,
    auto_start: bool,
    auto_stop: bool,
    monitor: bool,
    /// The Page's (or person's) token for the Facebook live video.
    fb_token: String,
    ended: bool,
}

/// Errors YouTube gives while it isn't ready for a transition yet: tried again later.
const NOT_YET: [&str; 3] = [
    "invalidTransition",
    "redundantTransition",
    "errorStreamInactive",
];

pub struct Accounts {
    config: Config,
    youtube: Option<TokenKeeper>,
    channel: Option<Channel>,
    facebook: Option<UserToken>,
    fb_name: String,
    stream: Option<LiveStream>,
    sessions: Vec<Session>,
}

impl std::fmt::Debug for Accounts {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Accounts")
            .field("youtube", &self.youtube.is_some())
            .field("facebook", &self.facebook.is_some())
            .field("sessions", &self.sessions.len())
            .finish_non_exhaustive()
    }
}

fn not_set_up(p: Provider) -> AccountError {
    AccountError::new(format!(
        "Connecting a {} account isn’t set up in this copy of Lumora yet. The person who set up \
         Lumora needs to add the app registration (see docs/LIVE_ACCOUNTS.md). Until then, add \
         {} with a stream key.",
        p.name(),
        p.name()
    ))
}

fn not_connected(p: Provider) -> AccountError {
    AccountError::reconnect(format!(
        "No {} account is connected. Click Connect {} in Settings → Recording and streaming.",
        p.name(),
        p.name()
    ))
}

impl Accounts {
    /// The accounts kept from last time.
    #[must_use]
    pub fn new(config: Config, secrets: &dyn Secrets) -> Self {
        let youtube = config.youtube.clone().and_then(|c| {
            secrets
                .get(YOUTUBE_SECRET)
                .filter(|r| !r.is_empty())
                .map(|r| TokenKeeper::new(c, r))
        });
        let facebook = config
            .facebook_app_id
            .as_ref()
            .and_then(|_| secrets.get(FACEBOOK_SECRET))
            .and_then(|s| serde_json::from_str::<UserToken>(&s).ok());
        Accounts {
            config,
            youtube,
            channel: None,
            facebook,
            fb_name: String::new(),
            stream: None,
            sessions: Vec::new(),
        }
    }

    #[must_use]
    pub fn info(&self) -> AccountsInfo {
        AccountsInfo {
            youtube: ProviderInfo {
                set_up: self.config.youtube.is_some(),
                connected: self.youtube.is_some(),
                name: self
                    .channel
                    .as_ref()
                    .map(|c| c.title.clone())
                    .unwrap_or_default(),
                expires_at: 0,
            },
            facebook: ProviderInfo {
                set_up: self.config.facebook_app_id.is_some(),
                connected: self.facebook.is_some(),
                name: self.fb_name.clone(),
                expires_at: self.facebook.as_ref().map_or(0, |t| t.expires_at),
            },
        }
    }

    /// Start a sign-in: the address to open in the browser, and what to keep until it answers.
    ///
    /// # Errors
    /// The provider isn't set up in this build.
    pub fn begin(
        &self,
        provider: Provider,
        redirect_uri: &str,
    ) -> Result<(String, Pending), AccountError> {
        let state = random_state().map_err(AccountError::new)?;
        match provider {
            Provider::Youtube => {
                let client = self
                    .config
                    .youtube
                    .as_ref()
                    .ok_or_else(|| not_set_up(provider))?;
                let pkce = Pkce::new().map_err(AccountError::new)?;
                let url = client.auth_url(redirect_uri, &pkce, &state);
                Ok((
                    url,
                    Pending {
                        provider,
                        state,
                        verifier: pkce.verifier,
                        redirect_uri: redirect_uri.to_owned(),
                    },
                ))
            }
            Provider::Facebook => {
                let app = self
                    .config
                    .facebook_app_id
                    .as_ref()
                    .ok_or_else(|| not_set_up(provider))?;
                Ok((
                    facebook::auth_url(app, redirect_uri, &state),
                    Pending {
                        provider,
                        state,
                        verifier: String::new(),
                        redirect_uri: redirect_uri.to_owned(),
                    },
                ))
            }
        }
    }

    /// Finish a sign-in with what the browser brought back.
    ///
    /// # Errors
    /// Canceled, refused or not saved, in words.
    pub fn complete(
        &mut self,
        http: &dyn Http,
        secrets: &dyn Secrets,
        pending: &Pending,
        params: &[(String, String)],
        now: u64,
    ) -> Result<(), AccountError> {
        let get = |k: &str| {
            params
                .iter()
                .find(|(n, _)| n == k)
                .map(|(_, v)| v.as_str())
                .unwrap_or_default()
        };
        match pending.provider {
            Provider::Youtube => {
                let client = self
                    .config
                    .youtube
                    .clone()
                    .ok_or_else(|| not_set_up(Provider::Youtube))?;
                if get("error") == "access_denied" {
                    return Err(AccountError::new(
                        "The YouTube connection was canceled in the browser. Nothing was changed.",
                    ));
                }
                if !get("error").is_empty() {
                    return Err(AccountError::new(format!(
                        "Google didn’t connect ({}).",
                        get("error")
                    )));
                }
                if get("state") != pending.state {
                    return Err(AccountError::new(
                        "That sign-in answer isn’t from this connection. Click Connect YouTube \
                         and try again.",
                    ));
                }
                let code = get("code");
                if code.is_empty() {
                    return Err(AccountError::new(
                        "Google didn’t send a sign-in code. Try connecting again.",
                    ));
                }
                let resp = http
                    .send(&client.exchange(code, &pending.verifier, &pending.redirect_uri))
                    .map_err(|e| AccountError::offline("Google", &e))?;
                let tokens = oauth::parse_tokens(&resp)?;
                let keeper = TokenKeeper::from_tokens(client, tokens, now).ok_or_else(|| {
                    AccountError::new(
                        "Google didn’t give Lumora a lasting connection. Remove Lumora from your \
                         Google account’s third-party access, then connect again.",
                    )
                })?;
                secrets
                    .set(YOUTUBE_SECRET, keeper.refresh_token())
                    .map_err(|e| {
                        AccountError::new(format!(
                            "The YouTube connection couldn’t be saved in Windows Credential \
                             Manager ({e})."
                        ))
                    })?;
                self.youtube = Some(keeper);
                self.channel = None;
                self.stream = None;
                // The channel's name (a channel is needed to go live).
                let resp = self.yt_call(http, secrets, now, &youtube::channel())?;
                self.channel = Some(youtube::parse_channel(&resp)?);
                Ok(())
            }
            Provider::Facebook => {
                let token = facebook::parse_callback(params, &pending.state, now)?;
                let resp = http
                    .send(&facebook::me().bearer(&token.token))
                    .map_err(|e| AccountError::offline("Facebook", &e))?;
                let (_, name) = facebook::parse_me(&resp)?;
                let saved = serde_json::to_string(&token).unwrap_or_default();
                secrets.set(FACEBOOK_SECRET, &saved).map_err(|e| {
                    AccountError::new(format!(
                        "The Facebook connection couldn’t be saved in Windows Credential \
                         Manager ({e})."
                    ))
                })?;
                self.facebook = Some(token);
                self.fb_name = name;
                Ok(())
            }
        }
    }

    /// Forget an account (and tell Google to stop accepting its token).
    pub fn disconnect(&mut self, provider: Provider, http: &dyn Http, secrets: &dyn Secrets) {
        match provider {
            Provider::Youtube => {
                if let Some(k) = self.youtube.take() {
                    let _ = http.send(&oauth::revoke(k.refresh_token()));
                }
                self.channel = None;
                self.stream = None;
                secrets.delete(YOUTUBE_SECRET);
            }
            Provider::Facebook => {
                self.facebook = None;
                self.fb_name.clear();
                secrets.delete(FACEBOOK_SECRET);
            }
        }
    }

    /// Look up the connected names (after start-up). Errors are left for later.
    pub fn load_names(&mut self, http: &dyn Http, secrets: &dyn Secrets, now: u64) {
        if self.youtube.is_some() && self.channel.is_none() {
            if let Ok(resp) = self.yt_call(http, secrets, now, &youtube::channel()) {
                self.channel = youtube::parse_channel(&resp).ok();
            }
        }
        if self.fb_name.is_empty() {
            if let Some(t) = self.facebook.as_ref().filter(|t| t.valid_at(now)) {
                if let Ok(resp) = http.send(&facebook::me().bearer(&t.token)) {
                    if let Ok((_, name)) = facebook::parse_me(&resp) {
                        self.fb_name = name;
                    }
                }
            }
        }
    }

    // ---- YouTube ----

    /// Send a YouTube request signed with a working token (refreshed once when refused).
    fn yt_call(
        &mut self,
        http: &dyn Http,
        secrets: &dyn Secrets,
        now: u64,
        req: &Request,
    ) -> Result<Response, AccountError> {
        let keeper = self
            .youtube
            .as_mut()
            .ok_or_else(|| not_connected(Provider::Youtube))?;
        let mut tried = false;
        loop {
            let token = keeper.access(http, now)?;
            if keeper.take_rotated() {
                let _ = secrets.set(YOUTUBE_SECRET, keeper.refresh_token());
            }
            let resp = http
                .send(&req.clone().bearer(&token))
                .map_err(|e| AccountError::offline("YouTube", &e))?;
            if resp.status == 401 && !tried {
                tried = true;
                keeper.forget_access();
                continue;
            }
            return Ok(resp);
        }
    }

    /// Broadcasts not yet held, to choose from.
    ///
    /// # Errors
    /// Not connected, or YouTube refused, in words.
    pub fn youtube_broadcasts(
        &mut self,
        http: &dyn Http,
        secrets: &dyn Secrets,
        now: u64,
    ) -> Result<Vec<Broadcast>, AccountError> {
        let resp = self.yt_call(http, secrets, now, &youtube::list_upcoming())?;
        let mut list = youtube::parse_broadcasts(&resp)?;
        list.retain(|b| !b.phase.over());
        Ok(list)
    }

    /// Make a broadcast now (to share its link ahead of time).
    ///
    /// # Errors
    /// Not connected, or YouTube refused, in words.
    pub fn youtube_create(
        &mut self,
        http: &dyn Http,
        secrets: &dyn Secrets,
        settings: &BroadcastSettings,
        now: u64,
    ) -> Result<Broadcast, AccountError> {
        settings.check()?;
        let req = youtube::insert_broadcast(settings, &crate::time::rfc3339(now + 60));
        let resp = self.yt_call(http, secrets, now, &req)?;
        youtube::parse_one_broadcast(&resp)
    }

    /// Set a broadcast's thumbnail (a JPEG or PNG of at most 2 MB).
    ///
    /// # Errors
    /// The picture isn't usable, or YouTube refused, in words.
    pub fn youtube_thumbnail(
        &mut self,
        http: &dyn Http,
        secrets: &dyn Secrets,
        broadcast_id: &str,
        bytes: Vec<u8>,
        now: u64,
    ) -> Result<(), AccountError> {
        let mime = youtube::image_type(&bytes)
            .ok_or_else(|| AccountError::new("A thumbnail must be a JPG or PNG picture."))?;
        if bytes.len() > youtube::THUMBNAIL_MAX {
            return Err(AccountError::new(
                "That picture is bigger than YouTube takes (2 MB). Use a smaller JPG (1280 × 720 is best).",
            ));
        }
        let req = youtube::set_thumbnail(broadcast_id, mime, bytes);
        let resp = self.yt_call(http, secrets, now, &req)?;
        if resp.ok() {
            Ok(())
        } else {
            Err(youtube::api_error(&resp))
        }
    }

    /// Lumora's reusable stream on the channel (made the first time).
    fn yt_stream(
        &mut self,
        http: &dyn Http,
        secrets: &dyn Secrets,
        now: u64,
    ) -> Result<LiveStream, AccountError> {
        if let Some(s) = &self.stream {
            return Ok(s.clone());
        }
        let resp = self.yt_call(http, secrets, now, &youtube::list_streams())?;
        let streams = youtube::parse_streams(&resp)?;
        let stream = match youtube::lumora_stream(&streams) {
            Some(s) => s.clone(),
            None => {
                let resp = self.yt_call(http, secrets, now, &youtube::insert_stream())?;
                youtube::parse_one_stream(&resp)?
            }
        };
        if stream.ingest.is_none() {
            return Err(AccountError::new(
                "YouTube made the stream but sent no ingest address. Try again.",
            ));
        }
        self.stream = Some(stream.clone());
        Ok(stream)
    }

    fn prepare_youtube(
        &mut self,
        http: &dyn Http,
        secrets: &dyn Secrets,
        dest_id: &str,
        link: &YoutubeLink,
        now: u64,
    ) -> Result<Prepared, AccountError> {
        if self.youtube.is_none() {
            return Err(not_connected(Provider::Youtube));
        }
        let stream = self.yt_stream(http, secrets, now)?;
        let mut note = None;
        let mut broadcast = if link.broadcast_id.trim().is_empty() {
            link.settings.check()?;
            let req = youtube::insert_broadcast(&link.settings, &crate::time::rfc3339(now));
            let resp = self.yt_call(http, secrets, now, &req)?;
            let b = youtube::parse_one_broadcast(&resp)?;
            if !link.thumbnail.trim().is_empty() {
                let result = std::fs::read(link.thumbnail.trim())
                    .map_err(|e| {
                        AccountError::new(format!("The thumbnail picture couldn’t be read ({e})."))
                    })
                    .and_then(|bytes| self.youtube_thumbnail(http, secrets, &b.id, bytes, now));
                if let Err(e) = result {
                    note = Some(format!("The broadcast is live without its thumbnail: {e}"));
                }
            }
            b
        } else {
            let resp = self.yt_call(
                http,
                secrets,
                now,
                &youtube::get_broadcast(link.broadcast_id.trim()),
            )?;
            let b = youtube::parse_broadcasts(&resp)?
                .into_iter()
                .next()
                .ok_or_else(|| {
                    AccountError::new(
                    "That YouTube broadcast no longer exists. Choose another one, or let Lumora \
                     make a new one.",
                )
                })?;
            if b.phase.over() {
                return Err(AccountError::new(
                    "That YouTube broadcast has already ended. Choose another one, or let Lumora \
                     make a new one.",
                ));
            }
            b
        };
        if broadcast.bound_stream_id.as_deref() != Some(stream.id.as_str()) {
            let resp = self.yt_call(
                http,
                secrets,
                now,
                &youtube::bind(&broadcast.id, &stream.id),
            )?;
            let bound = youtube::parse_one_broadcast(&resp)?;
            // The bind answer has only id and contentDetails.
            broadcast.bound_stream_id = bound.bound_stream_id;
            if broadcast.phase == Phase::Created {
                broadcast.phase = Phase::Ready;
            }
        }
        let Some(ingest) = stream.ingest.clone() else {
            return Err(AccountError::new(
                "YouTube sent no ingest address. Try again.",
            ));
        };
        self.sessions.push(Session {
            view: SessionView {
                dest_id: dest_id.to_owned(),
                provider: Provider::Youtube,
                phase: broadcast.phase,
                health: Health::NoData,
                watch_url: broadcast.watch_url.clone(),
                title: broadcast.title.clone(),
                message: note,
                issues: Vec::new(),
            },
            id: broadcast.id.clone(),
            stream_id: stream.id.clone(),
            starting: broadcast.life_cycle.ends_with("Starting"),
            auto_start: broadcast.auto_start,
            auto_stop: broadcast.auto_stop,
            monitor: broadcast.monitor,
            fb_token: String::new(),
            ended: false,
        });
        Ok(Prepared {
            dest_id: dest_id.to_owned(),
            server: ingest.server,
            backup_server: ingest.backup_server,
            key: ingest.key,
        })
    }

    // ---- Facebook ----

    fn fb_token(&self, now: u64) -> Result<String, AccountError> {
        let t = self
            .facebook
            .as_ref()
            .ok_or_else(|| not_connected(Provider::Facebook))?;
        if !t.valid_at(now) {
            return Err(AccountError::reconnect(
                "The Facebook connection has run out (Facebook keeps it for an hour or two). \
                 Connect Facebook again.",
            ));
        }
        Ok(t.token.clone())
    }

    /// The Pages (and profile) the person can go live on.
    ///
    /// # Errors
    /// Not connected, or Facebook refused, in words.
    pub fn facebook_targets(&self, http: &dyn Http, now: u64) -> Result<Vec<Target>, AccountError> {
        let token = self.fb_token(now)?;
        let resp = http
            .send(&facebook::pages().bearer(&token))
            .map_err(|e| AccountError::offline("Facebook", &e))?;
        let mut targets = facebook::parse_pages(&resp)?;
        targets.push(Target {
            id: "me".to_owned(),
            name: if self.fb_name.is_empty() {
                "My own profile".to_owned()
            } else {
                format!("{} (own profile, if Facebook allows it)", self.fb_name)
            },
            can_publish: true,
            token,
        });
        Ok(targets)
    }

    fn prepare_facebook(
        &mut self,
        http: &dyn Http,
        dest_id: &str,
        link: &FacebookLink,
        now: u64,
    ) -> Result<Prepared, AccountError> {
        let target_id = if link.target_id.trim().is_empty() {
            return Err(AccountError::new(
                "Choose the Facebook Page to go live on (Settings → Recording and streaming).",
            ));
        } else {
            link.target_id.trim()
        };
        let targets = self.facebook_targets(http, now)?;
        let target = targets.iter().find(|t| t.id == target_id).ok_or_else(|| {
            AccountError::new(format!(
                "The connected Facebook account no longer manages “{}”. Choose another Page.",
                link.target_name
            ))
        })?;
        let resp = http
            .send(&facebook::create_live(target_id, &link.settings).bearer(&target.token))
            .map_err(|e| AccountError::offline("Facebook", &e))?;
        let live = facebook::parse_live(&resp)?;
        self.sessions.push(Session {
            view: SessionView {
                dest_id: dest_id.to_owned(),
                provider: Provider::Facebook,
                phase: Phase::Ready,
                health: Health::NoData,
                watch_url: String::new(),
                title: link.settings.title.clone(),
                message: None,
                issues: Vec::new(),
            },
            id: live.id.clone(),
            stream_id: String::new(),
            starting: false,
            auto_start: true,
            auto_stop: false,
            monitor: false,
            fb_token: target.token.clone(),
            ended: false,
        });
        Ok(Prepared {
            dest_id: dest_id.to_owned(),
            server: live.server,
            backup_server: String::new(),
            key: live.key,
        })
    }

    // ---- going live ----

    /// Lumora is about to stream: get each connected destination's address and key.
    /// Earlier sessions are forgotten.
    pub fn prepare(
        &mut self,
        http: &dyn Http,
        secrets: &dyn Secrets,
        links: &[(String, AccountLink)],
        now: u64,
    ) -> (Vec<Prepared>, Vec<Failed>) {
        self.sessions.clear();
        let mut ready = Vec::new();
        let mut failed = Vec::new();
        for (dest_id, link) in links {
            let result = match link {
                AccountLink::Youtube(l) => self.prepare_youtube(http, secrets, dest_id, l, now),
                AccountLink::Facebook(l) => self.prepare_facebook(http, dest_id, l, now),
            };
            match result {
                Ok(p) => ready.push(p),
                Err(error) => failed.push(Failed {
                    dest_id: dest_id.clone(),
                    provider: link.provider(),
                    error,
                }),
            }
        }
        (ready, failed)
    }

    /// While Lumora streams (every 15 seconds or so): read the health and move
    /// YouTube broadcasts on to live.
    pub fn tick(&mut self, http: &dyn Http, secrets: &dyn Secrets, now: u64) {
        for i in 0..self.sessions.len() {
            if self.sessions[i].ended {
                continue;
            }
            match self.sessions[i].view.provider {
                Provider::Youtube => self.tick_youtube(http, secrets, i, now),
                Provider::Facebook => self.tick_facebook(http, i),
            }
        }
    }

    fn tick_youtube(&mut self, http: &dyn Http, secrets: &dyn Secrets, i: usize, now: u64) {
        let (stream_id, id) = (
            self.sessions[i].stream_id.clone(),
            self.sessions[i].id.clone(),
        );
        let active = match self
            .yt_call(http, secrets, now, &youtube::stream_status(&stream_id))
            .and_then(|r| youtube::parse_streams(&r))
        {
            Ok(list) => {
                let s = &mut self.sessions[i];
                match list.first() {
                    Some(st) => {
                        s.view.health = st.health;
                        s.view.issues.clone_from(&st.issues);
                        st.active()
                    }
                    None => false,
                }
            }
            Err(e) => {
                self.sessions[i].view.message = Some(e.message);
                return;
            }
        };
        // Where the broadcast is (not needed once it is live).
        let s = &self.sessions[i];
        if s.view.phase == Phase::Live && !s.starting || s.view.phase.over() {
            self.sessions[i].view.message = None;
            return;
        }
        match self
            .yt_call(http, secrets, now, &youtube::get_broadcast(&id))
            .and_then(|r| youtube::parse_broadcasts(&r))
        {
            Ok(list) => {
                if let Some(b) = list.first() {
                    let s = &mut self.sessions[i];
                    s.view.phase = b.phase;
                    s.starting = b.life_cycle.ends_with("Starting");
                }
            }
            Err(e) => {
                self.sessions[i].view.message = Some(e.message);
                return;
            }
        }
        let s = &self.sessions[i];
        let Some(step) =
            youtube::next_step(s.view.phase, s.starting, active, s.auto_start, s.monitor)
        else {
            self.sessions[i].view.message = None;
            return;
        };
        match self.yt_call(http, secrets, now, &youtube::transition(&id, step)) {
            Ok(resp) if resp.ok() => {
                let b = youtube::parse_one_broadcast(&resp).ok();
                let s = &mut self.sessions[i];
                if let Some(b) = b {
                    s.view.phase = b.phase;
                    s.starting = b.life_cycle.ends_with("Starting");
                }
                s.view.message = None;
            }
            Ok(resp) => {
                if !NOT_YET.contains(&youtube::error_reason(&resp).as_str()) {
                    self.sessions[i].view.message = Some(youtube::api_error(&resp).message);
                }
            }
            Err(e) => self.sessions[i].view.message = Some(e.message),
        }
    }

    fn tick_facebook(&mut self, http: &dyn Http, i: usize) {
        let s = &mut self.sessions[i];
        match http
            .send(&facebook::live_status(&s.id).bearer(&s.fb_token))
            .map_err(|e| AccountError::offline("Facebook", &e))
            .and_then(|r| facebook::parse_status(&r))
        {
            Ok(st) => {
                s.view.phase = st.phase;
                s.view.health = st.health;
                if !st.watch_url.is_empty() {
                    s.view.watch_url = st.watch_url;
                }
                s.view.message = None;
            }
            Err(e) => s.view.message = Some(e.message),
        }
    }

    /// The operator stopped the stream: complete the YouTube broadcasts (unless
    /// YouTube does) and end the Facebook live videos. Says what couldn't be ended.
    pub fn finish(&mut self, http: &dyn Http, secrets: &dyn Secrets, now: u64) -> Vec<Failed> {
        let mut failed = Vec::new();
        for i in 0..self.sessions.len() {
            if self.sessions[i].ended {
                continue;
            }
            let id = self.sessions[i].id.clone();
            let provider = self.sessions[i].view.provider;
            let result = match provider {
                Provider::Youtube => self.finish_youtube(http, secrets, i, &id, now),
                Provider::Facebook => {
                    let token = self.sessions[i].fb_token.clone();
                    http.send(&facebook::end_live(&id).bearer(&token))
                        .map_err(|e| AccountError::offline("Facebook", &e))
                        .and_then(|r| {
                            if r.ok() {
                                Ok(())
                            } else {
                                Err(facebook::api_error(&r))
                            }
                        })
                        .map(|()| self.sessions[i].view.phase = Phase::Complete)
                }
            };
            let s = &mut self.sessions[i];
            s.ended = true;
            s.fb_token.clear();
            match result {
                Ok(()) => s.view.message = None,
                Err(error) => {
                    s.view.message = Some(error.message.clone());
                    failed.push(Failed {
                        dest_id: s.view.dest_id.clone(),
                        provider,
                        error,
                    });
                }
            }
        }
        failed
    }

    fn finish_youtube(
        &mut self,
        http: &dyn Http,
        secrets: &dyn Secrets,
        i: usize,
        id: &str,
        now: u64,
    ) -> Result<(), AccountError> {
        let resp = self.yt_call(http, secrets, now, &youtube::get_broadcast(id))?;
        if let Some(b) = youtube::parse_broadcasts(&resp)?.first() {
            self.sessions[i].view.phase = b.phase;
        }
        let s = &self.sessions[i];
        let Some(step) = youtube::stop_step(s.view.phase, s.auto_stop) else {
            return Ok(());
        };
        let resp = self.yt_call(http, secrets, now, &youtube::transition(id, step))?;
        if resp.ok() || youtube::error_reason(&resp) == "redundantTransition" {
            self.sessions[i].view.phase = Phase::Complete;
            Ok(())
        } else {
            Err(youtube::api_error(&resp))
        }
    }

    /// How each connected destination is doing (the last stream's, after it stopped).
    #[must_use]
    pub fn sessions(&self) -> Vec<SessionView> {
        self.sessions.iter().map(|s| s.view.clone()).collect()
    }

    /// Something is on air through an account (ticks are needed).
    #[must_use]
    pub fn running(&self) -> bool {
        self.sessions.iter().any(|s| !s.ended)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Method;
    use std::cell::RefCell;
    use std::collections::HashMap;

    /// Answers by method and address prefix, in order; records every request.
    #[derive(Default)]
    struct Fake {
        routes: RefCell<Vec<(Method, String, Response)>>,
        sent: RefCell<Vec<Request>>,
    }

    impl Fake {
        fn on(&self, method: Method, prefix: &str, status: u16, body: impl Into<Vec<u8>>) -> &Self {
            self.routes
                .borrow_mut()
                .push((method, prefix.to_owned(), Response::new(status, body)));
            self
        }
        fn fixture(&self, method: Method, prefix: &str, name: &str) -> &Self {
            let path = format!("{}/tests/fixtures/{name}", env!("CARGO_MANIFEST_DIR"));
            self.on(method, prefix, 200, std::fs::read(path).unwrap())
        }
        fn count(&self, prefix: &str) -> usize {
            self.sent
                .borrow()
                .iter()
                .filter(|r| r.url.starts_with(prefix))
                .count()
        }
    }

    impl Http for Fake {
        fn send(&self, r: &Request) -> Result<Response, String> {
            self.sent.borrow_mut().push(r.clone());
            let mut routes = self.routes.borrow_mut();
            let i = routes
                .iter()
                .position(|(m, p, _)| *m == r.method && r.url.starts_with(p.as_str()))
                .ok_or_else(|| format!("no answer for {} {}", r.method.as_str(), r.url))?;
            Ok(routes.remove(i).2)
        }
    }

    #[derive(Default)]
    struct Store(RefCell<HashMap<String, String>>);
    impl Secrets for Store {
        fn get(&self, name: &str) -> Option<String> {
            self.0.borrow().get(name).cloned()
        }
        fn set(&self, name: &str, value: &str) -> Result<(), String> {
            self.0
                .borrow_mut()
                .insert(name.to_owned(), value.to_owned());
            Ok(())
        }
        fn delete(&self, name: &str) {
            self.0.borrow_mut().remove(name);
        }
    }

    const YT: &str = "https://www.googleapis.com/youtube/v3";
    const TOKEN: &str = "https://oauth2.googleapis.com/token";
    const FB: &str = "https://graph.facebook.com/v21.0";

    fn config() -> Config {
        Config {
            youtube: Some(GoogleClient {
                client_id: "id.apps.googleusercontent.com".into(),
                client_secret: None,
            }),
            facebook_app_id: Some("1234".into()),
        }
    }

    fn connected_youtube(store: &Store) -> Accounts {
        store.set(YOUTUBE_SECRET, "1//refresh").unwrap();
        Accounts::new(config(), store)
    }

    fn token(http: &Fake) {
        http.on(
            Method::Post,
            TOKEN,
            200,
            r#"{"access_token":"ya29.x","expires_in":3600}"#,
        );
    }

    #[test]
    fn not_set_up_says_so() {
        let store = Store::default();
        let a = Accounts::new(Config::default(), &store);
        let info = a.info();
        assert!(!info.youtube.set_up && !info.facebook.set_up);
        let e = a
            .begin(Provider::Youtube, "http://127.0.0.1:1")
            .unwrap_err();
        assert!(e
            .message
            .contains("isn’t set up in this copy of Lumora yet"));
        assert!(a.begin(Provider::Facebook, "x").is_err());
    }

    #[test]
    fn connects_youtube_and_keeps_only_the_refresh_token() {
        let store = Store::default();
        let mut a = Accounts::new(config(), &store);
        assert!(!a.info().youtube.connected);
        let (url, pending) = a.begin(Provider::Youtube, "http://127.0.0.1:5555").unwrap();
        let r = Request::get(url);
        assert_eq!(
            r.query_value("code_challenge").unwrap(),
            crate::pkce::challenge(&pending.verifier)
        );
        let http = Fake::default();
        http.fixture(Method::Post, TOKEN, "google_token.json")
            .fixture(Method::Get, &format!("{YT}/channels"), "yt_channel.json");
        // An answer with another state is refused.
        let wrong = vec![
            ("state".to_owned(), "nope".to_owned()),
            ("code".to_owned(), "c".to_owned()),
        ];
        assert!(a.complete(&http, &store, &pending, &wrong, 0).is_err());
        let params = vec![
            ("state".to_owned(), pending.state.clone()),
            ("code".to_owned(), "4/0A".to_owned()),
        ];
        a.complete(&http, &store, &pending, &params, 0).unwrap();
        assert_eq!(
            store.get(YOUTUBE_SECRET).as_deref(),
            Some("1//0g-test-refresh")
        );
        assert_eq!(store.0.borrow().len(), 1, "only the refresh token is kept");
        let info = a.info();
        assert!(info.youtube.connected);
        assert_eq!(info.youtube.name, "Riverside Community Hall");
        let sent = http.sent.borrow();
        assert!(sent[0]
            .body_text()
            .contains(&format!("code_verifier={}", pending.verifier)));
        assert_eq!(
            sent[1].header("authorization"),
            Some("Bearer ya29.a0-test-access")
        );
        drop(sent);
        // Disconnecting revokes and forgets it.
        http.on(
            Method::Post,
            "https://oauth2.googleapis.com/revoke",
            200,
            "",
        );
        a.disconnect(Provider::Youtube, &http, &store);
        assert!(store.get(YOUTUBE_SECRET).is_none());
        assert!(!a.info().youtube.connected);
    }

    #[test]
    fn goes_live_on_youtube_from_created_to_complete() {
        let store = Store::default();
        let mut a = connected_youtube(&store);
        let http = Fake::default();
        token(&http);
        // No Lumora stream yet: one is made. Then the broadcast, then the bind.
        http.on(
            Method::Get,
            &format!("{YT}/liveStreams"),
            200,
            r#"{"items":[]}"#,
        );
        // An insert answers with the one stream it made.
        let one_stream = {
            let path = format!(
                "{}/tests/fixtures/yt_streams.json",
                env!("CARGO_MANIFEST_DIR")
            );
            let v: serde_json::Value =
                serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
            v["items"][1].to_string()
        };
        http.on(Method::Post, &format!("{YT}/liveStreams"), 200, one_stream)
            .fixture(
                Method::Post,
                &format!("{YT}/liveBroadcasts?"),
                "yt_broadcast_insert.json",
            )
            .on(
                Method::Post,
                &format!("{YT}/liveBroadcasts/bind"),
                200,
                r#"{"id":"New0Broadcast1","contentDetails":{"boundStreamId":"Abc123StreamId"}}"#,
            );
        let mut settings = BroadcastSettings {
            title: "Spring concert".into(),
            ..BroadcastSettings::default()
        };
        // YouTube needs the made-for-kids answer: nothing is made without it.
        let unanswered = AccountLink::Youtube(YoutubeLink {
            settings: settings.clone(),
            ..YoutubeLink::default()
        });
        let (_, failed) = a.prepare(&http, &store, &[("yt".into(), unanswered)], 1_791_484_200);
        assert!(failed[0].error.message.contains("made for kids"));
        settings.kids_chosen = true;
        let link = AccountLink::Youtube(YoutubeLink {
            settings,
            ..YoutubeLink::default()
        });
        let (ready, failed) = a.prepare(&http, &store, &[("yt".into(), link)], 1_791_484_200);
        assert!(failed.is_empty(), "{failed:?}");
        assert_eq!(ready[0].server, "rtmps://a.rtmps.youtube.com/live2");
        assert_eq!(
            ready[0].backup_server,
            "rtmps://b.rtmps.youtube.com/live2?backup=1"
        );
        assert_eq!(ready[0].key, "abcd-efgh-ijkl-mnop-qrst");
        let insert = http
            .sent
            .borrow()
            .iter()
            .find(|r| r.url.contains("liveBroadcasts?part="))
            .cloned()
            .unwrap();
        assert_eq!(
            insert.body_json()["snippet"]["scheduledStartTime"],
            "2026-10-08T18:30:00Z"
        );
        let v = &a.sessions()[0];
        assert_eq!(v.phase, Phase::Ready);
        assert_eq!(
            v.watch_url,
            "https://www.youtube.com/watch?v=New0Broadcast1"
        );

        // Tick 1: the stream isn't arriving yet: no transition.
        let status = |s: &str, h: &str| {
            format!(
                r#"{{"items":[{{"id":"Abc123StreamId","status":{{"streamStatus":"{s}","healthStatus":{{"status":"{h}"}}}}}}]}}"#
            )
        };
        let broadcast = |lc: &str| {
            format!(
                r#"{{"items":[{{"id":"New0Broadcast1","status":{{"lifeCycleStatus":"{lc}"}},"contentDetails":{{"monitorStream":{{"enableMonitorStream":true}}}}}}]}}"#
            )
        };
        http.on(
            Method::Get,
            &format!("{YT}/liveStreams"),
            200,
            status("ready", "noData"),
        )
        .on(
            Method::Get,
            &format!("{YT}/liveBroadcasts"),
            200,
            broadcast("ready"),
        );
        a.tick(&http, &store, 1_791_484_210);
        assert_eq!(http.count(&format!("{YT}/liveBroadcasts/transition")), 0);
        // Tick 2: arriving: to testing.
        http.on(
            Method::Get,
            &format!("{YT}/liveStreams"),
            200,
            status("active", "good"),
        )
        .on(
            Method::Get,
            &format!("{YT}/liveBroadcasts"),
            200,
            broadcast("ready"),
        )
        .on(
            Method::Post,
            &format!("{YT}/liveBroadcasts/transition"),
            200,
            r#"{"id":"New0Broadcast1","status":{"lifeCycleStatus":"testStarting"}}"#,
        );
        a.tick(&http, &store, 1_791_484_225);
        assert_eq!(a.sessions()[0].phase, Phase::Testing);
        assert_eq!(a.sessions()[0].health, Health::Good);
        // Tick 3: still starting the test: wait. YouTube isn't ready yet (said politely, not shown).
        http.on(Method::Get, &format!("{YT}/liveStreams"), 200, status("active", "good"))
            .on(Method::Get, &format!("{YT}/liveBroadcasts"), 200, broadcast("testing"))
            .on(Method::Post, &format!("{YT}/liveBroadcasts/transition"), 403, r#"{"error":{"code":403,"message":"Invalid transition","errors":[{"reason":"invalidTransition"}]}}"#);
        a.tick(&http, &store, 1_791_484_240);
        assert_eq!(a.sessions()[0].message, None);
        // Tick 4: to live.
        http.on(
            Method::Get,
            &format!("{YT}/liveStreams"),
            200,
            status("active", "ok"),
        )
        .on(
            Method::Get,
            &format!("{YT}/liveBroadcasts"),
            200,
            broadcast("testing"),
        )
        .on(
            Method::Post,
            &format!("{YT}/liveBroadcasts/transition"),
            200,
            r#"{"id":"New0Broadcast1","status":{"lifeCycleStatus":"live"}}"#,
        );
        a.tick(&http, &store, 1_791_484_255);
        assert_eq!(a.sessions()[0].phase, Phase::Live);
        let to = |i: usize| {
            http.sent
                .borrow()
                .iter()
                .filter(|r| r.url.contains("/transition"))
                .nth(i)
                .unwrap()
                .query_value("broadcastStatus")
                .unwrap()
        };
        assert_eq!(
            (to(0), to(1), to(2)),
            ("testing".into(), "live".into(), "live".into())
        );
        // Live: only the health is read (1 unit a tick).
        let before = http.sent.borrow().len();
        http.on(
            Method::Get,
            &format!("{YT}/liveStreams"),
            200,
            status("active", "bad"),
        );
        a.tick(&http, &store, 1_791_484_270);
        assert_eq!(http.sent.borrow().len(), before + 1);
        assert_eq!(a.sessions()[0].health, Health::Bad);
        // Stop: complete.
        http.on(
            Method::Get,
            &format!("{YT}/liveBroadcasts"),
            200,
            broadcast("live"),
        )
        .on(
            Method::Post,
            &format!("{YT}/liveBroadcasts/transition"),
            200,
            r#"{"id":"New0Broadcast1","status":{"lifeCycleStatus":"complete"}}"#,
        );
        assert!(a.finish(&http, &store, 1_791_486_000).is_empty());
        assert_eq!(to(3), "complete");
        assert_eq!(a.sessions()[0].phase, Phase::Complete);
        assert!(!a.running());
        // Only one token refresh in all that time.
        assert_eq!(http.count(TOKEN), 1);
    }

    #[test]
    fn reuses_a_broadcast_made_ahead_and_says_why_one_fails() {
        let store = Store::default();
        let mut a = connected_youtube(&store);
        let http = Fake::default();
        token(&http);
        http.fixture(Method::Get, &format!("{YT}/liveStreams"), "yt_streams.json")
            .fixture(
                Method::Get,
                &format!("{YT}/liveBroadcasts"),
                "yt_broadcasts_upcoming.json",
            )
            .fixture(
                Method::Get,
                &format!("{YT}/liveBroadcasts"),
                "yt_error_quota.json",
            );
        // The quota answer is a 403.
        http.routes.borrow_mut().last_mut().unwrap().2.status = 403;
        let made = AccountLink::Youtube(YoutubeLink {
            broadcast_id: "Xq9hFm3kLw0".into(),
            ..YoutubeLink::default()
        });
        let (ready, failed) = a.prepare(
            &http,
            &store,
            &[("a".into(), made.clone()), ("b".into(), made)],
            0,
        );
        // Already bound to Lumora's stream: no bind needed.
        assert_eq!(http.count(&format!("{YT}/liveBroadcasts/bind")), 0);
        assert_eq!(ready.len(), 1);
        assert_eq!(a.sessions()[0].title, "Sunday morning service");
        assert_eq!(failed[0].dest_id, "b");
        assert!(failed[0].error.message.contains("daily limit"));
        // The stream was looked up once and kept.
        assert_eq!(http.count(&format!("{YT}/liveStreams")), 1);
    }

    #[test]
    fn a_refused_access_token_is_refreshed_once() {
        let store = Store::default();
        let mut a = connected_youtube(&store);
        let http = Fake::default();
        token(&http);
        http.on(
            Method::Get,
            &format!("{YT}/liveBroadcasts"),
            401,
            r#"{"error":{"code":401,"errors":[{"reason":"authError"}]}}"#,
        );
        http.on(
            Method::Post,
            TOKEN,
            200,
            r#"{"access_token":"ya29.y","expires_in":3600}"#,
        )
        .fixture(
            Method::Get,
            &format!("{YT}/liveBroadcasts"),
            "yt_broadcasts_upcoming.json",
        );
        let list = a.youtube_broadcasts(&http, &store, 0).unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!(http.count(TOKEN), 2);
        assert_eq!(
            http.sent.borrow().last().unwrap().header("authorization"),
            Some("Bearer ya29.y")
        );
    }

    #[test]
    fn connects_facebook_and_goes_live_on_a_page() {
        let store = Store::default();
        let mut a = Accounts::new(config(), &store);
        let (url, pending) = a
            .begin(Provider::Facebook, &facebook::loopback_redirect())
            .unwrap();
        assert!(url.contains("response_type=token"));
        let http = Fake::default();
        http.fixture(Method::Get, &format!("{FB}/me?"), "fb_me.json");
        let params = facebook::params_from_address(&format!(
            "https://www.facebook.com/connect/login_success.html#access_token=EAAUser&expires_in=5400&state={}",
            pending.state
        ));
        a.complete(&http, &store, &pending, &params, 1000).unwrap();
        let info = a.info();
        assert!(info.facebook.connected);
        assert_eq!(info.facebook.name, "Alex Rivera");
        assert_eq!(info.facebook.expires_at, 6400);
        assert!(store.get(FACEBOOK_SECRET).unwrap().contains("EAAUser"));
        // A new Accounts finds it again.
        assert!(Accounts::new(config(), &store).info().facebook.connected);

        http.fixture(
            Method::Get,
            &format!("{FB}/me/accounts"),
            "fb_accounts.json",
        )
        .fixture(
            Method::Post,
            &format!("{FB}/112233445566778/live_videos"),
            "fb_live_create.json",
        );
        let link = AccountLink::Facebook(FacebookLink {
            target_id: "112233445566778".into(),
            target_name: "Riverside Community Hall".into(),
            settings: LiveSettings {
                title: "Spring concert".into(),
                ..LiveSettings::default()
            },
        });
        let (ready, failed) = a.prepare(&http, &store, &[("fb".into(), link)], 2000);
        assert!(failed.is_empty(), "{failed:?}");
        assert_eq!(ready[0].server, "rtmps://live-api-s.facebook.com:443/rtmp");
        assert_eq!(ready[0].key, "FB-1357924680135792-0-AbzTestKey123");
        // The live video is made with the Page's own token.
        let create = http.sent.borrow().last().cloned().unwrap();
        assert_eq!(
            create.header("authorization"),
            Some("Bearer EAAPageTokenOne")
        );
        http.fixture(
            Method::Get,
            &format!("{FB}/1357924680135792"),
            "fb_live_status.json",
        );
        a.tick(&http, &store, 2015);
        let v = &a.sessions()[0];
        assert_eq!(v.phase, Phase::Live);
        assert_eq!(
            v.watch_url,
            "https://www.facebook.com/112233445566778/videos/2468013579246801/"
        );
        http.on(
            Method::Post,
            &format!("{FB}/1357924680135792"),
            200,
            r#"{"success":true}"#,
        );
        assert!(a.finish(&http, &store, 3000).is_empty());
        assert_eq!(
            http.sent.borrow().last().unwrap().body_text(),
            "end_live_video=true"
        );
        assert_eq!(a.sessions()[0].phase, Phase::Complete);
        // A run-out connection asks to reconnect before making anything.
        let (_, failed) = a.prepare(
            &http,
            &store,
            &[(
                "fb".into(),
                AccountLink::Facebook(FacebookLink {
                    target_id: "me".into(),
                    ..FacebookLink::default()
                }),
            )],
            10_000,
        );
        assert!(failed[0].error.reconnect);
    }

    #[test]
    fn links_are_kept_with_the_destination_as_json() {
        let link = AccountLink::Youtube(YoutubeLink {
            broadcast_id: "b1".into(),
            ..YoutubeLink::default()
        });
        let text = serde_json::to_string(&link).unwrap();
        assert!(
            text.starts_with(r#"{"provider":"youtube","broadcastId":"b1""#),
            "{text}"
        );
        let back: AccountLink =
            serde_json::from_str(r#"{"provider":"facebook","targetId":"me"}"#).unwrap();
        assert_eq!(back.provider(), Provider::Facebook);
    }
}
