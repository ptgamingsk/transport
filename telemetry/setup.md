# PTGamingSK Transport – Telemetry v1.2

1. Riaditeľ založí a povolí účet vodiča. Existujúce pravidlá Firebase ostávajú bez zmeny.
2. Na hernom počítači potrebuješ Python 3 a fungujúci kompatibilný lokálny ETS2 Telemetry Server na porte 25555. Rozhranie http://127.0.0.1:25555/api/ets2/telemetry podporuje štruktúrované SDK JSON (sdkActive, truckValues) aj starší Funbit formát. Nevystavuj port do internetu.
3. Stiahni [ets2_bridge.py](ets2_bridge.py) a [start-telemetry.cmd](start-telemetry.cmd) do rovnakého priečinka. Zapni hru a server. Ukonči starú verziu bridge cez Ctrl+C. Dvojklikni na start-telemetry.cmd.
4. Potvrď súhlas a zadaj vlastný povolený e-mail a heslo vodiča. Heslo sa neukladá. Neposielaj ho v chate. Ukončenie: Ctrl+C.
5. Lokálny test bez odosielania: `py -3 ets2_bridge.py --test`.
6. Riaditeľ otvorí Účty a telemetria alebo Mapu spoločnosti. Vodič otvorí Telemetriu. Zobrazenie sa automaticky obnovuje približne každých 60 s v otvorenej karte. Klient odosiela stav každých 60 s.
7. Doručenia zo štruktúrovaného SDK sa skúšobne ukladajú iba lokálne do %USERPROFILE%/PTGamingSK-Transport ako JSONL. Pri krátkych udalostiach alebo výpadkoch sa môžu vynechať. Neodosielajú sa do Firebase; odovzdaj ich riaditeľovi na ručné overenie.

**Obmedzenia:** Živá mapa je orientačná mapa herných súradníc, nie cestná mapa ani GPS človeka. Kontrola modelu porovnáva názvy, nie identitu vozidla. Telemetria nie je nezávislý dôkaz, nevypláca odmeny a neschvaľuje vozidlá. V1.1 úspešne preniesla reálne údaje testovacieho vodiča; v1.2 a automatické obnovovanie je potrebné otestovať na počítači vodiča. Sleduj Firebase kvóty. openOMSI používa ručné hlásenia.
