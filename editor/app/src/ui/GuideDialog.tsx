// Help > Help topics: a searchable list of topics on the left, the chosen
// topic on the right.
import { useState } from 'react';
import { Modal } from './controls';
import { GUIDE, searchGuide } from './guide';

export function GuideDialog({ onClose, start }: { onClose: () => void; start?: string }) {
  const [query, setQuery] = useState('');
  const [id, setId] = useState(start ?? GUIDE[0]?.id ?? '');
  const found = searchGuide(query);
  const topic = found.find((t) => t.id === id) ?? found[0];
  return (
    <Modal title="Help topics" onClose={onClose} wide>
      <div className="guide">
        <nav className="guide__list" aria-label="Topics">
          <input className="text" type="search" placeholder="Search help" aria-label="Search help" value={query} onChange={(e) => setQuery(e.target.value)} />
          {found.map((t) => (
            <button key={t.id} type="button" className={t.id === topic?.id ? 'is-on' : ''} aria-current={t.id === topic?.id} onClick={() => setId(t.id)}>
              {t.title}
            </button>
          ))}
          {!found.length && <p className="guide__none">Nothing matches “{query}”.</p>}
        </nav>
        {topic && (
          <article className="guide__topic" aria-label={topic.title}>
            <h3>{topic.title}</h3>
            <p className="guide__where">{topic.where}</p>
            {topic.paragraphs.map((p) => (
              <p key={p}>{p}</p>
            ))}
          </article>
        )}
      </div>
    </Modal>
  );
}
