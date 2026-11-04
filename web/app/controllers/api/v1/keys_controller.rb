# The Fellow's public keys and the safety-copy setup.
# The private key never leaves their computer. Sondage receives its own safety copy
# and, for the Fellow and each family member, only a fingerprint of theirs.
class Api::V1::KeysController < Api::V1::BaseController
  before_action :require_fellow!

  def update
    signing = params.require(:signing_public_key)
    recipient = params.require(:age_recipient)
    replaced = current_user.signing_public_key.present? && current_user.signing_public_key != signing
    contacts = Array(params[:safety_contacts]).map { |c| c.permit(:name, :email, :role, :piece_sha256).to_h }

    ActiveRecord::Base.transaction do
      current_user.update!(signing_public_key: signing, signing_key_registered_at: Time.current)
      @fellow.update!(age_recipient: recipient)
      if params[:sondage_share].present?
        @fellow.update!(sondage_share: params[:sondage_share])
        @fellow.safety_contacts.destroy_all
        contacts.each { |c| @fellow.safety_contacts.create!(c) }
      end
      @fellow.recoveries.pending.update_all(status: "cancelled") if replaced
    end
    AuditEvent.record!("fellow.key_registered", actor: current_user, fellow: @fellow, replaced:, safety_contacts: contacts.map { |c| c["name"] })
    render json: { ok: true, replaced:, safety_contacts: @fellow.safety_contacts.map { |c| { name: c.name, role: c.role } } }
  end
end
