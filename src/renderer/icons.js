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
    phone: '<rect x="7" y="3" width="10" height="18" rx="2.5"/><path d="M11 17.5h2"/>'
  };
  window.icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;
})();
