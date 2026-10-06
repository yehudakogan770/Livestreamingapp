import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { lockDown } from '../../../app/src/engine/lockdown';
import { installRangeFill } from '../../../app/src/rangeFill';
import { installErrorReporting, reactError } from '../../../app/src/reports/reporter';
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

// First, so nothing that goes wrong while starting is missed.
installErrorReporting('studio');
lockDown(['s', 'p']);
installRangeFill();

const root = document.getElementById('root');
if (!root) throw new Error('Lumora Studio: #root element missing from index.html');

createRoot(root, { onCaughtError: reactError, onUncaughtError: reactError }).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
