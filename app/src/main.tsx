import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';
// Fonts for words on screen (Hebrew and English), bundled so they work offline.
import '@fontsource/frank-ruhl-libre/700.css';
import '@fontsource/frank-ruhl-libre/400.css';
import '@fontsource/david-libre/700.css';
import '@fontsource/david-libre/400.css';
import '@fontsource/heebo/700.css';
import '@fontsource/heebo/400.css';

const root = document.getElementById('root');
if (!root) throw new Error('Lumora: #root element missing from index.html');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
