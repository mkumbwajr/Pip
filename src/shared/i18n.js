'use strict';
// Translation, gettext style: the English text in the code is the key. A locale file (src/locales/<code>.json) maps
// English to another language; a text it does not have is shown in English. {name} marks a value to fill in.
// Loaded by the pages with a <script> tag and by the main process with require().
(function (root) {
  function makeT(strings) {
    const table = strings && typeof strings === 'object' ? strings : {};
    return function t(text, values) {
      const found = typeof table[text] === 'string' && table[text] ? table[text] : text;
      return values ? found.replace(/\{(\w+)\}/g, (whole, key) => (key in values ? String(values[key]) : whole)) : found;
    };
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { makeT }; else root.makeT = makeT;
})(typeof window !== 'undefined' ? window : globalThis);
