"""v2 采集 / 审计探针注入页面的 JS。

约束：只依赖 three.js 对象的公开字段（traverse / isMesh / geometry / matrixWorld.elements / instanceMatrix …），
不 import three，因此对任何打包方式（ESM、CDN、单文件构建）都有效，并且可以用“鸭子类型”的假场景做单元测试。
"""

# ---------------------------------------------------------------------------
# 部件树 + 场景节点名：用于 expected_parts（只检查“找得到名字”，不数个数）
# ---------------------------------------------------------------------------
NAMES_JS = r"""
async (args) => {
  const get = (path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), window);
  const out = {tree: [], nodes: [], tree_error: null};
  try {
    const f = get('__bench.listParts');
    if (typeof f === 'function') {
      const t = await f.call(get('__bench'));
      if (Array.isArray(t)) out.tree = t.slice(0, 5000).map(p => ({id: String(p.id ?? ''), name: String(p.name ?? p.id ?? ''), parent: p.parent == null ? null : String(p.parent)}));
    }
  } catch (e) { out.tree_error = String(e).slice(0, 200); }
  const sc = get(args.scene || '__scene');
  if (sc && typeof sc.traverse === 'function') {
    const seen = new Set();
    sc.traverse(o => { if (o.name && !seen.has(o.name) && seen.size < 20000) { seen.add(o.name); out.nodes.push(o.name); } });
  }
  return out;
}
"""

# ---------------------------------------------------------------------------
# rig 完整性：以网格的世界包围盒（AABB）为“部件”，检查分离 / 穿插 / 接触
#   这是一个粗筛：AABB 连通 ≠ 真的接触，AABB 重叠 ≠ 真的穿模；
#   所以只用来抓“上半身和下半身分家”“整个零件嵌进另一个零件”这类严重问题，细节交给人工项。
# ---------------------------------------------------------------------------
RIG_JS = r"""
(args) => {
  const get = (path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), window);
  const sc = get(args.scene || '__scene');
  if (!sc || typeof sc.traverse !== 'function') return null;
  if (sc.updateMatrixWorld) sc.updateMatrixWorld(true);
  const envRe = new RegExp(args.exclude || 'ground|floor|terrain|sky|dome|background|backdrop|cloud|grass|water|ocean|road|street|pavement|sidewalk|shadow|helper|地面|天空|背景|地板|水面|路面', 'i');
  const overlayRe = new RegExp(args.overlay || 'hat|overlay|layer|outline|shell|glow|halo|aura|skin|cover|wrap|cloak|armor|armour|decal|trim|帽|外层|描边|光晕', 'i');
  const INF = Infinity;
  const all = [];
  const pathOf = (o) => { const a = []; for (let p = o; p; p = p.parent) if (p.name) a.push(p.name); return a.reverse().join('/'); };
  const hasAncestor = (a, b) => { for (let p = a.parent; p; p = p.parent) if (p === b) return true; return false; };
  const addBox = (o, mn, mx) => {
    if (!isFinite(mn[0] + mn[1] + mn[2] + mx[0] + mx[1] + mx[2])) return;
    all.push({o, path: pathOf(o), name: o.name || '', mn, mx});
  };
  const visibleChain = (o) => { for (let p = o; p; p = p.parent) if (p.visible === false) return false; return true; };
  sc.traverse(o => {
    if (!(o.isMesh || o.isSkinnedMesh || o.isInstancedMesh)) return;
    if (!visibleChain(o)) return;
    const g = o.geometry;
    if (!g || !g.attributes || !g.attributes.position) return;
    let bb = null;
    if (o.isSkinnedMesh && typeof o.computeBoundingBox === 'function') { try { o.computeBoundingBox(); bb = o.boundingBox; } catch (e) {} }
    if (!bb) { if (!g.boundingBox && g.computeBoundingBox) g.computeBoundingBox(); bb = g.boundingBox; }
    if (!bb) return;
    const e = o.matrixWorld.elements;
    const mn = [INF, INF, INF], mx = [-INF, -INF, -INF];
    const feed = (m) => {
      for (const cx of [bb.min.x, bb.max.x]) for (const cy of [bb.min.y, bb.max.y]) for (const cz of [bb.min.z, bb.max.z]) {
        const x = m[0] * cx + m[4] * cy + m[8] * cz + m[12], y = m[1] * cx + m[5] * cy + m[9] * cz + m[13], z = m[2] * cx + m[6] * cy + m[10] * cz + m[14];
        if (x < mn[0]) mn[0] = x; if (y < mn[1]) mn[1] = y; if (z < mn[2]) mn[2] = z;
        if (x > mx[0]) mx[0] = x; if (y > mx[1]) mx[1] = y; if (z > mx[2]) mx[2] = z;
      }
    };
    if (o.isInstancedMesh && o.instanceMatrix && o.instanceMatrix.array) {
      const n = Math.min(o.count || 0, 20000), ia = o.instanceMatrix.array, m = new Array(16);
      for (let i = 0; i < n; i++) {
        const b = i * 16;
        for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
          let s = 0; for (let k = 0; k < 4; k++) s += e[k * 4 + r] * ia[b + c * 4 + k];
          m[c * 4 + r] = s;
        }
        feed(m);
      }
    } else feed(e);
    addBox(o, mn, mx);
  });
  if (!all.length) return {parts: 0, subject: 0, diag: 0, floating: 0, clipped: 0, contacts: []};
  const ext = (b) => [b.mx[0] - b.mn[0], b.mx[1] - b.mn[1], b.mx[2] - b.mn[2]];
  const diagOf = (b) => { const d = ext(b); return Math.hypot(d[0], d[1], d[2]); };
  const union = (list) => { const mn = [INF, INF, INF], mx = [-INF, -INF, -INF]; for (const b of list) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], b.mn[k]); mx[k] = Math.max(mx[k], b.mx[k]); } return {mn, mx}; };
  const G = diagOf(union(all));
  for (const b of all) {
    const d = ext(b), big = Math.hypot(d[0], d[1], d[2]), thin = Math.min(d[0], d[1], d[2]);
    b.env = envRe.test(b.path) || big > 0.8 * G || (big > 0.5 * G && thin < 0.1 * big);
  }
  let subj = all.filter(b => !b.env);
  if (args.include) { const re = new RegExp(args.include, 'i'); subj = all.filter(b => re.test(b.path)); }
  if (!subj.length) return {parts: all.length, subject: 0, diag: G, floating: 0, clipped: 0, contacts: []};
  const D = diagOf(union(subj));
  subj = subj.filter(b => diagOf(b) >= 0.004 * D);
  if (subj.length > 4000) subj = subj.sort((a, b) => diagOf(b) - diagOf(a)).slice(0, 4000);
  const n = subj.length;
  const gap = (a, b) => { let s = 0; for (let k = 0; k < 3; k++) { const d = Math.max(0, a.mn[k] - b.mx[k], b.mn[k] - a.mx[k]); s += d * d; } return Math.sqrt(s); };
  const tol = (args.tol == null ? 0.01 : args.tol) * D;
  const par = subj.map((_, i) => i);
  const find = (i) => { while (par[i] !== i) { par[i] = par[par[i]]; i = par[i]; } return i; };
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (gap(subj[i], subj[j]) <= tol) { const a = find(i), b = find(j); if (a !== b) par[a] = b; }
  const weight = new Map();
  for (let i = 0; i < n; i++) { const r = find(i), d = diagOf(subj[i]); weight.set(r, (weight.get(r) || 0) + d * d); }
  let main = -1, best = -1; for (const [r, w] of weight) if (w > best) { best = w; main = r; }
  let loose = 0; for (let i = 0; i < n; i++) if (find(i) !== main) loose++;
  // 穿插：两个体量相当、互不为祖先的部件，较小者的包围盒有 ≥ 70% 落在另一个里面
  const big = subj.filter(b => diagOf(b) >= 0.03 * D).slice(0, 1500);
  const vol = (b) => { const d = ext(b), m = 1e-4 * D; return Math.max(d[0], m) * Math.max(d[1], m) * Math.max(d[2], m); };
  const bad = new Set();
  for (let i = 0; i < big.length; i++) for (let j = i + 1; j < big.length; j++) {
    const a = big[i], b = big[j];
    if (hasAncestor(a.o, b.o) || hasAncestor(b.o, a.o) || overlayRe.test(a.path) || overlayRe.test(b.path)) continue;
    let iv = 1; for (let k = 0; k < 3; k++) { const w = Math.min(a.mx[k], b.mx[k]) - Math.max(a.mn[k], b.mn[k]); if (w <= 0) { iv = 0; break; } iv *= w; }
    if (!iv) continue;
    const va = vol(a), vb = vol(b), lo = Math.min(va, vb), hi = Math.max(va, vb);
    if (hi / lo <= 6 && iv / lo >= 0.7) { bad.add(i); bad.add(j); }
  }
  const contacts = [];
  for (const c of (args.contacts || [])) {
    const ra = new RegExp(c.a, 'i'), rb = new RegExp(c.b, 'i');
    const A = all.filter(b => ra.test(b.path)), B = all.filter(b => rb.test(b.path));
    let g = null; if (A.length && B.length) { g = INF; for (const a of A) for (const b of B) { if (a === b) continue; const d = gap(a, b); if (d < g) g = d; } }
    const t = (c.tol == null ? 0.02 : c.tol) * D;
    contacts.push({label: c.label || (c.a + '~' + c.b), found: g !== null && isFinite(g), ok: g !== null && g <= t, gap_frac: g === null || !isFinite(g) ? null : g / D});
  }
  return {parts: all.length, subject: n, diag: D, floating: loose / n, clipped: big.length ? bad.size / big.length : 0, contacts};
}
"""

# ---------------------------------------------------------------------------
# 体素审计：从 __scene 里读出方块（InstancedMesh 的实例 / 普通网格的外露面），核对网格对齐、等大、尺度、层次、内部空腔
# ---------------------------------------------------------------------------
VOXEL_JS = r"""
async (args) => {
  const get = (path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), window);
  const sc = get(args.scene || '__scene');
  if (!sc || typeof sc.traverse !== 'function') return null;
  if (sc.updateMatrixWorld) sc.updateMatrixWorld(true);
  const hook = Number(args.block_size_from ? get(args.block_size_from) : NaN);
  const corners = [];      // 采样的角点（世界坐标），用于对齐检测
  const instCenters = [];  // 实例中心
  const faces = [];        // 普通网格的轴对齐面： [cx, cy, cz, axis, sign]
  let instDims = [], edgeOk = 0, edgeTot = 0, nonAxisFaces = 0, axisFaces = 0;
  const colors = new Set(), mats = new Set();
  const CAP_TRI = 1200000, CAP_INST = 400000;
  const visible = (o) => { for (let p = o; p; p = p.parent) if (p.visible === false) return false; return true; };
  const meshes = [];
  sc.traverse(o => { if ((o.isMesh || o.isInstancedMesh) && o.geometry && o.geometry.attributes && o.geometry.attributes.position && visible(o)) meshes.push(o); });
  // 先确定方块尺寸 bs
  let bs = hook > 0 ? hook : 0;
  const inferSizes = [];
  for (const o of meshes) {
    if (!o.isInstancedMesh) continue;
    const g = o.geometry; if (!g.boundingBox && g.computeBoundingBox) g.computeBoundingBox();
    const bb = g.boundingBox; if (!bb) continue;
    const e = o.matrixWorld.elements, ia = o.instanceMatrix.array, n = Math.min(o.count, 50);
    for (let i = 0; i < n; i++) {
      const b = i * 16;
      const sx = Math.hypot(ia[b], ia[b + 1], ia[b + 2]) * Math.hypot(e[0], e[1], e[2]);
      inferSizes.push(Math.round((bb.max.x - bb.min.x) * sx * 1000) / 1000);
    }
  }
  if (!bs) {
    if (inferSizes.length) { const cnt = {}; for (const s of inferSizes) cnt[s] = (cnt[s] || 0) + 1; bs = Number(Object.entries(cnt).sort((a, b) => b[1] - a[1])[0][0]); }
  }
  const tmp = [0, 0, 0];
  const w = (e, x, y, z, out) => { out[0] = e[0] * x + e[4] * y + e[8] * z + e[12]; out[1] = e[1] * x + e[5] * y + e[9] * z + e[13]; out[2] = e[2] * x + e[6] * y + e[10] * z + e[14]; };
  let triBudget = CAP_TRI, instBudget = CAP_INST;
  const faceAreas = [];
  for (const o of meshes) {
    const g = o.geometry, e = o.matrixWorld.elements;
    for (const m of (Array.isArray(o.material) ? o.material : [o.material])) if (m) { mats.add(m.uuid); if (m.color && m.color.getHexString) colors.add(m.color.getHexString()); }
    if (o.isInstancedMesh) {
      if (!g.boundingBox && g.computeBoundingBox) g.computeBoundingBox();
      const bb = g.boundingBox, ia = o.instanceMatrix.array, n = Math.min(o.count, instBudget);
      instBudget -= n;
      const cx = (bb.min.x + bb.max.x) / 2, cy = (bb.min.y + bb.max.y) / 2, cz = (bb.min.z + bb.max.z) / 2;
      const mm = new Array(16);
      const col = o.instanceColor && o.instanceColor.array;
      for (let i = 0; i < n; i++) {
        const b = i * 16;
        for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += e[k * 4 + r] * ia[b + c * 4 + k]; mm[c * 4 + r] = s; }
        w(mm, cx, cy, cz, tmp); instCenters.push([tmp[0], tmp[1], tmp[2]]);
        const sx = Math.hypot(mm[0], mm[1], mm[2]) * (bb.max.x - bb.min.x), sy = Math.hypot(mm[4], mm[5], mm[6]) * (bb.max.y - bb.min.y), sz = Math.hypot(mm[8], mm[9], mm[10]) * (bb.max.z - bb.min.z);
        instDims.push([sx, sy, sz]);
        if (i % 8 === 0) for (const qx of [bb.min.x, bb.max.x]) for (const qy of [bb.min.y, bb.max.y]) for (const qz of [bb.min.z, bb.max.z]) { w(mm, qx, qy, qz, tmp); corners.push([tmp[0], tmp[1], tmp[2]]); }
        if (col && i % 16 === 0) colors.add([col[i * 3], col[i * 3 + 1], col[i * 3 + 2]].map(v => Math.round(v * 15)).join(','));
      }
      continue;
    }
    const pos = g.attributes.position, idx = g.index;
    const triCount = idx ? idx.count / 3 : pos.count / 3;
    const step = triCount > triBudget ? Math.ceil(triCount / Math.max(triBudget, 1)) : 1;
    const A = [0, 0, 0], B = [0, 0, 0], C = [0, 0, 0];
    const vi = (t, k) => (idx ? idx.getX(t * 3 + k) : t * 3 + k);
    for (let t = 0; t < triCount; t += step) {
      const a = vi(t, 0), b = vi(t, 1), c = vi(t, 2);
      w(e, pos.getX(a), pos.getY(a), pos.getZ(a), A); w(e, pos.getX(b), pos.getY(b), pos.getZ(b), B); w(e, pos.getX(c), pos.getY(c), pos.getZ(c), C);
      if (t % 4 === 0) { corners.push(A.slice(), B.slice(), C.slice()); }
      const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2], vx = C[0] - A[0], vy = C[1] - A[1], vz = C[2] - A[2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, nl = Math.hypot(nx, ny, nz);
      if (nl < 1e-12) continue;
      const ax = Math.abs(nx) / nl, ay = Math.abs(ny) / nl, az = Math.abs(nz) / nl;
      const axis = ax > 0.98 ? 0 : ay > 0.98 ? 1 : az > 0.98 ? 2 : -1;
      if (axis < 0) { nonAxisFaces++; continue; }
      axisFaces++;
      const sign = [nx, ny, nz][axis] > 0 ? 1 : -1;
      faces.push([(A[0] + B[0] + C[0]) / 3, (A[1] + B[1] + C[1]) / 3, (A[2] + B[2] + C[2]) / 3, axis, sign]);
      faceAreas.push(nl / 2);
      // 轴对齐边长：与 bs 的整数倍关系（统一在 bs 确定之后再统计，这里先存边）
      for (const [P, Q] of [[A, B], [B, C], [C, A]]) {
        const dx = Math.abs(P[0] - Q[0]), dy = Math.abs(P[1] - Q[1]), dz = Math.abs(P[2] - Q[2]), m = Math.max(dx, dy, dz);
        if (m > 1e-6 && (dx > 0.999 * m ? 1 : 0) + (dy > 0.999 * m ? 1 : 0) + (dz > 0.999 * m ? 1 : 0) === 1 && Math.min(dx, dy, dz) < 1e-4 * m) { faces.edges = faces.edges || []; if (faces.edges.length < 600000) faces.edges.push(m); }
      }
    }
    triBudget -= Math.floor(triCount / step);
  }
  if (!bs && faceAreas.length) {
    faceAreas.sort((a, b) => a - b);
    bs = Math.sqrt(2 * faceAreas[Math.floor(faceAreas.length / 2)]);
  }
  if (!(bs > 0)) return {available: false, blocks: 0};
  // 格点偏移：各轴取小数部分的众数
  const fracMode = (vals) => { const h = new Map(); for (const v of vals) { const f = Math.round((((v / bs) % 1) + 1) % 1 * 20) % 20; h.set(f, (h.get(f) || 0) + 1); } let bf = 0, bc = -1; for (const [f, c] of h) if (c > bc) { bc = c; bf = f; } return bf / 20; };
  const off = [0, 1, 2].map(k => fracMode(corners.map(c => c[k])));
  let alignedPts = 0;
  for (const c of corners) { let ok = true; for (let k = 0; k < 3; k++) { let f = ((c[k] / bs - off[k]) % 1 + 1) % 1; f = Math.min(f, 1 - f); if (f > 0.03) { ok = false; break; } } if (ok) alignedPts++; }
  const aligned = corners.length ? alignedPts / corners.length : 0;
  // 等大
  let uniformOk = 0, uniformTot = 0;
  for (const d of instDims) { uniformTot++; if (d.every(v => Math.abs(v / bs - 1) < 0.03)) uniformOk++; }
  const ed = faces.edges || [];
  for (const m of ed) { uniformTot++; const r = m / bs; if (Math.abs(r - Math.round(r)) < 0.03 && Math.round(r) >= 1) uniformOk++; }
  // 方块格子：instance 中心 + 外露面背后的格子；air 格子：外露面前方的格子
  const key = (x, y, z) => x + ',' + y + ',' + z;
  const solid = new Set(), airFace = new Set();
  const cell = (v, k) => Math.floor(v / bs - off[k] + 1e-6);
  for (const c of instCenters) solid.add(key(cell(c[0], 0), cell(c[1], 1), cell(c[2], 2)));
  for (const f of faces) {
    const ax = f[3], sg = f[4], p = [f[0], f[1], f[2]];
    const back = p.slice(), front = p.slice();
    back[ax] -= sg * bs / 2; front[ax] += sg * bs / 2;
    solid.add(key(cell(back[0], 0), cell(back[1], 1), cell(back[2], 2)));
    airFace.add(key(cell(front[0], 0), cell(front[1], 1), cell(front[2], 2)));
  }
  // 实例化方块没有“面”，外露空气 = 实例格子的 6 邻接空格
  const N6 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  for (const c of instCenters) {
    const x = cell(c[0], 0), y = cell(c[1], 1), z = cell(c[2], 2);
    for (const d of N6) { const kk = key(x + d[0], y + d[1], z + d[2]); if (!solid.has(kk)) airFace.add(kk); }
  }
  const parse = (s) => s.split(',').map(Number);
  const cells = [...solid].map(parse);
  if (cells.length < (args.min_blocks || 50)) return {available: false, blocks: cells.length, block_size: bs};
  // 地面层：数量最多的 y 层；结构 = 高于地面层的格子
  const yc = new Map(); for (const c of cells) yc.set(c[1], (yc.get(c[1]) || 0) + 1);
  let gy = 0, gc = -1; for (const [y, c] of yc) if (c > gc) { gc = c; gy = y; }
  const above = cells.filter(c => c[1] > gy);
  const aboveSet = new Set(above.map(c => key(c[0], c[1], c[2])));
  // 最大连通结构（6 邻接）
  const seen = new Set(); let best = [];
  const D6 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  for (const c of above) {
    const k0 = key(c[0], c[1], c[2]); if (seen.has(k0)) continue;
    const comp = [c]; seen.add(k0);
    for (let h = 0; h < comp.length; h++) { const q = comp[h]; for (const d of D6) { const nb = [q[0] + d[0], q[1] + d[1], q[2] + d[2]], kk = key(nb[0], nb[1], nb[2]); if (aboveSet.has(kk) && !seen.has(kk)) { seen.add(kk); comp.push(nb); } } }
    if (comp.length > best.length) best = comp;
  }
  const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9]; const ys = new Set();
  for (const c of best) { for (let k = 0; k < 3; k++) { if (c[k] < mn[k]) mn[k] = c[k]; if (c[k] > mx[k]) mx[k] = c[k]; } ys.add(c[1]); }
  const ex = best.length ? [mx[0] - mn[0] + 1, mx[1] - mn[1] + 1, mx[2] - mn[2] + 1] : [0, 0, 0];
  // 内部空腔：在最大结构的包围盒内，从外部洪水填充空气；外露面前方、却到不了外部的格子 = 房间
  let voidRatio = null;
  const vol = (ex[0] + 2) * (ex[1] + 2) * (ex[2] + 2);
  if (best.length && vol <= 8000000) {
    const nx = ex[0] + 2, ny = ex[1] + 2, nz = ex[2] + 2, ox = mn[0] - 1, oy = mn[1] - 1, oz = mn[2] - 1;
    const id = (x, y, z) => ((x - ox) * ny + (y - oy)) * nz + (z - oz);
    const st = new Uint8Array(vol); // 0 空 1 实心 2 外部空气 3 房间空气
    const inb = (x, y, z) => x >= ox && x < ox + nx && y >= oy && y < oy + ny && z >= oz && z < oz + nz;
    // 包围盒内所有已知方块（含地面层）都算实心，否则地面会被当成“空气”，让房间从底部漏出去
    for (const c of cells) if (inb(c[0], c[1], c[2])) st[id(c[0], c[1], c[2])] = 1;
    const fill = (sx, sy, sz, mark, only) => {
      const q = [sx, sy, sz]; st[id(sx, sy, sz)] = mark; let cnt = 1;
      for (let h = 0; h < q.length; h += 3) { const x = q[h], y = q[h + 1], z = q[h + 2]; for (const d of D6) { const X = x + d[0], Y = y + d[1], Z = z + d[2]; if (!inb(X, Y, Z)) continue; const i = id(X, Y, Z); if (st[i] === 0) { st[i] = mark; q.push(X, Y, Z); cnt++; } } }
      return cnt;
    };
    fill(ox, oy, oz, 2);
    let room = 0;
    for (const s of airFace) { const [x, y, z] = parse(s); if (inb(x, y, z) && st[id(x, y, z)] === 0) room += fill(x, y, z, 3); }
    voidRatio = room / (ex[0] * ex[1] * ex[2]);
  }
  return {available: true, blocks: cells.length, block_size: bs, aligned_ratio: aligned, uniform_ratio: uniformTot ? uniformOk / uniformTot : 0,
    structure_blocks: best.length, extent: ex, extent_max: Math.max(...ex), height_levels: ys.size, interior_void_ratio: voidRatio,
    palette_size: Math.max(mats.size, colors.size), non_axis_faces: nonAxisFaces, axis_faces: axisFaces, ground_y: gy};
}
"""
