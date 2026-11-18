# The confirmation a Senior Fellow receives when a Sitting ends. Fixed wording,
# plain facts only: no content of the conversation and no generated text.
class SittingMailer < ApplicationMailer
  def confirmation(meeting, started_at:, ended_at:)
    @meeting = meeting
    @fellow = meeting.fellow
    @scholar = meeting.host
    @started_at = started_at
    @ended_at = ended_at
    @sitting = format("%02d", meeting.part || 1)
    mail to: @fellow.email, subject: "Your Sitting on #{started_at.strftime('%B %-d, %Y')}"
  end
end
