-- ===================================================================
-- 0003 Spielstand bekommt das Feld "spielName"
-- ===================================================================
-- Die Startseite fragt nach einem Namen fuer das Spiel. Er gehoert in den
-- Spielstand, damit ihn auch das zweite Geraet kennt und er beim
-- Archivieren als Bezeichnung uebernommen werden kann.
-- Dieselbe Stelle muss in sync.js (normalize/payload/merge) und in
-- server.js (neuerStand) stehen.

create or replace function public.push_state(p_state jsonb) returns jsonb
    language plpgsql security definer set search_path = ''
as $$
declare
    v_uid      uuid := (select auth.uid());
    v_ein      jsonb := coalesce(p_state, '{}'::jsonb);
    v_rev      bigint;
    v_alt      jsonb;
    v_alt_rev  bigint := 0;
    v_neu      jsonb;
    v_zeit     numeric;
begin
    if v_uid is null or not exists (select 1 from public.profiles where user_id = v_uid) then
        raise exception 'Nicht angemeldet' using errcode = '42501';
    end if;
    if jsonb_typeof(v_ein) <> 'object' then
        v_ein := '{}'::jsonb;
    end if;
    -- wie express.json({ limit: '5mb' })
    if octet_length(v_ein::text) > 5 * 1024 * 1024 then
        raise exception 'Spielstand zu gross (max. 5 MB)' using errcode = '22001';
    end if;

    perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 0));

    v_rev := trunc(private.js_zahl(v_ein -> 'rev'))::bigint;

    select s.state into v_alt from public.states s where s.user_id = v_uid;
    if found then
        v_alt_rev := trunc(private.js_zahl(v_alt -> 'rev'))::bigint;
    end if;

    v_zeit := private.js_zahl(v_ein -> 'updatedAt');
    if v_zeit = 0 then
        v_zeit := floor(extract(epoch from clock_timestamp()) * 1000);
    end if;

    -- Dieselbe Feldliste wie "neuerStand" in server.js. Ein neues Feld im
    -- Spielstand muss HIER und in normalize()/payload() in sync.js dazu.
    v_neu := jsonb_build_object(
        'rev', v_rev,
        'updatedAt', v_zeit,
        'spielId', private.js_oder_null(v_ein -> 'spielId'),
        'spielName', private.js_oder_null(v_ein -> 'spielName'),
        'spieler', private.js_liste(v_ein -> 'spieler'),
        'aktionen', private.js_liste(v_ein -> 'aktionen'),
        'tickerMarken', private.js_liste(v_ein -> 'tickerMarken'),
        'aktiverTorwartId', private.js_oder_null(v_ein -> 'aktiverTorwartId'),
        'teamHeim', private.js_oder_null(v_ein -> 'teamHeim'),
        'teamGast', private.js_oder_null(v_ein -> 'teamGast'),
        'halbzeitSekunden', case when private.js_zahl(v_ein -> 'halbzeitSekunden') = 0
                                 then null
                                 else to_jsonb(private.js_zahl(v_ein -> 'halbzeitSekunden')) end
    );

    -- Veraltete Schreibvorgaenge abweisen.
    -- Neu gegenueber server.js: auch bei GLEICHER rev wird abgewiesen, wenn
    -- der Inhalt ein anderer ist. Zwei Geraete, die vom selben Stand aus je
    -- eine Aenderung machen, landen beide bei rev+1 - frueher hat das zweite
    -- das erste stillschweigend ueberschrieben. Ein wiederholter Push mit
    -- demselben Inhalt (Antwort ging im Netz verloren) wird weiter angenommen.
    if v_rev <> 0 and (
        v_alt_rev > v_rev
        or (v_alt_rev = v_rev and v_alt is not null and v_alt is distinct from v_neu)
    ) then
        return jsonb_build_object(
            'ok', false,
            'error', 'stale',
            'message', format('Serverstand (rev %s) ist neuer als der gesendete (rev %s).', v_alt_rev, v_rev),
            'state', v_alt
        );
    end if;

    if v_alt is not null then
        insert into public.state_backups as b (user_id, state, saved_at)
        values (v_uid, v_alt, now())
        on conflict (user_id) do update
            set state = excluded.state, saved_at = excluded.saved_at
            where b.saved_at < now() - interval '5 minutes';
    end if;

    insert into public.states (user_id, rev, state, updated_at)
    values (v_uid, v_rev, v_neu, now())
    on conflict (user_id) do update
        set rev = excluded.rev, state = excluded.state, updated_at = excluded.updated_at;

    return jsonb_build_object('ok', true, 'rev', v_rev);
end;
$$;
