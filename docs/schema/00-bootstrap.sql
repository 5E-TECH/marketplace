-- ============================================================================
-- Elchi Marketplace — DB BOOTSTRAP (provisioning)
-- Topologiya: 1 ta PostgreSQL instance + 9 ta SCHEMA (bounded context har biriga).
--
-- Bu fayl drawSQL uchun EMAS — bu real bazani sozlash uchun (DDL provisioning).
-- Ketma-ketlik:
--   1) 00-bootstrap.sql  ← shu fayl (database, schema'lar, user'lar, grant'lar)
--   2) 01-identity.sql ... 09-search.sql  ← jadval DDL'lari (har biri o'z schema'sida)
--
-- MUHIM:
--   • Har servis FAQAT o'z schema'siga kira oladi (least-privilege, blast-radius cheklangan).
--   • Servislararo bog'lanish = API/event orqali (cross-schema FK YARATILMAYDI).
--   • Parollar bu yerda CHANGE_ME — real qiymatlar .env / secret manager'dan keladi,
--     hech qachon git'ga commit qilinmaydi.
-- ============================================================================

-- ── 0. DATABASE ─────────────────────────────────────────────────────────────
-- (Bir marta, superuser sifatida. Keyin shu bazaga ulanib qolganini bajarasiz.)
--   CREATE DATABASE elchi_marketplace ENCODING 'UTF8' LC_COLLATE 'en_US.UTF-8' LC_CTYPE 'en_US.UTF-8';
--   \c elchi_marketplace

-- Hech kim public'ga default yozmasin (xavfsizlik):
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

-- ── 1. MIGRATSIYA ROLI (DDL egasi) ──────────────────────────────────────────
-- Har schema shu rol nomidan yaratiladi; jadvallarni ham shu rol migratsiya qiladi.
-- App user'lari (pastda) DDL emas, faqat DML huquqiga ega bo'ladi.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mkt_migrator') THEN
    CREATE ROLE mkt_migrator LOGIN PASSWORD 'CHANGE_ME_migrator';
  END IF;
END $$;

-- ── 2. SCHEMA'LAR (qisqa nomlar — cross-reference izohlari bilan mos) ────────
CREATE SCHEMA IF NOT EXISTS identity      AUTHORIZATION mkt_migrator;
CREATE SCHEMA IF NOT EXISTS catalog       AUTHORIZATION mkt_migrator;
CREATE SCHEMA IF NOT EXISTS inventory     AUTHORIZATION mkt_migrator;
CREATE SCHEMA IF NOT EXISTS checkout      AUTHORIZATION mkt_migrator;
CREATE SCHEMA IF NOT EXISTS payment       AUTHORIZATION mkt_migrator;
CREATE SCHEMA IF NOT EXISTS finance       AUTHORIZATION mkt_migrator;
CREATE SCHEMA IF NOT EXISTS integration   AUTHORIZATION mkt_migrator;
CREATE SCHEMA IF NOT EXISTS notification  AUTHORIZATION mkt_migrator;
CREATE SCHEMA IF NOT EXISTS search        AUTHORIZATION mkt_migrator;

-- ── 3. HAR SERVISGA ALOHIDA APP USER (least-privilege) ──────────────────────
-- Har user FAQAT o'z schema'sida DML (SELECT/INSERT/UPDATE/DELETE) qila oladi.
-- Boshqa schema'ga USAGE yo'q → payment buzilsa ham identity jadvalini o'qiy olmaydi.
DO $$
DECLARE
  svc   TEXT;
  usr   TEXT;
  svcs  TEXT[] := ARRAY[
    'identity','catalog','inventory','checkout','payment',
    'finance','integration','notification','search'
  ];
BEGIN
  FOREACH svc IN ARRAY svcs LOOP
    usr := 'mkt_' || svc;

    -- login roli (parol placeholder — real qiymat env/secret'dan)
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = usr) THEN
      EXECUTE format('CREATE ROLE %I LOGIN PASSWORD %L', usr, 'CHANGE_ME_' || svc);
    END IF;

    -- faqat o'z schema'sini ko'radi va ishlatadi
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO %I', svc, usr);

    -- mavjud jadval/sekvenslar uchun DML
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA %I TO %I', svc, usr);
    EXECUTE format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA %I TO %I', svc, usr);

    -- kelajakda migrator yaratadigan jadval/sekvenslar uchun ham avtomatik DML
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES FOR ROLE mkt_migrator IN SCHEMA %I '
      || 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I', svc, usr);
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES FOR ROLE mkt_migrator IN SCHEMA %I '
      || 'GRANT USAGE, SELECT ON SEQUENCES TO %I', svc, usr);

    -- har user ulanganda o'z schema'si default bo'lsin (jadvalni prefiksize yozadi)
    EXECUTE format('ALTER ROLE %I SET search_path = %I', usr, svc);
  END LOOP;
END $$;

-- ── 4. MIGRATOR search_path (barcha schema ko'rinadi, tartib bilan) ──────────
ALTER ROLE mkt_migrator SET search_path =
  identity, catalog, inventory, checkout, payment,
  finance, integration, notification, search, public;

-- ============================================================================
-- ESLATMA — 01..09 fayllar boshida allaqachon `SET search_path = <svc>;` bor,
-- shu bois to'g'ridan migrator sifatida bajarish kifoya (schema o'zi tanlanadi):
--   for f in 01-identity 02-catalog 03-inventory 04-checkout 05-payment \
--            06-finance 07-integration 08-notification 09-search; do
--     PGPASSWORD=... psql -U mkt_migrator -d elchi_marketplace -f "$f.sql"; done
-- (drawSQL import'da `SET search_path` qatori e'tiborsiz qoldiriladi — muammo emas.)
--
-- KEYINCHALIK fizik bo'lishga o'tish (masalan payment yuklama ostida):
--   • o'sha schema'ni alohida instance'ga `pg_dump -n payment` bilan ko'chirasiz,
--   • app faqat connection string'ini o'zgartiradi — kod tegmaydi,
--     chunki cross-schema FK yo'q va bog'lanish API/event orqali.
-- ============================================================================
