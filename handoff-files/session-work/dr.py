import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-ac66441c90a567d82')
def rep(p, old, new):
    s = open(p).read()
    assert old in s, (p, old)
    s = s.replace(old, new, 1)
    open(p, 'w').write(s)

rep('crates/engine/src/lib.rs', "pub mod chat;\n", "pub mod chat;\npub mod drawing;\n")
rep('crates/engine/src/model.rs', """    /// A live chat comment shown on screen.
    Comment(Box<crate::chat::CommentCard>),""", """    /// A live chat comment shown on screen.
    Comment(Box<crate::chat::CommentCard>),
    /// Lines and arrows drawn over the picture (a telestrator).
    Drawing(Box<crate::drawing::Drawing>),""")
rep('crates/engine/src/action.rs', """    /// Change how a comment input looks.
    UpdateCommentCard {""", """    /// Draw a line (or a dot, or an arrow) on a drawing input.
    DrawStroke {
        id: SourceId,
        stroke: crate::drawing::Stroke,
    },
    /// Take the last line off a drawing input.
    DrawUndo { id: SourceId },
    /// Take every line off a drawing input.
    DrawClear { id: SourceId },
    /// Change how a comment input looks.
    UpdateCommentCard {""")
rep('crates/engine/src/engine.rs', """        Action::UpdateCommentCard { id, place, accent } => {""", """        Action::DrawStroke { id, stroke } => {
            drawing_mut(s, &id)?.add(stroke, now);
            Ok(())
        }
        Action::DrawUndo { id } => {
            drawing_mut(s, &id)?.undo(now);
            Ok(())
        }
        Action::DrawClear { id } => {
            drawing_mut(s, &id)?.clear(now);
            Ok(())
        }
        Action::UpdateCommentCard { id, place, accent } => {""")
rep('crates/engine/src/engine.rs', """fn comment_mut<'a>(s: &'a mut Show, id: &SourceId) -> Result<&'a mut crate::chat::CommentCard> {""", """fn drawing_mut<'a>(s: &'a mut Show, id: &SourceId) -> Result<&'a mut crate::drawing::Drawing> {
    let src = s
        .source_mut(id)
        .ok_or_else(|| ActionError::UnknownSource { id: id.clone() })?;
    match &mut src.kind {
        SourceKind::Drawing(d) => Ok(d),
        _ => Err(ActionError::invalid("id", "that input is not for drawing")),
    }
}

fn comment_mut<'a>(s: &'a mut Show, id: &SourceId) -> Result<&'a mut crate::chat::CommentCard> {""")
rep('crates/engine/src/engine.rs', """        SourceKind::Comment(c) => c.repair(),
        SourceKind::Raffle(r) => {""", """        SourceKind::Comment(c) => c.repair(),
        SourceKind::Drawing(d) => d.repair(),
        SourceKind::Raffle(r) => {""")
rep('crates/engine/src/persist.rs', """            SourceKind::Comment(c) => c.repair(),""", """            SourceKind::Comment(c) => c.repair(),
            SourceKind::Drawing(d) => d.repair(),""")
rep('crates/seats/src/role.rs', """        | A::ShowComment { .. }
        | A::UpdateCommentCard { .. }""", """        | A::ShowComment { .. }
        | A::UpdateCommentCard { .. }
        | A::DrawStroke { .. }
        | A::DrawUndo { .. }
        | A::DrawClear { .. }""")
