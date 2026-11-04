# The page a safety-copy holder reaches from the link in their safety email.
# Their piece travels in the link's #fragment, which browsers never send to a server:
# the page proves which piece it holds with a fingerprint, and on approval encrypts
# the piece to the Fellow's new computer before sending it.
class SafetyController < ApplicationController
  skip_before_action :authenticate_user!
  skip_forgery_protection only: %i[lookup approve deny] # JSON only, no cookies involved
  rate_limit to: 30, within: 10.minutes, only: %i[lookup approve deny], with: -> { render json: { error: "Too many tries. Please wait a few minutes." }, status: :too_many_requests }
  layout "plain"
  before_action :find_contact, only: %i[lookup approve deny]

  def show; end

  def lookup
    r = pending_recovery
    render json: {
      contact: { name: @contact.name, role: @contact.role },
      fellow: { name: @contact.fellow.display_name },
      recovery: r && { id: r.id, requested_at: r.created_at.iso8601, client: r.client, recipient: r.recipient, already_approved: r.approvals.exists?(safety_contact: @contact) }
    }
  end

  def approve
    r = pending_recovery
    return render(json: { error: "There's no request to approve right now." }, status: :not_found) unless r && r.id == params[:recovery_id].to_i
    begin
      r.approvals.find_or_create_by!(safety_contact: @contact) { |a| a.encrypted_piece = params.require(:encrypted_piece) }
    rescue ActiveRecord::RecordNotUnique
      # clicked twice at once: the first one counted
    rescue ActionController::ParameterMissing
      return render(json: { error: "Something went wrong. Please click the button in your email again." }, status: :bad_request)
    end
    AuditEvent.record!("recovery.approved", actor: nil, fellow: @contact.fellow, subject: r, by: @contact.name, role: @contact.role)
    render json: { ok: true }
  end

  # "This wasn't them": stops the request and tells Sondage.
  def deny
    r = pending_recovery
    return render(json: { error: "There's no request right now." }, status: :not_found) unless r && r.id == params[:recovery_id].to_i
    r.update!(status: "blocked", blocked_by: @contact)
    AuditEvent.record!("recovery.blocked", actor: nil, fellow: @contact.fellow, subject: r, by: @contact.name)
    User.where(role: "admin").find_each { |a| SafetyMailer.recovery_blocked(a, r, @contact).deliver_later }
    render json: { ok: true }
  end

  private

  def find_contact
    @contact = SafetyContact.find_by(piece_sha256: params[:piece_sha256].to_s.downcase)
    render json: { error: "This safety link isn't recognised. It may have been replaced by a newer one." }, status: :not_found unless @contact
  end

  def pending_recovery = @contact.fellow.recoveries.pending.first
end
