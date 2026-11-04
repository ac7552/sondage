class SafetyMailer < ApplicationMailer
  # To the Fellow and each family member when a recovery is requested.
  # Holds no secrets: it points them to the safety email they already have.
  def recovery_requested(contact, recovery)
    @contact = contact
    @recovery = recovery
    @fellow_name = recovery.fellow.display_name
    subject =
      if recovery.inheritance? then "Confirm: open #{@fellow_name.split.first}'s recordings on your computer"
      elsif contact.role == "self" then "You asked to get your Sondage recordings back"
      else "#{@fellow_name.split.first} needs your help with their Sondage recordings"
      end
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

  # After a Fellow's death -------------------------------------------------

  def death_reported(admin, claim)
    @claim = claim
    @fellow = claim.fellow
    mail to: admin.email, subject: "Death reported: #{@fellow.display_name} (please check)"
  end

  # To the Fellow's own address, in case the report isn't true.
  def death_reported_to_fellow(contact, claim)
    @claim = claim
    @fellow = claim.fellow
    mail to: contact.email, subject: "Please call Sondage"
  end

  # To the heir once Sondage has confirmed the death.
  def heir_ready(claim)
    @claim = claim
    @fellow = claim.fellow
    @contact = claim.safety_contact
    mail to: @contact.email, subject: "How to open #{@fellow.display_name.split.first}'s Sondage recordings"
  end
end
