const test = require('node:test');
const assert = require('node:assert/strict');
const brief = require('../broadcast-library.js');

const fair = {
  cityState:'Waupun, Wisconsin',tempF:72,feelsF:72,wcode:1,windSpd:4,
  alerts:[],alertsAvailable:true,
  forecast:{today:'Mostly sunny, with a high near 75.',tonight:'Mostly clear, with a low around 52.',tomorrow:'Sunny, with a high near 76.'}
};

test('normal coverage rotates through current, tonight, and tomorrow', () => {
  const first = brief.normalSegments(fair,{loop:0}).join(' ');
  const tonight = brief.normalSegments(fair,{loop:1}).join(' ');
  const tomorrow = brief.normalSegments(fair,{loop:2}).join(' ');
  assert.match(first,/Mostly sunny/);
  assert.match(tonight,/Mostly clear/);
  assert.match(tomorrow,/Sunny, with a high near 76/);
  assert.notEqual(first,tonight);
  assert.match(first,/comfortable|pleasant|good|cooperative|easy/i);
});

test('warning coverage uses only official motion and specific city arrival', () => {
  const alert = {properties:{
    event:'Severe Thunderstorm Warning',areaDesc:'Dodge County; Fond du Lac County',
    description:'At 3:10 PM, a severe storm was located near Beaver Dam, moving NE at 35 MPH. Waupun around 3:45 PM.',
    parameters:{maxWindGust:['60 MPH'],maxHailSize:['1.00']},
    ends:'2026-09-28T21:00:00Z'
  }};
  const text = brief.severeSegments(fair,alert,{loop:0,safety:'Move indoors now.'}).join(' ');
  assert.match(text,/Waupun.*3:45 PM/);
  assert.match(text,/northeast.*35 miles per hour/);
  assert.match(text,/wind gusts up to 60/);
  assert.match(text,/Move indoors now/);
  assert.doesNotMatch(text,/Mostly sunny|Mostly clear|tomorrow/i);
});

test('NWS compact arrival clocks are spoken as clock times', () => {
  const alert = {properties:{description:'Waupun around 345 PM CDT. Moving east at 25 mph.'}};
  assert.equal(brief.officialArrival(alert,'Waupun, Wisconsin'),'3:45 PM');
  assert.equal(brief.officialArrival(alert,'Fond du Lac, Wisconsin'),null);
});

test('watch coverage stays on preparation and omits fair-weather forecast', () => {
  const alert = {properties:{event:'Tornado Watch',areaDesc:'Dodge County',ends:'2026-09-28T23:00:00Z'}};
  const text = brief.watchSegments(fair,alert,{loop:1}).join(' ');
  assert.match(text,/Tornado Watch/);
  assert.match(text,/warnings|warning/i);
  assert.doesNotMatch(text,/Mostly sunny|comfortable|tomorrow/i);
});

test('no fabricated arrival or storm motion from polygon and expiration alone', () => {
  const alert = {properties:{event:'Tornado Warning',areaDesc:'Dodge County',
    description:'A tornado warning is in effect.',ends:'2026-09-28T21:00:00Z'}};
  const text = brief.severeSegments(fair,alert,{loop:0,safety:'Take shelter now.'}).join(' ');
  assert.match(text,/no specific arrival time|cannot put an exact arrival time|does not give a reliable arrival time/i);
  assert.doesNotMatch(text,/miles per hour|moving northeast|Mostly sunny/);
});

test('unavailable alert feed is called out without routine forecast in warning mode', () => {
  const alert = {properties:{event:'Flash Flood Warning',areaDesc:'Dodge County',description:'Heavy rain continues.'}};
  const text = brief.severeSegments({...fair,alertsAvailable:false},alert,{loop:2,safety:'Avoid flooded roads.'}).join(' ');
  assert.match(text,/last warning I received/);
  assert.match(text,/Avoid flooded roads/);
  assert.doesNotMatch(text,/Mostly sunny|comfortable/i);
});

test('phrase library contains substantial variety', () => {
  const count = Object.values(brief.LIBRARY).reduce((n,lines) => n+lines.length,0);
  assert.ok(count >= 80, `expected at least 80 variations, got ${count}`);
});
