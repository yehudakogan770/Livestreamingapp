//! Going live on YouTube and Facebook through a connected account, instead of
//! copying a stream key by hand.
//!
//! - **Connecting** an account uses OAuth 2.0 for installed apps: the system
//!   browser opens the provider's sign-in page and comes back to a small web
//!   server on this computer (`loopback`). YouTube uses PKCE (`pkce`, `oauth`);
//!   Facebook Login for desktop apps hands the token back in the address
//!   (`facebook`). Only the long-lived token is kept, in the operating system's
//!   credential store (the `Secrets` the app passes in); access tokens stay in
//!   memory.
//! - **Going live** (`service`): when Lumora's stream starts, each connected
//!   destination is prepared: YouTube gets (or makes) its broadcast, binds it to
//!   Lumora's reusable stream and hands back the RTMPS ingest address and key;
//!   Facebook makes a live video and hands back its secure stream address.
//!   While Lumora streams, the stream's health is checked and the broadcast is
//!   moved through testing to live (unless YouTube starts it by itself). When
//!   the operator stops, the broadcast is completed and the Facebook video
//!   ended.
//!
//! Nothing here talks to the network directly: requests are built as data
//! (`Request`) and sent through the `Http` the app passes in, so every request
//! and every answer can be checked in tests with recorded answers.

pub mod facebook;
mod http;
pub mod loopback;
pub mod oauth;
pub mod pkce;
pub mod service;
pub mod time;
pub mod youtube;

pub use http::{
    encode, parse_query, query, AccountError, Http, Method, Request, Response, Secrets,
};
