# Rebuilding a Fellow's key on a new computer. The new computer sends a one-time
# public key; each approving holder encrypts their piece to it. Two pieces are enough.
class Api::V1::RecoveriesController < Api::V1::BaseController
  before_action :require_fellow!
  before_action :set_recovery, only: %i[show complete]

  def create
    if @fellow.deceased?
      return render(json: { error: "This account is closed. Please call Sondage." }, status: :forbidden)
    end
    unless current_user.signing_public_key.present? && @fellow.safety_contacts.any?
      return render(json: { error: "No safety copies were set up for this account. Please call Sondage." }, status: :unprocessable_entity)
    end
    # Once a helper says "this wasn't them", only Sondage can clear it, after calling the Fellow.
    if @fellow.recoveries.first&.status == "blocked"
      return render(json: { error: "A helper stopped the last request. Please call Sondage." }, status: :forbidden)
    end
    recovery = nil
    ActiveRecord::Base.transaction do
      @fellow.recoveries.pending.update_all(status: "cancelled")
      recovery = @fellow.recoveries.create!(recipient: params.require(:recipient), release_after: Recovery.wait_hours.hours.from_now, client: params[:client].to_s.first(100))
    end
    @fellow.safety_contacts.each { |c| SafetyMailer.recovery_requested(c, recovery).deliver_later }
    User.where(role: "admin").find_each { |a| SafetyMailer.recovery_for_admin(a, recovery).deliver_later }
    AuditEvent.record!("recovery.requested", actor: current_user, fellow: @fellow, subject: recovery)
    render json: payload(recovery), status: :created
  end

  def show
    render json: payload(@recovery)
  end

  def complete
    return render(json: { error: "This request is closed." }, status: :conflict) unless @recovery.pending?
    @recovery.update!(status: "complete", completed_at: Time.current)
    AuditEvent.record!("recovery.completed", actor: current_user, fellow: @fellow, subject: @recovery, pieces: @recovery.pieces_available)
    render json: { ok: true }
  end

  private

  def set_recovery = @recovery = @fellow.recoveries.find(params[:id])

  def payload(r)
    approved = r.approvals.includes(:safety_contact).index_by(&:safety_contact_id)
    {
      id: r.id, status: r.status, release_after: r.release_after.iso8601,
      contacts: @fellow.safety_contacts.map { |c| { name: c.name, role: c.role, approved: approved.key?(c.id), blocked: r.blocked_by_id == c.id } },
      pieces: r.pending? ? approved.values.map { |a| { from: a.safety_contact.name, encrypted_piece: a.encrypted_piece } } : [],
      sondage: { released: r.sondage_released?, piece: (@fellow.sondage_share if r.sondage_released? && r.pending?) }
    }
  end
end
