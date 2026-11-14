'use strict';
// Peep's own line icons, drawn for this app. 24-unit grid, stroked with the current text colour.
(() => {
  const P = {
    home: '<path d="M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z"/>',
    ai: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M7 10l3 2-3 2M12.5 15H17"/>',
    ask: '<rect x="4" y="5" width="16" height="14" rx="5"/><path d="M10 10.5v2.5M14 10.5v2.5"/>',
    music: '<path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>',
    focus: '<circle cx="12" cy="13.5" r="7"/><path d="M12 13.5V10M10 3h4M18.4 6.6L17 8"/>',
    modes: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
    tray: '<path d="M4 13l2.5-7h11L20 13v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z"/><path d="M4 13h4.5l1 2h5l1-2H20"/>',
    clips: '<rect x="6" y="5" width="12" height="15" rx="2"/><path d="M9.5 3.5h5v3h-5z"/>',
    note: '<path d="M6 3.5h9l3.5 3.5v13.5H6z"/><path d="M9 11h6M9 15h4"/>',
    calendar: '<rect x="4" y="5.5" width="16" height="14.5" rx="2.5"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/>',
    volume: '<path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z"/><path d="M15.5 9.5a3.5 3.5 0 0 1 0 5M18 7a7 7 0 0 1 0 10"/>',
    dots: '<circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none"/>',
    work: '<rect x="3.5" y="7.5" width="17" height="12" rx="2"/><path d="M9 7.5V5h6v2.5M3.5 12.5h17"/>',
    study: '<path d="M4 5.5h6a2 2 0 0 1 2 2V20a2 2 0 0 0-2-2H4zM20 5.5h-6a2 2 0 0 0-2 2V20a2 2 0 0 1 2-2h6z"/>',
    sleep: '<path d="M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5z"/>',
    game: '<path d="M7 8h10a4 4 0 0 1 4 4v1a3.5 3.5 0 0 1-6.3 2.1L14 14h-4l-.7 1.1A3.5 3.5 0 0 1 3 13v-1a4 4 0 0 1 4-4z"/><path d="M7.5 11v3M6 12.5h3"/>',
    shield: '<path d="M12 3.5l7 2.5v5.5c0 4.4-3 7.6-7 9-4-1.4-7-4.6-7-9V6z"/>',
    bell: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15z"/><path d="M10 20.5h4"/>',
    prev: '<path d="M6 5v14"/><path d="M19 5.5L9.5 12l9.5 6.5z" fill="currentColor"/>',
    next: '<path d="M18 5v14"/><path d="M5 5.5l9.5 6.5L5 18.5z" fill="currentColor"/>',
    play: '<path d="M8 5v14l11-7z" fill="currentColor"/>',
    pause: '<path d="M8.5 5.5v13M15.5 5.5v13" stroke-width="3.4"/>',
    lyrics: '<path d="M4 6.5h16M4 11.5h11M4 16.5h7"/><circle cx="18" cy="17" r="2"/><path d="M20 17V11"/>',
    mail: '<rect x="3.5" y="5.5" width="17" height="13" rx="2.5"/><path d="M4.5 7l7.5 6 7.5-6"/>',
    apps: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.8"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.8"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.8"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.8"/>',
    pencil: '<path d="M14.5 5.5l4 4L8 20H4v-4z"/><path d="M12.5 7.5l4 4"/>',
    refresh: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 4.5v4h-4"/>',
    up: '<path d="M6 14.5l6-6 6 6"/>',
    power: '<path d="M12 3.5v8"/><path d="M7 6.5a7.5 7.5 0 1 0 10 0"/>',
    back: '<path d="M14.5 6l-6 6 6 6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    wifi: '<path d="M2.5 9.2a14 14 0 0 1 19 0M5.6 12.6a9.4 9.4 0 0 1 12.8 0M8.8 16a4.6 4.6 0 0 1 6.4 0"/><circle cx="12" cy="19.3" r="1.1" fill="currentColor" stroke="none"/>',
    bt: '<path d="M7 7.5l10 9-5 4.5V3l5 4.5-10 9"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6"/>',
    pip: '<rect x="3.5" y="5" width="17" height="15" rx="5.5" fill="currentColor" stroke="none"/><rect x="8.6" y="9.6" width="2" height="4.4" rx="1" fill="#000" stroke="none"/><rect x="13.4" y="9.6" width="2" height="4.4" rx="1" fill="#000" stroke="none"/>',
    send: '<path d="M4 12l16-7-7 16-2-7z"/>',
    phone: '<rect x="7" y="3" width="10" height="18" rx="2.5"/><path d="M11 17.5h2"/>'
  };
  window.googleG = () => '<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.2l7.9 6.2C12.5 13.6 17.8 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.8c4.3-4 6.9-9.9 6.9-17.2z"/><path fill="#FBBC05" d="M10.6 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.2C1 16.6 0 20.2 0 24s1 7.4 2.7 10.8l7.9-6.2z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.8c-2.1 1.4-4.8 2.3-8.5 2.3-6.2 0-11.5-4.1-13.4-9.9l-7.9 6.2C6.6 42.6 14.6 48 24 48z"/></svg>';
  window.icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;
})();
