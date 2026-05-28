// ─── Config ─────────────────────────────────────────────────
const API_BASE = '/api';

// ─── State ──────────────────────────────────────────────────
const state = {
  session: null,
  items: [],
  batches: [],
  movements: [],
  needAlerts: [],
  users: [],
  scanActive: false,
  scanStream: null,
  scanAnimFrame: null,
};

// ─── HTTP Client ─────────────────────────────────────────────
async function apiFetch(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (state.session?.access_token) {
    headers['Authorization'] = `Bearer ${state.session.access_token}`;
  }
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || `Erro ${res.status}`);
  }
  return res.json();
}

// ─── Auth ────────────────────────────────────────────────────
async function login(email, password) {
  const data = await apiFetch('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  state.session = data;
  persistSession(data);
  return data;
}

function persistSession(session) {
  try { localStorage.setItem('doastock_session', JSON.stringify(session)); } catch { }
}

function loadPersistedSession() {
  try {
    const raw = localStorage.getItem('doastock_session');
    if (raw) state.session = JSON.parse(raw);
  } catch { }
}

function logout() {
  state.session = null;
  try { localStorage.removeItem('doastock_session'); } catch { }
  showLoginScreen();
}

// ─── Router / Views ──────────────────────────────────────────
function showLoginScreen() {
  document.getElementById('login-screen').classList.remove('hidden');
  document.getElementById('app-shell').classList.add('hidden');
  document.getElementById('public-view').classList.add('hidden');
}

function showPublicView() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app-shell').classList.add('hidden');
  document.getElementById('public-view').classList.remove('hidden');
  loadPublicNeeds();
}

function showAppShell() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app-shell').classList.remove('hidden');
  document.getElementById('public-view').classList.add('hidden');
  applyRoleRestrictions();
  updateSidebarUser();
  navigateTo('dashboard');
}

function navigateTo(viewName) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  const view = document.getElementById(`view-${viewName}`);
  if (view) view.classList.add('active');

  const navItem = document.querySelector(`.nav-item[data-view="${viewName}"]`);
  if (navItem) navItem.classList.add('active');

  const loaders = {
    dashboard: loadDashboard,
    inventory: loadInventory,
    alerts: loadAlerts,
    movements: loadMovements,
    reports: initReportDates,
    needs: loadNeedsAdmin,
    users: loadUsers,
  };
  loaders[viewName]?.();
}

function applyRoleRestrictions() {
  const role = state.session?.user?.role;
  const isCoordinator = role === 'coordinator';
  const adminSection = document.getElementById('admin-section');
  const navUsers = document.getElementById('nav-users');
  if (adminSection) adminSection.style.display = isCoordinator ? '' : 'none';
  if (navUsers) navUsers.style.display = isCoordinator ? '' : 'none';
}

function updateSidebarUser() {
  const user = state.session?.user;
  if (!user) return;
  const initials = user.nome?.split(' ').slice(0, 2).map(n => n[0]).join('').toUpperCase() || '??';
  document.getElementById('sidebar-avatar').textContent = initials;
  document.getElementById('sidebar-user-name').textContent = user.nome || user.email;
  document.getElementById('sidebar-user-role').textContent = roleLabel(user.role);
  document.getElementById('dash-org-subtitle').textContent = user.org_name || 'Visão consolidada do estoque';
}

function roleLabel(role) {
  return { coordinator: 'Coordenador', volunteer: 'Voluntário', donor: 'Doador' }[role] || role;
}

// ─── Toast ───────────────────────────────────────────────────
function showToast(message, type = 'default', duration = 3500) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

  const iconMap = {
    success: '✓',
    error: '✕',
    warning: '⚠',
    default: 'ℹ',
  };

  toast.innerHTML = `<span style="font-size:16px">${iconMap[type] || 'ℹ'}</span> ${message}`;
  container.appendChild(toast);

  // 1. Inicia a saída um pouco antes do tempo total (para a animação de fade-out)
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(20px)';
    toast.style.transition = 'all 0.3s ease';

    // 2. Remove o elemento do HTML definitivamente após a transição
    setTimeout(() => {
      toast.remove();
    }, 300);
  }, duration);
}

// ─── Dashboard ───────────────────────────────────────────────
async function loadDashboard() {
  try {
    const [summary, alertsSummary] = await Promise.all([
      apiFetch('/dashboard/summary'),
      apiFetch('/batches/expiring?days=7'),
    ]);
    document.getElementById('stat-total').textContent = summary.total_batches ?? '—';
    document.getElementById('stat-expiring').textContent = alertsSummary.length ?? '—';
    document.getElementById('stat-critical').textContent = summary.critical_items ?? '—';
    document.getElementById('stat-movements').textContent = summary.movements_today ?? '—';

    renderCategoryList(summary.by_category ?? []);
    renderDashAlerts(alertsSummary.slice(0, 6));

    const badge = document.getElementById('alerts-badge');
    if (alertsSummary.length > 0) {
      badge.textContent = alertsSummary.length;
      badge.style.display = '';
    } else {
      badge.style.display = 'none';
    }
  } catch (err) {
    showToast(`Erro ao carregar dashboard: ${err.message}`, 'error');
  }
}

function renderCategoryList(categories) {
  const container = document.getElementById('dash-category-list');
  if (!categories.length) {
    container.innerHTML = '<div class="empty-state" style="padding:32px"><p>Nenhuma categoria com dados</p></div>';
    return;
  }
  const maxQty = Math.max(...categories.map(c => c.total_quantity));
  container.innerHTML = categories.map(cat => {
    const pct = maxQty ? Math.round((cat.total_quantity / maxQty) * 100) : 0;
    const statusClass = pct < 20 ? 'critical' : pct < 50 ? 'warning' : 'ok';
    return `
      <div style="margin-bottom:14px">
        <div class="flex justify-between mb-4" style="margin-bottom:6px">
          <span style="font-size:13px;font-weight:500">${cat.category}</span>
          <span class="font-mono text-sm text-muted">${cat.total_quantity} ${cat.unit || 'un'}</span>
        </div>
        <div class="stock-meter"><div class="stock-meter-fill ${statusClass}" style="width:${pct}%"></div></div>
      </div>`;
  }).join('');
}

function renderDashAlerts(alerts) {
  const container = document.getElementById('dash-alerts-list');
  if (!alerts.length) {
    container.innerHTML = '<div class="empty-state" style="padding:32px"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg><p>Nenhum alerta crítico</p></div>';
    return;
  }
  container.innerHTML = alerts.map(a => {
    const days = calculateDaysUntilExpiry(a.data_validade);
    const badgeClass = days <= 3 ? 'badge-red' : days <= 7 ? 'badge-yellow' : 'badge-blue';
    return `
      <div class="flex justify-between items-center" style="padding:10px 0;border-bottom:1px solid var(--border)">
        <div>
          <div style="font-size:13px;font-weight:500">${a.item_nome}</div>
          <div class="text-sm text-muted">${a.quantidade} un · vence ${formatDate(a.data_validade)}</div>
        </div>
        <span class="badge ${badgeClass}">${days}d</span>
      </div>`;
  }).join('');
}

// ─── Inventory ───────────────────────────────────────────────
async function loadInventory() {
  try {
    const data = await apiFetch('/inventory');
    state.items = data;
    renderInventoryTable(data);
  } catch (err) {
    showToast(`Erro ao carregar estoque: ${err.message}`, 'error');
  }
}

function renderInventoryTable(items) {
  const tbody = document.getElementById('inventory-table-body');
  if (!items.length) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state" style="padding:40px"><p>Nenhum item no estoque</p></div></td></tr>`;
    return;
  }
  tbody.innerHTML = items.map(item => {
    const days = item.nearest_expiry ? calculateDaysUntilExpiry(item.nearest_expiry) : null;
    const statusBadge = buildStatusBadge(item.quantity, item.min_quantity, days);
    return `
      <tr>
        <td>
          <div style="font-weight:500">${item.nome}</div>
          <div class="col-mono text-sm text-muted">${item.codigo_barras || '—'}</div>
        </td>
        <td><span class="badge badge-gray">${item.categoria}</span></td>
        <td class="col-mono">${item.total_quantity ?? 0} ${item.unidade_medida}</td>
        <td class="col-mono">${item.nearest_expiry ? formatDate(item.nearest_expiry) : '—'}</td>
        <td>${statusBadge}</td>
        <td>
          <div class="flex gap-2">
            <button class="btn btn-ghost btn-sm" onclick="openExitModal('${item.id}')">Saída</button>
            <button class="btn btn-ghost btn-sm" onclick="viewBatches('${item.id}')">Lotes</button>
          </div>
        </td>
      </tr>`;
  }).join('');
}

function buildStatusBadge(qty, minQty, days) {
  if (days !== null && days <= 7) return '<span class="badge badge-red">🔴 Crítico</span>';
  if (days !== null && days <= 15) return '<span class="badge badge-yellow">⚠️ Atenção</span>';
  if (minQty && qty < minQty) return '<span class="badge badge-yellow">⚠️ Baixo</span>';
  return '<span class="badge badge-green">✅ OK</span>';
}

// ─── Entry / Barcode ─────────────────────────────────────────
async function startBarcodeScanner() {
  if (!navigator.mediaDevices?.getUserMedia) {
    showToast('Câmera não disponível neste dispositivo/navegador', 'error');
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
    });
    state.scanStream = stream;
    state.scanActive = true;
    const video = document.getElementById('scanner-video');
    video.srcObject = stream;
    await video.play();
    document.getElementById('scanner-placeholder').style.display = 'none';
    document.getElementById('scanner-overlay').style.display = 'flex';
    document.getElementById('btn-start-scan').classList.add('hidden');
    document.getElementById('btn-stop-scan').classList.remove('hidden');
    requestScanFrame();
  } catch (err) {
    showToast('Sem permissão para câmera. Verifique as configurações do navegador.', 'error');
  }
}

function requestScanFrame() {
  if (!state.scanActive) return;
  const video = document.getElementById('scanner-video');
  if (video.readyState === video.HAVE_ENOUGH_DATA) {
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    if (window.ZXing) decodeWithZXing(canvas);
  }
  state.scanAnimFrame = requestAnimationFrame(requestScanFrame);
}

function decodeWithZXing(canvas) {
  // ZXing integration — loaded via CDN in production
  // Placeholder for barcode decode logic
}

function stopBarcodeScanner() {
  state.scanActive = false;
  if (state.scanAnimFrame) cancelAnimationFrame(state.scanAnimFrame);
  if (state.scanStream) state.scanStream.getTracks().forEach(t => t.stop());
  state.scanStream = null;
  const video = document.getElementById('scanner-video');
  video.srcObject = null;
  document.getElementById('scanner-placeholder').style.display = 'flex';
  document.getElementById('scanner-overlay').style.display = 'none';
  document.getElementById('btn-start-scan').classList.remove('hidden');
  document.getElementById('btn-stop-scan').classList.add('hidden');
}

function handleBarcodeDetected(code) {
  stopBarcodeScanner();
  document.getElementById('entry-barcode').value = code;
  document.getElementById('scan-result').classList.remove('hidden');
  document.getElementById('scan-result-code').textContent = `Código: ${code}`;
  lookupBarcodeProduct(code);
}

async function lookupBarcodeProduct(barcode) {
  try {
    const data = await apiFetch(`/items/barcode/${barcode}`);
    if (data) {
      document.getElementById('entry-name').value = data.nome || '';
      document.getElementById('entry-category').value = data.categoria || '';
      document.getElementById('entry-unit').value = data.unidade_medida || 'un';
      showToast('Produto identificado automaticamente!', 'success');
    }
  } catch {
    showToast('Produto não encontrado no catálogo. Preencha os dados manualmente.', 'warning');
  }
}

async function registerEntry() {
  const payload = {
    barcode: document.getElementById('entry-barcode').value.trim(),
    nome: document.getElementById('entry-name').value.trim(),
    categoria: document.getElementById('entry-category').value,
    unidade_medida: document.getElementById('entry-unit').value,
    quantidade: parseInt(document.getElementById('entry-quantity').value),
    data_validade: document.getElementById('entry-expiry').value,
    doador: document.getElementById('entry-donor').value.trim(),
    observacao: document.getElementById('entry-notes').value.trim(),
  };

  if (!payload.nome || !payload.categoria || !payload.quantidade || !payload.data_validade) {
    showToast('Preencha todos os campos obrigatórios', 'error');
    return;
  }
  if (isNaN(payload.quantidade) || payload.quantidade <= 0) {
    showToast('Quantidade deve ser maior que zero', 'error');
    return;
  }

  const btn = document.getElementById('btn-register-entry');
  btn.disabled = true;
  try {
    await apiFetch('/batches', { method: 'POST', body: JSON.stringify(payload) });
    showToast('Lote registrado com sucesso!', 'success');
    clearEntryForm();
  } catch (err) {
    showToast(`Erro ao registrar: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
  }
}

function clearEntryForm() {
  ['entry-barcode', 'entry-name', 'entry-quantity', 'entry-expiry', 'entry-donor', 'entry-notes'].forEach(id => {
    document.getElementById(id).value = '';
  });
  document.getElementById('entry-category').value = '';
  document.getElementById('scan-result').classList.add('hidden');
}

// ─── Alerts ──────────────────────────────────────────────────
async function loadAlerts() {
  try {
    const data = await apiFetch('/batches/expiring?days=30');
    const criticalItems = data.filter(b => calculateDaysUntilExpiry(b.data_validade) <= 7);
    const warningItems = data.filter(b => {
      const d = calculateDaysUntilExpiry(b.data_validade);
      return d > 7 && d <= 15;
    });
    const noticeItems = data.filter(b => {
      const d = calculateDaysUntilExpiry(b.data_validade);
      return d > 15 && d <= 30;
    });
    renderAlertTable('critical-alerts-body', criticalItems);
    renderAlertTable('warning-alerts-body', warningItems);
    renderAlertTable('notice-alerts-body', noticeItems);
  } catch (err) {
    showToast(`Erro ao carregar alertas: ${err.message}`, 'error');
  }
}

function renderAlertTable(tbodyId, batches) {
  const tbody = document.getElementById(tbodyId);
  if (!batches.length) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state" style="padding:40px"><p>Nenhum item nesta faixa</p></div></td></tr>`;
    return;
  }
  tbody.innerHTML = batches.map(b => {
    const days = calculateDaysUntilExpiry(b.data_validade);
    const badgeClass = days <= 3 ? 'badge-red' : days <= 7 ? 'badge-yellow' : 'badge-blue';
    return `
      <tr>
        <td style="font-weight:500">${b.item_nome}</td>
        <td class="col-mono">${b.id.substring(0, 8)}</td>
        <td class="col-mono">${b.quantidade}</td>
        <td class="col-mono">${formatDate(b.data_validade)}</td>
        <td><span class="badge ${badgeClass}">${days} dia${days !== 1 ? 's' : ''}</span></td>
        <td>
          <button class="btn btn-ghost btn-sm" onclick="openExitModal('${b.item_id}', '${b.id}')">Distribuir</button>
        </td>
      </tr>`;
  }).join('');
}

// ─── Movements ───────────────────────────────────────────────
async function loadMovements() {
  try {
    const data = await apiFetch('/movements?limit=100');
    state.movements = data;
    renderMovementsTable(data);
  } catch (err) {
    showToast(`Erro ao carregar movimentações: ${err.message}`, 'error');
  }
}

function renderMovementsTable(movements) {
  const tbody = document.getElementById('movements-table-body');
  if (!movements.length) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state" style="padding:40px"><p>Nenhuma movimentação registrada</p></div></td></tr>`;
    return;
  }
  tbody.innerHTML = movements.map(m => {
    const typeBadge = m.tipo === 'entrada'
      ? '<span class="badge badge-green">Entrada</span>'
      : '<span class="badge badge-blue">Saída</span>';
    return `
      <tr>
        <td class="col-mono text-sm">${formatDateTime(m.created_at)}</td>
        <td>${typeBadge}</td>
        <td style="font-weight:500">${m.item_nome}</td>
        <td class="col-mono">${m.quantidade}</td>
        <td>${m.responsavel_nome || '—'}</td>
        <td class="text-sm text-muted">${m.observacao || '—'}</td>
      </tr>`;
  }).join('');
}

// ─── Reports ─────────────────────────────────────────────────
function initReportDates() {
  const now = new Date();
  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
  document.getElementById('report-start').value = firstDay.toISOString().split('T')[0];
  document.getElementById('report-end').value = now.toISOString().split('T')[0];
}

async function generateReport() {
  const start = document.getElementById('report-start').value;
  const end = document.getElementById('report-end').value;
  if (!start || !end) { showToast('Selecione o período', 'error'); return; }

  try {
    const data = await apiFetch(`/reports/impact?start=${start}&end=${end}`);
    document.getElementById('report-received').textContent = data.total_received ?? '—';
    document.getElementById('report-distributed').textContent = data.total_distributed ?? '—';
    document.getElementById('report-families').textContent = data.estimated_families ?? '—';
    renderReportByCategory(data.by_category ?? []);
    renderWastedItems(data.wasted ?? []);
  } catch (err) {
    showToast(`Erro ao gerar relatório: ${err.message}`, 'error');
  }
}

function renderReportByCategory(categories) {
  const el = document.getElementById('report-by-category');
  if (!categories.length) {
    el.innerHTML = '<div class="empty-state" style="padding:32px"><p>Sem dados no período</p></div>';
    return;
  }
  el.innerHTML = categories.map(c => `
    <div class="flex justify-between items-center" style="padding:8px 0;border-bottom:1px solid var(--border)">
      <span style="font-size:13px">${c.category}</span>
      <div class="flex gap-2 items-center">
        <span class="col-mono text-sm">${c.total} un</span>
        <span class="badge badge-green">${c.pct}%</span>
      </div>
    </div>`).join('');
}

function renderWastedItems(items) {
  const el = document.getElementById('report-wasted');
  if (!items.length) {
    el.innerHTML = '<div class="empty-state" style="padding:32px"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg><p>Nenhum item desperdiçado 🎉</p></div>';
    return;
  }
  el.innerHTML = items.map(i => `
    <div class="flex justify-between items-center" style="padding:8px 0;border-bottom:1px solid var(--border)">
      <span style="font-size:13px">${i.nome}</span>
      <span class="badge badge-red">${i.quantidade} un expirados</span>
    </div>`).join('');
}

async function exportReportPDF() {
  const start = document.getElementById('report-start').value;
  const end = document.getElementById('report-end').value;
  if (!start || !end) { showToast('Selecione o período antes de exportar', 'warning'); return; }
  showToast('Gerando PDF...', 'default');
  window.open(`${API_BASE}/reports/pdf?start=${start}&end=${end}&token=${state.session?.access_token}`, '_blank');
}

// ─── Needs Admin ─────────────────────────────────────────────
async function loadNeedsAdmin() {
  try {
    const [needsData, itemsData] = await Promise.all([
      apiFetch('/need-alerts'),
      apiFetch('/items'),
    ]);
    state.needAlerts = needsData;
    state.items = itemsData;
    renderNeedsTable(needsData);
    populateItemSelects();
  } catch (err) {
    showToast(`Erro ao carregar necessidades: ${err.message}`, 'error');
  }
}

function renderNeedsTable(needs) {
  const tbody = document.getElementById('needs-table-body');
  if (!needs.length) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state" style="padding:40px"><p>Nenhum alerta ativo</p></div></td></tr>`;
    return;
  }
  tbody.innerHTML = needs.map(n => `
    <tr>
      <td style="font-weight:500">${n.item_nome}</td>
      <td class="col-mono">${n.quantidade_minima}</td>
      <td class="text-sm text-muted">${n.mensagem || '—'}</td>
      <td>${n.is_active ? '<span class="badge badge-green">Ativo</span>' : '<span class="badge badge-gray">Inativo</span>'}</td>
      <td class="col-mono text-sm">${formatDate(n.created_at)}</td>
      <td>
        <button class="btn btn-ghost btn-sm" onclick="toggleNeedAlert('${n.id}', ${!n.is_active})">
          ${n.is_active ? 'Desativar' : 'Ativar'}
        </button>
        <button class="btn btn-ghost btn-sm" onclick="deleteNeedAlert('${n.id}')">Excluir</button>
      </td>
    </tr>`).join('');
}

async function toggleNeedAlert(id, isActive) {
  try {
    await apiFetch(`/need-alerts/${id}`, { method: 'PATCH', body: JSON.stringify({ is_active: isActive }) });
    showToast('Alerta atualizado', 'success');
    loadNeedsAdmin();
  } catch (err) {
    showToast(`Erro: ${err.message}`, 'error');
  }
}

async function deleteNeedAlert(id) {
  if (!confirm('Excluir este alerta de necessidade?')) return;
  try {
    await apiFetch(`/need-alerts/${id}`, { method: 'DELETE' });
    showToast('Alerta excluído', 'success');
    loadNeedsAdmin();
  } catch (err) {
    showToast(`Erro: ${err.message}`, 'error');
  }
}

async function saveNeedAlert() {
  const payload = {
    item_id: document.getElementById('need-item-select').value,
    quantidade_minima: parseInt(document.getElementById('need-min-qty').value),
    mensagem: document.getElementById('need-message').value.trim(),
  };
  if (!payload.item_id || !payload.quantidade_minima) {
    showToast('Preencha os campos obrigatórios', 'error');
    return;
  }
  try {
    await apiFetch('/need-alerts', { method: 'POST', body: JSON.stringify(payload) });
    showToast('Alerta publicado com sucesso!', 'success');
    closeModal('modal-new-need');
    loadNeedsAdmin();
  } catch (err) {
    showToast(`Erro: ${err.message}`, 'error');
  }
}

// ─── Public Needs ────────────────────────────────────────────
async function loadPublicNeeds() {
  try {
    const data = await apiFetch('/public/needs');
    const grid = document.getElementById('public-needs-grid');
    if (!data.needs?.length) {
      grid.innerHTML = '<div class="empty-state"><p>Nenhuma necessidade urgente no momento. Obrigado!</p></div>';
      return;
    }
    if (data.org_name) document.getElementById('public-org-name').textContent = data.org_name;
    document.getElementById('public-updated').textContent = `Atualizado: ${formatDateTime(new Date().toISOString())}`;
    const iconMap = { alimentos: '🥫', higiene: '🧴', limpeza: '🧹', vestuario: '👕', outros: '📦' };
    grid.innerHTML = data.needs.map(n => `
      <div class="need-card">
        <div class="need-card-icon">${iconMap[n.categoria] || '📦'}</div>
        <div class="need-card-title">${n.item_nome}</div>
        <div class="need-card-urgency">Estoque atual: ${n.current_qty} · Necessário: ${n.quantidade_minima}</div>
        <div class="stock-meter">
          <div class="stock-meter-fill critical" style="width:${Math.min(100, (n.current_qty / n.quantidade_minima) * 100)}%"></div>
        </div>
        ${n.mensagem ? `<p style="font-size:12px;color:var(--muted-foreground);margin-top:10px">${n.mensagem}</p>` : ''}
        <button class="btn btn-primary btn-sm btn-full" style="margin-top:14px">Quero Contribuir</button>
      </div>`).join('');

    if (data.address) {
      document.getElementById('public-how-to-donate').innerHTML = `
        <div class="grid-2" style="gap:16px">
          <div>
            <div style="font-weight:600;margin-bottom:6px">📍 Endereço</div>
            <p class="text-sm">${data.address}</p>
          </div>
          <div>
            <div style="font-weight:600;margin-bottom:6px">🕐 Horário de recebimento</div>
            <p class="text-sm">${data.receiving_hours || 'Seg–Sáb, 8h–17h'}</p>
          </div>
        </div>`;
    }
  } catch (err) {
    document.getElementById('public-needs-grid').innerHTML = `<div class="empty-state"><p>Erro ao carregar necessidades: ${err.message}</p></div>`;
  }
}

// ─── Users ───────────────────────────────────────────────────
async function loadUsers() {
  try {
    const data = await apiFetch('/users');
    state.users = data;
    renderUsersTable(data);
  } catch (err) {
    showToast(`Erro ao carregar usuários: ${err.message}`, 'error');
  }
}

function renderUsersTable(users) {
  const tbody = document.getElementById('users-table-body');
  if (!users.length) {
    tbody.innerHTML = `<tr><td colspan="5"><div class="empty-state" style="padding:40px"><p>Nenhum usuário cadastrado</p></div></td></tr>`;
    return;
  }
  tbody.innerHTML = users.map(u => {
    const roleBadge = {
      coordinator: '<span class="badge badge-blue">Coordenador</span>',
      volunteer: '<span class="badge badge-green">Voluntário</span>',
      donor: '<span class="badge badge-gray">Doador</span>',
    }[u.role] || u.role;
    return `
      <tr>
        <td style="font-weight:500">${u.nome}</td>
        <td class="text-sm text-muted">${u.email}</td>
        <td>${roleBadge}</td>
        <td class="col-mono text-sm">${formatDate(u.created_at)}</td>
        <td>
          <button class="btn btn-ghost btn-sm" onclick="deleteUser('${u.id}')">Remover</button>
        </td>
      </tr>`;
  }).join('');
}

async function saveUser() {
  const payload = {
    nome: document.getElementById('modal-user-name').value.trim(),
    email: document.getElementById('modal-user-email').value.trim(),
    role: document.getElementById('modal-user-role').value,
    password: document.getElementById('modal-user-password').value,
  };
  if (!payload.nome || !payload.email || !payload.password) {
    showToast('Preencha todos os campos obrigatórios', 'error');
    return;
  }
  try {
    await apiFetch('/users', { method: 'POST', body: JSON.stringify(payload) });
    showToast('Usuário criado com sucesso!', 'success');
    closeModal('modal-new-user');
    loadUsers();
  } catch (err) {
    showToast(`Erro: ${err.message}`, 'error');
  }
}

async function deleteUser(id) {
  if (!confirm('Remover este usuário? Esta ação não pode ser desfeita.')) return;
  try {
    await apiFetch(`/users/${id}`, { method: 'DELETE' });
    showToast('Usuário removido', 'success');
    loadUsers();
  } catch (err) {
    showToast(`Erro: ${err.message}`, 'error');
  }
}

async function saveItem() {
  const payload = {
    nome: document.getElementById('modal-item-name').value.trim(),
    categoria: document.getElementById('modal-item-category').value,
    unidade_medida: document.getElementById('modal-item-unit').value,
    codigo_barras: document.getElementById('modal-item-barcode').value.trim() || null,
  };
  if (!payload.nome || !payload.categoria) {
    showToast('Preencha os campos obrigatórios', 'error');
    return;
  }
  try {
    await apiFetch('/items', { method: 'POST', body: JSON.stringify(payload) });
    showToast('Item cadastrado!', 'success');
    closeModal('modal-new-item');
    loadInventory();
  } catch (err) {
    showToast(`Erro: ${err.message}`, 'error');
  }
}

async function saveExit() {
  const payload = {
    item_id: document.getElementById('exit-item-select').value,
    quantidade: parseInt(document.getElementById('exit-quantity').value),
    destinatario: document.getElementById('exit-recipient').value.trim(),
    observacao: document.getElementById('exit-notes').value.trim(),
  };
  if (!payload.item_id || !payload.quantidade) {
    showToast('Preencha os campos obrigatórios', 'error');
    return;
  }
  try {
    await apiFetch('/movements/exit', { method: 'POST', body: JSON.stringify(payload) });
    showToast('Saída registrada com sucesso!', 'success');
    closeModal('modal-new-exit');
    loadInventory();
  } catch (err) {
    showToast(`Erro: ${err.message}`, 'error');
  }
}

// ─── Modals ──────────────────────────────────────────────────
function openModal(id) {
  document.getElementById(id).classList.remove('hidden');
}

function closeModal(id) {
  document.getElementById(id).classList.add('hidden');
}

function openExitModal(itemId, batchId) {
  populateItemSelects();
  if (itemId) document.getElementById('exit-item-select').value = itemId;
  openModal('modal-new-exit');
}

function populateItemSelects() {
  const selects = ['exit-item-select', 'need-item-select'];
  selects.forEach(selectId => {
    const el = document.getElementById(selectId);
    if (!el) return;
    el.innerHTML = '<option value="">Selecionar item...</option>' +
      state.items.map(i => `<option value="${i.id}">${i.nome}</option>`).join('');
  });
}

function viewBatches(itemId) {
  showToast('Funcionalidade de detalhe de lotes disponível na v1.1', 'default');
}

// ─── Utilities ───────────────────────────────────────────────
function calculateDaysUntilExpiry(dateStr) {
  const expiry = new Date(dateStr);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.ceil((expiry - today) / (1000 * 60 * 60 * 24));
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('pt-BR');
}

function formatDateTime(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

// ─── Event Listeners ─────────────────────────────────────────
function bindEvents() {
  // Login
  // Localize o Event Listener do botão de login no final do arquivo
  document.getElementById('btn-login').addEventListener('click', async () => {
    const emailEl = document.getElementById('login-email');
    const passwordEl = document.getElementById('login-password');
    const errorEl = document.getElementById('login-error');
    const errorMsgEl = document.getElementById('login-error-msg');
    const btn = document.getElementById('btn-login');

    // Limpa estados anteriores
    errorEl.classList.add('hidden');
    const email = emailEl.value.trim();
    const password = passwordEl.value;

    if (!email || !password) {
      errorMsgEl.textContent = 'Por favor, preencha todos os campos.';
      errorEl.classList.remove('hidden');
      return;
    }

    // Feedback visual de carregamento
    btn.disabled = true;
    const originalText = btn.innerHTML;
    btn.textContent = 'Autenticando...';

    try {
      // Tenta o login
      const data = await login(email, password);

      // Se deu certo, mostra o App [cite: 1, 2]
      showToast('Bem-vindo ao DoaStock!', 'success');
      showAppShell();

    } catch (err) {
      // Aqui está a robustez: captura a mensagem real do backend
      console.error("Erro de Login:", err.message);
      errorMsgEl.textContent = err.message; // Exibe: "E-mail não cadastrado" ou "Senha incorreta"
      errorEl.classList.remove('hidden');

      // Shake effect opcional para feedback visual
      errorEl.parentElement.animate([
        { transform: 'translateX(-5px)' },
        { transform: 'translateX(5px)' },
        { transform: 'translateX(0)' }
      ], { duration: 200, iterations: 2 });

    } finally {
      btn.disabled = false;
      btn.innerHTML = originalText;
    }
  });

  document.getElementById('login-password').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('btn-login').click();
  });

  document.getElementById('link-public').addEventListener('click', e => {
    e.preventDefault();
    showPublicView();
  });

  document.getElementById('btn-back-login').addEventListener('click', showLoginScreen);
  document.getElementById('btn-logout').addEventListener('click', logout);
  document.getElementById('btn-refresh-dash').addEventListener('click', loadDashboard);

  // Sidebar navigation
  document.querySelectorAll('.nav-item[data-view]').forEach(btn => {
    btn.addEventListener('click', () => navigateTo(btn.dataset.view));
  });

  // Scanner
  document.getElementById('btn-start-scan').addEventListener('click', startBarcodeScanner);
  document.getElementById('btn-stop-scan').addEventListener('click', stopBarcodeScanner);
  document.getElementById('btn-register-entry').addEventListener('click', registerEntry);

  // Alerts tabs
  document.querySelectorAll('.tab-trigger').forEach(trigger => {
    trigger.addEventListener('click', () => {
      const panel = trigger.dataset.tab;
      document.querySelectorAll('.tab-trigger').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      trigger.classList.add('active');
      document.getElementById(panel)?.classList.add('active');
    });
  });

  // Movements filter
  document.getElementById('mov-search').addEventListener('input', e => {
    const term = e.target.value.toLowerCase();
    const filtered = state.movements.filter(m =>
      m.item_nome?.toLowerCase().includes(term) ||
      m.responsavel_nome?.toLowerCase().includes(term)
    );
    renderMovementsTable(filtered);
  });

  document.getElementById('mov-type-filter').addEventListener('change', e => {
    const type = e.target.value;
    const filtered = type ? state.movements.filter(m => m.tipo === type) : state.movements;
    renderMovementsTable(filtered);
  });

  // Inventory filters
  document.getElementById('inventory-search').addEventListener('input', e => {
    const term = e.target.value.toLowerCase();
    const filtered = state.items.filter(i =>
      i.nome?.toLowerCase().includes(term) ||
      i.codigo_barras?.includes(term)
    );
    renderInventoryTable(filtered);
  });

  document.getElementById('inventory-filter-category').addEventListener('change', e => {
    const cat = e.target.value;
    const filtered = cat ? state.items.filter(i => i.categoria === cat) : state.items;
    renderInventoryTable(filtered);
  });

  // Reports
  document.getElementById('btn-generate-report').addEventListener('click', generateReport);
  document.getElementById('btn-export-pdf').addEventListener('click', exportReportPDF);

  // Modals triggers
  document.getElementById('btn-new-item').addEventListener('click', () => openModal('modal-new-item'));
  document.getElementById('btn-new-exit').addEventListener('click', () => {
    populateItemSelects();
    openModal('modal-new-exit');
  });
  document.getElementById('btn-new-user').addEventListener('click', () => openModal('modal-new-user'));
  document.getElementById('btn-new-need').addEventListener('click', () => {
    populateItemSelects();
    openModal('modal-new-need');
  });

  // Modal saves
  document.getElementById('btn-save-item').addEventListener('click', saveItem);
  document.getElementById('btn-save-exit').addEventListener('click', saveExit);
  document.getElementById('btn-save-user').addEventListener('click', saveUser);
  document.getElementById('btn-save-need').addEventListener('click', saveNeedAlert);

  // Modal close buttons
  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => closeModal(btn.dataset.close));
  });

  // Close modal on backdrop click
  document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
    backdrop.addEventListener('click', e => {
      if (e.target === backdrop) closeModal(backdrop.id);
    });
  });

  // Copy public link
  document.getElementById('btn-copy-public-link').addEventListener('click', () => {
    const url = `${window.location.origin}${window.location.pathname}?view=public`;
    navigator.clipboard.writeText(url).then(() => showToast('Link copiado!', 'success'));
  });
}

// ─── Init ────────────────────────────────────────────────────
function init() {
  bindEvents();

  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('view') === 'public') {
    showPublicView();
    return;
  }

  loadPersistedSession();
  if (state.session?.access_token) {
    showAppShell();
  } else {
    showLoginScreen();
  }
}

document.addEventListener('DOMContentLoaded', init);
