#!/usr/bin/env node
// cli.js

import readline from "node:readline"
import {
  fetchTeams,
  fetchTeamSeasonStats,
  fetchRosterWithStats,
  fetchPlayerStats,
  searchPlayer,
} from "./api.js"
import {
  computeDeltaGFpg,
  computeDeltaGApg,
  runMonteCarlo,
} from "./sim.js"

const MODEL = {
  assistGoalFactor: { ev: 0.65, pp: 0.70, sh: 0.55 },
  usageFactor:      { ev: 0.62, pp: 0.72, sh: 0.55 },
}
const SIMULATION = { sims: 7000, seed: 20000 }
const OTL_CHANCE = 0.24

const rl = readline.createInterface({
  input:  process.stdin,
  output: process.stdout,
})

function ask(question) {
  return new Promise(resolve => rl.question(question, resolve))
}

function askNumber(question, { min, max, allowDecimal = true } = {}) {
  return new Promise(async resolve => {
    while (true) {
      const raw = await ask(question)
      const n = allowDecimal ? parseFloat(raw) : parseInt(raw, 10)
      if (isNaN(n)) { console.log("  → Skriv inn et tall."); continue }
      if (min !== undefined && n < min) { console.log(`  → Minimum er ${min}.`); continue }
      if (max !== undefined && n > max) { console.log(`  → Maksimum er ${max}.`); continue }
      resolve(n)
      return
    }
  })
}

function askChoice(question, choices) {
  return new Promise(async resolve => {
    while (true) {
      const raw = await ask(question)
      const idx = parseInt(raw, 10) - 1
      if (idx >= 0 && idx < choices.length) {
        resolve(choices[idx])
        return
      }
      console.log(`  → Velg et tall mellom 1 og ${choices.length}.`)
    }
  })
}

function header(text) {
  const line = "─".repeat(text.length + 4)
  console.log(`\n┌${line}┐`)
  console.log(`│  ${text}  │`)
  console.log(`└${line}┘`)
}

function divider() {
  console.log("\n" + "─".repeat(62))
}

// Konverter desimalminutter til MM:SS
function toMMSS(min) {
  const m = Math.floor(min)
  const s = Math.round((min - m) * 60)
  return `${m}:${String(s).padStart(2, "0")}`
}

async function promptPlayerManual() {
  header("Skriv inn statistikk for ny spiller")

  const name = await ask("  Navn: ")
  const gp   = await askNumber("  Kamper spilt (GP): ", { min: 1, max: 82, allowDecimal: false })

  console.log("\n  EV (Even Strength):")
  const ev_g = await askNumber("    Mål:     ", { min: 0 })
  const ev_a = await askNumber("    Assists: ", { min: 0 })

  console.log("\n  PP (Power Play):")
  const pp_g = await askNumber("    Mål:     ", { min: 0 })
  const pp_a = await askNumber("    Assists: ", { min: 0 })

  console.log("\n  SH (Short Handed):")
  const sh_g = await askNumber("    Mål:     ", { min: 0 })
  const sh_a = await askNumber("    Assists: ", { min: 0 })

  console.log("\n  Istid (snitt per kamp):")
  const total_min = await askNumber("    Total TOI (MM:SS som desimal, f.eks. 18.5): ", { min: 0, max: 30 })
  const pp_min    = await askNumber("    PP TOI:                                      ", { min: 0, max: 10 })
  const pk_min    = await askNumber("    PK TOI:                                      ", { min: 0, max: 10 })

  return {
    name, gp,
    splits: {
      ev: { g: ev_g, a: ev_a },
      pp: { g: pp_g, a: pp_a },
      sh: { g: sh_g, a: sh_a },
    },
    shots: 0,
    toi: { total_min, pp_min, pk_min },
    defense: { ev_ga_reduction_per60: 0.08, pk_ga_reduction_per60: 0.06 },
  }
}

async function pickSeason() {
  header("Velg sesong")
  console.log("  Format: startår (f.eks. 2014 for 2014-15)")
  const year = await askNumber("  Startår: ", { min: 1990, max: 2024, allowDecimal: false })
  return `${year}${year + 1}`
}

async function pickTeam() {
  header("Velg lag")
  const teams = fetchTeams()
  teams.sort((a, b) => a.fullName.localeCompare(b.fullName))
  teams.forEach((t, i) =>
    console.log(`  ${String(i + 1).padStart(2)}) ${t.abbrev.padEnd(4)} ${t.fullName}`)
  )
  return askChoice("\n  Velg lag (nummer): ", teams)
}

async function pickPlayerToRemove(teamAbbrev, seasonId) {
  header("Velg spiller som fjernes")
  console.log("  Henter roster og statistikk...")

  const roster = await fetchRosterWithStats(teamAbbrev, seasonId)
  const skaters = roster.filter(p => p.stats !== null)
  skaters.sort((a, b) => (b.stats?.points ?? 0) - (a.stats?.points ?? 0))

  // Kolonneoverskrift
  console.log()
  console.log(
    "  Nr".padEnd(5) +
    "Pos".padEnd(5) +
    "Skyting".padEnd(9) +
    "Navn".padEnd(22) +
    "GP".padStart(4) +
    "G".padStart(4) +
    "A".padStart(4) +
    "Pts".padStart(5) +
    "EV G+A".padStart(8) +
    "PP G+A".padStart(8) +
    "SH G+A".padStart(8) +
    "TOI".padStart(7)
  )
  console.log("  " + "─".repeat(84))

  skaters.forEach((p, i) => {
    const s = p.stats
    const toi = toMMSS(s.toi.total_min)
    const ev  = `${s.splits.ev.g}+${s.splits.ev.a}`
    const pp  = `${s.splits.pp.g}+${s.splits.pp.a}`
    const sh  = `${s.splits.sh.g}+${s.splits.sh.a}`

    console.log(
      `  ${String(i + 1).padStart(2)}) ` +
      p.position.padEnd(5) +
      p.shoots.padEnd(9) +
      p.name.padEnd(22) +
      String(s.gp).padStart(4) +
      String(s.goals).padStart(4) +
      String(s.assists).padStart(4) +
      String(s.points).padStart(5) +
      ev.padStart(8) +
      pp.padStart(8) +
      sh.padStart(8) +
      toi.padStart(7)
    )
  })

  const player = await askChoice("\n  Velg spiller (nummer): ", skaters)

  // Bygg spillerobjekt klart for sim.js
  const s = player.stats
  return {
    name:     player.name,
    position: player.position,
    gp:       s.gp,
    splits:   s.splits,
    shots:    0,
    toi:      s.toi,
    defense:  s.defense,
  }
}

async function pickNewPlayer(seasonId) {
  header("Legg til ny spiller")
  console.log("  1) Søk på ekte NHL-spiller (stats hentes automatisk)")
  console.log("  2) Skriv inn manuelt (fantasispiller, historisk spiller)")
  const choice = await askChoice("\n  Valg: ", [1, 2])

  if (choice === 2) return promptPlayerManual()

  const query = await ask("  Søk etter navn: ")
  console.log("  Søker...")
  const results = await searchPlayer(query)

  if (!results.length) {
    console.log("  Ingen treff — prøv manuell inndata.")
    return promptPlayerManual()
  }

  results.slice(0, 10).forEach((p, i) =>
    console.log(`  ${i + 1}) ${p.name} (${p.pos}, ${p.team})`)
  )
  const picked = await askChoice("\n  Velg spiller: ", results.slice(0, 10))

  console.log(`  Henter statistikk for ${picked.name} (sesong ${seasonId})...`)
  try {
    const stats = await fetchPlayerStats(picked.id, seasonId)
    console.log(`  ✓ ${stats.gp} kamper — ${stats.splits.ev.g + stats.splits.pp.g + stats.splits.sh.g} mål, ${stats.splits.ev.a + stats.splits.pp.a + stats.splits.sh.a} assists`)
    return stats
  } catch (e) {
    console.log(`  ⚠ ${e.message} — prøver manuell inndata.`)
    return promptPlayerManual()
  }
}

function printResult({ team, season, replaced, star, deltaGF, deltaGA, result }) {
  const seasonLabel = `${season.slice(0, 4)}-${season.slice(6)}`
  divider()
  header(`Resultater — ${team.fullName} ${seasonLabel}`)

  console.log(`\n  Spiller fjernet:  ${replaced.name}`)
  console.log(`  Spiller lagt til: ${star.name}`)

  divider()
  console.log("  OFFENSIV EFFEKT")
  console.log(`    Delta GF/kamp:  ${deltaGF >= 0 ? "+" : ""}${deltaGF.toFixed(3)}`)
  console.log("\n  DEFENSIV EFFEKT")
  console.log(`    Delta GA/kamp:  ${deltaGA >= 0 ? "+" : ""}${deltaGA.toFixed(3)}`)

  divider()
  console.log("  SESONGPROGNOSE (Monte Carlo, 7 000 simuleringer)")
  console.log(`\n    Baseline:`)
  console.log(`      Forventede poeng: ${result.baselineMean.toFixed(1)} ± ${result.baselineStd.toFixed(1)}`)
  console.log(`\n    Med ${star.name}:`)
  console.log(`      Forventede poeng: ${result.withPlayerMean.toFixed(1)} ± ${result.withPlayerStd.toFixed(1)}`)

  const arrow = result.deltaMeanPts >= 0 ? "▲" : "▼"
  console.log(`\n    ${arrow} Poengendring:  ${result.deltaMeanPts >= 0 ? "+" : ""}${result.deltaMeanPts.toFixed(1)} poeng`)
  console.log(`    Sannsynlighet for forbedring: ${(result.pImprove * 100).toFixed(1)}%`)
  divider()
}

async function main() {
  console.log("\n╔════════════════════════════════════════╗")
  console.log("║   NHL What-If Simulator — Interaktiv   ║")
  console.log("╚════════════════════════════════════════╝")
  console.log("  Simuler hva som hadde skjedd hvis et lag")
  console.log("  hadde hatt en annen spiller i en historisk sesong.\n")

  let running = true
  while (running) {
    try {
      const season = await pickSeason()
      const team   = await pickTeam()

      header(`Henter sesongdata for ${team.fullName}`)
      console.log(`  Sesong: ${season.slice(0, 4)}-${season.slice(6)}`)
      let baseline
      try {
        baseline = await fetchTeamSeasonStats(team.abbrev, season)
        console.log(`  ✓ GF: ${baseline.gf_total}, GA: ${baseline.ga_total}, GP: ${baseline.gp}`)
      } catch (e) {
        console.log(`  ⚠ ${e.message}`)
        console.log("  Skriv inn manuelt:")
        const gf = await askNumber("  Totale mål for (GF): ", { min: 1 })
        const ga = await askNumber("  Totale mål mot (GA): ", { min: 1 })
        const gp = await askNumber("  Kamper spilt (GP):   ", { min: 1, max: 82, allowDecimal: false })
        baseline = { gf_total: gf, ga_total: ga, gp }
      }

      const games = baseline.gp
      const gf_pg = baseline.gf_total / games
      const ga_pg = baseline.ga_total / games

      const replaced = await pickPlayerToRemove(team.abbrev, season)
      const star     = await pickNewPlayer(season)
      const deltaGF  = computeDeltaGFpg(star, replaced, MODEL)
      const deltaGA  = computeDeltaGApg(star, replaced)

      header("Simulerer...")
      console.log("  Kjører 7 000 Monte Carlo-simuleringer...")

      const result = runMonteCarlo({
        sims:             SIMULATION.sims,
        games,
        baselineParams:   { gf_pg, ga_pg, otlChanceGivenOneGoalLoss: OTL_CHANCE },
        withPlayerParams: { gf_pg: gf_pg + deltaGF, ga_pg: ga_pg + deltaGA, otlChanceGivenOneGoalLoss: OTL_CHANCE },
        seedBase:         SIMULATION.seed,
      })

      printResult({ team, season, replaced, star, deltaGF, deltaGA, result })

    } catch (e) {
      if (e.message?.includes("readline")) break
      console.error(`\n  ✗ Feil: ${e.message}`)
    }

    const ans = await ask("\n  Kjør en ny simulering? (j/n): ")
    running = ans.trim().toLowerCase() === "j"
  }

  console.log("\n  Ha det!\n")
  rl.close()
}

main().catch(e => {
  console.error(e)
  rl.close()
  process.exit(1)
})
