import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { watchDevice } from './device';
import { listenForInstall, registerServiceWorker } from './pwa';
import { UpdateBar } from './PwaBars';
import './planner.css';

// Phone, tablet or computer, on <html> before anything is drawn (the styles depend on it).
watchDevice();
listenForInstall();
if (import.meta.env.PROD) registerServiceWorker();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <UpdateBar />
  </StrictMode>,
);
