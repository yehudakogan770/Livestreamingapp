import json, os, sys

out = sys.argv[1]
F = {}
F["google_token.json"] = {
    "access_token": "ya29.a0-test-access",
    "expires_in": 3599,
    "refresh_token": "1//0g-test-refresh",
    "scope": "https://www.googleapis.com/auth/youtube.force-ssl",
    "token_type": "Bearer",
}
F["yt_channel.json"] = {
    "kind": "youtube#channelListResponse",
    "etag": "f1R7k6wnLx0tO4hQ2s3",
    "pageInfo": {"totalResults": 1, "resultsPerPage": 5},
    "items": [
        {
            "kind": "youtube#channel",
            "etag": "Zc9bq1Vf2Cw",
            "id": "UCx1y2z3RiversideHall",
            "snippet": {
                "title": "Riverside Community Hall",
                "description": "",
                "publishedAt": "2019-03-04T12:00:00Z",
                "thumbnails": {"default": {"url": "https://yt3.ggpht.com/abc=s88", "width": 88, "height": 88}},
            },
        }
    ],
}
F["yt_broadcasts_upcoming.json"] = {
    "kind": "youtube#liveBroadcastListResponse",
    "etag": "pVh0k0x9V1",
    "pageInfo": {"totalResults": 2, "resultsPerPage": 25},
    "items": [
        {
            "kind": "youtube#liveBroadcast",
            "etag": "aa11",
            "id": "Xq9hFm3kLw0",
            "snippet": {
                "publishedAt": "2026-10-01T15:02:11Z",
                "channelId": "UCx1y2z3RiversideHall",
                "title": "Sunday morning service",
                "description": "Join us live.",
                "thumbnails": {
                    "default": {"url": "https://i.ytimg.com/vi/Xq9hFm3kLw0/default_live.jpg", "width": 120, "height": 90},
                    "high": {"url": "https://i.ytimg.com/vi/Xq9hFm3kLw0/hqdefault_live.jpg", "width": 480, "height": 360},
                },
                "scheduledStartTime": "2026-10-11T14:00:00Z",
                "isDefaultBroadcast": False,
                "liveChatId": "KicKGFVDeDF5",
            },
            "status": {
                "lifeCycleStatus": "ready",
                "privacyStatus": "unlisted",
                "recordingStatus": "notRecording",
                "madeForKids": False,
                "selfDeclaredMadeForKids": False,
            },
            "contentDetails": {
                "boundStreamId": "Abc123StreamId",
                "boundStreamLastUpdateTimeMs": "2026-10-01T15:02:12Z",
                "monitorStream": {"enableMonitorStream": True, "broadcastStreamDelayMs": 0, "embedHtml": "<iframe></iframe>"},
                "enableEmbed": True,
                "enableDvr": True,
                "recordFromStart": True,
                "enableClosedCaptions": False,
                "closedCaptionsType": "closedCaptionsDisabled",
                "enableLowLatency": True,
                "latencyPreference": "low",
                "projection": "rectangular",
                "enableAutoStart": False,
                "enableAutoStop": False,
            },
        },
        {
            "kind": "youtube#liveBroadcast",
            "etag": "bb22",
            "id": "Pq7Rs8Tu9Vw",
            "snippet": {
                "publishedAt": "2026-10-02T09:00:00Z",
                "channelId": "UCx1y2z3RiversideHall",
                "title": "Fall festival",
                "description": "",
                "thumbnails": {},
                "scheduledStartTime": "2026-10-18T17:00:00Z",
            },
            "status": {
                "lifeCycleStatus": "created",
                "privacyStatus": "public",
                "recordingStatus": "notRecording",
                "madeForKids": False,
                "selfDeclaredMadeForKids": False,
            },
            "contentDetails": {
                "monitorStream": {"enableMonitorStream": True, "broadcastStreamDelayMs": 0},
                "enableDvr": True,
                "latencyPreference": "normal",
                "enableAutoStart": True,
                "enableAutoStop": True,
            },
        },
    ],
}
F["yt_broadcast_insert.json"] = {
    "kind": "youtube#liveBroadcast",
    "etag": "cc33",
    "id": "New0Broadcast1",
    "snippet": {
        "publishedAt": "2026-10-08T18:29:58Z",
        "channelId": "UCx1y2z3RiversideHall",
        "title": "Spring concert",
        "description": "Live from the hall",
        "thumbnails": {"default": {"url": "https://i.ytimg.com/vi/New0Broadcast1/default_live.jpg", "width": 120, "height": 90}},
        "scheduledStartTime": "2026-10-08T18:30:00Z",
        "isDefaultBroadcast": False,
        "liveChatId": "KicKGFVDeDF6",
    },
    "status": {
        "lifeCycleStatus": "created",
        "privacyStatus": "unlisted",
        "recordingStatus": "notRecording",
        "madeForKids": False,
        "selfDeclaredMadeForKids": False,
    },
    "contentDetails": {
        "monitorStream": {"enableMonitorStream": True, "broadcastStreamDelayMs": 0, "embedHtml": ""},
        "enableEmbed": True,
        "enableDvr": True,
        "recordFromStart": True,
        "enableClosedCaptions": False,
        "latencyPreference": "normal",
        "enableAutoStart": False,
        "enableAutoStop": False,
    },
}
F["yt_streams.json"] = {
    "kind": "youtube#liveStreamListResponse",
    "etag": "dd44",
    "pageInfo": {"totalResults": 2, "resultsPerPage": 50},
    "items": [
        {
            "kind": "youtube#liveStream",
            "etag": "ee55",
            "id": "Old999StreamId",
            "snippet": {"publishedAt": "2024-01-01T00:00:00Z", "channelId": "UCx1y2z3RiversideHall", "title": "Default stream key", "isDefaultStream": False},
            "cdn": {
                "ingestionType": "rtmp",
                "ingestionInfo": {
                    "streamName": "zzzz-zzzz-zzzz-zzzz-zzzz",
                    "ingestionAddress": "rtmp://a.rtmp.youtube.com/live2",
                    "backupIngestionAddress": "rtmp://b.rtmp.youtube.com/live2?backup=1",
                },
                "resolution": "variable",
                "frameRate": "variable",
            },
            "status": {"streamStatus": "inactive", "healthStatus": {"status": "noData"}},
            "contentDetails": {"isReusable": True},
        },
        {
            "kind": "youtube#liveStream",
            "etag": "ff66",
            "id": "Abc123StreamId",
            "snippet": {"publishedAt": "2026-09-01T00:00:00Z", "channelId": "UCx1y2z3RiversideHall", "title": "Lumora", "description": "Made by Lumora.", "isDefaultStream": False},
            "cdn": {
                "ingestionType": "rtmp",
                "ingestionInfo": {
                    "streamName": "abcd-efgh-ijkl-mnop-qrst",
                    "ingestionAddress": "rtmp://a.rtmp.youtube.com/live2",
                    "backupIngestionAddress": "rtmp://b.rtmp.youtube.com/live2?backup=1",
                    "rtmpsIngestionAddress": "rtmps://a.rtmps.youtube.com/live2",
                    "rtmpsBackupIngestionAddress": "rtmps://b.rtmps.youtube.com/live2?backup=1",
                },
                "resolution": "variable",
                "frameRate": "variable",
            },
            "status": {"streamStatus": "ready", "healthStatus": {"status": "noData"}},
            "contentDetails": {"closedCaptionsIngestionUrl": "http://upload.youtube.com/closedcaption?cid=abcd", "isReusable": True},
        },
    ],
}
F["yt_stream_status_active.json"] = {
    "kind": "youtube#liveStreamListResponse",
    "etag": "gg77",
    "pageInfo": {"totalResults": 1, "resultsPerPage": 5},
    "items": [
        {
            "kind": "youtube#liveStream",
            "etag": "hh88",
            "id": "Abc123StreamId",
            "status": {
                "streamStatus": "active",
                "healthStatus": {
                    "status": "bad",
                    "lastUpdateTimeSeconds": "1791484260",
                    "configurationIssues": [
                        {"type": "bitrateLow", "severity": "error", "reason": "Check video settings", "description": "The current bitrate (1500 Kbps) is lower than the recommended bitrate."},
                        {"type": "gopSizeLong", "severity": "info", "reason": "Keyframes", "description": "Keyframe frequency is fine."},
                    ],
                },
            },
        }
    ],
}
F["yt_error_quota.json"] = {
    "error": {
        "code": 403,
        "message": "The request cannot be completed because you have exceeded your <a href=\"/youtube/v3/getting-started#quota\">quota</a>.",
        "errors": [{"message": "The request cannot be completed because you have exceeded your quota.", "domain": "youtube.quota", "reason": "quotaExceeded"}],
    }
}
F["yt_error_not_enabled.json"] = {
    "error": {
        "code": 403,
        "message": "The user is not enabled for live streaming.",
        "errors": [
            {"message": "The user is not enabled for live streaming.", "domain": "youtube.liveBroadcast", "reason": "liveStreamingNotEnabled", "extendedHelp": "https://support.google.com/youtube/answer/2474026"}
        ],
    }
}
F["fb_me.json"] = {"id": "10229876543210", "name": "Alex Rivera"}
F["fb_accounts.json"] = {
    "data": [
        {
            "access_token": "EAAPageTokenOne",
            "category": "Community",
            "category_list": [{"id": "2612", "name": "Community"}],
            "name": "Riverside Community Hall",
            "id": "112233445566778",
            "tasks": ["ADVERTISE", "ANALYZE", "CREATE_CONTENT", "MESSAGING", "MODERATE", "MANAGE"],
        },
        {"access_token": "EAAPageTokenTwo", "category": "Musician/band", "name": "Weekend Band", "id": "998877665544332", "tasks": ["ANALYZE"]},
    ],
    "paging": {"cursors": {"before": "QVFIUm", "after": "QVFIUn"}},
}
F["fb_live_create.json"] = {
    "id": "1357924680135792",
    "stream_url": "rtmp://live-api-s.facebook.com:80/rtmp/FB-1357924680135792-0-AbzTestKey123",
    "secure_stream_url": "rtmps://live-api-s.facebook.com:443/rtmp/FB-1357924680135792-0-AbzTestKey123",
}
F["fb_live_status.json"] = {
    "status": "LIVE",
    "permalink_url": "/112233445566778/videos/2468013579246801/",
    "ingest_streams": {"data": [{"stream_health": {"video_bitrate": 5987000, "video_framerate": 30}, "is_master": True}]},
    "id": "1357924680135792",
}
F["fb_error_token.json"] = {
    "error": {
        "message": "Error validating access token: Session has expired on Thursday, 08-Oct-26 10:00:00 PDT.",
        "type": "OAuthException",
        "code": 190,
        "error_subcode": 463,
        "fbtrace_id": "AbCdEf123",
    }
}
os.makedirs(out, exist_ok=True)
for name, v in F.items():
    with open(os.path.join(out, name), "w") as f:
        json.dump(v, f, indent=2, ensure_ascii=False)
        f.write("\n")
print(len(F))
