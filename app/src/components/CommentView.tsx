import type { CSSProperties } from 'react';
import type { CommentCard } from '../engine/types/CommentCard';
import { isRtl } from '../engine/text';
import './CommentView.css';

export const PLATFORM_NAME = { youtube: 'YouTube', twitch: 'Twitch', other: '' } as const;

/** A chat comment on screen: the viewer's name and words on a card. Mirrored in compositor.ts comment(). */
export function CommentView({ c }: { c: CommentCard }) {
  const m = c.comment;
  return (
    <div className={`cmt cmt--${c.place}`} data-kind="comment">
      {m && (
        <div key={c.changedAt} className="cmt__card" style={{ '--cmt-accent': c.accent } as CSSProperties} dir={isRtl(m.text) ? 'rtl' : 'ltr'}>
          <div className="cmt__head">
            <span className="cmt__avatar">{[...m.author.trim()][0]?.toUpperCase() ?? '?'}</span>
            <span className="cmt__name">{m.author}</span>
            {PLATFORM_NAME[m.platform] && <span className="cmt__via">{PLATFORM_NAME[m.platform]}</span>}
          </div>
          <div className="cmt__text">{m.text}</div>
        </div>
      )}
    </div>
  );
}
