-- F24 (À APPLIQUER SEULEMENT À LA BASCULE DU RAPPORT QUOTIDIEN) — tâche
-- planifiée du rapport de 8 h Supabase.
--
-- Prérequis : la fonction daily-health-report est déployée, le secret
-- DAILY_REPORT_SECRET est défini dans les secrets des fonctions ET la même
-- valeur est enregistrée dans le coffre : select vault.create_secret('<valeur>', 'daily_report_secret');
-- La tâche tourne toutes les heures ; la fonction n'envoie rien tant que
-- app_settings.daily_report_enabled n'est pas vrai, n'envoie qu'entre 8 h et
-- 10 h (Zurich) et au plus un e-mail par jour.
-- Retour en arrière : select cron.unschedule('daily-health-report');

do $$
begin
  perform cron.unschedule('daily-health-report');
exception when others then
  null; -- la tâche n'existait pas encore
end $$;

select cron.schedule(
  'daily-health-report',
  '0 * * * *',
  $job$
    select net.http_post(
      url := 'https://ekciarsrdyismyevgkqg.supabase.co/functions/v1/daily-health-report?s='
             || (select decrypted_secret from vault.decrypted_secrets where name = 'daily_report_secret'),
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body := '{}'::jsonb,
      timeout_milliseconds := 30000
    );
  $job$
);
