class SafetyMailer < ApplicationMailer
  # To the Fellow and each family member when a recovery is requested.
  # Holds no secrets: it points them to the safety email they already have.
  def recovery_requested(contact, recovery)
    @contact = contact
    @recovery = recovery
    @fellow_name = recovery.fellow.display_name
    subject = contact.role == "self" ? "You asked to get your Sondage recordings back" : "#{@fellow_name.split.first} needs your help with their Sondage recordings"
    mail to: contact.email, subject: subject
  end

  def recovery_for_admin(admin, recovery)
    @recovery = recovery
    @fellow = recovery.fellow
    mail to: admin.email, subject: "Recovery requested: #{@fellow.display_name}"
  end

  def recovery_blocked(admin, recovery, contact)
    @recovery = recovery
    @fellow = recovery.fellow
    @contact = contact
    mail to: admin.email, subject: "Recovery stopped by #{contact.name}: #{@fellow.display_name}"
  end
end
