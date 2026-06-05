const PRICES_MXN = { PLA: 1.8, PETG: 2.2 };
const DENSITIES = { PLA: 1.24, PETG: 1.27 };
const EXCHANGE_RATES = { MXN: 1, USD: 1 / 17.5, EUR: 1 / 19 };
const CURRENCY_SYMBOLS = { MXN: "$ MXN", USD: "$ USD", EUR: "€ EUR" };
const WHATSAPP_PHONE_NUMBER = "5625236788";
const MIN_MODEL_SIDE_CM = 5;
const MAX_MODEL_SIDE_CM = 40;

const CDN = {
  three: [
    "/vendor/three.min.js",
    "https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.min.js",
    "https://unpkg.com/three@0.128.0/build/three.min.js"
  ],
  orbit: [
    "/vendor/OrbitControls.js",
    "https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js",
    "https://unpkg.com/three@0.128.0/examples/js/controls/OrbitControls.js"
  ],
  transform: [
    "/vendor/TransformControls.js",
    "https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/TransformControls.js",
    "https://unpkg.com/three@0.128.0/examples/js/controls/TransformControls.js"
  ],
  gltf: [
    "/vendor/GLTFLoader.js",
    "https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/GLTFLoader.js",
    "https://unpkg.com/three@0.128.0/examples/js/loaders/GLTFLoader.js"
  ]
};

const state = {
  currency: "MXN",
  catalog: { categories: [], products: [], tumblers: [] },
  selectedCategory: "all",
  selectedProduct: null,
  currentModel: null,
  modelSource: "upload",
  modelFileName: "",
  baseVolumeCm3: 0,
  baseDimsCm: { x: 0, y: 0, z: 0 },
  viewerScale: 1,
  printScale: 1,
  transformMode: "translate",
  selectedTumbler: null,
  tumblerObject: null,
  engravingImages: [],
  activeEngravingIndex: 0,
  draggingEngraving: false,
  dragOffset: { u: 0, v: 0 },
  cart: JSON.parse(localStorage.getItem("customforge_cart") || "[]")
};

const el = {
  categoryFilters: document.getElementById("categoryFilters"),
  productCards: document.getElementById("productCards"),
  modelUpload: document.getElementById("modelUpload"),
  modelStatus: document.getElementById("modelStatus"),
  modelViewer: document.getElementById("modelViewer"),
  modelNote: document.getElementById("modelNote"),
  material: document.getElementById("material"),
  scaleMetric: document.getElementById("scaleMetric"),
  dimsMetric: document.getElementById("dimsMetric"),
  weightMetric: document.getElementById("weightMetric"),
  priceMetric: document.getElementById("priceMetric"),
  printQty: document.getElementById("printQty"),
  addPrintToCart: document.getElementById("addPrintToCart"),
  transformButtons: document.querySelectorAll(".transform-btn"),
  resetModel: document.getElementById("resetModel"),
  tumblerButtons: document.getElementById("tumblerButtons"),
  tumblerViewer: document.getElementById("tumblerViewer"),
  engravingUpload: document.getElementById("engravingUpload"),
  engravingThumbs: document.getElementById("engravingThumbs"),
  tumblerBase: document.getElementById("tumblerBase"),
  engravingCost: document.getElementById("engravingCost"),
  tumblerTotal: document.getElementById("tumblerTotal"),
  engravingCount: document.getElementById("engravingCount"),
  tumblerQty: document.getElementById("tumblerQty"),
  addTumblerToCart: document.getElementById("addTumblerToCart"),
  cartDrawer: document.getElementById("cartDrawer"),
  cartItems: document.getElementById("cartItems"),
  cartCount: document.getElementById("cartCount"),
  cartTotal: document.getElementById("cartTotal"),
  whatsappCheckout: document.getElementById("whatsappCheckout")
};

let modelScene, modelCamera, modelRenderer, modelControls, transformControls;
let tumblerScene, tumblerCamera, tumblerRenderer, tumblerControls, tumblerTexture, tumblerCanvas, tumblerCtx;
let tumblerRaycaster, tumblerPointer;

function money(mxn) {
  const amount = mxn * EXCHANGE_RATES[state.currency];
  return `${CURRENCY_SYMBOLS[state.currency]} ${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function num(value) {
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function loadScript(urls, validator) {
  return urls.reduce((chain, url) => {
    return chain.catch(() => new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = url;
      s.onload = () => validator() ? resolve() : reject(new Error(url));
      s.onerror = () => reject(new Error(url));
      document.head.appendChild(s);
    }));
  }, Promise.reject());
}

async function loadThree() {
  await loadScript(CDN.three, () => Boolean(window.THREE));
  await loadScript(CDN.orbit, () => Boolean(THREE.OrbitControls));
  await loadScript(CDN.transform, () => Boolean(THREE.TransformControls));
  await loadScript(CDN.gltf, () => Boolean(THREE.GLTFLoader));
}

async function loadCatalog() {
  const res = await fetch("/api/catalog");
  state.catalog = await res.json();
  state.selectedTumbler = state.catalog.tumblers[0] || null;
  renderCategories();
  renderProducts();
  renderTumblers();
  updateTumblerQuote();
}

function renderCategories() {
  el.categoryFilters.innerHTML = "";
  const all = button("Todos", "chip active", () => {
    state.selectedCategory = "all";
    renderCategories();
    renderProducts();
  });
  el.categoryFilters.appendChild(all);
  state.catalog.categories.filter(c => c.active).forEach(cat => {
    const b = button(cat.name, `chip ${state.selectedCategory === cat.slug ? "active" : ""}`, () => {
      state.selectedCategory = cat.slug;
      renderCategories();
      renderProducts();
    });
    el.categoryFilters.appendChild(b);
  });
}

function renderProducts() {
  const products = state.catalog.products.filter(p => state.selectedCategory === "all" || p.category_slug === state.selectedCategory);
  el.productCards.innerHTML = products.length ? "" : "<p>No hay productos en esta categoría.</p>";
  products.forEach(product => {
    const card = document.createElement("article");
    card.className = "card";
    card.innerHTML = `
      ${product.thumbnail_url ? `<img src="${product.thumbnail_url}" alt="${escapeHtml(product.name)}">` : ""}
      <h3>${escapeHtml(product.name)}</h3>
      <p>${escapeHtml(product.description || "")}</p>
      <p class="price">${money(product.base_price_mxn || 0)} base</p>
      <button class="btn">Cargar en visualizador</button>
    `;
    card.querySelector("button").addEventListener("click", () => selectCatalogProduct(product));
    el.productCards.appendChild(card);
  });
}

function renderTumblers() {
  el.tumblerButtons.innerHTML = "";
  state.catalog.tumblers.forEach(tumbler => {
    const b = button(tumbler.name, `ghost ${state.selectedTumbler?.id === tumbler.id ? "active" : ""}`, () => {
      state.selectedTumbler = tumbler;
      renderTumblers();
      loadSelectedTumblerModel();
      updateTumblerQuote();
    });
    el.tumblerButtons.appendChild(b);
  });
}

function button(text, cls, onClick) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = cls;
  b.textContent = text;
  b.addEventListener("click", onClick);
  return b;
}

function initModelViewer() {
  modelScene = new THREE.Scene();
  modelCamera = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
  modelCamera.position.set(8, 7, 9);
  modelRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  modelRenderer.setPixelRatio(window.devicePixelRatio);
  modelRenderer.setSize(el.modelViewer.clientWidth, el.modelViewer.clientHeight);
  el.modelViewer.appendChild(modelRenderer.domElement);
  modelControls = new THREE.OrbitControls(modelCamera, modelRenderer.domElement);
  modelControls.enableDamping = true;
  transformControls = new THREE.TransformControls(modelCamera, modelRenderer.domElement);
  transformControls.setMode(state.transformMode);
  transformControls.setSize(0.82);
  transformControls.addEventListener("dragging-changed", e => modelControls.enabled = !e.value);
  transformControls.addEventListener("objectChange", handleModelTransform);
  modelScene.add(transformControls);
  modelScene.add(new THREE.AmbientLight(0xffffff, 0.7));
  const light = new THREE.DirectionalLight(0xfacc15, 0.9);
  light.position.set(8, 12, 10);
  modelScene.add(light);
  const grid = new THREE.GridHelper(18, 18, 0xf97316, 0x343434);
  grid.position.y = -1.6;
  modelScene.add(grid);
}

function initTumblerViewer() {
  tumblerScene = new THREE.Scene();
  tumblerCamera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
  tumblerCamera.position.set(0, 3.2, 8.4);
  tumblerRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  tumblerRenderer.setPixelRatio(window.devicePixelRatio);
  tumblerRenderer.setSize(el.tumblerViewer.clientWidth, el.tumblerViewer.clientHeight);
  el.tumblerViewer.appendChild(tumblerRenderer.domElement);
  tumblerControls = new THREE.OrbitControls(tumblerCamera, tumblerRenderer.domElement);
  tumblerControls.enableDamping = true;
  tumblerScene.add(new THREE.AmbientLight(0xffffff, 0.65));
  [["ffffff", 1.1, [4, 7, 5]], ["e0f2fe", .9, [-5, 5, 6]], ["facc15", .45, [-4, 2, -3]]].forEach(([color, intensity, pos]) => {
    const light = new THREE.DirectionalLight(parseInt(color, 16), intensity);
    light.position.set(...pos);
    tumblerScene.add(light);
  });
  const point = new THREE.PointLight(0xffffff, 0.8, 18);
  point.position.set(0, 1.2, 5.5);
  tumblerScene.add(point);
  tumblerRaycaster = new THREE.Raycaster();
  tumblerPointer = new THREE.Vector2();
  createTumblerTexture();
  loadSelectedTumblerModel();
  bindTumblerDrag();
}

function createTumblerTexture() {
  tumblerCanvas = document.createElement("canvas");
  tumblerCanvas.width = 1536;
  tumblerCanvas.height = 768;
  tumblerCtx = tumblerCanvas.getContext("2d");
  drawTumblerTexture();
  tumblerTexture = new THREE.CanvasTexture(tumblerCanvas);
}

function loadSelectedTumblerModel() {
  if (!tumblerScene || !state.selectedTumbler) return;
  if (state.tumblerObject) {
    tumblerScene.remove(state.tumblerObject);
    state.tumblerObject = null;
  }
  if (state.selectedTumbler.model_url) {
    new THREE.GLTFLoader().load(state.selectedTumbler.model_url, gltf => {
      state.tumblerObject = gltf.scene;
      state.tumblerObject.traverse(child => {
        if (child.isMesh) child.material = new THREE.MeshStandardMaterial({ map: tumblerTexture, color: 0xffffff, metalness: .08, roughness: .72 });
      });
      fitObject(state.tumblerObject, 4.8);
      tumblerScene.add(state.tumblerObject);
    }, undefined, createFallbackTumbler);
  } else {
    createFallbackTumbler();
  }
}

function createFallbackTumbler() {
  if (state.tumblerObject) tumblerScene.remove(state.tumblerObject);
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(1.42, 1.12, 4.9, 128, 1, true),
    new THREE.MeshStandardMaterial({ map: tumblerTexture, color: 0xffffff, metalness: .08, roughness: .72 })
  );
  group.add(body);
  const black = new THREE.MeshStandardMaterial({ color: 0x111111, metalness: .2, roughness: .4 });
  const lid = new THREE.Mesh(new THREE.CylinderGeometry(1.32, 1.42, .26, 128), black);
  lid.position.y = 2.62;
  group.add(lid);
  if (state.selectedTumbler?.has_handle) {
    const handle = new THREE.Mesh(new THREE.TorusGeometry(1.06, .09, 16, 70, Math.PI), black);
    handle.position.set(1.35, .2, 0);
    handle.rotation.z = Math.PI / 2;
    group.add(handle);
  }
  state.tumblerObject = group;
  tumblerScene.add(group);
}

function animate() {
  requestAnimationFrame(animate);
  if (modelControls) {
    modelControls.update();
    modelRenderer.render(modelScene, modelCamera);
  }
  if (tumblerControls) {
    tumblerControls.update();
    tumblerRenderer.render(tumblerScene, tumblerCamera);
  }
}

function resize() {
  resizeOne(el.modelViewer, modelCamera, modelRenderer);
  resizeOne(el.tumblerViewer, tumblerCamera, tumblerRenderer);
}

function resizeOne(container, camera, renderer) {
  if (!camera || !renderer) return;
  camera.aspect = container.clientWidth / container.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(container.clientWidth, container.clientHeight);
}

async function selectCatalogProduct(product) {
  state.selectedProduct = product;
  state.modelSource = "catalog";
  state.modelFileName = product.name;
  el.modelStatus.textContent = `Cargando ${product.name}...`;
  location.hash = "#print";
  if (!product.file_url) {
    el.modelStatus.textContent = "Este producto no tiene modelo cargado en admin.";
    return;
  }
  const res = await fetch(product.file_url);
  const buffer = await res.arrayBuffer();
  await loadModelBuffer(buffer, product.file_type || product.file_url.split(".").pop(), product.name);
}

async function loadModelBuffer(buffer, type, name) {
  clearCurrentModel();
  const lower = type.toLowerCase();
  state.modelFileName = name;
  if (lower === "glb") {
    await loadGlb(buffer);
  } else {
    loadStl(buffer);
  }
  fitLoadedModel();
  transformControls.attach(state.currentModel);
  el.modelNote.style.display = "none";
  updateEstimate();
}

function clearCurrentModel() {
  if (state.currentModel) {
    transformControls.detach();
    modelScene.remove(state.currentModel);
  }
  state.currentModel = null;
  state.baseVolumeCm3 = 0;
  state.baseDimsCm = { x: 0, y: 0, z: 0 };
  state.printScale = 1;
}

function loadStl(buffer) {
  const geometry = parseStl(buffer);
  geometry.computeVertexNormals();
  geometry.center();
  state.baseVolumeCm3 = Math.abs(volumeFromGeometry(geometry)) / 1000;
  const mat = new THREE.MeshStandardMaterial({ color: 0xf97316, metalness: .18, roughness: .42 });
  state.currentModel = new THREE.Mesh(geometry, mat);
  state.currentModel.userData.kind = "stl";
  modelScene.add(state.currentModel);
  el.modelStatus.textContent = `STL cargado: ${state.modelFileName}`;
}

function loadGlb(buffer) {
  return new Promise((resolve, reject) => {
    new THREE.GLTFLoader().parse(buffer, "", gltf => {
      state.currentModel = gltf.scene;
      state.currentModel.userData.kind = "glb";
      state.baseVolumeCm3 = volumeFromObject(gltf.scene) / 1000;
      modelScene.add(state.currentModel);
      el.modelStatus.textContent = `GLB cargado: ${state.modelFileName}`;
      resolve();
    }, reject);
  });
}

function fitLoadedModel() {
  const box = new THREE.Box3().setFromObject(state.currentModel);
  const size = new THREE.Vector3();
  box.getSize(size);
  const center = new THREE.Vector3();
  box.getCenter(center);
  state.currentModel.position.sub(center);
  const maxMm = Math.max(size.x, size.y, size.z) || 1;
  state.viewerScale = 5 / maxMm;
  const maxCm = maxMm / 10;
  state.printScale = clamp(maxCm < MIN_MODEL_SIDE_CM ? MIN_MODEL_SIDE_CM / maxCm : 1, 0.1, 3);
  state.currentModel.scale.setScalar(state.viewerScale * state.printScale);
  state.currentModel.updateMatrixWorld(true);
}

function handleModelTransform() {
  if (!state.currentModel) return;
  if (state.transformMode === "scale") {
    const s = state.currentModel.scale;
    const avg = (Math.abs(s.x) + Math.abs(s.y) + Math.abs(s.z)) / 3;
    state.printScale = clamp(avg / state.viewerScale, 0.1, 20);
    enforceModelLimits();
    state.currentModel.scale.setScalar(state.viewerScale * state.printScale);
  }
  updateEstimate();
}

function enforceModelLimits() {
  const maxBase = Math.max(state.baseDimsCm.x, state.baseDimsCm.y, state.baseDimsCm.z) || 1;
  const maxSide = maxBase * state.printScale;
  if (maxSide < MIN_MODEL_SIDE_CM) state.printScale = MIN_MODEL_SIDE_CM / maxBase;
  if (maxSide > MAX_MODEL_SIDE_CM) state.printScale = MAX_MODEL_SIDE_CM / maxBase;
}

function updateEstimate() {
  if (!state.currentModel) return;
  const dims = getModelDimsCm();
  state.baseDimsCm = state.baseDimsCm.x ? state.baseDimsCm : dims.base;
  const maxBase = Math.max(state.baseDimsCm.x, state.baseDimsCm.y, state.baseDimsCm.z) || 1;
  const maxSide = maxBase * state.printScale;
  if (maxSide < MIN_MODEL_SIDE_CM || maxSide > MAX_MODEL_SIDE_CM) {
    enforceModelLimits();
    state.currentModel.scale.setScalar(state.viewerScale * state.printScale);
  }
  const finalDims = getModelDimsCm().final;
  const volume = state.baseVolumeCm3 * Math.pow(state.printScale, 3);
  const weight = volume * DENSITIES[el.material.value];
  const price = weight * PRICES_MXN[el.material.value] + (state.selectedProduct?.base_price_mxn || 0);
  el.scaleMetric.textContent = `${Math.round(state.printScale * 100)}%`;
  el.dimsMetric.textContent = `${num(finalDims.x)} x ${num(finalDims.y)} x ${num(finalDims.z)} cm`;
  el.weightMetric.textContent = `${num(weight)} g`;
  el.priceMetric.textContent = money(price);
  updateCartUi();
}

function getModelDimsCm() {
  const box = new THREE.Box3().setFromObject(state.currentModel);
  const size = new THREE.Vector3();
  box.getSize(size);
  const final = { x: size.x / state.viewerScale / 10, y: size.y / state.viewerScale / 10, z: size.z / state.viewerScale / 10 };
  const base = { x: final.x / state.printScale, y: final.y / state.printScale, z: final.z / state.printScale };
  return { final, base };
}

function volumeFromObject(object) {
  let total = 0;
  object.updateMatrixWorld(true);
  object.traverse(child => {
    if (!child.isMesh || !child.geometry?.attributes?.position) return;
    const geom = child.geometry.clone();
    geom.applyMatrix4(child.matrixWorld);
    total += Math.abs(volumeFromGeometry(geom));
    geom.dispose();
  });
  return total;
}

function volumeFromGeometry(geometry) {
  const pos = geometry.attributes.position;
  if (!pos) return 0;
  let volume = 0;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    c.fromBufferAttribute(pos, i + 2);
    volume += a.dot(b.cross(c)) / 6;
  }
  return volume;
}

function parseStl(buffer) {
  const view = new DataView(buffer);
  const isBinary = buffer.byteLength >= 84 && 84 + view.getUint32(80, true) * 50 === buffer.byteLength;
  if (isBinary) return parseBinaryStl(buffer);
  const text = new TextDecoder().decode(buffer);
  const matches = [...text.matchAll(/vertex\s+([+-]?\d*\.?\d+(?:e[+-]?\d+)?)\s+([+-]?\d*\.?\d+(?:e[+-]?\d+)?)\s+([+-]?\d*\.?\d+(?:e[+-]?\d+)?)/gi)];
  const positions = new Float32Array(matches.length * 3);
  matches.forEach((m, i) => {
    positions[i * 3] = parseFloat(m[1]);
    positions[i * 3 + 1] = parseFloat(m[2]);
    positions[i * 3 + 2] = parseFloat(m[3]);
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  return geometry;
}

function parseBinaryStl(buffer) {
  const view = new DataView(buffer);
  const faces = view.getUint32(80, true);
  const positions = new Float32Array(faces * 9);
  let offset = 84, pi = 0;
  for (let i = 0; i < faces; i++) {
    offset += 12;
    for (let v = 0; v < 3; v++) {
      positions[pi++] = view.getFloat32(offset, true);
      positions[pi++] = view.getFloat32(offset + 4, true);
      positions[pi++] = view.getFloat32(offset + 8, true);
      offset += 12;
    }
    offset += 2;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  return geometry;
}

function drawTumblerTexture() {
  if (!tumblerCtx) return;
  const w = tumblerCanvas.width, h = tumblerCanvas.height;
  const g = tumblerCtx.createLinearGradient(0, 0, w, 0);
  ["#cfd3d8", "#fbfbf8", "#e3e5e7", "#ffffff", "#d8dce0", "#f5f5f2"].forEach((color, i) => g.addColorStop(i / 5, color));
  tumblerCtx.fillStyle = g;
  tumblerCtx.fillRect(0, 0, w, h);
  state.engravingImages.forEach((item, index) => drawEngraving(item, index));
}

function drawEngraving(item) {
  const image = item.image;
  const w = tumblerCanvas.width, h = tumblerCanvas.height;
  const maxW = 420 * (item.scale || 1), maxH = h * .62 * (item.scale || 1);
  const ratio = Math.min(maxW / image.width, maxH / image.height);
  const dw = image.width * ratio, dh = image.height * ratio;
  const x = (item.u ?? .5) * w - dw / 2;
  const y = (item.v ?? .52) * h - dh / 2;
  item.bounds = { uMin: x / w, uMax: (x + dw) / w, vMin: y / h, vMax: (y + dh) / h };
  const tmp = document.createElement("canvas");
  tmp.width = Math.max(1, Math.round(dw));
  tmp.height = Math.max(1, Math.round(dh));
  const ctx = tmp.getContext("2d");
  ctx.drawImage(image, 0, 0, tmp.width, tmp.height);
  const data = ctx.getImageData(0, 0, tmp.width, tmp.height);
  for (let i = 0; i < data.data.length; i += 4) {
    const gray = data.data[i] * .3 + data.data[i + 1] * .59 + data.data[i + 2] * .11;
    const metal = 112 + gray * .22;
    data.data[i] = Math.max(92, metal);
    data.data[i + 1] = Math.max(100, metal + 10);
    data.data[i + 2] = Math.max(112, metal + 22);
    data.data[i + 3] *= .9;
  }
  ctx.putImageData(data, 0, 0);
  tumblerCtx.save();
  tumblerCtx.globalCompositeOperation = "multiply";
  tumblerCtx.globalAlpha = .72;
  tumblerCtx.drawImage(tmp, x, y, dw, dh);
  tumblerCtx.restore();
}

function bindTumblerDrag() {
  const canvas = tumblerRenderer.domElement;
  canvas.addEventListener("pointerdown", e => {
    const uv = tumblerUv(e);
    if (!uv) return;
    const index = findEngraving(uv);
    if (index < 0) return;
    const item = state.engravingImages[index];
    state.activeEngravingIndex = index;
    state.draggingEngraving = true;
    state.dragOffset = { u: uv.u - item.u, v: uv.v - item.v };
    tumblerControls.enabled = false;
    canvas.setPointerCapture(e.pointerId);
    renderEngravingThumbs();
  });
  canvas.addEventListener("pointermove", e => {
    if (!state.draggingEngraving) return;
    const uv = tumblerUv(e);
    const item = state.engravingImages[state.activeEngravingIndex];
    if (!uv || !item) return;
    item.u = clamp(uv.u - state.dragOffset.u, .06, .94);
    item.v = clamp(uv.v - state.dragOffset.v, .16, .84);
    drawTumblerTexture();
    tumblerTexture.needsUpdate = true;
  });
  window.addEventListener("pointerup", e => {
    state.draggingEngraving = false;
    if (tumblerControls) tumblerControls.enabled = true;
    if (canvas.hasPointerCapture?.(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
  });
}

function tumblerUv(event) {
  const rect = tumblerRenderer.domElement.getBoundingClientRect();
  tumblerPointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  tumblerPointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  tumblerRaycaster.setFromCamera(tumblerPointer, tumblerCamera);
  const mesh = findFirstMesh(state.tumblerObject);
  const hit = mesh ? tumblerRaycaster.intersectObject(mesh, false)[0] : null;
  return hit?.uv ? { u: hit.uv.x, v: 1 - hit.uv.y } : null;
}

function findFirstMesh(object) {
  let mesh = null;
  object?.traverse?.(child => { if (!mesh && child.isMesh) mesh = child; });
  return mesh;
}

function findEngraving(uv) {
  for (let i = state.engravingImages.length - 1; i >= 0; i--) {
    const b = state.engravingImages[i].bounds;
    if (b && uv.u >= b.uMin && uv.u <= b.uMax && uv.v >= b.vMin && uv.v <= b.vMax) return i;
  }
  return -1;
}

function updateTumblerQuote() {
  const base = state.selectedTumbler?.base_price_mxn || 0;
  const engraving = (state.selectedTumbler?.engraving_price_mxn || 0) * state.engravingImages.length;
  el.tumblerBase.textContent = money(base);
  el.engravingCost.textContent = money(engraving);
  el.tumblerTotal.textContent = money(base + engraving);
  el.engravingCount.textContent = String(state.engravingImages.length);
}

function renderEngravingThumbs() {
  if (!state.engravingImages.length) {
    el.engravingThumbs.textContent = "Sin imágenes.";
    return;
  }
  el.engravingThumbs.innerHTML = "";
  state.engravingImages.forEach((item, index) => {
    const card = document.createElement("div");
    card.className = `thumb-card ${index === state.activeEngravingIndex ? "active" : ""}`;
    card.innerHTML = `<img src="${item.url}" alt="${escapeHtml(item.name)}"><small>${escapeHtml(item.name)}</small><button class="danger">Quitar</button>`;
    card.addEventListener("click", () => { state.activeEngravingIndex = index; renderEngravingThumbs(); });
    card.querySelector("button").addEventListener("click", e => {
      e.stopPropagation();
      URL.revokeObjectURL(item.url);
      state.engravingImages.splice(index, 1);
      state.activeEngravingIndex = 0;
      drawTumblerTexture();
      tumblerTexture.needsUpdate = true;
      renderEngravingThumbs();
      updateTumblerQuote();
    });
    el.engravingThumbs.appendChild(card);
  });
}

function addPrintToCart() {
  if (!state.currentModel) return alert("Carga o selecciona un modelo primero.");
  const dims = getModelDimsCm().final;
  const volume = state.baseVolumeCm3 * Math.pow(state.printScale, 3);
  const weight = volume * DENSITIES[el.material.value];
  const price = weight * PRICES_MXN[el.material.value] + (state.selectedProduct?.base_price_mxn || 0);
  state.cart.push({
    id: crypto.randomUUID(),
    type: "Impresión 3D",
    name: state.selectedProduct?.name || state.modelFileName || "Modelo cargado",
    material: el.material.value,
    scale: Math.round(state.printScale * 100),
    dims: `${num(dims.x)} x ${num(dims.y)} x ${num(dims.z)} cm`,
    weight: `${num(weight)} g`,
    unitPriceMxn: price,
    qty: Math.max(1, Number(el.printQty.value) || 1)
  });
  saveCart();
}

function addTumblerToCart() {
  if (!state.selectedTumbler) return;
  const base = state.selectedTumbler.base_price_mxn || 0;
  const engraving = (state.selectedTumbler.engraving_price_mxn || 0) * state.engravingImages.length;
  state.cart.push({
    id: crypto.randomUUID(),
    type: "Termo grabado",
    name: state.selectedTumbler.name,
    designs: state.engravingImages.map(i => i.name).join(", ") || "Sin archivos",
    unitPriceMxn: base + engraving,
    qty: Math.max(1, Number(el.tumblerQty.value) || 1)
  });
  saveCart();
}

function saveCart() {
  localStorage.setItem("customforge_cart", JSON.stringify(state.cart));
  updateCartUi();
  openCart();
}

function updateCartUi() {
  el.cartCount.textContent = state.cart.reduce((sum, i) => sum + i.qty, 0);
  el.cartItems.innerHTML = state.cart.length ? "" : "<p>Tu carrito está vacío.</p>";
  let total = 0;
  state.cart.forEach(item => {
    total += item.unitPriceMxn * item.qty;
    const row = document.createElement("div");
    row.className = "cart-item";
    row.innerHTML = `
      <strong>${escapeHtml(item.name)}</strong>
      <span>${escapeHtml(item.type)}</span>
      <small>${escapeHtml([item.material, item.dims, item.weight, item.designs].filter(Boolean).join(" | "))}</small>
      <span class="price">${money(item.unitPriceMxn)} c/u</span>
      <label>Cantidad <input type="number" min="1" value="${item.qty}"></label>
      <button class="danger">Quitar</button>
    `;
    row.querySelector("input").addEventListener("input", e => {
      item.qty = Math.max(1, Number(e.target.value) || 1);
      saveCartNoOpen();
    });
    row.querySelector("button").addEventListener("click", () => {
      state.cart = state.cart.filter(i => i.id !== item.id);
      saveCartNoOpen();
    });
    el.cartItems.appendChild(row);
  });
  el.cartTotal.textContent = money(total);
  el.whatsappCheckout.href = whatsappUrl(total);
}

function saveCartNoOpen() {
  localStorage.setItem("customforge_cart", JSON.stringify(state.cart));
  updateCartUi();
}

function whatsappUrl(total) {
  const lines = ["Hola, quiero cotizar estos productos:", ""];
  state.cart.forEach((item, index) => {
    lines.push(`${index + 1}. ${item.type} - ${item.name}`);
    lines.push(`Cantidad: ${item.qty}`);
    if (item.material) lines.push(`Material: ${item.material}`);
    if (item.scale) lines.push(`Escala: ${item.scale}%`);
    if (item.dims) lines.push(`Dimensiones: ${item.dims}`);
    if (item.weight) lines.push(`Peso: ${item.weight}`);
    if (item.designs) lines.push(`Diseños: ${item.designs}`);
    lines.push(`Precio unitario: ${money(item.unitPriceMxn)}`);
    lines.push("");
  });
  lines.push(`Total estimado: ${money(total)}`);
  return `https://wa.me/${WHATSAPP_PHONE_NUMBER}?text=${encodeURIComponent(lines.join("\n"))}`;
}

function openCart() {
  el.cartDrawer.classList.add("open");
  el.cartDrawer.setAttribute("aria-hidden", "false");
}

function closeCart() {
  el.cartDrawer.classList.remove("open");
  el.cartDrawer.setAttribute("aria-hidden", "true");
}

function bindEvents() {
  document.querySelectorAll(".currency").forEach(btn => btn.addEventListener("click", () => {
    state.currency = btn.dataset.currency;
    document.querySelectorAll(".currency").forEach(b => b.classList.toggle("active", b === btn));
    renderProducts();
    updateEstimate();
    updateTumblerQuote();
    updateCartUi();
  }));
  el.modelUpload.addEventListener("change", async e => {
    const file = e.target.files[0];
    if (!file) return;
    state.selectedProduct = null;
    const buffer = await file.arrayBuffer();
    await loadModelBuffer(buffer, file.name.split(".").pop(), file.name);
  });
  el.material.addEventListener("change", updateEstimate);
  el.transformButtons.forEach(btn => btn.addEventListener("click", () => {
    state.transformMode = btn.dataset.mode;
    transformControls.setMode(state.transformMode);
    el.transformButtons.forEach(b => b.classList.toggle("active", b === btn));
  }));
  el.resetModel.addEventListener("click", () => {
    if (!state.currentModel) return;
    state.currentModel.position.set(0, 0, 0);
    state.currentModel.rotation.set(0, 0, 0);
    state.printScale = 1;
    state.currentModel.scale.setScalar(state.viewerScale);
    updateEstimate();
  });
  el.engravingUpload.addEventListener("change", async e => {
    const files = [...e.target.files];
    for (const file of files) {
      const image = await imageFromFile(file);
      state.engravingImages.push({ image, name: file.name, url: image.src, u: .5, v: .52, scale: 1 });
    }
    state.activeEngravingIndex = Math.max(0, state.engravingImages.length - files.length);
    drawTumblerTexture();
    tumblerTexture.needsUpdate = true;
    renderEngravingThumbs();
    updateTumblerQuote();
  });
  el.addPrintToCart.addEventListener("click", addPrintToCart);
  el.addTumblerToCart.addEventListener("click", addTumblerToCart);
  document.getElementById("openCart").addEventListener("click", openCart);
  document.getElementById("openCartTop").addEventListener("click", openCart);
  document.getElementById("closeCart").addEventListener("click", closeCart);
  document.getElementById("closeCartBackdrop").addEventListener("click", closeCart);
  window.addEventListener("resize", resize);
}

function imageFromFile(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

function fitObject(object, targetSize) {
  const box = new THREE.Box3().setFromObject(object);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);
  object.position.sub(center);
  object.scale.setScalar(targetSize / (Math.max(size.x, size.y, size.z) || 1));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

async function init() {
  try {
    await loadThree();
    initModelViewer();
    initTumblerViewer();
    animate();
    resize();
  } catch (error) {
    el.modelStatus.textContent = "No se pudo cargar el motor 3D. Revisa la conexión a internet.";
    console.error(error);
  }
  await loadCatalog();
  bindEvents();
  updateCartUi();
}

init();
