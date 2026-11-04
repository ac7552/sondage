Rails.application.configure do
  # Encryption keys for Sondage's safety copies at rest. Not secret: for local use only.
  config.active_record.encryption.primary_key = "sondage-test-primary-key-not-secret"
  config.active_record.encryption.deterministic_key = "sondage-test-deterministic-key-not-secret"
  config.active_record.encryption.key_derivation_salt = "sondage-test-salt-not-secret"

  config.enable_reloading = false
  config.eager_load = ENV["CI"].present?
  config.consider_all_requests_local = true
  config.cache_store = :null_store
  config.action_dispatch.show_exceptions = :rescuable
  config.action_controller.allow_forgery_protection = false
  config.active_storage.service = :test
  config.active_support.deprecation = :stderr
  config.active_job.queue_adapter = :test
  config.action_mailer.delivery_method = :test
  config.action_mailer.default_url_options = { host: "www.example.com" }
  config.action_controller.raise_on_missing_callback_actions = true
end
