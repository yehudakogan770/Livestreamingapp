import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { lockDown } from './engine/lockdown';
import { installRangeFill } from './rangeFill';
import { installErrorReporting, reactError } from './reports/reporter';
import './styles.css';
// Lumora's own type: Inter for the controls, JetBrains Mono for times and numbers.
import '@fontsource-variable/inter/wght.css';
import '@fontsource-variable/jetbrains-mono/wght.css';
// Fonts for words on screen (Hebrew and English), bundled so they work offline.
import '@fontsource/frank-ruhl-libre/700.css';
import '@fontsource/frank-ruhl-libre/400.css';
import '@fontsource/david-libre/700.css';
import '@fontsource/david-libre/400.css';
import '@fontsource/heebo/700.css';
import '@fontsource/heebo/400.css';
// The words on the stage visuals.
import '@fontsource/chakra-petch/700.css';
import '@fontsource/bebas-neue/400.css';
import '@fontsource/great-vibes/400.css';

// First, so nothing that goes wrong while starting is missed.
installErrorReporting('lumora');
lockDown();
// Sliders draw their filled part from a --val property; keep it current.
installRangeFill();

const root = document.getElementById('root');
if (!root) throw new Error('Lumora: #root element missing from index.html');

createRoot(root, { onCaughtError: reactError, onUncaughtError: reactError }).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
