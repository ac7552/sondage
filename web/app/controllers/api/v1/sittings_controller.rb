# When a Sitting ends, the Senior Fellow's app reports the plain facts (when it
# started and stopped) so Sondage can send the confirmation email. Nothing about
# what was said, and no file, ever reaches the server.
class Api::V1::SittingsController < Api::V1::BaseController
  before_action :require_fellow!

  def create
    meeting = @fellow.interviews.find(params[:id])
    started_at = Time.iso8601(params.require(:started_at))
    ended_at = Time.iso8601(params.require(:ended_at))
    return render(json: { error: "The Sitting can't end before it starts." }, status: :bad_request) if ended_at < started_at

    first_time = !meeting.sealed?
    meeting.update!(status: "sealed") # held: the recording is with the Senior Fellow
    SittingMailer.confirmation(meeting, started_at:, ended_at:).deliver_later if first_time
    AuditEvent.record!("sitting.held", actor: current_user, fellow: @fellow, subject: meeting)
    render json: { ok: true, emailed: first_time }
  rescue ArgumentError
    render json: { error: "Times must be ISO 8601." }, status: :bad_request
  end
end
