import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { AppErrorBoundary } from './app/AppErrorBoundary';

if (import.meta.hot) {
  import.meta.hot.on('vite:ws:disconnect', () => {
    console.debug('[Vite] WebSocket disconnected in background tab. Auto full-reload intercepted.');
  });
}
import '@fontsource-variable/manrope';
import './styles/base/tokens.css';
import './styles/base/reset.css';
import './styles/layout/shell-sidebar.css';

import './styles/layout/topbar.css';
import './styles/layout/mobile-nav.css';
import './styles/components/controls.css';
import './styles/components/noria-select.css';
import './styles/components/dashboard-table.css';

import './styles/pages/dashboard.css';
import './styles/pages/conversations-legacy.css';
import './styles/components/audio-player.css';
import './styles/components/media-viewer.css';
import './styles/pages/conversations-responsive.css';

import './styles/pages/auth.css';
import './styles/pages/kanban.css';
import './styles/pages/broadcasts.css';

import './styles/pages/appointments.css';
import './styles/pages/agents.css';
import './styles/pages/settings.css';
import './styles/components/modals.css';

import './styles/layout/responsive-global.css';
import './styles/pages/dashboard-responsive.css';
import './styles/pages/kanban-responsive.css';
import './styles/components/skeletons.css';
import './styles/components/attachments-location.css';

import './styles.css';
import './conversations.css';
import './styles/components/stage-tones.css';
import './styles/components/appointment-outcome.css';
import './landing.css';

createRoot(document.getElementById('root')).render(
  <AppErrorBoundary><App /></AppErrorBoundary>,
);
