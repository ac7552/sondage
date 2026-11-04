class MatchMailer < ApplicationMailer
  # To each admin: a Fellow and a historian chose each other.
  def mutual(admin, interest)
    @interest = interest
    mail to: admin.email, subject: "Match ready to confirm: #{interest.fellow.display_name} and #{interest.historian.name}"
  end

  # To the Fellow and to the historian once Sondage confirms.
  def confirmed(user, interest)
    @user = user
    @interest = interest
    @other = user.fellow? ? interest.historian.name : interest.fellow.display_name
    mail to: user.email, subject: user.fellow? ? "#{@other} will be your Sondage historian" : "You are now #{@other}'s historian"
  end
end
