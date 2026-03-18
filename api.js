// api.js

const STATS_BASE = "https://api.nhle.com/stats/rest/en"
const WEB_BASE   = "https://api-web.nhle.com/v1"

async function get(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`NHL API feil (${res.status}): ${url}`)
  return res.json()
}

const TEAMS = [
  { abbrev: "ANA", fullName: "Anaheim Ducks" },
  { abbrev: "BOS", fullName: "Boston Bruins" },
  { abbrev: "BUF", fullName: "Buffalo Sabres" },
  { abbrev: "CAR", fullName: "Carolina Hurricanes" },
  { abbrev: "CBJ", fullName: "Columbus Blue Jackets" },
  { abbrev: "CGY", fullName: "Calgary Flames" },
  { abbrev: "CHI", fullName: "Chicago Blackhawks" },
  { abbrev: "COL", fullName: "Colorado Avalanche" },
  { abbrev: "DAL", fullName: "Dallas Stars" },
  { abbrev: "DET", fullName: "Detroit Red Wings" },
  { abbrev: "EDM", fullName: "Edmonton Oilers" },
  { abbrev: "FLA", fullName: "Florida Panthers" },
  { abbrev: "LAK", fullName: "Los Angeles Kings" },
  { abbrev: "MIN", fullName: "Minnesota Wild" },
  { abbrev: "MTL", fullName: "Montréal Canadiens" },
  { abbrev: "NJD", fullName: "New Jersey Devils" },
  { abbrev: "NSH", fullName: "Nashville Predators" },
  { abbrev: "NYI", fullName: "New York Islanders" },
  { abbrev: "NYR", fullName: "New York Rangers" },
  { abbrev: "OTT", fullName: "Ottawa Senators" },
  { abbrev: "PHI", fullName: "Philadelphia Flyers" },
  { abbrev: "PIT", fullName: "Pittsburgh Penguins" },
  { abbrev: "SEA", fullName: "Seattle Kraken" },
  { abbrev: "SJS", fullName: "San Jose Sharks" },
  { abbrev: "STL", fullName: "St. Louis Blues" },
  { abbrev: "TBL", fullName: "Tampa Bay Lightning" },
  { abbrev: "TOR", fullName: "Toronto Maple Leafs" },
  { abbrev: "UTA", fullName: "Utah Hockey Club" },
  { abbrev: "VAN", fullName: "Vancouver Canucks" },
  { abbrev: "VGK", fullName: "Vegas Golden Knights" },
  { abbrev: "WPG", fullName: "Winnipeg Jets" },
  { abbrev: "WSH", fullName: "Washington Capitals" },
]

// Mapper posisjonskode til lesbar posisjon
// Roster-endepunktet gir LW/RW/C/D/G, stats-endepunktet gir L/R/C/D/G
function formatPosition(code) {
  const map = { L: "LW", R: "RW", C: "C", D: "D", G: "G",
                LW: "LW", RW: "RW" }
  return map[code] ?? code
}

export function fetchTeams() {
  return TEAMS
}

export async function fetchTeamSeasonStats(teamAbbrev, seasonId) {
  const team = TEAMS.find(t => t.abbrev === teamAbbrev)
  if (!team) throw new Error(`Ukjent lagforkortelse: ${teamAbbrev}`)

  const url =
    `${STATS_BASE}/team/summary` +
    `?cayenneExp=seasonId=${seasonId}%20and%20gameTypeId=2` +
    `&sort=goalsFor&limit=100`
  const data = await get(url)
  const row = (data.data ?? []).find(t => t.teamFullName === team.fullName)
  if (!row) throw new Error(
    `Fant ikke ${team.fullName} i sesong ${seasonId}. Sjekk at sesongen finnes.`
  )
  return {
    gf_total: row.goalsFor,
    ga_total: row.goalsAgainst,
    gp:       row.gamesPlayed,
  }
}

// Henter roster med stats — filtrerer stats direkte på lag for å få alle spillere
export async function fetchRosterWithStats(teamAbbrev, seasonId) {

  // Hent roster for shootsCatches og fulle posisjoner (LW/RW/C/D)
  const rosterData = await get(`${WEB_BASE}/roster/${teamAbbrev}/${seasonId}`)
  const rosterMap = {}
  for (const p of [
    ...(rosterData.forwards   ?? []),
    ...(rosterData.defensemen ?? []),
  ]) {
    rosterMap[p.id] = {
      shoots:   p.shootsCatches,
      position: p.positionCode,  // LW, RW, C, D fra roster
    }
  }

  // Hent stats filtrert på lag og sesong
  const statsUrl =
    `${STATS_BASE}/skater/summary` +
    `?cayenneExp=seasonId=${seasonId}%20and%20gameTypeId=2%20and%20teamAbbrevs=%22${teamAbbrev}%22` +
    `&sort=points&limit=100`
  const statsData = await get(statsUrl)
// ev = even strength (5v5) altså mål eller assist scoret med like mange mann på isen, 
// pp = power play altså mål eller assist scoret i overtallsspill når en spiller fra det andre
// laget har blitt utvist og et lag har fordel av flere spiller på isen, 
// sh = short handed, altså mål eller assist score for laget som har en spiller utvist altså
// i undertallsspill
// g = mål, a = assists — ev beregnes som total minus pp og sh
  return (statsData.data ?? []).map(s => {
    const rosterInfo = rosterMap[s.playerId] ?? {}
    const ev_g = s.evGoals ?? 0
    const pp_g = s.ppGoals ?? 0
    const sh_g = s.shGoals ?? 0
    const ev_a = (s.evPoints ?? 0) - ev_g
    const pp_a = (s.ppPoints ?? 0) - pp_g
    const sh_a = (s.shPoints ?? 0) - sh_g
    const toi_min = (s.timeOnIcePerGame ?? 0) / 60

    return {
      id:       s.playerId,
      name:     s.skaterFullName,
      // Foretrekker posisjon fra roster (LW/RW), faller tilbake på stats (L/R)
      position: formatPosition(rosterInfo.position ?? s.positionCode),
      shoots:   rosterInfo.shoots ?? s.shootsCatches ?? "?",
      stats: {
        gp:      s.gamesPlayed ?? 0,
        goals:   s.goals ?? 0,
        assists: s.assists ?? 0,
        points:  s.points ?? 0,
        splits: {
          ev: { g: ev_g, a: Math.max(0, ev_a) },
          pp: { g: pp_g, a: Math.max(0, pp_a) },
          sh: { g: sh_g, a: Math.max(0, sh_a) },
        },
        toi: {
          total_min: toi_min,
          pp_min:    toi_min * 0.15,
          pk_min:    toi_min * 0.05,
        },
        defense: {
          ev_ga_reduction_per60: 0.08,
          pk_ga_reduction_per60: 0.06,
        },
      },
    }
  })
}

export async function fetchPlayerStats(playerId, seasonId) {
  const url =
    `${STATS_BASE}/skater/summary` +
    `?cayenneExp=playerId=${playerId}%20and%20seasonId=${seasonId}%20and%20gameTypeId=2`
  const data = await get(url)
  const p = (data.data ?? [])[0]

  if (!p) throw new Error(`Fant ikke statistikk for spiller ${playerId} i sesong ${seasonId}.`)

  const ev_g = p.evGoals ?? 0
  const pp_g = p.ppGoals ?? 0
  const sh_g = p.shGoals ?? 0
  const ev_a = (p.evPoints ?? 0) - ev_g
  const pp_a = (p.ppPoints ?? 0) - pp_g
  const sh_a = (p.shPoints ?? 0) - sh_g
  const toi_min = (p.timeOnIcePerGame ?? 0) / 60

  return {
    name:     p.skaterFullName ?? `Spiller ${playerId}`,
    position: formatPosition(p.positionCode ?? "F"),
    gp:       p.gamesPlayed ?? 1,
    splits: {
      ev: { g: ev_g, a: Math.max(0, ev_a) },
      pp: { g: pp_g, a: Math.max(0, pp_a) },
      sh: { g: sh_g, a: Math.max(0, sh_a) },
    },
    shots: p.shots ?? 0,
    toi: {
      total_min: toi_min,
      pp_min:    toi_min * 0.15,
      pk_min:    toi_min * 0.05,
    },
    defense: {
      ev_ga_reduction_per60: 0.08,
      pk_ga_reduction_per60: 0.06,
    },
  }
}

export async function searchPlayer(query) {
  const data = await get(`${WEB_BASE}/player-search/?q=${encodeURIComponent(query)}&culture=en-us`)
  return (data.players ?? []).map(p => ({
    id:   p.playerId,
    name: `${p.firstName} ${p.lastName}`,
    team: p.currentTeamAbbrev ?? "–",
    pos:  p.positionCode ?? "?",
  }))
}
