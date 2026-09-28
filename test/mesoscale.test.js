const test = require('node:test');
const assert = require('node:assert/strict');
const md = require('../mesoscale');

const official = `Mesoscale Discussion 2331
Concerning...Severe potential...Watch unlikely
Valid 282149Z - 282245Z
Probability of Watch Issuance...5 percent
SUMMARY...A localized risk of damaging wind gusts and a tornado is possible
across parts of the discussion area during the next hour.
DISCUSSION...Meteorological details follow.
NNNN`;

test('SPC summary and watch probability retain their scope', () => {
  const parsed = md.parse(official,'MD 2331','https://www.spc.noaa.gov/products/md/md2331.txt');
  assert.equal(parsed.summary,'A localized risk of damaging wind gusts and a tornado is possible across parts of the discussion area during the next hour.');
  assert.equal(parsed.watchProbability,5);
  assert.match(md.segments(parsed,'Fargo, North Dakota').join(' '),/chance of a watch.*discussion area/i);
  assert.doesNotMatch(md.segments(parsed,'Fargo, North Dakota',{warning:true}).join(' '),/5 percent|localized risk/i);
});

test('unparseable or incomplete discussions do not create forecast claims', () => {
  assert.equal(md.parse('Error page','MD 2331','url'),null);
  assert.equal(md.parse('Mesoscale Discussion 2331\nDISCUSSION...No summary','MD 2331','url'),null);
});
