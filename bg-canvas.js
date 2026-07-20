/* ════════════════════════════════════════════════
   ANIMATED BACKGROUND — shared by Home + Outlooks
   Realistic tornado: clear slot / RFD notch, inflow
   bands feeding the mesocyclone, layered condensation
   funnel with density variance, ground-hugging debris
   skirt, and parallax rain/snow.
════════════════════════════════════════════════ */
(function initBackground() {
  if (prefersReducedMotion) { window.setBgMode = () => {}; window.setDaytime = () => {}; return; }

  const canvas = document.getElementById('bgCanvas');
  if (!canvas) { window.setBgMode = () => {}; window.setDaytime = () => {}; return; }
  const ctx = canvas.getContext('2d', { alpha: false });

  let W, H;
  let bgMode = 'clear';
  let isDaytime = true;
  let sunProgress = 0.5;
  let nightProgress = 0.5;
  let clouds = [], drops = [], dropsFar = [], snowflakes = [], fogParticles = [], stars = null;
  let bolts = [], boltTimer = 0;

  /* ── TORNADO STATE ── */
  let tornadoAge = 0, tornadoRotation = 0, tornadoWobble = 0;
  let tornadoDebris = [], tornadoRopePhase = false, tornadoGroundDust = [];
  let tornadoIntensity = 0;
  let inflowWisps = [];

  let lastFrameTime = 0;
  const targetFPS = perfLevel === 'low' ? 24 : perfLevel === 'mid' ? 40 : 60;
  const frameTarget = 1000 / targetFPS;

  const PARTICLE = {
    cloud: perfLevel === 'low' ? 3 : perfLevel === 'mid' ? 5 : 8,
    rain:  perfLevel === 'low' ? 45 : perfLevel === 'mid' ? 80 : 120,
    snow:  perfLevel === 'low' ? 45 : perfLevel === 'mid' ? 70 : 100,
    fog:   perfLevel === 'low' ? 6 : 10,
  };

  let resizeTimer;
  function resize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const dpr = pixelRatio;
      // Prefer visualViewport dimensions when available — on mobile Safari/
      // Chrome the dynamic address-bar/toolbar can change the visible
      // viewport without always firing a plain window 'resize' event, which
      // used to leave the canvas sized to a stale, shorter viewport (i.e.
      // the animated background stopped covering the full page after the
      // toolbar collapsed). visualViewport stays in sync with what's
      // actually on screen.
      const vv = window.visualViewport;
      W = Math.ceil(vv ? vv.width : window.innerWidth);
      H = Math.ceil(vv ? vv.height : window.innerHeight);
      H = Math.max(H, window.innerHeight, document.documentElement.clientHeight || 0);
      canvas.width = W * dpr; canvas.height = H * dpr;
      canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
      ctx.setTransform(1,0,0,1,0,0);
      ctx.scale(dpr, dpr);
      stars = null;
      initTornadoDebris();
    }, 150);
  }
  window.addEventListener('resize', resize, { passive: true });
  window.addEventListener('orientationchange', resize, { passive: true });
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', resize, { passive: true });
    window.visualViewport.addEventListener('scroll', resize, { passive: true });
  }

  const dpr0 = pixelRatio;
  W = window.innerWidth; H = window.innerHeight;
  canvas.width = W * dpr0; canvas.height = H * dpr0;
  canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  ctx.scale(dpr0, dpr0);

  /* ════════════════════════════════════════════
     TORNADO
  ════════════════════════════════════════════ */
  function initTornadoDebris() {
    tornadoDebris = []; tornadoGroundDust = []; tornadoIntensity = 0; inflowWisps = [];
    const debrisCount = perfLevel === 'low' ? 55 : perfLevel === 'mid' ? 110 : 200;
    for (let i = 0; i < debrisCount; i++) {
      const t = Math.random();
      const orbitRadius = Math.max(8, t < 0.5 ? t * t * 2 * 130 + 8 : (1 - t) * 90 + 18);
      tornadoDebris.push({
        t, angle: Math.random() * Math.PI * 2,
        orbitRadius,
        angularSpeed: (1.8 + Math.random() * 2.8) * (Math.random() > 0.5 ? 1 : -1),
        vertSpeed: 0.0006 + Math.random() * 0.0018,
        size: 1 + Math.random() * (t > 0.7 ? 6 : 3),
        type: Math.random() > 0.55 ? 'plank' : Math.random() > 0.5 ? 'chunk' : 'dust',
        rotation: Math.random() * Math.PI * 2,
        rotSpeed: (Math.random() - 0.5) * 0.18,
        opacity: 0.35 + Math.random() * 0.6,
        color: `hsl(${22 + Math.random()*25},${28+Math.random()*22}%,${18+Math.random()*22}%)`,
      });
    }
    const dustCount = perfLevel === 'low' ? 18 : 34;
    for (let i = 0; i < dustCount; i++) {
      tornadoGroundDust.push({
        angle: Math.random() * Math.PI * 2, radius: 15 + Math.random() * 170,
        angularSpeed: (0.5 + Math.random() * 1.0) * (Math.random() > 0.5 ? 1 : -1),
        opacity: 0.08 + Math.random() * 0.28, size: 20 + Math.random() * 75,
        yOffset: Math.random() * 50, phase: Math.random() * Math.PI * 2,
      });
    }
    // Inflow bands: streaky scud clouds spiraling INTO the meso from the flanks —
    // this reads as "the storm feeding itself" and is a big realism cue.
    const wispCount = perfLevel === 'low' ? 5 : 10;
    for (let i = 0; i < wispCount; i++) {
      inflowWisps.push({
        dist: 0.55 + Math.random() * 0.55,
        angle: Math.random() * Math.PI * 2,
        speed: 0.0035 + Math.random() * 0.004,
        len: 60 + Math.random() * 90,
        thickness: 5 + Math.random() * 8,
        opacity: 0.10 + Math.random() * 0.16,
      });
    }
  }

  function getTornadoProfile(yFrac) {
    const wobbleAmt = Math.sin(tornadoWobble + yFrac * 3.5) * 10;
    if (tornadoRopePhase) {
      const rope = 5 + Math.sin(yFrac * Math.PI * 5 + tornadoAge * 0.06) * 12;
      return Math.max(2, rope + wobbleAmt * 0.25);
    }
    let w;
    if (yFrac < 0.15) w = yFrac / 0.15 * 18;
    else if (yFrac < 0.70) w = 18 + ((yFrac - 0.15) / 0.55) * 110;
    else w = 128 + ((yFrac - 0.70) / 0.30) * 30;
    return Math.max(2, w + wobbleAmt);
  }
  function getTornadoX(yFrac) {
    const lean = Math.sin(tornadoAge * 0.006) * 40 * yFrac;
    const wobX = Math.sin(tornadoWobble * 0.5 + yFrac * 2.2) * 18 * yFrac;
    return W / 2 + lean + wobX;
  }

  function buildFunnelPath(points, widthMult, skewFrac) {
    const path = new Path2D();
    const n = points.length;
    const skew = skewFrac || 0; // shifts the visual center to carve a clear-slot notch
    path.moveTo(points[0].cx - points[0].hw * widthMult * (1 - skew), points[0].cy);
    for (let i = 1; i < n; i++) {
      const p = points[i], pp = points[i - 1];
      const cpx = (pp.cx + p.cx) / 2 - (pp.hw + p.hw) / 2 * widthMult * (1 - skew);
      const cpy = (pp.cy + p.cy) / 2;
      path.quadraticCurveTo(pp.cx - pp.hw * widthMult * (1 - skew), pp.cy, cpx, cpy);
    }
    path.lineTo(points[n-1].cx + points[n-1].hw * widthMult * (1 + skew), points[n-1].cy);
    for (let i = n - 1; i >= 0; i--) {
      const p = points[i], pi = Math.max(0, i - 1), pp = points[pi];
      const cpx = (pp.cx + p.cx) / 2 + (pp.hw + p.hw) / 2 * widthMult * (1 + skew);
      const cpy = (pp.cy + p.cy) / 2;
      if (i === n - 1) path.lineTo(p.cx + p.hw * widthMult * (1 + skew), p.cy);
      else path.quadraticCurveTo(p.cx + p.hw * widthMult * (1 + skew), p.cy, cpx, cpy);
    }
    path.closePath();
    return path;
  }

  function drawTornado() {
    tornadoAge += 1; tornadoRotation += 0.032; tornadoWobble += 0.013;
    if (tornadoIntensity < 1) tornadoIntensity = Math.min(1, tornadoIntensity + 0.008);
    tornadoRopePhase = (tornadoAge % 900) < 90;

    const groundY = H * 0.88, cloudY = H * 0.06;
    const steps = perfLevel === 'low' ? 28 : 56;
    // Clear slot breathes in and out — the notch where the RFD wraps around the meso
    const clearSlotSkew = Math.sin(tornadoAge * 0.011) * 0.12;

    ctx.save();
    ctx.globalAlpha = tornadoIntensity;

    const skyHaze = ctx.createRadialGradient(W/2, H*0.3, 0, W/2, H*0.5, W*0.7);
    skyHaze.addColorStop(0, 'rgba(28,55,8,0.22)');
    skyHaze.addColorStop(0.5, 'rgba(10,28,4,0.12)');
    skyHaze.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = skyHaze; ctx.fillRect(0, 0, W, H);

    const points = [];
    for (let i = 0; i <= steps; i++) {
      const yFrac = i / steps;
      points.push({ cx: getTornadoX(yFrac), cy: cloudY + yFrac * (groundY - cloudY), hw: getTornadoProfile(yFrac) });
    }

    const layers = [
      { mult: 1.55, alphaTop: 0.04, alphaBot: 0.08, color: '45,30,10' },
      { mult: 1.25, alphaTop: 0.10, alphaBot: 0.18, color: '58,42,16' },
      { mult: 1.00, alphaTop: 0.20, alphaBot: 0.38, color: '75,55,22' },
      { mult: 0.75, alphaTop: 0.28, alphaBot: 0.50, color: '92,68,28' },
      { mult: 0.50, alphaTop: 0.18, alphaBot: 0.32, color: '55,40,16' },
    ];
    layers.forEach((l, li) => {
      // Only the outer 2 layers get the clear-slot skew — the dense core stays centered
      const path = buildFunnelPath(points, l.mult, li < 2 ? clearSlotSkew : 0);
      const grad = ctx.createLinearGradient(0, cloudY, 0, groundY);
      grad.addColorStop(0.0, `rgba(${l.color},${l.alphaTop * 0.4})`);
      grad.addColorStop(0.25, `rgba(${l.color},${l.alphaTop})`);
      grad.addColorStop(0.65, `rgba(${l.color},${l.alphaBot})`);
      grad.addColorStop(0.85, `rgba(${l.color},${l.alphaBot * 1.2})`);
      grad.addColorStop(1.0, `rgba(${l.color},${l.alphaBot * 0.5})`);
      ctx.fillStyle = grad; ctx.fill(path);
    });

    // Condensation density variance — patchy translucent bands so the funnel
    // doesn't read as one flat solid shape (real funnels are streaky/laminar).
    const bandCount = perfLevel === 'low' ? 10 : 22;
    for (let b = 0; b < bandCount; b++) {
      const yFrac = (b + 0.5) / bandCount;
      const cy = cloudY + yFrac * (groundY - cloudY);
      const cx = getTornadoX(yFrac);
      const hw = getTornadoProfile(yFrac);
      if (hw < 5) continue;
      const bandAngle = tornadoRotation * (2.5 - yFrac) + b * 0.55;
      const highlightX = cx + Math.cos(bandAngle) * hw * 0.45;
      const highlightY = cy + Math.sin(bandAngle * 0.5) * hw * 0.12;
      const hg = ctx.createRadialGradient(highlightX, highlightY, 0, cx, cy, hw * 0.95);
      hg.addColorStop(0, 'rgba(140,110,50,0.0)');
      hg.addColorStop(0.35, 'rgba(95,70,24,0.12)');
      hg.addColorStop(0.70, 'rgba(62,44,14,0.22)');
      hg.addColorStop(0.90, 'rgba(35,22,6,0.28)');
      hg.addColorStop(1, 'rgba(10,6,2,0.0)');
      ctx.fillStyle = hg;
      ctx.beginPath(); ctx.ellipse(cx, cy, hw * 0.95, hw * 0.20, 0, 0, Math.PI * 2); ctx.fill();
    }

    // Sub-vortices
    for (let v = 0; v < 2; v++) {
      const vBaseAngle = tornadoRotation * 3.2 + v * Math.PI;
      for (let s = 3; s < steps - 2; s += 2) {
        const yFrac = s / steps;
        const cy = cloudY + yFrac * (groundY - cloudY);
        const cx = getTornadoX(yFrac);
        const hw = getTornadoProfile(yFrac);
        if (hw < 8) continue;
        const orbitR = hw * (0.52 + 0.18 * Math.sin(yFrac * Math.PI));
        const vAngle = vBaseAngle + yFrac * 1.8;
        const vx = cx + Math.cos(vAngle) * orbitR, vy = cy;
        const vs = Math.max(3, hw * 0.22);
        const vg = ctx.createRadialGradient(vx, vy, 0, vx, vy, vs * 3);
        vg.addColorStop(0, 'rgba(175,135,65,0.38)');
        vg.addColorStop(0.35, 'rgba(110,80,28,0.20)');
        vg.addColorStop(0.7, 'rgba(65,44,14,0.10)');
        vg.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = vg;
        ctx.beginPath(); ctx.arc(vx, vy, vs * 3, 0, Math.PI * 2); ctx.fill();
      }
    }

    // Inflow bands feeding the meso — reads as the storm "breathing in"
    inflowWisps.forEach(w => {
      w.angle += w.speed; w.dist -= 0.0009;
      if (w.dist < 0.15) w.dist = 0.55 + Math.random() * 0.55;
      const baseY = cloudY + H * 0.05;
      const wx = W/2 + Math.cos(w.angle) * W * 0.42 * w.dist;
      const wy = baseY + Math.sin(w.angle) * H * 0.05 * w.dist;
      const tx = W/2, ty = baseY;
      ctx.save();
      ctx.globalAlpha = w.opacity * tornadoIntensity;
      ctx.strokeStyle = 'rgba(30,26,20,0.9)';
      ctx.lineWidth = w.thickness;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(wx, wy);
      ctx.quadraticCurveTo((wx+tx)/2, wy - 14, tx + (wx>tx?-1:1)*w.len*0.3, ty);
      ctx.stroke();
      ctx.restore();
    });

    // Ground contact
    const groundX = getTornadoX(1), groundW = getTornadoProfile(1);
    const discGrad = ctx.createRadialGradient(groundX, groundY, 0, groundX, groundY, groundW * 3.5);
    discGrad.addColorStop(0, 'rgba(120,90,38,0.7)');
    discGrad.addColorStop(0.3, 'rgba(90,65,24,0.45)');
    discGrad.addColorStop(0.6, 'rgba(55,38,12,0.22)');
    discGrad.addColorStop(0.85, 'rgba(28,18,5,0.10)');
    discGrad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = discGrad;
    ctx.beginPath(); ctx.ellipse(groundX, groundY, groundW * 3.5, groundW * 0.7, 0, 0, Math.PI * 2); ctx.fill();

    tornadoGroundDust.forEach(d => {
      d.angle += d.angularSpeed * 0.014; d.phase += 0.018;
      const dx = groundX + Math.cos(d.angle) * d.radius;
      const dy = groundY - d.yOffset + Math.sin(d.phase) * 10;
      const dg = ctx.createRadialGradient(dx, dy, 0, dx, dy, d.size);
      dg.addColorStop(0, `rgba(118,88,35,${d.opacity})`);
      dg.addColorStop(0.45, `rgba(85,60,20,${d.opacity * 0.55})`);
      dg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = dg;
      ctx.beginPath(); ctx.ellipse(dx, dy, d.size, d.size * 0.42, 0, 0, Math.PI * 2); ctx.fill();
    });

    // Flying debris
    tornadoDebris.forEach(d => {
      d.angle += d.angularSpeed * 0.020 * (0.8 + d.t * 0.8);
      d.t += d.vertSpeed;
      if (d.t > 1.02) d.t = 0.02 + Math.random() * 0.05;
      d.rotation += d.rotSpeed;
      const yFrac = Math.min(1, d.t);
      const cy = cloudY + yFrac * (groundY - cloudY);
      const cx = getTornadoX(yFrac);
      const hw = getTornadoProfile(yFrac);
      const orbitR = Math.min(d.orbitRadius, hw * 0.92);
      const dx = cx + Math.cos(d.angle + tornadoRotation * d.angularSpeed * 0.4) * orbitR;
      const dy = cy + Math.sin(d.angle * 0.7) * orbitR * 0.15;
      const fadeIn = Math.min(1, d.t * 8), fadeOut = Math.min(1, (1 - d.t) * 8);
      ctx.save();
      ctx.translate(dx, dy); ctx.rotate(d.rotation);
      ctx.globalAlpha = d.opacity * fadeIn * fadeOut;
      ctx.fillStyle = d.color;
      if (d.type === 'plank') { const pw = d.size*3.5, ph = d.size*0.55; ctx.fillRect(-pw/2,-ph/2,pw,ph); }
      else if (d.type === 'chunk') { ctx.beginPath(); ctx.arc(0,0,d.size,0,Math.PI*2); ctx.fill(); }
      else {
        const dg2 = ctx.createRadialGradient(0,0,0,0,0,d.size*2);
        dg2.addColorStop(0, d.color); dg2.addColorStop(0.6, d.color.replace('hsl','hsla').replace(')',',0.4)')); dg2.addColorStop(1,'rgba(0,0,0,0)');
        ctx.fillStyle = dg2; ctx.beginPath(); ctx.arc(0,0,d.size*2,0,Math.PI*2); ctx.fill();
      }
      ctx.restore();
    });

    // Mesocyclone cloud base + rotating wall-cloud lobes
    const cloudBaseX = W / 2;
    const wallGrad = ctx.createRadialGradient(cloudBaseX, cloudY, 0, cloudBaseX, cloudY, W * 0.40);
    wallGrad.addColorStop(0, 'rgba(12,6,2,0.80)');
    wallGrad.addColorStop(0.25, 'rgba(20,12,4,0.55)');
    wallGrad.addColorStop(0.55, 'rgba(12,7,2,0.30)');
    wallGrad.addColorStop(0.80, 'rgba(5,3,1,0.12)');
    wallGrad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = wallGrad;
    ctx.beginPath(); ctx.ellipse(cloudBaseX, cloudY, W * 0.40, H * 0.14, 0, 0, Math.PI * 2); ctx.fill();

    const wallCount = perfLevel === 'low' ? 5 : 8;
    for (let w = 0; w < wallCount; w++) {
      const wa = tornadoRotation * 0.55 + w * (Math.PI * 2 / wallCount);
      const wr = W * (0.10 + Math.sin(wa * 2 + tornadoAge * 0.01) * 0.04);
      const wx = cloudBaseX + Math.cos(wa) * wr;
      const wy = cloudY + H * 0.045 + Math.sin(wa * 0.7) * H * 0.025;
      const wg = ctx.createRadialGradient(wx, wy, 0, wx, wy, 60 + w * 10);
      wg.addColorStop(0, 'rgba(35,22,8,0.48)'); wg.addColorStop(0.55, 'rgba(22,14,4,0.24)'); wg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = wg;
      ctx.beginPath(); ctx.ellipse(wx, wy, 60 + w * 10, 34, 0, 0, Math.PI * 2); ctx.fill();
    }

    ctx.restore();
  }

  /* ─── Clouds ─── */
  function buildCloud(x, y, scale, dark) {
    const lobes = [];
    const bodyCount = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < bodyCount; i++) {
      const angle = (i / bodyCount) * Math.PI * 2;
      const dist = (0.12 + Math.random() * 0.35) * scale;
      lobes.push({ ox: Math.cos(angle)*dist*1.1, oy: Math.sin(angle)*dist*0.4, rx: (0.45+Math.random()*0.5)*scale, ry: (0.28+Math.random()*0.3)*scale, layer:'body' });
    }
    const topCount = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < topCount; i++) {
      const angle = -Math.PI/2 + (i/(topCount-1) - 0.5)*Math.PI*0.8;
      lobes.push({ ox: Math.cos(angle)*scale*0.28, oy: Math.sin(angle)*scale*0.42 - scale*0.22, rx: (0.28+Math.random()*0.42)*scale, ry: (0.28+Math.random()*0.42)*scale, layer:'top' });
    }
    return { x, y, scale, dark, lobes, speed: 0.07 + Math.random() * 0.15 };
  }
  function initClouds(count, dark) {
    clouds = [];
    const n = Math.min(count, PARTICLE.cloud * (dark ? 1 : 0.6));
    for (let i = 0; i < n; i++) clouds.push(buildCloud(Math.random()*W*1.4 - W*0.2, H*0.04 + Math.random()*H*0.24, 65 + Math.random()*100, dark));
  }
  function drawCloud(cloud) {
    const { x, y, lobes, dark } = cloud;
    let topColor, midColor, shadowColor;
    if (dark) { topColor='rgba(70,76,95,1)'; midColor='rgba(44,49,64,1)'; shadowColor='rgba(20,22,32,1)'; }
    else if (isDaytime) { topColor='rgba(255,255,255,1)'; midColor='rgba(228,236,248,1)'; shadowColor='rgba(168,185,210,1)'; }
    else { topColor='rgba(46,56,84,1)'; midColor='rgba(32,40,62,1)'; shadowColor='rgba(16,20,36,1)'; }
    ctx.save();
    ctx.fillStyle = shadowColor;
    lobes.forEach(l => { ctx.beginPath(); ctx.ellipse(x+l.ox+4, y+l.oy+5, l.rx*0.94, l.ry*0.94, 0, 0, Math.PI*2); ctx.fill(); });
    ctx.fillStyle = midColor;
    lobes.filter(l=>l.layer==='body').forEach(l => { ctx.beginPath(); ctx.ellipse(x+l.ox, y+l.oy, l.rx, l.ry, 0, 0, Math.PI*2); ctx.fill(); });
    ctx.fillStyle = topColor;
    lobes.filter(l=>l.layer==='top').forEach(l => { ctx.beginPath(); ctx.ellipse(x+l.ox, y+l.oy, l.rx, l.ry, 0, 0, Math.PI*2); ctx.fill(); });
    lobes.filter(l=>l.layer==='top').forEach(l => {
      const hlGrd = ctx.createRadialGradient(x+l.ox-l.rx*0.2, y+l.oy-l.ry*0.26, l.rx*0.04, x+l.ox, y+l.oy, l.rx);
      if (dark) { hlGrd.addColorStop(0,'rgba(95,105,128,0.38)'); hlGrd.addColorStop(1,'rgba(0,0,0,0)'); }
      else if (isDaytime) { hlGrd.addColorStop(0,'rgba(255,255,255,0.62)'); hlGrd.addColorStop(0.5,'rgba(255,255,255,0.1)'); hlGrd.addColorStop(1,'rgba(255,255,255,0)'); }
      else { hlGrd.addColorStop(0,'rgba(75,95,145,0.28)'); hlGrd.addColorStop(1,'rgba(0,0,0,0)'); }
      ctx.save(); ctx.beginPath(); ctx.ellipse(x+l.ox, y+l.oy, l.rx, l.ry, 0, 0, Math.PI*2); ctx.clip();
      ctx.fillStyle = hlGrd; ctx.fill(); ctx.restore();
    });
    ctx.restore();
  }

  /* ─── Rain (two depth layers for parallax) / Snow / Fog ─── */
  let gustPhase = 0;
  function initRain(count, angled) {
    drops = []; dropsFar = [];
    for (let i = 0; i < count; i++) drops.push({ x:Math.random()*W*1.4, y:Math.random()*H, len:7+Math.random()*16, speed:7+Math.random()*10, angleBase:angled?0.22+Math.random()*0.15:0, opacity:0.09+Math.random()*0.20 });
    const farCount = Math.round(count * 0.45);
    for (let i = 0; i < farCount; i++) dropsFar.push({ x:Math.random()*W*1.4, y:Math.random()*H, len:3+Math.random()*7, speed:4+Math.random()*5, angleBase:angled?0.18+Math.random()*0.12:0, opacity:0.04+Math.random()*0.08 });
  }
  function initSnow(count) {
    snowflakes = [];
    for (let i = 0; i < count; i++) snowflakes.push({ x:Math.random()*W, y:Math.random()*H, r:1+Math.random()*2.8, speed:0.4+Math.random()*1.3, drift:(Math.random()-0.5)*0.45, flutter:Math.random()*Math.PI*2, flutterSpd:0.02+Math.random()*0.03, opacity:0.32+Math.random()*0.5 });
  }
  function initFog() {
    fogParticles = [];
    for (let i = 0; i < PARTICLE.fog; i++) fogParticles.push({ x:Math.random()*W, y:H*0.28+Math.random()*H*0.62, r:100+Math.random()*200, speed:0.05+Math.random()*0.1, opacity:0.022+Math.random()*0.045 });
  }

  function buildBoltPath(x1,y1,x2,y2,depth) {
    if (depth===0) return [{x:x1,y:y1},{x:x2,y:y2}];
    const mx=(x1+x2)/2+(Math.random()-0.5)*(Math.abs(x2-x1)+70)*(0.75/depth);
    const my=(y1+y2)/2+(Math.random()-0.5)*35;
    return [...buildBoltPath(x1,y1,mx,my,depth-1),...buildBoltPath(mx,my,x2,y2,depth-1)];
  }
  function generateBranches(segments) {
    const branches=[]; const step = perfLevel==='low' ? 8 : 4;
    for (let i=2;i<segments.length-2;i+=step) {
      if (Math.random()<0.35) {
        const seg=segments[i], len=35+Math.random()*80, angle=(Math.random()-0.5)*1.3+Math.PI/2;
        branches.push({ segs:buildBoltPath(seg.x,seg.y,seg.x+Math.cos(angle)*len,seg.y+Math.sin(angle)*len,3), opacity:0.4+Math.random()*0.38 });
      }
    }
    return branches;
  }
  function spawnBolt() {
    const x=W*0.15+Math.random()*W*0.7;
    const segments=buildBoltPath(x,0,x+(Math.random()-0.5)*160,H*(0.35+Math.random()*0.44),7);
    bolts.push({segments,life:1.0,decay:0.042+Math.random()*0.038,bright:0.68+Math.random()*0.3,branches:generateBranches(segments)});
    if (bolts.length > 4) bolts.splice(0, bolts.length - 4);
  }
  function drawBoltPath(segs,alpha,lineWidth,color) {
    if(segs.length<2)return;
    ctx.beginPath(); ctx.moveTo(segs[0].x,segs[0].y);
    for(let i=1;i<segs.length;i++) ctx.lineTo(segs[i].x,segs[i].y);
    ctx.lineWidth=lineWidth*4; ctx.strokeStyle=`rgba(${color},${alpha*0.06})`; ctx.shadowBlur=0; ctx.stroke();
    ctx.lineWidth=lineWidth*2; ctx.strokeStyle=`rgba(${color},${alpha*0.16})`; ctx.stroke();
    ctx.lineWidth=lineWidth; ctx.strokeStyle=`rgba(${color},${alpha})`;
    ctx.shadowBlur=14; ctx.shadowColor=`rgba(${color},0.9)`; ctx.stroke();
    ctx.lineWidth=Math.max(0.35,lineWidth*0.3); ctx.strokeStyle=`rgba(255,255,255,${alpha*0.75})`;
    ctx.shadowBlur=5; ctx.shadowColor='white'; ctx.stroke();
    ctx.shadowBlur=0;
  }

  function drawSun(progress) {
    const sx=W*0.1+W*0.8*progress, sy=H*0.44-Math.sin(Math.PI*progress)*H*0.37;
    const sunR=34, glowR=sunR*4.2, lowLight=progress<0.15||progress>0.85;
    const grd=ctx.createRadialGradient(sx,sy,sunR*0.5,sx,sy,glowR);
    grd.addColorStop(0,lowLight?'rgba(255,215,100,0.88)':'rgba(255,255,220,0.75)');
    grd.addColorStop(0.3,lowLight?'rgba(255,140,40,0.32)':'rgba(255,240,150,0.2)');
    grd.addColorStop(1,lowLight?'rgba(255,80,0,0)':'rgba(255,255,200,0)');
    ctx.fillStyle=grd; ctx.beginPath(); ctx.arc(sx,sy,glowR,0,Math.PI*2); ctx.fill();
    const disk=ctx.createRadialGradient(sx-sunR*0.2,sy-sunR*0.2,sunR*0.1,sx,sy,sunR);
    disk.addColorStop(0,lowLight?'rgba(255,228,118,1)':'rgba(255,255,228,1)');
    disk.addColorStop(1,lowLight?'rgba(255,155,38,1)':'rgba(255,232,115,1)');
    ctx.fillStyle=disk; ctx.beginPath(); ctx.arc(sx,sy,sunR,0,Math.PI*2); ctx.fill();
  }
  function drawMoon(progress) {
    const mx=W*0.1+W*0.8*progress, my=H*0.38-Math.sin(Math.PI*progress)*H*0.3, moonR=18;
    const grd=ctx.createRadialGradient(mx,my,moonR*0.3,mx,my,moonR*3);
    grd.addColorStop(0,'rgba(200,220,255,0.14)'); grd.addColorStop(1,'rgba(150,180,255,0)');
    ctx.fillStyle=grd; ctx.beginPath(); ctx.arc(mx,my,moonR*3,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='rgba(218,228,255,0.94)'; ctx.beginPath(); ctx.arc(mx,my,moonR,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='rgba(18,28,55,0.7)'; ctx.beginPath(); ctx.arc(mx+moonR*0.32,my,moonR*0.84,0,Math.PI*2); ctx.fill();
  }
  function initStars() {
    stars=[]; const count = perfLevel==='low' ? 80 : 180;
    for(let i=0;i<count;i++) stars.push({x:Math.random()*W,y:Math.random()*H*0.65,r:0.3+Math.random()*1.2,flicker:Math.random()*Math.PI*2,twinkle:Math.random()*0.42+0.55});
  }
  function getSkyColors() {
    switch(bgMode) {
      case 'tornado': return ['#0a0500','#060300'];
      case 'storm':   return isDaytime?['#141000','#070900']:['#070000','#000408'];
      case 'rain':    return isDaytime?['#26303c','#364050']:['#060b16','#0a1420'];
      case 'snow':    return isDaytime?['#c2d2e2','#dce8f4']:['#08101a','#161e2c'];
      case 'fog':     return isDaytime?['#7a8c9c','#9aaab8']:['#0b0e16','#181e2e'];
      case 'cloudy':  return isDaytime?['#354558','#455668']:['#050810','#0c141c'];
      default:
        if(isDaytime){
          const blend=Math.sin(Math.PI*sunProgress);
          if(sunProgress<0.15||sunProgress>0.85) return['#170506','#5e2610'];
          return [`rgb(${Math.round(16+blend*14)},${Math.round(75+blend*55)},${Math.round(132+blend*76)})`,
                  `rgb(${Math.round(70+blend*92)},${Math.round(130+blend*72)},${Math.round(192+blend*25)})`];
        }
        return ['#010408','#010608'];
    }
  }

  function draw(timestamp) {
    requestAnimationFrame(draw);
    const elapsed = timestamp - lastFrameTime;
    if (elapsed < frameTarget - 2) return;
    lastFrameTime = timestamp;
    gustPhase += 0.004;

    ctx.clearRect(0,0,W,H);
    const [skyTop,skyBot]=getSkyColors();
    const grad=ctx.createLinearGradient(0,0,0,H);
    grad.addColorStop(0,skyTop); grad.addColorStop(1,skyBot);
    ctx.fillStyle=grad; ctx.fillRect(0,0,W,H);

    if(bgMode==='clear'&&isDaytime&&(sunProgress<0.22||sunProgress>0.78)){
      const intense=sunProgress<0.22?sunProgress/0.22:(1-sunProgress)/0.22;
      const hg=ctx.createLinearGradient(0,H*0.46,0,H);
      hg.addColorStop(0,`rgba(255,95,18,0)`); hg.addColorStop(0.5,`rgba(255,115,28,${0.2*intense})`); hg.addColorStop(1,`rgba(255,55,8,${0.13*intense})`);
      ctx.fillStyle=hg; ctx.fillRect(0,H*0.46,W,H*0.54);
    }

    const showStars=!isDaytime||bgMode==='storm'||bgMode==='tornado';
    if(showStars){
      if(!stars)initStars();
      const sa=isDaytime?0.1:1;
      stars.forEach(s=>{
        s.flicker+=0.015;
        const a=(0.28+Math.sin(s.flicker)*0.26*s.twinkle)*sa;
        if(a<=0)return;
        ctx.beginPath(); ctx.arc(s.x,s.y,s.r,0,Math.PI*2);
        ctx.fillStyle=`rgba(195,215,255,${Math.max(0,a)})`; ctx.fill();
      });
    }

    if(isDaytime&&bgMode!=='storm'&&bgMode!=='tornado'&&bgMode!=='rain') drawSun(sunProgress);
    else if(!isDaytime&&bgMode==='clear') drawMoon(nightProgress);

    clouds.forEach(cloud=>{
      cloud.x+=cloud.speed;
      if(cloud.x-cloud.scale*1.5>W) cloud.x=-cloud.scale*1.5;
      drawCloud(cloud);
    });

    if(bgMode==='rain'||bgMode==='storm'||bgMode==='tornado'){
      const rainCol=bgMode==='storm'||bgMode==='tornado'?'185,195,240':'125,188,248';
      const gust = Math.sin(gustPhase) * 0.06;
      dropsFar.forEach(d=>{
        const ang = d.angleBase + gust*0.5;
        d.y+=d.speed; d.x-=d.speed*ang;
        if(d.y>H){d.y=-d.len;d.x=Math.random()*W*1.3;}
        ctx.beginPath(); ctx.moveTo(d.x,d.y); ctx.lineTo(d.x-d.len*ang*1.3,d.y+d.len);
        ctx.strokeStyle=`rgba(${rainCol},${d.opacity})`; ctx.lineWidth=0.5; ctx.stroke();
      });
      drops.forEach(d=>{
        const ang = d.angleBase + gust;
        d.y+=d.speed; d.x-=d.speed*ang;
        if(d.y>H){d.y=-d.len;d.x=Math.random()*W*1.3;}
        ctx.beginPath(); ctx.moveTo(d.x,d.y); ctx.lineTo(d.x-d.len*ang*1.3,d.y+d.len);
        ctx.strokeStyle=`rgba(${rainCol},${d.opacity})`; ctx.lineWidth=0.8; ctx.stroke();
      });
    }

    if(bgMode==='snow'){
      snowflakes.forEach(s=>{
        s.flutter+=s.flutterSpd;
        s.y+=s.speed; s.x+=s.drift+Math.sin(s.flutter)*0.35;
        if(s.y>H){s.y=-5;s.x=Math.random()*W;}
        ctx.beginPath(); ctx.arc(s.x,s.y,s.r,0,Math.PI*2);
        ctx.fillStyle=`rgba(215,228,255,${s.opacity})`; ctx.fill();
      });
    }

    if(bgMode==='fog'){
      fogParticles.forEach(fp=>{
        fp.x+=fp.speed;
        if(fp.x-fp.r>W)fp.x=-fp.r;
        const fc=isDaytime?'172,192,202':'112,132,155';
        const fg=ctx.createRadialGradient(fp.x,fp.y,0,fp.x,fp.y,fp.r);
        fg.addColorStop(0,`rgba(${fc},${fp.opacity})`); fg.addColorStop(1,`rgba(${fc},0)`);
        ctx.fillStyle=fg; ctx.beginPath(); ctx.arc(fp.x,fp.y,fp.r,0,Math.PI*2); ctx.fill();
      });
    }

    if(bgMode==='tornado') drawTornado();

    const stormModes=bgMode==='storm'||bgMode==='tornado';
    const boltInterval = perfLevel==='low' ? 140 : (bgMode==='tornado' ? 65 : 85);
    if(stormModes){
      boltTimer++;
      if(boltTimer>=boltInterval){if(Math.random()>0.2)spawnBolt();boltTimer=0;}
    } else if(bgMode==='rain'){
      boltTimer++;
      if(boltTimer>=260){if(Math.random()>0.5)spawnBolt();boltTimer=0;}
    }

    bolts=bolts.filter(b=>b.life>0);
    bolts.forEach(b=>{
      const boltColor=bgMode==='tornado'?'255,172,70':'195,215,255';
      if(b.life>0.85){const fa=(b.life-0.85)/0.15*0.05;ctx.fillStyle=`rgba(195,215,255,${fa})`;ctx.fillRect(0,0,W,H);}
      drawBoltPath(b.segments,b.life*b.bright,1.6,boltColor);
      b.branches.forEach(br=>drawBoltPath(br.segs,b.life*b.bright*br.opacity,0.7,boltColor));
      b.life-=b.decay;
    });

    if(perfLevel==='high'){
      ctx.fillStyle='rgba(0,0,0,0.014)';
      for(let y=0;y<H;y+=5) ctx.fillRect(0,y,W,2);
    }
  }
  requestAnimationFrame(draw);

  window.setBgMode = function(mode) {
    if(bgMode===mode)return;
    bgMode=mode; stars=null;
    switch(mode){
      case 'storm': initClouds(8,true); initRain(PARTICLE.rain,true); snowflakes=[]; fogParticles=[]; break;
      case 'rain':  initClouds(6,true); initRain(Math.round(PARTICLE.rain*0.58),false); snowflakes=[]; fogParticles=[]; break;
      case 'tornado':
        initClouds(10,true); initRain(PARTICLE.rain,true); snowflakes=[]; fogParticles=[];
        tornadoAge=0; tornadoRotation=0; tornadoWobble=0; tornadoRopePhase=false; tornadoIntensity=0;
        initTornadoDebris();
        break;
      case 'snow':         initClouds(4,false); drops=[]; dropsFar=[]; initSnow(PARTICLE.snow); fogParticles=[]; break;
      case 'fog':           initClouds(3,false); drops=[]; dropsFar=[]; snowflakes=[]; initFog(); break;
      case 'cloudy':        initClouds(7,true);  drops=[]; dropsFar=[]; snowflakes=[]; fogParticles=[]; break;
      case 'partlycloudy':  initClouds(3,false); drops=[]; dropsFar=[]; snowflakes=[]; fogParticles=[]; break;
      default:               initClouds(2,false); drops=[]; dropsFar=[]; snowflakes=[]; fogParticles=[]; break;
    }
  };
  window.setDaytime = function(isDay,sp,np) {
    isDaytime=isDay;
    if(sp!==undefined)sunProgress=sp;
    if(np!==undefined)nightProgress=np;
    stars=null;
  };
})();

if (!window.setBgMode)  window.setBgMode  = () => {};
if (!window.setDaytime) window.setDaytime = () => {};