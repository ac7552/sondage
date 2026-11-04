require "active_support/core_ext/integer/time"

Rails.application.configure do
  # Encryption keys for Sondage's safety copies at rest. Keep them in a secrets manager.
  config.active_record.encryption.primary_key = ENV.fetch("AR_ENCRYPTION_PRIMARY_KEY")
  config.active_record.encryption.deterministic_key = ENV.fetch("AR_ENCRYPTION_DETERMINISTIC_KEY")
  config.active_record.encryption.key_derivation_salt = ENV.fetch("AR_ENCRYPTION_KEY_DERIVATION_SALT")

  config.enable_reloading = false
  config.eager_load = true
  config.consider_all_requests_local = false
  config.action_controller.perform_caching = true
  # public/sondage scripts aren't fingerprinted, so keep their cache short.
  config.public_file_server.headers = { "cache-control" => "public, max-age=300" }
  config.active_storage.service = :local
  config.assume_ssl = true
  config.force_ssl = true
  config.log_tags = [ :request_id ]
  config.logger = ActiveSupport::TaggedLogging.logger(STDOUT)
  config.log_level = ENV.fetch("RAILS_LOG_LEVEL", "info")
  config.active_support.report_deprecations = false
  config.active_record.dump_schema_after_migration = false
  config.active_record.attributes_for_inspect = [ :id ]
  config.action_mailer.default_url_options = { host: ENV.fetch("APP_HOST", "app.sondagestandard.com"), protocol: "https" }
  # Configure SMTP (or a provider's API) through environment variables when deploying.
  config.action_cable.allowed_request_origins = [ ENV.fetch("APP_ORIGIN", "https://app.sondagestandard.com"), "file://" ]
end
