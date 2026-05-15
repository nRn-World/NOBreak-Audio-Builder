# 🚀 Hur du skickar en ny uppdatering till användarna

Alla som har installerat NoBreak Audio Builder på Windows kommer **automatiskt** att få uppdateringen i bakgrunden nästa gång de startar programmet.

---

## Steg 1 – Bumpa versionen

Öppna `package.json` och höj version-numret:

```json
"version": "1.0.1"   ← ändra detta
```

---

## Steg 2 – Committa och tagga i Git

```bash
git add .
git commit -m "Release v1.0.1"
git tag v1.0.1
git push origin main
git push origin v1.0.1
```

> GitHub Actions bygger nu automatiskt en ny `.exe` via `.github/workflows/release.yml`  
> och publicerar den som en ny GitHub Release.

---

## Steg 3 – Lägg till GH_TOKEN (engångsinställning)

För att GitHub Actions ska kunna ladda upp filen behöver du ett token:

1. Gå till **GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic)**
2. Skapa ett token med behörighet: `repo` (full)
3. Gå till ditt **repo → Settings → Secrets and variables → Actions**
4. Lägg till nytt secret: **`GH_TOKEN`** = ditt token

---

## Hur det fungerar för användarna

```
Användaren startar programmet
        ↓
electron-updater kontrollerar GitHub Releases (efter 5 sek)
        ↓
Ny version hittad? → Laddar ned i bakgrunden (tyst)
        ↓
"Uppdatering Klar!" visas som en notis i hörnet
        ↓
Användaren klickar "Starta Om & Installera"
        ↓
Programmet startar om med den nya versionen ✅
```

---

## Repo-inställningar att kontrollera

I `package.json` under `"publish"`:
```json
"publish": {
  "provider": "github",
  "owner": "nRn-World",           ← ditt GitHub-användarnamn
  "repo": "NoBreak-Audio-Builder" ← ditt repo-namn
}
```

> **Ändra `owner` och `repo` om ditt GitHub-repo heter något annat!**

---

## Lokal build (manuell)

Om du vill bygga `.exe` lokalt utan GitHub Actions:

```bash
# Kräver att GH_TOKEN är satt i miljön
$env:GH_TOKEN="ditt_token_här"
npm run build:electron
```

Filen hamnar i `release/` mappen.
