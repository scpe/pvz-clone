(() => {
  const cv = document.getElementById('game');
  const ctx = cv.getContext('2d');

  const COLS = 9, ROWS = 5, CW = 80, CH = 100, GX = 120, GY = 110, W = 900, H = 620;
  const DURATION = 210;        // seconds until the last zombie has spawned
  const FLAG_AT = 170;         // seconds when the big final wave arrives

  const PLANTS = {
    sunflower: { name: 'Sunflower', cost: 50,  cd: 5,  hp: 300 },
    peashooter: { name: 'Peashooter', cost: 100, cd: 5,  hp: 300 },
    lettuce:   { name: 'Iceberg', cost: 75, cd: 12, hp: 300 },
    // merge-only plants (see MERGES); cost/cd are unused since they can't be bought
    snowpea:   { name: 'Snow Pea',  cost: 175, cd: 5,  hp: 300 },
    repeater:  { name: 'Repeater',  cost: 200, cd: 5,  hp: 300 },
    peanut:    { name: 'Pea-nut',   cost: 150, cd: 5,  hp: 1000 },   // a quarter of a wall-nut's health
    sunpea:    { name: 'Sun Pea',   cost: 150, cd: 5,  hp: 300 },
    wallnut:   { name: 'Wall-nut',  cost: 50,  cd: 20, hp: 4000 },
    cherry:    { name: 'Cherry', cost: 150, cd: 30, hp: 300 },
  };
  const ORDER = ['sunflower', 'peashooter', 'lettuce', 'wallnut', 'cherry'];

  // merging is symmetric: dropping either one on the other makes a snow pea
  const MERGES = {
    'lettuce+peashooter': 'snowpea',
    'peashooter+peashooter': 'repeater',
    'peashooter+wallnut': 'peanut',
    'peashooter+sunflower': 'sunpea',
  };
  const SHOOTERS = ['peashooter', 'snowpea', 'repeater', 'peanut', 'sunpea'];
  const mergeResult = (sel, existing) => existing ? MERGES[[sel, existing.type].sort().join('+')] : undefined;
  const canMerge = (sel, existing) => !!mergeResult(sel, existing);

  const ZOMBIES = {
    normal: { hp: 200,  speed: 20 },
    cone:   { hp: 560,  speed: 20 },
    bucket: { hp: 1300, speed: 20 },
  };

  let state, sun, plants, zombies, peas, suns, mowers, fx, cdLeft;
  let selected, shovel, time, spawnTimer, skyTimer, flagDone, mouse, last;

  function reset() {
    state = 'menu';
    sun = 150;
    plants = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
    zombies = []; peas = []; suns = []; fx = [];
    mowers = Array.from({ length: ROWS }, (_, r) => ({ row: r, x: GX - 70, active: false, gone: false }));
    cdLeft = {};
    ORDER.forEach(k => (cdLeft[k] = 0));
    selected = null; shovel = false;
    time = 0; spawnTimer = 15; skyTimer = 6; flagDone = false;
    mouse = { x: -1, y: -1 };
  }

  const cellX = c => GX + c * CW + CW / 2;
  const cellY = r => GY + r * CH + CH / 2;
  const rand = (a, b) => a + Math.random() * (b - a);

  // ---------- spawning ----------
  function spawnZombie(row) {
    const f = time / DURATION;
    const roll = Math.random();
    let kind = 'normal';
    if (f > 0.45 && roll < (f - 0.35) * 0.5) kind = 'bucket';
    else if (f > 0.15 && roll < 0.2 + f * 0.4) kind = 'cone';
    const z = ZOMBIES[kind];
    zombies.push({
      kind, row: row ?? Math.floor(Math.random() * ROWS),
      x: W + 20, hp: z.hp, maxhp: z.hp, slow: 0, freeze: 0, anim: Math.random() * 6,
    });
  }

  function spawnSun(x, y, ty, fromSky) {
    suns.push({ x, y, ty, value: 25, life: 9, landed: false, fromSky });
  }

  // ---------- update ----------
  function update(dt) {
    time += dt;

    for (const k of ORDER) cdLeft[k] = Math.max(0, cdLeft[k] - dt);

    // zombie spawning
    spawnTimer -= dt;
    if (time < DURATION && spawnTimer <= 0) {
      spawnZombie();
      spawnTimer = Math.max(3.5, 12 - (time / DURATION) * 8.5) + rand(-1, 1);
    }
    if (!flagDone && time >= FLAG_AT) {
      flagDone = true;
      for (let i = 0; i < 8; i++) setTimeout(() => state === 'play' && spawnZombie(i % ROWS), i * 500);
      fx.push({ type: 'text', text: 'A HUGE WAVE OF ZOMBIES IS APPROACHING!', t: 0, life: 4 });
    }

    // sky sun
    skyTimer -= dt;
    if (skyTimer <= 0) {
      skyTimer = rand(8, 12);
      spawnSun(rand(GX + 30, GX + COLS * CW - 30), 40, rand(GY + 60, GY + ROWS * CH - 40), true);
    }

    // plants
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const p = plants[r][c];
        if (!p) continue;
        p.anim += dt;
        if (p.hp <= 0) { plants[r][c] = null; continue; }
        if (p.type === 'sunflower') {
          p.t += dt;
          if (p.t >= 9) { p.t = 0; spawnSun(cellX(c) + rand(-10, 10), cellY(r) - 30, cellY(r) + 15, false); }
        } else if (SHOOTERS.includes(p.type)) {
          p.t = Math.min(1.4, p.t + dt);
          const cx = cellX(c);
          if (p.queue > 0 && (p.queue -= dt) <= 0) peas.push({ row: r, x: cx + 28, snow: false });  // repeater's 2nd pea
          if (p.t >= 1.4 && zombies.some(z => z.row === r && z.x > cx - 10 && z.x < W)) {
            p.t = 0;
            peas.push({ row: r, x: cx + 28, snow: p.type === 'snowpea' });
            if (p.type === 'repeater') p.queue = 0.15;
            if (p.type === 'sunpea') {
              sun += 10;
              fx.push({ type: 'plus', x: cx, y: cellY(r) - 50, t: 0, life: 0.9 });
            }
          }
        } else if (p.type === 'cherry') {
          p.t += dt;
          if (p.t >= 0.9) {
            const cx = cellX(c);
            for (const z of zombies) {
              if (Math.abs(z.row - r) <= 1 && Math.abs(z.x - cx) < CW * 1.6) z.hp -= 1800;
            }
            fx.push({ type: 'boom', x: cx, y: cellY(r), t: 0, life: 0.5 });
            plants[r][c] = null;
          }
        }
      }
    }

    // peas
    for (const p of peas) {
      p.x += 330 * dt;
      const z = zombies.find(z => z.row === p.row && Math.abs(z.x - p.x) < 22 && z.hp > 0);
      if (z) {
        z.hp -= 20;
        if (p.snow) z.slow = 4;
        p.dead = true;
        fx.push({ type: 'splat', x: p.x, y: cellY(p.row) - 12, t: 0, life: 0.2, snow: p.snow });
      }
      if (p.x > W + 20) p.dead = true;
    }
    peas = peas.filter(p => !p.dead);

    // zombies
    for (const z of zombies) {
      z.slow = Math.max(0, z.slow - dt);
      const factor = z.slow > 0 ? 0.5 : 1;
      const col = Math.floor((z.x - 20 - GX) / CW);
      const target = col >= 0 && col < COLS ? plants[z.row][col] : null;
      if (z.freeze > 0) {
        z.freeze -= dt;
        z.eating = false;
      } else if (target && target.type === 'lettuce') {
        // biting iceberg lettuce freezes the zombie solid and uses the lettuce up
        target.hp = 0;
        z.freeze = 4;
        fx.push({ type: 'splat', x: z.x, y: cellY(z.row) - 20, t: 0, life: 0.4, snow: true });
      } else if (target) {
        z.anim += dt * 4;
        target.hp -= 100 * factor * dt;
        z.eating = true;
      } else {
        z.anim += dt * 4;
        z.eating = false;
        z.x -= ZOMBIES[z.kind].speed * factor * dt;
      }
      // lawn mower / house
      if (z.x < GX - 15) {
        const m = mowers[z.row];
        if (!m.gone && !m.active) m.active = true;
        else if (m.gone && z.x < GX - 60) { state = 'lost'; }
      }
    }
    for (const m of mowers) {
      if (!m.active) continue;
      m.x += 420 * dt;
      for (const z of zombies) if (z.row === m.row && Math.abs(z.x - (m.x + 25)) < 45) z.hp = 0;
      if (m.x > W + 40) { m.active = false; m.gone = true; }
    }
    zombies = zombies.filter(z => z.hp > 0);

    // suns
    for (const s of suns) {
      if (!s.landed) {
        s.y += (s.fromSky ? 55 : 90) * dt;
        if (s.y >= s.ty) { s.y = s.ty; s.landed = true; }
      } else {
        s.life -= dt;
      }
    }
    suns = suns.filter(s => s.life > 0);

    // effects
    for (const f of fx) f.t += dt;
    fx = fx.filter(f => f.t < f.life);

    if (time >= DURATION && zombies.length === 0 && state === 'play') state = 'won';
  }

  // ---------- input ----------
  function canvasPos(e) {
    const rect = cv.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * W,
      y: ((e.clientY - rect.top) / rect.height) * H,
    };
  }

  function packetRect(i) { return { x: 90 + i * 68, y: 8, w: 62, h: 88 }; }
  const shovelRect = { x: 440, y: 8, w: 62, h: 88 };
  const inRect = (p, r) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

  function selectPlant(k) {
    shovel = false;
    selected = selected === k ? null : k;
  }

  cv.addEventListener('pointermove', e => { mouse = canvasPos(e); });
  cv.addEventListener('pointerleave', () => { mouse = { x: -1, y: -1 }; });
  cv.addEventListener('pointerdown', e => {
    const p = canvasPos(e);
    mouse = p;
    if (state === 'menu') { state = 'play'; return; }
    if (state === 'won' || state === 'lost') { reset(); return; }
    if (state === 'paused') { state = 'play'; return; }

    // suns first
    for (let i = suns.length - 1; i >= 0; i--) {
      const s = suns[i];
      if (Math.hypot(p.x - s.x, p.y - s.y) < 32) { sun += s.value; suns.splice(i, 1); return; }
    }
    // seed bar
    for (let i = 0; i < ORDER.length; i++) {
      if (inRect(p, packetRect(i))) { selectPlant(ORDER[i]); return; }
    }
    if (inRect(p, shovelRect)) { shovel = !shovel; selected = null; return; }

    // lawn
    const c = Math.floor((p.x - GX) / CW), r = Math.floor((p.y - GY) / CH);
    if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return;
    if (shovel) { plants[r][c] = null; shovel = false; return; }
    if (!selected) return;
    const existing = plants[r][c];
    const merge = canMerge(selected, existing);
    if (existing && !merge) return;
    const def = PLANTS[selected];
    if (sun < def.cost || cdLeft[selected] > 0) return;
    sun -= def.cost;
    cdLeft[selected] = def.cd;
    if (merge) {
      const result = mergeResult(selected, existing);
      plants[r][c] = { type: result, hp: PLANTS[result].hp, t: existing.type === 'peashooter' ? existing.t : 0, anim: existing.anim };
      fx.push({ type: 'splat', x: cellX(c), y: cellY(r) - 10, t: 0, life: 0.5, snow: result === 'snowpea' });
    } else {
      plants[r][c] = { type: selected, hp: def.hp, t: selected === 'sunflower' ? 3 : 0, anim: 0 };
    }
    selected = null;
  });

  window.addEventListener('keydown', e => {
    if (state === 'menu' && (e.key === 'Enter' || e.key === ' ')) { state = 'play'; return; }
    if (e.key === 'p' || e.key === 'P') {
      if (state === 'play') state = 'paused'; else if (state === 'paused') state = 'play';
    } else if (e.key === 'Escape') { selected = null; shovel = false; }
    else if (e.key === 's' || e.key === 'S') { shovel = !shovel; selected = null; }
    else if (e.key >= '1' && e.key <= '5') selectPlant(ORDER[+e.key - 1]);
  });

  // ---------- drawing ----------
  function circle(x, y, r, fill, stroke) {
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 2; ctx.stroke(); }
  }
  function ellipse(x, y, rx, ry, fill, rot = 0) {
    ctx.beginPath(); ctx.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill();
  }

  function drawPlant(type, cx, cy, p) {
    const t = p ? p.anim : 0;
    const bob = Math.sin(t * 3) * 2;
    if (type === 'sunflower') {
      ctx.fillStyle = '#2f7d32'; ctx.fillRect(cx - 3, cy - 10 + bob, 6, 42);
      ellipse(cx - 12, cy + 18, 12, 5, '#3c9a40', -0.5);
      ellipse(cx + 12, cy + 18, 12, 5, '#3c9a40', 0.5);
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        ellipse(cx + Math.cos(a) * 20, cy - 18 + bob + Math.sin(a) * 20, 10, 6, '#f7c52b', a);
      }
      circle(cx, cy - 18 + bob, 15, '#7a4a1a', '#4a2c0e');
      circle(cx - 5, cy - 21 + bob, 2, '#000'); circle(cx + 5, cy - 21 + bob, 2, '#000');
      ctx.beginPath(); ctx.arc(cx, cy - 15 + bob, 6, 0.2, Math.PI - 0.2);
      ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5; ctx.stroke();
    } else if (type === 'peashooter' || type === 'snowpea' || type === 'repeater' || type === 'sunpea') {
      const snow = type === 'snowpea', rep = type === 'repeater', sunp = type === 'sunpea';
      const body = snow ? '#7fd3f0' : rep ? '#2f9a3a' : sunp ? '#9fd84a' : '#4cb544';
      const dark = snow ? '#4aa9cf' : rep ? '#1d6b24' : sunp ? '#6a9a1f' : '#2f8a2c';
      if (sunp) for (let i = 0; i < 8; i++) {   // sunflower petals behind the head
        const a = (i / 8) * Math.PI * 2;
        ellipse(cx + Math.cos(a) * 24, cy - 14 + bob + Math.sin(a) * 24, 9, 5, '#f7c52b', a);
      }
      if (rep) { ctx.fillStyle = dark; ctx.fillRect(cx + 6, cy - 8 + bob, 22, 10); ellipse(cx + 28, cy - 3 + bob, 4, 7, dark); ellipse(cx + 28, cy - 3 + bob, 2, 4, '#173a15'); }
      ctx.fillStyle = '#2f7d32'; ctx.fillRect(cx - 3, cy - 5 + bob, 6, 38);
      ellipse(cx - 14, cy + 20, 14, 6, '#3c9a40', -0.4);
      ellipse(cx + 12, cy + 24, 10, 5, '#3c9a40', 0.4);
      ctx.fillStyle = dark; ctx.fillRect(cx + 8, cy - 22 + bob, 24, 16);
      ellipse(cx + 32, cy - 14 + bob, 5, 10, dark);
      ellipse(cx + 32, cy - 14 + bob, 2.5, 6, '#173a15');
      circle(cx, cy - 14 + bob, 20, body, dark);
      circle(cx + 5, cy - 20 + bob, 5, '#fff'); circle(cx + 7, cy - 20 + bob, 2.4, '#000');
      ellipse(cx - 18, cy - 20 + bob, 9, 5, dark, -0.8);
      if (rep) { ctx.strokeStyle = '#173a15'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(cx - 2, cy - 28 + bob); ctx.lineTo(cx + 12, cy - 24 + bob); ctx.stroke(); }
      if (sunp) circle(cx - 8, cy - 8 + bob, 4, '#ffe45e');
    } else if (type === 'lettuce') {
      ellipse(cx, cy + 30, 24, 7, 'rgba(0,0,0,0.15)');
      const leaves = ['#b9dc8f', '#cfe9a8', '#dff3c2'];
      for (let i = 0; i < 3; i++) {
        circle(cx + (i - 1) * 9, cy + 6 + Math.abs(i - 1) * 6 + bob * 0.3, 24 - i * 3, leaves[i], '#7fa856');
      }
      ctx.strokeStyle = '#8fb865'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(cx, cy + 4, 14, 3.6, 5.8); ctx.stroke();
      circle(cx - 7, cy + 2, 4, '#fff'); circle(cx + 7, cy + 2, 4, '#fff');
      circle(cx - 6, cy + 3, 1.8, '#000'); circle(cx + 8, cy + 3, 1.8, '#000');
      ctx.strokeStyle = '#4a6b2f'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(cx, cy + 9, 5, 0.2, Math.PI - 0.2); ctx.stroke();
      ctx.fillStyle = '#bfeaff'; ctx.fillRect(cx + 14, cy - 12, 3, 3); ctx.fillRect(cx - 18, cy - 4, 3, 3);
    } else if (type === 'wallnut' || type === 'peanut') {
      const frac = p ? p.hp / PLANTS[type].hp : 1;
      ellipse(cx, cy + 4, 30, 38, '#c68a3c');
      ellipse(cx, cy + 4, 30, 38, 'rgba(0,0,0,0)');
      ctx.strokeStyle = '#7c5120'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.ellipse(cx, cy + 4, 30, 38, 0, 0, Math.PI * 2); ctx.stroke();
      circle(cx - 10, cy - 6, 6, '#fff'); circle(cx + 10, cy - 6, 6, '#fff');
      circle(cx - 9, cy - 5, 2.5, '#000'); circle(cx + 11, cy - 5, 2.5, '#000');
      ctx.beginPath(); ctx.arc(cx, cy + 8, 9, 0.2, Math.PI - 0.2); ctx.stroke();
      if (type === 'peanut') {   // pea cannon on the front, plus a leaf sprout on top
        ctx.fillStyle = '#3fae3a'; ctx.strokeStyle = '#1d6b24'; ctx.lineWidth = 2;
        ctx.fillRect(cx + 18, cy - 20, 26, 18); ctx.strokeRect(cx + 18, cy - 20, 26, 18);
        ellipse(cx + 44, cy - 11, 5, 12, '#2f8a2c'); ellipse(cx + 44, cy - 11, 2.5, 7, '#173a15');
        ellipse(cx - 6, cy - 40, 12, 5, '#3fae3a', -0.5); ellipse(cx + 8, cy - 40, 12, 5, '#3fae3a', 0.5);
        ctx.strokeStyle = '#7c5120';
      }
      if (frac < 0.66) { ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(cx - 22, cy - 16); ctx.lineTo(cx - 8, cy - 4); ctx.lineTo(cx - 14, cy + 6); ctx.stroke(); }
      if (frac < 0.33) { ctx.beginPath(); ctx.moveTo(cx + 20, cy + 22); ctx.lineTo(cx + 6, cy + 10); ctx.lineTo(cx + 12, cy - 2); ctx.stroke(); }
    } else if (type === 'cherry') {
      const s = p ? 1 + Math.min(p.t / 0.9, 1) * 0.35 : 1;
      ctx.save(); ctx.translate(cx, cy + 6); ctx.scale(s, s);
      ctx.strokeStyle = '#2f7d32'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(-14, 0); ctx.quadraticCurveTo(-4, -30, 6, -34); ctx.moveTo(14, 0); ctx.quadraticCurveTo(10, -26, 6, -34); ctx.stroke();
      circle(-15, 8, 17, p && p.t > 0.45 && Math.floor(p.t * 12) % 2 ? '#ff7070' : '#c8102e', '#7d0a1d');
      circle(15, 8, 17, p && p.t > 0.45 && Math.floor(p.t * 12) % 2 ? '#ff7070' : '#c8102e', '#7d0a1d');
      circle(-19, 3, 4, '#fff'); circle(11, 3, 4, '#fff'); circle(-18, 4, 1.8, '#000'); circle(12, 4, 1.8, '#000');
      ctx.restore();
    }
  }

  function drawZombie(z) {
    const cx = z.x, cy = cellY(z.row) + 8;
    const sw = Math.sin(z.anim) * 6;
    ctx.save();
    if (z.slow > 0) ctx.globalAlpha = 0.92;
    // legs
    ctx.fillStyle = '#4a4a6a';
    ctx.fillRect(cx - 12, cy + 18, 9, 30 + sw * (z.eating ? 0 : 0.6));
    ctx.fillRect(cx + 3, cy + 18, 9, 30 - sw * (z.eating ? 0 : 0.6));
    // body
    ctx.fillStyle = '#6b6b8f'; ctx.fillRect(cx - 16, cy - 22, 32, 44);
    ctx.fillStyle = '#c0392b'; ctx.fillRect(cx - 3, cy - 20, 6, 24);   // tie
    // arms (reach forward / left)
    ctx.fillStyle = '#8fae78';
    const reach = z.eating ? Math.sin(z.anim * 2) * 4 : 0;
    ctx.fillRect(cx - 40 + reach, cy - 18, 28, 8);
    ctx.fillRect(cx - 36 + reach, cy - 4, 24, 8);
    // head
    const dmg = 1 - z.hp / z.maxhp;
    circle(cx, cy - 34, 17, dmg > 0.6 ? '#7c966a' : '#9bbf86', '#4f6b3f');
    circle(cx - 6, cy - 37, 4, '#fff'); circle(cx + 6, cy - 37, 4, '#fff');
    circle(cx - 7, cy - 37, 1.6, '#000'); circle(cx + 5, cy - 37, 1.6, '#000');
    ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(cx - 6, cy - 26); ctx.lineTo(cx + 6, cy - 26); ctx.stroke();
    if (z.kind === 'cone') {
      ctx.fillStyle = '#e8741a'; ctx.beginPath();
      ctx.moveTo(cx - 14, cy - 44); ctx.lineTo(cx + 14, cy - 44); ctx.lineTo(cx, cy - 78); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.fillRect(cx - 9, cy - 56, 18, 4);
    } else if (z.kind === 'bucket') {
      ctx.fillStyle = '#9aa5b1'; ctx.beginPath();
      ctx.moveTo(cx - 17, cy - 40); ctx.lineTo(cx + 17, cy - 40); ctx.lineTo(cx + 13, cy - 72); ctx.lineTo(cx - 13, cy - 72); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#5c6670'; ctx.stroke();
      ctx.fillStyle = '#5c6670'; ctx.fillRect(cx - 19, cy - 44, 38, 5);
    }
    if (z.freeze > 0) {
      ctx.fillStyle = 'rgba(150,220,255,0.6)'; ctx.fillRect(cx - 42, cy - 80, 84, 132);
      ctx.strokeStyle = '#e8f8ff'; ctx.lineWidth = 3; ctx.strokeRect(cx - 42, cy - 80, 84, 132);
    } else if (z.slow > 0) { ctx.fillStyle = 'rgba(120,200,255,0.35)'; ctx.fillRect(cx - 40, cy - 78, 80, 128); }
    ctx.restore();
  }

  function drawSun(s) {
    ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(performance.now() / 1500);
    if (s.landed && s.life < 3 && Math.floor(s.life * 6) % 2) ctx.globalAlpha = 0.45;
    ctx.fillStyle = '#ffd23f';
    for (let i = 0; i < 10; i++) {
      ctx.rotate((Math.PI * 2) / 10);
      ctx.beginPath(); ctx.moveTo(-5, -22); ctx.lineTo(0, -32); ctx.lineTo(5, -22); ctx.fill();
    }
    circle(0, 0, 22, '#ffe45e', '#e8a200');
    ctx.restore();
  }

  function drawLawn() {
    // house strip
    ctx.fillStyle = '#6d4c2e'; ctx.fillRect(0, GY, GX, ROWS * CH);
    ctx.fillStyle = '#8b5e3c'; ctx.fillRect(0, GY, 28, ROWS * CH);
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        ctx.fillStyle = (r + c) % 2 ? '#5d9a3a' : '#6aaa45';
        ctx.fillRect(GX + c * CW, GY + r * CH, CW, CH);
      }
    }
    ctx.fillStyle = '#4a7a2e'; ctx.fillRect(GX + COLS * CW, GY, W - GX - COLS * CW, ROWS * CH);
    // top bar
    ctx.fillStyle = '#4a3220'; ctx.fillRect(0, 0, W, GY);
    ctx.fillStyle = '#5c4029'; ctx.fillRect(0, GY - 6, W, 6);
  }

  function drawHUD() {
    // sun counter
    ctx.fillStyle = '#f3e4b0'; ctx.fillRect(10, 8, 70, 88);
    ctx.strokeStyle = '#8a6d2f'; ctx.lineWidth = 2; ctx.strokeRect(10, 8, 70, 88);
    ctx.save(); ctx.translate(45, 36); ctx.scale(0.6, 0.6); ctx.fillStyle = '#ffd23f'; circle(0, 0, 22, '#ffe45e', '#e8a200'); ctx.restore();
    ctx.fillStyle = '#3a2a10'; ctx.font = 'bold 24px system-ui'; ctx.textAlign = 'center';
    ctx.fillText(Math.floor(sun), 45, 82);

    ORDER.forEach((k, i) => {
      const r = packetRect(i), def = PLANTS[k];
      const afford = sun >= def.cost, ready = cdLeft[k] <= 0;
      ctx.fillStyle = '#e9f1d0'; ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = selected === k ? '#ffeb3b' : '#6b7d4a'; ctx.lineWidth = selected === k ? 4 : 2;
      ctx.strokeRect(r.x, r.y, r.w, r.h);
      ctx.save(); ctx.beginPath(); ctx.rect(r.x, r.y, r.w, r.h); ctx.clip();
      ctx.translate(r.x + r.w / 2, r.y + 34); ctx.scale(0.48, 0.48);
      drawPlant(k, 0, 8, null);
      ctx.restore();
      ctx.fillStyle = '#2b3a1a'; ctx.font = 'bold 10px system-ui'; ctx.textAlign = 'center';
      ctx.fillText(def.name, r.x + r.w / 2, r.y + r.h - 16);
      ctx.font = 'bold 13px system-ui'; ctx.fillText(def.cost, r.x + r.w / 2, r.y + r.h - 3);
      ctx.fillStyle = '#6b7d4a'; ctx.font = '9px system-ui'; ctx.textAlign = 'left'; ctx.fillText(i + 1, r.x + 3, r.y + 11);
      if (!ready) {
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(r.x, r.y, r.w, r.h * (cdLeft[k] / def.cd));
      }
      if (!afford) { ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(r.x, r.y, r.w, r.h); }
    });

    // shovel
    ctx.fillStyle = '#d9c7a0'; ctx.fillRect(shovelRect.x, shovelRect.y, shovelRect.w, shovelRect.h);
    ctx.strokeStyle = shovel ? '#ffeb3b' : '#7a6a45'; ctx.lineWidth = shovel ? 4 : 2;
    ctx.strokeRect(shovelRect.x, shovelRect.y, shovelRect.w, shovelRect.h);
    ctx.fillStyle = '#7a5230'; ctx.fillRect(shovelRect.x + 29, shovelRect.y + 12, 5, 40);
    ctx.fillStyle = '#9aa5b1'; ctx.beginPath();
    ctx.moveTo(shovelRect.x + 18, shovelRect.y + 52); ctx.lineTo(shovelRect.x + 46, shovelRect.y + 52);
    ctx.lineTo(shovelRect.x + 31, shovelRect.y + 74); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#2b3a1a'; ctx.font = '9px system-ui'; ctx.textAlign = 'left'; ctx.fillText('S', shovelRect.x + 3, shovelRect.y + 11);

    // progress bar
    const bx = 600, by = 38, bw = 280, bh = 18;
    ctx.fillStyle = '#2b1d10'; ctx.fillRect(bx, by, bw, bh);
    const prog = Math.min(1, time / DURATION);
    ctx.fillStyle = '#7bd34a'; ctx.fillRect(bx + 2, by + 2, (bw - 4) * prog, bh - 4);
    ctx.strokeStyle = '#e8d9b0'; ctx.lineWidth = 2; ctx.strokeRect(bx, by, bw, bh);
    const fx0 = bx + (bw * FLAG_AT) / DURATION;
    ctx.fillStyle = '#e53935'; ctx.fillRect(fx0, by - 10, 2, 12); ctx.fillRect(fx0, by - 10, 10, 6);
    circle(bx + 2 + (bw - 4) * prog, by + bh / 2, 7, '#9bbf86', '#4f6b3f');
    ctx.fillStyle = '#e8d9b0'; ctx.font = '12px system-ui'; ctx.textAlign = 'center';
    ctx.fillText('Level progress', bx + bw / 2, by + 38);
  }

  function drawGhost() {
    const c = Math.floor((mouse.x - GX) / CW), r = Math.floor((mouse.y - GY) / CH);
    if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return;
    if (shovel) {
      ctx.fillStyle = 'rgba(255,60,60,0.25)'; ctx.fillRect(GX + c * CW, GY + r * CH, CW, CH); return;
    }
    if (!selected) return;
    const merge = canMerge(selected, plants[r][c]);
    const ok = !plants[r][c] || merge;
    ctx.fillStyle = merge ? 'rgba(120,200,255,0.4)' : ok ? 'rgba(255,255,255,0.2)' : 'rgba(255,0,0,0.2)';
    ctx.fillRect(GX + c * CW, GY + r * CH, CW, CH);
    if (ok && !merge) { ctx.save(); ctx.globalAlpha = 0.5; drawPlant(selected, cellX(c), cellY(r), null); ctx.restore(); }
  }

  function drawFx() {
    for (const f of fx) {
      const k = f.t / f.life;
      if (f.type === 'boom') {
        ctx.globalAlpha = 1 - k;
        circle(f.x, f.y, 40 + k * 110, '#ff9800'); circle(f.x, f.y, 20 + k * 80, '#ffeb3b');
        ctx.globalAlpha = 1;
      } else if (f.type === 'splat') {
        ctx.globalAlpha = 1 - k; circle(f.x, f.y, 6 + k * 8, f.snow ? '#bff0ff' : '#8de36b'); ctx.globalAlpha = 1;
      } else if (f.type === 'plus') {
        ctx.globalAlpha = 1 - k; ctx.fillStyle = '#ffd23f'; ctx.strokeStyle = '#7a5a00'; ctx.lineWidth = 3;
        ctx.font = 'bold 20px system-ui'; ctx.textAlign = 'center';
        ctx.strokeText('+10', f.x, f.y - k * 30); ctx.fillText('+10', f.x, f.y - k * 30); ctx.globalAlpha = 1;
      } else if (f.type === 'text') {
        ctx.globalAlpha = Math.min(1, (f.life - f.t) * 1.5);
        ctx.fillStyle = '#d62828'; ctx.font = 'bold 32px system-ui'; ctx.textAlign = 'center';
        ctx.strokeStyle = '#000'; ctx.lineWidth = 5; ctx.strokeText(f.text, W / 2, GY + 260);
        ctx.fillText(f.text, W / 2, GY + 260); ctx.globalAlpha = 1;
      }
    }
  }

  function drawOverlay(title, lines, color) {
    ctx.fillStyle = 'rgba(0,0,0,0.65)'; ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center';
    ctx.fillStyle = color; ctx.font = 'bold 54px system-ui'; ctx.fillText(title, W / 2, H / 2 - 40);
    ctx.fillStyle = '#fff'; ctx.font = '20px system-ui';
    lines.forEach((l, i) => ctx.fillText(l, W / 2, H / 2 + 10 + i * 30));
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    drawLawn();
    // mowers
    for (const m of mowers) {
      if (m.gone) continue;
      const y = cellY(m.row) + 14;
      ctx.fillStyle = '#d32f2f'; ctx.fillRect(m.x, y - 14, 50, 28);
      ctx.fillStyle = '#b71c1c'; ctx.fillRect(m.x + 6, y - 22, 20, 10);
      circle(m.x + 10, y + 16, 8, '#222'); circle(m.x + 40, y + 16, 8, '#222');
    }
    drawGhost();
    // draw per-row so zombies and plants overlap naturally
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const p = plants[r][c];
        if (p) drawPlant(p.type, cellX(c), cellY(r), p);
      }
      for (const z of zombies) if (z.row === r) drawZombie(z);
      for (const p of peas) if (p.row === r) circle(p.x, cellY(r) - 14, 8, p.snow ? '#a6e8ff' : '#6fdc4a', p.snow ? '#4aa9cf' : '#2f8a2c');
    }
    drawFx();
    for (const s of suns) drawSun(s);
    drawHUD();

    if (state === 'menu') drawOverlay('Plants vs. Zombies', ['Fan-made mini clone', 'Click anywhere to start', 'Survive the whole wave — keep zombies away from your house!'], '#9be564');
    else if (state === 'paused') drawOverlay('Paused', ['Click or press P to resume'], '#ffd23f');
    else if (state === 'won') drawOverlay('You survived!', ['The zombies didn\'t eat your brains.', 'Click to play again'], '#9be564');
    else if (state === 'lost') drawOverlay('THE ZOMBIES ATE YOUR BRAINS!', ['Click to try again'], '#ff5252');
  }

  // ---------- loop ----------
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000 || 0);
    last = now;
    if (state === 'play') update(dt);
    draw();
    requestAnimationFrame(frame);
  }

  reset();
  requestAnimationFrame(t => { last = t; frame(t); });
})();
