// sim.js

export function mulberry32(seed) {
  let t = seed >>> 0
  return function () {
    t += 0x6D2B79F5
    let x = Math.imul(t ^ (t >>> 15), 1 | t)
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x)
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
}

export function poisson(lambda, rng) {
  const l = Math.max(0.01, lambda)
  const L = Math.exp(-l)
  let k = 0
  let p = 1
  do {
    k++
    p *= rng()
  } while (p > L)
  return k - 1
}

export function simulateSeason({ games, gf_pg, ga_pg, otlChanceGivenOneGoalLoss, seed }) {
  const rng = mulberry32(seed)
  let pts = 0, w = 0, l = 0, otl = 0, gf = 0, ga = 0

  for (let i = 0; i < games; i++) {
    const f = poisson(gf_pg, rng)
    const a = poisson(ga_pg, rng)
    gf += f
    ga += a

    if (f > a) { w++; pts += 2; continue }

    if (f < a) {
      if ((a - f) === 1 && rng() < otlChanceGivenOneGoalLoss) {
        otl++; pts += 1
      } else {
        l++
      }
      continue
    }

    // uavgjort etter normal spilletid
    if (rng() < 0.5) { w++; pts += 2 }
    else             { otl++; pts += 1 }
  }

  return { pts, w, l, otl, gf, ga }
}

function ratePerGame(p) {
  const gp = p.gp
  const { ev, pp, sh } = p.splits
  return {
    ev_gpg: ev.g / gp, ev_apg: ev.a / gp,
    pp_gpg: pp.g / gp, pp_apg: pp.a / gp,
    sh_gpg: sh.g / gp, sh_apg: sh.a / gp,
  }
}


// s = ny spiller (star), r = spiller som fjernes (replaced)
// a = hvor mange assists indirekte bidrar til mål
// u = vekting for å justere for rolleforskjeller mellom spillerne
export function computeDeltaGFpg(star, replaced, model) {
  const s = ratePerGame(star)
  const r = ratePerGame(replaced)
  const { assistGoalFactor: a, usageFactor: u } = model

  return (
    u.ev * ((s.ev_gpg - r.ev_gpg) + a.ev * (s.ev_apg - r.ev_apg)) +
    u.pp * ((s.pp_gpg - r.pp_gpg) + a.pp * (s.pp_apg - r.pp_apg)) +
    u.sh * ((s.sh_gpg - r.sh_gpg) + a.sh * (s.sh_apg - r.sh_apg))
  )
}

export function computeDeltaGApg(star, replaced) {
  const st = star.toi
  const rt = replaced.toi

  const starEV = Math.max(0, st.total_min - st.pp_min - st.pk_min)
  const replEV = Math.max(0, rt.total_min - rt.pp_min - rt.pk_min)

  const starGAred = star.defense.ev_ga_reduction_per60 * (starEV / 60)
    + star.defense.pk_ga_reduction_per60 * (st.pk_min / 60)
  const replGAred = replaced.defense.ev_ga_reduction_per60 * (replEV / 60)
    + replaced.defense.pk_ga_reduction_per60 * (rt.pk_min / 60)

  return -(starGAred - replGAred)
}

export function runMonteCarlo({ sims, games, baselineParams, withPlayerParams, seedBase }) {
  const base = { ...baselineParams, ga_pg: Math.max(0.1, baselineParams.ga_pg) }
  const alt  = { ...withPlayerParams, ga_pg: Math.max(0.1, withPlayerParams.ga_pg) }

  const basePts = []
  const altPts  = []

  for (let i = 0; i < sims; i++) {
    const seed = seedBase + i
    basePts.push(simulateSeason({ games, ...base, seed }).pts)
    altPts.push( simulateSeason({ games, ...alt,  seed }).pts)
  }

  const mean = arr => arr.reduce((s, x) => s + x, 0) / arr.length
  const std  = (arr, m) => Math.sqrt(arr.reduce((s, x) => s + (x - m) ** 2, 0) / arr.length)

  const baseMean = mean(basePts)
  const altMean  = mean(altPts)

  return {
    baselineMean:   baseMean,
    baselineStd:    std(basePts, baseMean),
    withPlayerMean: altMean,
    withPlayerStd:  std(altPts, altMean),
    deltaMeanPts:   altMean - baseMean,
    pImprove:       altPts.filter((p, i) => p > basePts[i]).length / sims,
  }
}
