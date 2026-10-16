// ============================================================
// IHM - MONITORAMENTO INDUSTRIAL
// Motor Trifásico + Bomba Hidráulica
// VERSÃO ATUAL: dados simulados
// FUTURO: substituir as funções de dados pela API do backend.
// ============================================================

const state = {
  motorHistory: [],
  pumpHistory: [],
  maxHistory: 18,
  currentDashboard: "motor"
};

// Limites de demonstração da interface. NÃO são limites de segurança.
// Devem ser substituídos pelos valores definidos para os equipamentos reais.
const LIMITS = {
  motor: {
    temperatureWarning: 65, temperatureDanger: 80,
    currentWarning: 12, currentDanger: 15,
    vibrationWarning: 6, vibrationDanger: 10
  },
  pump: {
    pressureWarning: 6, pressureDanger: 8,
    flowWarning: 20, flowDanger: 15,
    temperatureWarning: 60, temperatureDanger: 75,
    vibrationWarning: 6, vibrationDanger: 10
  }
};

const $ = (id) => document.getElementById(id);

function formatNumber(value, decimals = 1) {
  return Number.isFinite(value) ? Number(value).toFixed(decimals) : "—";
}

function nowTime() {
  return new Date().toLocaleTimeString("pt-BR", {
    hour: "2-digit", minute: "2-digit", second: "2-digit"
  });
}

function getParameterState(value, warning, danger) {
  if (!Number.isFinite(value)) return "unknown";
  if (value >= danger) return "danger";
  if (value >= warning) return "warning";
  return "normal";
}

function stateLabel(status) {
  if (status === "danger") return "Alerta";
  if (status === "warning") return "Atenção";
  return status === "unknown" ? "Sem leitura" : "Normal";
}

function overallState(statuses) {
  if (statuses.includes("danger")) return "danger";
  if (statuses.includes("warning")) return "warning";
  return statuses.every(s=>s === "unknown") ? "unknown" : "normal";
}

// ------------------------------------------------------------
// API PÚBLICA THINGSPEAK — SEM CHAVES NO NAVEGADOR
// ------------------------------------------------------------
const TS = window.THING_SPEAK_CONFIG;
function parseField(v) {
  if (v === null || v === undefined || String(v).trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function mapMotor(feed) {
  return {
    entryId: feed.entry_id,
    time: new Date(feed.created_at).toLocaleTimeString("pt-BR", {hour:"2-digit",minute:"2-digit",second:"2-digit"}),
    timestamp: feed.created_at,
    temperature: parseField(feed.field1), current: parseField(feed.field2),
    vibrationX: parseField(feed.field3), vibrationY: parseField(feed.field4)
  };
}
async function fetchMotorHistory() {
  if (!TS || !/^\d+$/.test(String(TS.channelId))) throw new Error("Configure o channelId no config.js");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const url = `https://api.thingspeak.com/channels/${TS.channelId}/feeds.json?results=${state.maxHistory}`;
    const response = await fetch(url, {signal: controller.signal, cache:"no-store"});
    if (!response.ok) throw new Error(`ThingSpeak retornou HTTP ${response.status}. Verifique se o canal está público.`);
    const payload = await response.json();
    if (!Array.isArray(payload.feeds)) throw new Error("Resposta inválida do ThingSpeak");
    return payload.feeds.filter(f => f.created_at).map(mapMotor).reverse();
  } finally { clearTimeout(timeout); }
}
function hasMotorData(d) {
  return d && [d.temperature,d.current,d.vibrationX,d.vibrationY].some(Number.isFinite);
}
function isFresh(d) {
  const age = Date.now() - new Date(d.timestamp).getTime();
  return Number.isFinite(age) && age >= -60000 && age <= (TS.staleAfterSeconds || 120)*1000;
}
function showNoData(message) {
  ["temperatureValue","currentValue","vibrationXValue","vibrationYValue"].forEach(id => $(id).textContent="—");
  ["temperatureState","currentState","vibrationXState","vibrationYState"].forEach(id => {$(id).textContent="—";$(id).className="state";});
  $("chartTempCurrent").textContent="— °C";
  $("chartCurrentCurrent").textContent="— A";
  $("motorStatus").textContent="Sem leitura atual";
  $("statusDescription").textContent=message;
  $("statusIndicator").textContent="SEM DADOS";
  $("alertTitle").textContent="Monitoramento indisponível";
  $("alertMessage").textContent=message;
}
function showPumpUnavailable() {
  ["pressureValue","flowValue","pumpTemperatureValue","pumpVibrationValue"].forEach(id=>$(id).textContent="—");
  ["pressureState","flowState","pumpTemperatureState","pumpVibrationState"].forEach(id=>{$(id).textContent="—";$(id).className="state";});
  ["chartPressureCurrent","chartFlowCurrent","chartPumpTempCurrent"].forEach(id=>$(id).textContent="—");
  $("pumpStatus").textContent="Sem canal configurado";
  $("pumpStatusDescription").textContent="A bomba hidráulica ainda não possui canal de dados.";
  $("pumpStatusIndicator").textContent="INDISPONÍVEL";
  $("pumpAlertTitle").textContent="Aguardando integração";
  $("pumpAlertMessage").textContent="Configure um canal e sensores específicos para a bomba.";
}

// ------------------------------------------------------------
// ATUALIZAÇÃO DO MOTOR
// ------------------------------------------------------------

function updateMotorDashboard(data) {
  const t = getParameterState(data.temperature, LIMITS.motor.temperatureWarning, LIMITS.motor.temperatureDanger);
  const c = getParameterState(data.current, LIMITS.motor.currentWarning, LIMITS.motor.currentDanger);
  const x = getParameterState(data.vibrationX, LIMITS.motor.vibrationWarning, LIMITS.motor.vibrationDanger);
  const y = getParameterState(data.vibrationY, LIMITS.motor.vibrationWarning, LIMITS.motor.vibrationDanger);
  const overall = overallState([t, c, x, y]);

  updateMetric("temperatureValue", data.temperature, "temperatureState", t);
  updateMetric("currentValue", data.current, "currentState", c);
  updateMetric("vibrationXValue", data.vibrationX, "vibrationXState", x);
  updateMetric("vibrationYValue", data.vibrationY, "vibrationYState", y);

  $("chartTempCurrent").textContent = `${formatNumber(data.temperature)} °C`;
  $("chartCurrentCurrent").textContent = `${formatNumber(data.current)} A`;

  if ([t,c,x,y].includes("unknown")) {
    $("motorStatus").textContent="Leitura parcial";
    $("statusDescription").textContent="Um ou mais sensores ainda não forneceram dados válidos.";
    $("statusIndicator").textContent="PARCIAL";
    $("alertTitle").textContent="Dados incompletos";
    $("alertMessage").textContent="Não é possível avaliar todos os parâmetros.";
    return;
  }
  setStatus("motorStatus", "statusDescription", "statusIndicator", "alertPanel", "alertTitle", "alertMessage", overall, "Motor em operação", "Motor em observação", "Atenção necessária", "Todos os parâmetros estão dentro da faixa configurada.", "Foi identificada uma leitura acima da faixa normal.", "Um ou mais parâmetros ultrapassaram o limite de alerta.");
}

function updateMetric(valueId, value, stateId, status) {
  $(valueId).textContent = formatNumber(value);
  $(stateId).textContent = stateLabel(status);
  $(stateId).className = `state ${status}`;
}

// ------------------------------------------------------------
// ATUALIZAÇÃO DA BOMBA
// ------------------------------------------------------------

function updatePumpDashboard(data) {
  const p = getParameterState(data.pressure, LIMITS.pump.pressureWarning, LIMITS.pump.pressureDanger);
  // Para vazão, valores abaixo do limite representam condição de atenção.
  const flow = data.flow <= LIMITS.pump.flowDanger ? "danger" : data.flow <= LIMITS.pump.flowWarning ? "warning" : "normal";
  const t = getParameterState(data.temperature, LIMITS.pump.temperatureWarning, LIMITS.pump.temperatureDanger);
  const v = getParameterState(data.vibration, LIMITS.pump.vibrationWarning, LIMITS.pump.vibrationDanger);
  const overall = overallState([p, flow, t, v]);

  updateMetric("pressureValue", data.pressure, "pressureState", p);
  updateMetric("flowValue", data.flow, "flowState", flow);
  updateMetric("pumpTemperatureValue", data.temperature, "pumpTemperatureState", t);
  updateMetric("pumpVibrationValue", data.vibration, "pumpVibrationState", v);

  $("chartPressureCurrent").textContent = `${formatNumber(data.pressure)} bar`;
  $("chartFlowCurrent").textContent = `${formatNumber(data.flow)} L/min`;
  $("chartPumpTempCurrent").textContent = `${formatNumber(data.temperature)} °C`;

  setStatus("pumpStatus", "pumpStatusDescription", "pumpStatusIndicator", "pumpAlertPanel", "pumpAlertTitle", "pumpAlertMessage", overall, "Bomba em operação", "Bomba em observação", "Atenção necessária", "Todos os parâmetros estão dentro da faixa configurada.", "Foi identificada uma leitura fora da faixa normal.", "Um ou mais parâmetros ultrapassaram o limite de alerta.");
}

function setStatus(statusId, descId, indicatorId, alertPanelId, alertTitleId, alertMessageId, status, normalTitle, warningTitle, dangerTitle, normalDesc, warningDesc, dangerDesc) {
  const indicator = $(indicatorId);
  const panel = $(alertPanelId);
  const icon = panel.querySelector(".alert-icon");

  if (status === "danger") {
    $(statusId).textContent = dangerTitle;
    $(descId).textContent = dangerDesc;
    indicator.innerHTML = "<span></span> ALERTA";
    indicator.style.background = "var(--red-soft)";
    indicator.style.color = "var(--red)";
    panel.style.borderLeftColor = "var(--red)";
    icon.style.background = "var(--red-soft)";
    icon.style.color = "var(--red)";
    $(alertTitleId).textContent = "Condição de alerta";
    $(alertMessageId).textContent = "Verifique os parâmetros do equipamento.";
  } else if (status === "warning") {
    $(statusId).textContent = warningTitle;
    $(descId).textContent = warningDesc;
    indicator.innerHTML = "<span></span> ATENÇÃO";
    indicator.style.background = "var(--orange-soft)";
    indicator.style.color = "var(--orange)";
    panel.style.borderLeftColor = "var(--orange)";
    icon.style.background = "var(--orange-soft)";
    icon.style.color = "var(--orange)";
    $(alertTitleId).textContent = "Atenção";
    $(alertMessageId).textContent = "Uma das variáveis está fora da faixa normal.";
  } else {
    $(statusId).textContent = normalTitle;
    $(descId).textContent = normalDesc;
    indicator.innerHTML = "<span></span> NORMAL";
    indicator.style.background = "var(--green-soft)";
    indicator.style.color = "var(--green)";
    panel.style.borderLeftColor = "var(--green)";
    icon.style.background = "var(--green-soft)";
    icon.style.color = "var(--green)";
    $(alertTitleId).textContent = "Sistema monitorado";
    $(alertMessageId).textContent = "Nenhuma condição de alerta detectada.";
  }
}

// ------------------------------------------------------------
// GRÁFICOS
// ------------------------------------------------------------

const chartCommon = {
  responsive: true,
  maintainAspectRatio: false,
  animation: false,
  interaction: { intersect: false, mode: "index" },
  plugins: { legend: { display: false } },
  scales: {
    x: { grid: { display: false }, ticks: { color: "#858992", font: { size: 9 } } },
    y: { grid: { color: "#eceef1" }, ticks: { color: "#858992", font: { size: 9 } } }
  }
};

function makeLineChart(id, borderColor, fillColor, suggestedMin, suggestedMax) {
  return new Chart($(id), {
    type: "line",
    data: { labels: [], datasets: [{ data: [], borderColor, backgroundColor: fillColor, fill: true, borderWidth: 2, tension: 0.35, pointRadius: 0 }] },
    options: { ...chartCommon, scales: { ...chartCommon.scales, y: { ...chartCommon.scales.y, suggestedMin, suggestedMax } } }
  });
}

const temperatureChart = makeLineChart("temperatureChart", "#d71920", "rgba(215,25,32,.08)", 35, 55);
const currentChart = makeLineChart("currentChart", "#111214", "rgba(17,18,20,.06)", 5, 12);

const vibrationChart = new Chart($("vibrationChart"), {
  type: "line",
  data: { labels: [], datasets: [
    { label: "Eixo X", data: [], borderColor: "#d71920", borderWidth: 2, tension: .35, pointRadius: 0 },
    { label: "Eixo Y", data: [], borderColor: "#555a63", borderWidth: 2, tension: .35, pointRadius: 0 }
  ] },
  options: { ...chartCommon, scales: { ...chartCommon.scales, y: { ...chartCommon.scales.y, suggestedMin: 0, suggestedMax: 5 } } }
});

const pressureChart = makeLineChart("pressureChart", "#d71920", "rgba(215,25,32,.08)", 3, 6);
const flowChart = makeLineChart("flowChart", "#111214", "rgba(17,18,20,.06)", 20, 40);
const pumpTemperatureChart = makeLineChart("pumpTemperatureChart", "#d71920", "rgba(215,25,32,.08)", 30, 50);

function updateMotorCharts() {
  const data = [...state.motorHistory].reverse();
  const labels = data.map(item => item.time.slice(0, 5));
  temperatureChart.data.labels = labels;
  temperatureChart.data.datasets[0].data = data.map(item => item.temperature);
  currentChart.data.labels = labels;
  currentChart.data.datasets[0].data = data.map(item => item.current);
  vibrationChart.data.labels = labels;
  vibrationChart.data.datasets[0].data = data.map(item => item.vibrationX);
  vibrationChart.data.datasets[1].data = data.map(item => item.vibrationY);
  temperatureChart.update(); currentChart.update(); vibrationChart.update();
}

function updatePumpCharts() {
  const data = [...state.pumpHistory].reverse();
  const labels = data.map(item => item.time.slice(0, 5));
  pressureChart.data.labels = labels;
  pressureChart.data.datasets[0].data = data.map(item => item.pressure);
  flowChart.data.labels = labels;
  flowChart.data.datasets[0].data = data.map(item => item.flow);
  pumpTemperatureChart.data.labels = labels;
  pumpTemperatureChart.data.datasets[0].data = data.map(item => item.temperature);
  pressureChart.update(); flowChart.update(); pumpTemperatureChart.update();
}

// ------------------------------------------------------------
// HISTÓRICO
// ------------------------------------------------------------

function renderHistory() {
  const body = $("historyBody");
  const data = state.currentDashboard === "motor" ? state.motorHistory : state.pumpHistory;

  if (!data.length) { body.innerHTML = `<tr><td colspan="6">Nenhuma medição disponível.</td></tr>`; return; }
  body.innerHTML = data.map(item => {
    if (state.currentDashboard === "motor") {
      const statuses = [
        getParameterState(item.temperature, LIMITS.motor.temperatureWarning, LIMITS.motor.temperatureDanger),
        getParameterState(item.current, LIMITS.motor.currentWarning, LIMITS.motor.currentDanger),
        getParameterState(item.vibrationX, LIMITS.motor.vibrationWarning, LIMITS.motor.vibrationDanger),
        getParameterState(item.vibrationY, LIMITS.motor.vibrationWarning, LIMITS.motor.vibrationDanger)
      ];
      const label = stateLabel(overallState(statuses));
      return `<tr><td>${item.time}</td><td>${formatNumber(item.temperature)} °C</td><td>${formatNumber(item.current)} A</td><td>${formatNumber(item.vibrationX)}</td><td>${formatNumber(item.vibrationY)}</td><td><span class="badge">${label}</span></td></tr>`;
    }
    const statuses = [
      getParameterState(item.pressure, LIMITS.pump.pressureWarning, LIMITS.pump.pressureDanger),
      item.flow <= LIMITS.pump.flowDanger ? "danger" : item.flow <= LIMITS.pump.flowWarning ? "warning" : "normal",
      getParameterState(item.temperature, LIMITS.pump.temperatureWarning, LIMITS.pump.temperatureDanger),
      getParameterState(item.vibration, LIMITS.pump.vibrationWarning, LIMITS.pump.vibrationDanger)
    ];
    return `<tr><td>${item.time}</td><td>${formatNumber(item.pressure)} bar</td><td>${formatNumber(item.flow)} L/min</td><td>${formatNumber(item.temperature)} °C</td><td>${formatNumber(item.vibration)}</td><td><span class="badge">${stateLabel(overallState(statuses))}</span></td></tr>`;
  }).join("");

  const headers = document.querySelectorAll("#historyBody");
  void headers;
}

function updateHistoryHeader() {
  const row = document.querySelector("#historico thead tr");
  if (state.currentDashboard === "motor") {
    row.innerHTML = `<th>Horário</th><th>Temperatura</th><th>Corrente</th><th>Vibração X</th><th>Vibração Y</th><th>Status</th>`;
  } else {
    row.innerHTML = `<th>Horário</th><th>Pressão</th><th>Vazão</th><th>Temperatura</th><th>Vibração</th><th>Status</th>`;
  }
}

// ------------------------------------------------------------
// NAVEGAÇÃO / SELEÇÃO DO EQUIPAMENTO
// ------------------------------------------------------------

function showSection(sectionId) {
  document.querySelectorAll(".section").forEach(section => section.classList.remove("active-section"));
  $(sectionId).classList.add("active-section");
}

function selectDashboard(type) {
  state.currentDashboard = type;
  document.querySelectorAll(".dashboard-choice").forEach(btn => btn.classList.toggle("active", btn.dataset.dashboard === type));

  if (type === "motor") {
    showSection("dashboard");
    $("pageTitle").textContent = "Motor Trifásico";
    $("pageSubtitle").textContent = "Sistema de acompanhamento de temperatura, corrente e vibração.";
  } else {
    showSection("pumpDashboard");
    $("pageTitle").textContent = "Bomba Hidráulica";
    $("pageSubtitle").textContent = "Sistema de acompanhamento de pressão, vazão, temperatura e vibração.";
  }

  updateConnectionLabel();
  renderHistory();
  updateHistoryHeader();
}

document.querySelectorAll(".dashboard-choice").forEach(button => {
  button.addEventListener("click", () => selectDashboard(button.dataset.dashboard));
});

document.querySelectorAll(".nav-item").forEach(button => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".nav-item").forEach(item => item.classList.remove("active"));
    button.classList.add("active");

    if (button.dataset.section === "dashboard") {
      selectDashboard(state.currentDashboard);
      return;
    }

    showSection(button.dataset.section);
  });
});

// ------------------------------------------------------------
// ATUALIZAÇÃO DOS DADOS REAIS
// ------------------------------------------------------------
let lastError = null;
let refreshing = false;
function updateConnectionLabel() {
  const latest = state.motorHistory[0];
  const fresh = hasMotorData(latest) && isFresh(latest) && !lastError;
  $("liveLabel").textContent = fresh ? "ONLINE" : "OFFLINE";
  $("connectionText").textContent = lastError ? "Erro na API" : fresh ? "Dados recentes" : "Sem dados recentes";
  $("cloudStatus").textContent = lastError ? "Erro de leitura" : "Canal " + TS.channelId;
  $("apiStatus").textContent = lastError ? "Indisponível" : "Consulta pública";
  $("lastUpdate").textContent = latest?.time || "--:--:--";
}
async function refreshData() {
  if (refreshing) return;
  refreshing = true;
  try {
    state.motorHistory = await fetchMotorHistory();
    lastError = null;
    updateMotorCharts();
    const latest = state.motorHistory[0];
    if (hasMotorData(latest) && isFresh(latest)) {
      updateMotorDashboard(latest);
    } else {
      showNoData(latest ? "A última medição está antiga ou vazia." : "O canal ainda não recebeu medições.");
    }
  } catch (error) {
    lastError = error.message;
    console.error("ThingSpeak:", error);
    showNoData(error.message);
  } finally {
    updateConnectionLabel();
    renderHistory();
    refreshing = false;
  }
}
showPumpUnavailable();
updateHistoryHeader();
renderHistory();
refreshData();
setInterval(refreshData, Math.max(15000, TS.refreshMs || 20000));
