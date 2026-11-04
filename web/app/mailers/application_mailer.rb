class ApplicationMailer < ActionMailer::Base
  default from: ENV.fetch("MAIL_FROM", "Sondage <hello@sondagestandard.com>")
  layout "mailer"
end
