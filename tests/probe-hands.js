// Browser probe: measure the astronaut GLB rest-pose hand axes + live FP body state.
// Run: agent-browser eval "$(bun -e "console.log(require('/home/z/my-project/tests/probe-hands.js').code.replace(/\/\/[^\n]*/g,'').replace(/\n/g,' '))")"
exports.code = `
(() => {
  const A = window.__astro, FB = window.__fpBody;
  if (!A) return 'NO __astro';
  const T = A.THREE;
  const out = { rest: {}, live: null };
  const scene = A.scene;
  scene.updateMatrixWorld(true);
  const byName = {};
  scene.traverse((o) => { if (o.name) byName[o.name] = o; });
  const wp = (n) => byName[n] ? byName[n].getWorldPosition(new T.Vector3()) : null;
  const hip = wp('CC_Base_Hip_02') || new T.Vector3();
  const head = wp('CC_Base_Head_03') || wp('CC_Base_Head');
  out.rest.hip = hip.toArray().map((v) => +v.toFixed(3));
  out.rest.head = head ? head.toArray().map((v) => +v.toFixed(3)) : null;
  for (const side of ['R', 'L']) {
    const upper = wp(side === 'R' ? 'CC_Base_R_Upperarm_074' : 'CC_Base_L_Upperarm_050');
    const fore = wp(side === 'R' ? 'CC_Base_R_Forearm_077' : 'CC_Base_L_Forearm_051');
    const handN = byName[side === 'R' ? 'CC_Base_R_Hand_081' : 'CC_Base_L_Hand_055'];
    if (!upper || !fore || !handN) { out.rest[side] = 'MISSING'; continue; }
    const handP = handN.getWorldPosition(new T.Vector3());
    const handQ = handN.getWorldQuaternion(new T.Quaternion());
    const mid = handN.children.find((c) => /Mid1/.test(c.name));
    const thumb = handN.children.find((c) => /Thumb1/.test(c.name));
    const fW = mid ? mid.getWorldPosition(new T.Vector3()).sub(handP).normalize() : null;
    const tW = thumb ? thumb.getWorldPosition(new T.Vector3()).sub(handP).normalize() : null;
    const n1 = new T.Vector3().crossVectors(fW, tW).normalize();
    const inward = new T.Vector3(-Math.sign(handP.x - hip.x) || 1, 0, 0);
    const invH = handQ.clone().invert();
    const loc = (v) => v.clone().applyQuaternion(invH);
    out.rest[side] = {
      upper: upper.toArray().map((v) => +v.toFixed(3)),
      fore: fore.toArray().map((v) => +v.toFixed(3)),
      hand: handP.toArray().map((v) => +v.toFixed(3)),
      upperDir: fore.clone().sub(upper).normalize().toArray().map((v) => +v.toFixed(3)),
      foreDir: handP.clone().sub(fore).normalize().toArray().map((v) => +v.toFixed(3)),
      fW: fW.toArray().map((v) => +v.toFixed(3)),
      tW: tW.toArray().map((v) => +v.toFixed(3)),
      n1: n1.toArray().map((v) => +v.toFixed(3)),
      n1DotInward: +n1.dot(inward).toFixed(3),
      handQ: handQ.toArray().map((v) => +v.toFixed(3)),
      fLocal: loc(fW).toArray().map((v) => +v.toFixed(3)),
      tLocal: loc(tW).toArray().map((v) => +v.toFixed(3)),
      n1Local: loc(n1).toArray().map((v) => +v.toFixed(3)),
      midChildren: handN.children.map((c) => c.name),
    };
  }
  if (FB && FB.chains) {
    out.live = {};
    for (const side of ['r', 'l']) {
      const c = FB.chains[side];
      if (!c) continue;
      c.hand.updateWorldMatrix(true, false);
      const hp = c.hand.getWorldPosition(new T.Vector3());
      const hq = c.hand.getWorldQuaternion(new T.Quaternion());
      const palmW = c.pLocal.clone().applyQuaternion(hq);
      const fW = c.fLocal.clone().applyQuaternion(hq);
      out.live[side] = {
        fLocal: c.fLocal.toArray().map((v) => +v.toFixed(3)),
        pLocal: c.pLocal.toArray().map((v) => +v.toFixed(3)),
        sLocal: c.sLocal.toArray().map((v) => +v.toFixed(3)),
        tLocal: c.tLocal.toArray().map((v) => +v.toFixed(3)),
        handP: hp.toArray().map((v) => +v.toFixed(2)),
        palmNowWorld: palmW.toArray().map((v) => +v.toFixed(3)),
        fingersNowWorld: fW.toArray().map((v) => +v.toFixed(3)),
        handParent: c.hand.parent ? c.hand.parent.name : null,
      };
    }
  }
  return JSON.stringify(out);
})()
`
