import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const componentSource = readFileSync(new URL('../../src/features/dashboard/components/RecentConversationsTable.jsx', import.meta.url), 'utf8');
const dashboardCss = readFileSync(new URL('../../src/styles/pages/dashboard.css', import.meta.url), 'utf8');

test('recent dashboard table uses short semantic labels without status decorations', () => {
  // Rótulos de status/responsável calculados em utils/recentConversations.js (Humano, IA ativa, Finalizada,
  // Assistente), cobertos por tests/features/recentConversationsP4B.test.js.
  assert.match(componentSource, /resolveRecentConversationRow\(/);
  assert.doesNotMatch(componentSource, /recent-compact-pill/);
  assert.doesNotMatch(componentSource, /status-line-dot/);
  assert.match(componentSource, /className={`recent-status-text tone-/);
  assert.match(componentSource, /className="recent-owner-text"/);
});

test('recent dashboard messages use a compact origin and restrained visual hierarchy', () => {
  assert.match(componentSource, /className={`recent-message-origin origin-/);
  assert.match(componentSource, /className="recent-message-separator"/);
  assert.doesNotMatch(componentSource, /recent-sender-tag/);
  assert.match(dashboardCss, /\.recent-row\s*\{[^}]*column-gap:\s*20px;/s);
  assert.match(dashboardCss, /\.recent-message-snippet\s*\{[^}]*max-width:\s*180px;[^}]*font-size:\s*12px;[^}]*color:\s*#cbd5e1;/s);
  assert.match(dashboardCss, /\.recent-owner-text\s*\{[^}]*font-weight:\s*500;[^}]*color:\s*#cbd5e1;/s);
  assert.match(dashboardCss, /\.recent-th\s*\{[^}]*color:\s*#94a3b8;/s);
  assert.match(dashboardCss, /\.recent-timestamp\s*\{[^}]*color:\s*#94a3b8;/s);
});
