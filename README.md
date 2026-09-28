# StormVector

StormVector is a location-aware weather briefing with NWS forecasts and alerts, current conditions, radar, and a browser spoken broadcast.

## Spoken coverage

`broadcast-library.js` contains more than 80 phrase choices. Routine coverage rotates through current conditions, the next forecast period, tonight, and tomorrow. It only describes pleasant weather when the reported conditions support that description. An active watch switches to preparation-focused coverage. An active warning switches entirely to warning coverage and repeats official details, motion, hazards, expiration, and safety instructions.

Storm motion is read only when the official NWS warning text gives a direction and speed. A location-specific arrival time is spoken only when that location and time appear together in the official warning text. A warning polygon or speed alone is not enough to calculate a reliable arrival time. If the alert feed cannot be checked, Vector says so instead of treating the area as clear.

The browser's installed speech voices determine how natural the audio sounds. Phrase variation and pacing can improve delivery, but this static site does not provide a generated human voice or a free-form AI meteorologist. Keep Wireless Emergency Alerts, NOAA Weather Radio, and official NWS instructions available for urgent warnings.

Run `node --test test/broadcast-library.test.js` to verify the briefing rules and `node --check watch-live.js` for a syntax check.
