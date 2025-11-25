# schema_markdown (AI-annotované „ťaháky“)
### Databáza: vyrobny_system (MySQL)

> **Všeobecné ťaháky pre AI (STRICT SQL MODE):**
> - **EČV / SPZ:** Keď používateľ zadá EČV (napr. „SA 889DG“), **NIKDY nepoužívaj FUNC**. Namiesto toho spoj tabuľku s `fleet_vehicles` a vo WHERE použi: `AND REPLACE(REPLACE(fleet_vehicles.license_plate, ' ', ''), '-', '') LIKE '%SA889DG%'`.
> - **Názvy produktov:** Keď používateľ zadá názov (napr. „Hrubá klobása“), **NIKDY nepoužívaj FUNC**. Spoj tabuľku s `produkty` a hľadaj: `AND LOWER(produkty.nazov_vyrobku) LIKE '%hrubá klobása%'`.
> - **Dátumy:** Používaj MySQL funkcie: `CURDATE()`, `DATE_SUB(NOW(), INTERVAL 1 MONTH)`, `YEAR(datum)`, `MONTH(datum)`. Nepoužívaj `CURRENT_DATE` (Postgres).
> - **Syntax:** Nepoužívaj `ILIKE`! Použi `LOWER(stĺpec) LIKE '%hodnota%'`.
> - **Agregácie:** Ak sčituješ (km, kg), vždy použi `COALESCE(SUM(stĺpec), 0)`, aby výsledok nebol NULL.

---

## Tabuľka: assistant_query_log  <-- POZNÁMKA PRE AI: Logovanie otázok/SQL/počtu riadkov/chýb.
  - id: bigint, NULLABLE=NO, KEY=PRI, EXTRA=auto_increment
  - created_at: datetime, NULLABLE=NO, DEFAULT='CURRENT_TIMESTAMP', EXTRA=DEFAULT_GENERATED
  - user_id: int, NULLABLE=YES
  - question: text, NULLABLE=NO
  - used_sql: mediumtext, NULLABLE=YES
  - row_count: int, NULLABLE=YES
  - error: text, NULLABLE=YES

## Tabuľka: assistant_sessions  <-- POZNÁMKA PRE AI: Per-konverzačná „pamäť“ asistenta.
  - id: bigint, NULLABLE=NO, KEY=PRI, EXTRA=auto_increment
  - conversation_id: varchar(64), NULLABLE=NO, KEY=UNI
  - user_id: int, NULLABLE=YES
  - memory_json: json, NULLABLE=NO
  - last_seen: datetime, NULLABLE=NO, KEY=MUL, DEFAULT='CURRENT_TIMESTAMP', EXTRA=DEFAULT_GENERATED on update CURRENT_TIMESTAMP

## Tabuľka: automatizovane_ulohy  <-- POZNÁMKA PRE AI: Definície plánovaných SQL úloh.
  - id: int, NULLABLE=NO, KEY=PRI, EXTRA=auto_increment
  - nazov_ulohy: varchar(255), NULLABLE=NO
  - popis_ulohy_pre_ai: text, NULLABLE=YES
  - cron_retazec: varchar(64), NULLABLE=NO, DEFAULT='0 14 * * *'
  - email_adresata: varchar(255), NULLABLE=YES
  - sql_text: mediumtext, NULLABLE=YES
  - is_enabled: tinyint(1), NULLABLE=NO, DEFAULT='1'
  - created_at: datetime, NULLABLE=NO, DEFAULT='CURRENT_TIMESTAMP', EXTRA=DEFAULT_GENERATED
  - updated_at: datetime, NULLABLE=NO, DEFAULT='CURRENT_TIMESTAMP', EXTRA=DEFAULT_GENERATED on update CURRENT_TIMESTAMP

## Tabuľka: automatizovane_ulohy_log  <-- POZNÁMKA PRE AI: Históriu behov úloh nájdeš tu.
  - id: bigint, NULLABLE=NO, KEY=PRI, EXTRA=auto_increment
  - task_id: int, NULLABLE=NO, KEY=MUL
  - executed_at: datetime, NULLABLE=NO
  - row_count: int, NULLABLE=NO, DEFAULT='0'
  - summary: mediumtext, NULLABLE=YES

## Tabuľka: b2b_cennik_polozky  <-- POZNÁMKA PRE AI: Položky B2B cenníkov; pripájaj cez EAN.
  - id: int, NULLABLE=NO, KEY=PRI, EXTRA=auto_increment
  - cennik_id: int, NULLABLE=NO, KEY=MUL
  - ean_produktu: varchar(32), NULLABLE=NO, KEY=MUL
  - nazov_vyrobku: varchar(255), NULLABLE=NO
  - cena: decimal(12,2), NULLABLE=NO
  - dph: decimal(5,2), NULLABLE=YES, DEFAULT='0.00'
  - mj: varchar(16), NULLABLE=YES, DEFAULT='kg'
  - predajna_kategoria: varchar(100), NULLABLE=YES

## Tabuľka: b2b_cenniky  <-- POZNÁMKA PRE AI: Hlavičky B2B cenníkov.
  - id: int, NULLABLE=NO, KEY=PRI, EXTRA=auto_increment
  - nazov_cennika: varchar(255), NULLABLE=NO, KEY=UNI
  - created_at: datetime, NULLABLE=NO, DEFAULT='CURRENT_TIMESTAMP', EXTRA=DEFAULT_GENERATED

## Tabuľka: b2b_messages  <-- POZNÁMKA PRE AI: Interné/externé správy so stavom spracovania.
  - id: int, NULLABLE=NO, KEY=PRI, EXTRA=auto_increment
  - created_at: timestamp, NULLABLE=NO, DEFAULT='CURRENT_TIMESTAMP', EXTRA=DEFAULT_GENERATED
  - customer_id: int, NULLABLE=YES, KEY=MUL
  - zakaznik_login: varchar(64), NULLABLE=YES, KEY=MUL
  - customer_name: varchar(255), NULLABLE=YES
  - customer_email: varchar(255), NULLABLE=YES
  - subject: varchar(255), NULLABLE=YES, KEY=MUL
  - body: text, NULLABLE=YES
  - direction: enum('in','out'), NULLABLE=NO, DEFAULT='in'
  - status: enum('new','read','closed'), NULLABLE=NO, KEY=MUL, DEFAULT='new'
  - attachment_path: varchar(500), NULLABLE=YES
  - attachment_filename: varchar(255), NULLABLE=YES
  - attachment_mime: varchar(120), NULLABLE=YES
  - attachment_size: int, NULLABLE=YES
  - parent_id: int, NULLABLE=YES, KEY=MUL

## Tabuľka: b2b_nastavenia  <-- POZNÁMKA PRE AI: K-V nastavenia B2B.
  - kluc: varchar(64), NULLABLE=NO, KEY=PRI
  - hodnota: varchar(1024), NULLABLE=YES

## Tabuľka: b2b_objednavky  <-- POZNÁMKA PRE AI: Hlavičky objednávok B2B.
  - id: int, NULLABLE=NO, KEY=PRI, EXTRA=auto_increment
  - cislo_objednavky: varchar(50), NULLABLE=NO, KEY=UNI
  - zakaznik_id: varchar(32), NULLABLE=NO, KEY=MUL
  - nazov_firmy: varchar(255), NULLABLE=NO
  - adresa: text, NULLABLE=YES
  - datum_objednavky: datetime, NULLABLE=NO, KEY=MUL, DEFAULT='CURRENT_TIMESTAMP', EXTRA=DEFAULT_GENERATED
  - pozadovany_datum_dodania: date, NULLABLE=YES, KEY=MUL
  - celkova_suma_s_dph: decimal(14,2), NULLABLE=NO, DEFAULT='0.00'
  - stav: varchar(64), NULLABLE=NO, DEFAULT='Prijatá'
  - poznamka: text, NULLABLE=YES

## Tabuľka: b2b_objednavky_polozky  <-- POZNÁMKA PRE AI: Položky objednávok B2B.
  - id: int, NULLABLE=NO, KEY=PRI, EXTRA=auto_increment
  - objednavka_id: int, NULLABLE=NO, KEY=MUL
  - ean_produktu: varchar(32), NULLABLE=NO, KEY=MUL
  - nazov_vyrobku: varchar(255), NULLABLE=NO
  - mnozstvo: decimal(14,3), NULLABLE=NO
  - mj: varchar(16), NULLABLE=YES, DEFAULT='kg'
  - dph: decimal(5,2), NULLABLE=YES, DEFAULT='0.00'
  - predajna_kategoria: varchar(100), NULLABLE=YES
  - vaha_balenia_g: int, NULLABLE=YES
  - typ_polozky: varchar(50), NULLABLE=YES
  - cena_bez_dph: decimal(12,2), NULLABLE=YES
  - pozadovany_datum_dodania: date, NULLABLE=YES

## Tabuľka: b2b_promotions  <-- POZNÁMKA PRE AI: Akcie pre produkty (podľa EAN).
  - id: int, NULLABLE=NO, KEY=PRI, EXTRA=auto_increment
  - name: varchar(255), NULLABLE=NO
  - product_ean: varchar(32), NULLABLE=NO, KEY=MUL  <-- POZNÁMKA PRE AI: Join na `produkty.ean`.
  - product_name: varchar(255), NULLABLE=YES
  - sale_price_net: decimal(12,2), NULLABLE=NO
  - start_date: date, NULLABLE=YES, KEY=MUL
  - end_date: date, NULLABLE=YES
  - chain_id: int, NULLABLE=YES, KEY=MUL  <-- POZNÁMKA PRE AI: Join na `b2b_retail_chains.id`.
  - ean: varchar(32), NULLABLE=YES, KEY=MUL, EXTRA=VIRTUAL GENERATED

## Tabuľka: b2b_retail_chains  <-- POZNÁMKA PRE AI: Obchodné reťazce (partneri).
  - id: int, NULLABLE=NO, KEY=PRI, EXTRA=auto_increment
  - name: varchar(255), NULLABLE=NO, KEY=UNI  <-- POZNÁMKA PRE AI: Názov reťazca (LOWER LIKE).
  - city: varchar(255), NULLABLE=YES
  - contact_name: varchar(255), NULLABLE=YES
  - contact_email: varchar(255), NULLABLE=YES
  - is_active: tinyint, NULLABLE=NO, DEFAULT='1'
  - created_at: datetime, NULLABLE=NO, DEFAULT='CURRENT_TIMESTAMP', EXTRA=DEFAULT_GENERATED

## Tabuľka: b2b_zakaznici  <-- POZNÁMKA PRE AI: Zákazníci (B2B/B2C).
  - id: int, NULLABLE=NO, KEY=PRI, EXTRA=auto_increment
  - zakaznik_id: varchar(32), NULLABLE=NO, KEY=UNI
  - typ: enum('B2B','B2C'), NULLABLE=NO, KEY=MUL, DEFAULT='B2B'
  - nazov_firmy: varchar(255), NULLABLE=NO
  - email: varchar(255), NULLABLE=NO, KEY=UNI
  - telefon: varchar(50), NULLABLE=YES
  - datum_registracie: datetime, NULLABLE=NO, DEFAULT='CURRENT_TIMESTAMP', EXTRA=DEFAULT_GENERATED
  - phone: varchar(50), NULLABLE=YES
  - adresa: text, NULLABLE=YES
  - adresa_dorucenia: text, NULLABLE=YES
  - vernostne_body: int, NULLABLE=NO, DEFAULT='0'
  - cennik_id: int, NULLABLE=YES, KEY=MUL
  - je_schvaleny: tinyint, NULLABLE=NO, DEFAULT='0'
  - je_admin: tinyint, NULLABLE=NO, DEFAULT='0'
  - gdpr_suhlas: tinyint, NULLABLE=NO, DEFAULT='0'
  - password_salt_hex: varchar(128), NULLABLE=YES
  - password_hash_hex: varchar(128), NULLABLE=YES
  - reset_token: varchar(128), NULLABLE=YES
  - reset_token_expiry: datetime, NULLABLE=YES
  - created_at: datetime, NULLABLE=NO, DEFAULT='CURRENT_TIMESTAMP', EXTRA=DEFAULT_GENERATED
  - heslo_hash: varchar(255), NULLABLE=NO
  - heslo_salt: varchar(64), NULLABLE=NO

## Tabuľka: b2b_zakaznik_cennik  <-- POZNÁMKA PRE AI: Väzba zákazník ↔ cenník.
  - id: int, NULLABLE=NO, KEY=PRI, EXTRA=auto_increment
  - zakaznik_id: varchar(32), NULLABLE=NO, KEY=MUL
  - cennik_id: int, NULLABLE=NO, KEY=MUL

## Tabuľka: b2c_cennik_polozky  <-- POZNÁMKA PRE AI: Retail cenník (B2C).
  - id: int, NULLABLE=NO, KEY=PRI, EXTRA=auto_increment
  - ean_produktu: varchar(32), NULLABLE=NO, KEY=MUL
  - cena_bez_dph: decimal(12,2), NULLABLE=NO
  - je_v_akcii: tinyint, NULLABLE=NO, DEFAULT='0'
  - akciova_cena_bez_dph: decimal(12,2), NULLABLE=YES

## Tabuľka: b2c_objednavky  <-- POZNÁMKA PRE AI: Hlavičky B2C objednávok.
  - id: int, NULLABLE=NO, KEY=PRI, EXTRA=auto_increment
  - cislo_objednavky: varchar(50), NULLABLE=NO, KEY=UNI
  - zakaznik_id: varchar(32), NULLABLE=NO, KEY=MUL
  - nazov_firmy: varchar(255), NULLABLE=YES
  - datum_objednavky: datetime, NULLABLE=NO, DEFAULT='CURRENT_TIMESTAMP', EXTRA=DEFAULT_GENERATED
  - pozadovany_datum_dodania: date, NULLABLE=YES, KEY=MUL
  - celkova_suma_s_dph: decimal(14,2), NULLABLE=NO, DEFAULT='0.00'
  - stav: varchar(64), NULLABLE=NO, DEFAULT='Prijatá'
  - poznamka: text, NULLABLE=YES

## Tabuľka: b2c_uplatnene_odmeny  <-- POZNÁMKA PRE AI: Uplatnené vernostné odmeny.
  - id: int, NULLABLE=NO, KEY=PRI, EXTRA=auto_increment
  - zakaznik_id: varchar(32), NULLABLE=NO, KEY=MUL
  - odmena_id: int, NULLABLE=NO, KEY=MUL
  - nazov_odmeny: varchar(255), NULLABLE=NO
  - pouzite_body: int, NULLABLE=NO
  - created_at: datetime, NULLABLE=NO, DEFAULT='CURRENT_TIMESTAMP', EXTRA=DEFAULT_GENERATED

## Tabuľka: b2c_vernostne_odmeny  <-- POZNÁMKA PRE AI: Katalóg odmien.
  - id: int, NULLABLE=NO, KEY=PRI, EXTRA=auto_increment
  - nazov_odmeny: varchar(255), NULLABLE=NO
  - potrebne_body: int, NULLABLE=NO
  - je_aktivna: tinyint, NULLABLE=NO, KEY=MUL, DEFAULT='1'

## Tabuľka: costs_categories  <-- POZNÁMKA PRE AI: Typy nákladov (HR/energia/…)
  - id: int, NULLABLE=NO, KEY=PRI, EXTRA=auto_increment
  - category_name: varchar(255), NULLABLE=NO, KEY=UNI

## Tabuľka: costs_energy_electricity  <-- POZNÁMKA PRE AI: Mesiac/rok → parametre elektriny.
  - id: int, NULLABLE=NO, KEY=PRI, EXTRA=auto_increment
  - record_year: int, NULLABLE=NO, KEY=MUL
  - record_month: int, NULLABLE=NO
  - merana_spotreba_kwh: decimal(14,3), NULLABLE=YES, DEFAULT='0.000'
  - fakturacia_vse: decimal(14,2), NULLABLE=YES, DEFAULT='0.00'
  - fakturacia_vse_nt: decimal(14,2), NULLABLE=YES, DEFAULT='0.00'
  - rozdiel_vse: decimal(14,2), NULLABLE=YES, DEFAULT='0.00'
  - rozdiel_vse_nt: decimal(14,2), NULLABLE=YES, DEFAULT='0.00'
  - faktura_s_dph: decimal(14,2), NULLABLE=YES, DEFAULT='0.00'
  - final_cost: decimal(14,2), NULLABLE=YES, DEFAULT='0.00'

## Tabuľka: costs_energy_gas  <-- POZNÁMKA PRE AI: Mesiac/rok → parametre plynu.
  - id: int, NULLABLE=NO, KEY=PRI, EXTRA=auto_increment
  - record_year: int, NULLABLE=NO, KEY=MUL
  - record_month: int, NULLABLE=NO
  - potreba_kwh: decimal(14,3), NULLABLE=YES, DEFAULT='0.000'
  - nakup_plynu_eur: decimal(14,2), NULLABLE=YES, DEFAULT='0.00'
  - distribucia_eur: decimal(14,2), NULLABLE=YES, DEFAULT='0.00'
  - poplatok_okte_eur: decimal(14,2), NULLABLE=YES, DEFAULT='0.00'
  - straty_eur: decimal(14,2), NULLABLE=YES, DEFAULT='0.00'
  - spolu_bez_dph: decimal(14,2), NULLABLE=YES, DEFAULT='0.00'
  - dph: decimal(14,2), NULLABLE=YES, DEFAULT='0.00'
  - spolu_s_dph: decimal(14,2), NULLABLE=YES, DEFAULT='0.00'
  - stav_odpisany: tinyint, NULLABLE=YES, DEFAULT='0'
  - stav_fakturovany: tinyint, NULLABLE=YES, DEFAULT='0'

## Tabuľka: costs_energy_monthly  <-- POZNÁMKA PRE AI: Zhrnuté merania/ceny (mesiac).
  - id: int, NULLABLE=NO, KEY=PRI, EXTRA=auto_increment
  - report_year: int, NULLABLE=NO, KEY=MUL
  - report_month: tinyint, NULLABLE=NO
  - el_prod_start_kwh: decimal(14,3), NULLABLE=YES
  - el_prod_end_kwh: decimal(14,3), NULLABLE=YES
  - el_other_start_kwh: decimal(14,3), NULLABLE=YES
  - el_other_end_kwh: decimal(14,3), NULLABLE=YES
  - el_price_per_kwh_net: decimal(10,6), NULLABLE=YES
  - el_price_per_kwh_gross: decimal(10,6), NULLABLE=YES
  - el_main_start_kwh: decimal(14,3), NULLABLE=YES
  - el_main_end_kwh: decimal(14,3), NULLABLE=YES
  - el_main_price_per_kwh_net: decimal(10,6), NULLABLE=YES
  - el_main_price_per_kwh_gross: decimal(10,6), NULLABLE=YES
  - gas_start_m3: decimal(14,3), NULLABLE=YES
  - gas_end_m3: decimal(14,3), NULLABLE=YES
  - gas_conv_kwh_per_m3: decimal(8,4), NULLABLE=YES, DEFAULT='10.5000'
  - gas_price_per_kwh_net: decimal(10,6), NULLABLE=YES
  - gas_price_per_kwh_gross: decimal(10,6), NULLABLE=YES
  - water_start_m3: decimal(14,3), NULLABLE=YES
  - water_end_m3: decimal(14,3), NULLABLE=YES
  - water_price_per_m3_net: decimal(10,6), NULLABLE=YES
  - water_price_per_m3_gross: decimal(10,6), NULLABLE=YES

## Tabuľka: costs_hr  <-- POZNÁMKA PRE AI: Mesačné mzdové náklady a odvody.
  - id: int, NULLABLE=NO, KEY=PRI, EXTRA=auto_increment
  - record_year: int, NULLABLE=NO, KEY=MUL
  - record_month: int, NULLABLE=NO
  - total_salaries: decimal(14,2), NULLABLE=YES, DEFAULT='0.00'
  - total_levies: decimal(14,2), NULLABLE=YES, DEFAULT='0.00'

## Tabuľka: costs_items  <-- POZNÁMKA PRE AI: Individuálne nákladové položky.
  - id: int, NULLABLE=NO, KEY=PRI, EXTRA=auto_increment
  - entry_date: date, NULLABLE=NO, KEY=MUL
  - category_id: int, NULLABLE=NO, KEY=MUL
  - name: varchar(255), NULLABLE=NO
  - description: text, NULLABLE=YES
  - amount_net: decimal(12,2), NULLABLE=NO
  - is_recurring: tinyint, NULLABLE=NO, DEFAULT='0'

## Tabuľka: expedicia_inventura_polozky  <-- POZNÁMKA PRE AI: Položky inventúry expedície.
  - id: int, NULLABLE=NO, KEY=PRI, EXTRA=auto_increment
  - inventura_id: int, NULLABLE=NO, KEY=MUL
  - ean: varchar(64), NULLABLE=NO
  - nazov: varchar(255), NULLABLE=NO
  - kategoria: varchar(255), NULLABLE=YES
  - system_stav_kg: decimal(12,3), NULLABLE=NO
  - realny_stav_kg: decimal(12,3), NULLABLE=NO
  - rozdiel_kg: decimal(12,3), NULLABLE=NO
  - hodnota_eur: decimal(12,2), NULLABLE=NO

## Tabuľka: expedicia_inventury  <-- POZNÁMKA PRE AI: Hlavičky inventúr expedície.
  - id: int, NULLABLE=NO, KEY=PRI, EXTRA=auto_increment
  - datum: date, NULLABLE=NO, KEY=MUL
  - vytvoril: varchar(255), NULLABLE=NO
  - poznamka: varchar(255), NULLABLE=YES
  - created_at: datetime, NULLABLE=NO

## Tabuľka: expedicia_prijmy  <-- POZNÁMKA PRE AI: Príjem hotových výrobkov.
  - id: int, NULLABLE=NO, KEY=PRI, EXTRA=auto_increment
  - id_davky: varchar(64), NULLABLE=NO, KEY=MUL
  - nazov_vyrobku: varchar(255), NULLABLE=NO
  - unit: varchar(8), NULLABLE=NO
  - prijem_kg: decimal(12,3), NULLABLE=YES
  - prijem_ks: int, NULLABLE=YES
  - prijal: varchar(255), NULLABLE=NO
  - dovod: varchar(255), NULLABLE=YES
  - datum_prijmu: date, NULLABLE=NO, KEY=MUL
  - created_at: datetime, NULLABLE=NO
  - updated_at: datetime, NULLABLE=YES
  - is_deleted: tinyint(1), NULLABLE=NO, DEFAULT='0'

## Tabuľka: fleet_costs  <-- POZNÁMKA PRE AI: Fixné mesačné náklady na vozidlá.
  - id: int, NULLABLE=NO, KEY=PRI, EXTRA=auto_increment
  - vehicle_id: int, NULLABLE=NO, KEY=MUL  <-- POZNÁMKA PRE AI: Join na `fleet_vehicles.id`.
  - cost_type: varchar(32), NULLABLE=NO
  - cost_name: varchar(255), NULLABLE=NO
  - monthly_cost: decimal(12,2), NULLABLE=NO
  - valid_from: date, NULLABLE=NO
  - valid_to: date, NULLABLE=YES

## Tabuľka: fleet_logs  <-- POZNÁMKA PRE AI: Denník jázd a rozvozu tovaru.
  - id: int, NULLABLE=NO, KEY=PRI, EXTRA=auto_increment
  - vehicle_id: int, NULLABLE=NO, KEY=MUL  <-- POZNÁMKA PRE AI: FK na `fleet_vehicles.id`. **VŽDY** joinuj `fleet_vehicles`.
  - log_date: date, NULLABLE=NO, KEY=MUL
  - driver: varchar(255), NULLABLE=YES
  - start_odometer: int, NULLABLE=NO
  - end_odometer: int, NULLABLE=NO
  - km_driven: int, NULLABLE=NO  <-- POZNÁMKA PRE AI: Ujdené km. Sumár: `COALESCE(SUM(km_driven), 0)`.
  - goods_out_kg: decimal(12,3), NULLABLE=YES, DEFAULT='0.000'  <-- POZNÁMKA PRE AI: Roznesené kg (tovar). Sumár: `COALESCE(SUM(goods_out_kg), 0)`.
  - goods_in_kg: decimal(12,3), NULLABLE=YES, DEFAULT='0.000'
  - delivery_notes_count: int, NULLABLE=YES, DEFAULT='0'

## Tabuľka: fleet_refueling  <-- POZNÁMKA PRE AI: Tankovanie.
  - id: int, NULLABLE=NO, KEY=PRI, EXTRA=auto_increment
  - vehicle_id: int, NULLABLE=NO, KEY=MUL  <-- POZNÁMKA PRE AI: FK na `fleet_vehicles.id`.
  - refueling_date: date, NULLABLE=NO, KEY=MUL
  - driver: varchar(255), NULLABLE=YES
  - liters: decimal(10,3), NULLABLE=NO  <-- POZNÁMKA PRE AI: Natankované litre.
  - price_per_liter: decimal(10,3), NULLABLE=YES
  - total_price: decimal(12,2), NULLABLE=YES

## Tabuľka: fleet_vehicles  <-- POZNÁMKA PRE AI: Kmeň vozidiel (EČV je prirodzený kľúč).
  - id: int, NULLABLE=NO, KEY=PRI, EXTRA=auto_increment  <-- POZNÁMKA PRE AI: Primárny kľúč.
  - name: varchar(255), NULLABLE=NO
  - license_plate: varchar(32), NULLABLE=NO, KEY=UNI  <-- POZNÁMKA PRE AI: EČV vozidla. Pri hľadaní odstráň medzery: `AND REPLACE(REPLACE(fleet_vehicles.license_plate, ' ', ''), '-', '') LIKE '%HĽADANÝ_TEXT%'`.
  - type: varchar(50), NULLABLE=YES
  - initial_odometer: int, NULLABLE=NO, DEFAULT='0'
  - default_driver: varchar(255), NULLABLE=YES
  - is_active: tinyint, NULLABLE=NO, DEFAULT='1'

## Tabuľka: haccp_dokumenty  <-- POZNÁMKA PRE AI: Dokumenty HACCP.
  - id: int, NULLABLE=NO, KEY=PRI, EXTRA=auto_increment
  - nazov: varchar(255), NULLABLE=NO
  - obsah: longtext, NULLABLE=NO
  - created_at: datetime, NULLABLE=NO, DEFAULT='CURRENT_TIMESTAMP', EXTRA=DEFAULT_GENERATED

## Tabuľka: hygiene_agents  <-- POZNÁMKA PRE AI: Čistiace prostriedky.
  - id: int, NULLABLE=NO, KEY=PRI, EXTRA=auto_increment
  - agent_name: varchar(255), NULLABLE=NO
  - description: text, NULLABLE=YES
  - is_active: tinyint, NULLABLE=NO, KEY=MUL, DEFAULT='1'

## Tabuľka: hygiene_log  <-- POZNÁMKA PRE AI: Záznamy hygieny.
  - id: int, NULLABLE=NO, KEY=PRI, EXTRA=auto_increment
  - task_id: int, NULLABLE=YES, KEY=MUL
  - task_name: varchar(255), NULLABLE=NO
  - location: varchar(255), NULLABLE=NO
  - performed_at: datetime, NULLABLE=NO, DEFAULT='CURRENT_TIMESTAMP', EXTRA=DEFAULT_GENERATED
  - completion_date: date, NULLABLE=YES, KEY=MUL
  - user_id: int, NULLABLE=YES, KEY=MUL
  - agent_id: int, NULLABLE=YES, KEY=MUL
  - user_fullname: varchar(255), NULLABLE=YES
  - agent_name: varchar(255), NULLABLE=YES
  - concentration: varchar(64), NULLABLE=YES
  - exposure_time: varchar(64), NULLABLE=YES
  - notes: text, NULLABLE=YES
  - start_at: datetime, NULLABLE=YES
  - exposure_end_at: datetime, NULLABLE=YES
  - rinse_end_at: datetime, NULLABLE=YES
  - finished_at: datetime, NULLABLE=YES
  - checked_by_fullname: varchar(255), NULLABLE=YES
  - checked_at: datetime, NULLABLE=YES

## Tabuľka: hygiene_tasks  <-- POZNÁMKA PRE AI: Katalóg hygienických úloh.
  - id: int, NULLABLE=NO, KEY=PRI, EXTRA=auto_increment
  - task_name: varchar(255), NULLABLE=NO
  - location: varchar(255), NULLABLE=NO
  - frequency: varchar(64), NULLABLE=NO
  - description: text, NULLABLE=YES
  - default_agent_id: int, NULLABLE=YES, KEY=MUL
  - default_concentration: varchar(64), NULLABLE=YES
  - default_exposure_time: varchar(64), NULLABLE=YES
  - is_active: tinyint, NULLABLE=NO, DEFAULT='1'

## Tabuľka: internal_users  <-- POZNÁMKA PRE AI: Interní používatelia.
  - id: int, NULLABLE=NO, KEY=PRI, EXTRA=auto_increment
  - username: varchar(100), NULLABLE=NO, KEY=UNI
  - full_name: varchar(255), NULLABLE=YES
  - email: varchar(255), NULLABLE=YES
  - role: varchar(50), NULLABLE=NO, DEFAULT='kancelaria'
  - is_active: tinyint, NULLABLE=NO, DEFAULT='1'
  - password_salt: varchar(128), NULLABLE=YES
  - password_hash: varchar(128), NULLABLE=YES
  - reset_token: varchar(128), NULLABLE=YES
  - reset_token_expiry: datetime, NULLABLE=YES
  - created_at: datetime, NULLABLE=NO, DEFAULT='CURRENT_TIMESTAMP', EXTRA=DEFAULT_GENERATED

## Tabuľka: inventurne_rozdiely  <-- POZNÁMKA PRE AI: Rozdiely surovín.
  - id: int, NULLABLE=NO, KEY=PRI, EXTRA=auto_increment
  - datum: date, NULLABLE=NO
  - nazov_suroviny: varchar(255), NULLABLE=NO, KEY=MUL
  - typ_suroviny: varchar(50), NULLABLE=YES
  - systemovy_stav_kg: decimal(14,3), NULLABLE=NO
  - realny_stav_kg: decimal(14,3), NULLABLE=NO
  - rozdiel_kg: decimal(14,3), NULLABLE=NO
  - hodnota_rozdielu_eur: decimal(14,2), NULLABLE=YES, DEFAULT='0.00'

## Tabuľka: inventurne_rozdiely_produkty  <-- POZNÁMKA PRE AI: Rozdiely hotových výrobkov.
  - id: int, NULLABLE=NO, KEY=PRI, EXTRA=auto_increment
  - datum: date, NULLABLE=NO
  - ean_produktu: varchar(32), NULLABLE=NO, KEY=MUL
  - nazov_vyrobku: varchar(255), NULLABLE=NO
  - kategoria: varchar(255), NULLABLE=YES
  - systemovy_stav_kg: decimal(14,3), NULLABLE=NO
  - realny_stav_kg: decimal(14,3), NULLABLE=NO
  - rozdiel_kg: decimal(14,3), NULLABLE=NO
  - hodnota_rozdielu_eur: decimal(14,2), NULLABLE=YES, DEFAULT='0.00'

## Tabuľka: katalog_produktov  <-- POZNÁMKA PRE AI: Katalóg produktov (PK = EAN).
  - ean: varchar(32), NULLABLE=NO, KEY=PRI
  - nazov_vyrobku: varchar(255), NULLABLE=NO  <-- POZNÁMKA PRE AI: Názov. Hľadaj cez `LOWER(nazov_vyrobku) LIKE '%...%'`.
  - mj: varchar(16), NULLABLE=YES, DEFAULT='kg'
  - kategoria_pre_recepty: varchar(255), NULLABLE=YES
  - typ_produktu: varchar(50), NULLABLE=YES
  - vaha_balenia_g: int, NULLABLE=YES
  - zdrojovy_ean: varchar(32), NULLABLE=YES
  - minimalna_zasoba_kg: decimal(12,3), NULLABLE=YES, DEFAULT='0.000'
  - minimalna_zasoba_ks: decimal(12,3), NULLABLE=YES, DEFAULT='0.000'

## Tabuľka: mail_accounts  <-- POZNÁMKA PRE AI: E-mailové schránky.
  - id: int, NULLABLE=NO, KEY=PRI, EXTRA=auto_increment
  - name: varchar(150), NULLABLE=YES
  - provider: varchar(100), NULLABLE=YES
  - imap_server: varchar(200), NULLABLE=YES
  - imap_port: int, NULLABLE=YES
  - imap_use_ssl: tinyint, NULLABLE=NO, DEFAULT='1'
  - smtp_server: varchar(200), NULLABLE=YES
  - smtp_port: int, NULLABLE=YES
  - smtp_use_ssl: tinyint, NULLABLE=NO, DEFAULT='1'
  - username: varchar(255), NULLABLE=YES
  - password_enc: text, NULLABLE=YES
  - inbox_folder: varchar(100), NULLABLE=NO, DEFAULT='INBOX'
  - spam_folder: varchar(100), NULLABLE=NO, DEFAULT='SPAM'
  - trash_folder: varchar(100), NULLABLE=NO, DEFAULT='TRASH'
  - created_at: datetime, NULLABLE=YES, DEFAULT='CURRENT_TIMESTAMP', EXTRA=DEFAULT_GENERATED
  - updated_at: datetime, NULLABLE=YES, DEFAULT='CURRENT_TIMESTAMP', EXTRA=DEFAULT_GENERATED on update CURRENT_TIMESTAMP

## Tabuľka: mail_attachments  <-- POZNÁMKA PRE AI: Prílohy k mailom.
  - id: int, NULLABLE=NO, KEY=PRI, EXTRA=auto_increment
  - message_id: int, NULLABLE=NO, KEY=MUL
  - filename: varchar(255), NULLABLE=NO
  - content_type: varchar(127), NULLABLE=YES
  - size_bytes: int, NULLABLE=YES
  - storage_path: varchar(500), NULLABLE=NO
  - checksum_sha256: char(64), NULLABLE=YES
  - created_at: datetime, NULLABLE=YES, DEFAULT='CURRENT_TIMESTAMP', EXTRA=DEFAULT_GENERATED

## Tabuľka: mail_contact_links  <-- POZNÁMKA PRE AI: Mapovanie mail ↔ zákazník.
  - id: int, NULLABLE=NO, KEY=PRI, EXTRA=auto_increment
  - email: varchar(255), NULLABLE=NO, KEY=UNI
  - domain: varchar(255), NULLABLE=YES
  - customer_id: int, NULLABLE=NO
  - customer_name: varchar(255), NULLABLE=YES
  - created_at: datetime, NULLABLE=YES, DEFAULT='CURRENT_TIMESTAMP', EXTRA=DEFAULT_GENERATED

## Tabuľka: mail_messages  <-- POZNÁMKA PRE AI: Správy.
  - id: int, NULLABLE=NO, KEY=PRI, EXTRA=auto_increment
  - account_id: int, NULLABLE=YES
  - customer_id: int, NULLABLE=YES, KEY=MUL
  - direction: enum('incoming','outgoing'), NULLABLE=NO
  - folder: enum('INBOX','SENT','DRAFTS','SPAM','TRASH','ARCHIVE'), NULLABLE=NO, KEY=MUL, DEFAULT='INBOX'
  - subject: varchar(255), NULLABLE=YES, KEY=MUL
  - from_name: varchar(255), NULLABLE=YES
  - from_email: varchar(255), NULLABLE=YES
  - to_json: json, NULLABLE=YES
  - cc_json: json, NULLABLE=YES
  - bcc_json: json, NULLABLE=YES
  - message_id_header: varchar(255), NULLABLE=YES, KEY=MUL
  - in_reply_to: varchar(255), NULLABLE=YES
  - thread_key: char(40), NULLABLE=YES, KEY=MUL
  - date_header: datetime, NULLABLE=YES
  - received_at: datetime, NULLABLE=YES
  - sent_at: datetime, NULLABLE=YES, KEY=MUL
  - is_read: tinyint, NULLABLE=NO, KEY=MUL, DEFAULT='0'
  - is_starred: tinyint, NULLABLE=NO, DEFAULT='0'
  - is_spam: tinyint, NULLABLE=NO, DEFAULT='0'
  - is_deleted: tinyint, NULLABLE=NO, DEFAULT='0'
  - body_text: longtext, NULLABLE=YES
  - body_html: longtext, NULLABLE=YES
  - raw_headers: longtext, NULLABLE=YES
  - external_uid: varchar(255), NULLABLE=YES, KEY=MUL
  - has_attachments: tinyint, NULLABLE=NO, DEFAULT='0'
  - created_at: datetime, NULLABLE=YES, DEFAULT='CURRENT_TIMESTAMP', EXTRA=DEFAULT_GENERATED
  - updated_at: datetime, NULLABLE=YES, DEFAULT='CURRENT_TIMESTAMP', EXTRA=DEFAULT_GENERATED on update CURRENT_TIMESTAMP

## Tabuľka: mail_rules  <-- POZNÁMKA PRE AI: Pravidlá mailov.
  - id: int, NULLABLE=NO, KEY=PRI, EXTRA=auto_increment
  - name: varchar(150), NULLABLE=NO
  - match_sender: varchar(255), NULLABLE=YES
  - match_domain: varchar(255), NULLABLE=YES
  - match_subject: varchar(255), NULLABLE=YES
  - customer_id: int, NULLABLE=YES
  - target_folder: enum('INBOX','SENT','DRAFTS','SPAM','TRASH','ARCHIVE'), NULLABLE=YES
  - set_starred: tinyint, NULLABLE=NO, DEFAULT='0'
  - set_read: tinyint, NULLABLE=NO, DEFAULT='0'
  - active: tinyint, NULLABLE=NO, DEFAULT='1'
  - priority: int, NULLABLE=NO, DEFAULT='10'
  - created_at: datetime, NULLABLE=YES, DEFAULT='CURRENT_TIMESTAMP', EXTRA=DEFAULT_GENERATED
  - updated_at: datetime, NULLABLE=YES, DEFAULT='CURRENT_TIMESTAMP', EXTRA=DEFAULT_GENERATED on update CURRENT_TIMESTAMP

## Tabuľka: mail_signatures  <-- POZNÁMKA PRE AI: Podpisy.
  - id: int, NULLABLE=NO, KEY=PRI, EXTRA=auto_increment
  - user_id: int, NULLABLE=YES
  - name: varchar(100), NULLABLE=NO
  - html: longtext, NULLABLE=NO
  - is_default: tinyint, NULLABLE=NO, DEFAULT='0'
  - created_at: datetime, NULLABLE=YES, DEFAULT='CURRENT_TIMESTAMP', EXTRA=DEFAULT_GENERATED
  - updated_at: datetime, NULLABLE=YES, DEFAULT='CURRENT_TIMESTAMP', EXTRA=DEFAULT_GENERATED on update CURRENT_TIMESTAMP

## Tabuľka: meat_breakdown  <-- POZNÁMKA PRE AI: Rozrábka – vstupné suroviny.
  - id: int, NULLABLE=NO, KEY=PRI, EXTRA=auto_increment
  - breakdown_date: date, NULLABLE=NO
  - material_id: int, NULLABLE=NO, KEY=MUL
  - supplier: varchar(120), NULLABLE=YES
  - note: varchar(255), NULLABLE=YES
  - units_count: int, NULLABLE=YES
  - input_weight_kg: decimal(12,3), NULLABLE=NO
  - purchase_unit_price_eur_kg: decimal(10,4), NULLABLE=YES
  - purchase_total_cost_eur: decimal(12,2), NULLABLE=YES
  - tolerance_pct: decimal(6,3), NULLABLE=YES
  - created_at: datetime, NULLABLE=NO, DEFAULT='CURRENT_TIMESTAMP', EXTRA=DEFAULT_GENERATED
  - updated_at: datetime, NULLABLE=NO, DEFAULT='CURRENT_TIMESTAMP', EXTRA=DEFAULT_GENERATED on update CURRENT_TIMESTAMP

## Tabuľka: meat_breakdown_extra_costs  <-- POZNÁMKA PRE AI: Dodatočné náklady v rozrábke.
  - id: int, NULLABLE=NO, KEY=PRI, EXTRA=auto_increment
  - breakdown_id: int, NULLABLE=NO, KEY=MUL
  - name: varchar(120), NULLABLE=NO
  - amount_eur: decimal(12,2), NULLABLE=NO

## Tabuľka: meat_breakdown_output  <-- POZNÁMKA PRE AI: Výstupy rozrábky.
  - id: int, NULLABLE=NO, KEY=PRI, EXTRA=auto_increment
  - breakdown_id: int, NULLABLE=NO, KEY=MUL
  - product_id: int, NULLABLE=NO, KEY=MUL
  - weight_kg: decimal(12,3), NULLABLE=NO

## Tabuľka: meat_breakdown_result  <-- POZNÁMKA PRE AI: Výsledky alokácie nákladov.
  - id: int, NULLABLE=NO, KEY=PRI, EXTRA=auto_increment
  - breakdown_id: int, NULLABLE=NO, KEY=MUL
  - product_id: int, NULLABLE=NO, KEY=MUL
  - weight_kg: decimal(12,3), NULLABLE=NO
  - yield_pct: decimal(8,4), NULLABLE=NO
  - allocated_cost_eur: decimal(12,2), NULLABLE=NO
  - cost_per_kg_eur: decimal(10,4), NULLABLE=NO
  - selling_price_eur_kg_snap: decimal(10,3), NULLABLE=NO
  - margin_eur_per_kg: decimal(10,4), NULLABLE=NO
  - profit_eur: decimal(12,2), NULLABLE=NO

## Tabuľka: meat_materials  <-- POZNÁMKA PRE AI: Materiály rozrábky.
  - id: int, NULLABLE=NO, KEY=PRI, EXTRA=auto_increment
  - code: varchar(50), NULLABLE=NO, KEY=UNI
  - name: varchar(120), NULLABLE=NO
  - is_active: tinyint(1), NULLABLE=NO, DEFAULT='1'
  - created_at: datetime, NULLABLE=NO, DEFAULT='CURRENT_TIMESTAMP', EXTRA=DEFAULT_GENERATED
  - updated_at: datetime, NULLABLE=NO, DEFAULT='CURRENT_TIMESTAMP', EXTRA=DEFAULT_GENERATED on update CURRENT_TIMESTAMP

## Tabuľka: meat_price_lock  <-- POZNÁMKA PRE AI: Zamknuté ceny (kompozitný PK).
  - material_id: int, NULLABLE=NO, KEY=PRI
  - product_id: int, NULLABLE=NO, KEY=PRI
  - price_eur_kg: decimal(10,3), NULLABLE=NO
  - locked_at: datetime, NULLABLE=NO, DEFAULT='CURRENT_TIMESTAMP', EXTRA=DEFAULT_GENERATED

## Tabuľka: meat_products  <-- POZNÁMKA PRE AI: Produkty rozrábky.
  - id: int, NULLABLE=NO, KEY=PRI, EXTRA=auto_increment
  - code: varchar(50), NULLABLE=NO, KEY=UNI
  - name: varchar(120), NULLABLE=NO
  - selling_price_eur_kg: decimal(10,3), NULLABLE=NO, DEFAULT='0.000'
  - is_active: tinyint(1), NULLABLE=NO, DEFAULT='1'
  - created_at: datetime, NULLABLE=NO, DEFAULT='CURRENT_TIMESTAMP', EXTRA=DEFAULT_GENERATED
  - updated_at: datetime, NULLABLE=NO, DEFAULT='CURRENT_TIMESTAMP', EXTRA=DEFAULT_GENERATED on update CURRENT_TIMESTAMP

## Tabuľka: produkty  <-- POZNÁMKA PRE AI: Centrálny zoznam produktov (EAN ako PK).
  - ean: varchar(32), NULLABLE=NO, KEY=PRI  <-- POZNÁMKA PRE AI: Primárny kľúč.
  - nazov_vyrobku: varchar(255), NULLABLE=NO, KEY=MUL  <-- POZNÁMKA PRE AI: Názov. Hľadaj cez `LOWER(nazov_vyrobku) LIKE '%...%'`.
  - mj: varchar(16), NULLABLE=YES, DEFAULT='kg'
  - kategoria_pre_recepty: varchar(255), NULLABLE=YES, KEY=MUL
  - typ_polozky: varchar(50), NULLABLE=YES
  - vaha_balenia_g: int, NULLABLE=YES
  - dph: decimal(5,2), NULLABLE=YES, DEFAULT='0.00'
  - zdrojovy_ean: varchar(32), NULLABLE=YES, KEY=MUL
  - minimalna_zasoba_kg: decimal(12,3), NULLABLE=YES, DEFAULT='0.000'
  - minimalna_zasoba_ks: decimal(12,3), NULLABLE=YES, DEFAULT='0.000'
  - vyrobna_davka_kg: decimal(14,3), NULLABLE=YES
  - aktualny_sklad_finalny_kg: decimal(14,3), NULLABLE=NO, DEFAULT='0.000'  <-- POZNÁMKA PRE AI: Sklad hotových výrobkov.
  - predajna_kategoria: varchar(100), NULLABLE=YES

## Tabuľka: profit_calculation_items  <-- POZNÁMKA PRE AI: Položky kalkulácie.
  - id: int, NULLABLE=NO, KEY=PRI, EXTRA=auto_increment
  - calculation_id: int, NULLABLE=NO, KEY=MUL
  - product_ean: varchar(32), NULLABLE=NO, KEY=MUL
  - estimated_kg: decimal(12,3), NULLABLE=NO, DEFAULT='0.000'
  - purchase_price_net: decimal(12,4), NULLABLE=NO, DEFAULT='0.0000'
  - sell_price_net: decimal(12,4), NULLABLE=NO, DEFAULT='0.0000'

## Tabuľka: profit_calculations  <-- POZNÁMKA PRE AI: Mesačné kalkulácie.
  - id: int, NULLABLE=NO, KEY=PRI, EXTRA=auto_increment
  - name: varchar(255), NULLABLE=NO
  - report_year: int, NULLABLE=NO, KEY=MUL
  - report_month: int, NULLABLE=NO
  - vehicle_id: int, NULLABLE=YES, KEY=MUL  <-- POZNÁMKA PRE AI: Join na `fleet_vehicles.id`.
  - distance_km: decimal(12,2), NULLABLE=YES, DEFAULT='0.00'
  - transport_cost: decimal(12,2), NULLABLE=YES, DEFAULT='0.00'

## Tabuľka: profit_department_monthly  <-- POZNÁMKA PRE AI: Mesačné náklady oddelení.
  - id: int, NULLABLE=NO, KEY=PRI, EXTRA=auto_increment
  - report_year: int, NULLABLE=NO, KEY=MUL
  - report_month: int, NULLABLE=NO
  - hr_cost: decimal(14,2), NULLABLE=NO, DEFAULT='0.00'
  - electricity_cost: decimal(14,2), NULLABLE=NO, DEFAULT='0.00'
  - gas_cost: decimal(14,2), NULLABLE=NO, DEFAULT='0.00'
  - energy_cost: decimal(14,2), NULLABLE=YES, EXTRA=STORED GENERATED
  - production_cost: decimal(14,2), NULLABLE=NO, DEFAULT='0.00'
  - sales_cost: decimal(14,2), NULLABLE=NO, DEFAULT='0.00'
  - transport_cost: decimal(14,2), NULLABLE=NO, DEFAULT='0.00'
  - operational_cost: decimal(14,2), NULLABLE=NO, DEFAULT='0.00'
  - hygiene_cost: decimal(14,2), NULLABLE=NO, DEFAULT='0.00'
  - admin_cost: decimal(14,2), NULLABLE=NO, DEFAULT='0.00'
  - other_cost: decimal(14,2), NULLABLE=NO, DEFAULT='0.00'
  - total_cost: decimal(14,2), NULLABLE=YES, EXTRA=STORED GENERATED
  - exp_stock_prev: decimal(14,2), NULLABLE=YES, DEFAULT='0.00'
  - exp_from_butchering: decimal(14,2), NULLABLE=YES, DEFAULT='0.00'
  - exp_from_prod: decimal(14,2), NULLABLE=YES, DEFAULT='0.00'
  - exp_external: decimal(14,2), NULLABLE=YES, DEFAULT='0.00'
  - exp_returns: decimal(14,2), NULLABLE=YES, DEFAULT='0.00'
  - exp_stock_current: decimal(14,2), NULLABLE=YES, DEFAULT='0.00'
  - exp_revenue: decimal(14,2), NULLABLE=YES, DEFAULT='0.00'
  - butcher_meat_value: decimal(14,2), NULLABLE=YES, DEFAULT='0.00'
  - butcher_paid_goods: decimal(14,2), NULLABLE=YES, DEFAULT='0.00'
  - butcher_process_value: decimal(14,2), NULLABLE=YES, DEFAULT='0.00'
  - butcher_returns_value: decimal(14,2), NULLABLE=YES, DEFAULT='0.00'
  - general_costs: decimal(14,2), NULLABLE=YES, DEFAULT='0.00'

## Tabuľka: profit_production_monthly  <-- POZNÁMKA PRE AI: Mesačná produkcia.
  - id: int, NULLABLE=NO, KEY=PRI, EXTRA=auto_increment
  - report_year: int, NULLABLE=NO, KEY=MUL
  - report_month: int, NULLABLE=NO
  - product_ean: varchar(32), NULLABLE=NO, KEY=MUL
  - expedition_sales_kg: decimal(14,3), NULLABLE=YES, DEFAULT='0.000'
  - transfer_price_per_unit: decimal(12,2), NULLABLE=YES, DEFAULT='0.00'

## Tabuľka: profit_sales_monthly  <-- POZNÁMKA PRE AI: Mesačný predaj.
  - id: int, NULLABLE=NO, KEY=PRI, EXTRA=auto_increment
  - report_year: int, NULLABLE=NO, KEY=MUL
  - report_month: int, NULLABLE=NO
  - product_ean: varchar(32), NULLABLE=NO, KEY=MUL
  - sales_channel: varchar(32), NULLABLE=YES
  - nazov_vyrobku: varchar(255), NULLABLE=NO
  - sales_kg: decimal(14,3), NULLABLE=YES, DEFAULT='0.000'
  - purchase_price_net: decimal(12,2), NULLABLE=YES, DEFAULT='0.00'
  - purchase_price_vat: decimal(12,2), NULLABLE=YES, DEFAULT='0.00'
  - sell_price_net: decimal(12,2), NULLABLE=YES, DEFAULT='0.00'
  - sell_price_vat: decimal(12,2), NULLABLE=YES, DEFAULT='0.00'

## Tabuľka: recepty  <-- POZNÁMKA PRE AI: Receptúry.
  - id: int, NULLABLE=NO, KEY=PRI, EXTRA=auto_increment
  - nazov_vyrobku: varchar(255), NULLABLE=NO, KEY=MUL
  - produkt_ean: varchar(32), NULLABLE=YES, KEY=MUL
  - nazov_suroviny: varchar(255), NULLABLE=NO, KEY=MUL
  - mnozstvo_na_davku_kg: decimal(12,3), NULLABLE=NO
  - typ: varchar(50), NULLABLE=YES, DEFAULT='surovina'

## Tabuľka: sklad  <-- POZNÁMKA PRE AI: Suroviny na sklade (názov je PK).
  - nazov: varchar(255), NULLABLE=NO, KEY=PRI  <-- POZNÁMKA PRE AI: PK (text). Hľadaj cez `LOWER(nazov) LIKE ...`.
  - typ: varchar(50), NULLABLE=NO, KEY=MUL
  - podtyp: enum('maso','koreniny'), NULLABLE=YES
  - mnozstvo: decimal(14,3), NULLABLE=NO, DEFAULT='0.000'
  - nakupna_cena: decimal(12,3), NULLABLE=YES
  - min_zasoba: decimal(12,3), NULLABLE=YES, DEFAULT='0.000'
  - is_infinite_stock: tinyint(1), NULLABLE=NO, DEFAULT='0'
  - default_cena_eur_kg: decimal(10,3), NULLABLE=YES
  - kategoria: varchar(64), NULLABLE=YES
  - dodavatel_id: int, NULLABLE=YES, KEY=MUL

## Tabuľka: sklad_vyroba  <-- POZNÁMKA PRE AI: Výrobný sklad (viazaný na `sklad.nazov`).
  - nazov: varchar(255), NULLABLE=NO, KEY=PRI
  - mnozstvo: decimal(14,3), NULLABLE=NO, DEFAULT='0.000'
  - updated_at: datetime, NULLABLE=NO, DEFAULT='CURRENT_TIMESTAMP', EXTRA=DEFAULT_GENERATED on update CURRENT_TIMESTAMP

## Tabuľka: skody  <-- POZNÁMKA PRE AI: Evidencia škôd.
  - id: int, NULLABLE=NO, KEY=PRI, EXTRA=auto_increment
  - datum: datetime, NULLABLE=NO, DEFAULT='CURRENT_TIMESTAMP', EXTRA=DEFAULT_GENERATED
  - pracovnik: varchar(255), NULLABLE=YES
  - id_davky: varchar(64), NULLABLE=YES, KEY=MUL
  - nazov_vyrobku: varchar(255), NULLABLE=YES
  - mnozstvo: decimal(14,3), NULLABLE=NO
  - dovod: text, NULLABLE=YES

## Tabuľka: supplier_categories  <-- POZNÁMKA PRE AI: Kategórie dodávateľa.
  - supplier_id: int, NULLABLE=NO, KEY=PRI
  - category: enum('koreniny','obal','pomocny_material'), NULLABLE=NO, KEY=PRI

## Tabuľka: suppliers  <-- POZNÁMKA PRE AI: Dodávatelia.
  - id: int, NULLABLE=NO, KEY=PRI, EXTRA=auto_increment
  - name: varchar(255), NULLABLE=NO, KEY=UNI
  - phone: varchar(50), NULLABLE=YES
  - email: varchar(255), NULLABLE=YES
  - address: text, NULLABLE=YES
  - is_active: tinyint, NULLABLE=NO, DEFAULT='1'
  - created_at: datetime, NULLABLE=NO, DEFAULT='CURRENT_TIMESTAMP', EXTRA=DEFAULT_GENERATED
  - updated_at: datetime, NULLABLE=NO, DEFAULT='CURRENT_TIMESTAMP', EXTRA=DEFAULT_GENERATED on update CURRENT_TIMESTAMP

## Tabuľka: system_settings  <-- POZNÁMKA PRE AI: Nastavenia.
  - id: int, NULLABLE=NO, KEY=PRI, EXTRA=auto_increment
  - kluc: varchar(191), NULLABLE=YES, KEY=UNI
  - hodnota: text, NULLABLE=YES
  - updated_at: timestamp, NULLABLE=YES, DEFAULT='CURRENT_TIMESTAMP', EXTRA=DEFAULT_GENERATED on update CURRENT_TIMESTAMP

## Tabuľka: temps_devices  <-- POZNÁMKA PRE AI: Čidlá teplôt.
  - id: int, NULLABLE=NO, KEY=PRI, EXTRA=auto_increment
  - code: varchar(50), NULLABLE=NO, KEY=UNI
  - name: varchar(100), NULLABLE=NO
  - location: varchar(120), NULLABLE=NO
  - device_type: enum('CHLAD','MRAZ','ROZRABKA'), NULLABLE=NO
  - is_active: tinyint(1), NULLABLE=NO, DEFAULT='1'
  - manual_off: tinyint(1), NULLABLE=NO, DEFAULT='0'
  - created_at: datetime, NULLABLE=NO, DEFAULT='CURRENT_TIMESTAMP', EXTRA=DEFAULT_GENERATED
  - updated_at: datetime, NULLABLE=NO, DEFAULT='CURRENT_TIMESTAMP', EXTRA=DEFAULT_GENERATED on update CURRENT_TIMESTAMP

## Tabuľka: temps_outages  <-- POZNÁMKA PRE AI: Vypnutia čidiel.
  - id: int, NULLABLE=NO, KEY=PRI, EXTRA=auto_increment
  - device_id: int, NULLABLE=NO, KEY=MUL
  - is_enabled: tinyint(1), NULLABLE=NO, DEFAULT='1'
  - dow_mask: tinyint unsigned, NULLABLE=NO, DEFAULT='0'
  - start_minute: smallint unsigned, NULLABLE=NO, DEFAULT='0'
  - end_minute: smallint unsigned, NULLABLE=NO, DEFAULT='1439'
  - date_from: date, NULLABLE=YES
  - date_to: date, NULLABLE=YES

## Tabuľka: temps_readings  <-- POZNÁMKA PRE AI: Merania teplôt.
  - id: bigint, NULLABLE=NO, KEY=PRI, EXTRA=auto_increment
  - device_id: int, NULLABLE=NO, KEY=MUL
  - ts: datetime, NULLABLE=NO, KEY=MUL
  - temperature: decimal(5,2), NULLABLE=YES
  - status: enum('OK','OFF'), NULLABLE=NO, DEFAULT='OK'

## Tabuľka: vw_stock_products_central — VIEW  <-- POZNÁMKA PRE AI: Pohľad na výrobky.
  - ean: varchar(32), NULLABLE=NO
  - nazov_vyrobku: varchar(255), NULLABLE=NO
  - predajna_kategoria: varchar(100), NULLABLE=YES
  - mj: varchar(16), NULLABLE=YES, DEFAULT='kg'
  - vaha_balenia_g: int, NULLABLE=YES
  - centralny_sklad_kg: decimal(14,3), NULLABLE=NO, DEFAULT='0.000'

## Tabuľka: vw_stock_raw_materials — VIEW  <-- POZNÁMKA PRE AI: Pohľad na suroviny.
  - nazov: varchar(255), NULLABLE=NO
  - typ: varchar(50), NULLABLE=NO
  - vyrobny_sklad_kg: decimal(14,3), NULLABLE=NO, DEFAULT='0.000'
  - centralny_sklad_kg: decimal(14,3), NULLABLE=NO, DEFAULT='0.000'

## Tabuľka: vydajky  <-- POZNÁMKA PRE AI: Výdajky surovín.
  - id: int, NULLABLE=NO, KEY=PRI, EXTRA=auto_increment
  - datum: datetime, NULLABLE=NO, DEFAULT='CURRENT_TIMESTAMP', EXTRA=DEFAULT_GENERATED
  - pracovnik: varchar(255), NULLABLE=NO
  - nazov: varchar(255), NULLABLE=NO, KEY=MUL
  - mnozstvo: decimal(14,3), NULLABLE=NO
  - poznamka: text, NULLABLE=YES

## Tabuľka: vyrobne_objednavky  <-- POZNÁMKA PRE AI: Objednávky výroby.
  - id: int, NULLABLE=NO, KEY=PRI, EXTRA=auto_increment
  - cislo: varchar(64), NULLABLE=NO, KEY=UNI
  - dodavatel_id: int, NULLABLE=YES
  - dodavatel_nazov: varchar(255), NULLABLE=NO
  - datum_objednania: date, NULLABLE=NO
  - datum_dodania: date, NULLABLE=YES
  - stav: enum('draft','objednane','prijate','zrusene'), NULLABLE=NO, DEFAULT='objednane'
  - mena: char(3), NULLABLE=NO, DEFAULT='EUR'
  - poznamka: text, NULLABLE=YES
  - created_at: datetime, NULLABLE=NO, DEFAULT='CURRENT_TIMESTAMP', EXTRA=DEFAULT_GENERATED
  - updated_at: datetime, NULLABLE=NO, DEFAULT='CURRENT_TIMESTAMP', EXTRA=DEFAULT_GENERATED on update CURRENT_TIMESTAMP

## Tabuľka: vyrobne_objednavky_polozky  <-- POZNÁMKA PRE AI: Položky objednávok.
  - id: int, NULLABLE=NO, KEY=PRI, EXTRA=auto_increment
  - objednavka_id: int, NULLABLE=NO, KEY=MUL
  - sklad_id: int, NULLABLE=YES
  - nazov_suroviny: varchar(255), NULLABLE=NO
  - jednotka: varchar(16), NULLABLE=NO, DEFAULT='kg'
  - mnozstvo_ordered: decimal(12,3), NULLABLE=NO
  - cena_predpoklad: decimal(12,4), NULLABLE=YES
  - mnozstvo_dodane: decimal(12,3), NULLABLE=YES
  - cena_skutocna: decimal(12,4), NULLABLE=YES
  - created_at: datetime, NULLABLE=NO, DEFAULT='CURRENT_TIMESTAMP', EXTRA=DEFAULT_GENERATED
  - updated_at: datetime, NULLABLE=NO, DEFAULT='CURRENT_TIMESTAMP', EXTRA=DEFAULT_GENERATED on update CURRENT_TIMESTAMP

## Tabuľka: zaznamy_prijem  <-- POZNÁMKA PRE AI: Príjmy surovín.
  - id: int, NULLABLE=NO, KEY=PRI, EXTRA=auto_increment
  - datum: datetime, NULLABLE=NO, DEFAULT='CURRENT_TIMESTAMP', EXTRA=DEFAULT_GENERATED
  - nazov_suroviny: varchar(255), NULLABLE=NO, KEY=MUL
  - mnozstvo_kg: decimal(14,3), NULLABLE=NO
  - nakupna_cena_eur_kg: decimal(12,3), NULLABLE=YES
  - typ: varchar(50), NULLABLE=YES
  - poznamka_dodavatel: text, NULLABLE=YES

## Tabuľka: zaznamy_vyroba  <-- POZNÁMKA PRE AI: Výrobný denník.
  - id: int, NULLABLE=NO, KEY=PRI, EXTRA=auto_increment
  - id_davky: varchar(64), NULLABLE=NO, KEY=UNI
  - stav: varchar(64), NULLABLE=NO, KEY=MUL
  - datum_vyroby: datetime, NULLABLE=YES, KEY=MUL
  - nazov_vyrobku: varchar(255), NULLABLE=NO, KEY=MUL
  - produkt_ean: varchar(32), NULLABLE=YES, KEY=MUL
  - planovane_mnozstvo_kg: decimal(14,3), NULLABLE=YES, DEFAULT='0.000'
  - realne_mnozstvo_kg: decimal(14,3), NULLABLE=YES, DEFAULT='0.000'
  - realne_mnozstvo_ks: int, NULLABLE=YES, DEFAULT='0'
  - planovane_ks: int, NULLABLE=YES, DEFAULT='0'
  - celkova_cena_surovin: decimal(14,2), NULLABLE=YES, DEFAULT='0.00'
  - cena_za_jednotku: decimal(12,4), NULLABLE=YES
  - datum_spustenia: datetime, NULLABLE=YES
  - datum_ukoncenia: datetime, NULLABLE=YES
  - zmeneny_recept: tinyint, NULLABLE=NO, DEFAULT='0'
  - detaily_zmeny: json, NULLABLE=YES
  - poznamka: text, NULLABLE=YES
  - poznamka_expedicie: text, NULLABLE=YES

## Tabuľka: zaznamy_vyroba_suroviny  <-- POZNÁMKA PRE AI: Suroviny výroby.
  - id: int, NULLABLE=NO, KEY=PRI, EXTRA=auto_increment
  - id_davky: varchar(64), NULLABLE=NO, KEY=MUL
  - nazov_suroviny: varchar(255), NULLABLE=NO, KEY=MUL
  - pouzite_mnozstvo_kg: decimal(14,3), NULLABLE=NO

---

### Vzťahy (FK) pre JOINy:
- **Jazdy a Vozidlá:** `FROM fleet_logs JOIN fleet_vehicles ON fleet_logs.vehicle_id = fleet_vehicles.id`
- **Tankovanie a Vozidlá:** `FROM fleet_refueling JOIN fleet_vehicles ON fleet_refueling.vehicle_id = fleet_vehicles.id`
- **Akcie a Produkty:** `FROM b2b_promotions JOIN produkty ON b2b_promotions.product_ean = produkty.ean`
- **Akcie a Reťazce:** `FROM b2b_promotions JOIN b2b_retail_chains ON b2b_promotions.chain_id = b2b_retail_chains.id`
- **Teploty a Zariadenia:** `FROM temps_readings JOIN temps_devices ON temps_readings.device_id = temps_devices.id`

### Príklady pre AI:
1. **"Koľko km prešlo auto SA 889 DG v novembri?"**
   ```sql
   SELECT COALESCE(SUM(l.km_driven), 0) as km
   FROM fleet_logs l
   JOIN fleet_vehicles v ON l.vehicle_id = v.id
   WHERE REPLACE(REPLACE(v.license_plate, ' ', ''), '-', '') LIKE '%SA889DG%'
     AND MONTH(l.log_date) = 11 AND YEAR(l.log_date) = 2025;