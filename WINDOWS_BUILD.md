# Build din app för Windows (.exe)

Följ dessa steg när du har laddat ner ZIP-filen för att skapa ett riktigt Windows-program:

## 1. Förberedelser
Se till att du har [Node.js](https://nodejs.org/) installerat på din dator.

## 2. Installera beroenden
Öppna mappen i din terminal (t.ex. PowerShell eller CMD) och kör:
```bash
npm install
```

## 3. Bygg programmet
Kör följande kommando för att skapa din `.exe`-fil:
```bash
npm run dist
```

## 4. Klart!
När kommandot är klart hittar du din installerbara Windows-fil i mappen som heter `dist_electron`.

---
**Tips:** Logotypen och alla dina anpassade färger (rosa, babyblå, effekter) är redan konfigurerade för att se likadana ut i Windows-fönstret.
