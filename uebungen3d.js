/* =====================================================================
   SWEAT4 – 3D-Übungsengine  (lädt erst bei Bedarf; benötigt three.min.js r149, MIT-Lizenz)

   Aufbau
   - Figur: prozedurales, anatomisch proportioniertes Modell (ca. 1,80 m). In jedem Bild
     werden die Gelenke neu berechnet: Rumpf vorwärts (Becken → Lendenwirbel → Brustkorb),
     Arme und Beine per analytischer 2-Gelenk-IK. Hände bleiben so an Stange/Griff,
     Füße am Boden, Geräte bewegen sich passend zum Körper.
   - Bewegungsvorlagen (TPL): eine Vorlage beschreibt Ausgangs- und Endposition,
     Geräte und Phasen. Übungen nutzen Vorlagen mit Parametern (z. B. Neigung, Griff).
   - Viewer: Kamera, Steuerung, Muskel-Hervorhebung, Zeitlupe, Ansichten.

   Neue Übung ergänzen: Eintrag in uebungen-katalog.js mit anim:{ t:'vorlage', …parameter }.
   Neue Vorlage: TPL.name = p => ({ cam, timing, setup(kit,MT), pose(s), props(J,s) })
   ===================================================================== */
(function () {
  'use strict';
  const T = window.THREE;
  if (!T) throw new Error('three.js fehlt');
  if (T.ColorManagement) T.ColorManagement.legacyMode = false; // Hex-Farben als sRGB

  const D2R = Math.PI / 180;
  const V = (x = 0, y = 0, z = 0) => new T.Vector3(x, y, z);
  const lerp = (a, b, t) => a + (b - a) * t;
  const lv = (a, b, t) => a.clone().lerp(b, t);
  const ease = t => (t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const UP = V(0, 1, 0), DOWN = V(0, -1, 0);
  const nz = v => v.clone().normalize();

  /* ---------- Körpermaße (Meter) ---------- */
  const DIM = { thigh: .44, shin: .43, ank: .08, hipW: .095, lumbar: .22, thor: .28, shW: .19, up: .30, fore: .32 };
  const LEG = DIM.thigh + DIM.shin, ARM = DIM.up + DIM.fore;
  const STAND_Y = DIM.ank + LEG - .006;

  /* ---------- Kinematik ---------- */
  function frameFrom(yaw, pitch, roll) {
    const q = new T.Quaternion().setFromEuler(new T.Euler(pitch * D2R, yaw * D2R, roll * D2R, 'YXZ'));
    return { l: V(1, 0, 0).applyQuaternion(q), u: V(0, 1, 0).applyQuaternion(q), f: V(0, 0, 1).applyQuaternion(q) };
  }
  const rotA = (v, axis, deg) => v.clone().applyAxisAngle(nz(axis), deg * D2R);
  const horiz = v => { const h = V(v.x, 0, v.z); return h.lengthSq() < 1e-6 ? V(0, 0, 1) : h.normalize(); };
  const perp = (v, n) => { const r = v.clone().addScaledVector(n, -v.dot(n)); return r.lengthSq() < 1e-9 ? V(1, 0, 0) : r.normalize(); };

  // Rumpf: Beckenrahmen (yaw/pitch/roll) + Brustrahmen (flex = Wirbelsäulenbeugung, twist, bend)
  function kin(p) {
    const P = frameFrom(p.yaw || 0, p.pitch || 0, p.roll || 0);
    let cu = rotA(P.u, P.l, p.flex || 0), cf = rotA(P.f, P.l, p.flex || 0), cl = P.l.clone();
    if (p.twist) { cl = rotA(cl, cu, p.twist); cf = rotA(cf, cu, p.twist); }
    if (p.bend) { cu = rotA(cu, cf, p.bend); cl = rotA(cl, cf, p.bend); }
    const pel = p.pelvis.clone();
    const mid = pel.clone().addScaledVector(P.u, DIM.lumbar);
    const S = mid.clone().addScaledVector(cu, DIM.thor);
    return { P, l: cl, u: cu, f: cf, pel, mid, S };
  }
  const shoulder = (K, s, shrug = 0) => K.S.clone().addScaledVector(K.l, s * DIM.shW).addScaledVector(K.u, shrug * .065 - .015);
  const hip = (K, s) => K.pel.clone().addScaledVector(K.P.l, s * DIM.hipW);

  // Zwei-Gelenk-IK (analytisch, Pol-Richtung bestimmt Ellbogen/Knie)
  function ik(A0, Tg, a, b, pole) {
    const d0 = Tg.clone().sub(A0);
    let d = d0.length();
    const n = d > 1e-6 ? d0.clone().divideScalar(d) : V(0, -1, 0);
    d = clamp(d, Math.abs(a - b) + 1e-3, a + b - 1e-4);
    const ca = (a * a + d * d - b * b) / (2 * a * d), sa = Math.sqrt(Math.max(0, 1 - ca * ca));
    const pp = perp(pole, n);
    return { E: A0.clone().addScaledVector(n, a * ca).addScaledVector(pp, a * sa), T: A0.clone().addScaledVector(n, d), pole: pp };
  }

  function solve(pose) {
    const K = kin(pose), J = { K, pose };
    for (const [side, s] of [['L', 1], ['R', -1]]) {
      const sh = shoulder(K, s, pose.shrug || 0);
      const ht = pose.hand && pose.hand[side] ? pose.hand[side] : sh.clone().addScaledVector(K.u, -.6).addScaledVector(K.f, .04).addScaledVector(K.l, s * .03);
      const ep = pose.elbow && pose.elbow[side] ? pose.elbow[side] : K.f.clone().multiplyScalar(-1).addScaledVector(K.l, s * .3);
      const a = ik(sh, ht, DIM.up, DIM.fore, ep);
      const hp = hip(K, s);
      const at = pose.ankle && pose.ankle[side] ? pose.ankle[side] : hp.clone().addScaledVector(K.P.u, -(LEG - .012));
      const kp = pose.knee && pose.knee[side] ? pose.knee[side] : K.P.f.clone();
      const g = ik(hp, at, DIM.thigh, DIM.shin, kp);
      let fd = pose.foot && pose.foot[side] ? pose.foot[side].clone() : horiz(K.P.f);
      J[side] = { sh, el: a.E, hand: a.T, epole: a.pole, hip: hp, knee: g.E, ankle: g.T, kpole: g.pole, foot: nz(fd) };
    }
    return J;
  }

  /* ---------- Mesh-Hilfen ---------- */
  const _m4 = new T.Matrix4();
  function basisFromY(y, hint) {
    y = nz(y);
    let x = V().crossVectors(y, hint);
    if (x.lengthSq() < 1e-6) x = V().crossVectors(y, Math.abs(y.x) < .9 ? V(1, 0, 0) : V(0, 0, 1));
    x.normalize();
    return { x, y, z: V().crossVectors(x, y).normalize() };
  }
  function place(m, pos, b, sx, sy, sz) {
    _m4.makeBasis(b.x, b.y, b.z); m.quaternion.setFromRotationMatrix(_m4);
    m.position.copy(pos); m.scale.set(sx, sy, sz);
  }
  function placeSeg(m, a, b, hint, r) {
    const d = b.clone().sub(a);
    place(m, a.clone().add(b).multiplyScalar(.5), basisFromY(d, hint || V(0, 0, 1)), r, d.length() || 1e-4, r);
  }
  const orientY = (o, axis) => o.quaternion.setFromUnitVectors(UP, nz(axis));
  const orientX = (o, axis) => o.quaternion.setFromUnitVectors(V(1, 0, 0), nz(axis));

  /* ---------- Materialien ---------- */
  function mats() {
    const M = (c, r = .7, m = 0) => new T.MeshStandardMaterial({ color: c, roughness: r, metalness: m });
    return {
      skin: M(0x5a3a28, .74), shirt: M(0x2a2a2a, .92), shorts: M(0x181818, .94), shoe: M(0xd6d0c6, .7), hair: M(0x0d0d0d, .95), sole: M(0x222222, .85),
      skinW: M(0xd6a184, .76), hairW: M(0xd8b26a, .82), topW: M(0x151515, .9), legW: M(0x111111, .93), shoeW: M(0xe8e3da, .7),
      steel: M(0xa0a0a0, .3, .85), dark: M(0x1b1b1b, .55, .3), pad: M(0x2e2e2e, .75), frame: M(0x3c3c3c, .5, .5),
      gold: M(0xbe9b5c, .4, .7), cable: M(0x909090, .35, .7), box: M(0x3a2f24, .85), mat: M(0x2a2420, .95),
      prim: new T.MeshStandardMaterial({ color: 0xd9a744, roughness: .45, emissive: 0x8a5a10, emissiveIntensity: .7 }),
      sec: new T.MeshStandardMaterial({ color: 0x9a7440, roughness: .55, emissive: 0x3a2508, emissiveIntensity: .5 })
    };
  }

  /* ---------- Figur ---------- */
  /* Figurstile: gleiche Gelenklängen (Bewegung & Geräte bleiben identisch), andere Statur, Materialien und Haare */
  const FIG_STYLES = {
    m: { mat: {}, k: {} },
    w: {
      mat: { skin: 'skinW', hair: 'hairW', shirt: 'topW', shorts: 'legW', shoe: 'shoeW',
        abdomen: 'skinW', abs: 'skinW', obl: 'skinW', lowBack: 'skinW',
        thigh: 'legW', quad: 'legW', ham: 'legW', add: 'legW', knJ: 'legW', shin: 'legW', calf: 'legW', short: 'legW' },
      k: { chest: [.88, .95, .92], pec: [.82, .86, .98], traps: [.7, .7, .7], upBack: [.85, .9, .9], lat: [.74, .9, .8],
        abdomen: [.88, 1, .9], abs: [.84, 1, .8], obl: [.82, 1, .84], lowBack: [.88, 1, .9],
        pelvis: [1.08, 1, 1.05], glute: [1.13, 1.08, 1.14], abd: [1.05, 1, 1.05],
        shJ: [.84, .84, .84], dF: [.8, .9, .8], dS: [.8, .9, .8], dR: [.8, .9, .8], uArm: [.8, 1, .8], bic: [.74, .9, .74], tri: [.8, .95, .8],
        elJ: [.85, .85, .85], fArm: [.82, 1, .82], fMus: [.78, .95, .78], hand: [.88, .92, .88],
        thigh: [.97, 1, .97], quad: [.92, 1, .92], ham: [.96, 1, .96], knJ: [.9, .9, .9], shin: [.86, 1, .86], calf: [.88, .95, .88],
        neck: [.82, 1, .82], head: [.94, .95, .94], jaw: [.86, .9, .9], nose: [.85, .85, .85], hair: [1.05, 1.06, 1.07] },
      ponytail: true,
    },
  };
  class Figure {
    constructor(scene, MT, style = 'm') {
      this.g = new T.Group(); scene.add(this.g); this.MT = MT;
      this.style = FIG_STYLES[style] ? style : 'm'; const ST = FIG_STYLES[this.style];
      const baseOf = n => n.replace(/[LR]$/, '');
      const matFor = (name, mat) => { const k = ST.mat[baseOf(name)]; if (k) return MT[k]; const key = Object.keys(MT).find(x => MT[x] === mat); return ST.mat[key] ? MT[ST.mat[key]] : mat; };
      this.kOf = name => ST.k[baseOf(name)];
      this.sph = new T.SphereGeometry(1, 18, 14);
      this.cylT = new T.CylinderGeometry(.8, 1, 1, 14, 1, true);
      this.m = {}; this.muscles = {};
      const add = (name, geo, mat, muscle) => {
        mat = matFor(name, mat);
        const me = new T.Mesh(geo, mat); me.castShadow = true; this.g.add(me); this.m[name] = me; me.userData.base = mat;
        if (muscle) (this.muscles[muscle] = this.muscles[muscle] || []).push(me); return me;
      };
      const S = this.sph, C = this.cylT;
      add('head', S, MT.skin); add('hair', S, MT.hair); add('nose', S, MT.skin); add('earL', S, MT.skin); add('earR', S, MT.skin); add('jaw', S, MT.skin); add('neck', C, MT.skin);
      add('chest', S, MT.shirt); add('abdomen', S, MT.shirt); add('pelvis', S, MT.shorts);
      add('abs', S, MT.shirt, 'abs'); add('lowBack', S, MT.shirt, 'lowerBack'); add('upBack', S, MT.shirt, 'upperBack'); add('traps', S, MT.skin, 'traps');
      for (const s of ['L', 'R']) {
        add('pec' + s, S, MT.shirt, 'chest'); add('lat' + s, S, MT.shirt, 'lats'); add('obl' + s, S, MT.shirt, 'obliques');
        add('glute' + s, S, MT.shorts, 'glutes'); add('abd' + s, S, MT.shorts, 'abductors'); add('hipf' + s, S, MT.shorts, 'hipFlexors');
        add('shJ' + s, S, MT.skin); add('dF' + s, S, MT.skin, 'frontDelt'); add('dS' + s, S, MT.skin, 'sideDelt'); add('dR' + s, S, MT.skin, 'rearDelt');
        add('uArm' + s, C, MT.skin); add('bic' + s, S, MT.skin, 'biceps'); add('tri' + s, S, MT.skin, 'triceps');
        add('elJ' + s, S, MT.skin); add('fArm' + s, C, MT.skin); add('fMus' + s, S, MT.skin, 'forearms'); add('hand' + s, S, MT.skin);
        add('thigh' + s, C, MT.skin); add('short' + s, C, MT.shorts); add('quad' + s, S, MT.skin, 'quads'); add('ham' + s, S, MT.skin, 'hamstrings'); add('add' + s, S, MT.skin, 'adductors');
        add('knJ' + s, S, MT.skin); add('shin' + s, C, MT.skin); add('calf' + s, S, MT.skin, 'calves'); add('shoe' + s, S, MT.shoe); add('sole' + s, S, MT.sole);
      }
      if (ST.ponytail) { add('tail1', S, MT.hair); add('tail2', S, MT.hair); add('tail3', S, MT.hair); add('tie', S, MT.gold); }
    }
    highlight(prim, sec, on) {
      for (const [id, arr] of Object.entries(this.muscles)) {
        const mat = !on ? null : prim.includes(id) ? this.MT.prim : sec.includes(id) ? this.MT.sec : null;
        arr.forEach(me => me.material = mat || me.userData.base);
      }
    }
    update(J) {
      const K = J.K, m = this.m, P = K.P;
      const pb = { x: P.l, y: P.u, z: P.f };
      place(m.pelvis, K.pel.clone().addScaledVector(P.u, .025), pb, .172, .125, .118);
      const ua = nz(P.u.clone().add(K.u)), fa = perp(P.f.clone().add(K.f), ua), la = V().crossVectors(ua, fa).normalize();
      const ab = { x: la, y: ua, z: fa };
      place(m.abdomen, K.mid.clone().addScaledVector(ua, -.005), ab, .15, .17, .108);
      place(m.abs, K.mid.clone().addScaledVector(fa, .076), ab, .085, .155, .042);
      place(m.lowBack, K.mid.clone().addScaledVector(fa, -.074).addScaledVector(ua, -.03), ab, .088, .125, .046);
      const cb = { x: K.l, y: K.u, z: K.f };
      place(m.chest, K.S.clone().addScaledVector(K.u, -.14), cb, .2, .168, .12);
      place(m.upBack, K.S.clone().addScaledVector(K.u, -.12).addScaledVector(K.f, -.083), cb, .135, .1, .047);
      place(m.traps, K.S.clone().addScaledVector(K.u, .012).addScaledVector(K.f, -.03), cb, .12, .055, .055);
      // Kopf
      const hd = rotA(K.u, K.l, -(J.pose.head || 0)), hf = perp(rotA(K.f, K.l, -(J.pose.head || 0)), hd);
      const hl = V().crossVectors(hd, hf).normalize();
      const hc = K.S.clone().addScaledVector(K.u, .05).addScaledVector(hd, .165);
      const hb = { x: hl, y: hd, z: hf };
      place(m.head, hc, hb, .09, .112, .102);
      place(m.jaw, hc.clone().addScaledVector(hd, -.06).addScaledVector(hf, .03), hb, .07, .055, .07);
      place(m.hair, hc.clone().addScaledVector(hd, .03).addScaledVector(hf, -.018), hb, .094, .092, .1);
      place(m.nose, hc.clone().addScaledVector(hf, .1).addScaledVector(hd, -.012), hb, .014, .024, .02);
      place(m.earL, hc.clone().addScaledVector(hl, .088), hb, .012, .028, .02);
      place(m.earR, hc.clone().addScaledVector(hl, -.088), hb, .012, .028, .02);
      placeSeg(m.neck, hc.clone().addScaledVector(hd, -.06), K.S.clone().addScaledVector(K.u, -.02), hf, .056);
      for (const [side, s] of [['L', 1], ['R', -1]]) {
        const j = J[side];
        place(m['pec' + side], K.S.clone().addScaledVector(K.u, -.115).addScaledVector(K.f, .074).addScaledVector(K.l, s * .084), cb, .09, .068, .05);
        place(m['lat' + side], K.S.clone().addScaledVector(K.u, -.21).addScaledVector(K.f, -.03).addScaledVector(K.l, s * .125), cb, .062, .135, .068);
        place(m['obl' + side], K.mid.clone().addScaledVector(la, s * .12).addScaledVector(fa, .018), ab, .042, .12, .074);
        place(m['glute' + side], K.pel.clone().addScaledVector(P.f, -.07).addScaledVector(P.l, s * .074).addScaledVector(P.u, -.035), pb, .088, .095, .072);
        place(m['abd' + side], K.pel.clone().addScaledVector(P.l, s * .15).addScaledVector(P.u, .035), pb, .044, .072, .062);
        place(m['hipf' + side], K.pel.clone().addScaledVector(P.f, .072).addScaledVector(P.l, s * .076).addScaledVector(P.u, -.07), pb, .04, .062, .036);
        // Arm
        const ad = nz(j.el.clone().sub(j.sh));
        const az = perp(j.epole.clone().multiplyScalar(-1), ad), ax = V().crossVectors(ad, az).normalize();
        const abs_ = { x: ax, y: ad, z: az }, outw = perp(K.l.clone().multiplyScalar(s), ad);
        place(m['shJ' + side], j.sh, abs_, .058, .058, .058);
        place(m['dF' + side], j.sh.clone().addScaledVector(ad, .045).addScaledVector(az, .03).addScaledVector(outw, .013), abs_, .042, .062, .035);
        place(m['dS' + side], j.sh.clone().addScaledVector(ad, .05).addScaledVector(outw, .038), abs_, .035, .064, .044);
        place(m['dR' + side], j.sh.clone().addScaledVector(ad, .045).addScaledVector(az, -.03).addScaledVector(outw, .013), abs_, .042, .062, .035);
        placeSeg(m['uArm' + side], j.el, j.sh, az, .052);
        const um = j.sh.clone().lerp(j.el, .55);
        place(m['bic' + side], um.clone().addScaledVector(az, .023), abs_, .038, .088, .036);
        place(m['tri' + side], um.clone().lerp(j.sh, .15).addScaledVector(az, -.025), abs_, .04, .105, .036);
        place(m['elJ' + side], j.el, abs_, .039, .039, .039);
        const fd = nz(j.hand.clone().sub(j.el)), wrist = j.hand.clone().addScaledVector(fd, -.07);
        placeSeg(m['fArm' + side], wrist, j.el, az, .041);
        place(m['fMus' + side], j.el.clone().addScaledVector(fd, .075), basisFromY(fd, az), .044, .088, .039);
        place(m['hand' + side], j.hand.clone().addScaledVector(fd, -.012), basisFromY(fd, az), .03, .054, .038);
        // Bein
        const ld = nz(j.knee.clone().sub(j.hip)), lz = perp(j.kpole, ld), inw = perp(P.l.clone().multiplyScalar(-s), ld);
        const lb = { x: V().crossVectors(ld, lz).normalize(), y: ld, z: lz };
        placeSeg(m['thigh' + side], j.knee, j.hip, lz, .078);
        placeSeg(m['short' + side], j.hip.clone().addScaledVector(ld, .2), j.hip.clone().addScaledVector(ld, -.02), lz, .088);
        const tm = j.hip.clone().lerp(j.knee, .55);
        place(m['quad' + side], tm.clone().addScaledVector(lz, .038), lb, .06, .165, .048);
        place(m['ham' + side], tm.clone().addScaledVector(lz, -.038), lb, .055, .155, .046);
        place(m['add' + side], j.hip.clone().lerp(j.knee, .35).addScaledVector(inw, .036), lb, .038, .115, .044);
        place(m['knJ' + side], j.knee, lb, .052, .052, .052);
        const sd = nz(j.ankle.clone().sub(j.knee));
        placeSeg(m['shin' + side], j.ankle, j.knee, lz, .05);
        place(m['calf' + side], j.knee.clone().addScaledVector(sd, .13).addScaledVector(perp(lz, sd), -.032), basisFromY(sd, lz), .049, .105, .046);
        // Fuß (Richtung = j.foot, Sohle senkrecht dazu "unten")
        const fwd = j.foot, fu = perp(sd.clone().multiplyScalar(-1).add(UP.clone().multiplyScalar(.6)), fwd);
        const fb = { x: V().crossVectors(fu, fwd).normalize(), y: fu, z: fwd };
        const fc = j.ankle.clone().addScaledVector(fwd, .06).addScaledVector(fu, -.04);
        place(m['shoe' + side], fc, fb, .05, .045, .13);
        place(m['sole' + side], fc.clone().addScaledVector(fu, -.032), fb, .052, .014, .132);
      }
      if (m.tail1) { // Pferdeschwanz, hängt am Hinterkopf
        place(m.tie, hc.clone().addScaledVector(hd, .035).addScaledVector(hf, -.1), hb, .02, .02, .02);
        place(m.tail1, hc.clone().addScaledVector(hd, .02).addScaledVector(hf, -.118), hb, .036, .05, .036);
        place(m.tail2, hc.clone().addScaledVector(hd, -.05).addScaledVector(hf, -.128), hb, .032, .07, .032);
        place(m.tail3, hc.clone().addScaledVector(hd, -.125).addScaledVector(hf, -.122), hb, .022, .055, .024);
      }
      for (const [name, me] of Object.entries(m)) { const k = this.kOf(name); if (k) { me.scale.x *= k[0]; me.scale.y *= k[1]; me.scale.z *= k[2]; } }
    }
    dispose() { this.sph.dispose(); this.cylT.dispose(); this.g.parent && this.g.parent.remove(this.g); }
  }

  /* ---------- Geräte-Baukasten ---------- */
  class Kit {
    constructor(scene, MT) { this.g = new T.Group(); scene.add(this.g); this.MT = MT; this.geos = []; }
    _g(geo) { this.geos.push(geo); return geo; }
    mesh(geo, mat, parent) { const m = new T.Mesh(this._g(geo), mat); m.castShadow = true; m.receiveShadow = true; (parent || this.g).add(m); return m; }
    box(w, h, d, c, b, mat) { const m = this.mesh(new T.BoxGeometry(w, h, d), mat || this.MT.pad); m.position.copy(c); if (b) { _m4.makeBasis(b.x, b.y, b.z); m.quaternion.setFromRotationMatrix(_m4); } return m; }
    rod(a, b, r, mat) { const m = this.mesh(new T.CylinderGeometry(r, r, 1, 10), mat || this.MT.frame); placeSeg(m, a, b, V(0, 0, 1), 1); m.scale.set(1, a.distanceTo(b), 1); return m; }
    ball(c, r, mat) { const m = this.mesh(new T.SphereGeometry(r, 12, 10), mat || this.MT.frame); m.position.copy(c); return m; }
    barbell(len = 2.0, rPlate = .225, nPlates = 2) {
      const grp = new T.Group(); this.g.add(grp);
      const bar = this.mesh(new T.CylinderGeometry(.014, .014, len, 10), this.MT.steel, grp); bar.rotation.z = Math.PI / 2;
      for (const s of [-1, 1]) {
        for (let i = 0; i < nPlates; i++) { const p = this.mesh(new T.CylinderGeometry(rPlate - i * .045, rPlate - i * .045, .045, 28), this.MT.dark, grp); p.rotation.z = Math.PI / 2; p.position.x = s * (len / 2 - .28 + i * .05); }
        const c = this.mesh(new T.CylinderGeometry(.03, .03, .03, 12), this.MT.gold, grp); c.rotation.z = Math.PI / 2; c.position.x = s * (len / 2 - .33);
      }
      return { grp, set: (c, dirX) => { grp.position.copy(c); orientX(grp, dirX); } };
    }
    shortBar(len = .55) { // Kabelstange / Griff
      const grp = new T.Group(); this.g.add(grp);
      const b = this.mesh(new T.CylinderGeometry(.015, .015, len, 10), this.MT.steel, grp); b.rotation.z = Math.PI / 2;
      return { grp, set: (c, dirX) => { grp.position.copy(c); orientX(grp, dirX); } };
    }
    dumbbell(size = 1) {
      const grp = new T.Group(); this.g.add(grp);
      this.mesh(new T.CylinderGeometry(.016, .016, .15, 8), this.MT.steel, grp);
      for (const s of [-1, 1]) { const w = this.mesh(new T.CylinderGeometry(.062 * size, .062 * size, .085 * size, 10), this.MT.dark, grp); w.position.y = s * (.075 + .043 * size); }
      return { grp, set: (c, axis) => { grp.position.copy(c); orientY(grp, axis); } };
    }
    plate(r = .2) {
      const grp = new T.Group(); this.g.add(grp);
      this.mesh(new T.CylinderGeometry(r, r, .04, 28), this.MT.dark, grp);
      this.mesh(new T.CylinderGeometry(.03, .03, .045, 10), this.MT.gold, grp);
      return { grp, set: (c, axis) => { grp.position.copy(c); orientY(grp, axis); } };
    }
    line(mat, r = .006) { const m = this.mesh(new T.CylinderGeometry(r, r, 1, 6), mat || this.MT.cable); return { set: (a, b) => { placeSeg(m, a, b, V(0, 0, 1), 1); m.scale.set(1, a.distanceTo(b), 1); } }; }
    movBox(w, h, d, mat) { const m = this.mesh(new T.BoxGeometry(w, h, d), mat || this.MT.pad); return { m, set: (c, b) => { m.position.copy(c); if (b) { _m4.makeBasis(b.x, b.y, b.z); m.quaternion.setFromRotationMatrix(_m4); } } }; }
    movCyl(r, len, mat) { const m = this.mesh(new T.CylinderGeometry(r, r, len, 14), mat || this.MT.pad); return { m, set: (c, axis) => { m.position.copy(c); orientY(m, axis); } }; }
    movRod(r, mat) { const m = this.mesh(new T.CylinderGeometry(r, r, 1, 10), mat || this.MT.frame); return { set: (a, b) => { placeSeg(m, a, b, V(0, 0, 1), 1); m.scale.set(1, Math.max(.001, a.distanceTo(b)), 1); } }; }
    // Kabelturm, Rolle bei p (Turm steht hinter p in Richtung 'back')
    tower(p, back) {
      back = back ? nz(back) : V(Math.sign(p.x) || 0, 0, p.x ? 0 : 1);
      const base = p.clone().addScaledVector(back, .14); base.y = 0;
      this.box(.13, 2.35, .13, V(base.x, 1.175, base.z), null, this.MT.frame);
      this.box(.3, .55, .22, V(base.x, .3, base.z), null, this.MT.dark);
      this.ball(p, .045, this.MT.steel);
      this.rod(p, V(base.x, p.y, base.z), .022);
    }
    floorMat(z0 = -1, z1 = 1, w = .7) { this.box(w, .012, z1 - z0, V(0, .006, (z0 + z1) / 2), null, this.MT.mat); }
    dispose() { this.geos.forEach(g => g.dispose()); this.g.parent && this.g.parent.remove(this.g); }
  }

  /* ---------- Bank-Bausteine ---------- */
  function flatBench(kit, z0, z1, top = .44, x = 0, w = .28) {
    kit.box(w, .08, z1 - z0, V(x, top - .04, (z0 + z1) / 2));
    for (const z of [z0 + .12, z1 - .12]) { kit.box(.08, top - .08, .08, V(x, (top - .08) / 2, z), null, kit.MT.frame); kit.box(.42, .04, .08, V(x, .02, z), null, kit.MT.frame); }
  }
  // Sitz + Rückenlehne passend zum Rumpf (pel, pitch)
  function seatFor(kit, pel, pitch, o = {}) {
    const P = frameFrom(o.yaw || 0, pitch, 0), back = P.f.clone().multiplyScalar(-1);
    const seatY = o.seatY !== undefined ? o.seatY : pel.y - .11, seatZ = o.seatZ !== undefined ? o.seatZ : pel.z + .1;
    kit.box(.32, .07, .4, V(pel.x, seatY - .035, seatZ));
    kit.box(.08, seatY - .07, .08, V(pel.x, (seatY - .07) / 2, seatZ), null, kit.MT.frame);
    kit.box(.5, .04, .1, V(pel.x, .02, seatZ), null, kit.MT.frame);
    if (o.back !== false) {
      const len = o.backLen || .75, c = pel.clone().addScaledVector(P.u, len / 2 + .04).addScaledVector(back, .155);
      kit.box(.3, len, .07, c, { x: P.l, y: P.u, z: P.f });
      const foot = V(c.x, 0, c.z + back.z * .1);
      kit.rod(c.clone().addScaledVector(back, .04), foot, .025);
    }
  }

  /* ---------- Zeitablauf ---------- */
  function rep(t, dur, labels) {
    const P = dur.reduce((a, b) => a + b, 0); let x = ((t % P) + P) % P;
    for (let i = 0; i < 4; i++) {
      if (x <= dur[i] || i === 3) {
        const k = dur[i] ? clamp(x / dur[i], 0, 1) : 1;
        return { s: i === 0 ? 0 : i === 1 ? ease(k) : i === 2 ? 1 : 1 - ease(k), label: labels[i], phase: i };
      }
      x -= dur[i];
    }
  }
  const CON = 1.0, ECC = 1.9;
  const LBL = {
    push: (a, b, c, d) => [a, b, c, d],
    std: (start, con, top, ecc) => ({ dur: [.45, CON, .35, ECC], labels: [start, 'Konzentrisch: ' + con, top, 'Exzentrisch: ' + ecc] }),
    lower: (start, ecc, bottom, con) => ({ dur: [.45, ECC, .3, CON], labels: [start, 'Exzentrisch: ' + ecc, bottom, 'Konzentrisch: ' + con] })
  };

  /* ---------- Posen-Bausteine ---------- */
  const sides = fn => ({ L: fn(1, 'L'), R: fn(-1, 'R') });
  const rel = (K, sg, x, y, z) => K.S.clone().addScaledVector(K.l, sg * x).addScaledVector(K.u, y).addScaledVector(K.f, z);
  const relP = (K, sg, x, y, z) => K.pel.clone().addScaledVector(K.P.l, sg * x).addScaledVector(K.P.u, y).addScaledVector(K.P.f, z);
  const toeOut = deg => ({ L: rotA(V(0, 0, 1), UP, deg), R: rotA(V(0, 0, 1), UP, -deg) });
  function stand(o = {}) {
    const w = o.w !== undefined ? o.w : .14, to = o.toe !== undefined ? o.toe : 8, z = o.z || 0;
    return Object.assign({ pelvis: V(0, STAND_Y, z), pitch: 0, ankle: { L: V(w, DIM.ank, z), R: V(-w, DIM.ank, z) }, foot: toeOut(to), knee: toeOut(to) }, o.p || {});
  }
  function mix(a, b, s) {
    const o = Object.assign({}, a);
    for (const k of ['yaw', 'pitch', 'roll', 'flex', 'twist', 'bend', 'shrug', 'head']) o[k] = lerp(a[k] || 0, b[k] || 0, s);
    o.pelvis = lv(a.pelvis, b.pelvis, s);
    if (a.ankle && b.ankle) o.ankle = { L: lv(a.ankle.L, b.ankle.L, s), R: lv(a.ankle.R, b.ankle.R, s) };
    return o;
  }
  // Arm im Sagittalwinkel a (0 = hängt, 90 = vorne waagerecht, 180 = über Kopf), Weltbezug
  const armDir = (K, a) => DOWN.clone().multiplyScalar(Math.cos(a * D2R)).addScaledVector(horiz(K.f), Math.sin(a * D2R));
  const dbAt = (kit) => kit.dumbbell();
  const midOf = (a, b) => a.clone().add(b).multiplyScalar(.5);
  const bothHands = (J) => midOf(J.L.hand, J.R.hand);

  const TPL = {};

  /* === BRUST ================================================================= */
  function supineBase(inc, zPel) {
    const pitch = -(90 - inc);
    const pel = inc ? V(0, .56, zPel !== undefined ? zPel : .15) : V(0, .55, zPel !== undefined ? zPel : .22);
    return { pelvis: pel, pitch, head: inc ? 8 : 14, knee: { L: V(.5, 1, .2), R: V(-.5, 1, .2) },
      ankle: { L: V(.26, DIM.ank, pel.z + .52), R: V(-.26, DIM.ank, pel.z + .52) }, foot: { L: V(.25, 0, 1), R: V(-.25, 0, 1) } };
  }
  function benchFor(kit, base, inc) {
    if (inc) seatFor(kit, base.pelvis, base.pitch, { seatY: .45, backLen: .82, seatZ: base.pelvis.z + .1 });
    else flatBench(kit, -1.0, .42);
  }
  TPL.press = p => {
    const inc = p.incline || 0, base = supineBase(inc), props = {};
    const touch = inc ? .4 : .32;
    const chestPt = K => K.pel.clone().addScaledVector(K.u, touch).addScaledVector(K.f, .17);
    const K0 = kin(base), cp0 = chestPt(K0);
    const w = p.impl === 'db' ? [.2, .13] : [.3, .29];
    return {
      cam: { az: 38, el: 24, dist: 2.7, target: V(0, .75, base.pelvis.z - .25) },
      timing: LBL.lower('Startposition – Arme gestreckt über der Brust', 'Gewicht kontrolliert zur Brust senken', 'Umkehrpunkt – kurz vor/an der Brust', 'Gewicht kraftvoll nach oben drücken'),
      setup(kit, MT) {
        benchFor(kit, base, inc);
        if (p.impl === 'smith' || p.impl === 'bar') {
          const zb = cp0.z;
          if (p.impl === 'smith') { for (const s of [-1, 1]) kit.rod(V(s * .66, 0, zb), V(s * .66, 2.1, zb), .03, MT.steel); kit.rod(V(-.66, 2.1, zb), V(.66, 2.1, zb), .035); }
          else for (const s of [-1, 1]) { kit.rod(V(s * .55, 0, zb - .3), V(s * .55, cp0.y + .55, zb - .3), .03); kit.box(.08, .03, .09, V(s * .55, cp0.y + .52, zb - .25), null, MT.frame); }
          props.bar = kit.barbell(p.impl === 'smith' ? 1.9 : 2.1);
        } else { props.dL = dbAt(kit); props.dR = dbAt(kit); }
      },
      pose(s) {
        const K = kin(base), cp = chestPt(K);
        const top = cp.clone().add(V(0, .47, 0)); if (inc) top.z = cp.z + .03;
        const hands = sides(sg => V(sg * lerp(w[1], w[0], s), lerp(top.y, cp.y + (p.impl === 'db' ? .06 : .03), s), lerp(top.z, cp.z + (p.impl === 'smith' ? 0 : .02), s)));
        if (p.impl === 'smith') { hands.L.z = cp.z; hands.R.z = cp.z; }
        return Object.assign({}, base, { hand: hands, elbow: sides(sg => V(sg * .9, -1, inc ? -.1 : .3)) });
      },
      props(J) { if (props.bar) props.bar.set(bothHands(J), J.L.hand.clone().sub(J.R.hand)); if (props.dL) { props.dL.set(J.L.hand, J.K.l); props.dR.set(J.R.hand, J.K.l); } }
    };
  };

  TPL.fly = p => {
    const v = p.v, props = {};
    if (v === 'db') {
      const inc = p.incline || 0, base = supineBase(inc);
      return {
        cam: { az: 20, el: 30, dist: 2.7, target: V(0, .8, base.pelvis.z - .3) },
        timing: LBL.lower('Start – Kurzhanteln über der Brust, Ellbogen leicht gebeugt', 'Arme im weiten Bogen seitlich öffnen', 'Dehnung – Ellbogen auf Brusthöhe', 'Arme im Bogen zusammenführen (Umarmung)'),
        setup(kit) { benchFor(kit, base, inc); props.dL = dbAt(kit); props.dR = dbAt(kit); },
        pose(s) {
          const K = kin(base);
          const hand = sides(sg => { const th = lerp(10, 76, s) * D2R; const d = nz(K.f.clone().multiplyScalar(Math.cos(th)).addScaledVector(K.l, sg * Math.sin(th)).addScaledVector(K.u, -.1)); return shoulder(K, sg).addScaledVector(d, .56); });
          return Object.assign({}, base, { hand, elbow: sides(sg => K.l.clone().multiplyScalar(sg * .5).addScaledVector(K.f, -.6).addScaledVector(K.u, -.2)) });
        },
        props(J) { props.dL.set(J.L.hand, J.K.u); props.dR.set(J.R.hand, J.K.u); }
      };
    }
    if (v === 'cable') {
      const d = p.dir || 'mid';
      const py = { mid: 1.45, high: 2.1, low: .18 }[d];
      const vo = { mid: .02, high: .5, low: -.55 }[d], vc = { mid: -.05, high: -.55, low: .18 }[d];
      const base = stand({ w: .15, p: { pitch: 12 } });
      base.ankle = { L: V(.15, DIM.ank, .12), R: V(-.15, DIM.ank, -.18) };
      const pulL = V(.95, py, -.12), pulR = V(-.95, py, -.12);
      return {
        cam: { az: 28, el: 14, dist: 3.4, target: V(0, 1.1, 0) },
        timing: LBL.std('Start – Arme seitlich geöffnet, Brust raus', 'Griffe im Bogen vor dem Körper zusammenführen', 'Hände treffen sich – Brust anspannen', 'Arme kontrolliert zurück öffnen'),
        setup(kit) { kit.tower(pulL, V(1, 0, 0)); kit.tower(pulR, V(-1, 0, 0)); props.cL = kit.line(); props.cR = kit.line(); props.hL = kit.shortBar(.12); props.hR = kit.shortBar(.12); },
        pose(s) {
          const K = kin(base);
          const hand = sides(sg => { const open = nz(K.l.clone().multiplyScalar(sg).addScaledVector(K.f, .3).addScaledVector(UP, vo)); const close = nz(K.f.clone().addScaledVector(K.l, -sg * .32).addScaledVector(UP, vc)); return shoulder(K, sg).addScaledVector(nz(lv(open, close, s)), .57); });
          return Object.assign({}, base, { hand, elbow: sides(sg => K.l.clone().multiplyScalar(sg * .6).addScaledVector(K.f, -.5).addScaledVector(UP, .25)) });
        },
        props(J) { props.cL.set(pulL, J.L.hand); props.cR.set(pulR, J.R.hand); props.hL.set(J.L.hand, UP); props.hR.set(J.R.hand, UP); }
      };
    }
    if (v === 'machine' || v === 'reverse') {
      const rev = v === 'reverse';
      const base = { pelvis: V(0, .6, 0), pitch: rev ? 10 : -6, ankle: { L: V(.17, DIM.ank, .4), R: V(-.17, DIM.ank, .4) }, knee: { L: V(.15, 1, .3), R: V(-.15, 1, .3) } };
      return {
        cam: { az: rev ? 150 : 25, el: 26, dist: 2.8, target: V(0, 1.05, 0) },
        timing: rev ? LBL.std('Start – Arme gestreckt vor der Brust', 'Arme waagerecht nach hinten außen führen', 'Hintere Schulter anspannen', 'Kontrolliert zurück nach vorne') : LBL.std('Start – Unterarme an den Polstern, Arme geöffnet', 'Polster vor der Brust zusammendrücken', 'Brust maximal anspannen', 'Kontrolliert öffnen bis zur Dehnung'),
        setup(kit, MT) {
          seatFor(kit, base.pelvis, rev ? 0 : base.pitch, { seatY: .49, back: !rev });
          const K = kin(base);
          if (rev) kit.box(.32, .55, .08, K.S.clone().addScaledVector(K.f, .19).addScaledVector(K.u, -.25), { x: K.l, y: K.u, z: K.f });
          const top = K.S.clone().add(V(0, .35, rev ? .25 : -.1));
          kit.box(.12, top.y, .12, V(0, top.y / 2, top.z + (rev ? .1 : -.18)), null, MT.frame);
          props.armL = kit.movRod(.022); props.armR = kit.movRod(.022); props.top = top;
          props.pL = rev ? kit.shortBar(.16) : kit.movBox(.07, .3, .08); props.pR = rev ? kit.shortBar(.16) : kit.movBox(.07, .3, .08);
        },
        pose(s) {
          const K = kin(base);
          let hand, elbow;
          if (rev) {
            hand = sides(sg => shoulder(K, sg).addScaledVector(nz(lv(nz(K.f.clone().addScaledVector(K.l, -sg * .2)), nz(K.l.clone().multiplyScalar(sg).addScaledVector(K.f, -.08)), s)), .59).addScaledVector(K.u, -.03));
            elbow = sides(sg => DOWN.clone().addScaledVector(K.l, sg * .5));
          } else {
            hand = sides(sg => { const ed = nz(lv(nz(K.l.clone().multiplyScalar(sg).addScaledVector(K.f, -.08)), nz(K.f.clone().addScaledVector(K.l, sg * .1)), s)); const el = shoulder(K, sg).addScaledVector(ed, .29).addScaledVector(K.u, -.03); return el.clone().addScaledVector(K.u, .29).addScaledVector(K.f, .02); });
            elbow = sides(sg => nz(lv(nz(K.l.clone().multiplyScalar(sg).addScaledVector(K.f, -.08)), nz(K.f.clone().addScaledVector(K.l, sg * .1)), s)));
          }
          return Object.assign({}, base, { hand, elbow });
        },
        props(J) {
          for (const [sd, sg] of [['L', 1], ['R', -1]]) {
            const j = J[sd], piv = props.top.clone().add(V(sg * .1, 0, 0));
            if (rev) { props['p' + sd].set(j.hand, UP); props['arm' + sd].set(piv, j.hand.clone().add(V(0, .08, 0))); }
            else { props['p' + sd].set(j.el.clone().lerp(j.hand, .5).addScaledVector(nz(j.hand.clone().sub(j.el)).cross(UP).multiplyScalar(0), 1), basisFromY(j.hand.clone().sub(j.el), J.K.f)); props['arm' + sd].set(piv, j.hand.clone().add(V(0, .05, 0))); }
          }
        }
      };
    }
  };

  TPL.pullover = p => {
    const props = {};
    if (p.v === 'cable') {
      const base = stand({ w: .15, p: { pitch: 28, pelvis: V(0, STAND_Y - .04, -.1), head: -10 } });
      base.knee = { L: V(.1, 0, 1), R: V(-.1, 0, 1) };
      const pul = V(0, 2.15, .95);
      return {
        cam: { az: 72, el: 10, dist: 3.2, target: V(0, 1.15, .2) },
        timing: LBL.std('Start – Arme gestreckt schräg nach oben', 'Stange mit gestreckten Armen bis zu den Oberschenkeln ziehen', 'Latissimus anspannen', 'Arme kontrolliert zurück nach oben – Dehnung'),
        setup(kit) { kit.tower(pul, V(0, 0, 1)); props.c = kit.line(); props.bar = kit.shortBar(.6); },
        pose(s) { const K = kin(base); const a = lerp(150, 25, s); const hand = sides(sg => shoulder(K, sg).addScaledVector(armDir(K, a), .6).addScaledVector(K.l, -sg * .02)); return Object.assign({}, base, { hand, elbow: sides(sg => K.l.clone().multiplyScalar(sg).add(DOWN)) }); },
        props(J) { const c = bothHands(J); props.bar.set(c, J.L.hand.clone().sub(J.R.hand)); props.c.set(pul, c); }
      };
    }
    const base = supineBase(0, .3);
    return {
      cam: { az: 70, el: 18, dist: 2.7, target: V(0, .75, -.35) },
      timing: LBL.lower('Start – Kurzhantel mit beiden Händen über der Brust', 'Hantel im Bogen hinter den Kopf senken', 'Dehnung – Arme hinter dem Kopf', 'Hantel im Bogen zurück über die Brust ziehen'),
      setup(kit) { flatBench(kit, -.9, .4); props.d = kit.dumbbell(1.3); },
      pose(s) {
        const K = kin(base), a = lerp(8, 108, s) * D2R;
        const dir = nz(K.f.clone().multiplyScalar(Math.cos(a)).addScaledVector(K.u, Math.sin(a)));
        const c = K.S.clone().addScaledVector(K.u, -.015).addScaledVector(dir, .55);
        return Object.assign({}, base, { hand: sides(sg => c.clone().addScaledVector(K.l, sg * .045)), elbow: sides(sg => K.l.clone().multiplyScalar(sg)) });
      },
      props(J) { const c = bothHands(J); props.d.set(c.addScaledVector(nz(c.clone().sub(J.K.S)), .07), c.clone().sub(J.K.S)); }
    };
  };

  TPL.dips = () => {
    const props = {}, hy = 1.3;
    return {
      cam: { az: 70, el: 10, dist: 3.3, target: V(0, 1.2, 0) },
      timing: LBL.lower('Start – Arme gestreckt, Körper leicht nach vorne geneigt', 'Kontrolliert absenken, Ellbogen nach hinten', 'Tiefster Punkt – Oberarme etwa waagerecht', 'Kraftvoll nach oben drücken'),
      setup(kit, MT) {
        for (const s of [-1, 1]) { kit.rod(V(s * .27, hy, -.35), V(s * .27, hy, .45), .022, MT.steel); kit.rod(V(s * .27, 0, -.3), V(s * .27, hy, -.3), .03); kit.rod(V(s * .27, 0, .4), V(s * .27, hy, .4), .03); }
      },
      pose(s) {
        const pel = V(0, lerp(1.32, 1.02, s), lerp(-.04, -.1, s)), pitch = lerp(12, 28, s);
        const o = { pelvis: pel, pitch, head: -pitch * .5, knee: { L: V(.05, -.2, 1), R: V(-.05, -.2, 1) } };
        o.ankle = { L: pel.clone().add(V(.05, -.55, -.32)), R: pel.clone().add(V(-.05, -.58, -.3)) };
        o.foot = { L: V(0, -.6, -.3), R: V(0, -.6, -.3) };
        o.hand = sides(sg => V(sg * .27, hy + .02, .06));
        o.elbow = sides(sg => V(sg * .25, 0, -1));
        return o;
      }
    };
  };

  /* === SCHULTER ============================================================== */
  function seatedUpright(pitch = -6, z = 0) { return { pelvis: V(0, .57, z), pitch, ankle: { L: V(.2, DIM.ank, z + .45), R: V(-.2, DIM.ank, z + .45) }, knee: { L: V(.2, 1, .3), R: V(-.2, 1, .3) }, foot: toeOut(10) }; }
  TPL.ohp = p => {
    const props = {}, seated = p.seated, beh = p.behind, impl = p.impl;
    const base = seated ? seatedUpright(-6) : stand({ w: .15 });
    return {
      cam: { az: beh ? 145 : 32, el: 12, dist: 3.1, target: V(0, seated ? 1.15 : 1.45, 0) },
      timing: LBL.std(beh ? 'Start – Stange im Nacken auf Höhe der Ohren' : 'Start – Gewicht auf Schulterhöhe', 'senkrecht über den Kopf drücken', 'Oben – Arme fast gestreckt, Rumpf stabil', 'kontrolliert zurück auf Schulterhöhe'),
      setup(kit, MT) {
        if (seated) seatFor(kit, base.pelvis, base.pitch, { seatY: .47, backLen: .8 });
        const K = kin(base);
        if (impl === 'smith') { const zb = K.S.z + (beh ? -.07 : .12); for (const s of [-1, 1]) kit.rod(V(s * .7, 0, zb), V(s * .7, 2.3, zb), .03, MT.steel); kit.rod(V(-.7, 2.3, zb), V(.7, 2.3, zb), .035); props.bar = kit.barbell(1.9, .2); }
        else if (impl === 'bar') props.bar = kit.barbell(2.0, .2);
        else if (impl === 'machine') { const zb = K.S.z + .02; props.zb = zb; for (const s of [-1, 1]) kit.box(.08, 1.9, .08, V(s * .55, .95, zb - .3), null, MT.frame); props.lL = kit.movRod(.02); props.lR = kit.movRod(.02); props.hL = kit.shortBar(.14); props.hR = kit.shortBar(.14); }
        else { props.dL = dbAt(kit); props.dR = dbAt(kit); }
      },
      pose(s) {
        const K = kin(base);
        const wb = impl === 'db' ? .27 : impl === 'machine' ? .3 : .28, wt = impl === 'db' ? .16 : .23;
        const zb = beh ? -.07 : impl === 'db' ? .04 : .12, zt = beh ? -.03 : .03;
        const yb = beh ? .1 : impl === 'db' ? .05 : .0;
        let hand = sides(sg => rel(K, sg, lerp(wb, wt, s), lerp(yb, .58, s), lerp(zb, zt, s)));
        if (impl === 'smith') { const zz = K.S.z + (beh ? -.07 : .12); hand = sides(sg => { const h = rel(K, sg, lerp(wb, wt, s), lerp(yb, .58, s), 0); h.z = zz; return h; }); }
        const elbow = sides(sg => beh || impl === 'db' || impl === 'machine' ? K.l.clone().multiplyScalar(sg).addScaledVector(DOWN, .6).addScaledVector(K.f, .1) : K.l.clone().multiplyScalar(sg * .5).addScaledVector(K.f, .6).add(DOWN));
        return Object.assign({}, base, { hand, elbow, head: beh ? 12 : 0 });
      },
      props(J) {
        if (props.bar) props.bar.set(bothHands(J), J.L.hand.clone().sub(J.R.hand));
        if (props.dL) { props.dL.set(J.L.hand, J.K.l); props.dR.set(J.R.hand, J.K.l); }
        if (props.lL) for (const [sd, sg] of [['L', 1], ['R', -1]]) { props['h' + sd].set(J[sd].hand, J.K.f); props['l' + sd].set(V(sg * .55, 1.6, props.zb - .3), J[sd].hand); }
      }
    };
  };

  TPL.lateral = p => {
    const seated = p.seated, one = p.one, cable = p.cable, machine = p.machine, props = {};
    const base = seated || machine ? seatedUpright(machine ? -4 : 2) : stand({ w: .14, p: { pitch: 5 } });
    if (one) { base.yaw = 0; }
    const work = one ? ['R'] : ['L', 'R'];
    const pul = V(.6, .14, .05);
    return {
      cam: { az: one || cable ? -25 : 10, el: 10, dist: 3.0, target: V(0, seated || machine ? .95 : 1.15, 0) },
      timing: LBL.std('Start – Arme seitlich am Körper, leicht gebeugt', 'seitlich bis auf Schulterhöhe heben – Ellbogen führt', 'Oben – kurz halten, kein Schwung', 'langsam absenken'),
      setup(kit, MT) {
        if (seated || machine) seatFor(kit, base.pelvis, base.pitch, { seatY: .47, backLen: machine ? .55 : .5, back: !machine });
        if (machine) { kit.box(.1, 1.4, .1, V(0, .7, -.32), null, MT.frame); kit.box(.36, .5, .07, V(0, 1.0, -.21)); props.pL = kit.movBox(.07, .2, .09); props.pR = kit.movBox(.07, .2, .09); props.aL = kit.movRod(.02); props.aR = kit.movRod(.02); }
        else if (cable) { kit.tower(pul, V(1, 0, 0)); props.c = kit.line(); props.h = kit.shortBar(.12); }
        else { props.dR = dbAt(kit); if (!one) props.dL = dbAt(kit); }
        if (one && !cable) { kit.rod(V(.62, 0, .0), V(.62, 1.9, .0), .03, MT.frame); }
      },
      pose(s) {
        const K = kin(base);
        const hand = sides((sg, side) => {
          if (one && side === 'L') return cable ? relP(K, 1, .2, .02, .05) : V(.6, 1.1, 0);
          const sv = work.includes(side) ? s : 0;
          if (machine) { const ang = lerp(12, 85, sv) * D2R; return shoulder(K, sg).addScaledVector(K.l, sg * Math.sin(ang) * .3).addScaledVector(K.u, -Math.cos(ang) * .3).addScaledVector(K.f, .25); }
          const ang = lerp(cable ? -14 : 10, 88, sv) * D2R, r = .6;
          return shoulder(K, sg).addScaledVector(K.l, sg * Math.sin(ang) * r).addScaledVector(K.u, -Math.cos(ang) * r).addScaledVector(K.f, .07);
        });
        const elbow = sides(sg => machine ? DOWN.clone().addScaledVector(K.f, -1) : K.f.clone().multiplyScalar(-.7).addScaledVector(UP, .45).addScaledVector(K.l, sg * .3));
        if (one) elbow.L = cable ? V(.4, -.4, -.5) : V(0, -1, -.4);
        return Object.assign({}, base, { hand, elbow });
      },
      props(J) {
        if (props.dR) props.dR.set(J.R.hand, J.K.f);
        if (props.dL) props.dL.set(J.L.hand, J.K.f);
        if (props.c) { props.c.set(pul, J.R.hand); props.h.set(J.R.hand, J.K.f); }
        if (props.pL) for (const sd of ['L', 'R']) { const j = J[sd]; props['p' + sd].set(j.el.clone().lerp(j.sh, .15), basisFromY(j.el.clone().sub(j.sh), J.K.f)); props['a' + sd].set(V(0, 1.2, -.25), j.el.clone().lerp(j.sh, .15)); }
      }
    };
  };

  TPL.rearDelt = p => {
    const v = p.v, props = {};
    if (v === 'cross') {
      const base = stand({ w: .15 });
      const pL = V(.95, 1.5, .5), pR = V(-.95, 1.5, .5);
      return {
        cam: { az: 160, el: 12, dist: 3.2, target: V(0, 1.3, .1) },
        timing: LBL.std('Start – Kabel überkreuzt vor der Brust', 'Arme waagerecht nach außen-hinten ziehen', 'Hintere Schulter & oberer Rücken anspannen', 'kontrolliert zurück in die Kreuzung'),
        setup(kit) { kit.tower(pL, V(1, 0, 0)); kit.tower(pR, V(-1, 0, 0)); props.cL = kit.line(); props.cR = kit.line(); },
        pose(s) { const K = kin(base); const hand = sides(sg => shoulder(K, sg).addScaledVector(nz(lv(nz(K.f.clone().addScaledVector(K.l, -sg * .45)), nz(K.l.clone().multiplyScalar(sg).addScaledVector(K.f, -.15)), s)), .59).addScaledVector(UP, -.04)); return Object.assign({}, base, { hand, elbow: sides(sg => DOWN.clone().addScaledVector(K.f, -.5)) }); },
        props(J) { props.cL.set(pR, J.L.hand); props.cR.set(pL, J.R.hand); } // überkreuzt
      };
    }
    const base = stand({ w: .15, p: { pelvis: V(0, STAND_Y - .08, -.14), pitch: 68, head: -35 } });
    base.knee = { L: V(.1, 0, 1), R: V(-.1, 0, 1) };
    const one = v === 'cable1';
    const pL = V(.8, .14, .1), pR = V(-.8, .14, .1);
    return {
      cam: { az: 25, el: 22, dist: 3.0, target: V(0, .95, 0) },
      timing: LBL.std('Start – Oberkörper vorgebeugt, Rücken gerade, Arme hängen', 'Arme seitlich nach oben bis auf Rückenhöhe', 'Hintere Schulter anspannen', 'langsam absenken'),
      setup(kit) {
        if (v === 'db') { props.dL = dbAt(kit); props.dR = dbAt(kit); }
        else { if (!one) kit.tower(pL, V(1, 0, 0)); kit.tower(pR, V(-1, 0, 0)); props.cR = kit.line(); if (!one) props.cL = kit.line(); }
      },
      pose(s) {
        const K = kin(base);
        const hand = sides((sg, side) => {
          if (one && side === 'L') return relP(K, 1, .16, -.12, .12);
          const st = shoulder(K, sg).addScaledVector(DOWN, .57).addScaledVector(K.l, -sg * (v === 'db' ? .03 : .12)).addScaledVector(horiz(K.f), .04);
          const en = shoulder(K, sg).addScaledVector(K.l, sg * .56).addScaledVector(DOWN, .12).addScaledVector(horiz(K.f), .02);
          return lv(st, en, s);
        });
        const elbow = sides(sg => UP.clone().addScaledVector(K.l, sg * .6));
        if (one) elbow.L = V(.3, 0, -1);
        return Object.assign({}, base, { hand, elbow });
      },
      props(J) {
        if (props.dL) { props.dL.set(J.L.hand, horiz(J.K.f)); props.dR.set(J.R.hand, horiz(J.K.f)); }
        if (props.cR) props.cR.set(pL, J.R.hand); // Kabel überkreuzt von der Gegenseite
        if (props.cL) props.cL.set(pR, J.L.hand);
      }
    };
  };

  TPL.facePull = () => {
    const base = stand({ w: .15, p: { pitch: -4 } }), pul = V(0, 1.75, 1.0), props = {};
    return {
      cam: { az: 55, el: 14, dist: 3.1, target: V(0, 1.35, .3) },
      timing: LBL.std('Start – Arme gestreckt Richtung Seilzug', 'Seil Richtung Gesicht ziehen, Ellbogen hoch und außen', 'Hände neben den Ohren – Außenrotation', 'kontrolliert zurück nach vorne'),
      setup(kit) { kit.tower(pul, V(0, 0, 1)); props.c = kit.line(); props.rL = kit.line(kit.MT.dark, .012); props.rR = kit.line(kit.MT.dark, .012); },
      pose(s) {
        const K = kin(base);
        const hand = sides(sg => { const st = shoulder(K, sg).lerp(pul, .6 / shoulder(K, sg).distanceTo(pul)).addScaledVector(K.l, -sg * .1); const en = rel(K, sg, .22, .15, .08); return lv(st, en, s); });
        return Object.assign({}, base, { hand, elbow: sides(sg => K.l.clone().multiplyScalar(sg).addScaledVector(UP, .45).addScaledVector(K.f, -.4)) });
      },
      props(J) { const m = bothHands(J).addScaledVector(nz(pul.clone().sub(bothHands(J))), .12); props.c.set(pul, m); props.rL.set(m, J.L.hand); props.rR.set(m, J.R.hand); }
    };
  };

  TPL.uprightRow = p => {
    const base = stand({ w: .15 }), props = {}, pul = V(0, .12, .55);
    return {
      cam: { az: 30, el: 10, dist: 3.0, target: V(0, 1.15, 0) },
      timing: LBL.std('Start – Stange vor den Oberschenkeln, Arme gestreckt', 'eng am Körper nach oben ziehen, Ellbogen führen', 'Oben – Stange auf Brusthöhe, Ellbogen über den Händen', 'kontrolliert absenken'),
      setup(kit) { props.bar = p.impl === 'cable' ? kit.shortBar(.55) : kit.barbell(1.25, .16, 1); if (p.impl === 'cable') { kit.tower(pul, V(0, 0, 1)); props.c = kit.line(); } },
      pose(s) {
        const K = kin(base), w = .13;
        const hand = sides(sg => V(sg * w, lerp(shoulder(K, 1).y - .6, shoulder(K, 1).y - .14, s), K.S.z + lerp(.11, .13, s)));
        return Object.assign({}, base, { hand, elbow: sides(sg => K.l.clone().multiplyScalar(sg).addScaledVector(UP, .7).addScaledVector(K.f, -.3)) });
      },
      props(J) { const c = bothHands(J); props.bar.set(c, J.L.hand.clone().sub(J.R.hand)); if (props.c) props.c.set(pul, c); }
    };
  };

  TPL.frontRaise = p => {
    const props = {}, seated = p.seated, impl = p.impl;
    const base = seated ? seatedUpright(2) : stand({ w: .15 });
    const pul = V(0, .1, -.38);
    return {
      cam: { az: 70, el: 10, dist: 3.0, target: V(0, seated ? 1.0 : 1.2, .15) },
      timing: LBL.std('Start – Arme gestreckt vor dem Körper', 'mit fast gestreckten Armen nach vorne bis Schulterhöhe heben', 'Oben – kurz halten, Rumpf ruhig', 'langsam absenken'),
      setup(kit) {
        if (seated) seatFor(kit, base.pelvis, base.pitch, { seatY: .47, backLen: .5 });
        if (impl === 'cable') { kit.tower(pul, V(0, 0, -1)); props.c = kit.line(); props.bar = kit.shortBar(.5); }
        else { props.dL = dbAt(kit); props.dR = dbAt(kit); }
      },
      pose(s) {
        const K = kin(base), a = lerp(seated ? 18 : 10, 90, s);
        const hand = sides(sg => shoulder(K, sg).addScaledVector(armDir(K, a), .6).addScaledVector(K.l, -sg * (impl === 'cable' ? .05 : 0)));
        return Object.assign({}, base, { hand, elbow: sides(sg => UP.clone().addScaledVector(K.l, sg * .4)) });
      },
      props(J) {
        if (props.bar) { const c = bothHands(J); props.bar.set(c, J.L.hand.clone().sub(J.R.hand)); props.c.set(pul, c); }
        if (props.dL) { props.dL.set(J.L.hand, J.K.l); props.dR.set(J.R.hand, J.K.l); }
      }
    };
  };

  TPL.shrug = () => {
    const base = stand({ w: .15 }), props = {};
    return {
      cam: { az: 30, el: 8, dist: 2.7, target: V(0, 1.2, 0) },
      timing: LBL.std('Start – Arme hängen gestreckt, Kurzhanteln seitlich', 'Schultern senkrecht Richtung Ohren ziehen', 'Oben – kurz halten', 'langsam absenken – Dehnung'),
      setup(kit) { props.dL = kit.dumbbell(1.2); props.dR = kit.dumbbell(1.2); },
      pose(s) {
        const o = Object.assign({}, base, { shrug: s }); const K = kin(o);
        o.hand = sides(sg => shoulder(K, sg, s).addScaledVector(DOWN, .615).addScaledVector(K.l, sg * .04));
        o.elbow = sides(sg => K.f.clone().multiplyScalar(-1).addScaledVector(K.l, sg));
        return o;
      },
      props(J) { props.dL.set(J.L.hand.clone().add(V(0, -.02, 0)), J.K.f); props.dR.set(J.R.hand.clone().add(V(0, -.02, 0)), J.K.f); }
    };
  };

  /* === RÜCKEN ================================================================ */
  TPL.latPull = p => {
    const props = {};
    if (p.v === 'pullup') {
      const hy = 2.22;
      return {
        cam: { az: 150, el: 10, dist: 3.6, target: V(0, 1.55, 0) },
        timing: LBL.std('Start – Hängen mit fast gestreckten Armen', 'Brust zur Stange ziehen, Ellbogen nach unten', 'Oben – Kinn über der Stange', 'kontrolliert absenken'),
        setup(kit, MT) { kit.rod(V(-.75, hy, 0), V(.75, hy, 0), .018, MT.steel); for (const s of [-1, 1]) kit.rod(V(s * .75, 0, 0), V(s * .75, hy + .05, 0), .035); },
        pose(s) {
          const pel = V(0, lerp(1.08, 1.53, s), lerp(-.03, -.07, s)), pitch = lerp(-4, -14, s);
          const o = { pelvis: pel, pitch, head: lerp(0, 10, s) };
          o.hand = sides(sg => V(sg * .4, hy, 0));
          const K = kin(o); o.elbow = sides(sg => DOWN.clone().addScaledVector(K.l, sg * .8).addScaledVector(K.f, -.3));
          o.knee = { L: V(.05, 0, 1), R: V(-.05, 0, 1) }; o.ankle = { L: pel.clone().add(V(-.02, -.62, -.32)), R: pel.clone().add(V(.02, -.66, -.3)) };
          o.foot = { L: V(0, -.8, -.2), R: V(0, -.8, -.2) };
          return o;
        }
      };
    }
    const base = { pelvis: V(0, .6, 0), pitch: -12, ankle: { L: V(.2, DIM.ank, .42), R: V(-.2, DIM.ank, .42) }, knee: { L: V(.15, 1, .3), R: V(-.15, 1, .3) }, foot: toeOut(8) };
    return {
      cam: { az: 145, el: 14, dist: 3.4, target: V(0, 1.4, 0) },
      timing: LBL.std('Start – Arme gestreckt, breiter Griff', 'Stange zur oberen Brust ziehen, Ellbogen nach unten-hinten', 'Unten – Schulterblätter zusammen', 'Stange kontrolliert nach oben führen'),
      setup(kit, MT) {
        seatFor(kit, base.pelvis, 0, { seatY: .5, back: false });
        kit.box(.5, .1, .12, V(0, .74, .22), null, MT.pad);
        kit.box(.12, 2.4, .12, V(0, 1.2, -.45), null, MT.frame); kit.rod(V(0, 2.35, -.45), V(0, 2.35, .05), .04);
        props.bar = kit.barbell(1.2, .0001, 0); props.c = kit.line();
      },
      pose(s) {
        const o = Object.assign({}, base, { pitch: lerp(-10, -18, s) }); const K = kin(o);
        o.hand = sides(sg => lv(V(sg * .43, K.S.y + .58, K.S.z + .1), rel(K, sg, .37, .04, .14), s));
        o.elbow = sides(sg => DOWN.clone().addScaledVector(K.l, sg * .7).addScaledVector(K.f, -.3));
        o.head = lerp(8, 0, s);
        return o;
      },
      props(J) { const c = bothHands(J); props.bar.set(c, J.L.hand.clone().sub(J.R.hand)); props.c.set(V(0, 2.35, .05), c); }
    };
  };

  TPL.row = p => {
    const v = p.v, props = {};
    const bentBase = () => { const b = stand({ w: .16, p: { pelvis: V(0, STAND_Y - .1, -.12), pitch: 52, head: -30 } }); b.knee = { L: V(.12, 0, 1), R: V(-.12, 0, 1) }; return b; };
    const lab = LBL.std('Start – Oberkörper vorgebeugt, Rücken gerade, Arme gestreckt', 'Gewicht zum Bauch ziehen, Ellbogen eng nach hinten', 'Schulterblätter zusammenziehen', 'kontrolliert ablassen – Rücken bleibt neutral');
    if (v === 'bar' || v === 'under' || v === 'tbar') {
      const base = bentBase(), anchor = V(0, .06, -1.25);
      const w = v === 'bar' ? .27 : v === 'under' ? .22 : .06;
      return {
        cam: { az: 70, el: 14, dist: 3.1, target: V(0, .8, .05) }, timing: lab,
        setup(kit, MT) { if (v === 'tbar') { props.bar = kit.movRod(.02, MT.steel); props.pl = kit.plate(.2); props.h = kit.shortBar(.16); kit.ball(anchor, .05); } else props.bar = kit.barbell(2.0, .2); },
        pose(s) {
          const K = kin(base);
          const hand = sides(sg => lv(shoulder(K, sg).addScaledVector(DOWN, .6).addScaledVector(horiz(K.f), .03).addScaledVector(K.l, sg * (w - DIM.shW)), relP(K, sg, w, .14, .17), s));
          return Object.assign({}, base, { hand, elbow: sides(sg => UP.clone().addScaledVector(horiz(K.f), -.5).addScaledVector(K.l, sg * (v === 'bar' ? .5 : .15))) });
        },
        props(J) {
          const c = bothHands(J);
          if (v === 'tbar') { const d = nz(c.clone().sub(anchor)); const end = c.clone().addScaledVector(d, .14); props.bar.set(anchor, end); props.pl.set(end.clone().addScaledVector(d, -.04), d); props.h.set(c, V(1, 0, 0)); }
          else props.bar.set(c, J.L.hand.clone().sub(J.R.hand));
        }
      };
    }
    if (v === 'db1') {
      const base = { pelvis: V(.02, .93, -.28), pitch: 82, head: -10, knee: { L: V(0, -1, .4), R: V(-.1, -.2, 1) }, ankle: { L: V(.12, .52, -.7), R: V(-.3, DIM.ank, -.05) }, foot: { L: V(0, -.3, -1), R: V(-.1, 0, 1) } };
      return {
        cam: { az: -70, el: 16, dist: 3.0, target: V(0, .75, 0) }, timing: lab,
        setup(kit) { flatBench(kit, -.95, .55, .45, .13, .3); props.d = kit.dumbbell(1.1); },
        pose(s) {
          const K = kin(base);
          const hand = { L: V(.16, .47, K.S.z + .05), R: lv(shoulder(K, -1).addScaledVector(DOWN, .6).addScaledVector(horiz(K.f), .03), relP(K, -1, .2, .12, .1), s) };
          return Object.assign({}, base, { hand, elbow: { L: V(.4, 0, -1), R: UP.clone().addScaledVector(horiz(K.f), -.5) } });
        },
        props(J) { props.d.set(J.R.hand, horiz(J.K.u)); }
      };
    }
    if (v === 'dbIncline' || v === 'tbarMachine') {
      const inc = v === 'tbarMachine' ? 42 : 36;
      const base = { pelvis: V(0, .82, -.12), pitch: 90 - inc, head: -15, knee: { L: V(.1, 0, 1), R: V(-.1, 0, 1) }, ankle: { L: V(.15, DIM.ank, -.72), R: V(-.15, DIM.ank, -.72) }, foot: toeOut(5) };
      return {
        cam: { az: 72, el: 14, dist: 3.1, target: V(0, .85, .1) }, timing: lab,
        setup(kit, MT) {
          const K = kin(base), c = K.mid.clone().addScaledVector(K.f, -.17).addScaledVector(K.u, .12);
          kit.box(.32, .9, .08, c, { x: K.l, y: K.u, z: K.f });
          kit.rod(c.clone().addScaledVector(K.f, -.05), V(0, 0, c.z - .2), .03); kit.rod(V(0, .02, -.6), V(0, .02, .6), .03);
          if (v === 'tbarMachine') { props.lev = kit.movRod(.025); props.h = kit.shortBar(.34); kit.box(.12, .5, .12, V(0, .25, .8), null, MT.frame); }
          else { props.dL = dbAt(kit); props.dR = dbAt(kit); }
        },
        pose(s) {
          const K = kin(base), w = v === 'tbarMachine' ? .17 : .2;
          const hand = sides(sg => lv(shoulder(K, sg).addScaledVector(DOWN, .6).addScaledVector(K.l, sg * (w - DIM.shW)), relP(K, sg, w + .02, .22, .14), s));
          return Object.assign({}, base, { hand, elbow: sides(sg => UP.clone().addScaledVector(horiz(K.f), -.5).addScaledVector(K.l, sg * .3)) });
        },
        props(J) {
          if (props.dL) { props.dL.set(J.L.hand, horiz(J.K.u)); props.dR.set(J.R.hand, horiz(J.K.u)); }
          if (props.lev) { const c = bothHands(J); props.h.set(c, V(1, 0, 0)); props.lev.set(V(0, .5, .8), c); }
        }
      };
    }
    if (v === 'machineWide') {
      const base = seatedUpright(4, -.05);
      return {
        cam: { az: 120, el: 20, dist: 3.0, target: V(0, 1.05, .1) }, timing: LBL.std('Start – Brust am Polster, Arme gestreckt, breiter Griff', 'Griffe mit hohen Ellbogen nach hinten ziehen', 'Schulterblätter maximal zusammen', 'kontrolliert nach vorne strecken'),
        setup(kit, MT) {
          seatFor(kit, base.pelvis, 0, { seatY: .47, back: false }); const K = kin(base);
          kit.box(.32, .45, .08, K.S.clone().addScaledVector(K.f, .19).addScaledVector(K.u, -.27), { x: K.l, y: K.u, z: K.f });
          kit.box(.1, 1.5, .1, V(0, .75, .85), null, MT.frame); props.aL = kit.movRod(.02); props.aR = kit.movRod(.02); props.hL = kit.shortBar(.14); props.hR = kit.shortBar(.14);
        },
        pose(s) {
          const K = kin(base);
          const hand = sides(sg => lv(shoulder(K, sg).addScaledVector(nz(K.f.clone().addScaledVector(K.l, sg * .35)), .6).addScaledVector(DOWN, .05), rel(K, sg, .4, -.08, .1), s));
          return Object.assign({}, base, { hand, elbow: sides(sg => K.l.clone().multiplyScalar(sg).addScaledVector(K.f, -.5)) });
        },
        props(J) { for (const [sd, sg] of [['L', 1], ['R', -1]]) { props['h' + sd].set(J[sd].hand, UP); props['a' + sd].set(V(sg * .1, 1.2, .85), J[sd].hand); } }
      };
    }
    if (v === 'cableNarrow') {
      const base = { pelvis: V(0, .5, -.2), pitch: 0, ankle: { L: V(.13, .3, .52), R: V(-.13, .3, .52) }, knee: { L: V(.1, 1, .2), R: V(-.1, 1, .2) }, foot: { L: V(0, .6, 1), R: V(0, .6, 1) } };
      const pul = V(0, .32, 1.3);
      return {
        cam: { az: 70, el: 14, dist: 3.2, target: V(0, .75, .3) }, timing: LBL.std('Start – Arme gestreckt, Rücken gerade', 'Griff zum Bauch ziehen, Ellbogen eng am Körper', 'Schulterblätter zusammen, Brust raus', 'kontrolliert nach vorne strecken'),
        setup(kit, MT) { kit.box(.3, .38, 1.1, V(0, .19, -.25), null, MT.pad); kit.box(.4, .3, .06, V(0, .3, .62), { x: V(1, 0, 0), y: nz(V(0, 1, -.5)), z: nz(V(0, .5, 1)) }, MT.frame); kit.tower(pul, V(0, 0, 1)); props.c = kit.line(); props.h = kit.shortBar(.12); },
        pose(s) {
          const o = Object.assign({}, base, { pitch: lerp(18, -4, s) }); const K = kin(o);
          o.hand = sides(sg => lv(shoulder(K, sg).addScaledVector(horiz(K.f), .58).addScaledVector(DOWN, .14).addScaledVector(K.l, -sg * .14), relP(K, sg, .06, .2, .17), s));
          o.elbow = sides(sg => K.f.clone().multiplyScalar(-1).addScaledVector(DOWN, .4).addScaledVector(K.l, sg * .2));
          return o;
        },
        props(J) { const c = bothHands(J); props.c.set(pul, c); props.h.set(c, V(0, 1, 0)); }
      };
    }
  };

  TPL.backExt = () => {
    const pel = V(0, 1.0, 0), legDir = nz(V(0, -.72, -.69));
    return {
      cam: { az: 90, el: 8, dist: 3.4, target: V(0, .85, .15) },
      timing: LBL.std('Start – Oberkörper hängt nach unten, Rücken gerade', 'Oberkörper anheben bis Körper eine Linie bildet', 'Oben – Gesäß und unterer Rücken angespannt', 'kontrolliert absenken'),
      setup(kit, MT) {
        const hipPad = pel.clone().addScaledVector(V(0, -.7, .7).normalize(), .13).add(V(0, -.03, 0));
        kit.box(.36, .1, .32, hipPad, { x: V(1, 0, 0), y: nz(V(0, .72, .69)), z: nz(V(0, -.69, .72)) });
        const ank = pel.clone().addScaledVector(legDir, LEG - .02);
        kit.movCyl(.05, .3, MT.pad).set(ank.clone().add(V(0, .07, -.03)), V(1, 0, 0));
        kit.rod(hipPad.clone().add(V(0, -.05, 0)), V(0, 0, hipPad.z), .03); kit.rod(V(0, .02, -.75), V(0, .02, .45), .03);
        kit.rod(ank.clone().add(V(0, 0, -.1)), V(0, 0, ank.z - .1), .03);
      },
      pose(s) {
        const pitch = lerp(150, 46, s);
        const o = { pelvis: pel, pitch, head: lerp(0, 5, s), knee: { L: V(0, -1, 0), R: V(0, -1, 0) }, foot: { L: V(0, -.69, -.72), R: V(0, -.69, -.72) } };
        o.ankle = { L: pel.clone().add(V(.1, 0, 0)).addScaledVector(legDir, LEG - .02), R: pel.clone().add(V(-.1, 0, 0)).addScaledVector(legDir, LEG - .02) };
        const K = kin(o);
        o.hand = sides(sg => rel(K, sg, -.08, -.1, .14));
        o.elbow = sides(sg => K.l.clone().multiplyScalar(sg).addScaledVector(K.u, -.5));
        return o;
      }
    };
  };

  /* === BEINE ================================================================= */
  TPL.squat = p => {
    const v = p.v || 'back', props = {};
    const stance = v === 'narrow' ? .1 : v === 'hack' ? .16 : .17, toe = v === 'narrow' ? 5 : 16;
    if (v === 'hack') {
      const u = nz(V(0, .82, -.57)), p0 = V(0, 1.0, -.05), ankZ = p0.clone().addScaledVector(u, -(LEG - .04));
      const base = { pitch: -35, ankle: { L: V(stance, ankZ.y, ankZ.z), R: V(-stance, ankZ.y, ankZ.z) }, foot: { L: rotA(V(0, .35, 1), UP, 12), R: rotA(V(0, .35, 1), UP, -12) }, knee: toeOut(14) };
      return {
        cam: { az: 72, el: 10, dist: 3.3, target: V(0, .95, .15) },
        timing: LBL.lower('Start – Rücken am Polster, Beine fast gestreckt', 'kontrolliert in die Knie gehen', 'Unten – Knie etwa 90°', 'über die ganze Fußsohle hochdrücken'),
        setup(kit, MT) {
          const pf = V(0, ankZ.y - .07, ankZ.z + .04); kit.box(.6, .05, .45, pf, { x: V(1, 0, 0), y: nz(V(0, 1, -.35)), z: nz(V(0, .35, 1)) }, MT.frame);
          const K0 = kin(Object.assign({}, base, { pelvis: p0 })), bo = K0.P.f.clone().multiplyScalar(-.27);
          for (const s of [-1, 1]) kit.rod(p0.clone().add(bo).add(V(s * .3, 0, 0)).addScaledVector(u, -.75), p0.clone().add(bo).add(V(s * .3, 0, 0)).addScaledVector(u, 1.05), .03, MT.steel);
          props.pad = kit.movBox(.36, .95, .08); props.sh = kit.movBox(.5, .08, .12);
        },
        pose(s) { const pel = p0.clone().addScaledVector(u, -.45 * s); const o = Object.assign({}, base, { pelvis: pel }); const K = kin(o); o.hand = sides(sg => rel(K, sg, .3, .07, .02)); o.elbow = sides(sg => DOWN.clone().addScaledVector(K.l, sg)); return o; },
        props(J) { const K = J.K; props.pad.set(K.mid.clone().addScaledVector(K.f, -.17).addScaledVector(K.u, .1), { x: K.l, y: K.u, z: K.f }); props.sh.set(K.S.clone().addScaledVector(K.u, .07).addScaledVector(K.f, .0), { x: K.l, y: K.u, z: K.f }); }
      };
    }
    const pitchB = { back: 42, front: 22, goblet: 25, narrow: 16 }[v];
    const backZ = { back: -.2, front: -.12, goblet: -.14, narrow: -.05 }[v];
    const A0 = stand({ w: stance, toe });
    const B0 = Object.assign({}, A0, { pelvis: V(0, .5, backZ), pitch: pitchB, head: -pitchB * .55 });
    return {
      cam: { az: 50, el: 12, dist: 3.1, target: V(0, .9, 0) },
      timing: LBL.lower('Start – aufrecht, Rumpf angespannt', 'Hüfte nach hinten-unten, Knie in Zehenrichtung', 'Tiefster Punkt – Oberschenkel etwa parallel', 'über die ganze Fußsohle hochdrücken'),
      setup(kit) { if (v === 'back' || v === 'front') props.bar = kit.barbell(2.1); else props.db = kit.dumbbell(1.25); },
      pose(s) {
        const o = mix(A0, B0, s);
        if (v === 'narrow') o.knee = { L: V(.03, 0, 1), R: V(-.03, 0, 1) };
        const K = kin(o);
        if (v === 'back') { o.hand = sides(sg => rel(K, sg, .42, .03, -.07)); o.elbow = sides(sg => DOWN.clone().addScaledVector(K.f, -.7).addScaledVector(K.l, sg * .2)); }
        else if (v === 'front') { o.hand = sides(sg => rel(K, sg, .19, .04, .15)); o.elbow = sides(sg => K.f.clone().addScaledVector(UP, .3).addScaledVector(K.l, sg * .3)); }
        else { o.hand = sides(sg => rel(K, sg, .05, -.12, .2)); o.elbow = sides(sg => DOWN.clone().addScaledVector(K.f, .2).addScaledVector(K.l, sg * .4)); }
        return o;
      },
      props(J) {
        const K = J.K;
        if (props.bar) props.bar.set(v === 'back' ? K.S.clone().addScaledVector(K.f, -.075).addScaledVector(K.u, .035) : K.S.clone().addScaledVector(K.f, .11).addScaledVector(K.u, .035), K.l);
        if (props.db) props.db.set(bothHands(J).add(V(0, .03, 0)), UP);
      }
    };
  };

  function lungePose(s, front, opt = {}) { // front: 'L' oder 'R'
    const fs = front === 'L' ? 1 : -1;
    const fA = V(fs * .12, DIM.ank, .4), bA = V(-fs * .12, lerp(.1, .13, s), -.52);
    const o = { pelvis: V(0, lerp(.88, .5, s), lerp(-.04, -.06, s)), pitch: lerp(3, 6, s), head: -3 };
    o.ankle = { [front]: fA, [front === 'L' ? 'R' : 'L']: bA };
    o.knee = { [front]: V(fs * .1, 0, 1), [front === 'L' ? 'R' : 'L']: V(0, -.7, 1) };
    o.foot = { [front]: V(fs * .1, 0, 1), [front === 'L' ? 'R' : 'L']: V(0, -.7, 1) };
    return o;
  }
  TPL.lunge = p => {
    const v = p.v, props = {};
    if (v === 'walk') {
      const STEP = .75, T1 = 2.6;
      const custom = t => {
        const tt = ((t % (2 * T1)) + 2 * T1) % (2 * T1), k = Math.floor(tt / T1), x = (tt % T1) / T1;
        const lead = k === 0 ? 'L' : 'R', trail = k === 0 ? 'R' : 'L', ls = lead === 'L' ? 1 : -1;
        const Z = k * STEP;
        let pz, py, lz, ly = DIM.ank, tz = Z, ty = DIM.ank, label, low;
        if (x < .4) { const u = ease(x / .4); lz = Z + STEP * u; ly = DIM.ank + .09 * Math.sin(Math.PI * Math.min(1, u * 1.25)); pz = Z + .3 * u; py = lerp(STAND_Y - .01, .52, u); label = 'Schritt nach vorne, kontrolliert absenken'; low = u; }
        else if (x < .55) { lz = Z + STEP; pz = Z + .3; py = .52; label = 'Unten – hinteres Knie knapp über dem Boden'; low = 1; }
        else { const u = ease((x - .55) / .45); lz = Z + STEP; pz = Z + .3 + .45 * u; py = lerp(.52, STAND_Y - .01, Math.min(1, u * 1.4)); tz = Z + STEP * clamp((u - .2) / .8, 0, 1); ty = DIM.ank + .1 * Math.sin(Math.PI * clamp((u - .2) / .8, 0, 1)); label = 'Über das vordere Bein hochdrücken, nächster Schritt'; low = 1 - u; }
        const o = { pelvis: V(0, py, pz), pitch: 4, head: -3 };
        o.ankle = { [lead]: V(ls * .12, ly, lz), [trail]: V(-ls * .12, ty + .04 * low, tz) };
        o.knee = { [lead]: V(ls * .1, 0, 1), [trail]: V(0, -.6 * low, 1) };
        o.foot = { [lead]: V(0, 0, 1), [trail]: V(0, -.7 * low, 1) };
        const drift = pz; // Figur bleibt mittig, Boden läuft mit
        for (const sd of ['L', 'R']) o.ankle[sd].z -= drift; o.pelvis.z -= drift;
        const K = kin(o); o.hand = sides(sg => shoulder(K, sg).addScaledVector(DOWN, .6).addScaledVector(K.l, sg * .05));
        o.elbow = sides(sg => K.f.clone().multiplyScalar(-1));
        return { pose: o, label, drift };
      };
      return { cam: { az: 70, el: 12, dist: 3.4, target: V(0, .9, 0) }, custom, setup(kit) { props.dL = dbAt(kit); props.dR = dbAt(kit); }, props(J) { props.dL.set(J.L.hand, J.K.f); props.dR.set(J.R.hand, J.K.f); } };
    }
    return {
      cam: { az: 70, el: 12, dist: 3.2, target: V(0, .9, 0) },
      timing: LBL.lower('Start – Schrittstellung, Oberkörper aufrecht', 'senkrecht nach unten absenken', 'Unten – vorderes Knie über dem Fuß, hinteres knapp über dem Boden', 'über die Ferse des vorderen Beins hochdrücken'),
      setup(kit) { if (v === 'bar') props.bar = kit.barbell(2.1); else { props.dL = dbAt(kit); props.dR = dbAt(kit); } },
      pose(s) {
        const o = lungePose(s, 'L'); const K = kin(o);
        if (v === 'bar') { o.hand = sides(sg => rel(K, sg, .42, .03, -.07)); o.elbow = sides(sg => DOWN.clone().addScaledVector(K.f, -.7)); }
        else { o.hand = sides(sg => shoulder(K, sg).addScaledVector(DOWN, .61).addScaledVector(K.l, sg * .04)); o.elbow = sides(() => K.f.clone().multiplyScalar(-1)); }
        return o;
      },
      props(J) { const K = J.K; if (props.bar) props.bar.set(K.S.clone().addScaledVector(K.f, -.075).addScaledVector(K.u, .035), K.l); if (props.dL) { props.dL.set(J.L.hand, K.f); props.dR.set(J.R.hand, K.f); } }
    };
  };

  TPL.legPress = () => {
    const pel = V(0, .52, 0), dS = nz(V(0, .7, .71)), props = {};
    const base = { pelvis: pel, pitch: -55, head: 20, foot: { L: rotA(V(0, .71, -.7), UP, 0), R: V(0, .71, -.7) } };
    return {
      cam: { az: 75, el: 16, dist: 3.4, target: V(0, .85, .4) },
      timing: LBL.lower('Start – Beine fast gestreckt, Knie nicht durchgedrückt', 'Plattform kontrolliert Richtung Brust sinken lassen', 'Unten – Knie ca. 90°, Gesäß bleibt am Polster', 'über die ganze Fußsohle wegdrücken'),
      setup(kit, MT) {
        seatFor(kit, pel, -55, { seatY: .41, backLen: .8, seatZ: .02 });
        for (const s of [-1, 1]) kit.rod(V(s * .38, .1, .25), V(s * .38, .1, .25).addScaledVector(dS, 1.5), .035, MT.steel);
        props.pf = kit.movBox(.62, .7, .05, MT.frame);
      },
      pose(s) {
        const L = lerp(.82, .4, s);
        const o = Object.assign({}, base);
        o.ankle = sides(sg => pel.clone().add(V(sg * .17, 0, 0)).addScaledVector(dS, L));
        const K = kin(o); o.knee = sides(sg => K.f.clone().addScaledVector(K.l, sg * .35));
        o.hand = sides(sg => relP(K, sg, .28, .02, .05)); o.elbow = sides(sg => K.l.clone().multiplyScalar(sg));
        return o;
      },
      props(J) { const c = midOf(J.L.ankle, J.R.ankle).addScaledVector(dS, .06).addScaledVector(nz(V(0, .71, -.7)), .1); props.pf.set(c, { x: V(1, 0, 0), y: nz(V(0, .71, -.7)), z: dS }); }
    };
  };

  TPL.legCurl = () => {
    const pel = V(0, .74, 0), props = {};
    return {
      cam: { az: 82, el: 18, dist: 3.1, target: V(0, .75, -.2) },
      timing: LBL.std('Start – Beine gestreckt, Polster über den Fersen', 'Fersen Richtung Gesäß beugen', 'Oben – Beinbeuger anspannen, Hüfte bleibt auf dem Polster', 'langsam strecken'),
      setup(kit, MT) {
        kit.box(.34, .08, 1.25, V(0, .6, .02), null, MT.pad); kit.rod(V(0, .55, .3), V(0, 0, .3), .04); kit.rod(V(0, .55, -.4), V(0, 0, -.4), .04);
        props.roll = kit.movCyl(.05, .32, MT.pad); props.arm = kit.movRod(.022);
      },
      pose(s) {
        const th = lerp(4, 112, s) * D2R;
        const o = { pelvis: pel, pitch: 92, head: -18 };
        const K = kin(o);
        o.ankle = sides(sg => { const kn = hip(K, sg).add(V(0, -.04, -DIM.thigh)); return kn.clone().add(V(0, Math.sin(th) * DIM.shin, -Math.cos(th) * DIM.shin)); });
        o.knee = sides(() => V(0, -1, 0));
        o.foot = sides(() => V(0, -Math.cos(th) * .8 - .2, -Math.sin(th)));
        o.hand = sides(sg => V(sg * .2, .6, K.S.z + .22)); o.elbow = sides(sg => V(sg, -.4, -.5));
        return o;
      },
      props(J) { const kn = midOf(J.L.knee, J.R.knee), an = midOf(J.L.ankle, J.R.ankle); const sd = nz(an.clone().sub(kn)), n = V(0, -sd.z, sd.y); const r = an.clone().addScaledVector(sd, -.03).addScaledVector(n, .085); props.roll.set(r, V(1, 0, 0)); props.arm.set(kn.clone().add(V(.24, 0, 0)), r.clone().add(V(.18, 0, 0))); }
    };
  };

  TPL.legExt = () => {
    const base = seatedUpright(-10, -.05), props = {};
    return {
      cam: { az: 75, el: 12, dist: 3.0, target: V(0, .7, .25) },
      timing: LBL.std('Start – Knie ca. 90°, Polster vorne über dem Sprunggelenk', 'Unterschenkel nach vorne strecken', 'Oben – Beine gestreckt, Oberschenkel anspannen', 'langsam beugen'),
      setup(kit, MT) { seatFor(kit, base.pelvis, -10, { seatY: .46, backLen: .62 }); props.roll = kit.movCyl(.05, .34, MT.pad); props.arm = kit.movRod(.022); },
      pose(s) {
        const th = lerp(6, 82, s) * D2R; const o = Object.assign({}, base); const K = kin(o);
        o.ankle = sides(sg => { const kn = hip(K, sg).add(V(0, -.01, DIM.thigh)); return kn.clone().add(V(0, -Math.cos(th) * DIM.shin, Math.sin(th) * DIM.shin)); });
        o.knee = sides(() => V(0, 1, .3)); o.foot = sides(() => V(0, Math.sin(th) * .9, Math.cos(th) + .1));
        o.hand = sides(sg => relP(K, sg, .27, .0, .1)); o.elbow = sides(sg => K.l.clone().multiplyScalar(sg));
        return o;
      },
      props(J) { const kn = midOf(J.L.knee, J.R.knee), an = midOf(J.L.ankle, J.R.ankle); const sd = nz(an.clone().sub(kn)), n = V(0, -sd.z, sd.y).multiplyScalar(-1); const r = an.clone().addScaledVector(sd, -.03).addScaledVector(n, .08); props.roll.set(r, V(1, 0, 0)); props.arm.set(kn.clone().add(V(.25, 0, 0)), r.clone().add(V(.19, 0, 0))); }
    };
  };

  TPL.hipThrust = () => {
    const Sp = V(0, .5, -.28), props = {};
    return {
      cam: { az: 72, el: 12, dist: 3.2, target: V(0, .5, .1) },
      timing: LBL.std('Start – Schulterblätter an der Bank, Gesäß unten', 'Hüfte nach oben strecken', 'Oben – Oberkörper & Oberschenkel bilden eine Linie', 'kontrolliert absenken'),
      setup(kit, MT) { kit.box(1.1, .42, .32, V(0, .21, -.42), null, MT.pad); props.bar = kit.barbell(2.0, .22); },
      pose(s) {
        const a = lerp(38, -2, s) * D2R, len = DIM.lumbar + DIM.thor;
        const pel = Sp.clone().add(V(0, -Math.sin(a) * len, Math.cos(a) * len));
        const o = { pelvis: pel, pitch: -(90 - a / D2R), head: lerp(25, 50, s), ankle: { L: V(.2, DIM.ank, .52), R: V(-.2, DIM.ank, .52) }, knee: { L: V(.15, 1, .2), R: V(-.15, 1, .2) }, foot: toeOut(8) };
        const K = kin(o); o.hand = sides(sg => K.pel.clone().addScaledVector(K.P.f, .2).addScaledVector(K.P.l, sg * .33).addScaledVector(K.P.u, .02));
        o.elbow = sides(sg => K.P.l.clone().multiplyScalar(sg).add(DOWN));
        return o;
      },
      props(J) { const K = J.K; props.bar.set(K.pel.clone().addScaledVector(K.P.f, .19).addScaledVector(K.P.u, .02), V(1, 0, 0)); }
    };
  };

  TPL.kickback = () => {
    const base = stand({ w: .1, p: { pitch: 28, pelvis: V(0, STAND_Y - .03, -.08), head: -15 } }), pul = V(0, .14, .65), props = {};
    base.knee = { L: V(.05, 0, 1), R: V(-.05, 0, 1) };
    return {
      cam: { az: 85, el: 10, dist: 3.2, target: V(0, .85, 0) },
      timing: LBL.std('Start – Standbein leicht gebeugt, Oberkörper vorgeneigt', 'Arbeitsbein gestreckt nach hinten-oben führen', 'Gesäß maximal anspannen – kein Hohlkreuz', 'kontrolliert zurück'),
      setup(kit) { kit.tower(pul, V(0, 0, 1)); props.c = kit.line(); },
      pose(s) {
        const o = Object.assign({}, base); const K = kin(o);
        const a = lerp(-8, 38, s) * D2R;
        o.ankle = { L: base.ankle.L, R: hip(K, -1).addScaledVector(DOWN, Math.cos(a) * (LEG - .03)).addScaledVector(horiz(K.f), -Math.sin(a) * (LEG - .03)) };
        o.knee = { L: V(.05, 0, 1), R: V(0, -.3, 1) }; o.foot = { L: V(.1, 0, 1), R: V(0, -.6, -.4) };
        o.hand = sides(sg => V(sg * .12, 1.15, .72)); o.elbow = sides(sg => V(sg, -1, 0));
        return o;
      },
      props(J) { props.c.set(pul, J.R.ankle); }
    };
  };

  TPL.adAb = p => {
    const ab = p.v === 'ab', base = seatedUpright(-18, -.05), props = {};
    return {
      cam: { az: 10, el: 30, dist: 2.9, target: V(0, .65, .2) },
      timing: ab ? LBL.std('Start – Knie geschlossen, Rücken an der Lehne', 'Beine gegen die Polster nach außen drücken', 'Außen – Gesäßmuskulatur anspannen', 'langsam schließen') : LBL.std('Start – Beine geöffnet, Polster innen an den Knien', 'Beine gegen den Widerstand schließen', 'Knie fast zusammen – Adduktoren anspannen', 'langsam öffnen'),
      setup(kit) { seatFor(kit, base.pelvis, -18, { seatY: .47, backLen: .7 }); props.pL = kit.movBox(.06, .3, .22); props.pR = kit.movBox(.06, .3, .22); },
      pose(s) {
        const ang = (ab ? lerp(4, 38, s) : lerp(42, 6, s));
        const o = Object.assign({}, base); const K = kin(o);
        o.ankle = sides(sg => { const d = rotA(V(0, 0, 1), UP, sg * ang); const kn = hip(K, sg).addScaledVector(d, DIM.thigh).add(V(0, .03, 0)); return kn.clone().add(V(0, -DIM.shin + .02, -.04)); });
        o.knee = sides(sg => rotA(V(0, 1, 1), UP, sg * ang)); o.foot = sides(sg => rotA(V(0, 0, 1), UP, sg * ang));
        o.hand = sides(sg => relP(K, sg, .28, .0, .05)); o.elbow = sides(sg => K.l.clone().multiplyScalar(sg));
        return o;
      },
      props(J) { for (const [sd, sg] of [['L', 1], ['R', -1]]) { const j = J[sd]; const side = nz(j.knee.clone().sub(j.hip)).cross(UP).multiplyScalar(sg); props['p' + sd].set(j.knee.clone().addScaledVector(side, ab ? -.08 : .08).add(V(0, -.05, 0)), basisFromY(UP, side)); } }
    };
  };

  TPL.calf = p => {
    const seated = p.v === 'seated', props = {}, step = .1;
    const footAt = (sg, phi, zb) => { const ball = V(sg * .12, step + .02, zb); return { ankle: ball.clone().add(V(0, .06 + .13 * Math.sin(phi * D2R), -.13 * Math.cos(phi * D2R))), foot: V(0, Math.sin(phi * D2R) * -.9, 1) }; };
    return {
      cam: { az: 70, el: 8, dist: seated ? 2.7 : 3.4, target: V(0, seated ? .55 : .95, 0) },
      timing: LBL.std('Start – Fersen tief, Waden gedehnt', 'Fersen so hoch wie möglich drücken', 'Oben – kurz halten', 'langsam tief absenken'),
      setup(kit, MT) {
        kit.box(.6, step, .25, V(0, step / 2, seated ? .46 : .1), null, MT.frame);
        if (seated) { seatFor(kit, V(0, .62, -.05), 0, { seatY: .52, back: false }); props.pad = kit.movBox(.4, .06, .2); }
        else { props.pad = kit.movBox(.55, .07, .16); kit.box(.1, 2.0, .1, V(0, 1.0, -.35), null, MT.frame); }
      },
      pose(s) {
        const phi = lerp(-18, 32, s);
        if (seated) {
          const o = { pelvis: V(0, .62, -.05), pitch: 0 }; const K = kin(o);
          o.ankle = sides(sg => footAt(sg, phi, .5).ankle); o.foot = sides(sg => footAt(sg, phi, .5).foot); o.knee = sides(() => V(0, 1, 1));
          o.hand = sides(sg => V(sg * .16, .66, .32)); o.elbow = sides(sg => V(sg, 0, -.5)); return o;
        }
        const f = footAt(1, phi, .16); const lift = f.ankle.y - DIM.ank;
        const o = stand({ w: .12, toe: 0 }); o.pelvis = V(0, STAND_Y + lift, -.0); o.ankle = sides(sg => footAt(sg, phi, .16).ankle); o.foot = sides(sg => footAt(sg, phi, .16).foot);
        const K = kin(o); o.hand = sides(sg => rel(K, sg, .26, .06, .02)); o.elbow = sides(sg => DOWN.clone().addScaledVector(K.l, sg)); return o;
      },
      props(J) { const K = J.K; if (seated) props.pad.set(midOf(J.L.knee, J.R.knee).add(V(0, .08, -.06)), null); else props.pad.set(K.S.clone().add(V(0, .06, 0)), null); }
    };
  };

  /* === BAUCH & STABILISATION ================================================== */
  TPL.crunchCable = () => {
    const pul = V(0, 2.15, .55), props = {};
    const base = { pelvis: V(0, .53, -.02), ankle: { L: V(.13, .08, -.45), R: V(-.13, .08, -.45) }, knee: { L: V(0, -1, .5), R: V(0, -1, .5) }, foot: { L: V(0, -.3, -1), R: V(0, -.3, -1) } };
    return {
      cam: { az: 80, el: 12, dist: 3.0, target: V(0, .8, .15) },
      timing: LBL.std('Start – kniend, Seil neben dem Kopf', 'Oberkörper einrollen, Ellbogen Richtung Knie', 'Unten – Bauch maximal anspannen', 'kontrolliert aufrollen'),
      setup(kit) { kit.tower(pul, V(0, 0, 1)); kit.floorMat(-.7, .5); props.c = kit.line(); props.rL = kit.line(kit.MT.dark, .012); props.rR = kit.line(kit.MT.dark, .012); },
      pose(s) {
        const o = Object.assign({}, base, { pitch: lerp(12, 30, s), flex: lerp(0, 55, s), head: lerp(0, 15, s) }); const K = kin(o);
        o.hand = sides(sg => rel(K, sg, .1, .14, .1)); o.elbow = sides(sg => K.f.clone().addScaledVector(K.l, sg * .3).addScaledVector(K.u, -.5));
        return o;
      },
      props(J) { const m = bothHands(J).add(V(0, .12, .04)); props.c.set(pul, m); props.rL.set(m, J.L.hand); props.rR.set(m, J.R.hand); }
    };
  };

  TPL.legRaise = p => {
    const v = p.v, props = {}, hy = 2.25;
    if (v === 'lying') {
      const base = { pelvis: V(0, .12, 0), pitch: -90, head: 10 };
      return {
        cam: { az: 75, el: 18, dist: 3.0, target: V(0, .35, .1) },
        timing: LBL.std('Start – Beine gestreckt knapp über dem Boden', 'Beine gestreckt bis zur Senkrechten heben', 'Oben – unterer Rücken am Boden', 'langsam absenken – Füße nicht ablegen'),
        setup(kit) { kit.floorMat(-1, 1.1); },
        pose(s) {
          const th = lerp(8, 88, s) * D2R; const o = Object.assign({}, base); const K = kin(o);
          o.ankle = sides(sg => hip(K, sg).add(V(0, Math.sin(th) * (LEG - .01), Math.cos(th) * (LEG - .01))));
          o.knee = sides(() => V(0, Math.cos(th), -Math.sin(th))); o.foot = sides(() => V(0, Math.cos(th), -Math.sin(th) + .3));
          o.hand = sides(sg => relP(K, sg, .27, -.05, -.07)); o.elbow = sides(sg => V(sg, .5, 0));
          return o;
        }
      };
    }
    const straight = v === 'hangStraight';
    return {
      cam: { az: 70, el: 8, dist: 3.6, target: V(0, 1.4, .1) },
      timing: straight ? LBL.std('Start – frei hängend, Körper ruhig', 'gestreckte Beine bis zur Waagerechten heben', 'Oben – Bauch anspannen, kein Schwung', 'langsam absenken') : LBL.std('Start – frei hängend, Körper ruhig', 'Knie zur Brust ziehen, Becken einrollen', 'Oben – Bauch anspannen', 'langsam absenken'),
      setup(kit, MT) { kit.rod(V(-.6, hy, 0), V(.6, hy, 0), .018, MT.steel); for (const s of [-1, 1]) kit.rod(V(s * .6, 0, 0), V(s * .6, hy + .05, 0), .035); },
      pose(s) {
        const pel = V(0, hy - .6 - .5 + .02 + .02 * s, -.03 + .05 * s);
        const o = { pelvis: pel, pitch: lerp(0, -8, s), flex: lerp(0, 10, s) }; const K = kin(o);
        o.hand = sides(sg => V(sg * .26, hy, 0)); o.elbow = sides(sg => V(sg, 0, -.3));
        const th = (straight ? lerp(4, 88, s) : lerp(4, 105, s)) * D2R;
        if (straight) { o.ankle = sides(sg => hip(K, sg).add(V(0, -Math.cos(th) * (LEG - .01), Math.sin(th) * (LEG - .01)))); o.knee = sides(() => V(0, Math.sin(th), Math.cos(th))); o.foot = sides(() => V(0, Math.sin(th), Math.cos(th))); }
        else { o.ankle = sides(sg => { const kn = hip(K, sg).add(V(0, -Math.cos(th) * DIM.thigh, Math.sin(th) * DIM.thigh)); return kn.add(V(0, -DIM.shin * .98, -.05 * s)); }); o.knee = sides(() => V(0, Math.sin(th), Math.cos(th) + .2)); o.foot = sides(() => V(0, -.3, 1)); }
        return o;
      }
    };
  };

  TPL.russianTwist = () => {
    const props = {}, P = 2.4;
    return {
      cam: { az: 55, el: 16, dist: 2.9, target: V(0, .45, .15) },
      custom(t) {
        const ph = (t % P) / P, tw = Math.sin(ph * Math.PI * 2) * 38;
        const o = { pelvis: V(0, .13, 0), pitch: -40, twist: tw, head: -10, ankle: { L: V(.1, .2, .52), R: V(-.1, .2, .52) }, knee: { L: V(.05, 1, .3), R: V(-.05, 1, .3) }, foot: { L: V(0, .2, 1), R: V(0, .2, 1) } };
        const K = kin(o); const c = K.S.clone().addScaledVector(K.f, .34).addScaledVector(K.u, -.16);
        o.hand = sides(sg => c.clone().addScaledVector(K.l, sg * .06)); o.elbow = sides(sg => K.l.clone().multiplyScalar(sg).add(DOWN));
        return { pose: o, label: tw > 5 ? 'Oberkörper nach links drehen – Gewicht neben die Hüfte' : tw < -5 ? 'Oberkörper nach rechts drehen' : 'Durch die Mitte – Rücken gerade, Füße in der Luft' };
      },
      setup(kit) { kit.floorMat(-.6, .8); props.pl = kit.plate(.15); },
      props(J) { props.pl.set(bothHands(J), J.K.f); }
    };
  };

  TPL.plank = p => {
    const props = {};
    if (p.v === 'side' || p.v === 'sideLeg') {
      const sh = V(-.58, .4, 0), ft = V(.82, .1, 0);
      const leg = p.v === 'sideLeg';
      return {
        cam: { az: 8, el: 12, dist: 3.1, target: V(.1, .35, 0) },
        timing: leg ? LBL.std('Start – Seitstütz, Körper in einer Linie', 'oberes Bein gestreckt anheben', 'Oben – Becken bleibt oben', 'Bein kontrolliert absenken') : LBL.lower('Start – Seitstütz, Körper in einer Linie', 'Becken kontrolliert Richtung Boden senken', 'Unten – kurz vor dem Boden', 'Becken wieder hochdrücken'),
        setup(kit) { kit.box(1.9, .012, .6, V(.1, .006, 0), null, kit.MT.mat); },
        pose(s) {
          const sag = leg ? 0 : s * .15;
          // Becken liegt auf der Linie Schulter–Fuß (minus Absenkung)
          const lineP = sh.clone().lerp(ft, .37); const pel = lineP.add(V(0, -sag, 0));
          const ud = nz(sh.clone().add(V(0, -.0, 0)).sub(pel)); // Richtung Becken → Schulter
          const roll = Math.atan2(-ud.x, ud.y) / D2R; // Rumpf neigt sich zur Schulter
          const o = { pelvis: pel, roll, pitch: 0, head: 0 };
          const K = kin(o);
          const up = K.P.l; // Körperlinks zeigt nach oben
          o.ankle = { R: ft.clone().add(V(0, -.02, .05)), L: leg ? hip(K, 1).addScaledVector(nz(ft.clone().sub(pel)), LEG - .02).addScaledVector(up, .38 * s) : ft.clone().add(V(0, .1, -.05)) };
          o.knee = { L: V(0, 0, 1), R: V(0, 0, 1) }; o.foot = { L: V(.1, 0, 1), R: V(.1, 0, 1) };
          o.hand = { R: V(sh.x - .02, .03, .3), L: relP(K, 1, .12, .06, 0) };
          o.elbow = { R: V(0, -1, -.1), L: up.clone().addScaledVector(K.f, -.3) };
          return o;
        }
      };
    }
    const base = { pelvis: V(0, .36, 0), pitch: 83, head: -12, ankle: { L: V(.12, .12, -.9), R: V(-.12, .12, -.9) }, foot: { L: V(0, -1, .35), R: V(0, -1, .35) }, knee: { L: V(0, -1, 0), R: V(0, -1, 0) } };
    const leg = p.v === 'leg';
    return {
      cam: { az: 80, el: 14, dist: 2.8, target: V(0, .3, -.1) },
      timing: leg ? LBL.std('Start – Unterarmstütz, Körper in einer Linie', 'ein Bein gestreckt anheben', 'Oben – Becken bleibt ruhig', 'Bein absenken, Seite wechseln') : { dur: [.8, 1.6, .8, 1.6], labels: ['Halten – Körper bildet eine Linie', 'Halten – Bauch & Gesäß anspannen', 'Halten – ruhig weiteratmen', 'Halten – Becken nicht durchhängen lassen'] },
      setup(kit) { kit.floorMat(-1.1, .7); },
      pose(s) {
        const o = Object.assign({}, base); const K = kin(o);
        o.hand = sides(sg => V(sg * .1, .05, K.S.z + .27)); o.elbow = sides(sg => V(sg * .15, -1, -.25));
        if (leg) o.ankle = { L: V(.12, lerp(.12, .38, s), -.9), R: base.ankle.R };
        return o;
      }
    };
  };

  /* === ATHLETIK (eigene Zeitachse) =========================================== */
  function jumpPose(d, air, o = {}) { // d: Hocktiefe 0..1, air: Höhe über Boden, arm: Armwinkel
    const x = o.x || 0, z = o.z || 0, w = o.w || .15;
    const p = { pelvis: V(x, STAND_Y - .01 - .4 * d + air, z - .14 * d), pitch: 34 * d + (o.pitch || 0), head: -20 * d };
    const tuck = o.tuck || 0;
    p.ankle = { L: V(x + w, DIM.ank + air + tuck * .45, z - tuck * .1), R: V(x - w, DIM.ank + air + tuck * .45, z - tuck * .1) };
    p.knee = toeOut(12); p.foot = air > .02 ? { L: V(.1, -.4, 1), R: V(-.1, -.4, 1) } : toeOut(10);
    const K = kin(p), a = o.arm !== undefined ? o.arm : 20;
    p.hand = sides(sg => shoulder(K, sg).addScaledVector(armDir(K, a), .58).addScaledVector(K.l, sg * .06));
    p.elbow = sides(sg => armDir(K, a + 90).multiplyScalar(-1).addScaledVector(K.l, sg * .2));
    return p;
  }
  // Keyframes [Zeit, {d, air, arm, x, tuck}, Label]
  function keyAnim(keys, total) {
    return t => {
      const x = ((t % total) + total) % total;
      let i = 0; while (i < keys.length - 1 && keys[i + 1][0] <= x) i++;
      const a = keys[i], b = keys[(i + 1) % keys.length], tb = i + 1 < keys.length ? b[0] : total;
      const u = tb > a[0] ? (x - a[0]) / (tb - a[0]) : 0;
      const k = a[1].lin ? u : ease(u);
      const m = {}; for (const key of new Set([...Object.keys(a[1]), ...Object.keys(b[1])])) { if (key === 'lin' || key === 'air') continue; m[key] = lerp(a[1][key] || 0, b[1][key] || 0, k); }
      const airA = a[1].air || 0, airB = b[1].air || 0;
      m.air = a[1].arc ? airA + (airB - airA) * u + a[1].arc * 4 * u * (1 - u) : lerp(airA, airB, k);
      return { pose: jumpPose(m.d || 0, m.air, m), label: a[2] };
    };
  }
  TPL.jump = p => {
    const v = p.v, props = {};
    const cam = { az: 60, el: 10, dist: 3.6, target: V(0, .95, 0) };
    if (v === 'squat') return { cam, custom: keyAnim([[0, { d: 0, arm: 10 }, 'Start – hüftbreiter Stand'], [.5, { d: .95, arm: -45 }, 'Tief in die Hocke, Arme nach hinten'], [.85, { d: 0, arm: 150, arc: .35 }, 'Explosiv nach oben springen, Arme schwingen mit'], [1.3, { d: .55, arm: 60 }, 'Weich über Fußballen landen, Knie federn'], [1.8, { d: 0, arm: 10 }, 'Aufrichten']], 2.4) };
    if (v === 'tuck') return { cam, custom: keyAnim([[0, { d: 0, arm: 10 }, 'Start – hüftbreiter Stand'], [.4, { d: .45, arm: -35 }, 'Kurz in die Knie, Arme nach hinten'], [.62, { d: .1, arm: 90, tuck: 0, arc: .25 }, 'Explosiv abspringen'], [.85, { d: .2, arm: 70, tuck: 1, air: .38 }, 'Knie zur Brust ziehen'], [1.1, { d: .5, arm: 60 }, 'Weich landen, Knie federn'], [1.6, { d: 0, arm: 10 }, 'Aufrichten']], 2.2) };
    if (v === 'lateral') return { cam: { az: 10, el: 10, dist: 3.8, target: V(0, .9, 0) }, setup(kit) { kit.box(.02, .005, .8, V(0, .003, 0), null, kit.MT.gold); }, custom: keyAnim([[0, { d: .35, x: -.32, w: .12, arm: 30 }, 'Links landen, Knie federn'], [.25, { d: .1, x: -.32, w: .12, arm: 60, arc: .14 }, 'Seitlich über die Linie springen'], [.6, { d: .35, x: .32, w: .12, arm: 30 }, 'Rechts landen, Knie federn'], [.85, { d: .1, x: .32, w: .12, arm: 60, arc: .14 }, 'Zurück über die Linie springen']], 1.2) };
    if (v === 'latSquat') return { cam: { az: 8, el: 12, dist: 4.4, target: V(0, .9, 0) }, setup(kit) { for (const x of [-.65, 0, .65]) kit.box(.3, .005, .3, V(x, .003, 0), null, kit.MT.mat); },
      custom: keyAnim([
        [0, { d: .9, x: 0, w: .2, arm: -30 }, 'Mitte – tiefe Hocke'], [.45, { d: .2, x: 0, w: .2, arm: 80, arc: .25 }, 'Explosiv nach rechts springen'], [.9, { d: .9, x: -.65, w: .2, arm: -30 }, 'Rechts in der Hocke landen'],
        [1.35, { d: .2, x: -.65, w: .2, arm: 80, arc: .25 }, 'Zurück zur Mitte springen'], [1.8, { d: .9, x: 0, w: .2, arm: -30 }, 'Mitte – Hocke'], [2.25, { d: .2, x: 0, w: .2, arm: 80, arc: .25 }, 'Explosiv nach links springen'],
        [2.7, { d: .9, x: .65, w: .2, arm: -30 }, 'Links in der Hocke landen'], [3.15, { d: .2, x: .65, w: .2, arm: 80, arc: .25 }, 'Zurück zur Mitte springen']], 3.6) };
    if (v === 'box') {
      const H = .5, BZ = .62;
      const boxPose = t => {
        const keys = [[0, 0, 0, 0, 10], [.55, .95, 0, 0, -45], [.95, .35, .62, BZ, 140], [1.3, .55, H, BZ, 60], [1.9, 0, H, BZ, 10], [2.4, 0, H, BZ, 10]];
        const total = 4.0; const x = t % total;
        if (x < 2.4) { // Sprung hinauf
          let i = 0; while (i < keys.length - 1 && keys[i + 1][0] <= x) i++;
          const a = keys[i], b = keys[Math.min(i + 1, keys.length - 1)], u = b[0] > a[0] ? ease((x - a[0]) / (b[0] - a[0])) : 0;
          const lab = ['Start vor der Box', 'Ausholen – Hocke, Arme nach hinten', 'Explosiv auf die Box springen', 'Weich auf der Box landen', 'Auf der Box aufrichten', 'Oben stehen'][i];
          const pose = jumpPose(lerp(a[1], b[1], u), 0, { arm: lerp(a[4], b[4], u) });
          const air = i === 2 ? lerp(a[2], b[2], u) + .25 * Math.sin(Math.PI * u) : lerp(a[2], b[2], u), z = lerp(a[3], b[3], u);
          shiftPose(pose, V(0, air, z)); return { pose, label: lab };
        }
        // kontrolliert herabsteigen: erst rechts, dann links
        const u = (x - 2.4) / 1.6, pose = jumpPose(0, 0, { arm: 10 });
        const k1 = ease(clamp(u / .5, 0, 1)), k2 = ease(clamp((u - .5) / .5, 0, 1));
        const pz = BZ - BZ * (k1 * .5 + k2 * .5), py = H * (1 - k1 * .9) * (1 - k2) ;
        shiftPose(pose, V(0, py, pz));
        pose.ankle.R = V(-.15, DIM.ank + H * (1 - k1) + .06 * Math.sin(Math.PI * k1), BZ * (1 - k1));
        pose.ankle.L = V(.15, DIM.ank + H * (1 - k2) + .06 * Math.sin(Math.PI * k2), BZ * (1 - k2));
        return { pose, label: 'Kontrolliert rückwärts von der Box steigen' };
      };
      return { cam: { az: 70, el: 12, dist: 4.3, target: V(0, 1.15, .3) }, setup(kit) { kit.box(.6, H, .5, V(0, H / 2, BZ + .02), null, kit.MT.box); }, custom: boxPose };
    }
    if (v === 'mountain') {
      const P = .8;
      return {
        cam: { az: 72, el: 14, dist: 2.9, target: V(0, .4, 0) }, setup(kit) { kit.floorMat(-1, .8); },
        custom(t) {
          const ph = (t % P) / P;
          const o = { pelvis: V(0, .55, -.04), pitch: 77, head: -20, foot: { L: V(0, -1, .4), R: V(0, -1, .4) }, knee: { L: V(0, -1, .3), R: V(0, -1, .3) } };
          const K = kin(o);
          o.hand = sides(sg => V(sg * .2, .03, K.S.z + .02)); o.elbow = sides(sg => V(sg * .3, 0, -1));
          const drive = (u) => Math.max(0, Math.sin(u * Math.PI * 2));
          const pos = (sg, u) => { const k = drive(u); return V(sg * .12, .13 + .12 * k, lerp(-.82, -.05, k)); };
          o.ankle = { L: pos(1, ph), R: pos(-1, ph + .5) };
          return { pose: o, label: ph < .5 ? 'Linkes Knie zur Brust ziehen' : 'Rechtes Knie zur Brust ziehen – Hüfte bleibt tief' };
        }
      };
    }
    if (v === 'lungeJump') {
      const P = 2.0;
      return {
        cam: { az: 72, el: 10, dist: 3.4, target: V(0, .9, 0) },
        custom(t) {
          const x = (t % P) / P; const seg = x < .5 ? 0 : 1, u = (x % .5) / .5;
          const A = seg === 0 ? 'L' : 'R', B = seg === 0 ? 'R' : 'L';
          let pose, label;
          if (u < .35) { pose = lungePose(ease(u / .35) * .3 + .7, A); label = 'Tief in den Ausfallschritt'; }
          else if (u < .7) { // Flugphase, Beine wechseln
            const k = (u - .35) / .35; const pa = lungePose(.7, A), pb = lungePose(.7, B);
            pose = mix(pa, pb, ease(k)); const air = .28 * Math.sin(Math.PI * k);
            pose.pelvis.y = lerp(.6, .6, k) + air + .25 * Math.sin(Math.PI * k);
            for (const sd of ['L', 'R']) { pose.ankle[sd] = lv(pa.ankle[sd], pb.ankle[sd], ease(k)); pose.ankle[sd].y += air + .2 * Math.sin(Math.PI * k); }
            pose.knee = { L: V(0, -.3, 1), R: V(0, -.3, 1) }; pose.foot = { L: V(0, -.5, 1), R: V(0, -.5, 1) };
            label = 'Explosiv abspringen, Beine in der Luft wechseln';
          } else { pose = lungePose(1 - ease((u - .7) / .3) * .3, B); label = 'Weich im Ausfallschritt landen'; }
          const K = kin(pose); pose.hand = sides((sg, sd) => shoulder(K, sg).addScaledVector(armDir(K, (sd === A ? 40 : -30) * (u < .7 ? 1 : -1)), .58)); pose.elbow = sides(() => K.f.clone().multiplyScalar(-1));
          return { pose, label };
        }
      };
    }
  };
  function shiftPose(p, d) { p.pelvis.add(d); for (const sd of ['L', 'R']) { if (p.ankle && p.ankle[sd]) p.ankle[sd].add(d); if (p.hand && p.hand[sd]) p.hand[sd].add(d); } }

  /* ---------- Viewer ---------- */
  class Viewer {
    constructor(host, opts = {}) {
      this.host = host; this.opts = opts;
      const w = host.clientWidth || 360, h = host.clientHeight || 400;
      const R = this.renderer = new T.WebGLRenderer({ antialias: true, powerPreference: 'low-power' });
      R.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); R.setSize(w, h); R.outputEncoding = T.sRGBEncoding;
      R.shadowMap.enabled = true; R.shadowMap.type = T.PCFSoftShadowMap;
      host.appendChild(R.domElement); Object.assign(R.domElement.style, { display: 'block', touchAction: 'none', width: '100%', height: '100%' });
      const S = this.scene = new T.Scene(); S.background = new T.Color(0x0f2533); S.fog = new T.Fog(0x0f2533, 7, 16);
      this.cam = new T.PerspectiveCamera(38, w / h, .05, 40);
      S.add(new T.HemisphereLight(0xfff4e6, 0x10222e, .9));
      const key = new T.DirectionalLight(0xffffff, 1.1); key.position.set(2.2, 4.2, 3); key.castShadow = true; key.shadow.mapSize.set(1024, 1024); key.shadow.bias = -.0005;
      Object.assign(key.shadow.camera, { left: -2.6, right: 2.6, top: 2.8, bottom: -2.6, near: .5, far: 12 }); S.add(key);
      const rim = new T.DirectionalLight(0xe2b96a, .7); rim.position.set(-3, 2.5, -2.5); S.add(rim);
      const fill = new T.DirectionalLight(0xffffff, .35); fill.position.set(-2, 1.5, 3); S.add(fill);
      const floor = new T.Mesh(new T.CircleGeometry(5, 48), new T.MeshStandardMaterial({ color: 0x15303f, roughness: .95 })); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; S.add(floor);
      this.grid = new T.GridHelper(8, 32, 0x2a4a5c, 0x1c3646); this.grid.position.y = .002; S.add(this.grid);
      this.MT = mats(); this.fig = new Figure(S, this.MT, opts.figure || 'm');
      this.az = 30; this.el = 12; this.dist = 3; this.target = V(0, .9, 0); this.goal = null;
      this.t = 0; this.speed = 1; this.playing = true; this.loop = true; this.muscleOn = false;
      this._bindInput(); this._loop = this._loop.bind(this); this.last = performance.now(); this.raf = requestAnimationFrame(this._loop);
      if (window.ResizeObserver) { this._ro = new ResizeObserver(() => this.resize()); this._ro.observe(host); }
    }
    load(ex) {
      if (this.kit) this.kit.dispose();
      const mk = TPL[ex.anim.t]; if (!mk) throw new Error('Unbekannte Animationsvorlage: ' + ex.anim.t);
      this.ex = ex; this.kit = new Kit(this.scene, this.MT); this.tpl = mk(ex.anim);
      if (!this.tpl) throw new Error('Vorlage liefert nichts: ' + JSON.stringify(ex.anim));
      this.tpl.setup && this.tpl.setup(this.kit, this.MT);
      const c = this.defaultCam = this.tpl.cam;
      this.az = c.az; this.el = c.el; this.dist = c.dist; this.target = c.target.clone(); this.goal = null;
      this.fig.highlight(ex.primary || [], ex.secondary || [], this.muscleOn);
      this.period = this.tpl.custom ? null : this.tpl.timing.dur.reduce((a, b) => a + b, 0);
      this.t = 0; this._done = false; this._frame(0); this.render();
    }
    setFigure(style) {
      if (this.fig && this.fig.style === style) return;
      this.fig.dispose(); this.fig = new Figure(this.scene, this.MT, style);
      if (this.ex) { this.fig.highlight(this.ex.primary || [], this.ex.secondary || [], this.muscleOn); this._frame(0); }
      this.render();
    }
    setMuscles(on) { this.muscleOn = on; if (this.ex) this.fig.highlight(this.ex.primary || [], this.ex.secondary || [], on); this.render(); }
    setView(v) {
      const c = this.defaultCam, m = { front: [0, 8], back: [180, 8], side: [90, 8], side2: [-90, 8], diag: [40, 18], auto: [c.az, c.el] };
      const [az, el] = m[v] || m.auto, daz = ((az - this.az) % 360 + 540) % 360 - 180;
      this.goal = { az: this.az + daz, el, dist: c.dist, target: c.target.clone() };
    }
    reset() { this.t = 0; this._done = false; this._frame(0); this.render(); }
    _frame(dt) {
      if (!this.tpl) return;
      this.t += dt * this.speed;
      if (!this.loop && this.period && this.t >= this.period) { this.t = this.period - 1e-3; this._done = true; this.playing = false; this.onStop && this.onStop(); }
      let r;
      if (this.tpl.custom) r = this.tpl.custom(this.t);
      else { const tm = this.tpl.timing; r = rep(this.t, tm.dur, tm.labels); r.pose = this.tpl.pose(r.s); }
      const J = solve(r.pose);
      this.fig.update(J); this.tpl.props && this.tpl.props(J, r.s, this.t);
      this.grid.position.z = r.drift !== undefined ? -(r.drift % .25) : 0;
      if (this.onPhase && r.label !== this._lastLabel) { this._lastLabel = r.label; this.onPhase(r.label); }
    }
    showAt(s, t) { this.playing = false; let r; if (this.tpl.custom) r = this.tpl.custom(t !== undefined ? t : s); else r = { pose: this.tpl.pose(s) }; const J = solve(r.pose); this.fig.update(J); this.tpl.props && this.tpl.props(J, s, t || 0); this.render(); }
    _loop(now) {
      this.raf = requestAnimationFrame(this._loop);
      const dt = Math.min(.05, (now - this.last) / 1000); this.last = now;
      if (document.hidden || (this.host.offsetParent === null && !this.opts.force)) return;
      if (this.playing) this._frame(dt);
      if (this.goal) {
        const g = this.goal, k = 1 - Math.pow(.002, dt);
        this.az = lerp(this.az, g.az, k); this.el = lerp(this.el, g.el, k); this.dist = lerp(this.dist, g.dist, k); this.target.lerp(g.target, k);
        if (Math.abs(this.az - g.az) < .1 && Math.abs(this.el - g.el) < .1) this.goal = null;
      }
      this.render();
    }
    render() {
      const a = this.az * D2R, e = this.el * D2R;
      // Hochformat (Handy): Kamera etwas weiter weg, damit Figur & Gerät ganz sichtbar sind
      const asp = this.cam.aspect || 1, d = this.dist * (asp < 1 ? Math.pow(1 / asp, .72) : 1);
      this.cam.position.set(this.target.x + Math.sin(a) * Math.cos(e) * d, this.target.y + Math.sin(e) * d, this.target.z + Math.cos(a) * Math.cos(e) * d);
      this.cam.lookAt(this.target); this.renderer.render(this.scene, this.cam);
    }
    resize() { const w = this.host.clientWidth, h = this.host.clientHeight; if (!w || !h) return; this.renderer.setSize(w, h); this.cam.aspect = w / h; this.cam.updateProjectionMatrix(); this.render(); }
    zoom(f) { this.dist = clamp(this.dist * f, 1.3, 7); this.goal = null; }
    _bindInput() {
      const el = this.renderer.domElement, pts = new Map(); let pinch = 0;
      el.addEventListener('pointerdown', e => { el.setPointerCapture(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]); this.goal = null; });
      el.addEventListener('pointermove', e => {
        if (!pts.has(e.pointerId)) return; const [x0, y0] = pts.get(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]);
        if (pts.size === 1) { this.az -= (e.clientX - x0) * .45; this.el = clamp(this.el + (e.clientY - y0) * .3, -5, 80); }
        else if (pts.size === 2) { const [a, b] = [...pts.values()]; const d = Math.hypot(a[0] - b[0], a[1] - b[1]); if (pinch) this.dist = clamp(this.dist * pinch / d, 1.3, 7); pinch = d; }
      });
      const up = e => { pts.delete(e.pointerId); if (pts.size < 2) pinch = 0; };
      el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
      el.addEventListener('wheel', e => { e.preventDefault(); this.zoom(1 + Math.sign(e.deltaY) * .08); }, { passive: false });
    }
    dispose() {
      cancelAnimationFrame(this.raf); this._ro && this._ro.disconnect();
      this.kit && this.kit.dispose(); this.fig.dispose();
      Object.values(this.MT).forEach(m => m.dispose());
      this.scene.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material && o.material.dispose) o.material.dispose(); });
      this.renderer.dispose(); this.renderer.forceContextLoss && this.renderer.forceContextLoss();
      this.renderer.domElement.remove();
    }
  }

  window.SW3D = { Viewer, TPL, FIG_STYLES, version: 3 };
})();
