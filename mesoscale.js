/* Official SPC mesoscale discussion text, kept separate for parsing tests. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.StormVectorMesoscale = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';

  function field(text, name, next) {
    const match = String(text).match(new RegExp(`(?:^|\\n)${name}\\.\\.\\.([\\s\\S]*?)(?=\\n(?:${next})\\.\\.\\.|$)`, 'i'));
    return match?.[1]?.replace(/\s+/g, ' ').trim() || '';
  }

  function parse(text, name, url) {
    const source = String(text || '');
    const summary = field(source, 'SUMMARY', 'DISCUSSION|NNNN');
    if (!summary || !/Mesoscale Discussion\s+\d+/i.test(source)) return null;
    const concerning = source.match(/(?:^|\n)Concerning\.{3}([^\n]+)/i)?.[1]?.trim() || '';
    const watch = source.match(/Probability of Watch Issuance\.{3}\s*(\d{1,3})\s*percent/i);
    return {
      name: String(name || source.match(/Mesoscale Discussion\s+\d+/i)?.[0] || 'SPC mesoscale discussion'),
      summary,
      concerning,
      watchProbability: watch ? Number(watch[1]) : null,
      url
    };
  }

  function segments(md, place, {warning = false} = {}) {
    if (!md) return [];
    const location = place || 'your area';
    if (warning) return [
      `The Storm Prediction Center also has ${md.name} covering ${location}. The active National Weather Service warning remains the priority; keep following its instructions.`
    ];
    const lines = [
      `The Storm Prediction Center has ${md.name} covering ${location}. A mesoscale discussion describes developing weather; it is not a warning.`
    ];
    if (md.summary) lines.push(`Their summary says: ${md.summary}`);
    if (!warning && md.watchProbability != null) {
      lines.push(`The discussion gives a ${md.watchProbability} percent chance of a watch being issued for its discussion area. That does not mean the chance of a storm at your exact location.`);
    }
    return lines;
  }

  return {parse,segments};
});
