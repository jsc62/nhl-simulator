# nhl-simulator
NHL What-If Simulator
Har du noen gang lurt på hva som hadde skjedd hvis Wayne Gretzky spilte for et middelmådig lag på 90-tallet? Eller hva et supertalent som Connor McDavid hadde betydd for et lag som sleit?
Dette er et verktøy som prøver å svare på det
Du som bruker velger et lag og en historisk sesong, plukker ut en spiller du vil bytte ut, og erstatter ham med hvem som helst, enten en ekte NHL-spiller med reelle statistikker, eller en fantasispiller du definerer selv. Verktøyet henter automatisk data fra NHLs API og simulerer sesongen 7000 ganger for å gi et realistisk bilde av hvordan det kunne ha gått.
Teknisk sett bruker simuleringen Monte Carlo-metoden med Poisson-fordeling for mål per kamp, og spillereffekten beregnes basert på EV/PP/SH-splits, istid og defensive bidrag.
