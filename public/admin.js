let adminData = { categories: [], products: [], tumblers: [] };

const $ = selector => document.querySelector(selector);
const loginPanel = $("#loginPanel");
const adminPanel = $("#adminPanel");
const statusNode = $("#adminStatus");

async function api(path, options = {}) {
  const res = await fetch(path, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Error de servidor");
  return data;
}

async function checkSession() {
  const session = await api("/api/admin/session");
  if (session.authenticated) showAdmin();
}

function showAdmin() {
  loginPanel.style.display = "none";
  adminPanel.style.display = "block";
  loadAdminData();
}

async function loadAdminData() {
  adminData = await api("/api/admin/data");
  renderCategoryOptions();
  renderLists();
}

function renderCategoryOptions() {
  const select = $("#productCategory");
  select.innerHTML = '<option value="">Sin categoría</option>';
  adminData.categories.forEach(cat => {
    const option = document.createElement("option");
    option.value = cat.id;
    option.textContent = cat.name;
    select.appendChild(option);
  });
}

function renderLists() {
  renderList("#categoryList", adminData.categories, cat => `
    <strong>${escapeHtml(cat.name)}</strong>
    <small>${escapeHtml(cat.slug)} | ${cat.active ? "Activa" : "Inactiva"}</small>
  `, editCategory, id => removeItem("/api/admin/category", id));

  renderList("#productList", adminData.products, product => `
    <strong>${escapeHtml(product.name)}</strong>
    <small>${escapeHtml(product.category_name || "Sin categoría")} | ${escapeHtml(product.file_type || "")} | ${product.active ? "Activo" : "Inactivo"}</small>
    <span class="price">$ MXN ${Number(product.base_price_mxn || 0).toFixed(2)}</span>
  `, editProduct, id => removeItem("/api/admin/product", id));

  renderList("#tumblerList", adminData.tumblers, tumbler => `
    <strong>${escapeHtml(tumbler.name)}</strong>
    <small>${tumbler.ounces} oz ${tumbler.has_handle ? "con asa" : ""} | ${tumbler.active ? "Activo" : "Inactivo"}</small>
    <span class="price">$ MXN ${Number(tumbler.base_price_mxn || 0).toFixed(2)}</span>
  `, editTumbler, id => removeItem("/api/admin/tumbler", id));
}

function renderList(selector, rows, template, onEdit, onRemove) {
  const node = $(selector);
  node.innerHTML = rows.length ? "" : "<p>Sin registros.</p>";
  rows.forEach(row => {
    const item = document.createElement("div");
    item.className = "cart-item";
    item.innerHTML = `${template(row)}<div class="button-row"><button class="ghost" type="button">Editar</button><button class="danger" type="button">Borrar</button></div>`;
    item.querySelector(".ghost").addEventListener("click", () => onEdit(row));
    item.querySelector(".danger").addEventListener("click", () => {
      if (confirm("¿Borrar este registro?")) onRemove(row.id);
    });
    node.appendChild(item);
  });
}

function editCategory(cat) {
  const form = $("#categoryForm");
  form.id.value = cat.id;
  form.name.value = cat.name;
  form.slug.value = cat.slug;
  form.sort_order.value = cat.sort_order || 0;
  form.active.checked = Boolean(cat.active);
  form.scrollIntoView({ behavior: "smooth", block: "center" });
}

function editProduct(product) {
  const form = $("#productForm");
  form.id.value = product.id;
  form.name.value = product.name;
  form.category_id.value = product.category_id || "";
  form.base_price_mxn.value = product.base_price_mxn || 0;
  form.description.value = product.description || "";
  form.active.checked = Boolean(product.active);
  form.scrollIntoView({ behavior: "smooth", block: "center" });
}

function editTumbler(tumbler) {
  const form = $("#tumblerForm");
  form.id.value = tumbler.id;
  form.name.value = tumbler.name;
  form.ounces.value = tumbler.ounces;
  form.base_price_mxn.value = tumbler.base_price_mxn || 0;
  form.engraving_price_mxn.value = tumbler.engraving_price_mxn || 0;
  form.has_handle.checked = Boolean(tumbler.has_handle);
  form.active.checked = Boolean(tumbler.active);
  form.scrollIntoView({ behavior: "smooth", block: "center" });
}

async function removeItem(path, id) {
  await api(`${path}?id=${id}`, { method: "DELETE" });
  setStatus("Registro eliminado.");
  loadAdminData();
}

function bindForms() {
  $("#loginBtn").addEventListener("click", async () => {
    try {
      await api("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: $("#password").value })
      });
      showAdmin();
    } catch (error) {
      $("#loginStatus").textContent = error.message;
    }
  });

  $("#logoutBtn").addEventListener("click", async () => {
    await api("/api/admin/logout", { method: "POST" });
    location.reload();
  });

  $("#categoryForm").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const body = {
      id: form.id.value || null,
      name: form.name.value,
      slug: form.slug.value,
      sort_order: Number(form.sort_order.value || 0),
      active: form.active.checked
    };
    await api("/api/admin/category", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    clearForm(form);
    setStatus("Categoría guardada.");
    loadAdminData();
  });

  $("#productForm").addEventListener("submit", event => submitMultipart(event, "/api/admin/product", "Producto guardado."));
  $("#tumblerForm").addEventListener("submit", event => submitMultipart(event, "/api/admin/tumbler", "Termo guardado."));

  $("#passwordForm").addEventListener("submit", async event => {
    event.preventDefault();
    const password = event.currentTarget.password.value;
    await api("/api/admin/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password })
    });
    event.currentTarget.reset();
    setStatus("Contraseña actualizada.");
  });

  document.querySelectorAll("[data-clear]").forEach(btn => {
    btn.addEventListener("click", () => clearForm(document.getElementById(btn.dataset.clear)));
  });
}

async function submitMultipart(event, path, message) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  data.set("active", form.active.checked ? "1" : "0");
  if (form.has_handle) data.set("has_handle", form.has_handle.checked ? "1" : "0");
  await api(path, { method: "POST", body: data });
  clearForm(form);
  setStatus(message);
  loadAdminData();
}

function clearForm(form) {
  form.reset();
  if (form.id) form.id.value = "";
  form.querySelectorAll("input[type='checkbox'][name='active']").forEach(input => input.checked = true);
}

function setStatus(message) {
  statusNode.textContent = message;
  setTimeout(() => statusNode.textContent = "", 3500);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

bindForms();
checkSession();
