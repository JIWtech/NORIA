import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const landingSource = readFileSync(new URL('../../src/LandingPage.jsx', import.meta.url), 'utf8');
const landingCss = readFileSync(new URL('../../src/landing.css', import.meta.url), 'utf8');

test('landing page defines NORIA tenant WhatsApp contact URL', () => {
  assert.match(
    landingSource,
    /const WHATSAPP_CONTACT_URL = 'https:\/\/wa\.me\/5521993614704\?text=[^']+';/,
  );
});

test('landing page includes WhatsApp CTA in final section and floating button without inner dot', () => {
  assert.match(landingSource, /className="lp-final-actions"[\s\S]*?href=\{WHATSAPP_CONTACT_URL\}/);
  assert.match(landingSource, /className="lp-whatsapp-fab"/);
  assert.match(landingSource, /aria-label="Falar com a NORIA no WhatsApp"/);
  assert.doesNotMatch(landingSource, /lp-whatsapp-fab-dot/);
});

test('landing CSS styles the green floating WhatsApp CTA with border pulse effect', () => {
  assert.match(landingCss, /\.lp-whatsapp-fab\s*\{[^}]*position:\s*fixed/s);
  assert.match(landingCss, /\.lp-whatsapp-fab::before\s*\{/s);
  assert.match(landingCss, /@keyframes\s+lp-wa-border-pulse/);
});

test('external WhatsApp links and handlers enforce noopener, noreferrer, and no-referrer', () => {
  const externalLinks = landingSource.match(/<a[^>]+href=\{WHATSAPP_CONTACT_URL\}[^>]*>/g) ?? [];
  assert.equal(externalLinks.length, 3);
  for (const linkTag of externalLinks) {
    assert.match(linkTag, /target="_blank"/);
    assert.match(linkTag, /rel="noopener noreferrer"/);
    assert.match(linkTag, /referrerPolicy="no-referrer"/);
  }
  assert.match(landingSource, /window\.open\(WHATSAPP_CONTACT_URL,\s*'_blank',\s*'noopener,noreferrer'\)/);
});
