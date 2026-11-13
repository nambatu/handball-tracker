-- ===================================================================
-- Alte Konten vom Pi nach Supabase uebernehmen (Name + Passwort)
-- ===================================================================
-- Die users.json des Pi enthaelt bcrypt-Hashes; Supabase speichert
-- Passwoerter im selben Format. Deshalb gilt nach der Uebernahme das
-- ALTE Passwort weiter - niemand muss sich neu registrieren.
--
-- Anwendung: im Supabase-Dashboard unter "SQL Editor" einfuegen, die
-- Zeile  HIER_DEN_INHALT_DER_USERS_JSON_EINFUEGEN  durch den kompletten
-- Inhalt der Datei ersetzen (beginnt mit [ und endet mit ]), "Run".
-- Die Hashes gehoeren nicht in einen Chat und nicht ins Repo.
--
-- Wer unter demselben Namen schon ein neues Konto hat, wird uebersprungen.
-- Mehrfach ausfuehren schadet nicht.

with alt as (
  select x.username, x.password,
         lower(regexp_replace(x.username, '[^a-zA-Z0-9]', '_', 'g')) as slug
  from jsonb_to_recordset($json$
HIER_DEN_INHALT_DER_USERS_JSON_EINFUEGEN
$json$::jsonb) as x(username text, password text)
),
neu as (
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, email_change, email_change_token_new, recovery_token)
  select '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated',
      'authenticated', a.slug || '@tracker.langschwerts.de', a.password, now(),
      '{"provider":"email","providers":["email"]}', jsonb_build_object('username', a.username),
      now(), now(), '', '', '', ''
  from alt a
  where a.password like '$2%'
    and not exists (select 1 from public.profiles p where p.slug = a.slug)
  returning id, email, raw_user_meta_data ->> 'username' as username
),
ident as (
  insert into auth.identities (id, user_id, provider_id, identity_data, provider,
      last_sign_in_at, created_at, updated_at)
  select gen_random_uuid(), id, id::text,
      jsonb_build_object('sub', id::text, 'email', email), 'email', now(), now(), now()
  from neu
  returning 1
)
insert into public.profiles (user_id, username, slug)
select id, username, split_part(email, '@', 1) from neu
returning username as uebernommen;
