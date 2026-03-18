// server.js — enkel Express-server som proxyer NHL API-kall

import express from "express"
import { fetchTeams, fetchTeamSeasonStats, fetchRosterWithStats, fetchPlayerStats, searchPlayer } from "./api.js"

const app = express()
app.use(express.json())
app.use(express.static("."))

app.get("/api/teams", (req, res) => {
  res.json(fetchTeams())
})

app.get("/api/season/:abbrev/:seasonId", async (req, res) => {
  try {
    const data = await fetchTeamSeasonStats(req.params.abbrev, req.params.seasonId)
    res.json(data)
  } catch (e) {
    res.status(404).json({ error: e.message })
  }
})

app.get("/api/roster/:abbrev/:seasonId", async (req, res) => {
  try {
    const data = await fetchRosterWithStats(req.params.abbrev, req.params.seasonId)
    res.json(data)
  } catch (e) {
    res.status(404).json({ error: e.message })
  }
})

app.get("/api/player/:id/:seasonId", async (req, res) => {
  try {
    const data = await fetchPlayerStats(req.params.id, req.params.seasonId)
    res.json(data)
  } catch (e) {
    res.status(404).json({ error: e.message })
  }
})

app.get("/api/search/:query", async (req, res) => {
  try {
    const data = await searchPlayer(req.params.query)
    res.json(data)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.listen(3000, () => console.log("Server kjører på http://localhost:3000"))
