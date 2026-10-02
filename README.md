# StormVector

StormVector is a location-aware weather briefing with NWS forecasts and alerts, current conditions, radar, and a browser spoken broadcast.

## Spoken coverage

`broadcast-library.js` contains more than 80 phrase choices. Routine coverage rotates through current conditions, the next forecast period, tonight, and tomorrow. It only describes pleasant weather when the reported conditions support that description. An active watch switches to preparation-focused coverage. An active warning switches entirely to warning coverage and repeats official details, motion, hazards, expiration, and safety instructions.

Storm motion is read only when the official NWS warning text gives a direction and speed. A location-specific arrival time is spoken only when that location and time appear together in the official warning text. A warning polygon or speed alone is not enough to calculate a reliable arrival time. If the alert feed cannot be checked, Vector says so instead of treating the area as clear.

When an official location-specific time is absent, Vector treats the active warning as immediate and gives the safety action without repeating a speculative timing disclaimer. It does not repeat an old arrival time after the alert feed becomes unavailable.

The browser's installed speech voices determine how natural the audio sounds. Phrase variation and pacing can improve delivery, but this static site does not provide a generated human voice or a free-form AI meteorologist. Keep Wireless Emergency Alerts, NOAA Weather Radio, and official NWS instructions available for urgent warnings.

Warning checks run every 30 seconds while the browser allows the page to run. Returning to the page triggers an immediate check. A result older than 90 seconds, a failed request, or an in-progress check after returning is never displayed as a current all-clear. The warning card shows protective action first, the affected area, expiration, and expandable official NWS wording. Browser tabs can be suspended, so this is not an overnight alarm.

The observation shows its reported age. Radar tile load time is not the radar image observation time; that image time is unknown here. The forecast issue time is also not verified by this app.

Run `node --test test/*.test.js` for the briefing and failure drills, and `node --check watch-live.js` for a syntax check.
