-- ===================================================================
-- 0001 Grundschema: Konten, Spielstand, Archive, Mannschaften, Avatare
-- ===================================================================
-- Ersetzt die JSON-Dateien unter DATA_DIR (server.js). Der Ticker
-- (Einstellungen, Merkzettel, Outbox) kommt in einer eigenen Migration.
--
-- Grundsaetze:
--   - Jede Tabelle hat Row Level Security: man sieht nur die eigenen Zeilen.
--   - Ein Konto zaehlt erst, wenn es eine Zeile in "profiles" hat. Die legt
--     nur die Edge Function "register" an (Einladungscode). Ein Konto, das
--     an der Function vorbei entsteht, kann dadurch nichts lesen/schreiben.
--   - Der Spielstand bleibt EIN JSON-Dokument je Benutzer. Nicht
--     normalisieren: die Zusammenfuehrung in public/js/sync.js haengt an
--     genau dieser Form.

create schema if not exists private;
grant usage on schema private to authenticated, service_role;

-- -------------------------------------------------------------------
-- Konten
-- -------------------------------------------------------------------
create table public.profiles (
    user_id    uuid primary key references auth.users(id) on delete cascade,
    username   text not null,
    slug       text not null unique,
    created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

create policy "eigenes profil lesen" on public.profiles
    for select to authenticated
    using (user_id = (select auth.uid()));

-- Mitglied = angemeldet UND ueber die Registrierung mit Einladungscode
-- angelegt. Security definer, damit die Pruefung nicht selbst an RLS haengt.
create function private.ist_mitglied() returns boolean
    language sql stable security definer set search_path = ''
as $$
    select exists (select 1 from public.profiles where user_id = (select auth.uid()));
$$;
revoke execute on function private.ist_mitglied() from public;
grant execute on function private.ist_mitglied() to authenticated, service_role;

-- -------------------------------------------------------------------
-- Helfer: JavaScript-Verhalten von server.js nachbilden
-- -------------------------------------------------------------------

-- Number(x) || 0
create function private.js_zahl(j jsonb) returns numeric
    language sql immutable set search_path = ''
as $$
    select case
        when jsonb_typeof(j) = 'number' then (j #>> '{}')::numeric
        when jsonb_typeof(j) = 'string' and (j #>> '{}') ~ '^\s*-?\d+(\.\d+)?\s*$'
            then trim(j #>> '{}')::numeric
        else 0
    end;
$$;

-- x || null   (leerer Text, 0, false, null, fehlend -> null)
create function private.js_oder_null(j jsonb) returns jsonb
    language sql immutable set search_path = ''
as $$
    select case
        when j is null then null
        when jsonb_typeof(j) = 'null' then null
        when jsonb_typeof(j) = 'string' and (j #>> '{}') = '' then null
        when jsonb_typeof(j) = 'number' and (j #>> '{}')::numeric = 0 then null
        when jsonb_typeof(j) = 'boolean' and (j #>> '{}') = 'false' then null
        else j
    end;
$$;

-- Array.isArray(x) ? x : []
create function private.js_liste(j jsonb) returns jsonb
    language sql immutable set search_path = ''
as $$
    select case when jsonb_typeof(j) = 'array' then j else '[]'::jsonb end;
$$;

-- -------------------------------------------------------------------
-- Spielstand
-- -------------------------------------------------------------------
create table public.states (
    user_id    uuid primary key references auth.users(id) on delete cascade,
    rev        bigint not null default 0,
    state      jsonb not null,
    updated_at timestamptz not null default now()
);
alter table public.states enable row level security;

-- Nur lesen. Geschrieben wird ausschliesslich ueber push_state(), damit
-- die rev-Pruefung nicht umgangen werden kann.
create policy "eigenen stand lesen" on public.states
    for select to authenticated
    using (user_id = (select auth.uid()) and (select private.ist_mitglied()));

-- Rollende Sicherung der letzten guten Fassung (hoechstens alle 5 Minuten),
-- wie die state.json.bak auf dem Pi. Kein Zugriff ueber die API.
create table public.state_backups (
    user_id  uuid primary key references auth.users(id) on delete cascade,
    state    jsonb not null,
    saved_at timestamptz not null default now()
);
alter table public.state_backups enable row level security;

create function public.get_state() returns jsonb
    language sql stable security invoker set search_path = ''
as $$
    select coalesce(
        (select state from public.states where user_id = (select auth.uid())),
        '{"spieler": [], "aktionen": []}'::jsonb
    );
$$;

-- Ersetzt POST /api/state samt der 409-Antwort.
--   Erfolg:   {"ok": true,  "rev": <rev>}
--   Veraltet: {"ok": false, "error": "stale", "message": "...", "state": <Serverstand>}
-- Pruefung und Schreiben laufen in EINER Transaktion unter einer Sperre je
-- Benutzer - zwei Geraete koennen sich nicht gegenseitig ueberholen.
create function public.push_state(p_state jsonb) returns jsonb
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

    -- Veraltete Schreibvorgaenge abweisen (server.js: incomingRev && existingRev > incomingRev)
    if v_rev <> 0 and v_alt_rev > v_rev then
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

    insert into public.states (user_id, rev, state, updated_at)
    values (v_uid, v_rev, v_neu, now())
    on conflict (user_id) do update
        set rev = excluded.rev, state = excluded.state, updated_at = excluded.updated_at;

    return jsonb_build_object('ok', true, 'rev', v_rev);
end;
$$;

revoke execute on function public.get_state() from public, anon;
revoke execute on function public.push_state(jsonb) from public, anon;
grant execute on function public.get_state() to authenticated;
grant execute on function public.push_state(jsonb) to authenticated;

-- -------------------------------------------------------------------
-- Archivierte Spiele
-- -------------------------------------------------------------------
create table public.archives (
    id         bigint generated always as identity primary key,
    user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
    filename   text not null check (filename ~ '^[A-Za-z0-9._-]{1,120}\.json$'),
    label      text check (label is null or char_length(label) <= 120),
    data       jsonb not null check (octet_length(data::text) <= 5 * 1024 * 1024),
    created_at timestamptz not null default now(),
    unique (user_id, filename)
);
alter table public.archives enable row level security;

create policy "eigene archive" on public.archives
    for all to authenticated
    using (user_id = (select auth.uid()) and (select private.ist_mitglied()))
    with check (user_id = (select auth.uid()) and (select private.ist_mitglied()));

-- Liste ohne die grossen JSON-Dokumente (wie GET /api/archives).
create view public.archives_list with (security_invoker = true) as
    select
        filename,
        created_at as date,
        label,
        private.js_oder_null(data -> 'teamHeim') as "teamHeim",
        private.js_oder_null(data -> 'teamGast') as "teamGast",
        case when jsonb_typeof(data -> 'aktionen') = 'array'
             then jsonb_array_length(data -> 'aktionen') end as aktionen
    from public.archives;

grant execute on function private.js_oder_null(jsonb) to authenticated;
revoke all on public.archives_list from anon;

-- -------------------------------------------------------------------
-- Gespeicherte Mannschaften
-- -------------------------------------------------------------------
create table public.teams (
    user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
    id         text not null check (char_length(id) between 1 and 80),
    data       jsonb not null check (octet_length(data::text) <= 1024 * 1024),
    created_at timestamptz not null default now(),
    primary key (user_id, id)
);
alter table public.teams enable row level security;

create policy "eigene mannschaften" on public.teams
    for all to authenticated
    using (user_id = (select auth.uid()) and (select private.ist_mitglied()))
    with check (user_id = (select auth.uid()) and (select private.ist_mitglied()));

-- -------------------------------------------------------------------
-- Avatare (Supabase Storage)
-- -------------------------------------------------------------------
-- Oeffentlicher Bucket: ein <img> kann kein Token mitschicken. Der Schutz
-- ist wie bisher der zufaellige, nicht erratbare Dateiname. Hochladen darf
-- man nur in den eigenen Ordner <user_id>/. Auflisten kann niemand.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2 * 1024 * 1024,
        array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do nothing;

create policy "avatar in eigenen ordner hochladen" on storage.objects
    for insert to authenticated
    with check (
        bucket_id = 'avatars'
        and (storage.foldername(name))[1] = (select auth.uid())::text
        and (select private.ist_mitglied())
    );

-- -------------------------------------------------------------------
-- Registrierung (nur fuer die Edge Function "register", service_role)
-- -------------------------------------------------------------------
create table private.register_versuche (
    ip   text not null,
    zeit timestamptz not null default now()
);
create index on private.register_versuche (ip, zeit);

-- Zaehlt den Versuch mit und sagt, ob er noch erlaubt ist (5 je Stunde und
-- Adresse, wie der registerLimiter in server.js).
create function public.register_erlaubt(p_ip text) returns boolean
    language plpgsql security definer set search_path = ''
as $$
declare
    v_anzahl int;
begin
    delete from private.register_versuche where zeit < now() - interval '1 day';
    insert into private.register_versuche (ip) values (coalesce(p_ip, '?'));
    select count(*) into v_anzahl from private.register_versuche
        where ip = coalesce(p_ip, '?') and zeit > now() - interval '1 hour';
    return v_anzahl <= 5;
end;
$$;

-- Altdaten vom Pi, nach Benutzer-Slug abgelegt. Wer sich mit demselben
-- Namen neu registriert, bekommt sie einmalig zugeordnet.
-- archives: [{ "filename": "...", "date": "ISO", "label": null, "data": {...} }]
create table private.altdaten (
    slug           text primary key,
    state          jsonb,
    teams          jsonb,
    archives       jsonb,
    uebernommen_am timestamptz
);

create function public.registrierung_abschliessen(p_user uuid, p_username text, p_slug text)
    returns jsonb
    language plpgsql security definer set search_path = ''
as $$
declare
    v_alt private.altdaten%rowtype;
    v_uebernommen boolean := false;
begin
    insert into public.profiles (user_id, username, slug) values (p_user, p_username, p_slug);

    select * into v_alt from private.altdaten
        where slug = p_slug and uebernommen_am is null for update;
    if found then
        if v_alt.state is not null then
            insert into public.states (user_id, rev, state)
            values (p_user, trunc(private.js_zahl(v_alt.state -> 'rev'))::bigint, v_alt.state)
            on conflict (user_id) do nothing;
        end if;
        if jsonb_typeof(v_alt.teams) = 'array' then
            insert into public.teams (user_id, id, data)
            select p_user, t ->> 'id', t
            from jsonb_array_elements(v_alt.teams) t
            where coalesce(t ->> 'id', '') <> ''
            on conflict do nothing;
        end if;
        if jsonb_typeof(v_alt.archives) = 'array' then
            insert into public.archives (user_id, filename, label, data, created_at)
            select p_user, a ->> 'filename', nullif(a ->> 'label', ''), a -> 'data',
                   coalesce((a ->> 'date')::timestamptz, now())
            from jsonb_array_elements(v_alt.archives) a
            where a ? 'filename' and jsonb_typeof(a -> 'data') = 'object'
            on conflict do nothing;
        end if;
        update private.altdaten set uebernommen_am = now() where slug = p_slug;
        v_uebernommen := true;
    end if;

    return jsonb_build_object('ok', true, 'altdaten', v_uebernommen);
end;
$$;

revoke execute on function public.register_erlaubt(text) from public, anon, authenticated;
revoke execute on function public.registrierung_abschliessen(uuid, text, text) from public, anon, authenticated;
grant execute on function public.register_erlaubt(text) to service_role;
grant execute on function public.registrierung_abschliessen(uuid, text, text) to service_role;
