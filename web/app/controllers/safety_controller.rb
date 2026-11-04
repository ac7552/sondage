# The page a safety-copy holder reaches from the link in their safety email.
# Their piece travels in the link's #fragment, which browsers never send to a server:
# the page proves which piece it holds with a fingerprint, and on approval encrypts
# the piece to the Fellow's new computer before sending it.
class SafetyController < ApplicationController
  include StrictPagePolicy
  strict_page_policy only: :show
  skip_before_action :authenticate_user!
  skip_forgery_protection only: %i[lookup approve deny report_death] # JSON only, no cookies involved
  rate_limit to: 30, within: 10.minutes, only: %i[lookup approve deny report_death], with: -> { render json: { error: "Too many tries. Please wait a few minutes." }, status: :too_many_requests }
  layout "plain"
  before_action :find_contact, only: %i[lookup approve deny report_death]

  def show; end

  def lookup
    r = pending_recovery
    claim = @contact.fellow.inheritance_claims.active.first
    render json: {
      contact: { name: @contact.name, role: @contact.role, heir: @contact.heir },
      fellow: { name: @contact.fellow.display_name, deceased: @contact.fellow.deceased? },
      recovery: r && {
        id: r.id, requested_at: r.created_at.iso8601, client: r.client, recipient: r.recipient, already_approved: r.approvals.exists?(safety_contact: @contact),
        inheritance: r.inheritance? && { heir: r.inheritance_claim.safety_contact.name, mine: r.inheritance_claim.safety_contact_id == @contact.id }
      },
      inheritance: claim && { status: claim.status, reported_by: claim.safety_contact.name },
      can_report_death: @contact.heir && !@contact.fellow.deceased? && claim.nil?
    }
  end

  def approve
    r = pending_recovery
    return render(json: { error: "There's no request to approve right now." }, status: :not_found) unless r && r.id == params[:recovery_id].to_i
    # After a death only the heir's own piece is used; other helpers can still stop it.
    if r.inheritance? && r.inheritance_claim.safety_contact_id != @contact.id
      return render(json: { error: "Only #{r.inheritance_claim.safety_contact.name} needs to confirm this." }, status: :forbidden)
    end
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

  # An heir tells Sondage the Fellow has died. Nothing opens until Sondage checks.
  def report_death
    fellow = @contact.fellow
    return render(json: { error: "Only someone #{fellow.display_name.split.first} chose for this can tell us here. Please call Sondage." }, status: :forbidden) unless @contact.heir
    # Already reported or confirmed: nothing more to do, and no more emails.
    return render(json: { ok: true }) if fellow.deceased? || fellow.inheritance_claims.active.exists?
    claim = fellow.inheritance_claims.create!(safety_contact: @contact, note: params[:note].to_s.first(1000))
    AuditEvent.record!("inheritance.reported", actor: nil, fellow:, subject: claim, by: @contact.name)
    User.where(role: "admin").find_each { |a| SafetyMailer.death_reported(a, claim).deliver_later }
    # In case it isn't true, the Fellow hears about it straight away.
    fellow.safety_contacts.where(role: "self").find_each { |c| SafetyMailer.death_reported_to_fellow(c, claim).deliver_later }
    render json: { ok: true }
  end

  private

  def find_contact
    @contact = SafetyContact.find_by(piece_sha256: params[:piece_sha256].to_s.downcase)
    render json: { error: "This safety link isn't recognised. It may have been replaced by a newer one." }, status: :not_found unless @contact
  end

  def pending_recovery = @contact.fellow.recoveries.pending.first
end
