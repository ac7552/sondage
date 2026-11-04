require "active_support/core_ext/integer/time"

Rails.application.configure do
  # Encryption keys for Sondage's safety copies at rest. Not secret: for local use only.
  config.active_record.encryption.primary_key = "sondage-development-primary-key-not-secret"
  config.active_record.encryption.deterministic_key = "sondage-development-deterministic-key-not-secret"
  config.active_record.encryption.key_derivation_salt = "sondage-development-salt-not-secret"

  config.enable_reloading = true
  # Always re-check the page scripts in public/sondage, so a browser never runs an old copy.
  config.public_file_server.headers = { "cache-control" => "no-cache" }
  config.eager_load = false
  config.consider_all_requests_local = true
  config.server_timing = true
  config.action_controller.perform_caching = false
  config.cache_store = :memory_store
  config.active_storage.service = :local
  config.active_support.deprecation = :log
  config.active_record.migration_error = :page_load
  config.active_record.verbose_query_logs = true
  config.active_job.queue_adapter = :async
  config.action_mailer.delivery_method = :letter_opener
  config.action_mailer.perform_deliveries = true
  config.action_mailer.default_url_options = { host: "localhost", port: 3000 }
  config.action_view.annotate_rendered_view_with_filenames = true
  config.action_controller.raise_on_missing_callback_actions = true

  # The desktop app connects from a file:// page; the browser from this host.
  config.action_cable.allowed_request_origins = [ %r{\Ahttps?://(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|[\w-]+\.local)(:\d+)?\z}, "file://" ]

  # Let other machines on the local network reach the dev server for testing calls.
  config.hosts.clear
end
