const STORAGE_KEY = "torneo-admin-state-v1";
const API_STATE_URL = "/api/state";
const GROUP_NAMES = "ABCDEFGHIJKLMNOP".split("");
const ROUND_NAMES = ["Octavos", "Cuartos", "Semifinales", "Final"];
const PAGE = document.body.dataset.page || "teams";
const REMOTE_SYNC_INTERVAL_MS = 5000;
const REMOTE_SAVE_DELAY_MS = 450;
const GROUP_THEMES = [
  { name: "Celeste", className: "theme-celeste" },
  { name: "Verde", className: "theme-green" },
  { name: "Amarillo", className: "theme-yellow" },
  { name: "Crema", className: "theme-cream" },
];

const els = {};

const defaultState = () => ({
  teamsText: "",
  teamsData: [],
  groups: [],
  playoffs: null,
  message: "Pegue 80 equipos para arrancar.",
});

let state = loadLocalState();
let remoteSyncStatus = "Local";
let remoteUpdatedAt = null;
let pendingRemoteSave = null;
let isApplyingRemoteState = false;
let isSavingRemoteState = false;
let lastLocalEditAt = 0;

document.addEventListener("DOMContentLoaded", () => {
  cacheElements();
  bindEvents();
  syncTextarea();
  render();
  initializeRemoteState();
  window.setInterval(refreshRemoteState, REMOTE_SYNC_INTERVAL_MS);
});

function cacheElements() {
  const ids = [
    "teamsInput",
    "fillDemoBtn",
    "loadTeamsBtn",
    "generateGroupsBtn",
    "simulateGroupsBtn",
    "createPlayoffsBtn",
    "simulatePlayoffsBtn",
    "resetBtn",
    "exportBtn",
    "importInput",
    "groupsContainer",
    "playoffsContainer",
    "teamsRoster",
    "messageBox",
    "groupsSummary",
    "topbarStats",
    "teamsSummary",
    "pageSubtitle",
  ];
  ids.forEach((id) => {
    els[id] = document.getElementById(id);
  });
}

function bindEvents() {
  els.fillDemoBtn?.addEventListener("click", () => {
    state.teamsData = buildDemoTeams();
    state.teamsText = teamsDataToText(state.teamsData);
    state.message = "Demo cargado con 80 equipos.";
    saveState();
    syncTextarea();
    render();
  });

  els.loadTeamsBtn?.addEventListener("click", () => {
    const teams = parseTeams(els.teamsInput.value);
    const roster = createRosterFromNames(teams, state.teamsData);
    const missingName = roster.some((entry) => !entry.name);
    const missingSex = roster.some((entry) => !entry.sex);
    if (roster.length !== 80 || missingName) {
      state.message = `Se necesitan 80 equipos. Ahora hay ${roster.filter((entry) => entry.name).length}.`;
      saveState();
      render();
      return;
    }
    if (missingSex) {
      state.message = "Complete el sexo de todos los participantes antes de guardar.";
      saveState();
      render();
      return;
    }
    state.teamsData = roster;
    state.teamsText = teamsDataToText(roster);
    state.groups = [];
    state.playoffs = null;
    state.message = "Equipos guardados. Entre a Grupos y pulse Generar grupos.";
    saveState();
    render();
  });

  els.generateGroupsBtn?.addEventListener("click", () => {
    const roster = getRosterEntries();
    const validNames = roster.filter((entry) => entry.name);
    if (validNames.length !== 80) {
      state.message = "Primero cargue exactamente 80 equipos.";
      saveState();
      render();
      return;
    }
    if (roster.some((entry) => !entry.name || !entry.sex)) {
      state.message = "Complete el sexo de todos los participantes antes de generar grupos.";
      saveState();
      render();
      return;
    }
    state.teamsData = roster;
    state.teamsText = teamsDataToText(roster);
    state.groups = buildBalancedGroups(shuffleArray(roster));
    state.playoffs = null;
    state.message = "Grupos generados equilibrando hombres y mujeres.";
    saveState();
    render();
  });

  els.simulateGroupsBtn?.addEventListener("click", () => {
    simulateGroups();
  });

  els.createPlayoffsBtn?.addEventListener("click", () => {
    const teams = parseTeams(state.teamsText);
    if (teams.length !== 80) {
      state.message = "Primero cargue exactamente 80 equipos.";
      saveState();
      render();
      return;
    }
    if (!state.groups.length) {
      state.message = "Primero genere los grupos desde la pestaña Grupos.";
      saveState();
      render();
      return;
    }
    if (!allGroupMatchesComplete(state.groups)) {
      state.message = "Faltan resultados de grupos. Complete todos los partidos antes de crear playoffs.";
      saveState();
      render();
      return;
    }
    const winners = getGroupWinners(state.groups);
    if (winners.some((winner) => !winner)) {
      state.message = "Todavia no se puede definir un ganador en todos los grupos.";
      saveState();
      render();
      return;
    }
    state.playoffs = createPlayoffs(winners);
    reconcilePlayoffs();
    state.message = "Playoffs creados desde los 16 ganadores de grupo.";
    saveState();
    render();
  });

  els.simulatePlayoffsBtn?.addEventListener("click", () => {
    simulatePlayoffs();
  });

  els.resetBtn?.addEventListener("click", () => {
    state = defaultState();
    saveState();
    syncTextarea();
    render();
  });

  els.exportBtn?.addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "torneo-admin.json";
    a.click();
    URL.revokeObjectURL(url);
  });

  els.importInput?.addEventListener("change", async () => {
    const file = els.importInput.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      state = normalizeImportedState(parsed);
      state.message = "Torneo importado correctamente.";
      saveState();
      syncTextarea();
      render();
    } catch (error) {
      state.message = "No se pudo importar el JSON.";
      saveState();
      render();
    } finally {
      els.importInput.value = "";
    }
  });

  els.teamsInput?.addEventListener("input", () => {
    const hadGeneratedData = state.groups.length || state.playoffs;
    state.teamsData = createRosterFromNames(parseTeams(els.teamsInput.value), state.teamsData);
    state.teamsText = teamsDataToText(state.teamsData);
    if (hadGeneratedData) {
      state.groups = [];
      state.playoffs = null;
      state.message = "Se modifico la lista. Vuelva a generar los grupos.";
    }
    saveState();
    render(false);
  });

  els.teamsRoster?.addEventListener("input", onRosterEdit);
  els.teamsRoster?.addEventListener("change", onRosterEdit);
}

function syncTextarea() {
  if (els.teamsInput) {
    els.teamsInput.value = teamsDataToText(getRosterEntries());
  }
}

function render(reconcile = true) {
  if (reconcile) reconcilePlayoffs();
  const roster = getRosterEntries();
  const loadedGroups = state.groups;
  const groupStats = getGlobalStats(loadedGroups);

  if (els.messageBox) {
    els.messageBox.textContent = state.message || "";
  }
  if (els.topbarStats) {
    els.topbarStats.innerHTML = [
      pill(`${roster.length}/80 equipos`),
      pill(`${loadedGroups.length}/16 grupos`),
      pill(`${groupStats.played}/160 partidos jugados`),
      pill(`${groupStats.finishedGroups}/16 grupos completos`),
      pill(remoteSyncStatus),
    ].join("");
  }
  if (els.teamsSummary) {
    const genderStats = getGenderStats(roster);
    els.teamsSummary.textContent = roster.length
      ? `Total de equipos: ${roster.length}. Hombres: ${genderStats.hombres}. Mujeres: ${genderStats.mujeres}.`
      : "Todavia no hay equipos cargados.";
  }
  if (els.groupsSummary) {
    if (!teams.length) {
      els.groupsSummary.textContent = "Todavia no hay equipos cargados.";
    } else if (!loadedGroups.length) {
      els.groupsSummary.textContent = "Hay equipos cargados, pero todavia no se generaron grupos.";
    } else {
      els.groupsSummary.textContent = `Total de equipos: ${teams.length}. Resultados cargados: ${groupStats.played} de 160.`;
    }
  }
  if (els.pageSubtitle) {
    const subtitles = {
      teams: "Paso 1: cargar los 80 equipos.",
      groups: "Paso 2: jugar la fase de grupos.",
      playoffs: "Paso 3: avanzar en los playoffs.",
    };
    els.pageSubtitle.textContent = subtitles[PAGE] || "";
  }

  if (els.createPlayoffsBtn) {
    els.createPlayoffsBtn.disabled = !canCreatePlayoffs(loadedGroups);
  }

  if (els.simulateGroupsBtn) {
    els.simulateGroupsBtn.disabled = !loadedGroups.length;
  }

  if (els.simulatePlayoffsBtn) {
    els.simulatePlayoffsBtn.disabled = !state.playoffs;
  }

  renderGroups(loadedGroups);
  renderPlayoffs();
  renderTeamsRoster();
  saveLocalState();
}

function renderTeamsRoster() {
  if (!els.teamsRoster) return;

  const roster = getRosterEntries();
  if (!roster.length) {
    els.teamsRoster.innerHTML = `<div class="empty">Pegue o cargue los 80 nombres para completar el sexo de cada participante.</div>`;
    return;
  }

  els.teamsRoster.innerHTML = roster
    .map(
      (entry, index) => `
        <div class="team-entry">
          <div class="team-entry-index">${String(index + 1).padStart(2, "0")}</div>
          <input
            class="team-entry-name"
            type="text"
            value="${escapeAttr(entry.name)}"
            data-roster-field="name"
            data-roster-index="${index}"
            placeholder="Nombre del participante"
          />
          <select class="team-entry-sex" data-roster-field="sex" data-roster-index="${index}">
            <option value="">Sexo</option>
            <option value="hombre" ${entry.sex === "hombre" ? "selected" : ""}>Hombre</option>
            <option value="mujer" ${entry.sex === "mujer" ? "selected" : ""}>Mujer</option>
          </select>
        </div>
      `
    )
    .join("");
}

function onRosterEdit(event) {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const index = Number(target.dataset.rosterIndex);
  const field = target.dataset.rosterField;
  if (!Number.isInteger(index) || !field) return;

  const roster = getRosterEntries();
  if (!roster[index]) return;

  if (field === "name") {
    roster[index] = {
      ...roster[index],
      name: target.value.trim(),
    };
  } else if (field === "sex") {
    roster[index] = {
      ...roster[index],
      sex: normalizeSex(target.value),
    };
  }

  state.teamsData = roster;
  state.teamsText = teamsDataToText(roster);
  invalidateGeneratedData("Se modifico un participante. Vuelva a generar los grupos.");
  saveState();
  render(false);
}

function getRosterEntries() {
  if (Array.isArray(state.teamsData) && state.teamsData.length) {
    return state.teamsData
      .map((entry) => ({
        name: String(entry?.name || "").trim(),
        sex: normalizeSex(entry?.sex),
      }))
      .slice(0, 80);
  }

  return createRosterFromNames(parseTeams(state.teamsText), []);
}

function createRosterFromNames(names, previousRoster) {
  const prev = Array.isArray(previousRoster) ? previousRoster : [];
  return names.slice(0, 80).map((name, index) => ({
    name: String(name || "").trim(),
    sex: normalizeSex(prev[index]?.sex),
  }));
}

function teamsDataToText(roster) {
  return (Array.isArray(roster) ? roster : [])
    .map((entry) => String(entry?.name || "").trim())
    .filter(Boolean)
    .join("\n");
}

function normalizeSex(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "hombre" || normalized === "masculino" || normalized === "h") return "hombre";
  if (normalized === "mujer" || normalized === "femenino" || normalized === "m") return "mujer";
  return "";
}

function getGenderStats(roster) {
  return (Array.isArray(roster) ? roster : []).reduce(
    (accumulator, entry) => {
      if (entry.sex === "hombre") accumulator.hombres += 1;
      if (entry.sex === "mujer") accumulator.mujeres += 1;
      return accumulator;
    },
    { hombres: 0, mujeres: 0 }
  );
}

function invalidateGeneratedData(message) {
  if (state.groups.length || state.playoffs) {
    state.groups = [];
    state.playoffs = null;
    state.message = message;
  }
}

async function initializeRemoteState() {
  const localHasData = hasTournamentData(state);
  remoteSyncStatus = "Sincronizando";
  render(false);

  try {
    const remote = await fetchRemoteState();
    if (remote.state && hasTournamentData(remote.state)) {
      applyRemoteState(remote.state, remote.updatedAt, "Datos compartidos cargados desde Supabase.");
      return;
    }

    if (localHasData) {
      await saveRemoteStateNow();
      remoteSyncStatus = "En linea";
      render(false);
      return;
    }

    remoteSyncStatus = "En linea";
    render(false);
  } catch {
    remoteSyncStatus = "Modo local";
    render(false);
  }
}

async function refreshRemoteState() {
  if (isSavingRemoteState || Date.now() - lastLocalEditAt < 1200) return;

  try {
    const remote = await fetchRemoteState();
    remoteSyncStatus = "En linea";

    if (!remote.state || !remote.updatedAt || remote.updatedAt === remoteUpdatedAt) {
      render(false);
      return;
    }

    applyRemoteState(remote.state, remote.updatedAt, "Datos actualizados desde otro dispositivo.");
  } catch {
    remoteSyncStatus = "Modo local";
    render(false);
  }
}

function applyRemoteState(remoteState, updatedAt, message) {
  isApplyingRemoteState = true;
  state = normalizeImportedState(remoteState);
  state.message = message;
  remoteUpdatedAt = updatedAt || remoteUpdatedAt;
  remoteSyncStatus = "En linea";
  syncTextarea();
  render();
  isApplyingRemoteState = false;
}

async function fetchRemoteState() {
  const response = await fetch(API_STATE_URL, {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error("No se pudo cargar el estado compartido.");
  }

  return response.json();
}

function queueRemoteSave() {
  if (isApplyingRemoteState) return;
  lastLocalEditAt = Date.now();
  remoteSyncStatus = "Guardando";
  window.clearTimeout(pendingRemoteSave);
  pendingRemoteSave = window.setTimeout(saveRemoteStateNow, REMOTE_SAVE_DELAY_MS);
}

async function saveRemoteStateNow() {
  if (isApplyingRemoteState) return;

  isSavingRemoteState = true;
  try {
    const response = await fetch(API_STATE_URL, {
      method: "PUT",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ state: buildPersistedState(state) }),
    });

    if (!response.ok) {
      throw new Error("No se pudo guardar el estado compartido.");
    }

    const saved = await response.json();
    remoteUpdatedAt = saved.updatedAt || remoteUpdatedAt;
    remoteSyncStatus = "Guardado";
  } catch {
    remoteSyncStatus = "Modo local";
  } finally {
    isSavingRemoteState = false;
    render(false);
  }
}

function renderGroups(groups) {
  if (!els.groupsContainer) return;
  if (!groups.length) {
    els.groupsContainer.innerHTML = `<div class="empty">Todavia no se generaron grupos. Abra esta pagina y pulse "Generar grupos".</div>`;
    return;
  }

  els.groupsContainer.innerHTML = groups
    .map((group) => {
      const standings = getStandings(group);
      const leader = standings[0]?.name || "Sin definir";
      const complete = group.matches.every((match) => match.winner);
      const played = group.matches.filter((match) => match.winner).length;
      const groupTheme = getGroupTheme(group.index);

      return `
        <article class="group-panel ${groupTheme.className}">
          <div class="group-header">
            <div class="group-title">
              <h3>Grupo ${group.name}</h3>
              <span class="badge">${groupTheme.name}</span>
              <span class="badge ${complete ? "leader" : ""}">${complete ? "Listo" : "En curso"}</span>
              <span class="badge">${renderTeamBadgeHtml(leader)}</span>
            </div>
            <div class="group-note">${played}/10 partidos</div>
          </div>

          <table class="standings-table">
            <thead>
              <tr>
                <th>Equipo</th>
                <th class="num">PJ</th>
                <th class="num">W</th>
                <th class="num">L</th>
              </tr>
            </thead>
            <tbody>
              ${standings
                .map(
                  (row, index) => `
                    <tr>
                      <td>${renderTeamCell(row.name, group, index === 0 && complete)}</td>
                      <td class="num">${row.played}</td>
                      <td class="num">${row.wins}</td>
                      <td class="num">${row.losses}</td>
                    </tr>
                  `
                )
                .join("")}
            </tbody>
          </table>

          <div class="matches-list">
            ${renderGroupFixture(group)}
          </div>
        </article>
      `;
    })
    .join("");

  els.groupsContainer.querySelectorAll("button[data-action]").forEach((button) => {
    button.addEventListener("click", onActionClick);
  });
}

function renderPlayoffs() {
  if (!els.playoffsContainer) return;
  if (!state.playoffs) {
    els.playoffsContainer.innerHTML = `<div class="empty">Todavia no se generaron los playoffs.</div>`;
    return;
  }

  const roundsHtml = state.playoffs.rounds
    .map((round, roundIndex) => {
      return `
        <article class="round-panel">
          <div class="round-header">
            <div class="round-title">
              <h3>${ROUND_NAMES[roundIndex]}</h3>
              <span class="badge">${round.matches.length} partidos</span>
            </div>
          </div>
          <div class="round-matches">
            ${round.matches
              .map((match, matchIndex) => {
                const team1 = resolveSource(match.source1);
                const team2 = resolveSource(match.source2);
                const canPlay = Boolean(team1 && team2);
                const winner = match.winner;
                const winner1 = winner && winner === team1;
                const winner2 = winner && winner === team2;
                return `
                  <div class="round-match">
                    <div class="team-row">
                      <span class="team-name">${team1 ? renderResolvedTeamHtml(team1) : "Esperando ganador"}</span>
                      <button
                        class="choice ${winner1 ? "selected" : ""}"
                        data-action="playoff-win"
                        data-round="${roundIndex}"
                        data-match="${matchIndex}"
                        data-team="${team1 ? escapeAttr(team1) : ""}"
                        ${canPlay ? "" : "disabled"}
                      >Gana</button>
                    </div>
                    <div class="team-row">
                      <span class="team-name">${team2 ? renderResolvedTeamHtml(team2) : "Esperando ganador"}</span>
                      <button
                        class="choice ${winner2 ? "selected" : ""}"
                        data-action="playoff-win"
                        data-round="${roundIndex}"
                        data-match="${matchIndex}"
                        data-team="${team2 ? escapeAttr(team2) : ""}"
                        ${canPlay ? "" : "disabled"}
                      >Gana</button>
                    </div>
                    <div class="match-actions">
                      <button data-action="clear-playoff" data-round="${roundIndex}" data-match="${matchIndex}">Quitar</button>
                    </div>
                    ${winner ? `<div class="winner-line">Clasifica: ${renderResolvedTeamHtml(winner)}</div>` : ""}
                  </div>
                `;
              })
              .join("")}
          </div>
        </article>
      `;
    })
    .join("");

  els.playoffsContainer.innerHTML = roundsHtml;
  els.playoffsContainer.querySelectorAll("button[data-action]").forEach((button) => {
    button.addEventListener("click", onActionClick);
  });
}

function renderGroupFixture(group) {
  return getFixtureRounds(group)
    .map(
      (round) => `
        <section class="fixture-round">
          <div class="fixture-round-head">
            <strong>Partido ${round.number}</strong>
            <span class="bye-badge">Libre: ${escapeHtml(round.bye || "Sin definir")}</span>
          </div>
          <div class="fixture-matches">
            ${round.matches
              .map(({ match, matchIndex }) => {
                const leftSelected = match.winner === match.home;
                const rightSelected = match.winner === match.away;
                return `
                  <div class="match-row">
                    <div class="match-teams">
                      <div class="team-row">
                        <span class="team-name">${renderGroupTeamHtml(group, match.home)}</span>
                        <div class="match-actions">
                          <button class="choice ${leftSelected ? "selected" : ""}" data-action="group-win" data-group="${group.index}" data-match="${matchIndex}" data-team="${escapeAttr(match.home)}">Gana</button>
                        </div>
                      </div>
                      <div class="team-row">
                        <span class="team-name">${renderGroupTeamHtml(group, match.away)}</span>
                        <div class="match-actions">
                          <button class="choice ${rightSelected ? "selected" : ""}" data-action="group-win" data-group="${group.index}" data-match="${matchIndex}" data-team="${escapeAttr(match.away)}">Gana</button>
                        </div>
                      </div>
                      <div class="match-meta">Partido ${matchIndex + 1}</div>
                    </div>
                    <div class="match-actions">
                      <button data-action="clear-group" data-group="${group.index}" data-match="${matchIndex}">Quitar</button>
                    </div>
                  </div>
                `;
              })
              .join("")}
          </div>
        </section>
      `
    )
    .join("");
}

function getFixtureRounds(group) {
  const roundCount = group.teams.length;
  const rounds = Array.from({ length: roundCount }, (_, index) => ({
    number: index + 1,
    bye: null,
    matches: [],
  }));

  group.matches.forEach((match, matchIndex) => {
    const roundIndex = Number.isInteger(match.round) ? match.round - 1 : Math.floor(matchIndex / 2);
    const safeRoundIndex = Math.max(0, Math.min(rounds.length - 1, roundIndex));
    rounds[safeRoundIndex].matches.push({ match, matchIndex });
  });

  rounds.forEach((round) => {
    const playing = new Set();
    round.matches.forEach(({ match }) => {
      playing.add(match.home);
      playing.add(match.away);
    });
    round.bye = group.teams.find((team) => !playing.has(team)) || null;
  });

  return rounds;
}

function getGroupTheme(groupIndex) {
  return GROUP_THEMES[Math.floor(groupIndex / 4)] || GROUP_THEMES[0];
}

function getTeamNumber(groupIndex, teamIndex) {
  return (groupIndex % 4) * 5 + teamIndex + 1;
}

function getTeamMetaFromGroup(groupIndex, teamName) {
  const group = state.groups?.[groupIndex];
  if (!group) return null;
  const teamIndex = (group.teams || []).findIndex((entry) => entry?.name === teamName);
  if (teamIndex < 0) return null;
  const theme = getGroupTheme(groupIndex);
  return {
    theme,
    label: `${theme.name} ${getTeamNumber(groupIndex, teamIndex)}`,
    teamName,
  };
}

function getTeamMetaByName(teamName) {
  for (const group of state.groups || []) {
    const teamIndex = (group.teams || []).findIndex((entry) => entry?.name === teamName);
    if (teamIndex < 0) continue;
    const theme = getGroupTheme(group.index);
    return {
      theme,
      label: `${theme.name} ${getTeamNumber(group.index, teamIndex)}`,
      teamName,
    };
  }
  return null;
}

function renderTeamBadgeHtml(teamName) {
  if (!teamName) return "";
  const meta = getTeamMetaByName(teamName);
  if (!meta) return escapeHtml(teamName);
  return `<span class="team-chip ${meta.theme.className}">${escapeHtml(meta.label)}</span>`;
}

function renderResolvedTeamHtml(teamName) {
  if (!teamName) return "";
  const meta = getTeamMetaByName(teamName);
  if (!meta) return escapeHtml(teamName);
  return `<span class="team-display"><span class="team-chip ${meta.theme.className}">${escapeHtml(meta.label)}</span><span class="team-display-name">${escapeHtml(teamName)}</span></span>`;
}

function renderGroupTeamHtml(group, teamName) {
  if (!teamName) return "";
  const meta = getTeamMetaFromGroup(group.index, teamName);
  if (!meta) return escapeHtml(teamName);
  return `<span class="team-display"><span class="team-chip ${meta.theme.className}">${escapeHtml(meta.label)}</span><span class="team-display-name">${escapeHtml(teamName)}</span></span>`;
}

function renderTeamCell(teamName, group, strong = false) {
  const content = renderGroupTeamHtml(group, teamName);
  return strong ? `<strong>${content}</strong>` : content;
}

function onActionClick(event) {
  const action = event.currentTarget.dataset.action;

  if (action === "group-win") {
    const groupIndex = Number(event.currentTarget.dataset.group);
    const matchIndex = Number(event.currentTarget.dataset.match);
    const team = event.currentTarget.dataset.team;
    setGroupWinner(groupIndex, matchIndex, team);
    return;
  }

  if (action === "clear-group") {
    const groupIndex = Number(event.currentTarget.dataset.group);
    const matchIndex = Number(event.currentTarget.dataset.match);
    clearGroupWinner(groupIndex, matchIndex);
    return;
  }

  if (action === "playoff-win") {
    const roundIndex = Number(event.currentTarget.dataset.round);
    const matchIndex = Number(event.currentTarget.dataset.match);
    const team = event.currentTarget.dataset.team;
    setPlayoffWinner(roundIndex, matchIndex, team);
    return;
  }

  if (action === "clear-playoff") {
    const roundIndex = Number(event.currentTarget.dataset.round);
    const matchIndex = Number(event.currentTarget.dataset.match);
    clearPlayoffWinner(roundIndex, matchIndex);
    return;
  }
}

function setGroupWinner(groupIndex, matchIndex, team) {
  const group = state.groups[groupIndex];
  if (!group) return;
  const match = group.matches[matchIndex];
  if (!match) return;
  match.winner = team;
  state.message = `Resultado guardado en Grupo ${group.name}.`;
  reconcilePlayoffs();
  saveState();
  render(false);
}

function clearGroupWinner(groupIndex, matchIndex) {
  const group = state.groups[groupIndex];
  if (!group) return;
  const match = group.matches[matchIndex];
  if (!match) return;
  match.winner = null;
  state.message = `Resultado quitado en Grupo ${group.name}.`;
  reconcilePlayoffs();
  saveState();
  render(false);
}

function setPlayoffWinner(roundIndex, matchIndex, team) {
  if (!state.playoffs) return;
  const match = state.playoffs.rounds?.[roundIndex]?.matches?.[matchIndex];
  if (!match) return;
  const team1 = resolveSource(match.source1);
  const team2 = resolveSource(match.source2);
  if (team !== team1 && team !== team2) return;
  match.winner = team;
  state.message = `Resultado guardado en ${ROUND_NAMES[roundIndex]}.`;
  reconcilePlayoffs();
  saveState();
  render(false);
}

function clearPlayoffWinner(roundIndex, matchIndex) {
  if (!state.playoffs) return;
  const match = state.playoffs.rounds?.[roundIndex]?.matches?.[matchIndex];
  if (!match) return;
  match.winner = null;
  state.message = `Resultado quitado en ${ROUND_NAMES[roundIndex]}.`;
  reconcilePlayoffs();
  saveState();
  render(false);
}

function simulateGroups() {
  if (!state.groups.length) {
    state.message = "Primero genere los grupos.";
    saveState();
    render();
    return;
  }

  state.groups.forEach((group) => {
    group.matches.forEach((match) => {
      if (match.home && match.away) {
        match.winner = Math.random() < 0.5 ? match.home : match.away;
      }
    });
  });

  reconcilePlayoffs();
  state.message = "Grupos simulados automaticamente.";
  saveState();
  render(false);
}

function simulatePlayoffs() {
  if (!state.playoffs) {
    state.message = "Primero cree los playoffs.";
    saveState();
    render();
    return;
  }

  for (let roundIndex = 0; roundIndex < state.playoffs.rounds.length; roundIndex += 1) {
    const round = state.playoffs.rounds[roundIndex];
    round.matches.forEach((match) => {
      const team1 = resolveSource(match.source1);
      const team2 = resolveSource(match.source2);
      if (!team1 || !team2) return;
      match.winner = Math.random() < 0.5 ? team1 : team2;
    });
  }

  reconcilePlayoffs();
  state.message = "Playoffs simulados automaticamente.";
  saveState();
  render(false);
}

function reconcilePlayoffs() {
  if (!state.playoffs) return;
  let changed = false;

  for (let roundIndex = 0; roundIndex < state.playoffs.rounds.length; roundIndex += 1) {
    const round = state.playoffs.rounds[roundIndex];
    round.matches.forEach((match) => {
      const team1 = resolveSource(match.source1);
      const team2 = resolveSource(match.source2);
      if (!team1 || !team2 || match.winner !== team1 && match.winner !== team2) {
        if (match.winner !== null) {
          match.winner = null;
          changed = true;
        }
      }
    });
  }

  if (changed) {
    state.message = "Los playoffs se reajustaron porque cambio un resultado anterior.";
  }
}

function resolveSource(source) {
  if (!source) return null;
  if (source.type === "groupWinner") {
    return getGroupWinners(state.groups)[source.groupIndex] || null;
  }
  if (source.type === "matchWinner") {
    return state.playoffs?.rounds?.[source.roundIndex]?.matches?.[source.matchIndex]?.winner || null;
  }
  return null;
}

function buildBalancedGroups(teams) {
  const roster = Array.isArray(teams) ? teams.filter((entry) => entry?.name) : [];
  const men = shuffleArray(roster.filter((entry) => entry.sex === "hombre"));
  const women = shuffleArray(roster.filter((entry) => entry.sex === "mujer"));
  const groupCount = GROUP_NAMES.length;
  const totalMen = men.length;
  const baseMenPerGroup = Math.floor(totalMen / groupCount);
  const extraMenGroups = totalMen % groupCount;
  const groupIndexes = shuffleArray(Array.from({ length: groupCount }, (_, index) => index));
  const menTargets = Array(groupCount).fill(baseMenPerGroup);

  groupIndexes.slice(0, extraMenGroups).forEach((groupIndex) => {
    menTargets[groupIndex] += 1;
  });

  return GROUP_NAMES.map((name, index) => {
    const menCount = menTargets[index];
    const womenCount = 5 - menCount;
    const groupTeams = shuffleArray([
      ...men.splice(0, menCount),
      ...women.splice(0, womenCount),
    ]);

    return {
      index,
      name,
      teams: groupTeams,
      matches: buildMatches(groupTeams.map((entry) => entry.name)),
    };
  });
}

function shuffleArray(items) {
  const next = [...items];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }
  return next;
}

function buildMatches(teams) {
  const matches = [];
  const rotation = [...teams, null];
  const rounds = rotation.length - 1;
  const half = rotation.length / 2;

  for (let round = 0; round < rounds; round += 1) {
    let slot = 0;
    for (let index = 0; index < half; index += 1) {
      const home = rotation[index];
      const away = rotation[rotation.length - 1 - index];
      if (home && away) {
        slot += 1;
        matches.push({
          home: round % 2 === 0 ? home : away,
          away: round % 2 === 0 ? away : home,
          round: round + 1,
          slot,
          winner: null,
        });
      }
    }

    const fixed = rotation[0];
    const rest = rotation.slice(1);
    rest.unshift(rest.pop());
    rotation.splice(0, rotation.length, fixed, ...rest);
  }

  return matches;
}

function getStandings(group) {
  const rows = new Map();
  group.teams.forEach((team) => {
    const name = typeof team === "string" ? team : String(team?.name || "").trim();
    if (!name) return;
    rows.set(name, {
      name,
      played: 0,
      wins: 0,
      losses: 0,
    });
  });

  group.matches.forEach((match) => {
    if (!match.winner) return;
    const winner = rows.get(match.winner);
    const loserName = match.winner === match.home ? match.away : match.home;
    const loser = rows.get(loserName);
    if (winner) {
      winner.played += 1;
      winner.wins += 1;
    }
    if (loser) {
      loser.played += 1;
      loser.losses += 1;
    }
  });

  return Array.from(rows.values()).sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    const direct = compareHeadToHead(a.name, b.name, group.matches);
    if (direct !== 0) return direct;
    return a.name.localeCompare(b.name);
  });
}

function compareHeadToHead(teamA, teamB, matches) {
  for (const match of matches) {
    const involvesA = match.home === teamA || match.away === teamA;
    const involvesB = match.home === teamB || match.away === teamB;
    if (!involvesA || !involvesB) continue;
    if (!match.winner) return 0;
    if (match.winner === teamA) return -1;
    if (match.winner === teamB) return 1;
  }
  return 0;
}

function getGroupWinners(groups) {
  return groups.map((group) => getStandings(group)[0]?.name || null);
}

function getGlobalStats(groups) {
  const played = groups.reduce(
    (total, group) => total + group.matches.filter((match) => match.winner).length,
    0
  );
  const finishedGroups = groups.reduce((total, group) => total + (group.matches.every((match) => match.winner) ? 1 : 0), 0);
  return { played, finishedGroups };
}

function allGroupMatchesComplete(groups) {
  return groups.length === 16 && groups.every((group) => group.matches.every((match) => match.winner));
}

function canCreatePlayoffs(groups) {
  if (groups.length !== 16) return false;
  if (!allGroupMatchesComplete(groups)) return false;
  return getGroupWinners(groups).every(Boolean);
}

function createPlayoffs(groupWinners) {
  const round16Pairs = [
    [0, 1],
    [2, 3],
    [4, 5],
    [6, 7],
    [8, 9],
    [10, 11],
    [12, 13],
    [14, 15],
  ];

  return {
    rounds: [
      {
        name: "Octavos",
        matches: round16Pairs.map((pair) => ({
          source1: { type: "groupWinner", groupIndex: pair[0] },
          source2: { type: "groupWinner", groupIndex: pair[1] },
          winner: null,
        })),
      },
      {
        name: "Cuartos",
        matches: Array.from({ length: 4 }, (_, index) => ({
          source1: { type: "matchWinner", roundIndex: 0, matchIndex: index * 2 },
          source2: { type: "matchWinner", roundIndex: 0, matchIndex: index * 2 + 1 },
          winner: null,
        })),
      },
      {
        name: "Semifinales",
        matches: Array.from({ length: 2 }, (_, index) => ({
          source1: { type: "matchWinner", roundIndex: 1, matchIndex: index * 2 },
          source2: { type: "matchWinner", roundIndex: 1, matchIndex: index * 2 + 1 },
          winner: null,
        })),
      },
      {
        name: "Final",
        matches: [
          {
            source1: { type: "matchWinner", roundIndex: 2, matchIndex: 0 },
            source2: { type: "matchWinner", roundIndex: 2, matchIndex: 1 },
            winner: null,
          },
        ],
      },
    ],
    seededAt: Date.now(),
  };
}

function buildDemoTeams() {
  return Array.from({ length: 80 }, (_, index) => ({
    name: `Equipo ${String(index + 1).padStart(2, "0")}`,
    sex: index % 2 === 0 ? "hombre" : "mujer",
  }));
}

function parseTeams(value) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function pill(text) {
  return `<span class="pill">${escapeHtml(text)}</span>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}

function normalizeImportedState(parsed) {
  const next = defaultState();
  next.teamsText = typeof parsed?.teamsText === "string" ? parsed.teamsText : "";
  next.teamsData = Array.isArray(parsed?.teamsData) && parsed.teamsData.length
    ? parsed.teamsData
        .map((entry) => ({
          name: String(entry?.name || "").trim(),
          sex: normalizeSex(entry?.sex),
        }))
        .filter((entry) => entry.name)
    : createRosterFromNames(parseTeams(next.teamsText), []);
  next.groups = Array.isArray(parsed?.groups) ? parsed.groups : [];
  next.playoffs = parsed?.playoffs && Array.isArray(parsed.playoffs.rounds) ? parsed.playoffs : null;
  if (next.groups.length && next.groups.length !== 16) {
    next.groups = [];
  }
  if (next.groups.length) {
    next.groups = next.groups.map((group, index) => ({
      index,
      name: GROUP_NAMES[index],
      teams: Array.isArray(group.teams)
        ? group.teams
            .slice(0, 5)
            .map((team) =>
              typeof team === "string"
                ? { name: team, sex: "" }
                : {
                    name: String(team?.name || "").trim(),
                    sex: normalizeSex(team?.sex),
                  }
            )
            .filter((team) => team.name)
        : [],
      matches: Array.isArray(group.matches)
        ? group.matches.map((match) => ({
            home: String(match.home || ""),
            away: String(match.away || ""),
            round: Number.isInteger(match.round) ? match.round : undefined,
            slot: Number.isInteger(match.slot) ? match.slot : undefined,
            winner: match.winner || null,
          }))
        : buildMatches([]),
    }));
  }
  return next;
}

function hasTournamentData(value) {
  return Boolean(
    (Array.isArray(value?.teamsData) ? value.teamsData.length : parseTeams(value?.teamsText || "").length) ||
      value?.groups?.length ||
      value?.playoffs
  );
}

function buildPersistedState(value) {
  return {
    teamsText: value.teamsText || "",
    teamsData: Array.isArray(value.teamsData) ? value.teamsData : [],
    groups: Array.isArray(value.groups) ? value.groups : [],
    playoffs: value.playoffs || null,
    message: value.message || "",
  };
}

function loadLocalState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const next = defaultState();
      next.teamsData = createRosterFromNames(parseTeams(next.teamsText), []);
      return next;
    }
    const next = normalizeImportedState(JSON.parse(raw));
    if (!next.teamsData.length && next.teamsText) {
      next.teamsData = createRosterFromNames(parseTeams(next.teamsText), []);
    }
    return next;
  } catch {
    const next = defaultState();
    next.teamsData = createRosterFromNames(parseTeams(next.teamsText), []);
    return next;
  }
}

function saveState() {
  saveLocalState();
  queueRemoteSave();
}

function saveLocalState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(buildPersistedState(state)));
  } catch {
    // ignore storage failures
  }
}
