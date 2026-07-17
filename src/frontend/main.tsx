import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.js';
import { installPreloadErrorRecovery } from './preloadErrorRecovery.js';
import './index.css';

installPreloadErrorRecovery();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
