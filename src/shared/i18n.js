'use strict';
// Translation, gettext style: the English text in the code is the key. A locale file (src/locales/<code>.json) maps
// English to another language; a text it does not have is shown in English. {name} marks a value to fill in.
// Loaded by the pages with a <script> tag and by the main process with require().
(function (root) {
  // On a Mac, "PC" in any text reads "Mac" (in every language), except where a text already names both ("PC or Mac").
  const forMac = s => (/\bMac\b/.test(s) ? s : s.replace(/\bPC\b/g, 'Mac'));
  function makeT(strings, options) {
    const table = strings && typeof strings === 'object' ? strings : {}, mac = Boolean(options && options.mac);
    return function t(text, values) {
      let found = typeof table[text] === 'string' && table[text] ? table[text] : text;
      if (mac) found = forMac(found);
      return values ? found.replace(/\{(\w+)\}/g, (whole, key) => (key in values ? String(values[key]) : whole)) : found;
    };
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { makeT }; else root.makeT = makeT;
})(typeof window !== 'undefined' ? window : globalThis);
