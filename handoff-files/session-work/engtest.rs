
#[cfg(test)]
mod tests {
    use super::*;
    use crate::scene::{Content, Layer, Picture, Placement};

    #[test]
    fn auto_framed_pictures_take_their_shot_wherever_they_show() {
        let pic = |id: &str| Picture {
            content: Content::Video(SourceId::new(id)),
            placement: Placement::default(),
        };
        let layer = Layer {
            source: SourceId::new("split"),
            pictures: vec![pic("a"), pic("b")],
            opacity: 1.0,
            shift: [0.0, 0.0],
            scale: 1.0,
            blur: 0.0,
            shape: crate::mix::Shape::Whole,
            luma: None,
            top: false,
        };
        let sc = ScreenScene {
            layers: vec![layer.clone()],
            overlays: vec![layer],
            ..ScreenScene::default()
        };
        let shots = HashMap::from([(SourceId::new("a"), (2.0, -1.0, 0.5))]);
        let sc = framed(sc, &shots);
        for l in sc.layers.iter().chain(&sc.overlays) {
            assert_eq!(
                (l.pictures[0].placement.zoom, l.pictures[0].placement.pan),
                (2.0, [-1.0, 0.5])
            );
            assert_eq!(l.pictures[1].placement, Placement::default());
        }
    }
}
