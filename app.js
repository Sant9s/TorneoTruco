const STORAGE_KEY = "torneo-admin-state-v1";
const GROUP_NAMES = "ABCDEFGHIJKLMNOP".split("");
const ROUND_NAMES = ["Octavos", "Cuartos", "Semifinales", "Final"];
const PAGE = document.body.dataset.page || "teams";

const els = {};

const defaultState = () => ({
  teamsText: "",
  groups: [],
  playoffs: null,
  message: "Pegue 80 equipos para arrancar.",
});

let state = loadState();

document.addEventListener("DOMContentLoaded", () => {
  cacheElements();
  bindEvents();
  syncTextarea();
  render();
});

function cacheElements() {
  const ids = [
    "teamsInput",
    "fillDemoBtn",
    "loadTeamsBtn",
    "generateGroupsBtn",
    "createPlayoffsBtn",
    "resetBtn",
    "exportBtn",
    "importInput",
    "groupsContainer",
    "playoffsContainer",
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
    state.teamsText = buildDemoTeams();
    state.message = "Demo cargado con 80 equipos.";
    saveState();
    syncTextarea();
    render();
  });

  els.loadTeamsBtn?.addEventListener("click", () => {
    const teams = parseTeams(els.teamsInput.value);
    if (teams.length !== 80) {
      state.message = `Se necesitan 80 equipos. Ahora hay ${teams.length}.`;
      saveState();
      render();
      return;
    }
    state.teamsText = teams.join("\n");
    state.groups = [];
    state.playoffs = null;
    state.message = "Equipos guardados. Entre a Grupos y pulse Generar grupos.";
    saveState();
    render();
  });

  els.generateGroupsBtn?.addEventListener("click", () => {
    const teams = parseTeams(state.teamsText);
    if (teams.length !== 80) {
      state.message = "Primero cargue exactamente 80 equipos.";
      saveState();
      render();
      return;
    }
    state.groups = buildGroups(shuffleArray(teams));
    state.playoffs = null;
    state.message = "Grupos generados aleatoriamente.";
    saveState();
    render();
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
    state.teamsText = els.teamsInput.value;
    if (hadGeneratedData) {
      state.groups = [];
      state.playoffs = null;
      state.message = "Se modifico la lista. Vuelva a generar los grupos.";
    }
    saveState();
    render(false);
  });
}

function syncTextarea() {
  if (els.teamsInput) {
    els.teamsInput.value = state.teamsText || "";
  }
}

function render(reconcile = true) {
  if (reconcile) reconcilePlayoffs();
  const teams = parseTeams(state.teamsText);
  const loadedGroups = state.groups;
  const groupStats = getGlobalStats(loadedGroups);

  if (els.messageBox) {
    els.messageBox.textContent = state.message || "";
  }
  if (els.topbarStats) {
    els.topbarStats.innerHTML = [
      pill(`${teams.length}/80 equipos`),
      pill(`${loadedGroups.length}/16 grupos`),
      pill(`${groupStats.played}/160 partidos jugados`),
      pill(`${groupStats.finishedGroups}/16 grupos completos`),
    ].join("");
  }
  if (els.teamsSummary) {
    els.teamsSummary.textContent = teams.length
      ? `Total de equipos: ${teams.length}.`
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

  renderGroups(loadedGroups);
  renderPlayoffs();
  saveState();
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

      return `
        <article class="group-panel">
          <div class="group-header">
            <div class="group-title">
              <h3>Grupo ${group.name}</h3>
              <span class="badge ${complete ? "leader" : ""}">${complete ? "Listo" : "En curso"}</span>
              <span class="badge">${leader}</span>
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
                      <td>${index === 0 && complete ? `<strong>${escapeHtml(row.name)}</strong>` : escapeHtml(row.name)}</td>
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
            ${group.matches
              .map((match, matchIndex) => {
                const leftSelected = match.winner === match.home;
                const rightSelected = match.winner === match.away;
                return `
                  <div class="match-row">
                    <div class="match-teams">
                      <div class="team-row">
                        <span class="team-name">${escapeHtml(match.home)}</span>
                        <div class="match-actions">
                          <button class="choice ${leftSelected ? "selected" : ""}" data-action="group-win" data-group="${group.index}" data-match="${matchIndex}" data-team="${escapeAttr(match.home)}">Gana</button>
                        </div>
                      </div>
                      <div class="team-row">
                        <span class="team-name">${escapeHtml(match.away)}</span>
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
                      <span class="team-name">${team1 ? escapeHtml(team1) : "Esperando ganador"}</span>
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
                      <span class="team-name">${team2 ? escapeHtml(team2) : "Esperando ganador"}</span>
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
                    ${winner ? `<div class="winner-line">Clasifica: ${escapeHtml(winner)}</div>` : ""}
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

function buildGroups(teams) {
  return GROUP_NAMES.map((name, index) => {
    const groupTeams = teams.slice(index * 5, index * 5 + 5);
    return {
      index,
      name,
      teams: groupTeams,
      matches: buildMatches(groupTeams),
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
  for (let i = 0; i < teams.length; i += 1) {
    for (let j = i + 1; j < teams.length; j += 1) {
      matches.push({
        home: teams[i],
        away: teams[j],
        winner: null,
      });
    }
  }
  return matches;
}

function getStandings(group) {
  const rows = new Map();
  group.teams.forEach((team) => {
    rows.set(team, {
      name: team,
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
  return Array.from({ length: 80 }, (_, index) => `Equipo ${String(index + 1).padStart(2, "0")}`).join("\n");
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
  next.groups = Array.isArray(parsed?.groups) ? parsed.groups : [];
  next.playoffs = parsed?.playoffs && Array.isArray(parsed.playoffs.rounds) ? parsed.playoffs : null;
  if (next.groups.length && next.groups.length !== 16) {
    next.groups = [];
  }
  if (next.groups.length) {
    next.groups = next.groups.map((group, index) => ({
      index,
      name: GROUP_NAMES[index],
      teams: Array.isArray(group.teams) ? group.teams.slice(0, 5) : [],
      matches: Array.isArray(group.matches)
        ? group.matches.map((match) => ({
            home: String(match.home || ""),
            away: String(match.away || ""),
            winner: match.winner || null,
          }))
        : buildMatches([]),
    }));
  }
  return next;
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    return normalizeImportedState(JSON.parse(raw));
  } catch {
    return defaultState();
  }
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore storage failures
  }
}

