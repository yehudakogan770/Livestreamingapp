import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { lockDown } from '../../../app/src/engine/lockdown';
import '../../../app/src/styles.css';
import './editor.css';
// Fonts for words on the picture (the Windows fonts are there already).
import '@fontsource/bebas-neue/400.css';
import '@fontsource/heebo/400.css';
import '@fontsource/heebo/700.css';
import '@fontsource/frank-ruhl-libre/400.css';
import '@fontsource/frank-ruhl-libre/700.css';
import '@fontsource/david-libre/400.css';
import '@fontsource/great-vibes/400.css';
import '@fontsource/chakra-petch/400.css';
import '@fontsource/chakra-petch/700.css';

lockDown(['s', 'p']);

const root = document.getElementById('root');
if (!root) throw new Error('Lumora Edit: #root element missing from index.html');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
