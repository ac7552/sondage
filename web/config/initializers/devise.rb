Devise.setup do |config|
  config.parent_mailer = "ApplicationMailer"
  config.mailer_sender = ENV.fetch("MAIL_FROM", "Sondage <hello@sondagestandard.com>")
  require "devise/orm/active_record"

  config.case_insensitive_keys = [ :email ]
  config.strip_whitespace_keys = [ :email ]
  config.skip_session_storage = [ :http_auth ]
  config.stretches = Rails.env.test? ? 1 : 12
  config.password_length = 8..128
  config.email_regexp = /\A[^@\s]+@[^@\s]+\z/
  config.expire_all_remember_me_on_sign_out = true

  # Reset links stay valid for a day: older people may not read email right away.
  config.reset_password_within = 24.hours

  # Lock the account after 10 wrong passwords; it unlocks by itself after an hour,
  # or straight away from a link sent by email.
  config.lock_strategy = :failed_attempts
  config.unlock_keys = [ :email ]
  config.unlock_strategy = :both
  config.maximum_attempts = 10
  config.unlock_in = 1.hour

  config.sign_out_via = :delete
  config.navigational_formats = [ "*/*", :html ]
  config.responder.error_status = :unprocessable_entity
  config.responder.redirect_status = :see_other
end
