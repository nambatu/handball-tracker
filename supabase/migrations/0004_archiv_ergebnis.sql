-- ===================================================================
-- 0004 Archivliste zeigt das Ergebnis (Tore Heim / Tore Gast)
-- ===================================================================
-- Die Archivkarten in der App zeigen "Heim 24 : 21 Gast". Gezaehlt wird wie
-- im Spielbericht (report.js buildReport): jede Aktion, deren Typ "WurfTor"
-- enthaelt, ist ein Tor; es zaehlt fuer die Gegnerseite, wenn der Spieler
-- team = 'gast' hat (ohne team-Feld: Name Gegner/Enemy/Gast), sonst fuer Heim.
-- Neue Spalten stehen hinten, damit "create or replace view" geht. Die App
-- laeuft auch ohne diese Migration (dann steht das Ergebnis nicht auf der Karte).

create or replace view public.archives_list with (security_invoker = true) as
    select
        a.filename,
        a.created_at as date,
        a.label,
        private.js_oder_null(a.data -> 'teamHeim') as "teamHeim",
        private.js_oder_null(a.data -> 'teamGast') as "teamGast",
        case when jsonb_typeof(a.data -> 'aktionen') = 'array'
             then jsonb_array_length(a.data -> 'aktionen') end as aktionen,
        t.heim as "toreHeim",
        t.gast as "toreGast"
    from public.archives a
    left join lateral (
        select
            count(*) filter (where not g.ist_gast)::int as heim,
            count(*) filter (where g.ist_gast)::int as gast
        from (
            select coalesce(
                       p.team = 'gast',
                       case when p.team = 'heim' then false end,
                       lower(btrim(coalesce(p.name, ''))) in ('gegner', 'enemy', 'gast'),
                       false) as ist_gast
            from jsonb_array_elements(
                     case when jsonb_typeof(a.data -> 'aktionen') = 'array'
                          then a.data -> 'aktionen' else '[]'::jsonb end) as ak
            left join lateral (
                select s.p ->> 'team' as team, s.p ->> 'name' as name
                from jsonb_array_elements(
                         case when jsonb_typeof(a.data -> 'spieler') = 'array'
                              then a.data -> 'spieler' else '[]'::jsonb end) as s(p)
                where s.p ->> 'id' = ak.value ->> 'spielerId'
                limit 1
            ) p on true
            where jsonb_typeof(ak.value) = 'object'
              and coalesce(ak.value ->> 'typ', '') like '%WurfTor%'
        ) g
    ) t on true;

revoke all on public.archives_list from anon;
