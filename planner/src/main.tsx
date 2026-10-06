import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { listenForInstall, registerServiceWorker } from './pwa';
import { UpdateBar } from './PwaBars';
import './planner.css';

listenForInstall();
if (import.meta.env.PROD) registerServiceWorker();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <UpdateBar />
  </StrictMode>,
);
