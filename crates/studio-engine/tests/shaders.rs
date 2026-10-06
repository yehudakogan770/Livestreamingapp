//! Every program the editor draws with converts and passes naga's checks.
use studio_engine::glsl::{convert, module, Stage};

#[derive(serde::Deserialize)]
struct Program {
    name: String,
    vs: String,
    fs: String,
}

#[test]
fn every_editor_program_translates() {
    let programs: Vec<Program> = serde_json::from_str(include_str!("programs.json")).unwrap();
    assert!(programs.len() > 30);
    let mut failed = Vec::new();
    for p in &programs {
        let c = match convert(&p.vs, &p.fs) {
            Ok(c) => c,
            Err(e) => {
                failed.push(format!("{}: {e}", p.name));
                continue;
            }
        };
        if let Err(e) = module(&c.vertex, Stage::Vertex) {
            failed.push(format!("{} (vertex): {e}", p.name));
        }
        if let Err(e) = module(&c.fragment, Stage::Fragment) {
            failed.push(format!("{} (fragment): {e}", p.name));
        }
    }
    assert!(failed.is_empty(), "{}", failed.join("\n"));
}

/// A message the editor's TypeScript wrote (editor/app/src/render/native/client.test.ts).
#[test]
fn reads_a_frame_the_editor_wrote() {
    use studio_engine::plan::{decode, TexRef, UploadKind};
    let m = decode(include_bytes!("frame.bin").to_vec()).unwrap();
    let f = &m.frame;
    assert_eq!(
        (f.frame, f.w, f.h, f.out, f.now),
        (42, 64, 36, Some(1), true)
    );
    assert_eq!(f.passes.len(), 3);
    assert_eq!(f.passes[0].k, 0);
    assert_eq!(f.passes[1].p.as_deref(), Some("layer"));
    assert_eq!(
        TexRef::parse(&f.passes[1].x["uTex"]).unwrap(),
        TexRef::Video(0)
    );
    assert_eq!(f.passes[1].q.as_ref().map(Vec::len), Some(24));
    assert_eq!(f.passes[2].u["uOpacity"], vec![0.5]);
    assert_eq!(f.videos[0].path, "/clip.mov");
    assert!((f.videos[0].time - 1.5).abs() < 1e-12);
    assert_eq!(f.uploads[0].kind, UploadKind::Raw);
    assert!(m.data(&f.uploads[0]).iter().all(|&b| b == 9));
    assert_eq!(f.free, vec!["text:x|0".to_owned()]);
}
