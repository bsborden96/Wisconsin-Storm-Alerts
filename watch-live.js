/* ═══════════════════════════════════════════════════════
   STORMVECTOR — VECTOR INTEGRATION FIXES
   vector-fixes.js

   LOAD THIS AFTER watch-live.js.

   Fixes:
   - vectorTravelStatus
   - vectorThreatStatus
   - vectorHeaderStatus
   - severeTakeoverSafety
   - watches no longer trigger breaking-weather takeover
   - only urgent warning/emergency hazards enter severe-only mode
   - live GPS status updates while moving
═══════════════════════════════════════════════════════ */

(() => {
  'use strict';

  /* ═══════════════════════════════════════════════
     ALERT CLASSIFICATION
  ═════════════════════════════════════════════════ */

  function vectorAlertText(alert) {
    const props = alert?.properties || {};

    return [
      props.event,
      props.headline,
      props.description
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
  }


  function vectorIsCriticalAlert(alert) {
    const text = vectorAlertText(alert);

    return (
      text.includes('tornado emergency') ||
      text.includes('flash flood emergency') ||
      text.includes('particularly dangerous situation') ||
      /\bpds\b/.test(text)
    );
  }


  function vectorIsUrgentWarning(alert) {
    const event = String(
      alert?.properties?.event || ''
    ).toLowerCase();

    if (vectorIsCriticalAlert(alert)) {
      return true;
    }

    return (
      event.includes('tornado warning') ||
      event.includes('severe thunderstorm warning') ||
      event.includes('flash flood warning') ||
      event.includes('snow squall warning') ||
      event.includes('blizzard warning') ||
      event.includes('ice storm warning')
    );
  }


  function vectorIsWatch(alert) {
    const event = String(
      alert?.properties?.event || ''
    ).toLowerCase();

    return (
      event.includes('tornado watch') ||
      event.includes('severe thunderstorm watch') ||
      event.includes('flash flood watch') ||
      event.includes('flood watch') ||
      event.includes('winter storm watch') ||
      event.includes('high wind watch') ||
      event.includes('excessive heat watch') ||
      event.includes('fire weather watch')
    );
  }


  function vectorThreatLevel(alerts = []) {
    if (alerts.some(vectorIsCriticalAlert)) {
      return 3;
    }

    if (alerts.some(vectorIsUrgentWarning)) {
      return 2;
    }

    if (alerts.some(vectorIsWatch)) {
      return 1;
    }

    return 0;
  }


  /* ═══════════════════════════════════════════════
     STATUS UI
  ═════════════════════════════════════════════════ */

  function vectorSetThreatStatus(alerts = []) {
    const element = document.getElementById(
      'vectorThreatStatus'
    );

    if (!element) {
      return;
    }

    element.classList.remove(
      'vector-threat-normal',
      'vector-threat-watch',
      'vector-threat-warning',
      'vector-threat-critical'
    );

    const level = vectorThreatLevel(alerts);

    if (level === 3) {
      element.textContent = 'CRITICAL';
      element.classList.add(
        'vector-threat-critical'
      );
      return;
    }

    if (level === 2) {
      element.textContent = 'WARNING';
      element.classList.add(
        'vector-threat-warning'
      );
      return;
    }

    if (level === 1) {
      element.textContent = 'WATCH';
      element.classList.add(
        'vector-threat-watch'
      );
      return;
    }

    element.textContent = 'NORMAL';
    element.classList.add(
      'vector-threat-normal'
    );
  }


  function vectorSetTravelStatus() {
    const element = document.getElementById(
      'vectorTravelStatus'
    );

    if (!element) {
      return;
    }

    if (liveMuted) {
      element.textContent = 'PAUSED';
      return;
    }

    if (!locationReady) {
      element.textContent = 'LOCATION OFF';
      return;
    }

    if (locationMode === 'search') {
      element.textContent = 'FIXED LOCATION';
      return;
    }

    if (locationMode === 'device') {
      element.textContent =
        movingRefreshRunning
          ? 'GPS UPDATING'
          : 'GPS TRACKING';
      return;
    }

    element.textContent = 'LOCATION READY';
  }


  function vectorHeaderText(
    ctx = currentWeatherContext,
    requestedStatus = ''
  ) {
    const status = String(
      requestedStatus || ''
    ).toUpperCase();

    if (status === 'MUTED') {
      return 'PAUSED';
    }

    if (
      status === 'UPDATING' ||
      status === 'CONNECTING' ||
      status === 'LOCATING'
    ) {
      return status;
    }

    const level = vectorThreatLevel(
      ctx?.alerts || []
    );

    if (level === 3) {
      return 'CRITICAL WEATHER';
    }

    if (level === 2) {
      return 'SEVERE WEATHER';
    }

    if (
      liveStarted &&
      !liveMuted
    ) {
      return 'LIVE';
    }

    return status || 'STANDBY';
  }


  function vectorSyncStatusUI(
    ctx = currentWeatherContext,
    requestedStatus = ''
  ) {
    vectorSetTravelStatus();

    vectorSetThreatStatus(
      ctx?.alerts || []
    );

    setText(
      'vectorHeaderStatus',
      vectorHeaderText(
        ctx,
        requestedStatus
      )
    );
  }


  /* ═══════════════════════════════════════════════
     SEVERE-ONLY MODE

     Replace the old broad "any warning" behavior.
  ═════════════════════════════════════════════════ */

  severeOnlyMode = function(ctx) {
    return (ctx?.alerts || [])
      .some(vectorIsUrgentWarning);
  };


  /* ═══════════════════════════════════════════════
     WRAP LIVE BADGE

     Keeps the top header status synchronized with
     the existing broadcast badge.
  ═════════════════════════════════════════════════ */

  const vectorOriginalSetLiveBadge =
    setLiveBadge;

  setLiveBadge = function(text) {
    vectorOriginalSetLiveBadge(text);

    vectorSyncStatusUI(
      currentWeatherContext,
      text
    );
  };


  /* ═══════════════════════════════════════════════
     WRAP PREPARE BROADCAST
  ═════════════════════════════════════════════════ */

  const vectorOriginalPrepareBroadcast =
    prepareBroadcast;

  prepareBroadcast = async function(
    options = {}
  ) {
    vectorSyncStatusUI(
      currentWeatherContext,
      'UPDATING'
    );

    const ctx =
      await vectorOriginalPrepareBroadcast(
        options
      );

    vectorSyncStatusUI(
      ctx,
      severeOnlyMode(ctx)
        ? 'SEVERE WEATHER'
        : 'LIVE'
    );

    return ctx;
  };


  /* ═══════════════════════════════════════════════
     LIVE GPS STATUS
  ═════════════════════════════════════════════════ */

  const vectorOriginalMaybeRefreshMovingLocation =
    maybeRefreshMovingLocation;

  maybeRefreshMovingLocation =
    async function(newLat, newLon) {
      vectorSetTravelStatus();

      try {
        return await vectorOriginalMaybeRefreshMovingLocation(
          newLat,
          newLon
        );
      } finally {
        vectorSetTravelStatus();
      }
    };


  /* ═══════════════════════════════════════════════
     SEVERE TAKEOVER SAFETY TEXT
  ═════════════════════════════════════════════════ */

  const vectorOriginalShowSevereTakeover =
    showSevereTakeover;

  showSevereTakeover = function(alert) {
    vectorOriginalShowSevereTakeover(
      alert
    );

    const safety =
      getSafetyInstructions(alert);

    setText(
      'severeTakeoverSafety',
      safety
    );

    vectorSyncStatusUI(
      {
        ...(currentWeatherContext || {}),
        alerts: [alert]
      },
      'SEVERE WEATHER'
    );
  };


  /* ═══════════════════════════════════════════════
     BREAKING WEATHER CHECK

     Watches still update the UI, but they DO NOT
     interrupt speech or trigger the takeover.

     Breaking takeover is reserved for:
     - Tornado Warning / Emergency
     - Severe Thunderstorm Warning
     - Flash Flood Warning / Emergency
     - Snow Squall Warning
     - Blizzard Warning
     - Ice Storm Warning
  ═════════════════════════════════════════════════ */

  checkForBreakingWeather =
    async function() {
      if (
        liveMuted ||
        breakingWeatherActive ||
        !locationReady
      ) {
        return;
      }

      try {
        const alerts =
          await fetchAlerts(
            liveLat,
            liveLon
          );

        const priority =
          getPriorityAlerts(alerts);

        const newAlerts =
          priority.filter(
            alert =>
              !knownPriorityAlertIds.has(
                alert.id
              )
          );

        priority.forEach(
          alert =>
            knownPriorityAlertIds.add(
              alert.id
            )
        );

        if (currentWeatherContext) {
          currentWeatherContext.alerts =
            alerts;

          updateWatchLiveWeatherTheme(
            currentWeatherContext
          );

          updateAlertGraphic(alerts);
          updateRadarWarnings();

          vectorSyncStatusUI(
            currentWeatherContext,
            severeOnlyMode(
              currentWeatherContext
            )
              ? 'SEVERE WEATHER'
              : 'LIVE'
          );
        } else {
          vectorSetThreatStatus(alerts);
        }

        const breakingAlert =
          newAlerts.find(
            vectorIsUrgentWarning
          );

        if (breakingAlert) {
          await interruptForBreakingWeather(
            breakingAlert
          );
        }

      } catch (error) {
        console.warn(
          'StormVector severe watch failed:',
          error
        );
      }
    };


  /* ═══════════════════════════════════════════════
     INITIAL SYNC
  ═════════════════════════════════════════════════ */

  function vectorInitialSync() {
    vectorSyncStatusUI(
      currentWeatherContext,
      liveStarted
        ? 'LIVE'
        : 'STANDBY'
    );
  }

  if (
    document.readyState === 'loading'
  ) {
    document.addEventListener(
      'DOMContentLoaded',
      vectorInitialSync,
      { once: true }
    );
  } else {
    vectorInitialSync();
  }

})();
