import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { lockDown } from '../../../app/src/engine/lockdown';
import '../../../app/src/styles.css';
import './editor.css';

lockDown(['s', 'p']);

const root = document.getElementById('root');
if (!root) throw new Error('Lumora Edit: #root element missing from index.html');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
