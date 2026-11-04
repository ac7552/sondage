# For an heir, after Sondage has confirmed a Fellow's death: rebuild the Fellow's
# key on the heir's own computer, from the heir's safety copy plus Sondage's.
# It works exactly like getting a key back on a new computer.
class Api::V1::InheritancesController < Api::V1::BaseController
  before_action :require_heir!
  before_action :set_claim, except: :index

  def index
    render json: { inheritances: current_user.inheritance_claims.where(status: %w[confirmed complete]).includes(fellow: :user).map { |c| claim_json(c) } }
  end

  # The heir's app sends a one-time key; the safety copies are locked to it.
  def create_recovery
    return render(json: { error: "This is closed." }, status: :conflict) unless @claim.confirmed?
    # A family member pressed "No, stop this": only Sondage can clear it, after calling.
    return render(json: { error: "A helper stopped the last request. Please call Sondage." }, status: :forbidden) if @claim.recoveries.exists?(status: "blocked")
    recovery = nil
    ActiveRecord::Base.transaction do
      @claim.fellow.recoveries.pending.update_all(status: "cancelled") # including any the Fellow started before
      recovery = @claim.recoveries.create!(fellow: @claim.fellow, recipient: params.require(:recipient), release_after: [ @claim.release_after, Time.current ].max, client: params[:client].to_s.first(100))
    end
    SafetyMailer.recovery_requested(@claim.safety_contact, recovery).deliver_later
    User.where(role: "admin").find_each { |a| SafetyMailer.recovery_for_admin(a, recovery).deliver_later }
    AuditEvent.record!("inheritance.key_requested", actor: current_user, fellow: @claim.fellow, subject: recovery)
    render json: recovery_json(recovery), status: :created
  end

  def recovery
    r = @claim.recoveries.find(params[:recovery_id])
    render json: recovery_json(r)
  end

  def complete
    r = @claim.recoveries.find(params[:recovery_id])
    return render(json: { error: "This request is closed." }, status: :conflict) unless r.pending?
    ActiveRecord::Base.transaction do
      r.update!(status: "complete", completed_at: Time.current)
      @claim.update!(status: "complete")
    end
    AuditEvent.record!("inheritance.key_received", actor: current_user, fellow: @claim.fellow, subject: r)
    render json: { ok: true }
  end

  private

  def require_heir!
    render json: { error: "This is only for people receiving recordings." }, status: :forbidden unless current_user.heir?
  end

  def set_claim = @claim = current_user.inheritance_claims.find(params[:id])

  def claim_json(c)
    r = c.current_recovery
    {
      id: c.id, status: c.status, release_after: c.release_after&.iso8601,
      fellow: { id: c.fellow_id, name: c.fellow.display_name, age_recipient: c.fellow.age_recipient, signing_public_key: c.fellow.user.signing_public_key },
      recovery: r && { id: r.id, status: r.status }
    }
  end

  def recovery_json(r)
    {
      id: r.id, status: r.status, release_after: r.release_after.iso8601,
      approved_by_you: r.approvals.exists?(safety_contact_id: @claim.safety_contact_id),
      pieces: r.pending? ? r.approvals.map { |a| { encrypted_piece: a.encrypted_piece } } : [],
      sondage: { released: r.sondage_released?, piece: (@claim.fellow.sondage_share if r.sondage_released? && r.pending?) }
    }
  end
end
